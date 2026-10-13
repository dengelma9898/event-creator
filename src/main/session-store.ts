import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import type { UploadTarget } from '../shared/types.js';

/**
 * Die gespeicherte Nürnbergspots-Sitzung. Bewusst *kein* Passwort: das
 * Refresh-Token genügt, um ohne erneute Anmeldung frische ID-Tokens zu holen,
 * und lässt sich in der Firebase-Konsole zurückziehen.
 */
export interface StoredSession {
  email: string;
  refreshToken: string;
}

/** Wohin eine Sitzung abgelegt wird – im Test ein Speicher im Arbeitsspeicher. */
export interface SessionStore {
  load(): StoredSession | null;
  /** false, wenn die Sitzung nicht sicher abgelegt werden konnte. */
  save(session: StoredSession): boolean;
  clear(): void;
}

/**
 * Legt die Sitzung wie den Cursor-Schlüssel ab (ADR 0002): verschlüsselt über
 * Electrons `safeStorage` (macOS Keychain), in einer eigenen Datei neben
 * `credentials.enc`. Es entsteht keine Klartextdatei.
 */
export class SafeStorageSessionStore implements SessionStore {
  private readonly filePath: string;

  /** Jede Stage hat ihre eigene Datei – eine Sitzung gilt nie für die andere. */
  constructor(target: UploadTarget, customPath?: string) {
    const dir = customPath ? path.dirname(customPath) : app.getPath('userData');
    this.filePath = customPath ?? path.join(dir, `nuernbergspots-session-${target}.enc`);

    // Einmalige Übernahme der Sitzung aus der Zeit vor der Stage-Wahl (war immer Produktion).
    if (!customPath && target === 'prod') {
      const legacy = path.join(dir, 'nuernbergspots-session.enc');
      try {
        if (fs.existsSync(legacy) && !fs.existsSync(this.filePath)) {
          fs.renameSync(legacy, this.filePath);
        }
      } catch (error) {
        console.error('[SessionStore] Alte Sitzung konnte nicht übernommen werden:', error);
      }
    }
  }

  public load(): StoredSession | null {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      const encrypted = fs.readFileSync(this.filePath);
      if (encrypted.length === 0 || !safeStorage.isEncryptionAvailable()) return null;

      const parsed = JSON.parse(safeStorage.decryptString(encrypted)) as Partial<StoredSession>;
      if (typeof parsed.email === 'string' && typeof parsed.refreshToken === 'string' && parsed.refreshToken) {
        return { email: parsed.email, refreshToken: parsed.refreshToken };
      }
      return null;
    } catch (error) {
      console.error('[SessionStore] Sitzung konnte nicht gelesen werden:', error);
      return null;
    }
  }

  public save(session: StoredSession): boolean {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, safeStorage.encryptString(JSON.stringify(session)));
      return true;
    } catch (error) {
      console.error('[SessionStore] Sitzung konnte nicht gespeichert werden:', error);
      return false;
    }
  }

  public clear(): void {
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    } catch (error) {
      console.error('[SessionStore] Sitzung konnte nicht entfernt werden:', error);
    }
  }
}
