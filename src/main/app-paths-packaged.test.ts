/**
 * Die gepackte App darf ihr Arbeitsverzeichnis nicht in ihr eigenes Bundle legen.
 *
 * Genau das tat sie vorher: `repoRoot` und `dataDir` landeten in
 * `/Applications/Event Creator.app/Contents/Resources/`. Jedes Update ersetzt
 * dieses Verzeichnis, wodurch der gesamte Terminbestand verschwand – und das
 * Schreiben darin bricht ausserdem die Codesignatur des Bundles.
 *
 * Diese Suite baut ein Bundle nach, lässt die Auflösung laufen und prüft, dass
 * alles Schreibbare im `userData`-Arbeitsordner des Nutzers landet.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { app } from 'electron';

import { AppPaths } from './app-paths.js';
import { RollbackManager } from './rollback-manager.js';
import { SkillLoader } from './skill-loader.js';

const CSV_HEADER =
  'Titel,Beschreibung,Startdatum,Enddatum,Startzeit,Endzeit,Veranstaltungsort,Kategorien,Preis,Tickets,E-Mail,Telefon,Webseite,Social Media,Bild-URL,Detail-URL';

let sandbox: string;
let bundleResources: string;
let bundleData: string;
let userData: string;
let paths: AppPaths;

const savedEnv = {
  repoRoot: process.env.EVENT_CREATOR_REPO_ROOT,
  dataDir: process.env.EVENT_CREATOR_DATA_DIR,
  resourcesPath: process.resourcesPath,
};

/** `process.resourcesPath` ist in den Typen readonly, zur Laufzeit nicht. */
const proc = process as unknown as { resourcesPath: string };

before(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'app-paths-packaged-'));

  // `/…/Event Creator.app/Contents/Resources` – genau die Form eines echten Bundles.
  bundleResources = path.join(sandbox, 'Event Creator.app', 'Contents', 'Resources');
  bundleData = path.join(bundleResources, 'data');
  fs.mkdirSync(path.join(bundleResources, 'skills', 'csv-handling'), { recursive: true });
  fs.mkdirSync(bundleData, { recursive: true });

  // Die mitgelieferten Ressourcen, die eine gepackte App ausliefert.
  fs.writeFileSync(path.join(bundleResources, 'csv-import-check.js'), 'console.log("OK: 0/0");\n', 'utf8');
  fs.writeFileSync(
    path.join(bundleResources, 'skills', 'csv-handling', 'SKILL.md'),
    '# csv-handling\nGemeinsame Regeln.\n',
    'utf8'
  );

  // Eine CSV, die ein früherer Lauf in Bundle `data/` abgelegt hat.
  fs.writeFileSync(
    path.join(bundleData, 'bundle-events-data-2026-01-01.csv'),
    `${CSV_HEADER}\n"Im Bundle",B,2026-12-01,,20:00,,"Nürnberg",Kultur,,nein,,,,,,https://t.de/1\n`,
    'utf8'
  );

  userData = app.getPath('userData');
  delete process.env.EVENT_CREATOR_REPO_ROOT;
  delete process.env.EVENT_CREATOR_DATA_DIR;
  proc.resourcesPath = bundleResources;

  paths = new AppPaths();
});

after(() => {
  if (savedEnv.repoRoot === undefined) delete process.env.EVENT_CREATOR_REPO_ROOT;
  else process.env.EVENT_CREATOR_REPO_ROOT = savedEnv.repoRoot;
  if (savedEnv.dataDir === undefined) delete process.env.EVENT_CREATOR_DATA_DIR;
  else process.env.EVENT_CREATOR_DATA_DIR = savedEnv.dataDir;
  proc.resourcesPath = savedEnv.resourcesPath;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('gepackte App: Arbeitsordner', () => {
  it('legt repoRoot und dataDir ausserhalb des Bundles ab', () => {
    const inBundle = (p: string) => p === bundleResources || p.startsWith(bundleResources + path.sep);
    assert.equal(inBundle(paths.repoRoot), false, `repoRoot liegt im Bundle: ${paths.repoRoot}`);
    assert.equal(inBundle(paths.dataDir), false, `dataDir liegt im Bundle: ${paths.dataDir}`);
    assert.equal(paths.repoRoot, path.join(userData, 'workspace'));
    assert.equal(paths.dataDir, path.join(userData, 'workspace', 'data'));
  });

  it('spiegelt die mitgelieferten Ressourcen in den Arbeitsordner', () => {
    // Die Agent-Skills verweisen auf `skills/…` und `csv-import-check.js`
    // relativ zum Arbeitsverzeichnis – ohne diese Kopien laufen die Läufe blind.
    assert.ok(fs.existsSync(path.join(paths.repoRoot, 'csv-import-check.js')));
    assert.equal(
      fs.readFileSync(path.join(paths.repoRoot, 'csv-import-check.js'), 'utf8'),
      'console.log("OK: 0/0");\n'
    );
    assert.equal(
      fs.readFileSync(path.join(paths.repoRoot, 'skills', 'csv-handling', 'SKILL.md'), 'utf8'),
      '# csv-handling\nGemeinsame Regeln.\n'
    );
  });

  it('liest und schreibt nicht mehr im Bundle', () => {
    for (const root of paths.csvRoots) {
      assert.notEqual(root, path.join(bundleResources, 'data'), 'Bundle-data darf keine Wurzel mehr sein');
    }
    assert.equal(paths.resolveCsvFile('bundle-events-data-2026-01-01.csv').ok, false);
  });

  it('erkennt Termine im eigenen Arbeitsordner', () => {
    fs.writeFileSync(
      path.join(paths.dataDir, 'workspace-events-data-2026-09-30.csv'),
      `${CSV_HEADER}\n"Im Arbeitsordner",B,2026-12-01,,20:00,,"Nürnberg",Kultur,,nein,,,,,,https://t.de/2\n`,
      'utf8'
    );
    const resolved = paths.resolveCsvFile('workspace-events-data-2026-09-30.csv');
    assert.equal(resolved.ok, true);
    assert.equal(
      (resolved as { filePath: string }).filePath,
      fs.realpathSync(path.join(paths.dataDir, 'workspace-events-data-2026-09-30.csv'))
    );
  });

  it('zeigt auch Skills, die der Agent im Arbeitsordner anlegt', () => {
    // Der Agent legt neue Quellen neben den mitgelieferten Skills an. Landen
    // die nur im Arbeitsordner, wären sie in der Quellenliste unsichtbar.
    const skillDir = path.join(paths.repoRoot, 'skills', 'agent-neue-quelle-scraper');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: Agent Neue Quelle\ndescription: Vom Agenten angelegt.\n---\n\n# scraping\n',
      'utf8'
    );

    const ids = new SkillLoader().listSkills().map((s) => s.id);
    assert.ok(ids.includes('agent-neue-quelle-scraper'), `Quellenliste: ${ids.join(', ')}`);

    fs.rmSync(skillDir, { recursive: true, force: true });
  });
});

describe('RollbackManager: nur CSV sind Bestand', () => {
  it('meldet Hilfsskripte des Agenten nicht als gespeicherte Datei', () => {
    const dataDir = path.join(sandbox, 'rollback-data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'vorhanden-events-data.csv'), `${CSV_HEADER}\n"Alt",B,2026-12-01\n`, 'utf8');

    const rm = new RollbackManager(dataDir);
    rm.takeSnapshot();

    // Der Agent legt beim Scrapen Hilfsskripte und Batches in `data/` ab.
    fs.writeFileSync(path.join(dataDir, 'build-csv.mjs'), 'console.log(1)\n'.repeat(40), 'utf8');
    fs.writeFileSync(path.join(dataDir, '.batch.json'), '{"a":1}', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'neu-events-data-2026-09-30.csv'), `${CSV_HEADER}\n"Neu",B,2026-12-02\n`, 'utf8');

    const changed = rm.getModifiedFiles().map((f) => path.basename(f)).sort();
    assert.deepEqual(changed, ['neu-events-data-2026-09-30.csv']);

    // Der Rollback darf die Hilfsdatei des Agenten nicht als Nutzerbestand löschen …
    rm.rollback();
    assert.equal(fs.existsSync(path.join(dataDir, 'build-csv.mjs')), true, 'Hilfsskript gehört dem Agenten');
    // … die echte CSV aber verywohl zurücksetzen.
    assert.equal(fs.existsSync(path.join(dataDir, 'neu-events-data-2026-09-30.csv')), false);
  });
});
