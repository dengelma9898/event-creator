import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { Cursor, JsonlLocalAgentStore } from '@cursor/sdk';

let sharedStore: JsonlLocalAgentStore | null = null;

/**
 * Ermittelt das Verzeichnis für den lokalen Agent-Speicher.
 * Verwendet unter macOS bevorzugt app.getPath('userData')/agent-store,
 * mit Fallback auf ein lokales Verzeichnis für isolierte Skripte/Tests.
 */
export function getAgentStoreDir(fallbackRoot?: string): string {
  try {
    if (typeof app !== 'undefined' && app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'agent-store');
    }
  } catch {
    // Nicht im Electron-Kontext
  }
  const base = fallbackRoot || process.env.EVENT_CREATOR_DATA_DIR || process.cwd();
  return path.join(base, '.agent-store');
}

/**
 * Gibt die Singleton-Instanz des JsonlLocalAgentStore zurück
 * und konfiguriert das Cursor-SDK modulweit.
 * Dies ist notwendig, da Electron Node < 22.13 (ohne node:sqlite) verwendet.
 */
export function getOrCreateAgentStore(fallbackRoot?: string): JsonlLocalAgentStore {
  if (!sharedStore) {
    const storeDir = getAgentStoreDir(fallbackRoot);
    if (!fs.existsSync(storeDir)) {
      try {
        fs.mkdirSync(storeDir, { recursive: true });
      } catch (err) {
        console.warn('[AgentStore] Konnte Verzeichnis nicht anlegen:', err);
      }
    }
    sharedStore = new JsonlLocalAgentStore(storeDir);
    Cursor.configure({
      local: {
        store: sharedStore,
      },
    });
  }
  return sharedStore;
}
