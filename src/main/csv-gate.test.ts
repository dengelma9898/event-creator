import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { AppPaths } from './app-paths.js';
import { CsvService } from './csv-service.js';
import { IMPORT_RULES, describeRemaining, runImportGate } from './csv-gate.js';
import { RollbackManager } from './rollback-manager.js';

let sandbox: string;
let dataDir: string;
let csv: CsvService;
let paths: AppPaths;

// Die Suite läuft aus einem temporären Bündelordner, in dem es kein
// `csv-import-check.js` gibt. Deshalb wird die Repo-Wurzel hier ausdrücklich
// gesucht und als `EVENT_CREATOR_REPO_ROOT` gesetzt – danach ist `AppPaths`
// wieder die einzige Quelle der Wahrheit.
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

async function firstFutureEvent(fileName: string) {
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const minStart = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`;
  const events = await csv.loadEvents([fileName]);
  const ev = events.find((e) => e.startDate >= minStart) ?? events[0];
  assert.ok(ev, `${fileName} enthält keine Events`);
  return ev;
}

before(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-gate-test-'));
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

describe('Regelkatalog', () => {
  it('ordnet jede Ausgabezeile des Prüfers einer benannten Regel zu', () => {
    const samples = [
      'Header contains BOM (Titel must be plain ASCII)',
      'First header column is "Title" instead of "Titel"',
      'File contains 51 entries (maximum allowed is 50 entries per CSV)',
      'Line 3: 16 columns (expected 17)',
      'Line 4: Titel is empty',
      'Line 5: invalid Kategorien "Blödsinn"',
      'Line 6: Startdatum "2020-01-01" is in the past (today is 2026-09-27)',
      'Line 7: Startdatum "2026-09-30" is before the earliest allowed date (tomorrow = 2026-10-01)',
    ];
    for (const sample of samples) {
      const rule = IMPORT_RULES.find((r) => r.match(sample));
      assert.ok(rule, `keine Regel erkannt für: ${sample}`);
    }
  });

  it('erkennt Events von heute als Verstoß (Startdatum frühestens morgen)', async () => {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const fileName = 'heute-event-events-data.csv';
    const header = 'Titel,Startdatum,Kategorien';
    fs.writeFileSync(
      path.join(dataDir, fileName),
      `${header}\nEvent von heute,${todayIso},Kultur\n`,
      'utf8'
    );
    const gate = await runImportGate(paths.csvCheckScript, paths.repoRoot, path.join(dataDir, fileName));
    assert.equal(gate.ran, true);
    assert.ok(gate.violations.some((v) => v.ruleId === 'past-event'), 'Event von heute muss past-event Verstoß auslösen');
  });

  it('hält die Zusammenfassung des Prüfers für keinen Verstoß', async () => {
    const fileName = seed(repoFile('curt-events-data.csv'));
    const gate = await runImportGate(paths.csvCheckScript, paths.repoRoot, path.join(dataDir, fileName));
    assert.equal(gate.ran, true, `der Prüfer lief nicht: ${JSON.stringify(gate)}`);
    // curt liegt genau auf der Kappgrenze von 15 – nur dann gibt es die Zusammenfassung.
    assert.ok(gate.violations.length >= 15, `curt braucht den Fall überhaupt erst: ${gate.violations.length}`);
    assert.ok(
      !gate.violations.some((v) => v.ruleId === 'unknown'),
      `die "... N more issue(s)"-Zeile wurde als Verstoß gezählt: ${JSON.stringify(gate.violations)}`
    );
  });

  it('meldet einen nicht gelaufenen Prüfer, statt „sauber“ zu behaupten', async () => {
    const gate = await runImportGate(
      path.join(dataDir, 'gibt-es-nicht.js'),
      paths.repoRoot,
      path.join(dataDir, 'franmeisters-events-data.csv')
    );
    assert.equal(gate.ran, false);
    assert.equal(gate.violations.length, 0);
    assert.match(describeRemaining(gate), /konnte nicht geprüft werden/);
  });

  it('nennt die verbleibenden Regeln auf Deutsch, ohne Rohzeilen', () => {
    const text = describeRemaining({ ran: true, violations: [{ ruleId: 'past-event' }] });
    assert.ok(text.includes('Vergangenheit'));
    assert.ok(!/Line \d|columns \(expected/.test(text), 'Rohzeilen des Prüfers im Anwendersatz');
  });

  it('schweigt, wenn die Datei sauber ist', () => {
    assert.equal(describeRemaining({ ran: true, violations: [] }), '');
  });
});

describe('Löschen wird auf die bearbeitete Datei begrenzt', () => {
  it('löscht einen anstehenden Termin und lässt alle übrigen Zeilen unverändert', async () => {
    const fileName = seed(repoFile('franmeisters-events-data.csv'));
    const target = path.join(dataDir, fileName);

    const beforeText = fs.readFileSync(target, 'utf8');
    const beforeRows = csv.parseCsv(beforeText) as string[][];

    const victim = await firstFutureEvent(fileName);
    const res = await csv.deleteEvent({
      fileName,
      rowIndex: victim.rowIndex,
      expectedTitle: victim.title,
      expectedDetailUrl: victim.detailUrl,
    });

    assert.equal(res.success, true, `Löschen muss klappen: ${res.error ?? ''}`);
    assert.equal(res.fileUnchanged, false);

    const afterRows = csv.parseCsv(fs.readFileSync(target, 'utf8')) as string[][];
    const expected = [...beforeRows.slice(0, victim.rowIndex + 1), ...beforeRows.slice(victim.rowIndex + 2)];
    assert.equal(afterRows.length, expected.length);
    assert.deepEqual(afterRows, expected, 'eine übrige Zeile hat sich verändert');
    // Der Titel kommt in franmeisters mehrfach vor – entscheidend ist, dass es
    // genau eine Zeile weniger mit diesem Titel ist, nicht dass keine mehr da ist.
    const count = (rows: string[][]) => rows.slice(1).filter((r) => r[0] === victim.title).length;
    assert.equal(count(afterRows), count(beforeRows) - 1);
  });

  it('lässt eine fremde, defekte Datei die Löschung nicht blockieren', async () => {
    const fileName = seed(repoFile('curt-events-data.csv'));
    fs.writeFileSync(path.join(dataDir, 'zz-defekt-events-data.csv'), 'nur, ein, Spalte\n1,2,3\n', 'utf8');

    const beforeRows = (csv.parseCsv(fs.readFileSync(path.join(dataDir, fileName), 'utf8')) as string[][]).length;
    const victim = await firstFutureEvent(fileName);

    const res = await csv.deleteEvent({
      fileName,
      rowIndex: victim.rowIndex,
      expectedTitle: victim.title,
      expectedDetailUrl: victim.detailUrl,
    });

    assert.equal(res.success, true, `darf nicht von der fremden Datei blockiert werden: ${res.error ?? ''}`);
    const afterRows = (csv.parseCsv(fs.readFileSync(path.join(dataDir, fileName), 'utf8')) as string[][]).length;
    assert.equal(afterRows, beforeRows - 1);
  });

  it('meldet ehrlich, dass der Rest der Datei noch Verstöße hat', async () => {
    const fileName = seed(repoFile('franmeisters-events-data.csv'));
    const victim = await firstFutureEvent(fileName);

    const res = await csv.deleteEvent({
      fileName,
      rowIndex: victim.rowIndex,
      expectedTitle: victim.title,
      expectedDetailUrl: victim.detailUrl,
    });

    assert.equal(res.success, true);
    // franmeisters enthält im Repo bereits vergangene Termine – die müssen benannt werden.
    assert.match(res.notice ?? '', /Vergangenheit/);
    assert.ok(!/Line \d|expected \d+\)/.test(res.notice ?? ''), 'Prüfer-Interna im Hinweis');
  });

  it('schweigt über den Hinweis, wenn die Datei danach sauber ist', async () => {
    const fileName = 'sauber-events-data.csv';
    const header = 'Titel,Startdatum,Kategorien';
    fs.writeFileSync(
      path.join(dataDir, fileName),
      `${header}\nEin Termin,2099-01-01,Kultur\nNoch einer,2099-02-01,Musik & Nightlife\n`,
      'utf8'
    );

    const res = await csv.deleteEvent({ fileName, rowIndex: 1, expectedTitle: 'Noch einer' });
    assert.equal(res.success, true, res.error ?? '');
    assert.ok(!res.notice, `die Datei ist sauber, es darf kein Hinweis kommen: ${res.notice}`);
  });
});

describe('Zurückrollen', () => {
  it('stellt den Originalzustand exakt wieder her', () => {
    const dir = path.join(sandbox, 'rollback');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'x-events-data.csv');
    const original = 'Titel,Startdatum\r\nA,2026-12-01\r\nB,2026-12-02\r\n';
    fs.writeFileSync(file, original, 'utf8');

    const manager = new RollbackManager(dir);
    manager.takeSnapshot();

    const extra = path.join(dir, 'neu-events-data.csv');
    fs.writeFileSync(extra, 'Titel\nC\n', 'utf8');
    fs.writeFileSync(file, 'Titel,Startdatum\r\nB,2026-12-02\r\n', 'utf8');

    manager.rollback();

    assert.equal(fs.readFileSync(file, 'utf8'), original, 'Datei nicht exakt wiederhergestellt');
    assert.equal(fs.existsSync(extra), false, 'neue Datei nicht entfernt');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Abweisung', () => {
  it('lässt eine Löschung zu, die eine echte Verletzung erzeugt, nicht zu', async () => {
    // Zwei Zeilen mit 17 Spalten, eine mit 3 – die defekte bleibt nach dem Löschen
    // defekt, die Löschung selbst ist aber legal.
    const fileName = 'gemischt-events-data.csv';
    const good = Array.from({ length: 17 }, (_, i) => (i === 0 ? 'Titel' : i === 1 ? 'Startdatum' : `S${i}`)).join(',');
    fs.writeFileSync(
      path.join(dataDir, fileName),
      `${good}\nGut,2099-01-01,${Array(15).fill('x').join(',')}\nKaputt,2099-01-02,a,b\nNoch gut,2099-01-03,${Array(15).fill('y').join(',')}\n`,
      'utf8'
    );

    const res = await csv.deleteEvent({ fileName, rowIndex: 2, expectedTitle: 'Noch gut' });
    assert.equal(res.success, true, res.error ?? '');
    // Der verbleibende Verstoß wird benannt, aber nicht als Löschfehler gemeldet.
    assert.match(res.notice ?? '', /Spalten/);
  });

  it('verweigert zu raten, wenn die Suche mehrere Treffer findet', async () => {
    // franmeisters enthält „DIY Saturday – Bastelspaß am Samstag“ zwölfmal.
    const fileName = seed(repoFile('franmeisters-events-data.csv'));
    const target = path.join(dataDir, fileName);
    const before = fs.readFileSync(target, 'utf8');

    const events = await csv.loadEvents([fileName]);
    const victim = events.find((e) => e.title === 'DIY Saturday – Bastelspaß am Samstag');
    assert.ok(victim, 'Zieldatum nicht in den echten Daten');

    // Absichtlich nur der Titel: er kommt zwölfmal vor und die Detail-URL ist bei
    // allen leer. Der Index ist veraltet, also bleibt nur der Titel – und der
    // reicht nicht. Vorher hat der Code hier einfach den ersten Treffer gelöscht.
    const res = await csv.deleteEvent({
      fileName,
      rowIndex: victim.rowIndex + 5,
      expectedTitle: victim.title,
    });

    assert.equal(res.success, false, 'ein nicht eindeutiger Treffer darf nicht gelöscht werden');
    assert.match(res.error ?? '', /identische Zeilen/);
    assert.equal(fs.readFileSync(target, 'utf8'), before, 'die Datei wurde trotzdem angefasst');
  });

  it('löscht genau dieeine passende Zeile, auch wenn der Titel mehrfach vorkommt', async () => {
    const fileName = seed(repoFile('franmeisters-events-data.csv'));
    const target = path.join(dataDir, fileName);
    const events = await csv.loadEvents([fileName]);
    const victim = events.find((e) => e.title === 'DIY Saturday – Bastelspaß am Samstag')!;

    const res = await csv.deleteEvent({
      fileName,
      rowIndex: victim.rowIndex,
      expectedTitle: victim.title,
      expectedDetailUrl: victim.detailUrl,
      expectedStartDate: victim.startDate,
    });

    assert.equal(res.success, true, res.error ?? '');
    const after = (csv.parseCsv(fs.readFileSync(target, 'utf8')) as string[][]).slice(1);
    const sameTitle = after.filter((r) => r[0] === victim.title);
    assert.equal(sameTitle.length, 11);
    assert.ok(
      !sameTitle.some((r) => r[1] === victim.startDate),
      `genau diese Zeile (${victim.startDate}) hätte entfernt werden müssen`
    );
  });

  it('verweigert einen Zeilenindex, der nicht auf die erwartete Zeile zeigt', async () => {
    const fileName = seed(repoFile('franmeisters-events-data.csv'));
    const victim = await firstFutureEvent(fileName);
    const target = path.join(dataDir, fileName);
    const before = fs.readFileSync(target, 'utf8');

    const res = await csv.deleteEvent({
      fileName,
      rowIndex: victim.rowIndex,
      expectedTitle: 'Ein ganz anderer Titel',
      expectedDetailUrl: 'https://example.com/falsch',
    });

    assert.equal(res.success, false);
    assert.equal(res.fileUnchanged, true);
    assert.equal(fs.readFileSync(target, 'utf8'), before, 'die Datei wurde trotzdem angefasst');
  });
});
