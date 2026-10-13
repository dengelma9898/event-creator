/**
 * Verbindungsdaten zu Nürnbergspots (Firebase-Anmeldung + Backend-API) je Stage.
 *
 * Die Werte sind dieselben wie im Admin-Frontend:
 *  - `prod` = `admin-fe/.env.prd`  (Firebase `nuernbergspots-b460a`, API `/prd`)
 *  - `test` = `admin-fe/.env.dev`  (Firebase `citylife-fe75a`, API `/dev`)
 *
 * Der Firebase-„API-Key“ einer Web-App ist kein Geheimnis – er identifiziert nur
 * das Projekt; geschützt wird der Zugang durch E-Mail und Passwort der Nutzerin.
 *
 * Passwörter werden von der App nie gespeichert. Abgelegt wird allein das
 * Refresh-Token der Sitzung (siehe `session-store.ts`), getrennt je Stage.
 */

import type { UploadTarget } from '../shared/types.js';

export interface NuernbergspotsConfig {
  /** Stage, zu der diese Verbindung gehört. */
  target: UploadTarget;
  /** Firebase Web-API-Key des jeweiligen Projekts. */
  firebaseApiKey: string;
  /** Basis-URL der Backend-API, ohne abschließenden Schrägstrich. */
  apiBaseUrl: string;
}

export const PROD_CONFIG: NuernbergspotsConfig = {
  target: 'prod',
  firebaseApiKey: 'AIzaSyA8Qg8AwKJQrw4x9xTK4_tzAq_O1sKJoTY',
  apiBaseUrl: 'https://nuernbergspots.de/prd',
};

export const TEST_CONFIG: NuernbergspotsConfig = {
  target: 'test',
  firebaseApiKey: 'AIzaSyCfCNrcmmJnXphzBjgKnvzCM6EcjODWuDc',
  apiBaseUrl: 'https://nuernbergspots.de/dev',
};

export const ENVIRONMENTS: Record<UploadTarget, NuernbergspotsConfig> = {
  test: TEST_CONFIG,
  prod: PROD_CONFIG,
};

/** Pfad des CSV-Imports, relativ zur API-Basis. */
export const CSV_IMPORT_PATH = '/events/import/csv';

/**
 * Liefert die Konfiguration der gewählten Stage. Domi kann die API-Adresse für
 * Tests über `NUERNBERGSPOTS_API_URL` überschreiben; der Firebase-Key bleibt der
 * der gewählten Stage.
 */
export function getNuernbergspotsConfig(
  target: UploadTarget = 'prod',
  env: NodeJS.ProcessEnv = process.env
): NuernbergspotsConfig {
  const base = ENVIRONMENTS[target];
  const override = env.NUERNBERGSPOTS_API_URL?.trim();
  return {
    ...base,
    apiBaseUrl: (override || base.apiBaseUrl).replace(/\/+$/, ''),
  };
}
