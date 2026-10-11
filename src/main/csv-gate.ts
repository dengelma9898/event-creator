import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Das Import-Gate – die verbindliche Regel für import-sicherere CSV-Dateien.
 *
 * Hier steht sie ausdrücklich, statt in der Prosa von `.cursorrules` zu stehen:
 * jede Regel hat eine Kennung, eine deutsche Kurzbeschreibung für die Oberfläche
 * und ein Erkennungsmuster auf die Ausgabe von `csv-import-check.js`.
 *
 * Die Durchsetzung bleibt beim Skript (eine Wahrheit); dieses Modul besitzt die
 * *Bedeutung* der Regeln und übersetzt Verstöße in einen Satz für die Anwenderin.
 */
export interface ImportRule {
  id: string;
  /** Kurzbeschreibung für die Anwenderin. */
  label: string;
  /** Erkennt die Regel in einer Ausgabezeile des Prüfers. */
  match: (message: string) => boolean;
}

export const IMPORT_RULES: ImportRule[] = [
  {
    id: 'bom',
    label: 'Die Datei darf am Anfang kein unsichtbares Zeichen haben (Byte-Order-Mark).',
    match: (m) => m.includes('BOM'),
  },
  {
    id: 'header',
    label: 'Die erste Spalte muss „Titel“ heißen.',
    match: (m) => m.includes('instead of'),
  },
  {
    id: 'max-entries',
    label: 'Es sind höchstens 50 Termine pro Datei erlaubt.',
    match: (m) => m.includes('maximum allowed is'),
  },
  {
    id: 'column-count',
    label: 'Jede Zeile muss genauso viele Spalten haben wie die Kopfzeile.',
    match: (m) => /\d+ columns \(expected \d+\)/.test(m),
  },
  {
    id: 'empty-title',
    label: 'Jeder Termin braucht einen Titel.',
    match: (m) => m.includes('Titel is empty'),
  },
  {
    id: 'category',
    label: 'Die Kategorie muss eine der sieben App-Kategorien sein.',
    match: (m) => m.includes('invalid Kategorien'),
  },
  {
    id: 'past-event',
    label: 'Es dürfen keine Termine mit einem Startdatum in der Vergangenheit oder von heute enthalten sein (Startdatum frühestens morgen).',
    match: (m) => m.includes('is in the past') || m.includes('earliest allowed date'),
  },
];

export interface GateViolation {
  ruleId: string;
}

export interface GateResult {
  violations: GateViolation[];
  /**
   * false, wenn der Prüfer gar nicht erst gelaufen ist (fehlt, ist unlesbar,
   * stürzt ab). Dann ist „keine Verstöße“ eine Aussage über nichts – wer das
   * verschweigt, meldet eine geprüfte Datei, die nie geprüft wurde.
   */
  ran: boolean;
}

function classify(message: string): GateViolation {
  const rule = IMPORT_RULES.find((r) => r.match(message));
  return { ruleId: rule ? rule.id : 'unknown' };
}

export function labelFor(ruleId: string): string {
  return IMPORT_RULES.find((r) => r.id === ruleId)?.label ?? 'Die Datei erfüllt die Import-Regeln nicht.';
}

/**
 * Führt `csv-import-check.js` gegen genau eine Datei aus.
 *
 * Eine Datei ist ein gültiges Ziel des Prüfers – ein Verzeichnis ist es auch,
 * aber dann stimmen fremde Dateien über eine Löschung mitentscheiden. Genau das
 * war der Grund, warum das Löschen gegen echten Daten nie funktioniert hat.
 *
 * Der Prüfer schreibt nur mit den Flags `--fix-bom`, `--clean-past` und
 * `--split-chunks`; ohne sie ist der Lauf rein lesend.
 */
export async function runImportGate(
  checkScript: string,
  repoRoot: string,
  filePath: string
): Promise<GateResult> {
  let output = '';

  try {
    const { stdout, stderr } = await execAsync(`"${process.execPath}" "${checkScript}" "${filePath}"`, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      cwd: repoRoot,
    });
    output = stdout || stderr;
  } catch (err: any) {
    // Der Prüfer beendet sich mit != 0, wenn er Verstöße findet. Die Ausgabe
    // ist dann trotzdem die gesuchte; nur ein Lauf ohne jede Ausgabe ist unbrauchbar.
    output = err?.stdout || err?.stderr || err?.message || '';
  }

  // Jeder erfolgreiche Lauf des Prüfers endet mit einer Zeile über `CSV file(s)`.
  const ran = output.includes('CSV file(s)');

  const violations = output
    .split('\n')
    .map((line) => line.trim())
    // Der Prüfer kappt seine Ausgabe bei 15 Zeilen und hängt eine Zusammenfassung
    // an: `* ... 7 more issue(s)`. Die beginnt zwar mit `* `, ist aber kein Verstoß.
    .filter((line) => line.startsWith('* ') && !/^\* \.\.\. \d+ more issue/.test(line))
    .map((line) => classify(line.slice(2).trim()));

  return { violations, ran };
}

/**
 * Ein kurzer deutscher Hinweis für die Oberfläche – niemals Prüfer-Interna.
 *
 * Wird nach einer *erfolgreichen* Löschung gezeigt: die Datei enthält weiterhin
 * Verstöße, die schon vorher da waren, oder die Prüfung fand nicht statt. Eine
 * Löschung kann keine neuen erzeugen – jede Regel des Prüfers hängt an einer
 * einzelnen Zeile oder sinkt durch das Entfernen einer Zeile (siehe `deleteEvent`
 * in `csv-service.ts`).
 */
export function describeRemaining(gate: GateResult): string {
  if (!gate.ran) {
    return 'Gelöscht. Die Datei konnte nicht geprüft werden – das Prüfskript wurde nicht gefunden oder ist fehlgeschlagen.';
  }
  if (gate.violations.length === 0) return '';

  const labels = [...new Set(gate.violations.map((v) => v.ruleId))].map(labelFor);
  return `Gelöscht. Der Rest der Datei erfüllt die Import-Regeln noch nicht: ${labels.join(' ')}`;
}
