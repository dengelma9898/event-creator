/**
 * EventWriter: Schreibt Veranstaltungen einzeln (oder im Stapel) in CSV-Dateien.
 *
 * Verwaltet:
 * - Validierung (Titel, Startdatum, Vergangenheitsfilter, Absagen, Kategorien, Tickets)
 * - Duplikaterkennung per Detail-URL und Titel#Startdatum
 * - Strikte Einhaltung des 50er-Chunkings (<quelle>-events-data-YYYY-MM-DD[-N].csv)
 * - Quoting und Escaping aller 17 Spalten
 * - BOM-freie UTF-8-Dateiausgabe
 */

import fs from 'node:fs';
import path from 'node:path';

import { APP_CATEGORIES_SET } from '../shared/event-quality.js';
import {
  isCompleteLiveEvent,
  liveEventGap,
  LIVE_EVENT_KEYS,
  LIVE_EVENT_TARGETS,
  type CsvEventRecord,
  type LiveEventKey,
} from '../shared/types.js';

export const CSV_HEADER =
  'Titel,Beschreibung,Startdatum,Enddatum,Startzeit,Endzeit,Veranstaltungsort,Kategorien,Preis,Tickets,Ticket-URL,E-Mail,Telefon,Webseite,Social Media,Bild-URL,Detail-URL';

export const MAX_ENTRIES_PER_CHUNK = 50;

/**
 * Quoting und Escaping: Doppelte Anführungszeichen verdoppeln,
 * jedes Feld sauber in Quotes einschließen.
 */
export const quote = (value: string | undefined | null): string =>
  `"${(value ?? '').replace(/"/g, '""')}"`;

export const rowOf = (event: CsvEventRecord): string =>
  [
    event.title,
    event.description,
    event.startDate,
    event.endDate,
    event.startTime,
    event.endTime,
    event.location,
    event.category,
    event.price,
    event.tickets || 'nein',
    event.ticketUrl,
    event.email,
    event.phone,
    event.website,
    event.socialMedia,
    event.imageUrl,
    event.detailUrl,
  ]
    .map(quote)
    .join(',');

export function getTodayIsoString(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getTomorrowIsoString(now: Date = new Date()): string {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeDateToIso(dateStr: string): string {
  const trimmed = (dateStr || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return trimmed;
}

export function isCancelledEvent(title: string, description = ''): boolean {
  const t = title || '';
  const d = description || '';
  const titleCancelled = /^abgesagt:/i.test(t) || /\b(abgesagt|cancelled|verschoben)\b/i.test(t);
  const descCancelled = /ersatzlos abgesagt|wurde abgesagt/i.test(d);
  return titleCancelled || descCancelled;
}

export interface AddEventOutcome {
  success: boolean;
  event?: CsvEventRecord;
  reason?: string;
  chunkFileName?: string;
  totalWritten?: number;
}

export interface WriteLiveEventsResult {
  written: number;
  skipped: { title: string; reason: string }[];
}

export interface EventWriterOptions {
  dataDir: string;
  venueBaseName: string;
  runDate?: string;
  minStartDate?: string;
}

export class EventWriter {
  private dataDir: string;
  private venueBaseName: string;
  private runDate: string;
  private minStartDate: string;

  private seenUrls = new Set<string>();
  private seenTitleDates = new Set<string>();

  private currentChunkIndex = 1;
  private currentChunkRows = 0;
  private currentChunkFilePath = '';
  private filesWritten = new Set<string>();
  private allWrittenEvents: CsvEventRecord[] = [];

  constructor(options: EventWriterOptions) {
    this.dataDir = path.resolve(options.dataDir);
    this.venueBaseName = options.venueBaseName.replace(/-scraper$/, '');
    this.runDate = options.runDate || getTodayIsoString();
    this.minStartDate = options.minStartDate || getTomorrowIsoString();

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.initChunkPointers();
  }

  public getRunDate(): string {
    return this.runDate;
  }

  public getMinStartDate(): string {
    return this.minStartDate;
  }

  public getFilesWritten(): string[] {
    return Array.from(this.filesWritten);
  }

  public getAllWrittenEvents(): CsvEventRecord[] {
    return [...this.allWrittenEvents];
  }

  public getWrittenCount(): number {
    return this.allWrittenEvents.length;
  }

  public getSeenKeys(): { urls: Set<string>; titleDates: Set<string> } {
    return {
      urls: new Set(this.seenUrls),
      titleDates: new Set(this.seenTitleDates),
    };
  }

  /**
   * Registriert bereits bekannte Schlüssel (z. B. aus vorherigen Läufen oder Phase 0),
   * damit sie nicht doppelt aufgenommen werden.
   */
  public registerExistingKeys(keys: Iterable<string>): void {
    for (const key of keys) {
      if (!key) continue;
      const trimmed = key.trim().toLowerCase();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        this.seenUrls.add(trimmed);
      } else if (trimmed.includes('#')) {
        this.seenTitleDates.add(trimmed);
      } else {
        this.seenUrls.add(trimmed);
      }
    }
  }

  private buildChunkFileName(chunkIndex: number): string {
    return chunkIndex === 1
      ? `${this.venueBaseName}-events-data-${this.runDate}.csv`
      : `${this.venueBaseName}-events-data-${this.runDate}-${chunkIndex}.csv`;
  }

  /**
   * Findet heraus, wie viele Chunks für den heutigen Snapshot bereits existieren
   * und wie viele Datenzeilen der aktuellste Chunk enthält.
   */
  private initChunkPointers(): void {
    let index = 1;
    while (true) {
      const fileName = this.buildChunkFileName(index);
      const filePath = path.join(this.dataDir, fileName);
      if (!fs.existsSync(filePath)) {
        break;
      }
      this.filesWritten.add(filePath);
      const rowCount = this.countDataRowsInFile(filePath);
      if (rowCount < MAX_ENTRIES_PER_CHUNK) {
        this.currentChunkIndex = index;
        this.currentChunkRows = rowCount;
        this.currentChunkFilePath = filePath;
        return;
      }
      index += 1;
    }

    // Wenn der vorherige Chunk voll war oder noch gar keine Datei existiert
    this.currentChunkIndex = index > 1 ? index : 1;
    this.currentChunkRows = 0;
    this.currentChunkFilePath = path.join(this.dataDir, this.buildChunkFileName(this.currentChunkIndex));
  }

  private countDataRowsInFile(filePath: string): number {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      return Math.max(0, lines.length - 1);
    } catch {
      return 0;
    }
  }

  /**
   * Schreibt einen initialen Satz von bereinigten Bestandsevents (z. B. aus Phase 0).
   * Teilt automatisch in 50er-Dateien auf und registriert die Schlüssel.
   */
  public writeInitialBatch(events: CsvEventRecord[]): string[] {
    const writtenFiles: string[] = [];
    if (!events || events.length === 0) {
      return writtenFiles;
    }

    for (const event of events) {
      this.addEventRecord(event, false);
    }

    return this.getFilesWritten();
  }

  /**
   * Fügt ein einzelnes Event hinzu, validiert es gegen alle Pipeline-Regeln
   * und hängt es sofort an die entsprechende CSV-Datei an.
   */
  public addRawEvent(data: Record<string, unknown>): AddEventOutcome {
    const parsed = this.parseRawData(data);
    return this.addEventRecord(parsed, true);
  }

  public addEventRecord(parsed: CsvEventRecord, markAsNew = true): AddEventOutcome {
    // 1. Titel-Pflichtfeld
    const title = (parsed.title || '').trim();
    if (!title) {
      return { success: false, reason: 'Titel darf nicht leer sein' };
    }

    // 2. Startdatum-Pflichtfeld
    const rawDate = (parsed.startDate || '').trim();
    if (!rawDate) {
      return { success: false, reason: 'Startdatum darf nicht leer sein' };
    }
    const startDate = normalizeDateToIso(rawDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return { success: false, reason: `Ungültiges Datumsformat "${rawDate}". Erwartet wird YYYY-MM-DD.` };
    }

    // 3. Vergangenheitsbereinigung & Events von heute ausschließen
    if (startDate < this.minStartDate) {
      return {
        success: false,
        reason: `Startdatum (${startDate}) liegt vor dem frühesten erlaubten Datum (morgen = ${this.minStartDate})`,
      };
    }

    // 4. Abgesagte Events
    const description = (parsed.description || '').trim();
    if (isCancelledEvent(title, description)) {
      return { success: false, reason: 'Event ist als abgesagt oder verschoben markiert' };
    }

    // 5. Kategorie-Validierung
    let category = (parsed.category || '').trim();
    if (category) {
      if (!APP_CATEGORIES_SET.has(category)) {
        return {
          success: false,
          reason: `Ungültige Kategorie "${category}". Erlaubt sind nur die 7 App-Kategorien oder ein leerer Wert.`,
        };
      }
    }

    // 6. Tickets-Normalisierung
    let tickets = (parsed.tickets || '').trim().toLowerCase();
    if (tickets === 'ja' || tickets === 'yes' || tickets === 'true' || tickets === '1') {
      tickets = 'ja';
    } else {
      tickets = 'nein';
    }

    // 7. Duplikatsprüfung
    const detailUrl = (parsed.detailUrl || '').trim();
    const normUrl = detailUrl.toLowerCase();
    const titleKey = `${title.trim().toLowerCase()}#${startDate}`;

    if (normUrl && this.seenUrls.has(normUrl)) {
      return { success: false, reason: `Duplikat: Detail-URL bereits vorhanden (${detailUrl})` };
    }
    if (this.seenTitleDates.has(titleKey)) {
      return { success: false, reason: `Duplikat: "${title}" am ${startDate} bereits vorhanden` };
    }

    // Alles gültig -> Zu den gesehenen Schlüsseln hinzufügen
    if (normUrl) this.seenUrls.add(normUrl);
    this.seenTitleDates.add(titleKey);

    // 8. Chunk-Wechsel bei Erreichen von MAX_ENTRIES_PER_CHUNK (50 Zeilen)
    if (this.currentChunkRows >= MAX_ENTRIES_PER_CHUNK) {
      this.currentChunkIndex += 1;
      this.currentChunkRows = 0;
      this.currentChunkFilePath = path.join(this.dataDir, this.buildChunkFileName(this.currentChunkIndex));
    }

    // Falls die Zieldatei noch nicht existiert, BOM-freien Header schreiben
    const fileExisted = fs.existsSync(this.currentChunkFilePath);
    if (!fileExisted) {
      fs.writeFileSync(this.currentChunkFilePath, `${CSV_HEADER}\n`, 'utf8');
      this.currentChunkRows = 0;
    }
    this.filesWritten.add(this.currentChunkFilePath);

    const chunkFileName = path.basename(this.currentChunkFilePath);
    this.currentChunkRows += 1;

    // Erstelle den fertigen Record mit vergebenem Dateinamen und Zeilenindex
    const record: CsvEventRecord = {
      id: `${chunkFileName}-${this.currentChunkRows}`,
      fileName: chunkFileName,
      rowIndex: this.currentChunkRows,
      title,
      description,
      startDate,
      endDate: (parsed.endDate || '').trim(),
      startTime: (parsed.startTime || '').trim(),
      endTime: (parsed.endTime || '').trim(),
      location: (parsed.location || '').trim(),
      category,
      price: (parsed.price || '').trim(),
      tickets,
      ticketUrl: (parsed.ticketUrl || '').trim(),
      email: (parsed.email || '').trim(),
      phone: (parsed.phone || '').trim(),
      website: (parsed.website || '').trim(),
      socialMedia: (parsed.socialMedia || '').trim(),
      imageUrl: (parsed.imageUrl || '').trim(),
      detailUrl,
      isNew: markAsNew,
      allFields: { ...parsed.allFields, Titel: title, Startdatum: startDate, Kategorien: category },
    };

    // Zeile anhängen
    const rowCsv = rowOf(record);
    fs.appendFileSync(this.currentChunkFilePath, `${rowCsv}\n`, 'utf8');

    this.allWrittenEvents.push(record);

    return {
      success: true,
      event: record,
      chunkFileName,
      totalWritten: this.allWrittenEvents.length,
    };
  }

  private parseRawData(data: Record<string, unknown>): CsvEventRecord {
    const record: CsvEventRecord = {
      id: '',
      fileName: '',
      rowIndex: 0,
      title: '',
      description: '',
      startDate: '',
      endDate: '',
      startTime: '',
      endTime: '',
      location: '',
      category: '',
      price: '',
      tickets: 'nein',
      ticketUrl: '',
      email: '',
      phone: '',
      website: '',
      socialMedia: '',
      imageUrl: '',
      detailUrl: '',
      allFields: Object.fromEntries(
        Object.entries(data).filter(([, v]) => typeof v === 'string')
      ) as Record<string, string>,
    };

    for (const key of LIVE_EVENT_KEYS) {
      const target = LIVE_EVENT_TARGETS[key as LiveEventKey];
      const value = data[key];
      if (target && typeof value === 'string') {
        (record[target] as string) = value.trim();
      }
    }

    // Fallbacks für Standard-Attributnamen (englisch / deutsch)
    if (!record.title) record.title = String(data.title || data.Titel || '');
    if (!record.startDate) record.startDate = String(data.startDate || data.Startdatum || data.date || '');
    if (!record.description) record.description = String(data.description || data.Beschreibung || '');
    if (!record.endDate) record.endDate = String(data.endDate || data.Enddatum || '');
    if (!record.startTime) record.startTime = String(data.startTime || data.Startzeit || data.time || '');
    if (!record.endTime) record.endTime = String(data.endTime || data.Endzeit || '');
    if (!record.location) record.location = String(data.location || data.Veranstaltungsort || data.Ort || '');
    if (!record.category) record.category = String(data.category || data.Kategorien || data.kategorie || '');
    if (!record.price) record.price = String(data.price || data.Preis || '');
    if (!record.tickets) record.tickets = String(data.tickets || data.Tickets || 'nein');
    if (!record.ticketUrl) record.ticketUrl = String(data.ticketUrl || data['Ticket-URL'] || data.ticket_url || '');
    if (!record.email) record.email = String(data.email || data['E-Mail'] || '');
    if (!record.phone) record.phone = String(data.phone || data.Telefon || '');
    if (!record.website) record.website = String(data.website || data.Webseite || '');
    if (!record.socialMedia) record.socialMedia = String(data.socialMedia || data['Social Media'] || '');
    if (!record.imageUrl) record.imageUrl = String(data.imageUrl || data['Bild-URL'] || data.image_url || '');
    if (!record.detailUrl) record.detailUrl = String(data.detailUrl || data['Detail-URL'] || data.url || '');

    return record;
  }
}

/**
 * Rückwärtskompatible Hilfsfunktion zum direkten Schreiben einer Liste (früher in live-csv.ts).
 */
export function writeLiveEventsCsv(filePath: string, events: CsvEventRecord[]): WriteLiveEventsResult {
  const skipped: WriteLiveEventsResult['skipped'] = [];
  const rows: string[] = [];

  for (const event of events) {
    if (!isCompleteLiveEvent(event)) {
      skipped.push({ title: event.title, reason: liveEventGap(event) });
      continue;
    }
    rows.push(rowOf(event));
  }

  if (rows.length === 0) {
    return { written: 0, skipped };
  }

  fs.writeFileSync(filePath, `${CSV_HEADER}\n${rows.join('\n')}\n`, 'utf8');
  return { written: rows.length, skipped };
}
