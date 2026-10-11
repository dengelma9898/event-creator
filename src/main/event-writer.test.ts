import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  EventWriter,
  isCancelledEvent,
  normalizeDateToIso,
  quote,
  CSV_HEADER,
} from './event-writer.js';

describe('EventWriter', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-writer-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('erkennt abgesagte und verschobene Events', () => {
    assert.equal(isCancelledEvent('Abgesagt: Jazz im Hof'), true);
    assert.equal(isCancelledEvent('Konzert (abgesagt)'), true);
    assert.equal(isCancelledEvent('Tour verschoben auf 2027'), true);
    assert.equal(isCancelledEvent('Reguläres Konzert', 'Dieses Event wurde abgesagt'), true);
    assert.equal(isCancelledEvent('Reguläres Konzert', 'Findet wie geplant statt'), false);
  });

  it('normalisiert deutsche Datumsangaben zu ISO', () => {
    assert.equal(normalizeDateToIso('05.10.2026'), '2026-10-05');
    assert.equal(normalizeDateToIso('2026-10-05'), '2026-10-05');
  });

  it('formatiert und escaped CSV-Felder sauber', () => {
    assert.equal(quote('Einfach'), '"Einfach"');
    assert.equal(quote('Mit "Quotes" und Komma, ja'), '"Mit ""Quotes"" und Komma, ja"');
  });

  it('lehnt unvollständige Events ab (fehlender Titel oder Datum)', () => {
    const writer = new EventWriter({
      dataDir: tmpDir,
      venueBaseName: 'test-venue',
      minStartDate: '2026-10-01',
    });

    const res1 = writer.addRawEvent({ title: '', startDate: '2026-10-05' });
    assert.equal(res1.success, false);
    assert.match(res1.reason || '', /Titel/);

    const res2 = writer.addRawEvent({ title: 'Gültig', startDate: '' });
    assert.equal(res2.success, false);
    assert.match(res2.reason || '', /Startdatum/);
  });

  it('lehnt Termine vor morgen oder in der Vergangenheit ab', () => {
    const writer = new EventWriter({
      dataDir: tmpDir,
      venueBaseName: 'test-venue',
      minStartDate: '2026-10-02',
    });

    const res = writer.addRawEvent({
      title: 'Alt',
      startDate: '2026-10-01',
    });
    assert.equal(res.success, false);
    assert.match(res.reason || '', /frühesten erlaubten Datum/);
  });

  it('lehnt ungültige Kategorien ab, erlaubt aber gültige oder leere Kategorien', () => {
    const writer = new EventWriter({
      dataDir: tmpDir,
      venueBaseName: 'test-venue',
      minStartDate: '2026-10-01',
    });

    const invalid = writer.addRawEvent({
      title: 'Event mit Quatschkategorie',
      startDate: '2026-10-05',
      category: 'Irgendwas',
    });
    assert.equal(invalid.success, false);
    assert.match(invalid.reason || '', /Ungültige Kategorie/);

    const valid = writer.addRawEvent({
      title: 'Event mit Kultur',
      startDate: '2026-10-05',
      category: 'Kultur',
      detailUrl: 'https://example.com/1',
    });
    assert.equal(valid.success, true);

    const emptyCat = writer.addRawEvent({
      title: 'Event ohne Kategorie',
      startDate: '2026-10-06',
      category: '',
      detailUrl: 'https://example.com/2',
    });
    assert.equal(emptyCat.success, true);
  });

  it('erkennt Duplikate per Detail-URL und per Titel#Startdatum', () => {
    const writer = new EventWriter({
      dataDir: tmpDir,
      venueBaseName: 'test-dupe',
      minStartDate: '2026-10-01',
    });

    const first = writer.addRawEvent({
      title: 'Einzigartiges Konzert',
      startDate: '2026-10-10',
      detailUrl: 'https://example.com/unique',
    });
    assert.equal(first.success, true);

    // Gleiche URL -> Duplikat
    const dupeUrl = writer.addRawEvent({
      title: 'Anderer Titel',
      startDate: '2026-10-11',
      detailUrl: 'https://example.com/unique',
    });
    assert.equal(dupeUrl.success, false);
    assert.match(dupeUrl.reason || '', /Duplikat.*Detail-URL/);

    // Gleicher Titel und gleiches Datum -> Duplikat
    const dupeTitle = writer.addRawEvent({
      title: 'Einzigartiges Konzert',
      startDate: '2026-10-10',
      detailUrl: 'https://example.com/different-url',
    });
    assert.equal(dupeTitle.success, false);
    assert.match(dupeTitle.reason || '', /Duplikat.*bereits vorhanden/);
  });

  it('erzwingt 50er-Chunking: erstellt bei >50 Zeilen Folge-Dateien (-2.csv)', () => {
    const chunkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-test-'));
    try {
      const writer = new EventWriter({
        dataDir: chunkDir,
        venueBaseName: 'chunk-venue',
        runDate: '2026-10-01',
        minStartDate: '2026-10-01',
      });

      // 52 Events hinzufügen
      for (let i = 1; i <= 52; i++) {
        const res = writer.addRawEvent({
          title: `Event Nummer ${i}`,
          startDate: '2026-10-15',
          detailUrl: `https://example.com/chunk/${i}`,
        });
        assert.equal(res.success, true, `Event ${i} sollte erfolgreich geschrieben werden`);
      }

      const files = writer.getFilesWritten();
      assert.equal(files.length, 2, 'Es müssen genau 2 Chunk-Dateien erzeugt worden sein');

      const file1 = path.join(chunkDir, 'chunk-venue-events-data-2026-10-01.csv');
      const file2 = path.join(chunkDir, 'chunk-venue-events-data-2026-10-01-2.csv');

      assert.ok(fs.existsSync(file1), 'Erste Chunk-Datei muss existieren');
      assert.ok(fs.existsSync(file2), 'Zweite Chunk-Datei (-2) muss existieren');

      const content1 = fs.readFileSync(file1, 'utf8').trim().split('\n');
      const content2 = fs.readFileSync(file2, 'utf8').trim().split('\n');

      // 1 Header + 50 Datenzeilen
      assert.equal(content1.length, 51, 'Erste Datei muss Header + 50 Datenzeilen haben');
      assert.equal(content1[0], CSV_HEADER);

      // 1 Header + 2 Datenzeilen
      assert.equal(content2.length, 3, 'Zweite Datei muss Header + 2 Datenzeilen haben');
      assert.equal(content2[0], CSV_HEADER);
    } finally {
      fs.rmSync(chunkDir, { recursive: true, force: true });
    }
  });
});
