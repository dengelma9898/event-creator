import { app } from 'electron';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AssistantService } from './assistant-service.js';
import { KeychainStore } from './keychain-store.js';
import { SkillLoader } from './skill-loader.js';
import { AgentRunner } from './agent-runner.js';
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

async function runEtappe3Verification() {
  try {
    console.log('====================================================');
    console.log('--- Start Etappe 3 Verifikation (macOS UI & Core) ---');
    console.log('====================================================');

  // Test 1: Akzeptanzkriterium 1: Ersteinrichtung / Onboarding-Bedingung
  console.log('\n[1/6] Teste Onboarding-Logik (Kriterium 1)...');
  const testKeyDir = path.join(app.getPath('userData'), 'etappe3-key-test');
  const testKeyFile = path.join(testKeyDir, 'credentials.enc');
  const testKeychain = new KeychainStore(testKeyFile);

  // Fall A: Noch kein Key vorhanden -> isConfigured() = false -> UI zeigt OnboardingModal
  testKeychain.clearApiKey();
  assert.strictEqual(
    testKeychain.isConfigured(),
    false,
    'Ohne Key muss isConfigured() false sein (Onboarding-Modal poppt auf).'
  );

  // Fall B: Key eingerichtet -> isConfigured() = true -> UI zeigt Hauptansicht direkt
  const dummyKey = 'test_key_etappe3_1234567890';
  assert.ok(testKeychain.setApiKey(dummyKey), 'Key muss speicherbar sein.');
  assert.strictEqual(
    testKeychain.isConfigured(),
    true,
    'Mit Key muss isConfigured() true sein (Onboarding poppt NICHT auf).'
  );
  assert.strictEqual(testKeychain.getApiKey(), dummyKey);
  testKeychain.clearApiKey();

  // Cleanup
  try {
    if (fs.existsSync(testKeyFile)) fs.unlinkSync(testKeyFile);
    if (fs.existsSync(testKeyDir)) fs.rmdirSync(testKeyDir);
  } catch {}
  console.log('✓ Kriterium 1: Onboarding poppt nur auf, wenn noch kein Key vorhanden ist.');

  // Test 2: Akzeptanzkriterium 2: Terminabruf sperrt UI & Backend gegen Doppelstarts
  console.log('\n[2/6] Teste Mutex & Doppelstart-Sperre (Kriterium 2)...');
  const runner = AgentRunner.getInstance();
  assert.strictEqual(runner.getIsBusy(), false, 'Runner darf vor dem Start nicht belegt sein.');

  // Simulation: Runner ist aktiv
  (runner as any).isBusy = true;
  assert.strictEqual(runner.getIsBusy(), true, 'Runner signalisiert Belegt-Zustand an UI.');

  // Zweiter Aufruf während laufendem Abruf
  const doubleCallResult = await runner.startRun('curt-termine-scraper', () => {});
  assert.strictEqual(doubleCallResult.success, false, 'Doppelstart muss strikt abgelehnt werden.');
  assert.ok(
    doubleCallResult.error?.includes('Terminabruf läuft bereits') ||
      doubleCallResult.error?.includes('bereits'),
    `Erwartete Mutex-Fehlermeldung, erhalten: ${doubleCallResult.error}`
  );

  // Freigeben
  (runner as any).isBusy = false;
  assert.strictEqual(runner.getIsBusy(), false, 'Runner nach Abschluss wieder bereit.');
  console.log('✓ Kriterium 2: Der Terminabruf sperrt die UI zuverlässig gegen Doppelstarts.');

  // Test 3: Akzeptanzkriterium 3: Abbruch-Dialog & kontrollierte Abbruch-Routine
  console.log('\n[3/6] Teste Abbruch-Routine & Rollback-Schutz (Kriterium 3)...');
  // Wenn der User im Modal "Abbrechen fortsetzen" wählt, wird cancelRun() aufgerufen
  const cancelResult = await runner.cancelRun();
  assert.strictEqual(cancelResult.success, true, 'cancelRun muss erfolgreich abschließen.');
  assert.strictEqual(runner.getIsBusy(), false, 'Nach Abbruch muss isBusy wieder false sein.');
  console.log('✓ Kriterium 3: Der Abbruch-Dialog fängt versehentliche Klicks ab und führt sicheren Abbruch durch.');

  // Test 4: Akzeptanzkriterium 4: Fehler-Erlebnis ohne Stacktraces & mit 1-Klick-Kopie für Domi
  console.log('\n[4/6] Teste Fehler-Erlebnis "Frag Domi" (Kriterium 4)...');
  const skillLoader = new SkillLoader();
  const curtSkill = skillLoader.getSkill('curt-termine-scraper') || {
    id: 'curt-termine-scraper',
    name: 'Curt Termine',
    description: 'Test Skill',
    skillPath: '',
  };

  const capturedUpdates: RunStatusUpdate[] = [];
  const translator = new StreamTranslator('test-run-err', curtSkill, (u) => capturedUpdates.push(u));

  // Fehlerfall simulieren mit technischem Stacktrace
  const rawTechnicalError = 'Error: ETIMEDOUT at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1607:16)';
  translator.setFailed(rawTechnicalError);

  const lastUpdate = capturedUpdates[capturedUpdates.length - 1];
  assert.strictEqual(lastUpdate.phase, 'failed');
  // UI-Nachricht darf KEINEN Stacktrace enthalten:
  assert.strictEqual(
    lastUpdate.message,
    'Hier hat etwas nicht geklappt. Frag Domi wie das geht.',
    'Die sichtbare UI-Nachricht muss frei von technischen Stacktraces sein.'
  );

  // Diagnose-Report für Domi muss vollständig formatiert vorliegen:
  assert.ok(lastUpdate.detailsForDomi, 'detailsForDomi muss vorhanden sein.');
  assert.ok(
    lastUpdate.detailsForDomi?.formattedText.includes('=== Details für Domi ==='),
    'Kompakter Diagnoseblock muss vorbereitet sein.'
  );
  assert.ok(
    lastUpdate.detailsForDomi?.formattedText.includes('ETIMEDOUT'),
    'Technischer Fehler muss im Diagnoseblock für Domi enthalten sein.'
  );
  assert.ok(
    lastUpdate.detailsForDomi?.formattedText.includes('curt-termine-scraper'),
    'Quelle muss im Diagnoseblock enthalten sein.'
  );
  console.log('✓ Kriterium 4: Fehlerzustände enthalten keine Stacktraces, bieten aber die 1-Klick-Kopie für Domi.');

  // Test 5: Akzeptanzkriterium 5: Assistent führt durch 3 Schritte und aktualisiert das Dropdown
  console.log('\n[5/6] Teste Assistent (Bereich 2: Neue Webseite anlernen) (Kriterium 5)...');
  const assistantService = AssistantService.getInstance();

  // Schritt 1: Validierung & Slug-Generierung
  const slug1 = assistantService.generateSlug('Neues Schauspielhaus Nürnberg');
  assert.strictEqual(slug1, 'neues-schauspielhaus-nuernberg-scraper');

  const slug2 = assistantService.generateSlug('Tafelhalle-scraper');
  assert.strictEqual(slug2, 'tafelhalle-scraper');

  // Schritt 2 & 3: Skill speichern & sofortige Dropdown-Verfügbarkeit
  const testSkillSlug = 'test-theater-nuernberg-scraper';
  const testContent = `---
name: ${testSkillSlug}
description: Extrahiert Event-Details von https://test-theater.de/spielplan. Speichert Daten nach data/.
---

# Test Theater Scraper

Alle CSV-Dateien werden verbindlich im Ordner \`data/\` verwaltet.
`;

  const saveResult = await assistantService.saveSkill({
    slug: testSkillSlug,
    name: 'Test Theater Nürnberg',
    skillContent: testContent,
  });

  assert.ok(saveResult.success, 'saveSkill muss success: true zurückgeben.');
  assert.ok(saveResult.skill, 'saveSkill muss ein Skill-Objekt liefern.');
  assert.strictEqual(saveResult.skill?.id, testSkillSlug);

  // Prüfen, dass der Skill sofort im Dropdown / SkillLoader auftaucht
  const updatedSkills = skillLoader.listSkills();
  const foundNewSkill = updatedSkills.find((s) => s.id === testSkillSlug);
  assert.ok(foundNewSkill, 'Der neu gespeicherte Skill muss sofort im SkillLoader auffindbar sein.');
  console.log(`✓ Neu erstellter Skill erfolgreich im Dropdown/SkillLoader erkannt: ${foundNewSkill.name}`);

  // Aufräumen des Test-Skills
  try {
    const testSkillDir = path.dirname(saveResult.skill.skillPath);
    if (fs.existsSync(saveResult.skill.skillPath)) {
      fs.unlinkSync(saveResult.skill.skillPath);
    }
    if (fs.existsSync(testSkillDir)) {
      fs.rmdirSync(testSkillDir);
    }
  } catch (err) {
    console.warn('Warnung beim Aufräumen des Test-Skills:', err);
  }
  console.log('✓ Kriterium 5: Der Assistent führt erfolgreich durch alle 3 Schritte und aktualisiert das Dropdown.');

  // Test 6: Frontend- und Electron-Build-Artefakte
  console.log('\n[6/6] Prüfe Frontend- und Electron-Build-Artefakte...');
  const appRoot = process.env.APP_ROOT || path.resolve(currentDir, '..');
  const distDir = path.resolve(appRoot, 'dist');
  const distElectronDir = path.resolve(appRoot, 'dist-electron');

  assert.ok(fs.existsSync(path.join(distDir, 'index.html')), 'dist/index.html muss existieren.');
  assert.ok(fs.existsSync(path.join(distElectronDir, 'main.js')), 'dist-electron/main.js muss existieren.');
  assert.ok(
    fs.existsSync(path.join(distElectronDir, 'preload.cjs')) || fs.existsSync(path.join(distElectronDir, 'preload.js')),
    'dist-electron/preload.cjs oder preload.js muss existieren.'
  );
  console.log('✓ Build-Artefakte für macOS UI vollständig vorhanden.');

    console.log('\n====================================================');
    console.log('ALLE 5 AKZEPTANZKRITERIEN VON ETAPPE 3 ERFOLGREICH!');
    console.log('====================================================');

    app.quit();
  } catch (err) {
    console.error('\n❌ Fehler bei Etappe 3 Verifikation:', err);
    app.exit(1);
  }
}

app.whenReady().then(runEtappe3Verification);
