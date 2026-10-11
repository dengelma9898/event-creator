/**
 * Fachliche Typen für Event Creator (Main- und Renderer-Prozess).
 * Beachtet das kanonische Glossar (CONTEXT.md) und ADR 0001–0004.
 *
 * Der Prozess-Saum (Kanäle, `ElectronAPI`, `window.electronAPI`) gehört in
 * `ipc-contract.ts` und wird von dort abgeleitet – nicht hier von Hand.
 */

export interface SkillMetadata {
  /** Eindeutige Kennung / Verzeichnisname, z. B. 'curt-termine-scraper' */
  id: string;
  /** Alltagssprachlicher Anzeigename, z. B. 'Curt Termine' */
  name: string;
  /** Kurzbeschreibung der Quelle */
  description: string;
  /** Ziel-Webseite der Quelle falls ermittelbar, z. B. 'https://www.curt.de/termine/84/' */
  targetUrl?: string;
  /** Domain der Quelle, z. B. 'curt.de' */
  domain?: string;
  /** Absoluter oder relativer Dateipfad zur SKILL.md */
  skillPath: string;
}

export type SourceStatusLevel = 'fresh' | 'ready' | 'recommended' | 'never';

export interface SourceStatusInfo {
  skillId: string;
  lastRunDate: string | null;
  lastRunFormatted: string;
  futureEventsCount: number;
  totalEventsCount: number;
  statusLevel: SourceStatusLevel;
  statusText: string;
  latestFile?: string;
  targetUrl?: string;
  fileCount?: number;
}

export type RunPhase =
  | 'idle'
  | 'preparing'
  | 'reading'
  | 'cancelling'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepperStepId =
  | 'check_inventory'
  | 'open_website'
  | 'extract_events'
  | 'filter_categorize'
  | 'validate_save';

export type StepperStepStatus = 'pending' | 'active' | 'completed' | 'failed';

export interface StepperStep {
  id: StepperStepId;
  label: string;
  detail?: string;
  status: StepperStepStatus;
}

export type PlanItemStatus = 'pending' | 'reading' | 'saved' | 'skipped';

export interface PlanItem {
  id: string;
  title: string;
  startDate?: string;
  detailUrl?: string;
  status: PlanItemStatus;
  skipReason?: string;
}

export function createInitialStepperSteps(domain = 'der Webseite'): StepperStep[] {
  return [
    {
      id: 'check_inventory',
      label: '1. Bestehende Termine laden & prüfen',
      status: 'pending',
      detail: 'Bestand wird mit neuen Regeln abgeglichen...',
    },
    {
      id: 'open_website',
      label: `2. Webseite ${domain} öffnen & Terminliste überblicken`,
      status: 'pending',
    },
    {
      id: 'extract_events',
      label: '3. Termine einzeln erfassen & sofort speichern',
      status: 'pending',
    },
    {
      id: 'validate_save',
      label: '4. Tabellendatei prüfen & abschließen',
      status: 'pending',
    },
  ];
}

export interface DiagnosticReport {
  timestamp: string;
  venueName: string;
  venueId: string;
  phase: RunPhase;
  technicalError: string;
  outputFiles: string[];
  formattedText: string;
}

export interface RunStatusUpdate {
  runId: string;
  venueId: string;
  venueName: string;
  phase: RunPhase;
  message: string;
  eventsFound: number;
  newEventsCount: number;
  existingEventsCount: number;
  /** Dateinamen der erzeugten CSVs – der Renderer bekommt bewusst keine Pfade. */
  fileNames: string[];
  detailsForDomi?: DiagnosticReport;
  liveEvents?: CsvEventRecord[];
  /**
   * LIVE-Zeilen, die der Agent schickte, aber die App nicht verwenden konnte –
   * etwa weil das Startdatum fehlt. Sie stehen in keiner Datei.
   */
  skippedEvents?: number;
  /** 4-Phasen-Stepper Schritte für transparente Fortschrittsanzeige */
  stepperSteps?: StepperStep[];
  /** Aktiver Schritt im 4-Phasen-Stepper */
  activeStepId?: StepperStepId;
  /** Angekündigte Kandidaten mit individuellem Bearbeitungsstatus */
  planItems?: PlanItem[];
}

export interface RunnerStartResult {
  success: boolean;
  error?: string;
}

export interface RunnerCancelResult {
  success: boolean;
}

export interface PreviewEvent {
  title: string;
  dateTime: string;
  location: string;
  category: string;
  description?: string;
  address?: string;
  price?: string;
  organizer?: string;
  imageUrl?: string;
  ticketUrl?: string;
  detailUrl?: string;
}

export interface AssistantAnalysisInput {
  url: string;
  name?: string;
  feedback?: string;
  previousSkillContent?: string;
  sameLocation?: boolean;
  address?: string;
  hasDetailPages?: boolean;
}

export interface AssistantAnalysisResult {
  success: boolean;
  error?: string;
  slug?: string;
  name?: string;
  sourceType?: 'aggregator' | 'venue';
  sourceTypeNote?: string;
  columnCount?: 16 | 17;
  columnNote?: string;
  detailPagesNote?: string;
  previewEvents?: PreviewEvent[];
  previewEvent?: PreviewEvent;
  agentNotes?: string;
  generatedSkillContent?: string;
  detailsForDomiText?: string;
}

export interface SaveSkillInput {
  slug: string;
  name: string;
  skillContent: string;
}

export interface SaveSkillResult {
  success: boolean;
  error?: string;
  skill?: SkillMetadata;
}

export interface CsvFileInfo {
  /** Dateiname ohne Verzeichnis, z. B. `curt-events-data.csv` */
  fileName: string;
  /** Absoluter Pfad zur Quell-CSV-Datei */
  filePath: string;
  /** Anzahl gültiger Event-Datensätze in der CSV */
  eventCount: number;
  /** Dateigröße in Bytes */
  sizeBytes: number;
  /** ISO-Zeitstempel der letzten Änderung */
  lastModified: string;
}

export interface CsvEventRecord {
  /** Eindeutige Kennung für React Keys & Aktionen, z. B. `${fileName}#${rowIndex}#${title}` */
  id: string;
  /** Dateiname ohne Verzeichnis, z. B. `curt-events-data.csv` – der app-eigene Identifier */
  fileName: string;
  /** Index der Datenzeile in der CSV-Datei (0-basiert, exklusive Header) */
  rowIndex: number;
  /** Titel des Events (Pflichtfeld) */
  title: string;
  /** Vollständige Beschreibung */
  description: string;
  /** Startdatum im Format YYYY-MM-DD */
  startDate: string;
  /** Enddatum im Format YYYY-MM-DD falls vorhanden */
  endDate: string;
  /** Startzeit z. B. HH:mm */
  startTime: string;
  /** Endzeit z. B. HH:mm */
  endTime: string;
  /** Veranstaltungsort inkl. Adresse */
  location: string;
  /** App-Kategorie (eine der 7 Standardkategorien) */
  category: string;
  /** Preisangabe */
  price: string;
  /** Tickets ('ja' | 'nein') */
  tickets: string;
  /** Ticket-Vorverkaufslink */
  ticketUrl: string;
  /** Kontakt E-Mail */
  email: string;
  /** Kontakt Telefon */
  phone: string;
  /** Webseite des Veranstalters */
  website: string;
  /** Social Media Link */
  socialMedia: string;
  /** Bild-URL */
  imageUrl: string;
  /** Detail-URL des Events */
  detailUrl: string;
  /**
   * Kennzeichnung für die Live- & Diff-Darstellung (Bereich 3 & 4):
   * true = neu erfasstes Event, false = bereits im vorherigen Datenbestand vorhanden.
   */
  isNew?: boolean;
  /** Alle rohen CSV-Spalten als Key-Value-Map (auch eventuelle Zusatzspalten) */
  allFields: Record<string, string>;
}

export interface DeleteEventParams {
  /** App-eigener Identifier: reiner Dateiname ohne Verzeichnis. */
  fileName: string;
  rowIndex: number;
  /**
   * Sichtfelder der gelöschten Zeile. Der Hauptprozess verlangt, dass *alle*
   * mitgegebenen Felder zusammenpassen – wiederkehrende Termine haben in den
   * echten Daten denselben Titel, deshalb ist der Titel allein nicht eindeutig.
   */
  expectedTitle?: string;
  expectedDetailUrl?: string;
  expectedStartDate?: string;
}

export interface DeleteEventResult {
  success: boolean;
  /** Kurze, deutsche Ursache – niemals Ausgaben des Prüfers. */
  error?: string;
  /** true, wenn die Datei unverändert geblieben ist. */
  fileUnchanged?: boolean;
  remainingCount?: number;
  /**
   * Kurzer deutscher Hinweis für eine *erfolgreiche* Löschung: der Rest der
   * Datei erfüllt die Import-Regeln noch nicht. Leer, wenn die Datei sauber ist.
   */
  notice?: string;
}

/** Rückgabe der Lösch-Handler im Renderer. */
export interface DeleteOutcome {
  success: boolean;
  error?: string;
  /** true, wenn die Datei unverändert blieb – für die ehrliche Fehlanzeige. */
  fileUnchanged?: boolean;
  /** Siehe {@link DeleteEventResult.notice}. */
  notice?: string;
}

export interface EventChanges {
  title?: string;
  category?: string;
  startTime?: string;
  location?: string;
}

export interface UpdateEventParams {
  /** App-eigener Identifier: reiner Dateiname ohne Verzeichnis. */
  fileName: string;
  rowIndex: number;
  /**
   * Sichtfelder der zu ändernden Zeile. Der Hauptprozess verlangt, dass alle
   * mitgegebenen Felder zusammenpassen.
   */
  expectedTitle?: string;
  expectedDetailUrl?: string;
  expectedStartDate?: string;
  changes: EventChanges;
}

export interface UpdateEventResult {
  success: boolean;
  error?: string;
  fileUnchanged?: boolean;
  notice?: string;
}

/** Rückgabe der Update-Handler im Renderer. */
export interface EditOutcome {
  success: boolean;
  error?: string;
  fileUnchanged?: boolean;
  notice?: string;
}

// ---------------------------------------------------------------------------
// Die LIVE-Zeile des Agenten
// ---------------------------------------------------------------------------

/**
 * Die Felder, die der Agent je `EVENT_LIVE`-Zeile ausgibt – an einer Stelle.
 *
 * Aus dieser einen Tabelle entstehen drei Dinge: die Felder, die der Parser
 * liest, die Beispielzeile im Prompt und die Zuordnung auf die CSV-Spalten.
 * Vorher standen Prompt und Parser auseinander: der Agent sendete `start_date`,
 * `link`, `image_url` und `categories`, gelesen wurden `startDate`, `detailUrl`,
 * `imageUrl` und `category` – jede Live-Zeile kam mit leeren Feldern an und
 * wurde so auch in die CSV geschrieben.
 */
export const LIVE_EVENT_FIELDS = {
  title: '...',
  start_date: 'YYYY-MM-DD',
  start_time: 'HH:MM',
  end_date: '',
  end_time: '',
  location: '...',
  description: '...',
  link: '...',
  image_url: '...',
  price: '...',
  organizer: '...',
  categories: '...',
} as const;

export type LiveEventKey = keyof typeof LIVE_EVENT_FIELDS;

/** Was der Agent schickt. Felder dürfen fehlen – dann gilt der Leerwert. */
export type LiveEventPayload = Partial<Record<LiveEventKey, string>>;

export const LIVE_EVENT_KEYS = Object.keys(LIVE_EVENT_FIELDS) as LiveEventKey[];

/** Die Beispielzeile für den Prompt – aus derselben Tabelle erzeugt. */
export function liveEventExampleLine(): string {
  const body = Object.entries(LIVE_EVENT_FIELDS)
    .map(([key, placeholder]) => `"${key}": "${placeholder}"`)
    .join(', ');
  return `EVENT_LIVE: {${body}}`;
}

/**
 * Wie ein LIVE-Feld auf die Spalte der `CsvEventRecord` abbildet. `null` heißt:
 * das Feld wird nur in `allFields` behalten, die App hat dafür keine Spalte.
 */
export const LIVE_EVENT_TARGETS: Record<LiveEventKey, keyof CsvEventRecord | null> = {
  title: 'title',
  start_date: 'startDate',
  start_time: 'startTime',
  end_date: 'endDate',
  end_time: 'endTime',
  location: 'location',
  description: 'description',
  link: 'detailUrl',
  image_url: 'imageUrl',
  price: 'price',
  // Die App hat keine Spalte für den Veranstalter; der Wert bleibt in allFields.
  organizer: null,
  categories: 'category',
};

/**
 * Titel und Startdatum sind Pflicht. Eine Zeile ohne beide ist in der CSV
 * wertlos – und genau solche Zeilen sind beim Abbruch als Leerwerte gelandet.
 */
export function isCompleteLiveEvent(record: { title: string; startDate: string }): boolean {
  return Boolean(record.title?.trim()) && Boolean(record.startDate?.trim());
}

/** Fehlende Pflichtfelder in einer Form, die man anzeigen kann. */
export function liveEventGap(record: { title: string; startDate: string }): string {
  const missing: string[] = [];
  if (!record.title?.trim()) missing.push('Titel');
  if (!record.startDate?.trim()) missing.push('Startdatum');
  return `fehlt: ${missing.join(' und ')}`;
}

export type { ElectronAPI } from './ipc-contract.js';
