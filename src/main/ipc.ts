/**
 * Registrierung des Prozess-Saums im Hauptprozess.
 *
 * Zwei Dinge passieren hier und nur hier:
 *  1. Die Zuordnung Kanal -> Handler. Ihre Form wird von `IpcContract`
 *     vorgegeben, also ist ein Handler mit falscher Anfrage oder falscher
 *     Antwort ein Compilerfehler.
 *  2. Die Prüfung der Herkunft. Sie steckt in `register()`, damit kein Handler
 *     sie vergessen kann – im Renderer ist sie nicht sichtbar und der Preload
 *     bietet sie nicht an.
 */

import { clipboard, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import { AgentRunner } from './agent-runner.js';
import { AppPaths } from './app-paths.js';
import { AssistantService } from './assistant-service.js';
import { CsvService } from './csv-service.js';
import { KeychainStore } from './keychain-store.js';
import { NuernbergspotsAuth } from './nuernbergspots-auth.js';
import { getNuernbergspotsConfig } from './nuernbergspots-config.js';
import { SafeStorageSessionStore } from './session-store.js';
import { UploadService } from './upload-service.js';
import { SkillLoader } from './skill-loader.js';
import type { IpcContract } from '../shared/ipc-contract.js';
import type { UploadTarget } from '../shared/types.js';
import { assertUploadTarget } from '../shared/upload-target.js';

/**
 * Die Dienste, die die Handler brauchen – jeweils nur die benutzten Methoden.
 * `buildIpcHandlers` baut daraus die Zuordnung, ohne selbst nach Singletonen zu
 * greifen; das macht die Zuordnung ohne Electron und ohne Dateisystem prüfbar.
 */
export interface IpcDeps {
  keychain: Pick<KeychainStore, 'isConfigured' | 'setApiKey' | 'clearApiKey'>;
  /** Anmeldung der gewählten Stage – jede Stage hat ihre eigene Sitzung. */
  nuernbergspots: (target: UploadTarget) => Pick<NuernbergspotsAuth, 'getStatus' | 'login' | 'logout'>;
  /** Upload zur gewählten Stage. */
  uploader: (target: UploadTarget) => Pick<UploadService, 'uploadFiles'>;
  skills: Pick<SkillLoader, 'listSkills' | 'getSkill'>;
  runner: Pick<AgentRunner, 'startRun' | 'cancelRun'>;
  assistant: Pick<AssistantService, 'analyzeSource' | 'saveSkill'>;
  csv: Pick<CsvService, 'listFiles' | 'loadEvents' | 'deleteEvent' | 'updateEvent' | 'getAllSourceStatuses' | 'getSourceStatus'>;
  paths: Pick<AppPaths, 'dataDir' | 'resolveCsvFile'>;
  /** Nur zum Öffnen im Finder; der Pfad selbst kommt aus `paths`. */
  reveal: (absolutePath: string) => void;
  openPath: (absolutePath: string) => void;
  openExternal: (url: string) => Promise<void>;
  writeClipboard: (text: string) => void;
  /** Sendet eine Statusmeldung an den Renderer. */
  sendStatus: (channel: string, payload: unknown) => void;
}

/**
 * Ein Handler je Kanal. Der mapped type verlangt, dass jeder Kanal aus
 * `IpcContract` einen Handler hat – ein Kanal ohne Implementierung ist ein
 * Compilerfehler, kein „No handler registered“ zur Laufzeit.
 */
export type IpcHandlers = {
  [C in keyof IpcContract]: (
    arg: IpcContract[C]['request']
  ) => IpcContract[C]['response'] | Promise<IpcContract[C]['response']>;
};

export function buildIpcHandlers(deps: IpcDeps): IpcHandlers {
  return {
    // 1. API-Key Verwaltung (macOS Keychain via safeStorage)
    'apiKey:isConfigured': () => deps.keychain.isConfigured(),
    'apiKey:set': (key) => deps.keychain.setApiKey(key),
    'apiKey:clear': () => deps.keychain.clearApiKey(),

    // 1b. Nürnbergspots: Anmeldung & Upload (Netzwerkzugriff nur hier im Hauptprozess)
    // Eine unbekannte Stage wird abgewiesen, nie still zu Produktion umgedeutet (ADR 0003).
    'nuernbergspots:getStatus': (target) => deps.nuernbergspots(assertUploadTarget(target)).getStatus(),
    'nuernbergspots:login': (input) =>
      deps.nuernbergspots(assertUploadTarget(input?.target)).login(input),
    'nuernbergspots:logout': (target) => {
      deps.nuernbergspots(assertUploadTarget(target)).logout();
      return true;
    },
    'nuernbergspots:upload': (input) =>
      deps.uploader(assertUploadTarget(input?.target)).uploadFiles(
        Array.isArray(input?.fileNames) ? input.fileNames : []
      ),

    // 2. Skills & Quellen auflisten
    'skills:list': () => deps.skills.listSkills(),
    'skills:getAllStatuses': () => deps.csv.getAllSourceStatuses(deps.skills.listSkills()),
    'skills:getStatus': (skillId) => {
      const skill = deps.skills.getSkill(skillId);
      return deps.csv.getSourceStatus(skillId, skill?.targetUrl, skill?.skillPath);
    },

    // 3. Agent-Runner (Terminabruf & Abbruch)
    'runner:start': (venueId) =>
      deps.runner.startRun(venueId, (update) => deps.sendStatus('runner:statusUpdate', update)),
    'runner:cancel': () => deps.runner.cancelRun(),

    // 4. Assistent (Bereich 2: Neue Webseite anlernen)
    'assistant:analyze': (input) =>
      deps.assistant.analyzeSource(input, (statusMessage) =>
        deps.sendStatus('assistant:statusUpdate', statusMessage)
      ),
    'assistant:saveSkill': (input) => deps.assistant.saveSkill(input),

    // 5. CSV Service (Events anzeigen & löschen)
    'csv:listFiles': () => deps.csv.listFiles(),
    'csv:loadEvents': (fileNames) => deps.csv.loadEvents(Array.isArray(fileNames) ? fileNames : []),
    'csv:deleteEvent': (params) => deps.csv.deleteEvent(params),
    'csv:updateEvent': (params) => deps.csv.updateEvent(params),

    // 6. Shell & Finder Aktionen
    'shell:showInFolder': (fileName) => {
      // Der Renderer nennt nur einen Dateinamen; aufgelöst wird ausschliesslich in main.
      const resolved = deps.paths.resolveCsvFile(fileName);
      if (resolved.ok) {
        deps.reveal(resolved.filePath);
      }
    },
    'shell:openDataFolder': () => deps.openPath(deps.paths.dataDir),
    'shell:openExternal': async (url) => {
      if (url && (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:'))) {
        await deps.openExternal(url);
      }
    },

    // 7. macOS Clipboard (für "Details für Domi kopieren")
    'clipboard:writeText': (text) => deps.writeClipboard(text),

    // 8. Ping / Healthcheck
    ping: () => 'pong',
  };
}

/**
 * Nimmt nur Aufrufe aus dem Hauptframe des eigenen Fensters an. Alles andere –
 * ein anderer `webContents`, ein `<webview>`, ein fremdes Fenster – wird
 * abgewiesen, bevor der Handler läuft.
 */
function assertOwnFrame(event: IpcMainInvokeEvent, win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) {
    throw new Error('IPC: kein Fenster vorhanden.');
  }
  if (event.sender !== win.webContents) {
    throw new Error('IPC: Aufruf kam nicht vom eigenen Fenster.');
  }
  if (!event.senderFrame || event.senderFrame !== win.webContents.mainFrame) {
    throw new Error('IPC: Aufruf kam nicht aus dem Hauptframe.');
  }
}

/**
 * Registriert alle Handler. `win` ist eine Funktion, weil das Fenster erst nach
 * der Registrierung entsteht.
 */
export function registerIpcHandlers(win: () => BrowserWindow | null): void {
  const paths = AppPaths.getInstance();
  // Je Stage genau eine Anmeldung (mit eigener Sitzungsdatei) und ein Uploader, erst bei Bedarf gebaut.
  const stages = new Map<UploadTarget, { auth: NuernbergspotsAuth; uploader: UploadService }>();
  const stage = (target: UploadTarget) => {
    let entry = stages.get(target);
    if (!entry) {
      const config = getNuernbergspotsConfig(target);
      const auth = new NuernbergspotsAuth({ store: new SafeStorageSessionStore(target), config });
      entry = { auth, uploader: new UploadService({ auth, paths, config }) };
      stages.set(target, entry);
    }
    return entry;
  };
  const deps: IpcDeps = {
    keychain: KeychainStore.getInstance(),
    nuernbergspots: (target) => stage(target).auth,
    uploader: (target) => stage(target).uploader,
    skills: new SkillLoader(),
    runner: AgentRunner.getInstance(),
    assistant: AssistantService.getInstance(),
    csv: CsvService.getInstance(paths),
    paths,
    reveal: (absolutePath) => shell.showItemInFolder(absolutePath),
    openPath: (absolutePath) => {
      shell.openPath(absolutePath);
    },
    openExternal: (url) => shell.openExternal(url),
    writeClipboard: (text) => clipboard.writeText(text),
    // Schickt nur, solange es das Fenster gibt.
    sendStatus: (channel, payload) => {
      const target = win();
      if (target && !target.isDestroyed()) {
        target.webContents.send(channel, payload);
      }
    },
  };

  // Die Herkunftsprüfung steckt in der Schleife, damit kein Handler sie
  // vergessen kann. Der einzige `any` steht hier: `ipcMain.handle` reicht die
  // Argumente lose durch, und die Zuordnung Kanal -> Handler hat der mapped
  // type `IpcHandlers` bereits geprüft.
  const entries = Object.entries(buildIpcHandlers(deps)) as [string, (arg: any) => unknown][];
  for (const [channel, handler] of entries) {
    ipcMain.handle(channel, (event, arg: any) => {
      assertOwnFrame(event, win());
      return handler(arg);
    });
  }
}
