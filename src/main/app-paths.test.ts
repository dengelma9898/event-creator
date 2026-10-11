import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { AppPaths } from './app-paths.js';
import { CsvService } from './csv-service.js';

const CSV_HEADER =
  'Titel,Beschreibung,Startdatum,Enddatum,Startzeit,Endzeit,Veranstaltungsort,Kategorien,Preis,Tickets,Ticket-URL,E-Mail,Telefon,Webseite,Social Media,Bild-URL,Detail-URL';

let sandbox: string;
let dataDir: string;
let repoRoot: string;
let outsideDir: string;
let paths: AppPaths;
let csv: CsvService;

const OUTSIDE_VICTIM = 'SECRET';
const INSIDE_VICTIM = 'Inside Event';

before(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'app-paths-test-'));
  dataDir = path.join(sandbox, 'data');
  repoRoot = path.join(sandbox, 'repo');
  outsideDir = path.join(sandbox, 'outside');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });

  process.env.EVENT_CREATOR_REPO_ROOT = repoRoot;
  // Stub des Abschluss-Checks: meldet OK, damit die Lösch-Happy-Path testbar bleibt.
  fs.writeFileSync(path.join(repoRoot, 'csv-import-check.js'), 'console.log("OK: 1/1 CSV file(s) checked.");\n', 'utf8');

  // Zwei app-eigene CSVs: eine im Ausgabeordner, eine im Projektroot.
  fs.writeFileSync(
    path.join(dataDir, 'inside-events-data.csv'),
    `${CSV_HEADER}\n"${INSIDE_VICTIM}",B,2026-12-01,,20:00,,"Nürnberg",Kultur,,nein,,,,,,https://t.de/1\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(repoRoot, 'root-events-data.csv'),
    `${CSV_HEADER}\n"Root Event",B,2026-12-02,,20:00,,"Nürnberg",Kultur,,nein,,,,,,https://t.de/2\n`,
    'utf8'
  );

  // Zieldatei ausserhalb jeder app-eigenen Wurzel.
  fs.writeFileSync(
    path.join(outsideDir, 'victim.csv'),
    `Titel,Startdatum,Ort\n"${OUTSIDE_VICTIM}",2026-10-01,"Nürnberg"\n`,
    'utf8'
  );

  paths = new AppPaths(dataDir);
  csv = new CsvService(paths);
});

after(() => {
  delete process.env.EVENT_CREATOR_REPO_ROOT;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('AppPaths', () => {
  it('besitzt genau die erwarteten Wurzeln', () => {
    assert.equal(paths.repoRoot, repoRoot);
    assert.equal(paths.dataDir, dataDir);
    assert.deepEqual(paths.csvRoots, [fs.realpathSync(dataDir), fs.realpathSync(repoRoot)]);
  });

  it('löst app-eigene Dateinamen in beiden Wurzeln auf', () => {
    const inData = paths.resolveCsvFile('inside-events-data.csv');
    assert.equal(inData.ok, true);
    assert.equal((inData as { filePath: string }).filePath, fs.realpathSync(path.join(dataDir, 'inside-events-data.csv')));

    const inRoot = paths.resolveCsvFile('root-events-data.csv');
    assert.equal(inRoot.ok, true);

    // Der Ausgabeordner hat Vorrang vor dem Projektroot.
    fs.writeFileSync(path.join(repoRoot, 'inside-events-data.csv'), 'Titel\nKopie\n', 'utf8');
    const shadowed = paths.resolveCsvFile('inside-events-data.csv');
    assert.equal(
      (shadowed as { filePath: string }).filePath,
      fs.realpathSync(path.join(dataDir, 'inside-events-data.csv'))
    );
  });

  it('weist absolute Pfade, Traversal und Separatoren ab', () => {
    const rejected = [
      path.join(outsideDir, 'victim.csv'),
      '../outside/victim.csv',
      'data/../outside/victim.csv',
      `${dataDir}/../outside/victim.csv`,
      'sub/dir.csv',
      '..',
      '.',
      '',
      '   ',
      'victim.csv/../x.csv',
    ];
    for (const candidate of rejected) {
      const resolved = paths.resolveCsvFile(candidate);
      assert.equal(resolved.ok, false, `sollte abgelehnt werden: ${candidate}`);
    }
  });

  it('weist Nicht-CSV-Ziele und unbekannte Namen ab', () => {
    fs.writeFileSync(path.join(dataDir, 'notes.txt'), 'geheim', 'utf8');
    for (const candidate of ['notes.txt', 'package.json', '../../package.json', 'gibt-es-nicht.csv']) {
      assert.equal(paths.resolveCsvFile(candidate).ok, false, `sollte abgelehnt werden: ${candidate}`);
    }
  });

  it('weist Symlinks ab, die die Wurzel verlassen', () => {
    const linkPath = path.join(dataDir, 'escape-events-data.csv');
    fs.symlinkSync(path.join(outsideDir, 'victim.csv'), linkPath);
    const resolved = paths.resolveCsvFile('escape-events-data.csv');
    assert.equal(resolved.ok, false, 'Symlink auf eine Datei ausserhalb der Wurzel muss abgelehnt werden');
    fs.unlinkSync(linkPath);
  });
});

describe('CsvService Grenze', () => {
  it('liest keine Datei ausserhalb der app-eigenen Wurzeln', async () => {
    const events = await csv.loadEvents([path.join(outsideDir, 'victim.csv')]);
    assert.equal(events.length, 0, 'darf keine Zeilen der fremden Datei liefern');
    assert.equal(
      events.some((e) => e.title === OUTSIDE_VICTIM),
      false
    );

    const traversal = await csv.loadEvents(['../outside/victim.csv', 'data/../outside/victim.csv']);
    assert.equal(traversal.length, 0);
  });

  it('schreibt und löscht keine Datei ausserhalb der app-eigenen Wurzeln', async () => {
    const before_ = fs.readFileSync(path.join(outsideDir, 'victim.csv'), 'utf8');

    const del = await csv.deleteEvent({
      fileName: path.join(outsideDir, 'victim.csv'),
      rowIndex: 0,
      expectedTitle: OUTSIDE_VICTIM,
    });
    assert.equal(del.success, false, 'Löschen eines absoluten Fremdpfads muss scheitern');

    const viaTraversal = await csv.deleteEvent({
      fileName: '../outside/victim.csv',
      rowIndex: 0,
      expectedTitle: OUTSIDE_VICTIM,
    });
    assert.equal(viaTraversal.success, false, 'Löschen per Traversal muss scheitern');

    assert.equal(fs.readFileSync(path.join(outsideDir, 'victim.csv'), 'utf8'), before_, 'fremde Datei unverändert');
  });

  it('löscht weiterhin reguläre app-eigene Zeilen', async () => {
    const listed = await csv.listFiles();
    const target = listed.find((f) => f.fileName === 'inside-events-data.csv');
    assert.ok(target, 'inside-events-data.csv muss gelistet werden');

    const events = await csv.loadEvents([target!.fileName]);
    assert.equal(events.length, 1);
    assert.equal(events[0].fileName, 'inside-events-data.csv');

    const del = await csv.deleteEvent({
      fileName: events[0].fileName,
      rowIndex: events[0].rowIndex,
      expectedTitle: events[0].title,
      expectedDetailUrl: events[0].detailUrl,
    });
    assert.equal(del.success, true, `Löschen muss klappen: ${del.error ?? ''}`);
    assert.equal((await csv.loadEvents([target!.fileName])).length, 0);
  });

  it('weist ungültige Zeilenindizes ab, ohne die Datei zu beschädigen', async () => {
    const fileName = 'inside-events-data.csv';
    const before_ = fs.readFileSync(path.join(dataDir, fileName), 'utf8');

    for (const rowIndex of [Number.NaN, -1, 1.5, '0' as unknown as number]) {
      const del = await csv.deleteEvent({ fileName, rowIndex, expectedTitle: INSIDE_VICTIM });
      assert.equal(del.success, false, `muss scheitern: ${String(rowIndex)}`);
    }

    assert.equal(fs.readFileSync(path.join(dataDir, fileName), 'utf8'), before_, 'Datei unverändert');
  });

  it('verweigert showInFolder-Ziele ausserhalb der Wurzeln', () => {
    // Der Handler in main.ts gibt `resolveCsvFile` nur bei `ok` an shell.showItemInFolder weiter.
    for (const candidate of [path.join(outsideDir, 'victim.csv'), '../outside/victim.csv']) {
      assert.equal(paths.resolveCsvFile(candidate).ok, false);
    }
    assert.equal(paths.resolveCsvFile('inside-events-data.csv').ok, true);
  });
});
