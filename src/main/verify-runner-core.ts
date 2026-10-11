import { app } from 'electron';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { KeychainStore } from './keychain-store.js';
import { RollbackManager } from './rollback-manager.js';
import { SkillLoader } from './skill-loader.js';
import { StreamTranslator } from './stream-translator.js';
import { AgentRunner } from './agent-runner.js';
import type { RunStatusUpdate } from '../shared/types.js';

async function runVerification() {
  console.log('--- Start Etappe 2 Verifikation ---');

  // Test 1: SkillLoader
  console.log('\n[1/5] Teste SkillLoader...');
  const skillLoader = new SkillLoader();
  const skills = skillLoader.listSkills();
  console.log(`Gefundene Skills: ${skills.length}`);
  for (const s of skills) {
    console.log(` - [${s.id}] ${s.name} (${s.domain || 'keine Domain'})`);
  }
  assert.strictEqual(skills.length, 12, 'Es müssen exakt 12 Venue-Skills geladen werden.');
  assert.ok(skills.some(s => s.id === 'curt-termine-scraper'), 'curt-termine-scraper fehlt.');
  assert.ok(skills.some(s => s.id === 'e-werk-scraper'), 'e-werk-scraper fehlt.');
  assert.ok(skills.some(s => s.id === 'z-bau-scraper'), 'z-bau-scraper fehlt.');
  console.log('✓ SkillLoader erfolgreich verifiziert.');

  // Test 2: KeychainStore (safeStorage)
  console.log('\n[2/5] Teste KeychainStore...');
  const testKeyDir = path.join(app.getPath('userData'), 'test-keychain');
  const testKeyFile = path.join(testKeyDir, 'credentials.enc');
  const keychainStore = new KeychainStore(testKeyFile);

  const encryptionAvailable = keychainStore.isEncryptionAvailable();
  console.log(`safeStorage.isEncryptionAvailable: ${encryptionAvailable}`);
  assert.ok(encryptionAvailable, 'safeStorage Verschlüsselung muss auf macOS verfügbar sein.');

  // Setzen & Prüfen
  const dummyKey = 'test-cur-key-1234567890abcdef';
  const saveSuccess = keychainStore.setApiKey(dummyKey);
  assert.ok(saveSuccess, 'Schlüssel muss gespeichert werden können.');
  assert.ok(keychainStore.isConfigured(), 'isConfigured muss true sein.');
  assert.strictEqual(keychainStore.getApiKey(), dummyKey, 'Entschlüsselter Schlüssel muss übereinstimmen.');

  // Löschen & Prüfen
  const clearSuccess = keychainStore.clearApiKey();
  assert.ok(clearSuccess, 'Schlüssel muss gelöscht werden können.');
  assert.strictEqual(keychainStore.isConfigured(), false, 'isConfigured muss nach Löschen false sein.');
  assert.strictEqual(keychainStore.getApiKey(), null, 'getApiKey muss null liefern.');

  // Cleanup Testordner
  try {
    if (fs.existsSync(testKeyFile)) fs.unlinkSync(testKeyFile);
    if (fs.existsSync(testKeyDir)) fs.rmdirSync(testKeyDir);
  } catch {}
  console.log('✓ KeychainStore erfolgreich verifiziert.');

  // Test 3: RollbackManager
  console.log('\n[3/5] Teste RollbackManager...');
  const testDataDir = path.join(app.getPath('temp'), 'event-creator-test-data');
  if (!fs.existsSync(testDataDir)) fs.mkdirSync(testDataDir, { recursive: true });

  // Initialer Zustand mit einer existierenden CSV
  const existingCsv = path.join(testDataDir, 'existing.csv');
  fs.writeFileSync(existingCsv, 'Titel,Startdatum\nInitial Event,2026-10-01\n', 'utf8');

  const rollbackManager = new RollbackManager(testDataDir);
  rollbackManager.takeSnapshot();

  // Erzeuge unerwünschte Datei während eines simulierten Abrufs
  const abortCsv = path.join(testDataDir, 'curt-events-data-unfertig.csv');
  fs.writeFileSync(abortCsv, 'Titel,Startdatum\nHalber Datensatz\n', 'utf8');
  assert.ok(fs.existsSync(abortCsv), 'Unfertige Datei sollte existieren.');

  // Modifiziere bestehende Datei
  fs.writeFileSync(existingCsv, 'Titel,Startdatum\nKorrupter Stand\n', 'utf8');

  // Rollback ausführen
  rollbackManager.rollback();
  assert.strictEqual(fs.existsSync(abortCsv), false, 'Rollback muss unfertige CSV-Datei gelöscht haben.');
  assert.strictEqual(
    fs.readFileSync(existingCsv, 'utf8'),
    'Titel,Startdatum\nInitial Event,2026-10-01\n',
    'Rollback muss modifizierte Datei exakt wiederhergestellt haben.'
  );

  // Cleanup
  if (fs.existsSync(existingCsv)) fs.unlinkSync(existingCsv);
  if (fs.existsSync(testDataDir)) fs.rmdirSync(testDataDir);
  console.log('✓ RollbackManager erfolgreich verifiziert.');

  // Test 4: StreamTranslator
  console.log('\n[4/5] Teste StreamTranslator...');
  const curtSkill = skills.find(s => s.id === 'curt-termine-scraper')!;
  const updates: RunStatusUpdate[] = [];

  const translator = new StreamTranslator('run-test-1', curtSkill, (u) => updates.push(u));

  // Initial update
  assert.strictEqual(translator.getPhase(), 'preparing');
  assert.ok(updates[0].message.includes('Bereite Terminabruf für Curt Termine vor'));

  // Tool Call: Navigate
  translator.handleSdkMessage({
    type: 'tool_call',
    agent_id: 'a1',
    run_id: 'r1',
    call_id: 'c1',
    name: 'browser_navigate',
    status: 'running',
  });
  assert.strictEqual(translator.getPhase(), 'reading');
  assert.ok(updates[updates.length - 1].message.includes('im Hintergrund'));

  // Tool Call: Click + Event Count
  translator.handleSdkMessage({
    type: 'assistant',
    agent_id: 'a1',
    run_id: 'r1',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Ich habe 18 Termine gefunden auf curt.de.' }],
    },
  });
  assert.strictEqual(updates[updates.length - 1].eventsFound, 18);
  assert.ok(updates[updates.length - 1].message.includes('(18 Termine gefunden)'));

  // Error Report für Domi
  translator.setFailed('Netzwerk-Timeout beim Aufruf von curt.de');
  assert.strictEqual(translator.getPhase(), 'failed');
  assert.strictEqual(updates[updates.length - 1].message, 'Hier hat etwas nicht geklappt. Frag Domi wie das geht.');
  assert.ok(updates[updates.length - 1].detailsForDomi?.formattedText.includes('Details für Domi'));
  assert.ok(updates[updates.length - 1].detailsForDomi?.formattedText.includes('Netzwerk-Timeout'));
  console.log('✓ StreamTranslator erfolgreich verifiziert.');

  // Test 5: AgentRunner Mutex & Safety
  console.log('\n[5/5] Teste AgentRunner Mutex & Preconditions...');
  const runner = AgentRunner.getInstance();
  assert.strictEqual(runner.getIsBusy(), false, 'Runner darf initial nicht busy sein.');

  // Test ohne konfigurierten Key
  keychainStore.clearApiKey();
  const startResultNoKey = await runner.startRun('curt-termine-scraper', () => {});
  assert.strictEqual(startResultNoKey.success, false);
  assert.ok(startResultNoKey.error?.includes('Zugriffsschlüssel'));

  console.log('✓ AgentRunner Preconditions erfolgreich verifiziert.');

  console.log('\n=============================================');
  console.log('ALLE 5 TESTS FÜR ETAPPE 2 ERFOLGREICH BEENDET!');
  console.log('=============================================');

  app.quit();
}

app.whenReady().then(runVerification);
