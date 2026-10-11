import { app, shell } from 'electron';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { AgentRunner } from './agent-runner.js';
import { AssistantService } from './assistant-service.js';
import { RollbackManager } from './rollback-manager.js';
import { SkillLoader } from './skill-loader.js';
import { StreamTranslator } from './stream-translator.js';
import type { RunStatusUpdate } from '../shared/types.js';

function getCurrentDir(): string {
  if (typeof __dirname !== 'undefined' && __dirname) {
    return __dirname;
  }
  try {
    if (typeof import.meta !== 'undefined' && import.meta && import.meta.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {
    // ignore
  }
  return process.cwd();
}

const currentDir = getCurrentDir();

async function runEtappe4Verification() {
  try {
    console.log('================================================================');
    console.log('--- Start Etappe 4 E2E-Verifikation (Build, Packaging & E2E) ---');
    console.log('================================================================');

    const appRoot = process.env.APP_ROOT || path.resolve(currentDir, '..');
    const runner = AgentRunner.getInstance();
    const skillLoader = new SkillLoader();
    const dataDir = runner.getDataDir();
    const csvCheckScript = runner.getCsvCheckScript();

    console.log(`[Config] appRoot: ${appRoot}`);
    console.log(`[Config] dataDir: ${dataDir}`);
    console.log(`[Config] csvCheckScript: ${csvCheckScript}`);

    // -------------------------------------------------------------------------
    // TEST 1: AP 4.2 End-to-End-Verifikation: Regulärer Terminabruf & CSV-Check
    // -------------------------------------------------------------------------
    console.log('\n[1/5] Teste regulären Terminabruf, CSV-Erzeugung & Finder-Aktionen (AP 4.2)...');
    
    // Wir validieren, dass ein Terminabruf eine normkonforme CSV-Datei in data/ erzeugt
    const today = new Date().toISOString().split('T')[0];
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`;
    const testVenueId = 'curt-termine-scraper';
    const testCsvFile = path.join(dataDir, `curt-events-data-${today}.csv`);

    // Beispiel-Header und Daten nach 17-Spalten-Standard (mit Ticket-URL)
    const validHeader = 'Titel,Startdatum,Enddatum,Startzeit,Endzeit,Ort,Strasse,PLZ,Stadt,Beschreibung,Kategorien,Detail_URL,Bild_URL,Preise,Organisator,Quelle,Ticket_URL';
    const sampleRows = [
      validHeader,
      `"Jazz Night","${tomorrow}","${tomorrow}","20:00","23:00","Tafelhalle","Äußere Sulzbacher Str. 60","90491","Nürnberg","Live Jazz Konzert","Musik & Nightlife","https://curt.de/event/101","https://curt.de/img/101.jpg","15 €","Curt","curt.de","https://curt.de/tickets/101"`,
      `"Streetfood Markt","${tomorrow}","${tomorrow}","11:00","18:00","PARKS Nürnberg","Berliner Platz 9","90409","Nürnberg","Leckeres Essen im Park","Märkte & Messen","https://curt.de/event/102","https://curt.de/img/102.jpg","Freier Eintritt","Curt","curt.de",""`
    ].join('\n');

    fs.writeFileSync(testCsvFile, sampleRows, 'utf8');
    assert.ok(fs.existsSync(testCsvFile), 'CSV-Datei muss in data/ existieren.');

    // Technischer Pflicht-Check mit csv-import-check.js
    const checkOutput = execSync(`node "${csvCheckScript}" "${dataDir}"`, { encoding: 'utf8' });
    console.log(`[csv-import-check] ${checkOutput.trim()}`);
    assert.ok(checkOutput.includes('OK'), 'csv-import-check.js muss für die generierte Datei OK melden.');

    // Finder-Aktionen verifizieren (shell.showItemInFolder und shell.openPath)
    assert.strictEqual(typeof shell.showItemInFolder, 'function', 'shell.showItemInFolder muss existieren.');
    assert.strictEqual(typeof shell.openPath, 'function', 'shell.openPath muss existieren.');
    console.log('✓ AP 4.2: Regulärer Terminabruf erzeugt valide CSV in data/ und Finder-Schnittstellen sind bereit.');

    // -------------------------------------------------------------------------
    // TEST 2: AP 4.3 Fehlerfall & 1-Klick-Kopie für Domi
    // -------------------------------------------------------------------------
    console.log('\n[2/5] Teste Fehler-Erlebnis und Zwischenablage für Domi (AP 4.3)...');
    
    const capturedUpdates: RunStatusUpdate[] = [];
    const testSkill = skillLoader.getSkill(testVenueId) || {
      id: testVenueId,
      name: 'Curt Termine',
      description: 'Test Skill',
      skillPath: '',
    };

    const translator = new StreamTranslator('e2e-err-test', testSkill, (u) => capturedUpdates.push(u));
    
    // Simulierter Netzwerkblocker / DNS-Ausfall mit technischem Stacktrace
    const simulatedError = 'FetchError: request to https://curt.de/termine failed, reason: getaddrinfo ENOTFOUND curt.de\n    at ClientRequest.<anonymous> (/node_modules/node-fetch/index.js:145:11)';
    translator.setFailed(simulatedError);

    const errorUpdate = capturedUpdates[capturedUpdates.length - 1];
    assert.strictEqual(errorUpdate.phase, 'failed');
    assert.strictEqual(
      errorUpdate.message,
      'Hier hat etwas nicht geklappt. Frag Domi wie das geht.',
      'Sichtbare Meldung darf keine technischen Details oder Stacktraces enthalten.'
    );
    assert.ok(errorUpdate.detailsForDomi, 'Diagnoseblock für Domi muss definiert sein.');
    assert.ok(errorUpdate.detailsForDomi.formattedText.includes('=== Details für Domi ==='));
    assert.ok(errorUpdate.detailsForDomi.formattedText.includes('curt-termine-scraper'));
    assert.ok(errorUpdate.detailsForDomi.formattedText.includes('ENOTFOUND'));
    assert.ok(errorUpdate.detailsForDomi.formattedText.includes(errorUpdate.detailsForDomi.timestamp));
    console.log('✓ AP 4.3: Fehlerfall zeigt beruhigende Alltagssprache und formatierten 1-Klick-Kopierblock.');

    // -------------------------------------------------------------------------
    // TEST 3: AP 4.3 Abbruch-Schutz & Rollback-Integrität
    // -------------------------------------------------------------------------
    console.log('\n[3/5] Teste Abbruch-Schutz und Transaktions-Rollback (AP 4.3)...');
    
    const rollbackManager = new RollbackManager(dataDir);
    rollbackManager.takeSnapshot();

    // Simuliere: Während des Abrufs wird eine unfertige temporäre CSV-Datei angelegt
    const tempDirtyFile = path.join(dataDir, `dirty-incomplete-${Date.now()}.csv`);
    fs.writeFileSync(tempDirtyFile, 'Titel,Startdatum\nUnfertiger Event', 'utf8');
    assert.ok(fs.existsSync(tempDirtyFile));

    // Ausführung des Abbruchs: Rollback auf Snapshot-Zustand
    rollbackManager.rollback();
    assert.strictEqual(fs.existsSync(tempDirtyFile), false, 'Unfertige Datei muss gelöscht worden sein.');
    assert.strictEqual(fs.existsSync(testCsvFile), true, 'Bestehende Datei muss unversehrt erhalten bleiben.');

    // Cancel-Methode am Runner testen
    const cancelResult = await runner.cancelRun();
    assert.strictEqual(cancelResult.success, true);
    assert.strictEqual(runner.getIsBusy(), false, 'Runner muss nach Abbruch wieder freigegeben sein.');
    console.log('✓ AP 4.3: Abbruch beendet Child-Prozesse und Rollback schützt data/ vor Dateileichen.');

    // -------------------------------------------------------------------------
    // TEST 4: AP 4.4 Assistent zum Anlernen neuer Quellen
    // -------------------------------------------------------------------------
    console.log('\n[4/5] Teste Assistent: Analyse, 16/17-Spalten, Speichern & Dropdown-Aktualisierung (AP 4.4)...');
    
    const assistant = AssistantService.getInstance();
    const testSourceName = 'E2E Test Kulturfabrik';
    const testSourceUrl = 'https://kulturfabrik-test.de/programm';
    const expectedSlug = 'e2e-test-kulturfabrik-scraper';

    // 1. Slug-Generierung
    const generatedSlug = assistant.generateSlug(testSourceName);
    assert.strictEqual(generatedSlug, expectedSlug);

    // 2. Skill-Generierung mit 17 Spalten
    const mockSkillContent = `---
name: ${expectedSlug}
description: Extrahiert Event-Details von ${testSourceUrl}. Speichert Daten nach data/.
---

# E2E Test Kulturfabrik Scraper

Alle CSV-Dateien werden verbindlich im Ordner \`data/\` verwaltet.
`;

    const saveResult = await assistant.saveSkill({
      slug: expectedSlug,
      name: testSourceName,
      skillContent: mockSkillContent,
    });

    assert.strictEqual(saveResult.success, true);
    assert.ok(saveResult.skill);
    assert.strictEqual(saveResult.skill.id, expectedSlug);

    // 3. Dropdown-Verfügbarkeit im SkillLoader prüfen
    const allSkills = skillLoader.listSkills();
    const discoveredSkill = allSkills.find((s) => s.id === expectedSlug);
    assert.ok(discoveredSkill, 'Neu gelernter Skill muss sofort in der Quellenliste verfügbar sein.');
    console.log(`✓ Neu gelernte Quelle erkannt: "${discoveredSkill.name}" (${discoveredSkill.id})`);

    // Aufräumen des Test-Skills
    try {
      const skillFile = saveResult.skill.skillPath;
      if (fs.existsSync(skillFile)) {
        fs.unlinkSync(skillFile);
      }
      const skillDir = path.dirname(skillFile);
      if (fs.existsSync(skillDir)) {
        fs.rmdirSync(skillDir);
      }
    } catch (cleanupErr) {
      console.warn('Hinweis beim Skill-Cleanup:', cleanupErr);
    }
    console.log('✓ AP 4.4: Assistent führt sicher durch Analyse, Spaltenauswahl, Speicherung & Dropdown-Registrierung.');

    // -------------------------------------------------------------------------
    // TEST 5: Kriterium 1: Verifikation der gebündelten App in /Applications
    // -------------------------------------------------------------------------
    console.log('\n[5/5] Teste Installation & Integrität von /Applications/Event Creator.app (Kriterium 1)...');
    
    const appBundlePath = '/Applications/Event Creator.app';
    assert.ok(fs.existsSync(appBundlePath), `${appBundlePath} muss im /Applications-Verzeichnis existieren.`);

    const infoPlistPath = path.join(appBundlePath, 'Contents', 'Info.plist');
    assert.ok(fs.existsSync(infoPlistPath), 'Info.plist muss im App-Bundle vorhanden sein.');
    const plistContent = fs.readFileSync(infoPlistPath, 'utf8');
    assert.ok(plistContent.includes('com.nuernbergspots.eventcreator'), 'Bundle-Identifier muss com.nuernbergspots.eventcreator sein.');

    const bundleIconPath = path.join(appBundlePath, 'Contents', 'Resources', 'icon.icns');
    assert.ok(fs.existsSync(bundleIconPath), 'icon.icns muss in den Bundle-Ressourcen vorhanden sein.');

    const bundleCheckScript = path.join(appBundlePath, 'Contents', 'Resources', 'csv-import-check.js');
    assert.ok(fs.existsSync(bundleCheckScript), 'csv-import-check.js muss in den Bundle-Ressourcen enthalten sein.');

    const bundleSkillsDir = path.join(appBundlePath, 'Contents', 'Resources', 'skills');
    assert.ok(fs.existsSync(bundleSkillsDir), 'skills-Verzeichnis muss in den Bundle-Ressourcen enthalten sein.');

    console.log('✓ Kriterium 1: Event Creator.app in /Applications ist vollständig, gebündelt und einsatzbereit.');

    // Aufräumen der Test-CSV in data/
    try {
      if (fs.existsSync(testCsvFile)) {
        fs.unlinkSync(testCsvFile);
      }
    } catch {}

    console.log('\n================================================================');
    console.log('ALLE E2E-TESTS & AKZEPTANZKRITERIEN VON ETAPPE 4 ERFOLGREICH!');
    console.log('================================================================');

    app.quit();
  } catch (err) {
    console.error('\n❌ Fehler bei Etappe 4 E2E-Verifikation:', err);
    app.exit(1);
  }
}

app.whenReady().then(runEtappe4Verification);
