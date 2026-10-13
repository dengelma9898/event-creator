import fs from 'node:fs';

import type { AppPaths } from './app-paths.js';
import { describeUploadBlock, runImportGate } from './csv-gate.js';
import { CSV_IMPORT_PATH, type NuernbergspotsConfig } from './nuernbergspots-config.js';
import type { NuernbergspotsAuth } from './nuernbergspots-auth.js';
import type { UploadErrorKind, UploadFileResult, UploadResult } from '../shared/types.js';
import { UPLOAD_TARGET_LABELS } from '../shared/upload-target.js';

type FetchFn = typeof fetch;

export interface UploadDeps {
  auth: Pick<NuernbergspotsAuth, 'getIdToken' | 'invalidateToken'>;
  paths: Pick<AppPaths, 'resolveCsvFile' | 'csvCheckScript' | 'repoRoot'>;
  config: NuernbergspotsConfig;
  fetch?: FetchFn;
  gate?: typeof runImportGate;
  readFile?: (filePath: string) => Buffer;
}

/** Alltagssätze je Ursache. Dieselben Texte gehen in „Details für Domi“. */
const ERROR_TEXT: Record<UploadErrorKind, string> = {
  'not-connected': 'Du bist noch nicht mit Nürnbergspots verbunden.',
  'session-expired': 'Deine Anmeldung bei Nürnbergspots ist abgelaufen. Bitte melde dich neu an.',
  forbidden: 'Dein Zugang darf keine Termine hochladen. Frag Domi.',
  network: 'Nürnbergspots war gerade nicht erreichbar. Bitte prüfe dein WLAN und versuche es noch einmal.',
  server: 'Nürnbergspots hat die Termine nicht angenommen. Bitte versuche es später noch einmal.',
  'invalid-file': 'Die Datei erfüllt die Import-Regeln noch nicht.',
};

/** Höchstens so viele abgelehnte Zeilen landen im Diagnosetext. */
const MAX_FAILED_ROWS = 10;

interface BackendRowResult {
  rowIndex?: number;
  success?: boolean;
  skipped?: boolean;
  errors?: { message?: string }[];
}

interface BackendImportResult {
  totalRows?: number;
  successful?: number;
  skipped?: number;
  failed?: number;
  results?: BackendRowResult[];
}

/**
 * Lädt fertige CSV-Dateien über `POST /events/import/csv` zu Nürnbergspots hoch –
 * dieselbe Schnittstelle wie der CSV-Import im Admin-Frontend.
 *
 * Pro Aufruf wird genau eine Datei übernommen; mehrere Dateien werden abgelehnt.
 * Die Datei geht zuerst durch das Import-Gate (`csv-import-check.js`); eine
 * Datei, die es nicht besteht, wird nie gesendet. Das Backend legt die Termine
 * sofort als aktiv an und erkennt Dubletten (Titel + Datum) selbst – ein zweiter
 * Upload derselben Datei ist deshalb unschädlich und macht „Noch einmal
 * versuchen“ gefahrlos.
 *
 * Bekannte Grenze: Die App schreibt 17 Spalten inklusive `Ticket-URL`. Das
 * Backend liest nach Spaltenname und kennt `Ticket-URL` nicht; die Spalte wird
 * ohne Fehler ignoriert, Ticket-Links erreichen Nürnbergspots also nicht.
 * Die Spalte `Tickets` (ja/nein) wird übernommen.
 */
export class UploadService {
  constructor(private readonly deps: UploadDeps) {}

  private get doFetch(): FetchFn {
    return this.deps.fetch ?? fetch;
  }

  public async uploadFiles(fileNames: string[]): Promise<UploadResult> {
    const names = [...new Set(fileNames.filter((n) => typeof n === 'string' && n.trim()))];
    if (names.length === 0) {
      return this.finish([], 'invalid-file', 'Es gibt keine Datei zum Hochladen.');
    }

    // Harte Regel: immer nur eine Datei pro Übernahme – nie mehrere.
    if (names.length > 1) {
      return this.finish(
        [],
        'invalid-file',
        'Es darf immer nur eine Datei auf einmal hochgeladen werden. Bitte wähle eine einzelne Datei.'
      );
    }

    const outcome = await this.uploadOne(names[0]);
    return this.finish([outcome], outcome.errorKind, outcome.error);
  }

  private async uploadOne(fileName: string): Promise<UploadFileResult> {
    const resolved = this.deps.paths.resolveCsvFile(fileName);
    if (!resolved.ok) {
      return this.failure(fileName, 'invalid-file', 'Die Datei wurde nicht gefunden.');
    }

    // 1. Import-Gate: keine ungeprüfte oder regelwidrige Datei nach draußen.
    const gate = await (this.deps.gate ?? runImportGate)(
      this.deps.paths.csvCheckScript,
      this.deps.paths.repoRoot,
      resolved.filePath
    );
    const blocked = describeUploadBlock(gate);
    if (blocked) {
      return this.failure(fileName, 'invalid-file', blocked);
    }

    let content: Buffer;
    try {
      content = (this.deps.readFile ?? fs.readFileSync)(resolved.filePath);
    } catch {
      return this.failure(fileName, 'invalid-file', 'Die Datei konnte nicht gelesen werden.');
    }

    // 2. Senden – bei einem abgelehnten Token genau einmal mit frischem Token wiederholen.
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.deps.auth.getIdToken();
      if (!token.ok) {
        return this.failure(fileName, token.kind);
      }

      let response: Response;
      try {
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(content)], { type: 'text/csv' }), fileName);
        response = await this.doFetch(`${this.deps.config.apiBaseUrl}${CSV_IMPORT_PATH}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token.token}` },
          body: form,
        });
      } catch {
        return this.failure(fileName, 'network');
      }

      if (response.status === 401) {
        this.deps.auth.invalidateToken();
        if (attempt === 0) continue;
        return this.failure(fileName, 'session-expired');
      }
      if (response.status === 403) return this.failure(fileName, 'forbidden');
      if (response.status === 400) {
        return this.failure(fileName, 'invalid-file', 'Nürnbergspots hat die Datei als ungültig abgelehnt.');
      }
      if (!response.ok) return this.failure(fileName, 'server');

      return this.readSuccess(fileName, response);
    }

    return this.failure(fileName, 'session-expired');
  }

  private async readSuccess(fileName: string, response: Response): Promise<UploadFileResult> {
    let parsed: BackendImportResult | { data?: BackendImportResult };
    try {
      parsed = (await response.json()) as BackendImportResult | { data?: BackendImportResult };
    } catch {
      return this.failure(fileName, 'server');
    }

    // Das Backend verpackt Antworten global als `{ data, timestamp }`.
    const result: BackendImportResult =
      parsed && typeof parsed === 'object' && 'data' in parsed && parsed.data ? parsed.data : (parsed as BackendImportResult);

    const failedRows = (Array.isArray(result.results) ? result.results : [])
      .filter((r) => r.success === false && !r.skipped)
      .slice(0, MAX_FAILED_ROWS)
      .map((r) => {
        const reason = (r.errors ?? []).map((e) => e.message).filter(Boolean).join('; ') || 'unbekannter Grund';
        return `Zeile ${r.rowIndex ?? '?'}: ${reason}`;
      });

    const created = Number(result.successful) || 0;
    const duplicates = Number(result.skipped) || 0;
    const failed = Number(result.failed) || 0;

    return {
      fileName,
      success: true,
      created,
      duplicates,
      failed,
      // Wie im Admin-Frontend: fehlt `totalRows`, zählt die Summe der drei Zähler.
      totalRows: Number(result.totalRows) || created + duplicates + failed,
      ...(failedRows.length > 0 ? { failedRows } : {}),
    };
  }

  private failure(fileName: string, kind: UploadErrorKind, text?: string): UploadFileResult {
    return {
      fileName,
      success: false,
      created: 0,
      duplicates: 0,
      failed: 0,
      totalRows: 0,
      errorKind: kind,
      error: text ?? ERROR_TEXT[kind],
    };
  }

  private finish(files: UploadFileResult[], errorKind?: UploadErrorKind, error?: string): UploadResult {
    const sum = (pick: (f: UploadFileResult) => number) => files.reduce((total, f) => total + pick(f), 0);
    const success = files.length > 0 && files.every((f) => f.success);
    const result: UploadResult = {
      target: this.deps.config.target,
      success,
      created: sum((f) => f.created),
      duplicates: sum((f) => f.duplicates),
      failed: sum((f) => f.failed),
      totalRows: sum((f) => f.totalRows),
      files,
      ...(errorKind ? { errorKind } : {}),
      ...(error ? { error } : {}),
    };

    const hasProblem = !success || result.failed > 0;
    if (hasProblem) {
      result.detailsForDomi = this.buildDetails(result);
    }
    return result;
  }

  private buildDetails(result: UploadResult): string {
    const lines = [
      '=== Details für Domi ===',
      `Zeitpunkt: ${new Date().toISOString()}`,
      'Aktion: Upload zu Nürnbergspots',
      `Stage: ${UPLOAD_TARGET_LABELS[result.target]}`,
      `Ziel: ${this.deps.config.apiBaseUrl}${CSV_IMPORT_PATH}`,
    ];
    for (const file of result.files) {
      const status = file.success
        ? `neu ${file.created}, vorhanden ${file.duplicates}, abgelehnt ${file.failed}`
        : `Fehler (${file.errorKind}): ${file.error}`;
      lines.push(`Datei: ${file.fileName} -> ${status}`);
      for (const row of file.failedRows ?? []) lines.push(`  ${row}`);
    }
    lines.push('========================');
    return lines.join('\n');
  }
}
