/**
 * Qualitätsprüfung und Validierung für Veranstaltungsdaten (Bereich 5).
 * Prüft Adressen auf Geocodierbarkeit (Ort + Straße/Venue, siehe isValidAddress),
 * Uhrzeiten und App-Kategorien.
 */

export const APP_CATEGORIES = [
  'Musik & Nightlife',
  'Familie & Kinder',
  'Workshops & PopUps',
  'Märkte & Messen',
  'Show & Performance',
  'Kultur',
  'Sport & Fitness',
] as const;

export type AppCategory = (typeof APP_CATEGORIES)[number];

export const APP_CATEGORIES_SET = new Set<string>(APP_CATEGORIES);

/**
 * Prüft, ob ein Zeitstring dem Format HH:mm entspricht (oder leer ist).
 */
export function isValidTime(time: string | undefined | null): boolean {
  if (!time || !time.trim()) return true;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time.trim());
}

/** Offensichtlicher Scraping-Müll im Ortsfeld (Terminlisten, Preis-/Kategorie-Texte). */
const NOT_AN_ADDRESS = /^(weitere\s+(termine|veranstaltungen)|kategorie\s+\d)|€|\beuro\b|\buhr\b/i;
const PLZ = /(?<!\d)\d{5}(?!\d)/;
/** Wort mit mindestens 2 Zeichen (Ortsname, Straße, Venue). */
const WORD = /\p{L}[\p{L}.\-]+/gu;
/** Hausnummer direkt nach einem Wort: "19", "12a", "16-20", "1/3". */
const HOUSE_NUMBER = /[\p{L}.]\s+(\d{1,4}[a-zA-Z]?(?:\s?[/-]\s?\d{1,4}[a-zA-Z]?)?)(?![\p{L}\d])/u;

/**
 * Prüft, ob der Veranstaltungsort für den Import brauchbar ist, d. h. ob das
 * Backend ihn per Geocoding (HERE) zuverlässig auf Koordinaten abbilden kann.
 *
 * Das Backend verlangt selbst nur einen nicht-leeren `Veranstaltungsort`;
 * ohne auffindbare Adresse landet das Event aber mit Koordinaten 0/0 in der
 * Datenbank. Gültig ist daher eine Angabe, die einen Ort UND einen
 * Anhaltspunkt für die Stelle enthält – entweder:
 *   a) 5-stellige PLZ + mind. ein weiterer Name (Stadt, Straße oder Venue), oder
 *   b) Straße + Hausnummer + nachgestellte Stadt (ohne PLZ).
 * Die Hausnummer ist bei Variante a) optional, die Reihenfolge von PLZ und
 * Stadt ist egal.
 */
export function isValidAddress(location: string | undefined | null): boolean {
  if (!location) return false;
  const text = location.trim().replace(/\s+/g, ' ');
  if (!text || text.length > 200 || NOT_AN_ADDRESS.test(text)) return false;

  const plz = text.match(PLZ)?.[0];
  const rest = plz ? text.replace(plz, ' ') : text;
  const wordCount = rest.match(WORD)?.length ?? 0;
  const house = rest.match(HOUSE_NUMBER);

  if (plz) {
    return wordCount >= 2 || (wordCount >= 1 && house !== null);
  }

  if (!house || house.index === undefined) return false;
  const tail = rest.slice(house.index + house[0].length);
  return /\p{L}{2,}/u.test(tail);
}

export type EventQualitySeverity = 'invalid' | 'warning' | 'info';

export interface EventQualityIssue {
  id: 'invalid-address' | 'no-time' | 'no-image';
  severity: EventQualitySeverity;
  label: string;
  description: string;
}

export interface EventQualityReport {
  isValid: boolean;
  issues: EventQualityIssue[];
  hasInvalidAddress: boolean;
  hasNoTime: boolean;
  hasNoImage: boolean;
}

/**
 * Erstellt eine Qualitätsbewertung für ein Event.
 */
export function assessEventQuality(event: {
  location?: string;
  startTime?: string;
  imageUrl?: string;
}): EventQualityReport {
  const issues: EventQualityIssue[] = [];

  const hasInvalidAddress = !isValidAddress(event.location);
  if (hasInvalidAddress) {
    issues.push({
      id: 'invalid-address',
      severity: 'invalid',
      label: 'Adresse unvollständig',
      description:
        'Ort oder Straße fehlt. Ohne auffindbare Adresse landet das Event im Folgesystem ohne Kartenposition (Koordinaten 0/0).',
    });
  }

  const hasNoTime = !event.startTime || !event.startTime.trim();
  if (hasNoTime) {
    issues.push({
      id: 'no-time',
      severity: 'warning',
      label: 'Keine Uhrzeit',
      description: 'Für dieses Event wurde keine Startzeit erfasst.',
    });
  }

  const hasNoImage = !event.imageUrl || !event.imageUrl.trim();
  if (hasNoImage) {
    issues.push({
      id: 'no-image',
      severity: 'warning',
      label: 'Kein Vorschaubild',
      description: 'Es ist keine Bild-URL hinterlegt.',
    });
  }

  return {
    isValid: !hasInvalidAddress,
    issues,
    hasInvalidAddress,
    hasNoTime,
    hasNoImage,
  };
}
