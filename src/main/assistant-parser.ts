import type { PreviewEvent } from '../shared/types.js';

/**
 * Reine Parsing-/Validierungslogik des Anlern-Assistenten (ohne SDK/Electron).
 *
 * Grundregel: Es werden ausschließlich ECHTE, vom Agenten auf der Seite gefundene
 * Events weitergereicht. Fehlt etwas, wird NICHTS erfunden – der Aufrufer meldet
 * dann einen Fehler (kein „Fake-Success“).
 */

/** Titel, die auf erfundene Beispiel-/Platzhalter-Events hindeuten. */
const PLACEHOLDER_TITLE = /^(beispiel|muster|test-?event|placeholder|dummy)|beispielveranstaltung|musterveranstaltung/i;

/** Datumsangaben, die kein echtes Datum sind. */
const PLACEHOLDER_DATE =
  /^(demnächst|demnaechst|kommende woche|bald|tbd|tba|n\/?a|datum auf detailseite|unbekannt|-+)$/i;

/** Mindestens eine Ziffer muss vorkommen (Tag, Jahr oder Uhrzeit), sonst ist es kein Datum. */
const HAS_DIGIT = /\d/;

function sanitizeUrl(val: unknown): string | undefined {
  if (!val) return undefined;
  const str = String(val).trim();
  if (/^https?:\/\//i.test(str)) {
    return str;
  }
  return undefined;
}

function sanitizeText(val: unknown): string | undefined {
  if (!val) return undefined;
  const str = String(val).trim();
  return str.length > 0 ? str : undefined;
}

/**
 * Extrahiert ein JSON-Objekt aus dem Agententext.
 *
 * Wichtig: Das Feld `skillContent` enthält regelmäßig eigene ```-Codeblöcke.
 * Ein non-greedy Regex (```json … ```) bricht deshalb mitten im JSON ab. Daher wird
 * bis zum LETZTEN ``` gelesen und – falls nötig – schrittweise auf frühere
 * Abschlussmarker bzw. die äußersten geschweiften Klammern zurückgefallen.
 */
export function extractJsonPayload(text: string | undefined | null): any | null {
  if (!text) return null;

  const tryParse = (candidate: string): any | null => {
    try {
      const value = JSON.parse(candidate.trim());
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  };

  // 1. ```json … ``` – vom letzten Abschlussmarker rückwärts probieren.
  const startMarker = '```json';
  const startIdx = text.indexOf(startMarker);
  if (startIdx !== -1) {
    const afterStart = text.slice(startIdx + startMarker.length);
    let endIdx = afterStart.lastIndexOf('```');
    while (endIdx !== -1) {
      const parsed = tryParse(afterStart.slice(0, endIdx));
      if (parsed) return parsed;
      endIdx = endIdx > 0 ? afterStart.lastIndexOf('```', endIdx - 1) : -1;
    }
  }

  // 2. Äußerste geschweifte Klammern.
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return tryParse(text.slice(firstBrace, lastBrace + 1));
  }

  return null;
}

export interface PreviewValidationContext {
  resolvedName: string;
}

export interface PreviewValidationResult {
  events: PreviewEvent[];
  /** Gründe, warum gelieferte Einträge verworfen wurden (für die Diagnose). */
  rejected: string[];
}

/**
 * Übernimmt nur Events mit echtem Titel UND echtem Datum.
 * Es werden keine Titel, Daten oder Orte „aufgefüllt“, die nicht vom Agenten stammen.
 */
export function validatePreviewEvents(
  rawEvents: unknown,
  ctx: PreviewValidationContext
): PreviewValidationResult {
  const events: PreviewEvent[] = [];
  const rejected: string[] = [];
  const list: any[] = Array.isArray(rawEvents) ? rawEvents : [];

  for (const evt of list) {
    const title = String(evt?.title ?? '').trim();
    const dateTime = String(evt?.dateTime ?? '').trim();
    const location = String(evt?.location ?? '').trim();

    if (!title) {
      rejected.push('Eintrag ohne Titel');
      continue;
    }
    if (
      PLACEHOLDER_TITLE.test(title) ||
      title.toLowerCase() === `${ctx.resolvedName.toLowerCase()} veranstaltung`
    ) {
      rejected.push(`Platzhalter-Titel: "${title}"`);
      continue;
    }
    if (!dateTime || PLACEHOLDER_DATE.test(dateTime) || !HAS_DIGIT.test(dateTime)) {
      rejected.push(`"${title}": kein echtes Datum ("${dateTime}")`);
      continue;
    }

    const description = sanitizeText(evt?.description);
    const address = sanitizeText(evt?.address);
    const price = sanitizeText(evt?.price);
    const organizer = sanitizeText(evt?.organizer);
    const imageUrl = sanitizeUrl(evt?.imageUrl);
    const ticketUrl = sanitizeUrl(evt?.ticketUrl);
    const detailUrl = sanitizeUrl(evt?.detailUrl);

    events.push({
      title,
      dateTime,
      location: location || 'Ort nicht angegeben',
      category: String(evt?.category ?? '').trim() || 'Kultur',
      ...(description ? { description } : {}),
      ...(address ? { address } : {}),
      ...(price ? { price } : {}),
      ...(organizer ? { organizer } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(ticketUrl ? { ticketUrl } : {}),
      ...(detailUrl ? { detailUrl } : {}),
    });
  }

  return { events, rejected };
}
