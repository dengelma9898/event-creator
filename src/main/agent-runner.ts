import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Agent, type SDKAgent, type Run, type McpServerConfig, type SDKCustomTool } from '@cursor/sdk';

import type {
  RunnerCancelResult,
  RunnerStartResult,
  RunStatusUpdate,
  SkillMetadata,
} from '../shared/types.js';
import { AppPaths } from './app-paths.js';
import { CsvService } from './csv-service.js';
import { KeychainStore } from './keychain-store.js';
import { EventWriter } from './event-writer.js';
import { showSystemNotification } from './notifier.js';
import { RollbackManager } from './rollback-manager.js';
import { SkillLoader } from './skill-loader.js';
import { StreamTranslator } from './stream-translator.js';
import { getOrCreateAgentStore } from './agent-store.js';

const execAsync = promisify(exec);

/**
 * Kernkomponente zur Steuerung des lokalen Cursor-Agenten.
 * Bindet Playwright MCP inline ein, erzwingt strikten Mutex-Lock,
 * registriert customTools (announce_plan, add_event, report_step) und steuert die
 * kontrollierte Einzelspeicherung sowie die Abbruchroutine.
 */
export class AgentRunner {
  private static instance: AgentRunner | null = null;

  private isBusy = false;
  private currentRun: Run | null = null;
  private currentAgent: SDKAgent | null = null;
  private activeTranslator: StreamTranslator | null = null;
  private activeEventWriter: EventWriter | null = null;
  private isCancelling = false;

  private keychainStore: KeychainStore;
  private skillLoader: SkillLoader;
  private rollbackManager: RollbackManager;
  private csvService: CsvService;
  private paths: AppPaths;

  constructor() {
    this.keychainStore = KeychainStore.getInstance();
    this.skillLoader = new SkillLoader();
    this.paths = AppPaths.getInstance();
    this.csvService = CsvService.getInstance(this.paths);

    const dataDir = this.paths.dataDir;
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (err) {
        console.warn('[AgentRunner] Konnte dataDir nicht anlegen:', err);
      }
    }

    this.rollbackManager = new RollbackManager(dataDir);
  }

  public static getInstance(): AgentRunner {
    if (!AgentRunner.instance) {
      AgentRunner.instance = new AgentRunner();
    }
    return AgentRunner.instance;
  }

  public getIsBusy(): boolean {
    return this.isBusy;
  }

  public getDataDir(): string {
    return this.paths.dataDir;
  }

  public getCsvCheckScript(): string {
    return this.paths.csvCheckScript;
  }

  public getRepoRoot(): string {
    return this.paths.repoRoot;
  }

  /**
   * Startet einen kontrollierten Terminabruf für eine ausgewählte Quelle.
   * Erzwingt strikten Mutex (Single-Select), Timeout und Alltagsmeldungen.
   */
  public async startRun(
    venueId: string,
    onStatusUpdate: (update: RunStatusUpdate) => void
  ): Promise<RunnerStartResult> {
    // 1. Mutex-Prüfung
    if (this.isBusy) {
      return {
        success: false,
        error: 'Ein anderer Terminabruf läuft bereits. Bitte warte, bis dieser abgeschlossen ist.',
      };
    }

    // 2. Schlüsselprüfung (ADR 0002)
    if (!this.keychainStore.isConfigured()) {
      return {
        success: false,
        error: 'Bitte hinterlege zuerst deinen Zugriffsschlüssel in den Einstellungen.',
      };
    }

    const apiKey = this.keychainStore.getApiKey();
    if (!apiKey) {
      return {
        success: false,
        error: 'Zugriffsschlüssel konnte nicht aus dem macOS-Schlüsselbund geladen werden.',
      };
    }

    // 3. Quellen-Prüfung
    const venue = this.skillLoader.getSkill(venueId);
    if (!venue) {
      return {
        success: false,
        error: `Die ausgewählte Quelle "${venueId}" wurde im System nicht gefunden.`,
      };
    }

    // Vorbereitung des Laufs
    this.isBusy = true;
    this.isCancelling = false;
    const runId = `run-${Date.now()}`;
    const translator = new StreamTranslator(runId, venue, onStatusUpdate);
    this.activeTranslator = translator;

    // Snapshot des data/-Ordners für Stufe 3 Rollback
    this.rollbackManager.takeSnapshot();

    // Ausführung asynchron anstoßen
    this.executeRun(runId, venue, apiKey, translator).catch((err) => {
      console.error('[AgentRunner] Unerwarteter Fehler im Agent-Lauf:', err);
    });

    return { success: true };
  }

  /**
   * Führt den eigentlichen Agent-Lauf gegen @cursor/sdk und Playwright MCP durch.
   */
  private async executeRun(
    runId: string,
    venue: SkillMetadata,
    apiKey: string,
    translator: StreamTranslator
  ): Promise<void> {
    // API-Key in Umgebungsvariablen für @cursor/sdk bereitstellen
    process.env.CURSOR_API_KEY = apiKey;

    // Phase 0: Bestand laden, vergangene Events bereinigen & Snapshot vorbereiten
    translator.setStepStatus('check_inventory', 'active', 'Prüfe gespeicherte Termine und filtere vergangene...');
    const phase0 = await this.csvService.prepareSourcePhase0(venue.id, venue.skillPath);
    translator.setExistingKeys(phase0.existingKeys);

    const inventoryDetail =
      phase0.cleanedPastCount > 0
        ? `${phase0.keptEvents.length} Termine im Bestand (${phase0.cleanedPastCount} vergangene entfernt)`
        : `${phase0.keptEvents.length} Termine im Bestand aktuell`;
    translator.setStepStatus('check_inventory', 'completed', inventoryDetail);

    // Initialisiere EventWriter für diesen Lauf
    const eventWriter = new EventWriter({
      dataDir: this.paths.dataDir,
      venueBaseName: phase0.prefix,
    });
    eventWriter.registerExistingKeys(phase0.existingKeys);
    this.activeEventWriter = eventWriter;

    translator.setStepStatus('open_website', 'active', `Öffne ${translator.getDomain()} im Hintergrund...`);

    const nodeExec = process.execPath;
    const mcpConfig: Record<string, McpServerConfig> = {
      playwright: {
        type: 'stdio',
        command: nodeExec,
        args: [this.paths.playwrightCliPath, '--headless'],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
        },
      },
    };

    // Callback-Tools für den Agenten (in-process)
    const customTools: Record<string, SDKCustomTool> = {
      announce_plan: {
        description:
          'Meldet die Liste aller auf der Übersichtsseite/im Kalender gefundenen Termine (Kandidaten), bevor Details einzeln geladen werden. Ermöglicht der App die Anzeige einer transparenten Live-Checkliste.',
        inputSchema: {
          type: 'object',
          properties: {
            events: {
              type: 'array',
              description: 'Liste der entdeckten Events mit title, optional startDate und detailUrl',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Titel der Veranstaltung' },
                  startDate: { type: 'string', description: 'Startdatum (YYYY-MM-DD), falls bereits in der Übersicht sichtbar' },
                  detailUrl: { type: 'string', description: 'URL der Detailseite oder Link' },
                },
                required: ['title'],
              },
            },
          },
          required: ['events'],
        },
        execute: async (args: Record<string, any>) => {
          const events = Array.isArray(args.events) ? args.events : [];
          translator.setPlanCandidates(events);
          return JSON.stringify({
            success: true,
            count: events.length,
            message: `${events.length} Event-Kandidaten im Plan erfasst. Bitte jetzt die Details einzeln aufrufen und per add_event speichern.`,
          });
        },
      },

      add_event: {
        description:
          'Speichert genau ein extrahiertes Event direkt in die CSV-Datei. Führt die Pflichtfeld-, Datums- und Duplikatsprüfung durch und gibt sofortige Rückmeldung.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Titel des Events (Pflichtfeld)' },
            startDate: { type: 'string', description: 'Startdatum im Format YYYY-MM-DD (Pflichtfeld, muss >= morgen sein)' },
            endDate: { type: 'string', description: 'Enddatum (YYYY-MM-DD oder leer)' },
            startTime: { type: 'string', description: 'Startzeit im Format HH:mm (oder leer)' },
            endTime: { type: 'string', description: 'Endzeit im Format HH:mm (oder leer)' },
            location: { type: 'string', description: 'Vollständiger Veranstaltungsort mit Adresse' },
            category: { type: 'string', description: 'Eine der 7 App-Kategorien oder leer' },
            price: { type: 'string', description: 'Preisangabe oder leer' },
            tickets: { type: 'string', description: '"ja" oder "nein"' },
            ticketUrl: { type: 'string', description: 'Ticket-Shop-URL oder leer' },
            email: { type: 'string', description: 'Kontakt-E-Mail oder leer' },
            phone: { type: 'string', description: 'Kontakt-Telefon oder leer' },
            website: { type: 'string', description: 'Veranstalter-Website oder leer' },
            socialMedia: { type: 'string', description: 'Social Media Link oder leer' },
            imageUrl: { type: 'string', description: 'Bild-URL oder leer' },
            detailUrl: { type: 'string', description: 'Detail-URL des Termins (für Eindeutigkeit)' },
            description: { type: 'string', description: 'Beschreibungstext des Termins' },
          },
          required: ['title', 'startDate'],
        },
        execute: async (args: Record<string, any>) => {
          if (this.isCancelling) {
            return JSON.stringify({
              success: false,
              cancelled: true,
              message: 'Vorgang wurde abgebrochen. Keine weiteren Events speichern.',
            });
          }

          const outcome = eventWriter.addRawEvent(args);
          if (outcome.success && outcome.event) {
            translator.addEventSuccess(outcome.event);
            return JSON.stringify({
              success: true,
              chunkFileName: outcome.chunkFileName,
              totalWritten: outcome.totalWritten,
              message: `Event "${outcome.event.title}" erfolgreich in CSV gespeichert (${outcome.chunkFileName}). Gesamt neue Events: ${outcome.totalWritten}.`,
            });
          } else {
            translator.addEventSkipped(
              String(args.title || ''),
              String(args.startDate || ''),
              String(args.detailUrl || ''),
              outcome.reason
            );
            return JSON.stringify({
              success: false,
              reason: outcome.reason,
              message: `Event "${args.title || ''}" nicht gespeichert: ${outcome.reason || ''}`,
            });
          }
        },
      },

      report_step: {
        description: 'Meldet einen Zwischenschritt an die Benutzeroberfläche (z. B. welcher Termin gerade geöffnet und gelesen wird).',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Kurze Statusmeldung für die Benutzeroberfläche' },
            candidateTitle: { type: 'string', description: 'Titel des aktuell bearbeiteten Kandidaten' },
          },
          required: ['message'],
        },
        execute: async (args: Record<string, any>) => {
          const msg = String(args.message || '');
          const candTitle = args.candidateTitle ? String(args.candidateTitle) : undefined;
          translator.reportStepMessage(msg, candTitle);
          return JSON.stringify({ success: true });
        },
      },
    };

    const relativeSkillPath = path.relative(this.paths.repoRoot, venue.skillPath);

    const prompt = [
      `Führe den Terminabruf für "${venue.name}" (${venue.id}) aus.`,
      '',
      'Arbeitsweise & Werkzeuge:',
      `1. Beachte die Quell-Anweisungen in "${relativeSkillPath}" (Selektoren, Webseiten-Struktur, Ortsangaben, Kategorie-Mapping).`,
      '2. Verwende ausschließlich Playwright MCP Browser-Automation zur Navigation auf der Webseite.',
      '3. PHASE 1 - TERMINLISTE & PLAN: Öffne die Webseite, überblicke die anstehenden Termine und rufe SOFORT das Werkzeug "announce_plan" auf mit allen gefundenen Kandidaten.',
      '4. PHASE 2 - DETAILS EINZELN ERFASSEN & SPEICHERN: Für jeden Kandidaten:',
      '   a) Rufe optional "report_step" auf (z. B. message: "Lade Details für Konzert X", candidateTitle: "Konzert X").',
      '   b) Öffne die Detailseite / klappe die Details auf und extrahiere alle Informationen.',
      '   c) Rufe SOFORT das Werkzeug "add_event" auf, um den Termin direkt in die CSV zu speichern. Die App validiert das Event und speichert es sofort.',
      '   d) Falls add_event Erfolg meldet, fahre mit dem nächsten Kandidaten fort.',
      '5. LIMIT: Speichere maximal 15 neue Events. Sobald 15 neue Events gespeichert wurden oder keine weiteren zukünftigen Termine vorliegen, beende deine Arbeit.',
      '6. KEINE DATEIEN SELBST SCHREIBEN: Erstelle oder bearbeite KEINE CSV-Dateien direkt im Dateisystem! Die Speicherung erfolgt AUSSCHLIESSLICH über das Werkzeug "add_event".',
      '7. Keine Python-Skripte, kein Fallback.',
    ].join('\n');

    try {
      console.log(`[AgentRunner] Starte Agent für ${venue.id} in ${this.paths.repoRoot}...`);

      const agentStore = getOrCreateAgentStore(this.paths.repoRoot);
      const agent = await Agent.create({
        model: { id: 'composer-2.5' },
        apiKey,
        local: {
          cwd: this.paths.repoRoot,
          store: agentStore,
          customTools,
        },
        mcpServers: mcpConfig,
      });

      this.currentAgent = agent;

      if (this.isCancelling) {
        throw new Error('Vorgang wurde vor dem Senden abgebrochen.');
      }

      const run = await agent.send(prompt);
      this.currentRun = run;

      // Stream abhören und in Alltagssprache übersetzen
      for await (const msg of run.stream()) {
        if (this.isCancelling) break;
        translator.handleSdkMessage(msg);
      }

      const runResult = await run.wait();

      if (this.isCancelling) {
        return;
      }

      if (runResult.status === 'error') {
        const errMsg = runResult.error?.message || 'Agent meldete einen Fehler bei der Durchführung.';
        throw new Error(errMsg);
      }

      // Validierungsphase (AP 2.6): csv-import-check.js ausführen
      translator.setPhase('validating', 'Termine werden für den fehlerfreien Import vorbereitet...');
      await this.runCsvImportCheck(translator, venue, eventWriter, phase0.keptEvents.length);
    } catch (error: any) {
      if (this.isCancelling) {
        console.log(`[AgentRunner] Lauf ${runId} sauber abgebrochen.`);
        return;
      }

      console.error(`[AgentRunner] Fehler während des Laufs ${runId}:`, error);

      // Bei Fehler: Bereits geschriebene Events sichern und prüfen
      if (eventWriter.getWrittenCount() > 0) {
        try {
          await this.runCsvImportCheck(translator, venue, eventWriter, phase0.keptEvents.length);
        } catch {
          this.rollbackManager.rollback();
          translator.setFailed(error?.message || String(error));
        }
      } else {
        this.rollbackManager.rollback();
        translator.setFailed(error?.message || String(error));
      }
    } finally {
      this.cleanupRun();
    }
  }

  /**
   * Führt den Abschluss-Check mit csv-import-check.js durch.
   */
  private async runCsvImportCheck(
    translator: StreamTranslator,
    venue: SkillMetadata,
    eventWriter: EventWriter,
    existingCount = 0
  ): Promise<void> {
    const nodeExec = process.execPath;
    let checkOutput = '';
    let checkFailed = false;

    try {
      const { stdout, stderr } = await execAsync(
        `"${nodeExec}" "${this.paths.csvCheckScript}" "${this.paths.dataDir}"`,
        {
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
          },
          cwd: this.paths.repoRoot,
        }
      );
      checkOutput = stdout || stderr;
    } catch (err: any) {
      checkFailed = true;
      checkOutput = err?.stdout || err?.stderr || err?.message || 'Unbekannter Validierungsfehler';
    }

    if (checkFailed || !checkOutput.includes('OK:')) {
      console.error('[AgentRunner] csv-import-check.js fehlgeschlagen:', checkOutput);
      // Sofortiger Fehlerabbruch nach ADR 0003
      this.rollbackManager.rollback();
      translator.setFailed(`CSV-Validierung fehlgeschlagen:\n${checkOutput}`);
      return;
    }

    // Erfolgreiche Validierung -> Commit des Snapshots
    const affectedFiles = this.rollbackManager.commit();
    const finalFiles = affectedFiles.length > 0 ? affectedFiles : eventWriter.getFilesWritten();
    const newCount = eventWriter.getWrittenCount();

    translator.setCompleted(newCount, existingCount, finalFiles);

    // macOS System-Benachrichtigung (Bereich 3)
    showSystemNotification({
      title: `Event Creator: ${venue.name}`,
      body:
        newCount > 0
          ? `${newCount} neue Termine erfolgreich gespeichert.`
          : `Terminabruf abgeschlossen (${existingCount} bestehende Termine aktuell).`,
    });
  }

  /**
   * Kontrollierte Abbruchroutine mit Datensicherung.
   * Bereits geschriebene Events bleiben erhalten (Benutzer-Entscheidung).
   */
  public async cancelRun(isTimeout = false): Promise<RunnerCancelResult> {
    if (!this.isBusy) {
      return { success: true };
    }

    console.log(`[AgentRunner] Abbruch eingeleitet (Timeout: ${isTimeout})...`);
    this.isCancelling = true;

    // UI sofort informieren
    this.activeTranslator?.setPhase(
      'cancelling',
      'Beenden angefordert: Breche Vorgang ab und sichere geschriebene Termine...'
    );

    // Stop-Signal auf Dateisystem-Ebene setzen (falls Skripte danach suchen)
    const stopFileRepo = path.join(this.paths.repoRoot, '.stop-requested');
    const stopFileData = path.join(this.paths.dataDir, '.stop-requested');
    try {
      fs.writeFileSync(stopFileRepo, 'stop');
      fs.writeFileSync(stopFileData, 'stop');
    } catch (err) {
      console.warn('[AgentRunner] Konnte .stop-requested nicht schreiben:', err);
    }

    // Agent abbrechen
    if (this.currentRun) {
      try {
        await this.currentRun.cancel();
      } catch (err) {
        console.warn('[AgentRunner] Fehler bei run.cancel():', err);
      }
    }

    // Browser-Prozesse bereinigen
    await this.rollbackManager.cleanupOrphanProcesses();

    // Prüfen, ob CSV-Dateien geschrieben wurden: Diese bleiben erhalten!
    const writtenCount = this.activeEventWriter?.getWrittenCount() || 0;
    const modifiedFiles = this.rollbackManager.getModifiedFiles();

    if (writtenCount > 0 || modifiedFiles.length > 0) {
      try {
        const nodeExec = process.execPath;
        const { stdout } = await execAsync(
          `"${nodeExec}" "${this.paths.csvCheckScript}" --fix-bom "${this.paths.dataDir}"`,
          {
            env: {
              ...process.env,
              ELECTRON_RUN_AS_NODE: '1',
            },
            cwd: this.paths.repoRoot,
          }
        );
        if (stdout.includes('OK:')) {
          this.rollbackManager.commit();
          const writtenFiles = this.activeEventWriter?.getFilesWritten() || [];
          this.activeTranslator?.setCancelled(writtenFiles);
          this.cleanupRun();
          return { success: true };
        }
      } catch (err) {
        console.warn('[AgentRunner] Validierung bei Abbruch fehlgeschlagen:', err);
      }
    }

    // Wenn keine gültigen Daten vorhanden waren oder Validierung scheiterte
    if (writtenCount === 0) {
      this.rollbackManager.rollback();
    }

    if (isTimeout) {
      this.activeTranslator?.setFailed(
        'Der Vorgang hat das Zeitlimit überschritten und wurde abgebrochen.'
      );
    } else {
      this.activeTranslator?.setCancelled();
    }

    this.cleanupRun();
    return { success: true };
  }

  private cleanupRun(): void {
    try {
      const stop1 = path.join(this.paths.repoRoot, '.stop-requested');
      const stop2 = path.join(this.paths.dataDir, '.stop-requested');
      if (fs.existsSync(stop1)) fs.unlinkSync(stop1);
      if (fs.existsSync(stop2)) fs.unlinkSync(stop2);
    } catch {
      // ignore
    }

    if (this.currentAgent) {
      try {
        this.currentAgent.close();
      } catch {
        // ignore
      }
      this.currentAgent = null;
    }

    this.currentRun = null;
    this.activeEventWriter = null;
    this.isBusy = false;
    this.isCancelling = false;
  }
}
