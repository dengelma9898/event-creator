import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Sicherer Speicher für den CURSOR_API_KEY über Electrons safeStorage (macOS Keychain).
 * Implementiert die Vorgaben aus ADR 0002 und AP 2.1 ohne Ablage von .env-Dateien.
 */
export class KeychainStore {
  private static instance: KeychainStore | null = null;
  private filePath: string;

  constructor(customPath?: string) {
    if (customPath) {
      this.filePath = customPath;
    } else {
      const userDataDir = app.getPath('userData');
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }
      this.filePath = path.join(userDataDir, 'credentials.enc');
    }
  }

  public static getInstance(): KeychainStore {
    if (!KeychainStore.instance) {
      KeychainStore.instance = new KeychainStore();
    }
    return KeychainStore.instance;
  }

  /**
   * Prüft, ob safeStorage Verschlüsselung unterstützt.
   */
  public isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  /**
   * Prüft, ob bereits ein gültiger API-Schlüssel hinterlegt ist.
   */
  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 0);
  }

  /**
   * Liest und entschlüsselt den gespeicherten API-Schlüssel aus dem macOS Keychain.
   * Gibt null zurück, wenn kein Schlüssel existiert oder die Entschlüsselung fehlschlägt.
   */
  public getApiKey(): string | null {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }

      const encryptedBuffer = fs.readFileSync(this.filePath);
      if (encryptedBuffer.length === 0) {
        return null;
      }

      if (!safeStorage.isEncryptionAvailable()) {
        console.warn('[KeychainStore] safeStorage Verschlüsselung ist aktuell nicht verfügbar.');
        return null;
      }

      const decrypted = safeStorage.decryptString(encryptedBuffer);
      return decrypted.trim() || null;
    } catch (error) {
      console.error('[KeychainStore] Fehler beim Entschlüsseln des Schlüssels:', error);
      return null;
    }
  }

  /**
   * Verschlüsselt den API-Schlüssel und speichert ihn in credentials.enc.
   */
  public setApiKey(apiKey: string): boolean {
    try {
      const cleanKey = apiKey.trim();
      if (!cleanKey) {
        return this.clearApiKey();
      }

      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('safeStorage Verschlüsselung ist auf diesem System nicht verfügbar.');
      }

      const encrypted = safeStorage.encryptString(cleanKey);
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.filePath, encrypted);
      return true;
    } catch (error) {
      console.error('[KeychainStore] Fehler beim Speichern des Schlüssels:', error);
      return false;
    }
  }

  /**
   * Entfernt den hinterlegten Schlüssel sicher aus dem System.
   */
  public clearApiKey(): boolean {
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
      return true;
    } catch (error) {
      console.error('[KeychainStore] Fehler beim Löschen der Schlüsseldatei:', error);
      return false;
    }
  }
}
