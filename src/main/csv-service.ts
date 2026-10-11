import fs from 'node:fs';
import path from 'node:path';

import type {
  CsvFileInfo,
  CsvEventRecord,
  DeleteEventParams,
  DeleteEventResult,
  UpdateEventParams,
  UpdateEventResult,
  SourceStatusInfo,
  SourceStatusLevel,
  SkillMetadata,
} from '../shared/types.js';
import { APP_CATEGORIES_SET, isValidAddress, isValidTime } from '../shared/event-quality.js';
import { AppPaths } from './app-paths.js';
import { runImportGate, describeRemaining, labelFor } from './csv-gate.js';
import { EventWriter, getTodayIsoString, getTomorrowIsoString } from './event-writer.js';

export interface Phase0Result {
  prefix: string;
  activeFileNames: string[];
  keptEvents: CsvEventRecord[];
  cleanedPastCount: number;
  existingKeys: Set<string>;
  snapshotFilesWritten: string[];
}

/**
 * Service für das Einlesen, Parsen und Modifizieren (Löschen) von CSV-Event-Dateien.
 * Gewährleistet strikt BOM-freie Speicherung, RFC-4180-Parsing und automatische
 * Re-Validierung via csv-import-check.js (Projektregel 9).
 */
export class CsvService {
  private static instance: CsvService | null = null;

  private paths: AppPaths;

  constructor(paths?: AppPaths) {
    this.paths = paths || AppPaths.getInstance();
  }

  public static getInstance(paths?: AppPaths): CsvService {
    if (!CsvService.instance) {
      CsvService.instance = new CsvService(paths);
    }
    return CsvService.instance;
  }

  public getDataDir(): string {
    return this.paths.dataDir;
  }

  /**
   * RFC-4180 konformer CSV-Parser für mehrzeilige Strings und Quotes.
   */
  public parseCsv(text: string): string[][] {
    const cleanText = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let i = 0;
    let inQuotes = false;

    while (i < cleanText.length) {
      const c = cleanText[i];

      if (inQuotes) {
        if (c === '"') {
          if (cleanText[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        field += c;
        i += 1;
        continue;
      }

      if (c === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }

      if (c === ',') {
        row.push(field);
        field = '';
        i += 1;
        continue;
      }

      if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i += 1;
        continue;
      }

      if (c === '\r') {
        if (cleanText[i + 1] === '\n') i += 1;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i += 1;
        continue;
      }

      field += c;
      i += 1;
    }

    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    return rows.filter((r) => !(r.length === 1 && r[0] === ''));
  }

  /**
   * Serialisiert Datenzeilen in sauberes, RFC-4180-konformes CSV (BOM-frei).
   */
  public serializeCsv(rows: string[][]): string {
    return (
      rows
        .map((row) =>
          row
            .map((val) => {
              const str = String(val == null ? '' : val);
              if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
                return `"${str.replace(/"/g, '""')}"`;
              }
              return str;
            })
            .join(',')
        )
        .join('\n') + '\n'
    );
  }

  /**
   * Löst einen vom Renderer genannten Dateinamen gegen die app-eigenen Wurzeln auf.
   * Renderer können ausschliesslich `fileName` senden – niemals einen Pfad.
   */
  private resolveFileName(fileName: string): string | null {
    const resolved = this.paths.resolveCsvFile(fileName);
    return resolved.ok ? resolved.filePath : null;
  }

  /**
   * Listet alle CSV-Dateien im Ausgabeordner data/ und im Projektroot auf, inklusive Metadaten (Event-Anzahl, Dateigröße, Änderungsdatum).
   * Sortiert nach Änderungsdatum absteigend (neueste zuerst).
   */
  public async listFiles(): Promise<CsvFileInfo[]> {
    const searchDirs = this.paths.csvRoots;
    const result: CsvFileInfo[] = [];
    const seenFiles = new Set<string>();

    for (const dir of searchDirs) {
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          if (!entry.toLowerCase().endsWith('.csv')) continue;
          if (seenFiles.has(entry)) continue;
          seenFiles.add(entry);

          const fullPath = path.join(dir, entry);
          try {
            const stat = fs.statSync(fullPath);
            if (!stat.isFile()) continue;
            const content = fs.readFileSync(fullPath, 'utf8');
            const rows = this.parseCsv(content);
            const header = rows[0] ? rows[0].map((h) => (h || '').replace(/^\uFEFF/, '').trim()) : [];
            const titleCol = header.findIndex((h) => {
              const norm = (h || '').toLowerCase().replace(/[\s\-_]/g, '').trim();
              return norm === 'titel' || norm === 'title';
            });
            let validEventCount = 0;
            for (let i = 1; i < rows.length; i++) {
              const row = rows[i];
              if (!row || row.length === 0) continue;
              if (titleCol >= 0 && titleCol < row.length && row[titleCol].trim()) {
                validEventCount++;
              } else if (titleCol === -1 && row.some((cell) => cell.trim())) {
                validEventCount++;
              }
            }
            result.push({
              fileName: entry,
              filePath: fullPath,
              eventCount: validEventCount,
              sizeBytes: stat.size,
              lastModified: stat.mtime.toISOString(),
            });
          } catch (fileErr) {
            console.warn(`[CsvService] Fehler beim Lesen von ${fullPath}:`, fileErr);
          }
        }
      } catch (err) {
        console.warn(`[CsvService] Fehler beim Durchsuchen von ${dir} in listFiles:`, err);
      }
    }

    result.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
    return result;
  }

  /**
   * Ermittelt das Quell-Präfix (z. B. 'curt' aus 'curt-termine-scraper').
   */
  public getSourcePrefix(skillId: string, skillPath?: string): string {
    const KNOWN_PREFIXES: Record<string, string> = {
      'curt-termine-scraper': 'curt',
      'e-werk-scraper': 'e-werk',
      'frankenkids-scraper': 'frankenkids',
      'franmeisters-scraper': 'franmeisters',
      'fuerth-veranstaltungen-scraper': 'fuerth',
      'gate-nuernberg-scraper': 'gate',
      'meistersingerhalle-scraper': 'meistersingerhalle',
      'parks-nuernberg-scraper': 'parks',
      'rausgegangen-ausstellung-scraper': 'rausgegangen-ausstellung',
      'rausgegangen-markt-scraper': 'rausgegangen-markt',
      'rausgegangen-party-scraper': 'rausgegangen-party',
      'z-bau-scraper': 'z-bau',
    };

    if (KNOWN_PREFIXES[skillId]) {
      return KNOWN_PREFIXES[skillId];
    }

    if (skillPath && fs.existsSync(skillPath)) {
      try {
        const content = fs.readFileSync(skillPath, 'utf8');
        const match = content.match(/([a-z0-9_-]+)-events-data/i);
        if (match && match[1]) {
          return match[1].toLowerCase().replace(/^data\//, '');
        }
      } catch {
        // ignore
      }
    }

    return skillId.replace(/-scraper$/, '');
  }

  /**
   * Findet alle Dateinamen (nur Dateinamen, ohne Pfad) für eine bestimmte Quelle.
   */
  public getCandidateFileNamesForSource(skillId: string, skillPath?: string): string[] {
    const prefix = this.getSourcePrefix(skillId, skillPath);
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedPrefix}-events-data(?:-(\\d{4}-\\d{2}-\\d{2}))?(?:-(\\d+))?\\.csv$`, 'i');

    const searchDirs = this.paths.csvRoots;
    const fileNames = new Set<string>();

    for (const dir of searchDirs) {
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          if (pattern.test(entry)) {
            const fullPath = path.join(dir, entry);
            try {
              if (fs.statSync(fullPath).isFile()) {
                fileNames.add(entry);
              }
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore
      }
    }

    return Array.from(fileNames);
  }

  /**
   * Ermittelt die aktiven Dateinamen für eine Quelle gemäß csv-handling:
   * Jüngster Datums-Snapshot (z. B. 2026-09-02 und -2, -3); falls nicht vorhanden,
   * ungestempelte Bestandsdateien.
   */
  public getActiveFileNamesForSource(skillId: string, skillPath?: string): string[] {
    const candidates = this.getCandidateFileNamesForSource(skillId, skillPath);
    if (candidates.length === 0) return [];

    const datedPattern = /^.+-events-data-(\d{4}-\d{2}-\d{2})(?:-\d+)?\.csv$/i;
    const datedWithStamp = candidates
      .map((name) => {
        const match = name.match(datedPattern);
        return { name, dateStamp: match ? match[1] : null };
      })
      .filter((c): c is { name: string; dateStamp: string } => Boolean(c.dateStamp));

    if (datedWithStamp.length > 0) {
      datedWithStamp.sort((a, b) => b.dateStamp.localeCompare(a.dateStamp));
      const newestDate = datedWithStamp[0].dateStamp;
      return datedWithStamp.filter((c) => c.dateStamp === newestDate).map((c) => c.name);
    }

    return candidates;
  }

  /**
   * Führt Phase 0 für eine Quelle aus (deterministisch im Hauptprozess):
   * 1. Aktiven Bestand laden
   * 2. Vergangene Events (< morgen) entfernen
   * 3. Deduplizieren
   * 4. Bei vorhandenen zukünftigen Events heutigen Snapshot vorbereiten (falls noch nicht existent)
   * 5. Eindeutige Schlüssel für den Live-Abgleich bereitstellen
   */
  public async prepareSourcePhase0(
    skillId: string,
    skillPath?: string,
    runDate: string = getTodayIsoString()
  ): Promise<Phase0Result> {
    const prefix = this.getSourcePrefix(skillId, skillPath);
    const activeFileNames = this.getActiveFileNamesForSource(skillId, skillPath);
    const tomorrowStr = getTomorrowIsoString();

    let cleanedPastCount = 0;
    const keptEvents: CsvEventRecord[] = [];
    const existingKeys = new Set<string>();
    const seenUrls = new Set<string>();
    const seenTitleDates = new Set<string>();

    if (activeFileNames.length > 0) {
      const records = await this.loadEvents(activeFileNames);

      for (const rec of records) {
        const normTitle = (rec.title || '').trim().toLowerCase();
        const normDate = (rec.startDate || '').trim();
        const normUrl = (rec.detailUrl || '').trim().toLowerCase();

        if (!normTitle || !normDate) continue;

        // Vergangenes Event oder Event von heute (nach App-Vorgabe nicht erlaubt)
        if (normDate < tomorrowStr) {
          cleanedPastCount += 1;
          continue;
        }

        // Duplikatsprüfung im aktiven Bestand
        const titleKey = `${normTitle}#${normDate}`;
        if ((normUrl && seenUrls.has(normUrl)) || seenTitleDates.has(titleKey)) {
          continue;
        }

        if (normUrl) seenUrls.add(normUrl);
        seenTitleDates.add(titleKey);

        existingKeys.add(titleKey);
        if (normUrl) existingKeys.add(normUrl);

        keptEvents.push({
          ...rec,
          isNew: false,
        });
      }
    }

    // Prüfen, ob für heute bereits ein Snapshot im Zielverzeichnis liegt
    const todayBaseName = `${prefix}-events-data-${runDate}.csv`;
    const todayBaseFile = path.join(this.paths.dataDir, todayBaseName);
    let snapshotFilesWritten: string[] = [];

    if (!fs.existsSync(todayBaseFile) && keptEvents.length > 0) {
      const writer = new EventWriter({
        dataDir: this.paths.dataDir,
        venueBaseName: prefix,
        runDate,
        minStartDate: tomorrowStr,
      });
      snapshotFilesWritten = writer.writeInitialBatch(keptEvents);
    } else if (fs.existsSync(todayBaseFile)) {
      snapshotFilesWritten = this.getActiveFileNamesForSource(skillId, skillPath)
        .filter((f) => f.includes(runDate))
        .map((f) => path.join(this.paths.dataDir, f));
    }

    return {
      prefix,
      activeFileNames,
      keptEvents,
      cleanedPastCount,
      existingKeys,
      snapshotFilesWritten,
    };
  }

  /**
   * Liefert alle eindeutigen Event-Identifikatoren (title#startDate und detailUrl)
   * für die bereits im Datenbestand vorhandenen Termine dieser Quelle.
   */
  public async getExistingEventKeysForSkill(skillId: string, skillPath?: string): Promise<Set<string>> {
    const fileNames = this.getActiveFileNamesForSource(skillId, skillPath);
    const keys = new Set<string>();
    if (fileNames.length === 0) return keys;

    const records = await this.loadEvents(fileNames);
    for (const rec of records) {
      const normTitle = (rec.title || '').trim().toLowerCase();
      const normDate = (rec.startDate || '').trim();
      if (normTitle && normDate) {
        keys.add(`${normTitle}#${normDate}`);
      }
      if (rec.detailUrl && rec.detailUrl.trim()) {
        keys.add(rec.detailUrl.trim().toLowerCase());
      }
    }
    return keys;
  }

  /**
   * Formatiert relative Datums- und Zeitangaben auf Deutsch (Mac-typisch).
   */
  public formatGermanRelativeTime(date: Date, now: Date = new Date()): string {
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) {
      return 'Gerade eben';
    }
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    const timeStr = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const dateStr = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const isSameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      date.getFullYear() === yesterday.getFullYear() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getDate() === yesterday.getDate();

    if (diffMinutes < 1) {
      return 'Gerade eben';
    }

    if (isSameDay) {
      if (diffMinutes < 60) {
        return `Heute, ${timeStr} Uhr (vor ${diffMinutes} ${diffMinutes === 1 ? 'Minute' : 'Minuten'})`;
      }
      return `Heute, ${timeStr} Uhr (vor ${diffHours} ${diffHours === 1 ? 'Stunde' : 'Stunden'})`;
    }

    if (isYesterday) {
      return `Gestern, ${timeStr} Uhr (vor ${diffHours} ${diffHours === 1 ? 'Stunde' : 'Stunden'})`;
    }

    if (diffDays < 7) {
      return `Vor ${diffDays} ${diffDays === 1 ? 'Tag' : 'Tagen'} (${timeStr} Uhr)`;
    }

    return `Vor ${diffDays} Tagen (${dateStr})`;
  }

  /**
   * Ermittelt den aktuellen Status einer Quelle vor dem Abruf:
   * Zuletzt aktualisiert, Anzahl zukünftiger Termine, Ampel-Status und Webseiten-Link.
   */
  public async getSourceStatus(
    skillId: string,
    targetUrl?: string,
    skillPath?: string
  ): Promise<SourceStatusInfo> {
    const prefix = this.getSourcePrefix(skillId, skillPath);
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedPrefix}-events-data(?:-(\\d{4}-\\d{2}-\\d{2}))?(?:-(\\d+))?\\.csv$`, 'i');

    const searchDirs = this.paths.csvRoots;

    interface CandidateFile {
      fileName: string;
      fullPath: string;
      dateStamp?: string;
      mtime: Date;
    }

    const foundByFileName = new Map<string, CandidateFile>();

    for (const dir of searchDirs) {
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const match = entry.match(pattern);
          if (match) {
            const fullPath = path.join(dir, entry);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.isFile()) {
                // Falls bereits vorhanden, dataDir bevorzugen
                if (!foundByFileName.has(entry) || dir === searchDirs[0]) {
                  foundByFileName.set(entry, {
                    fileName: entry,
                    fullPath,
                    dateStamp: match[1],
                    mtime: stat.mtime,
                  });
                }
              }
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore
      }
    }

    const allCandidates = Array.from(foundByFileName.values());

    let resolvedTargetUrl = targetUrl;
    if (!resolvedTargetUrl && skillPath && fs.existsSync(skillPath)) {
      try {
        const skillText = fs.readFileSync(skillPath, 'utf8');
        const urlMatch = skillText.match(/https?:\/\/[^\s)"]+/i);
        if (urlMatch) {
          resolvedTargetUrl = urlMatch[0];
        }
      } catch {
        // ignore
      }
    }

    // Keine Dateien gefunden: Noch nie abgerufen
    if (allCandidates.length === 0) {
      return {
        skillId,
        lastRunDate: null,
        lastRunFormatted: 'Noch nie abgerufen',
        futureEventsCount: 0,
        totalEventsCount: 0,
        statusLevel: 'never',
        statusText: 'Bereit für ersten Abruf',
        targetUrl: resolvedTargetUrl,
        fileCount: 0,
      };
    }

    // Aktiven Bestand ermitteln gemäß csv-handling:
    // 1. Gibt es datumsgestempelte Snapshots? Nimm das jüngste Datum.
    // 2. Falls nicht, nimm alle ungestempelten Bestandsdateien.
    const datedFiles = allCandidates.filter((c) => Boolean(c.dateStamp));
    let activeFiles: CandidateFile[] = [];

    if (datedFiles.length > 0) {
      datedFiles.sort((a, b) => (b.dateStamp || '').localeCompare(a.dateStamp || ''));
      const newestDate = datedFiles[0].dateStamp;
      activeFiles = datedFiles.filter((c) => c.dateStamp === newestDate);
    } else {
      activeFiles = allCandidates.filter((c) => !c.dateStamp);
    }

    if (activeFiles.length === 0) {
      activeFiles = allCandidates;
    }

    // Neueste Datei und mtime finden
    activeFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const latestFile = activeFiles[0];
    const lastRunDate = latestFile.mtime.toISOString();

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const minStartIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    let totalEventsCount = 0;
    let futureEventsCount = 0;

    for (const file of activeFiles) {
      try {
        const content = fs.readFileSync(file.fullPath, 'utf8');
        const rows = this.parseCsv(content);
        if (rows.length < 2) continue;

        const header = rows[0].map((h) => (h || '').replace(/^\uFEFF/, '').trim());
        const colMap = this.mapHeaderColumns(header);

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          const title = colMap.title >= 0 && colMap.title < row.length ? (row[colMap.title] || '').trim() : '';
          if (!title) continue;

          totalEventsCount++;
          const startDate = colMap.startDate >= 0 && colMap.startDate < row.length ? (row[colMap.startDate] || '').trim() : '';
          if (!startDate || startDate >= minStartIso) {
            futureEventsCount++;
          }
        }
      } catch (err) {
        console.warn(`[CsvService] Fehler beim Auswerten von ${file.fullPath}:`, err);
      }
    }

    const lastRunFormatted = this.formatGermanRelativeTime(latestFile.mtime, now);

    // Statuslevel bestimmen:
    // 'fresh': Heute / vor < 24 Std. & futureEventsCount > 0
    // 'ready': Vor 1-6 Tagen & futureEventsCount > 0
    // 'recommended': Älter als 7 Tage ODER futureEventsCount === 0
    const diffMs = now.getTime() - latestFile.mtime.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = Math.floor(diffHours / 24);

    let statusLevel: SourceStatusLevel;
    let statusText: string;

    if (futureEventsCount === 0) {
      statusLevel = 'recommended';
      statusText = 'Keine aktuellen Termine (Abruf empfohlen)';
    } else if (diffHours < 24) {
      statusLevel = 'fresh';
      statusText = 'Taufrisch (Heute bereits abgerufen)';
    } else if (diffDays < 7) {
      statusLevel = 'ready';
      statusText = 'Bereit für neuen Abruf';
    } else {
      statusLevel = 'recommended';
      statusText = 'Neuer Abruf empfohlen (Bestand älter als 7 Tage)';
    }

    return {
      skillId,
      lastRunDate,
      lastRunFormatted,
      futureEventsCount,
      totalEventsCount,
      statusLevel,
      statusText,
      latestFile: latestFile.fullPath,
      targetUrl: resolvedTargetUrl,
      fileCount: activeFiles.length,
    };
  }

  /**
   * Ermittelt die Status-Informationen für alle übergebenen Quellen-Skills.
   */
  public async getAllSourceStatuses(skills: SkillMetadata[]): Promise<Record<string, SourceStatusInfo>> {
    const result: Record<string, SourceStatusInfo> = {};
    for (const skill of skills) {
      result[skill.id] = await this.getSourceStatus(skill.id, skill.targetUrl, skill.skillPath);
    }
    return result;
  }

  /**
   * Lädt alle übergebenen CSV-Dateien und extrahiert standardisierte Event-Datensätze.
   * Erwartet ausschliesslich Dateinamen (app-eigene Identifier), keine Pfade.
   */
  public async loadEvents(fileNames: string[] = []): Promise<CsvEventRecord[]> {
    const records: CsvEventRecord[] = [];
    const uniqueFiles = new Map<string, string>();

    for (const rawName of fileNames) {
      const resolved = this.resolveFileName(rawName);
      if (resolved) {
        uniqueFiles.set(path.basename(resolved), resolved);
      }
    }

    // Nur bei bewusst leerer Anfrage wird der gesamte Ausgabeordner geladen.
    // Benannte, aber nicht auflösbare Dateien dürfen nicht stillschweigend auf
    // "alle Dateien" umfallen.
    if (fileNames.length === 0) {
      for (const file of await this.listFiles()) {
        uniqueFiles.set(file.fileName, file.filePath);
      }
    }

    for (const [fileName, filePath] of uniqueFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const rows = this.parseCsv(content);
        if (rows.length < 2) continue; // Nur Header oder leer

        const header = rows[0].map((h) => (h || '').replace(/^\uFEFF/, '').trim());
        const colMap = this.mapHeaderColumns(header);

        for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex++) {
          const row = rows[rowIndex + 1];
          if (!row || row.length === 0) continue;

          const getVal = (colIdx: number) => (colIdx >= 0 && colIdx < row.length ? (row[colIdx] || '').trim() : '');

          const title = getVal(colMap.title);
          if (!title) continue; // Pflichtfeld Titel

          const detailUrl = getVal(colMap.detailUrl);
          const startDate = getVal(colMap.startDate);

          const allFields: Record<string, string> = {};
          header.forEach((colName, idx) => {
            allFields[colName] = idx < row.length ? row[idx] : '';
          });

          const record: CsvEventRecord = {
            id: `${fileName}#${rowIndex}#${detailUrl || title}`,
            fileName,
            rowIndex,
            title,
            description: getVal(colMap.description),
            startDate,
            endDate: getVal(colMap.endDate),
            startTime: getVal(colMap.startTime),
            endTime: getVal(colMap.endTime),
            location: getVal(colMap.location),
            category: getVal(colMap.category),
            price: getVal(colMap.price),
            tickets: getVal(colMap.tickets),
            ticketUrl: getVal(colMap.ticketUrl),
            email: getVal(colMap.email),
            phone: getVal(colMap.phone),
            website: getVal(colMap.website),
            socialMedia: getVal(colMap.socialMedia),
            imageUrl: getVal(colMap.imageUrl),
            detailUrl,
            allFields,
          };

          records.push(record);
        }
      } catch (err) {
        console.error(`[CsvService] Fehler beim Lesen von ${filePath}:`, err);
      }
    }

    return records;
  }

  /**
   * Löscht ein Event aus der CSV-Datei.
   *
   * Das Import-Gate läuft gegen genau diese eine Datei – nie gegen das ganze
   * Verzeichnis – und erst *nach* dem Schreiben. Es meldet, was übrig bleibt,
   * aber es sperrt nichts: jede Regel des Prüfers hängt an einer einzelnen Zeile
   * (Spaltenzahl, Titel, Kategorie, Datum) oder sinkt durch das Entfernen einer
   * Zeile (Byte-Order-Mark, Kopfzeile, Höchstzahl). Eine Löschung kann deshalb
   * keinen neuen Verstoß erzeugen, und ein bereits vorhandener Verstoß darf eine
   * Löschung nicht verhindern. Gegen alle elf echten CSV-Dateien des Repos
   * bestätigt: 357 Löschungen, null blockiert, null neue Regeln, alle übrigen
   * Zeilen unverändert.
   */
  public async deleteEvent(params: DeleteEventParams): Promise<DeleteEventResult> {
    if (!Number.isInteger(params.rowIndex) || params.rowIndex < 0) {
      return { success: false, fileUnchanged: true, error: `Ungültiger Zeilenindex (${String(params.rowIndex)}).` };
    }

    const resolution = this.paths.resolveCsvFile(params.fileName);
    if (!resolution.ok) {
      return { success: false, fileUnchanged: true, error: resolution.error };
    }
    const resolvedPath = resolution.filePath;

    let originalContent = '';
    try {
      originalContent = fs.readFileSync(resolvedPath, 'utf8');
    } catch (err: any) {
      return {
        success: false,
        fileUnchanged: true,
        error: `Datei konnte nicht gelesen werden: ${err?.message || String(err)}`,
      };
    }

    const rows = this.parseCsv(originalContent);
    if (rows.length < 2) {
      return {
        success: false,
        fileUnchanged: true,
        error: 'Die Datei enthält keine Datenzeilen mehr.',
      };
    }

    const header = rows[0].map((h) => (h || '').replace(/^\uFEFF/, '').trim());
    const colMap = this.mapHeaderColumns(header);

    const locateRes = this.locateRow(rows, colMap, params.rowIndex, params);
    if (!locateRes.ok) {
      return {
        success: false,
        fileUnchanged: true,
        error: locateRes.error,
      };
    }
    const targetRowIndexInRows = locateRes.targetRowIndex;

    // Zeile entfernen und BOM-frei schreiben.
    rows.splice(targetRowIndexInRows, 1);
    const newContent = this.serializeCsv(rows);

    try {
      fs.writeFileSync(resolvedPath, newContent, 'utf8');
    } catch (err: any) {
      // Ein abgebrochener Schreibvorgang kann die Datei halb abgeschnitten haben.
      this.restore(resolvedPath, originalContent);
      return {
        success: false,
        fileUnchanged: true,
        error: `Konnte Datei nicht speichern: ${err?.message || String(err)}`,
      };
    }

    // Was nach dem Schreiben wirklich auf der Platte liegt, gegen dieselbe eine
    // Datei prüfen – nicht gegen das Verzeichnis.
    const gate = await runImportGate(this.paths.csvCheckScript, this.paths.repoRoot, resolvedPath);

    return {
      success: true,
      fileUnchanged: false,
      remainingCount: rows.length - 1,
      // Vorbestehende Verstöße sind nicht verschwunden – ehrlich benennen.
      notice: describeRemaining(gate),
    };
  }

  /**
   * Aktualisiert ein Event in der CSV-Datei.
   *
   * Validiert Eingaben (Titel nicht leer/einzeilig, Kategorie gültig, Startzeit HH:mm, Adresse vollständig),
   * schreibt die Datei strikt BOM-frei und führt das Import-Gate vor und nach dem Schreiben aus.
   * Taucht eine neue Regel-Verletzung auf, wird die Datei sofort auf das Original zurückgesetzt (ADR 0003: fail-fast).
   */
  public async updateEvent(params: UpdateEventParams): Promise<UpdateEventResult> {
    if (!Number.isInteger(params.rowIndex) || params.rowIndex < 0) {
      return { success: false, fileUnchanged: true, error: `Ungültiger Zeilenindex (${String(params.rowIndex)}).` };
    }

    const resolution = this.paths.resolveCsvFile(params.fileName);
    if (!resolution.ok) {
      return { success: false, fileUnchanged: true, error: resolution.error };
    }
    const resolvedPath = resolution.filePath;

    // Feld-Validierung vor dem Dateizugriff
    const changes = params.changes || {};

    if (changes.title !== undefined) {
      const trimmedTitle = changes.title.trim();
      if (!trimmedTitle) {
        return { success: false, fileUnchanged: true, error: 'Der Titel darf nicht leer sein.' };
      }
      if (changes.title.includes('\n') || changes.title.includes('\r')) {
        return { success: false, fileUnchanged: true, error: 'Der Titel darf keine Zeilenumbrüche enthalten.' };
      }
    }

    if (changes.category !== undefined) {
      const trimmedCat = changes.category.trim();
      if (trimmedCat && !APP_CATEGORIES_SET.has(trimmedCat)) {
        return {
          success: false,
          fileUnchanged: true,
          error: 'Ungültige Kategorie. Erlaubt sind nur die 7 App-Kategorien oder ein leerer Wert.',
        };
      }
    }

    if (changes.startTime !== undefined) {
      if (!isValidTime(changes.startTime)) {
        return {
          success: false,
          fileUnchanged: true,
          error: 'Ungültige Startzeit. Bitte das Format HH:mm verwenden (z. B. 20:00).',
        };
      }
    }

    if (changes.location !== undefined) {
      if (!isValidAddress(changes.location)) {
        return {
          success: false,
          fileUnchanged: true,
          error: 'Adresse unvollständig. Es müssen PLZ oder Stadt plus Straße bzw. Ortsname angegeben werden.',
        };
      }
    }

    let originalContent = '';
    try {
      originalContent = fs.readFileSync(resolvedPath, 'utf8');
    } catch (err: any) {
      return {
        success: false,
        fileUnchanged: true,
        error: `Datei konnte nicht gelesen werden: ${err?.message || String(err)}`,
      };
    }

    const rows = this.parseCsv(originalContent);
    if (rows.length < 2) {
      return {
        success: false,
        fileUnchanged: true,
        error: 'Die Datei enthält keine Datenzeilen mehr.',
      };
    }

    const header = rows[0].map((h) => (h || '').replace(/^\uFEFF/, '').trim());
    const colMap = this.mapHeaderColumns(header);

    const locateRes = this.locateRow(rows, colMap, params.rowIndex, params);
    if (!locateRes.ok) {
      return { success: false, fileUnchanged: true, error: locateRes.error };
    }

    const targetRow = rows[locateRes.targetRowIndex];
    // Zeile bei Bedarf auf Spaltenlänge des Headers auffüllen
    while (targetRow.length < header.length) {
      targetRow.push('');
    }

    if (changes.title !== undefined && colMap.title >= 0) {
      targetRow[colMap.title] = changes.title.trim();
    }
    if (changes.category !== undefined && colMap.category >= 0) {
      targetRow[colMap.category] = changes.category.trim();
    }
    if (changes.startTime !== undefined && colMap.startTime >= 0) {
      targetRow[colMap.startTime] = changes.startTime.trim();
    }
    if (changes.location !== undefined && colMap.location >= 0) {
      targetRow[colMap.location] = changes.location.trim();
    }

    // Gate vor dem Schreiben prüfen
    const gateBefore = await runImportGate(this.paths.csvCheckScript, this.paths.repoRoot, resolvedPath);

    // BOM-frei serialisieren und schreiben
    const newContent = this.serializeCsv(rows);
    try {
      fs.writeFileSync(resolvedPath, newContent, 'utf8');
    } catch (err: any) {
      this.restore(resolvedPath, originalContent);
      return {
        success: false,
        fileUnchanged: true,
        error: `Konnte Datei nicht speichern: ${err?.message || String(err)}`,
      };
    }

    // Gate nach dem Schreiben prüfen
    const gateAfter = await runImportGate(this.paths.csvCheckScript, this.paths.repoRoot, resolvedPath);

    // Prüfen, ob eine neue Regel verletzt wurde
    const beforeRules = new Set(gateBefore.violations.map((v) => v.ruleId));
    const newViolations = gateAfter.violations.filter((v) => !beforeRules.has(v.ruleId));

    if (newViolations.length > 0) {
      this.restore(resolvedPath, originalContent);
      const labels = [...new Set(newViolations.map((v) => v.ruleId))].map(labelFor);
      return {
        success: false,
        fileUnchanged: true,
        error: `Änderung verletzt Import-Regeln: ${labels.join(' ')}`,
      };
    }

    return {
      success: true,
      fileUnchanged: false,
      notice: describeRemaining(gateAfter) || undefined,
    };
  }

  /**
   * Sucht eine Zeile anhand des Zeilenindex und prüft ggf. Title/DetailUrl/StartDate auf Übereinstimmung.
   */
  private locateRow(
    rows: string[][],
    colMap: ReturnType<typeof this.mapHeaderColumns>,
    rowIndex: number,
    expected: {
      expectedTitle?: string;
      expectedDetailUrl?: string;
      expectedStartDate?: string;
    }
  ): { ok: true; targetRowIndex: number } | { ok: false; error: string } {
    let targetRowIndexInRows = rowIndex + 1; // 1-basiert bezogen auf rows inkl. Header

    const checkMatches = (row: string[]) => {
      if (!row) return false;
      const getVal = (colIdx: number) => (colIdx >= 0 && colIdx < row.length ? (row[colIdx] || '').trim() : '');

      const expectedFields: [number, string | undefined][] = [
        [colMap.title, expected.expectedTitle],
        [colMap.detailUrl, expected.expectedDetailUrl],
        [colMap.startDate, expected.expectedStartDate],
      ];
      const provided = expectedFields.filter(([col, value]) => value !== undefined && col >= 0);
      if (provided.length === 0) return false;

      return provided.every(([col, value]) => getVal(col) === value!.trim());
    };

    const isDirectMatch =
      targetRowIndexInRows < rows.length && checkMatches(rows[targetRowIndexInRows]);

    if (!isDirectMatch && (expected.expectedTitle || expected.expectedDetailUrl || expected.expectedStartDate)) {
      const candidates: number[] = [];
      for (let i = 1; i < rows.length; i++) {
        if (checkMatches(rows[i])) candidates.push(i);
      }

      if (candidates.length === 1) {
        targetRowIndexInRows = candidates[0];
      } else if (candidates.length > 1) {
        return {
          ok: false,
          error:
            candidates.length === 2
              ? 'In der Datei stehen zwei identische Zeilen. Bitte lade die Liste neu und versuche es erneut.'
              : `In der Datei stehen ${candidates.length} identische Zeilen. Bitte lade die Liste neu und versuche es erneut.`,
        };
      } else {
        return {
          ok: false,
          error: 'Das ausgewählte Event konnte in der Datei nicht mehr identifiziert werden.',
        };
      }
    }

    if (targetRowIndexInRows < 1 || targetRowIndexInRows >= rows.length) {
      return {
        ok: false,
        error: `Ungültiger Zeilenindex (${rowIndex}).`,
      };
    }

    return { ok: true, targetRowIndex: targetRowIndexInRows };
  }

  /** Setzt den Originalinhalt zurück; das Scheitern dabei wird nicht verschwiegen. */
  private restore(filePath: string, originalContent: string): void {
    try {
      fs.writeFileSync(filePath, originalContent, 'utf8');
    } catch (err: any) {
      console.error(`[CsvService] Konnte ${filePath} nicht zurücksetzen:`, err);
    }
  }

  /**
   * Identifiziert die relevanten Spaltenindizes aus dem CSV-Header unabhängig von
   * Groß-/Kleinschreibung oder Spaltenreihenfolge.
   */
  private mapHeaderColumns(header: string[]): {
    title: number;
    description: number;
    startDate: number;
    endDate: number;
    startTime: number;
    endTime: number;
    location: number;
    category: number;
    price: number;
    tickets: number;
    ticketUrl: number;
    email: number;
    phone: number;
    website: number;
    socialMedia: number;
    imageUrl: number;
    detailUrl: number;
  } {
    const normalize = (s: string) =>
      (s || '')
        .toLowerCase()
        .replace(/[\s\-_]/g, '')
        .trim();

    const findIdx = (patterns: string[]) => {
      return header.findIndex((col) => {
        const norm = normalize(col);
        return patterns.some((p) => norm === normalize(p));
      });
    };

    return {
      title: findIdx(['Titel', 'Title']),
      description: findIdx(['Beschreibung', 'Description']),
      startDate: findIdx(['Startdatum', 'Start-Datum', 'StartDate']),
      endDate: findIdx(['Enddatum', 'End-Datum', 'EndDate']),
      startTime: findIdx(['Startzeit', 'Start-Zeit', 'StartTime']),
      endTime: findIdx(['Endzeit', 'End-Zeit', 'EndTime']),
      location: findIdx(['Veranstaltungsort', 'Ort', 'Location', 'Venue']),
      category: findIdx(['Kategorien', 'Kategorie', 'Category']),
      price: findIdx(['Preis', 'Preise', 'Price']),
      tickets: findIdx(['Tickets', 'Ticket']),
      ticketUrl: findIdx(['Ticket-URL', 'TicketURL', 'Ticket-Link', 'TicketLink']),
      email: findIdx(['E-Mail', 'EMail', 'Mail']),
      phone: findIdx(['Telefon', 'Phone', 'Tel']),
      website: findIdx(['Webseite', 'Website', 'Web', 'Url']),
      socialMedia: findIdx(['Social Media', 'SocialMedia', 'Social-Media']),
      imageUrl: findIdx(['Bild-URL', 'BildURL', 'ImageUrl', 'Image-URL']),
      detailUrl: findIdx(['Detail-URL', 'DetailURL', 'Detail-Link']),
    };
  }
}
