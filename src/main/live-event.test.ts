import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  LIVE_EVENT_KEYS,
  LIVE_EVENT_TARGETS,
  isCompleteLiveEvent,
  liveEventExampleLine,
  type CsvEventRecord,
  type RunStatusUpdate,
  type SkillMetadata,
} from '../shared/types.js';
import { StreamTranslator } from './stream-translator.js';
import { writeLiveEventsCsv } from './live-csv.js';

const VENUE: SkillMetadata = {
  id: 'test-scraper',
  name: 'Test Venue',
  description: 'Test',
  skillPath: '/tmp/SKILL.md',
};

/** Zerlegt eine CSV-Zeile so, wie es der Importprüfer tut. */
function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted && c === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (c === ',' && !quoted) { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  return cells;
}

let updates: RunStatusUpdate[];
let translator: StreamTranslator;

const texts = () => updates.map((u) => u.message);
const lastLive = () => updates[updates.length - 1].liveEvents ?? [];

before(() => {
  updates = [];
  translator = new StreamTranslator('run-1', VENUE, (u) => updates.push(u));
});

describe('Eine einzige Quelle für die LIVE-Zeile', () => {
  it('liest im Prompt genau die Felder, die der Parser liest', () => {
    const example = liveEventExampleLine();
    assert.ok(example.startsWith('EVENT_LIVE: {'), example);

    for (const key of LIVE_EVENT_KEYS) {
      assert.ok(example.includes(`"${key}":`), `die Beispielzeile nennt "${key}" nicht`);
    }
    // Und umgekehrt: kein Feld in der Zeile, das es nicht im Vertrag gibt.
    const named = [...example.matchAll(/"([a-z_]+)":/g)].map((m) => m[1]);
    assert.deepEqual(named.sort(), [...LIVE_EVENT_KEYS].sort());
  });

  it('bildet jedes Vertragsfeld auf eine Spalte ab oder verwirft es bewusst', () => {
    assert.deepEqual(
      Object.keys(LIVE_EVENT_TARGETS).sort(),
      LIVE_EVENT_KEYS.slice().sort(),
      'Zuordnung und Vertrag laufen auseinander'
    );
    for (const key of LIVE_EVENT_KEYS) {
      const target = LIVE_EVENT_TARGETS[key];
      assert.ok(target === null || typeof target === 'string', `${key} zeigt ins Leere`);
    }
    // `organizer` hat bewusst keine Spalte – das muss eine Entscheidung sein.
    assert.equal(LIVE_EVENT_TARGETS.organizer, null);
  });
});

describe('Der Parser liest die Form, die der Agent schickt', () => {
  const conformLine = JSON.stringify({
    title: 'Töpfern #Kaffeebecher',
    start_date: '2026-11-14',
    start_time: '15:00',
    end_date: '2026-11-14',
    end_time: '18:00',
    location: 'Haus der Jugend, Nürnberg',
    description: 'Töpfern mit der Maschine',
    link: 'https://example.com/topfern',
    image_url: 'https://example.com/bild.jpg',
    price: '12 €',
    organizer: 'Kunstverein',
    categories: 'Workshops & PopUps',
  });

  it('füllt alle Felder aus einer regelkonformen Zeile', () => {
    translator['parseLiveEventsFromText'](`Hier ein Termin:\nEVENT_LIVE: ${conformLine}\nfertig`);

    const events = lastLive();
    assert.equal(events.length, 1, `erwartet 1 Termin, gefunden ${events.length}`);

    const e = events[0];
    assert.equal(e.title, 'Töpfern #Kaffeebecher');
    assert.equal(e.startDate, '2026-11-14', 'start_date landet nicht im Startdatum');
    assert.equal(e.startTime, '15:00');
    assert.equal(e.endDate, '2026-11-14');
    assert.equal(e.endTime, '18:00');
    assert.equal(e.location, 'Haus der Jugend, Nürnberg');
    assert.equal(e.description, 'Töpfern mit der Maschine');
    assert.equal(e.detailUrl, 'https://example.com/topfern', 'link landet nicht in der Detail-URL');
    assert.equal(e.imageUrl, 'https://example.com/bild.jpg', 'image_url landet nicht im Bild');
    assert.equal(e.price, '12 €');
    assert.equal(e.category, 'Workshops & PopUps', 'categories landet nicht in der Kategorie');
    assert.equal(translator.getSkippedEventCount(), 0);
  });

  it('schreibt die Felder des Agenten nach allFields, auch die ohne Spalte', () => {
    const e = lastLive()[0];
    assert.equal(e.allFields.organizer, 'Kunstverein');
  });

  it('meldet die camelCase-Schreibweise, statt eine leere Zeile zu bauen', () => {
    const before = lastLive().length;
    const skippedBefore = translator.getSkippedEventCount();
    translator['parseLiveEventsFromText'](
      'EVENT_LIVE: {"title": "Falsch", "startDate": "2026-12-01", "detailUrl": "https://x.de"}'
    );
    const after = lastLive().length;
    assert.equal(after, before, 'es darf kein Termin dazukommen');
    // Genau einmal: die zweite Suchstufe findet dasselbe Objekt noch einmal.
    assert.equal(
      translator.getSkippedEventCount() - skippedBefore,
      1,
      'die Zeile wird doppelt gezählt'
    );
  });

  it('überspringt eine Zeile ohne Startdatum und nennt den Grund', () => {
    const before = lastLive().length;
    const skippedBefore = translator.getSkippedEventCount();
    translator['parseLiveEventsFromText'](
      'EVENT_LIVE: {"title": "Ohne Datum", "start_date": "", "location": "Nürnberg"}'
    );
    assert.equal(lastLive().length, before, 'ein Termin ohne Startdatum darf nicht ankommen');
    assert.equal(translator.getSkippedEventCount() - skippedBefore, 1);
    assert.match(texts().at(-1) ?? '', /konnten nicht verwendet werden/);
  });

  it('überspringt eine Zeile ohne Titel', () => {
    const before = lastLive().length;
    translator['parseLiveEventsFromText']('EVENT_LIVE: {"title": "  ", "start_date": "2026-12-01"}');
    assert.equal(lastLive().length, before);
  });

  it('schneidet die Zeile an einer Klammer im Titel nicht ab', () => {
    const before = lastLive().length;
    translator['parseLiveEventsFromText'](
      'EVENT_LIVE: {"title": "Jazz im {Keller}", "start_date": "2026-12-24", "link": "https://x.de"}'
    );
    const added = lastLive().slice(before);
    assert.equal(added.length, 1, 'das Objekt muss vollständig ankommen');
    assert.equal(added[0].title, 'Jazz im {Keller}');
    assert.equal(added[0].startDate, '2026-12-24');
    assert.equal(added[0].detailUrl, 'https://x.de', 'ein abgeschnittenes Objekt verliert Felder');
  });

  it('verarbeitet mehrere Zeilen in einem Text', () => {
    const before = lastLive().length;
    translator['parseLiveEventsFromText'](
      [
        'EVENT_LIVE: {"title": "Zeile eins", "start_date": "2027-01-01"}',
        'EVENT_LIVE: {"title": "Zeile zwei", "start_date": "2027-01-02"}',
      ].join('\n')
    );
    assert.equal(lastLive().length - before, 2);
  });

  it('meldet eine kaputte Zeile, statt sie zu verschlucken', () => {
    const before = lastLive().length;
    const skippedBefore = translator.getSkippedEventCount();
    translator['parseLiveEventsFromText']('EVENT_LIVE: {"title": "Kaputt", ');
    assert.equal(lastLive().length, before, 'eine kaputte Zeile wird nicht aufgenommen');
    assert.equal(translator.getSkippedEventCount(), skippedBefore, 'und auch nicht als Termin verworfen');
  });

  it('zählt jeden Termin nur einmal', () => {
    const before = lastLive().length;
    translator['parseLiveEventsFromText'](
      'EVENT_LIVE: {"title": "Töpfern #Kaffeebecher", "start_date": "2026-11-14"}'
    );
    assert.equal(lastLive().length, before, 'derselbe Termin wurde doppelt gezählt');
  });
});

describe('Der Abbruch schreibt keine unvollständigen Termine', () => {
  let dir: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-csv-'));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const complete = {
    id: 'live-1',
    fileName: '',
    rowIndex: 0,
    title: 'Töpfern #Kaffeebecher',
    description: 'Töpfern mit der Maschine',
    startDate: '2026-11-14',
    endDate: '2026-11-14',
    startTime: '15:00',
    endTime: '18:00',
    location: 'Haus der Jugend',
    category: 'Workshops & PopUps',
    price: '12 €',
    tickets: 'nein',
    ticketUrl: '', email: '', phone: '', website: '', socialMedia: '',
    imageUrl: 'https://example.com/bild.jpg',
    detailUrl: 'https://example.com/topfern',
    allFields: {},
  };

  it('lässt das Verzeichnis unverändert, wenn nur unvollständige Zeilen da sind', () => {
    const target = path.join(dir, 'leer-events-data.csv');
    const before = fs.readdirSync(dir);

    const result = writeLiveEventsCsv(target, [
      { ...complete, title: 'Ohne Datum', startDate: '' },
      { ...complete, title: '', startDate: '2026-11-14' },
    ]);

    assert.equal(result.written, 0);
    assert.equal(result.skipped.length, 2);
    assert.match(result.skipped[0].reason, /Startdatum/);
    assert.equal(fs.existsSync(target), false, 'es wurde eine Datei angelegt');
    assert.deepEqual(fs.readdirSync(dir), before, 'das Verzeichnis hat sich verändert');
  });

  it('lässt eine bestehende Datei byte-identisch, wenn nichts schreibbar ist', () => {
    const target = path.join(dir, 'vorhanden-events-data.csv');
    const original = 'Titel,Startdatum\nAlt,2026-01-01\n';
    fs.writeFileSync(target, original, 'utf8');

    const result = writeLiveEventsCsv(target, [{ ...complete, startDate: '  ' }]);

    assert.equal(result.written, 0);
    assert.equal(fs.readFileSync(target, 'utf8'), original, 'die Datei wurde verändert');
  });

  it('schreibt vollständige Zeilen mit 17 Spalten und geretteten Sonderzeichen', () => {
    const target = path.join(dir, 'voll-events-data.csv');
    const tricky = {
      ...complete,
      title: 'Töpfern "Kaffee", Special',
      description: 'Zeile 1\nZeile 2',
      startTime: '15:00',
    };

    const result = writeLiveEventsCsv(target, [tricky]);
    assert.equal(result.written, 1);

    const text = fs.readFileSync(target, 'utf8');
    // Die Beschreibung enthält absichtlich einen Zeilenumbruch – deshalb wird
    // nicht auf Zeilen getrennt, sondern die erste Zeile als Header abgehoben.
    const [header, ...rest] = text.split('\n');
    const row = rest.join('\n');
    assert.equal(header.split(',').length, 17, '17 Spalten im Header');

    // Anführungszeichen, Kommas und Zeilenumbrüche müssen den Import überstehen.
    const row2 = parseCsvRow(row);
    assert.equal(row2.length, 17, `17 Spalten in der Zeile, gefunden ${row2.length}`);
    assert.equal(row2[0], 'Töpfern "Kaffee", Special');
    assert.equal(row2[1], 'Zeile 1\nZeile 2');
    assert.equal(row2[2], '2026-11-14');
  });

  it('lässt den echten Importprüfer über die geschriebene Datei laufen', () => {
    const repo = process.env.EVENT_CREATOR_REPO_ROOT || path.resolve(process.cwd(), '..');
    const checker = path.join(repo, 'csv-import-check.js');
    if (!fs.existsSync(checker)) return; // ohne Repo kein ehrlicher Test

    const target = path.join(dir, 'geprueft-events-data.csv');
    writeLiveEventsCsv(target, [
      {
        ...complete,
        title: 'Töpfern #Kaffeebecher',
        startDate: '2099-11-14',
        category: 'Workshops & PopUps',
      },
    ]);

    let out = '';
    try {
      out = execFileSync(process.execPath, [checker, target], { encoding: 'utf8' });
    } catch (err: any) {
      out = err.stdout || '';
    }
    assert.match(out, /OK:/, `der Importprüfer lehnt die Datei ab:\n${out}`);
  });
});

describe('Die Vollständigkeitsregel', () => {
  it('verlangt Titel und Startdatum', () => {
    assert.equal(isCompleteLiveEvent({ title: 'a', startDate: '2026-01-01' }), true);
    assert.equal(isCompleteLiveEvent({ title: '', startDate: '2026-01-01' }), false);
    assert.equal(isCompleteLiveEvent({ title: 'a', startDate: '   ' }), false);
  });
});

describe('Bereich 3: 4-Phasen-Stepper und NEU/BESTAND-Klassifizierung', () => {
  it('initialisiert den 4-Phasen-Stepper mit Schritt 1 als aktiv', () => {
    const localUpdates: RunStatusUpdate[] = [];
    const t = new StreamTranslator('run-stepper-1', VENUE, (u) => localUpdates.push(u));

    const steps = t.getStepperSteps();
    assert.equal(steps.length, 4);
    assert.equal(steps[0].id, 'check_inventory');
    assert.equal(steps[0].status, 'active');
    assert.equal(steps[1].id, 'open_website');
    assert.equal(steps[1].status, 'pending');
    assert.equal(steps[2].id, 'extract_events');
    assert.equal(steps[2].status, 'pending');
    assert.equal(steps[3].id, 'validate_save');
    assert.equal(steps[3].status, 'pending');
    assert.equal(t.getActiveStepId(), 'check_inventory');
  });

  it('schaltet Schritt 1 auf completed und Schritt 2 auf active bei Event-Extraktion', () => {
    const localUpdates: RunStatusUpdate[] = [];
    const t = new StreamTranslator('run-stepper-2', VENUE, (u) => localUpdates.push(u));

    t.addLiveEvent({
      title: 'Konzert am Abend',
      start_date: '2026-12-01',
      link: 'https://example.com/konzert',
    });

    const steps = t.getStepperSteps();
    assert.equal(steps[0].status, 'completed');
    assert.equal(steps[1].status, 'completed');
    assert.equal(steps[2].status, 'active');
    assert.match(steps[2].detail || '', /1 von 1 Terminen erfasst/);
  });

  it('schaltet auf Schritt 4 (validate_save) bei Phase validating', () => {
    const localUpdates: RunStatusUpdate[] = [];
    const t = new StreamTranslator('run-stepper-3', VENUE, (u) => localUpdates.push(u));

    t.setPhase('validating', 'Qualitätsprüfung läuft...');
    const steps = t.getStepperSteps();
    assert.equal(steps[0].status, 'completed');
    assert.equal(steps[1].status, 'completed');
    assert.equal(steps[2].status, 'completed');
    assert.equal(steps[3].status, 'active');
    assert.equal(t.getActiveStepId(), 'validate_save');
  });

  it('schließt alle 4 Schritte bei setCompleted erfolgreich ab', () => {
    const localUpdates: RunStatusUpdate[] = [];
    const t = new StreamTranslator('run-stepper-4', VENUE, (u) => localUpdates.push(u));

    t.setCompleted(5, 10, ['test-events-data.csv']);
    const steps = t.getStepperSteps();
    assert.ok(steps.every((s) => s.status === 'completed'), 'alle Schritte müssen completed sein');
    assert.match(steps[3].detail || '', /5 neu, 10 Bestand gesichert/);
  });

  it('unterscheidet NEU vs. BESTAND anhand bekannter Schlüssel', () => {
    const existingKeys = new Set<string>([
      'altes konzert#2026-11-20',
      'https://example.com/alt',
    ]);

    const localUpdates: RunStatusUpdate[] = [];
    const t = new StreamTranslator('run-diff-1', VENUE, (u) => localUpdates.push(u), existingKeys);

    // 1. Bekanntes Event über Titel und Datum
    t.addLiveEvent({
      title: 'Altes Konzert',
      start_date: '2026-11-20',
      link: 'https://example.com/andere-url',
    });

    // 2. Bekanntes Event über Link
    t.addLiveEvent({
      title: 'Anderer Titel',
      start_date: '2026-12-24',
      link: 'https://example.com/alt',
    });

    // 3. Brandneues Event
    t.addLiveEvent({
      title: 'Brandneue Show',
      start_date: '2026-12-31',
      link: 'https://example.com/neu',
    });

    const live = t.getLiveEvents();
    assert.equal(live.length, 3);
    assert.equal(live[0].isNew, false, 'Altes Konzert sollte isNew=false sein');
    assert.equal(live[1].isNew, false, 'Bekannter Link sollte isNew=false sein');
    assert.equal(live[2].isNew, true, 'Brandneue Show muss isNew=true sein');

    const lastUpdate = localUpdates[localUpdates.length - 1];
    assert.equal(lastUpdate.eventsFound, 3);
    assert.equal(lastUpdate.newEventsCount, 1);
    assert.equal(lastUpdate.existingEventsCount, 2);
  });

  it('verwaltet Plan-Kandidaten und aktualisiert deren Status bei addEventSuccess/addEventSkipped', () => {
    const localUpdates: RunStatusUpdate[] = [];
    const t = new StreamTranslator('run-plan-1', VENUE, (u) => localUpdates.push(u));

    t.setPlanCandidates([
      { title: 'Event A', startDate: '2026-12-01', detailUrl: 'https://example.com/a' },
      { title: 'Event B', startDate: '2026-12-02', detailUrl: 'https://example.com/b' },
      { title: 'Event C', startDate: '2026-12-03', detailUrl: 'https://example.com/c' },
    ]);

    let plan = t.getPlanItems();
    assert.equal(plan.length, 3);
    assert.equal(plan[0].status, 'pending');
    assert.equal(plan[1].status, 'pending');

    const mockSaved: CsvEventRecord = {
      id: 'plan-event-1',
      fileName: 'test-events-data.csv',
      rowIndex: 1,
      title: 'Event A',
      description: 'Beschreibung',
      startDate: '2026-12-01',
      endDate: '',
      startTime: '19:00',
      endTime: '',
      location: 'Test Location',
      category: '',
      price: '',
      tickets: 'nein',
      ticketUrl: '',
      email: '',
      phone: '',
      website: '',
      socialMedia: '',
      imageUrl: '',
      detailUrl: 'https://example.com/a',
      allFields: {},
    };

    // Event A erfolgreich gespeichert
    t.addEventSuccess(mockSaved);

    plan = t.getPlanItems();
    assert.equal(plan[0].status, 'saved');
    assert.equal(plan[1].status, 'pending');

    // Event B übersprungen (z.B. Duplikat)
    t.addEventSkipped('Event B', '2026-12-02', 'https://example.com/b', 'Bereits im Datenbestand vorhanden');

    plan = t.getPlanItems();
    assert.equal(plan[1].status, 'skipped');
    assert.equal(plan[1].skipReason, 'Bereits im Datenbestand vorhanden');

    // Stepper zeigt aktuellen Fortschritt
    const steps = t.getStepperSteps();
    assert.equal(steps[2].status, 'active');
    assert.match(steps[2].detail || '', /1 von 3 Terminen erfasst/);

    // Letztes Update enthält planItems
    const lastUpdate = localUpdates[localUpdates.length - 1];
    assert.ok(lastUpdate.planItems);
    assert.equal(lastUpdate.planItems?.length, 3);
  });
});

