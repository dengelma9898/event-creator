import fs from 'node:fs';
import path from 'node:path';
import { Agent, type McpServerConfig } from '@cursor/sdk';

import type {
  AssistantAnalysisInput,
  AssistantAnalysisResult,
  SaveSkillInput,
  SaveSkillResult,
} from '../shared/types.js';
import { AppPaths } from './app-paths.js';
import { AgentRunner } from './agent-runner.js';
import { KeychainStore } from './keychain-store.js';
import { SkillLoader } from './skill-loader.js';
import { getOrCreateAgentStore } from './agent-store.js';
import { extractJsonPayload, validatePreviewEvents } from './assistant-parser.js';

/**
 * Service für Bereich 2: „Neue Webseite anlernen“ (Assistent).
 * Führt über @cursor/sdk und Playwright MCP eine Live-Strukturanalyse durch,
 * entscheidet über 16 vs. 17 Spalten (Ticket-Links), liefert ein Test-Event für die
 * Vorschaukarte und speichert bei Bestätigung die neue SKILL.md in skills/.
 * Implementiert AP 3.5 nach ADR 0001–0004 und .cursorrules.
 */
export class AssistantService {
  private static instance: AssistantService | null = null;

  private keychainStore: KeychainStore;
  private skillLoader: SkillLoader;
  private paths: AppPaths;
  private skillsDir: string;

  constructor() {
    this.keychainStore = KeychainStore.getInstance();
    this.skillLoader = new SkillLoader();
    this.paths = AppPaths.getInstance();
    this.skillsDir = this.paths.skillsDir;
  }

  public getRepoRoot(): string {
    return this.paths.repoRoot;
  }

  public static getInstance(): AssistantService {
    if (!AssistantService.instance) {
      AssistantService.instance = new AssistantService();
    }
    return AssistantService.instance;
  }

  /**
   * Generiert einen sauberen Slug aus dem Namen der Quelle oder der URL.
   */
  public generateSlug(name?: string, url?: string): string {
    let base = (name || '').trim();
    if (!base && url) {
      try {
        const parsedUrl = new URL(url);
        const host = parsedUrl.hostname.replace(/^www\./i, '').split('.')[0] || '';
        const pathParts = parsedUrl.pathname
          .split('/')
          .filter(Boolean)
          .slice(0, 2)
          .join('-');
        base = pathParts ? `${host}-${pathParts}` : host;
      } catch {
        base = 'webseite';
      }
    }
    if (!base) {
      base = 'webseite';
    }

    const clean = base
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return clean.endsWith('-scraper') ? clean : `${clean}-scraper`;
  }

  /**
   * Leitet einen lesbaren Standardnamen aus einer URL ab, falls kein Name vorgegeben ist.
   */
  public deriveNameFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./i, '');
      const parts = host.split('.');
      const main = parts[0] || 'Webseite';
      return main.charAt(0).toUpperCase() + main.slice(1);
    } catch {
      return 'Neue Webseite';
    }
  }

  /**
   * Analysiert eine neue Webseite im Hintergrund und liefert 1–2 Vorschau-Events.
   * Unterstützt initiale Erkennung und iterative Human-in-the-Loop Refinement-Läufe mit Feedback.
   */
  public async analyzeSource(
    input: AssistantAnalysisInput,
    onStatus?: (message: string) => void
  ): Promise<AssistantAnalysisResult> {
    if (!input.url?.trim() || !/^https?:\/\//i.test(input.url.trim())) {
      return { success: false, error: 'Bitte gib eine gültige Internet-Adresse (URL mit https://) an.' };
    }

    const agentRunner = AgentRunner.getInstance();
    if (agentRunner.getIsBusy()) {
      return {
        success: false,
        error: 'Ein anderer Terminabruf läuft bereits. Bitte warte, bis dieser abgeschlossen ist.',
      };
    }

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

    const defaultInitialName = input.name?.trim() || this.deriveNameFromUrl(input.url);
    process.env.CURSOR_API_KEY = apiKey;

    onStatus?.('Verbindung zur Webseite wird vorbereitet...');

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

    const isRefinement = Boolean(input.feedback?.trim());
    let prompt: string;

    if (isRefinement) {
      prompt = [
        `Du bist der Web-Scraping-Assistent für das Projekt Nürnbergspots Event Creator.`,
        `Die Anwenderin möchte den Scraper für die Webseite "${defaultInitialName}" (${input.url}) gezielt anpassen und verfeinern.`,
        '',
        `KORREKTUR-ANWEISUNG / FEEDBACK DER ANWENDERIN:`,
        `"${input.feedback?.trim()}"`,
        '',
        input.previousSkillContent ? `VORHERIGER ENTWURF DER SKILL.MD:\n\`\`\`markdown\n${input.previousSkillContent}\n\`\`\`\n` : '',
        'DEINE AUFGABEN BEI DIESEM REFINEMENT-LAUF:',
        '1. Öffne die URL erneut mit Playwright MCP und überprüfe die Punkte aus dem Feedback der Anwenderin.',
        '2. Falls ein Cookie-Banner oder Zustimmungsdialog erscheint, schließe oder akzeptiere diesen.',
        '3. Passe die Extraktionsregeln und den Aufbau in der SKILL.md entsprechend an.',
        '4. Extrahiere erneut 1 bis 2 ECHTE Veranstaltungen von der Seite (keine erfundenen Platzhalter), die das Feedback demonstrieren.',
        '   Lies dabei alle auf der Seite auffindbaren Informationen aus (Titel, Datum/Uhrzeit, Veranstaltungsort, genaue Adresse, Beschreibung/Teaser, Preis/Eintritt, Veranstalter, Bild-URL, Ticket-Link, Detail-URL).',
        '   Wichtig: Gib für optionale Felder (Adresse, Beschreibung, Preis, Veranstalter, Bild-URL, Ticket-URL, Detail-URL) nur Werte an, wenn sie wirklich auf der Seite stehen – sonst als leeren String "" belassen, niemals etwas erfinden!',
        '5. Validiere die App-Kategorie für jedes Event aus den 7 kanonischen Kategorien: Musik & Nightlife, Familie & Kinder, Workshops & PopUps, Märkte & Messen, Show & Performance, Kultur, Sport & Fitness.',
        '',
        'WICHTIG FÜR DEN JSON-CODEBLOCK:',
        '- Verwende im Feld "skillContent" KEINE unescapten Dreifach-Backticks (```), damit der JSON-Codeblock valide bleibt.',
        '- Antworte am Ende zwingend mit einem einzigen JSON-Codeblock im folgendem Format:',
        '```json',
        '{',
        '  "name": "Aktualisierter Name der Quelle",',
        '  "sourceType": "aggregator" oder "venue",',
        '  "sourceTypeNote": "Kurze Erläuterung zum Typ",',
        '  "columnCount": 16 oder 17,',
        '  "columnNote": "Kurze Erläuterung zum CSV-Spaltenformat",',
        '  "detailPagesNote": "Kurze Erläuterung zur Navigation",',
        '  "previewEvents": [',
        '    {',
        '      "title": "Echter Titel des Events",',
        '      "dateTime": "Echtes Datum & Uhrzeit",',
        '      "location": "Veranstaltungsort",',
        '      "address": "Genaue Adresse (Straße, PLZ, Ort) oder leer",',
        '      "description": "Beschreibung / Teaser des Events oder leer",',
        '      "price": "Eintritt / Preisangabe oder leer",',
        '      "organizer": "Veranstalter / Host oder leer",',
        '      "category": "Eine der 7 App-Kategorien",',
        '      "imageUrl": "https://... oder leer",',
        '      "ticketUrl": "https://... oder leer",',
        '      "detailUrl": "https://... oder leer"',
        '    }',
        '  ],',
        '  "agentNotes": "Was wurde anhand des Feedbacks angepasst?",',
        '  "skillContent": "--- ... vollständiger neuer Inhalt der SKILL.md ... ---"',
        '}',
        '```',
      ].join('\n');
    } else {
      prompt = [
        `Du bist der Web-Scraping-Assistent für das Projekt Nürnbergspots Event Creator.`,
        `Analysiere die neue Event-Webseite unter der URL: ${input.url}`,
        input.name?.trim()
          ? `Vom Nutzer vorgegebener Name: "${input.name.trim()}"`
          : 'Hinweis: Es wurde kein Name vorgegeben. Bitte ermittle einen treffenden, prägnanten Namen für diese Quelle aus dem Webseiteninhalt (z. B. Seitentitel, Meta-Tags, Branding).',
        '',
        'WICHTIGE ERKENNUNGSAUFGABE (SAMMELSEITE VS. FESTE SPIELSTÄTTE):',
        '- Viele Webseiten sind Sammelseiten / Event-Portale (z. B. curt.de, rausgegangen.de, Stadtkalender), die Veranstaltungen vieler verschiedener Veranstalter an unterschiedlichen Orten sammeln.',
        '- Andere Webseiten gehören zu einer festen Einrichtung / Spielstätte (z. B. Tafelhalle, E-Werk, Meistersingerhalle), bei der alle Events am selben Ort stattfinden.',
        '- Analysiere autonom, ob es sich um eine Sammelseite ("aggregator") oder eine feste Spielstätte ("venue") handelt.',
        '- Bei einer Sammelseite MUSS der Skill anweisen, Ort und Adresse für jedes Event individuell aus den Eventdaten/Detailseiten auszulesen.',
        '',
        'WEITERE AUFGABEN:',
        '1. Öffne die URL mit Playwright MCP und analysiere die Veranstaltungsliste.',
        '2. Falls ein Cookie-Banner, Datenschutzhinweis oder Zustimmungsdialog erscheint (z. B. Borlabs Cookie), schließe oder akzeptiere diesen zuerst.',
        '3. Prüfe, ob Detailseiten für die Events existieren oder ob alle Daten in der Liste/Klappfeldern stehen.',
        '4. Prüfe, ob direkte Ticket-Links oder Buchungs-Buttons vorhanden sind. Entscheide autonom über 16 vs. 17 CSV-Spalten.',
        '5. Extrahiere genau 1 bis 2 ECHTE, tatsächlich auf der Seite gefundene Veranstaltungen mit allen auffindbaren Details (Titel, Datum/Uhrzeit, Veranstaltungsort, genaue Adresse, Beschreibung/Teaser, Preis/Eintritt, Veranstalter, Bild-URL, Ticket-Link, Detail-URL). Verwende NIEMALS Dummy- oder Platzhalter-Events wie "Beispielveranstaltung"!',
        '   Wichtig: Gib für optionale Felder (Adresse, Beschreibung, Preis, Veranstalter, Bild-URL, Ticket-URL, Detail-URL) nur Werte an, wenn sie wirklich auf der Seite stehen – sonst als leeren String "" belassen, niemals etwas erfinden!',
        '   Ordne jedes Event einer der 7 App-Kategorien zu:',
        '   - Musik & Nightlife',
        '   - Familie & Kinder',
        '   - Workshops & PopUps',
        '   - Märkte & Messen',
        '   - Show & Performance',
        '   - Kultur',
        '   - Sport & Fitness',
        '6. Erstelle den vollständigen Markdown-Inhalt für die SKILL.md nach Projektstandards (Speicherung in data/, Carry-Forward-Merge, Vergangenheitsfilter, 50er Chunking, 15 neue Events Limit, kein Python, csv-import-check.js nach dem Schreiben).',
        '',
        'WICHTIG FÜR DEN JSON-CODEBLOCK:',
        '- Verwende im Feld "skillContent" KEINE unescapten Dreifach-Backticks (```), damit der JSON-Codeblock valide bleibt.',
        '- Antworte am Ende zwingend mit einem einzigen JSON-Codeblock im folgendem Format:',
        '```json',
        '{',
        '  "name": "Ermittelter oder bestätigter Name der Webseite / Quelle",',
        '  "sourceType": "aggregator" oder "venue",',
        '  "sourceTypeNote": "Kurze Erläuterung (z. B. Sammelseite mit wechselnden Spielorten)",',
        '  "columnCount": 16 oder 17,',
        '  "columnNote": "Ticket-Links erkannt oder Standardformat",',
        '  "detailPagesNote": "Detailseiten vorhanden oder Kompaktansicht",',
        '  "previewEvents": [',
        '    {',
        '      "title": "Echter Titel des 1. Events",',
        '      "dateTime": "Echtes Datum & Uhrzeit",',
        '      "location": "Veranstaltungsort",',
        '      "address": "Genaue Adresse (Straße, PLZ, Ort) oder leer",',
        '      "description": "Beschreibung / Teaser des Events oder leer",',
        '      "price": "Eintritt / Preisangabe oder leer",',
        '      "organizer": "Veranstalter / Host oder leer",',
        '      "category": "Eine der 7 App-Kategorien",',
        '      "imageUrl": "https://... oder leer",',
        '      "ticketUrl": "https://... oder leer",',
        '      "detailUrl": "https://... oder leer"',
        '    }',
        '  ],',
        '  "agentNotes": "Kurze Zusammenfassung der Erkenntnisse",',
        '  "skillContent": "--- ... vollständiger Inhalt der SKILL.md ... ---"',
        '}',
        '```',
      ].join('\n');
    }

    let agent: any = null;

    try {
      const agentStore = getOrCreateAgentStore(this.paths.repoRoot);
      agent = await Agent.create({
        model: { id: 'composer-2.5' },
        apiKey,
        local: {
          cwd: this.paths.repoRoot,
          store: agentStore,
        },
        mcpServers: mcpConfig,
      });

      const run = await agent.send(prompt);
      let fullAssistantText = '';

      for await (const msg of run.stream()) {
        if (msg.type === 'tool_call') {
          const tc = msg as any;
          const toolName = (tc.name || '').toLowerCase();
          const toolArgs = tc.args?.args || tc.args || {};
          if (toolName.includes('navigate') || tc.args?.toolName?.includes('navigate')) {
            const targetUrl = toolArgs.url || input.url;
            try {
              const host = new URL(targetUrl).hostname.replace(/^www\./, '');
              onStatus?.(`Öffne ${host} im Hintergrund...`);
            } catch {
              onStatus?.('Öffne Webseite im Hintergrund...');
            }
          } else if (toolName.includes('evaluate') || toolName.includes('run_code') || toolName === 'mcp') {
            onStatus?.('Suche nach Veranstaltungen auf der Seite...');
          } else if (toolName.includes('click')) {
            onStatus?.('Navigiere auf der Seite...');
          }
        } else if (msg.type === 'thinking') {
          const text = msg.text || '';
          if (/detail|adresse|ort|datum|uhrzeit/i.test(text)) {
            onStatus?.('Lese Termine und Veranstaltungsorte aus...');
          } else if (/kategorie|format|spalten|ticket/i.test(text)) {
            onStatus?.('Prüfe Kategorien und Details...');
          }
        } else if (msg.type === 'assistant' && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              fullAssistantText += block.text;
            }
          }
        }
      }

      onStatus?.('Bereite Vorschau der gefundenen Termine vor...');

      const runResult = await run.wait();
      if (runResult.status !== 'finished') {
        const detailsText = this.buildDiagnosticDetails(
          input.url,
          runResult.status === 'error'
            ? runResult.error?.message || 'Agent meldete einen Fehler bei der Durchführung.'
            : `Analyse wurde nicht abgeschlossen (Status: ${runResult.status}).`,
          fullAssistantText || runResult.result || ''
        );
        return {
          success: false,
          error: 'Hier hat etwas nicht geklappt. Frag Domi wie das geht.',
          detailsForDomiText: detailsText,
        };
      }

      // Antworttext: Stream bevorzugen, sonst Endergebnis des Laufs als zweite Quelle.
      let analysisText = fullAssistantText;
      if (!extractJsonPayload(analysisText) && runResult.result) {
        analysisText = runResult.result;
      }

      // JSON Block extrahieren mit robuster Extraktionslogik
      const parsed = extractJsonPayload(analysisText);
      if (parsed) {
        const resolvedName = (parsed.name || input.name || defaultInitialName).trim();
        const slug = this.generateSlug(resolvedName, input.url);
        const columnCount: 16 | 17 = parsed.columnCount === 17 || parsed.hasTicketLinks ? 17 : 16;
        const columnNote =
          parsed.columnNote ||
          (columnCount === 17
            ? 'Ticket-Links erkannt: Direkte Ticket-Links werden mitgespeichert.'
            : 'Standard-Format gewählt (16 Spalten ohne gesonderte Ticket-Links).');

        const sourceType: 'aggregator' | 'venue' =
          parsed.sourceType === 'venue' ? 'venue' : 'aggregator';
        const sourceTypeNote =
          parsed.sourceTypeNote ||
          (sourceType === 'aggregator'
            ? 'Sammelseite erkannt: Termine von verschiedenen Veranstaltern & wechselnden Spielorten.'
            : 'Feste Spielstätte / Einrichtung erkannt.');

        const rawEvents: any[] = Array.isArray(parsed.previewEvents)
          ? parsed.previewEvents
          : parsed.previewEvent
          ? [parsed.previewEvent]
          : [];

        // Strikte Validierung: Nur ECHTE Events (echter Titel + echtes Datum) übernehmen.
        const { events: previewEvents, rejected } = validatePreviewEvents(rawEvents, { resolvedName });

        // Wenn keine echten Events extrahiert werden konnten: Fehler mit Domi-Details anzeigen!
        if (previewEvents.length === 0) {
          const detailsText = this.buildDiagnosticDetails(
            input.url,
            `Auf der Webseite konnten keine konkreten Veranstaltungen erkannt oder ausgelesen werden (0 Termine gefunden; ${rawEvents.length} Eintrag/Einträge vom Agenten geliefert, verworfen: ${rejected.join('; ') || 'keine'}).`,
            analysisText
          );
          return {
            success: false,
            error: 'Auf dieser Internetseite konnten keine Veranstaltungen erkannt werden. Frag Domi wie das geht.',
            detailsForDomiText: detailsText,
          };
        }

        const previewEvent = previewEvents[0];

        const generatedSkillContent =
          parsed.skillContent ||
          this.buildFallbackSkillContent(input, slug, resolvedName, sourceType, columnCount);

        return {
          success: true,
          slug,
          name: resolvedName,
          sourceType,
          sourceTypeNote,
          columnCount,
          columnNote,
          detailPagesNote: parsed.detailPagesNote,
          previewEvents,
          previewEvent,
          agentNotes: parsed.agentNotes,
          generatedSkillContent,
        };
      }

      // Falls kein valider JSON-Block vorhanden ist: Fehler anzeigen mit Diagnose für Domi!
      const detailsText = this.buildDiagnosticDetails(
        input.url,
        'Die Struktur der Internetseite konnte nicht automatisch erfasst werden (kein gültiges Analyse-Format).',
        analysisText
      );
      return {
        success: false,
        error: 'Hier hat etwas nicht geklappt. Frag Domi wie das geht.',
        detailsForDomiText: detailsText,
      };
    } catch (error: any) {
      console.error('[AssistantService] Fehler bei analyzeSource:', error);
      const detailsText = this.buildDiagnosticDetails(
        input.url,
        `Fehler während der Analyse: ${error?.message || String(error)}`,
        error?.stack || ''
      );
      return {
        success: false,
        error: 'Hier hat etwas nicht geklappt. Frag Domi wie das geht.',
        detailsForDomiText: detailsText,
      };
    } finally {
      if (agent) {
        try {
          agent.close();
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Baut den standardisierten Diagnoseblock für Domi im Fehlerfall.
   */
  private buildDiagnosticDetails(url: string, reason: string, rawOutput?: string): string {
    const excerpt = rawOutput ? rawOutput.slice(0, 1500).trim() : 'Keine Textausgabe vorhanden';
    return [
      '=== Details für Domi ===',
      `Zeitpunkt: ${new Date().toISOString()}`,
      `Funktion: Neue Webseite anlernen (Assistent)`,
      `URL: ${url}`,
      `Fehler: ${reason}`,
      '--- Auszug der Analyse ---',
      excerpt,
      '========================',
    ].join('\n');
  }

  /**
   * Speichert eine bestätigte neue Quelle als SKILL.md dauerhaft ab.
   */
  public async saveSkill(input: SaveSkillInput): Promise<SaveSkillResult> {
    try {
      const slug = this.generateSlug(input.slug || input.name);
      let targetDir = path.join(this.skillsDir, slug);
      let skillPath = path.join(targetDir, 'SKILL.md');

      try {
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        fs.writeFileSync(skillPath, input.skillContent.trim() + '\n', 'utf8');
      } catch (writeErr) {
        // Fallback auf userData/skills falls skillsDir z. B. in einer schreibgeschützten App-Bundle-Umgebung liegt
        const userSkillsDir = this.skillLoader.getUserSkillsDir();
        if (userSkillsDir) {
          targetDir = path.join(userSkillsDir, slug);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          skillPath = path.join(targetDir, 'SKILL.md');
          fs.writeFileSync(skillPath, input.skillContent.trim() + '\n', 'utf8');
        } else {
          throw writeErr;
        }
      }

      // Aktualisierte Metadaten laden
      const skill = this.skillLoader.getSkill(slug) || {
        id: slug,
        name: input.name,
        description: `Scraper für ${input.name}`,
        skillPath,
      };

      return {
        success: true,
        skill,
      };
    } catch (err: any) {
      console.error('[AssistantService] Fehler beim Speichern des Skills:', err);
      return {
        success: false,
        error: `Der Skill konnte nicht gespeichert werden: ${err?.message || String(err)}`,
      };
    }
  }

  /**
   * Erstellt eine vorschriftsmäßige SKILL.md nach den Projektregeln.
   */
  private buildFallbackSkillContent(
    input: AssistantAnalysisInput,
    slug: string,
    resolvedName: string,
    sourceType: 'aggregator' | 'venue',
    columnCount: 16 | 17
  ): string {
    const hasTicketCol = columnCount === 17;
    const isAggregator = sourceType === 'aggregator';
    const locationRule = isAggregator
      ? 'Sammelseite / Wechselnde Spielorte: Extrahiere den jeweiligen Veranstaltungsort und die Adresse für jedes Event individuell aus den Event-Details.'
      : (input.sameLocation && input.address
          ? `Fester Ort: Verwende für jedes Event immer die Adresse "${input.address}".`
          : `Feste Spielstätte: Verwende den festen Ort von "${resolvedName}".`);

    const pageRule = input.hasDetailPages === false
      ? 'Kompakte Liste: Alle relevanten Eventinformationen befinden sich auf der Übersicht oder in Klappmenüs.'
      : 'Detailseiten vorhanden: Navigiere zu den Unterseiten der Events, um vollständige Beschreibungen zu erfassen.';

    return `---
name: ${slug}
description: Extrahiert Event-Details von ${input.url}. Verwendet Playwright MCP Browser-Automation und speichert die Daten nach data/. Ordnet Events den 7 App-Kategorien zu. Nutze diesen Skill auf explizite Anfrage wenn Events von dieser Quelle gescraped werden sollen.
---

# ${resolvedName} Scraper

Dieser Skill extrahiert Veranstaltungsdaten von ${input.url}.
${isAggregator ? 'Hinweis: Diese Seite ist eine Sammelseite mit Terminen unterschiedlicher Veranstalter und wechselnden Orten.' : `Hinweis: Feste Spielstätte / Einrichtung: ${resolvedName}.`}
Alle CSV-Dateien werden verbindlich im Ordner \`data/\` verwaltet.

## Format-Entscheidung (${columnCount} Spalten)
${hasTicketCol ? '- 17-Spalten-Format: Direkte Ticket-Links werden in der Spalte `Ticket-URL` mitgespeichert.' : '- 16-Spalten-Format: Standard-Schema ohne gesonderte Ticket-Spalte.'}

## Quellenspezifische Vorgaben
- ${locationRule}
- ${pageRule}

## Datenqualität (Pipeline-kompatibel)
- **Dateibenennung (neu, datumsgestempelt)**: \`data/${slug.replace(/-scraper$/, '')}-events-data-YYYY-MM-DD.csv\` (+ \`-2\`, \`-3\` bei >50 Einträgen).
- **Max. 50 Einträge pro CSV**: Siehe \`skills/csv-handling\`.
- **Vergangenheitsbereinigung**: Events mit Startdatum vor morgen entfernen (\`Startdatum < heute + 1 Tag\`; Events von heute sind nach App-Vorgabe nicht erlaubt).
- **Carry-Forward-Merge**: Jüngsten Bestand aus \`data/\` laden, bereinigen und mit neuen Events zusammenführen.
- **Maximal 15 neue Events** pro Lauf erfassen.
- **Abschluss-Check**: Nach dem Schreiben \`node csv-import-check.js\` ausführen.

## Ausführung
1. Öffne ${input.url} ausschließlich über Playwright MCP.
2. Extrahiere Events unter Beachtung der obigen Vorgaben.
3. Ordne Events den 7 App-Kategorien zu (\`skills/event-category-mapper\`).
4. Speichere die Datei in \`data/\`.
`;
  }

}
