/**
 * Der Prozess-Saum: jeder IPC-Kanal, seine Anfrage und seine Antwort – an
 * genau einer Stelle.
 *
 * Vorher stand derselbe Kanal an drei Stellen: als String in `main.ts`, als
 * `ipcRenderer.invoke(...)` in `preload.ts` und als Signatur in `ElectronAPI`.
 * Ein Tippfehler in einer davon war ein Laufzeitwunder statt eines Compilerfehlers.
 *
 * Hier gilt:
 * - `IpcContract` besitzt Name, Anfrage und Antwort eines Kanals.
 * - `IPC_CHANNELS` ist die Laufzeitliste desselben Vertrags. `satisfies` fängt
 *   getippte Namen ab; fehlt umgekehrt ein Kanal in der Liste, passt der
 *   Rückgabetyp von `buildInvokeSurface` nicht mehr zu `ElectronAPI` und
 *   `preload.ts` bricht beim Bauen. `ipc.test.ts` prüft dieselbe Lücke noch
 *   einmal zur Laufzeit.
 * - `buildInvokeSurface` baut die Preload-Oberfläche aus der Liste. Der Preload
 *   muss nichts wiederholen; aus `csv:loadEvents` wird `api.csv.loadEvents`,
 *   aus einem Kanal ohne Namespace `api.<name>`.
 * - `IpcEvents` + `EVENT_SUBSCRIPTIONS` gelten für die drei Kanäle, die der
 *   Hauptprozess aktiv an den Renderer schickt.
 *
 * Diese Datei wird von beiden Prozessen gebündelt und importiert deshalb
 * bewusst **kein** Electron – sie ist Typen und reine Funktionen.
 */

import type {
  AssistantAnalysisInput,
  AssistantAnalysisResult,
  CsvEventRecord,
  CsvFileInfo,
  DeleteEventParams,
  DeleteEventResult,
  UpdateEventParams,
  UpdateEventResult,
  RunStatusUpdate,
  RunnerCancelResult,
  RunnerStartResult,
  SaveSkillInput,
  SaveSkillResult,
  SkillMetadata,
  SourceStatusInfo,
} from './types.js';

// ---------------------------------------------------------------------------
// Aufrufende Kanäle (Renderer -> Hauptprozess)
// ---------------------------------------------------------------------------

/** `request: void` heißt: der Kanal nimmt keine Argumente entgegen. */
export type IpcContract = {
  ping: { request: void; response: string };

  'apiKey:isConfigured': { request: void; response: boolean };
  'apiKey:set': { request: string; response: boolean };
  'apiKey:clear': { request: void; response: boolean };

  'skills:list': { request: void; response: SkillMetadata[] };
  'skills:getAllStatuses': { request: void; response: Record<string, SourceStatusInfo> };
  'skills:getStatus': { request: string; response: SourceStatusInfo | null };

  'runner:start': { request: string; response: RunnerStartResult };
  'runner:cancel': { request: void; response: RunnerCancelResult };

  'assistant:analyze': { request: AssistantAnalysisInput; response: AssistantAnalysisResult };
  'assistant:saveSkill': { request: SaveSkillInput; response: SaveSkillResult };

  'csv:listFiles': { request: void; response: CsvFileInfo[] };
  /** Nimmt ausschliesslich Dateinamen entgegen, keine Pfade. */
  'csv:loadEvents': { request: string[]; response: CsvEventRecord[] };
  'csv:deleteEvent': { request: DeleteEventParams; response: DeleteEventResult };
  'csv:updateEvent': { request: UpdateEventParams; response: UpdateEventResult };

  'shell:showInFolder': { request: string; response: void };
  'shell:openDataFolder': { request: void; response: void };
  'shell:openExternal': { request: string; response: void };

  'clipboard:writeText': { request: string; response: void };
};

export const IPC_CHANNELS = [
  'ping',
  'apiKey:isConfigured',
  'apiKey:set',
  'apiKey:clear',
  'skills:list',
  'skills:getAllStatuses',
  'skills:getStatus',
  'runner:start',
  'runner:cancel',
  'assistant:analyze',
  'assistant:saveSkill',
  'csv:listFiles',
  'csv:loadEvents',
  'csv:deleteEvent',
  'csv:updateEvent',
  'shell:showInFolder',
  'shell:openDataFolder',
  'shell:openExternal',
  'clipboard:writeText',
] as const satisfies readonly (keyof IpcContract)[];

export type IpcChannel = (typeof IPC_CHANNELS)[number];

// ---------------------------------------------------------------------------
// Sendende Kanäle (Hauptprozess -> Renderer)
// ---------------------------------------------------------------------------

export interface IpcEvents {
  'runner:statusUpdate': RunStatusUpdate;
  'assistant:statusUpdate': string;
  'menu:open-settings': void;
}

export type IpcEventChannel = keyof IpcEvents;

/**
 * Der Kanalname folgt hier nicht dem Muster `ns:method` der Oberfläche, deshalb
 * ist der Zielpfad ausdrücklich genannt. Der **Typ** der Nutzlast wird trotzdem
 * aus `IpcEvents` abgeleitet und kann nicht driften.
 */
export const EVENT_SUBSCRIPTIONS = [
  { channel: 'runner:statusUpdate', path: ['runner', 'onStatusUpdate'] },
  { channel: 'assistant:statusUpdate', path: ['assistant', 'onStatusUpdate'] },
  { channel: 'menu:open-settings', path: ['settings', 'onOpenSettings'] },
] as const satisfies readonly { channel: IpcEventChannel; path: readonly string[] }[];

// ---------------------------------------------------------------------------
// Abgeleitete Typen
// ---------------------------------------------------------------------------

/** Aufrufbare Form: ein Kanal ohne Anfrage wird ohne Argumente gerufen. */
type ArgsOf<T> = [T] extends [void] ? [] : [T];

/** Ein Kanaleintrag des Vertrags. */
type ChannelEntry = { request: unknown; response: unknown };
type IpcFnOf<E extends ChannelEntry> = (...args: ArgsOf<E['request']>) => Promise<E['response']>;

/** `csv:loadEvents` -> `csv`; `ping` -> kein Namespace. */
type NamespaceOf<C extends string> = C extends `${infer N}:${string}` ? N : never;
type MethodOf<C extends string, N extends string> = C extends `${N}:${infer M}` ? M : never;

/** Die heutige Renderer-Oberfläche, vollständig aus dem Vertrag abgeleitet. */
export type InvokeSurfaceOf<C extends Record<string, ChannelEntry>> = {
  // Kanäle ohne Namespace liegen direkt auf der Oberfläche (`api.ping`).
  [K in keyof C as K extends `${string}:${string}` ? never : K]: IpcFnOf<C[K]>;
} & {
  [N in NamespaceOf<Extract<keyof C, string>>]: {
    [K in keyof C as MethodOf<Extract<K, string>, N>]: IpcFnOf<C[K]>;
  };
};

type SubscriptionFnOf<C> = C extends keyof IpcEvents
  ? IpcEvents[C] extends void
    ? (callback: () => void) => () => void
    : (callback: (payload: IpcEvents[C]) => void) => () => void
  : never;

type SubscriptionSurfaceOf<L extends readonly { channel: string; path: readonly string[] }[]> = {
  [E in L[number] as E['path'][0]]: {
    [F in L[number] as F['path'][0] extends E['path'][0] ? F['path'][1] : never]: SubscriptionFnOf<
      F['channel']
    >;
  };
};

/** Verschmilzt Aufruf- und Abonnement-Oberfläche, Namespace für Namespace. */
type Merge<A, B> = {
  [K in keyof A | keyof B]: (K extends keyof A ? A[K] : unknown) & (K extends keyof B ? B[K] : unknown);
};

export type ElectronAPI = Merge<
  InvokeSurfaceOf<IpcContract>,
  SubscriptionSurfaceOf<typeof EVENT_SUBSCRIPTIONS>
> & { platform: string };

// ---------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------

/** Transport der Wahl: `ipcRenderer.invoke` im Preload, ein Fake im Test. */
export type InvokeFn = (channel: string, ...args: unknown[]) => Promise<unknown>;

/**
 * Der Vertrag, auf den eine Kanalliste eingegrenzt ist. Der mapped type ist
 * wichtig: `Record<C[number], …>` würde alle Einträge zu einer Vereinigung
 * zusammenfassen und damit jede Nutzlast verlieren.
 */
export type ContractOf<C extends readonly (keyof IpcContract)[]> = {
  [K in C[number]]: IpcContract[K];
};

/**
 * Baut `api` aus einer Kanalliste. Der Rückgabetyp leitet sich aus der
 * *übergebenen* Liste ab, nicht aus `IpcContract` – deshalb passt das Ergebnis
 * nur dann zu `ElectronAPI`, wenn Liste und Vertrag übereinstimmen.
 */
export function buildInvokeSurface<C extends readonly (keyof IpcContract)[]>(
  channels: C,
  invoke: InvokeFn
): InvokeSurfaceOf<ContractOf<C>> {
  const surface: Record<string, unknown> = {};
  for (const channel of channels) {
    const sep = channel.indexOf(':');
    const fn = (...args: unknown[]) => invoke(channel, ...args);
    if (sep === -1) {
      surface[channel] = fn;
    } else {
      const ns = channel.slice(0, sep);
      const method = channel.slice(sep + 1);
      const bucket = (surface[ns] ??= {}) as Record<string, unknown>;
      bucket[method] = fn;
    }
  }
  return surface as InvokeSurfaceOf<ContractOf<C>>;
}

/** Abonniert die Sendekanäle; liefert je eine Abmeldefunktion. */
function buildEventSubscriptions(
  // Die Nutzlast ist hier bewusst `any`: der konkrete Typ wird beim Aufrufer
  // durch `SubscriptionSurfaceOf` wieder aufgesetzt und ist dort nicht mehr
  // versehentlich `any`.
  on: (channel: string, listener: (payload: any) => void) => () => void
): SubscriptionSurfaceOf<typeof EVENT_SUBSCRIPTIONS> {
  const surface: Record<string, Record<string, unknown>> = {};
  for (const { channel, path } of EVENT_SUBSCRIPTIONS) {
    const [ns, method] = path;
    const bucket = (surface[ns] ??= {});
    bucket[method] = (callback: (payload: any) => void) => on(channel, callback);
  }
  return surface as SubscriptionSurfaceOf<typeof EVENT_SUBSCRIPTIONS>;
}

/**
 * Verschmilzt zwei Oberflächen eine Ebene tief: `runner` existiert sowohl bei
 * den aufrufenden Kanälen (`start`, `cancel`) als auch beim Abonnement
 * (`onStatusUpdate`). Ein schlichtes Object-Spread würde den Namespace
 * überschreiben statt ihn zu ergänzen.
 */
function mergeNamespaces(
  calls: Record<string, unknown>,
  subscriptions: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...calls };
  for (const [key, value] of Object.entries(subscriptions)) {
    const existing = merged[key];
    merged[key] =
      existing && typeof existing === 'object' ? { ...(existing as object), ...(value as object) } : value;
  }
  return merged;
}

/**
 * Die vollständige `window.electronAPI`. Das ist der einzige Aufbau, den der
 * Preload braucht – er hat nichts zu wiederholen.
 *
 * Der Rückgabetyp hängt an der *übergebenen* Kanalliste. Fehlt dort ein Kanal
 * aus `IpcContract`, ist das Ergebnis nicht mehr zu `ElectronAPI` zuweisbar und
 * `preload.ts` bricht beim Bauen.
 */
export function buildElectronApi<C extends readonly (keyof IpcContract)[]>(
  channels: C,
  platform: string,
  invoke: InvokeFn,
  on: (channel: string, listener: (payload: any) => void) => () => void
): Merge<InvokeSurfaceOf<ContractOf<C>>, SubscriptionSurfaceOf<typeof EVENT_SUBSCRIPTIONS>> & {
  platform: string;
} {
  const merged = mergeNamespaces(
    buildInvokeSurface(channels, invoke) as unknown as Record<string, unknown>,
    buildEventSubscriptions(on) as unknown as Record<string, unknown>
  );
  return { platform, ...merged } as Merge<
    InvokeSurfaceOf<ContractOf<C>>,
    SubscriptionSurfaceOf<typeof EVENT_SUBSCRIPTIONS>
  > & { platform: string };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
