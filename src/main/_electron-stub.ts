/**
 * Attrappe für Electron im Testlauf.
 *
 * Die Suites laufen unter Node, nicht unter Electron. `src/main/ipc.ts` braucht
 * Electron aber schon beim Import (`ipcMain`, `shell`, `clipboard`). Diese Datei
 * wird von `scripts/run-tests.mjs` anstelle des echten Pakets eingebunden.
 *
 * Sie merkt sich zusätzlich jeden registrierten Listener. So lässt sich prüfen,
 * *was* sich registriert hat und dass die Herkunftsprüfung in der Registrierung
 * tatsächlich greift – nicht nur, dass sie im Quelltext steht.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Listener = (event: unknown, ...args: unknown[]) => unknown;

/** Vom Test auslesbar: jeder registrierte Kanal mit seinem Listener. */
export const registeredHandlers = new Map<string, Listener>();

export const ipcMain = {
  handle(channel: string, listener: Listener): void {
    registeredHandlers.set(channel, listener);
  },
  removeHandler(channel: string): void {
    registeredHandlers.delete(channel);
  },
};

export const shell = {
  showItemInFolder: (): void => {},
  openPath: (): void => {},
  openExternal: async (): Promise<void> => {},
};

export const clipboard = {
  writeText: (): void => {},
};

let userDataDir = '';
export const app = {
  getPath(name: string): string {
    if (name !== 'userData') return os.tmpdir();
    if (!userDataDir) {
      userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-creator-test-userdata-'));
    }
    return userDataDir;
  },
  getName: (): string => 'event-creator-test',
  on: (): void => {},
  whenReady: () => Promise.resolve(),
};

export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
};

export const Menu = {
  buildFromTemplate: (): unknown => ({}),
  setApplicationMenu: (): void => {},
};

export const session = { defaultSession: { webRequest: { onHeadersReceived: (): void => {} } } };

export const BrowserWindow = class {
  static getAllWindows(): unknown[] {
    return [];
  }
};

export const Notification = class {
  static isSupported(): boolean {
    return true;
  }
  constructor(_options?: unknown) {}
  on(_event: string, _callback: () => void): this {
    return this;
  }
  show(): void {}
};

