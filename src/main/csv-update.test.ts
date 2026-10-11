import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { AppPaths } from './app-paths.js';
import { CsvService } from './csv-service.js';

let sandbox: string;
let dataDir: string;
let csv: CsvService;
let paths: AppPaths;

function findRepoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (
      fs.existsSync(path.join(dir, 'csv-import-check.js')) &&
      fs.existsSync(path.join(dir, 'curt-events-data.csv'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Repo-Wurzel mit csv-import-check.js und echten Testdaten nicht gefunden.');
    }
    dir = parent;
  }
}

function repoFile(name: string): string {
  const file = path.join(paths.repoRoot, name);
  assert.ok(fs.existsSync(file), `echte Testdaten fehlen: ${file}`);
  return file;
}

function seed(source: string): string {
  const fileName = path.basename(source);
  fs.copyFileSync(source, path.join(dataDir, fileName));
  return fileName;
}

before(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-update-test-'));
  dataDir = path.join(sandbox, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.EVENT_CREATOR_REPO_ROOT = findRepoRoot();
  paths = new AppPaths(dataDir);
  csv = new CsvService(paths);
});

after(() => {
  delete process.env.EVENT_CREATOR_REPO_ROOT;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('CsvService: updateEvent', () => {
  it('aktualisiert Titel, Kategorie und Startzeit eines Events und schreibt BOM-frei', async () => {
    const fileName = seed(repoFile('franmeisters-events-data.csv'));
    const target = path.join(dataDir, fileName);

    const initialEvents = await csv.loadEvents([fileName]);
    const targetEvent = initialEvents[0];
    const initialOtherRows = initialEvents.slice(1);

    const res = await csv.updateEvent({
      fileName,
      rowIndex: targetEvent.rowIndex,
      expectedTitle: targetEvent.title,
      expectedDetailUrl: targetEvent.detailUrl,
      changes: {
        title: 'Geänderter Meister-Titel',
        category: 'Kultur',
        startTime: '19:30',
      },
    });

    assert.equal(res.success, true, `Update fehlgeschlagen: ${res.error}`);
    assert.equal(res.fileUnchanged, false);

    // Datei auf Platte prüfen: BOM-frei und Änderungen sichtbar
    const content = fs.readFileSync(target, 'utf8');
    assert.notEqual(content.charCodeAt(0), 0xfeff, 'Datei darf kein BOM enthalten');

    const updatedEvents = await csv.loadEvents([fileName]);
    assert.equal(updatedEvents[0].title, 'Geänderter Meister-Titel');
    assert.equal(updatedEvents[0].category, 'Kultur');
    assert.equal(updatedEvents[0].startTime, '19:30');

    // Alle anderen Zeilen müssen unberührt geblieben sein
    for (let i = 1; i < updatedEvents.length; i++) {
      assert.equal(updatedEvents[i].title, initialOtherRows[i - 1].title);
      assert.equal(updatedEvents[i].startDate, initialOtherRows[i - 1].startDate);
    }
  });

  it('weist ungültige Änderungen ab und lässt die Datei garantiert unverändert', async () => {
    const fileName = seed(repoFile('franmeisters-events-data.csv'));
    const target = path.join(dataDir, fileName);
    const beforeContent = fs.readFileSync(target, 'utf8');

    // 1. Leerer Titel
    const resEmptyTitle = await csv.updateEvent({
      fileName,
      rowIndex: 0,
      changes: { title: '   ' },
    });
    assert.equal(resEmptyTitle.success, false);
    assert.equal(resEmptyTitle.fileUnchanged, true);
    assert.match(resEmptyTitle.error || '', /Titel darf nicht leer sein/);

    // 2. Titel mit Zeilenumbruch
    const resNewlineTitle = await csv.updateEvent({
      fileName,
      rowIndex: 0,
      changes: { title: 'Titel\nmit Umbruch' },
    });
    assert.equal(resNewlineTitle.success, false);
    assert.equal(resNewlineTitle.fileUnchanged, true);
    assert.match(resNewlineTitle.error || '', /Zeilenumbrüche/);

    // 3. Ungültige Kategorie
    const resBadCat = await csv.updateEvent({
      fileName,
      rowIndex: 0,
      changes: { category: 'Erfundene Kategorie' },
    });
    assert.equal(resBadCat.success, false);
    assert.equal(resBadCat.fileUnchanged, true);
    assert.match(resBadCat.error || '', /Ungültige Kategorie/);

    // 4. Ungültiges Zeitformat
    const resBadTime = await csv.updateEvent({
      fileName,
      rowIndex: 0,
      changes: { startTime: '25:00' },
    });
    assert.equal(resBadTime.success, false);
    assert.equal(resBadTime.fileUnchanged, true);
    assert.match(resBadTime.error || '', /Ungültige Startzeit/);

    // 5. Unvollständige Adresse
    const resBadLocation = await csv.updateEvent({
      fileName,
      rowIndex: 0,
      changes: { location: 'Nur ein Raumname ohne PLZ und Stadt' },
    });
    assert.equal(resBadLocation.success, false);
    assert.equal(resBadLocation.fileUnchanged, true);
    assert.match(resBadLocation.error || '', /Adresse unvollständig/);

    // Sicherstellen, dass die Datei exakt unverändert blieb
    const afterContent = fs.readFileSync(target, 'utf8');
    assert.equal(afterContent, beforeContent);
  });

  it('erlaubt das Korrigieren einer unvollständigen Adresse zu einer vollständigen Adresse', async () => {
    const fileName = seed(repoFile('franmeisters-events-data.csv'));

    const res = await csv.updateEvent({
      fileName,
      rowIndex: 1,
      changes: {
        location: 'Frankenstraße 200, 90461 Nürnberg',
      },
    });

    assert.equal(res.success, true);
    const updated = await csv.loadEvents([fileName]);
    assert.equal(updated[1].location, 'Frankenstraße 200, 90461 Nürnberg');
  });

  it('findet die Zielzeile auch bei Indexverschiebung anhand von expectedTitle/detailUrl', async () => {
    const fileName = seed(repoFile('franmeisters-events-data.csv'));
    const initial = await csv.loadEvents([fileName]);
    const secondEvent = initial[1];

    // Lösche erstes Event, sodass sich der Index verschiebt
    await csv.deleteEvent({
      fileName,
      rowIndex: 0,
      expectedTitle: initial[0].title,
    });

    // Versuch mit altem Index (1), aber passendem expectedTitle
    const res = await csv.updateEvent({
      fileName,
      rowIndex: 1, // war vorher 1, ist jetzt 0
      expectedTitle: secondEvent.title,
      expectedDetailUrl: secondEvent.detailUrl,
      changes: { title: 'Erfolgreich nach Verschiebung gefunden' },
    });

    assert.equal(res.success, true);
    const updated = await csv.loadEvents([fileName]);
    assert.equal(updated[0].title, 'Erfolgreich nach Verschiebung gefunden');
  });

  it('weist Pfad-Traversal und unbefugte Dateinamen ab', async () => {
    const res = await csv.updateEvent({
      fileName: '../geheim.csv',
      rowIndex: 0,
      changes: { title: 'Test' },
    });

    assert.equal(res.success, false);
    assert.equal(res.fileUnchanged, true);
  });
});
