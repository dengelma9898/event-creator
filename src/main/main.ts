import { app, BrowserWindow, shell, Menu, session } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { AgentRunner } from './agent-runner.js';
import { registerIpcHandlers } from './ipc.js';
import { getOrCreateAgentStore } from './agent-store.js';
import { DEV_CSP, RENDERER_CSP } from '../shared/renderer-policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, '..');

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

let mainWindow: BrowserWindow | null = null;

function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const template: any = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: 'Einstellungen...',
                accelerator: 'CommandOrControl+,',
                click: () => {
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('menu:open-settings');
                  }
                },
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Widerrufen' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einfügen' },
        { role: 'selectAll', label: 'Alles auswählen' },
      ],
    },
    {
      label: 'Fenster',
      submenu: [
        { role: 'minimize', label: 'Minimieren' },
        { role: 'zoom', label: 'Zoomen' },
        { role: 'close', label: 'Schließen' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * Legt die Content-Security-Policy über HTTP-Header fest. Für die gepackte App
 * wird die Seite per `file://` geladen – dort greifen keine Header, dort trägt
 * der `<meta http-equiv>`-Tag in index.html (siehe vite.config.ts).
 */
function applyContentSecurityPolicy() {
  const policy = VITE_DEV_SERVER_URL ? DEV_CSP : RENDERER_CSP;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

/**
 * Externe Links gehören in den Systembrowser, nie in ein Renderer-Fenster.
 */
function isExternalHttpUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://');
}

function hardenWindow(win: BrowserWindow) {
  const contents = win.webContents;

  // 1. window.open / target=_blank -> Systembrowser, nie ein Renderer-Fenster.
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 2. Keine Navigation vom gebündelten Dokument weg.
  //    `file://` hat keine echte Origin ("null"), deshalb wird gegen die exakte
  //    URL des gebündelten Dokuments geprüft; im Dev-Modus gegen die Origin.
  const isOwnDocument = (url: string): boolean => {
    if (VITE_DEV_SERVER_URL) {
      return url === VITE_DEV_SERVER_URL || url.startsWith(`${VITE_DEV_SERVER_URL}/`);
    }
    const appUrl = pathToFileURL(path.join(RENDERER_DIST, 'index.html')).href;
    return url === appUrl || url.startsWith(`${appUrl}#`) || url.startsWith(`${appUrl}?`);
  };

  contents.on('will-navigate', (event, url) => {
    if (isOwnDocument(url)) return;
    event.preventDefault();
    if (isExternalHttpUrl(url)) {
      shell.openExternal(url);
    }
  });

  // 3. Keine Unterfenster.
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Event Creator',
    width: 960,
    height: 680,
    minWidth: 800,
    minHeight: 560,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
    },
  });

  hardenWindow(mainWindow);

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Cursor SDK mit JsonlLocalAgentStore für Node/Electron-Kompatibilität initialisieren
  getOrCreateAgentStore();
  applyContentSecurityPolicy();
  registerIpcHandlers(() => mainWindow);
  setupApplicationMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', async () => {
  const runner = AgentRunner.getInstance();
  if (runner.getIsBusy()) {
    await runner.cancelRun();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
