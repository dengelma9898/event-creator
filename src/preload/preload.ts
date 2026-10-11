/**
 * Der einzige Übergangspunkt zwischen Renderer und Hauptprozess.
 *
 * Hier steht keine Liste mehr: `buildElectronApi` setzt die Oberfläche
 * vollständig aus `shared/ipc-contract.ts` zusammen. Ein Kanal ist damit an
 * genau einer Stelle beschrieben, und die Zuweisung auf `ElectronAPI` bricht,
 * sobald Vertrag und Kanalliste auseinanderlaufen.
 *
 * Die Herkunftsprüfung steht absichtlich nicht hier, sondern im Hauptprozess –
 * ein Renderer, der sich verkleidet, erreicht sie so nicht ab.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { buildElectronApi, IPC_CHANNELS, type ElectronAPI } from '../shared/ipc-contract.js';

const api: ElectronAPI = buildElectronApi(
  IPC_CHANNELS,
  process.platform,
  (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  (channel, listener) => {
    const forward = (_event: IpcRendererEvent, ...payload: any[]) => listener(payload[0]);
    ipcRenderer.on(channel, forward);
    return () => ipcRenderer.removeListener(channel, forward);
  }
);

contextBridge.exposeInMainWorld('electronAPI', api);
