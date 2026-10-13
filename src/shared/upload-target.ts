/**
 * Die zwei Stages, an die die App hochladen kann – Namen und Prüfung an einer
 * Stelle, ohne Electron und ohne React (Main und Renderer nutzen sie beide).
 */

import type { UploadTarget } from './types.js';

export const UPLOAD_TARGETS: readonly UploadTarget[] = ['test', 'prod'];

/** Voreinstellung bleibt Produktion – wie vor der Einführung der Stage-Wahl. */
export const DEFAULT_UPLOAD_TARGET: UploadTarget = 'prod';

export const UPLOAD_TARGET_LABELS: Record<UploadTarget, string> = {
  test: 'Test (Citylife)',
  prod: 'Prod (Nürnbergspots)',
};

export function isUploadTarget(value: unknown): value is UploadTarget {
  return value === 'test' || value === 'prod';
}

/** Fail-fast (ADR 0003): ein unbekannter Wert wird nie stillschweigend zu Produktion. */
export function assertUploadTarget(value: unknown): UploadTarget {
  if (!isUploadTarget(value)) {
    throw new Error(`Unbekannte Stage: ${String(value)}`);
  }
  return value;
}
