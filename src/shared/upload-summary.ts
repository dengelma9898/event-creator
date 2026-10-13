/**
 * Das Upload-Ergebnis in Alltagssprache – an einer Stelle, ohne Electron und
 * ohne React, damit die Sätze prüfbar sind.
 *
 * Die Antwort des Imports wird so gemeldet wie im Admin-Frontend
 * (`useCsvEventImport.showImportToasts` und `CsvImportResults`):
 * „Import erfolgreich“ / „Import teilweise erfolgreich“ / „Import fehlgeschlagen“
 * mit Zählern, dazu die drei Kennzahlen Erfolgreich / Duplikate / Fehlgeschlagen.
 *
 * Die Oberfläche zeigt nur, was hier herauskommt: eine Überschrift, wenige
 * Zeilen, die Kennzahlen und – falls es hilft – genau eine Handlung (neu
 * anmelden oder noch einmal versuchen). Technische Begriffe kommen nicht vor; die
 * rohen Details stehen in `UploadResult.detailsForDomi`.
 */

import type { UploadErrorKind, UploadResult } from './types.js';
import { UPLOAD_TARGET_LABELS } from './upload-target.js';

export type UploadSummaryTone = 'success' | 'warning' | 'error';

/** Was die Oberfläche der Person anbietet. */
export type UploadSummaryAction = 'none' | 'login' | 'retry';

/** Die drei Kennzahlen des Admin-Frontends („Import-Ergebnis“). */
export interface UploadCounts {
  created: number;
  duplicates: number;
  failed: number;
  totalRows: number;
}

export interface UploadSummary {
  tone: UploadSummaryTone;
  headline: string;
  lines: string[];
  action: UploadSummaryAction;
  /** true, wenn „Details für Domi kopieren“ sinnvoll ist. */
  offerDetails: boolean;
  /** Name der Stage, an die hochgeladen wurde, z. B. „Test (Citylife)“. */
  stageLabel: string;
  /** Kennzahlen der Backend-Antwort – nur, wenn das Backend überhaupt geantwortet hat. */
  counts: UploadCounts | null;
}

const termine = (n: number) => (n === 1 ? '1 Termin' : `${n} Termine`);

const HEADLINES: Record<UploadErrorKind, string> = {
  'not-connected': 'Noch nicht mit Nürnbergspots verbunden',
  'session-expired': 'Anmeldung abgelaufen',
  network: 'Keine Verbindung zu Nürnbergspots',
  server: 'Nürnbergspots hat die Termine nicht angenommen',
  forbidden: 'Keine Berechtigung zum Hochladen',
  'invalid-file': 'Die Datei wurde nicht hochgeladen',
};

const ACTIONS: Record<UploadErrorKind, UploadSummaryAction> = {
  'not-connected': 'login',
  'session-expired': 'login',
  network: 'retry',
  server: 'retry',
  forbidden: 'none',
  'invalid-file': 'none',
};

export function summarizeUpload(result: UploadResult): UploadSummary {
  const { created, duplicates, failed, totalRows } = result;
  const lines: string[] = [];
  const stageLabel = UPLOAD_TARGET_LABELS[result.target] ?? UPLOAD_TARGET_LABELS.prod;
  const counts: UploadCounts | null = result.files.some((f) => f.success)
    ? { created, duplicates, failed, totalRows }
    : null;

  if (created > 0 && !result.success) {
    lines.push(`${termine(created)} ${created === 1 ? 'ist' : 'sind'} schon online.`);
  }

  if (!result.success) {
    const kind = result.errorKind ?? 'server';
    if (result.error) lines.push(result.error);
    return {
      tone: 'error',
      headline: HEADLINES[kind],
      lines,
      action: ACTIONS[kind],
      offerDetails: Boolean(result.detailsForDomi),
      stageLabel,
      counts,
    };
  }

  const done = (
    tone: UploadSummaryTone,
    headline: string,
    text: string[]
  ): UploadSummary => ({
    tone,
    headline,
    lines: text,
    action: 'none',
    offerDetails: failed > 0 && Boolean(result.detailsForDomi),
    stageLabel,
    counts,
  });

  // Wortlaut wie im Admin-Frontend.
  if (created > 0 && failed === 0) {
    const skipped = duplicates > 0 ? ` ${duplicates} Duplikate übersprungen.` : '';
    return done('success', 'Import erfolgreich', [`${created} von ${totalRows} Events wurden erstellt.${skipped}`]);
  }
  if (created > 0) {
    return done('warning', 'Import teilweise erfolgreich', [
      `${created} erstellt, ${failed} fehlgeschlagen, ${duplicates} übersprungen.`,
      'Kopiere die Details und frag Domi.',
    ]);
  }
  if (failed === 0 && duplicates > 0) {
    // Nur Dubletten ist kein Fehler: nichts ging verloren, alles ist schon da.
    return done('success', 'Alles war schon vorhanden.', [
      `Keine neuen Events erstellt. ${duplicates} Duplikate übersprungen.`,
    ]);
  }
  if (totalRows > 0) {
    return done('error', 'Import fehlgeschlagen', [
      `Keine Events konnten erstellt werden. ${failed} fehlgeschlagen, ${duplicates} Duplikate.`,
      'Kopiere die Details und frag Domi.',
    ]);
  }
  return done('success', 'Es gab keine Termine zum Hochladen.', []);
}
