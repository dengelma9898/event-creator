import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, describe, it } from 'node:test';

import {
  buildElectronApi,
  buildInvokeSurface,
  EVENT_SUBSCRIPTIONS,
  IPC_CHANNELS,
  type IpcChannel,
  type IpcEventChannel,
} from '../shared/ipc-contract.js';
import { buildIpcHandlers, registerIpcHandlers, type IpcDeps } from './ipc.js';
import { registeredHandlers } from './_electron-stub.js';

/** Attrappen für die Dienste – der Test prüft die Zuordnung, nicht die Dienste. */
const fakeDeps = (): IpcDeps =>
  ({
    keychain: { isConfigured: () => true, setApiKey: () => true, clearApiKey: () => true },
    nuernbergspots: (target: string) => ({
      getStatus: () => ({ target, connected: false }),
      login: () => ({ success: true }),
      logout: () => {},
    }),
    uploader: (target: string) => ({
      uploadFiles: () => ({ target, success: true, created: 0, duplicates: 0, failed: 0, totalRows: 0, files: [] }),
    }),
    skills: { listSkills: () => [], getSkill: () => undefined },
    runner: { startRun: () => ({ success: true }), cancelRun: () => ({ success: true }) },
    assistant: { analyzeSource: () => ({ success: true }), saveSkill: () => ({ success: true }) },
    csv: {
      listFiles: () => [],
      loadEvents: () => [],
      deleteEvent: () => ({ success: true }),
      updateEvent: () => ({ success: true }),
      getAllSourceStatuses: () => ({}),
      getSourceStatus: () => null,
    },
    paths: { dataDir: '/tmp', resolveCsvFile: () => ({ ok: true, filePath: '/tmp/a.csv' }) },
    reveal: () => {},
    openPath: () => {},
    openExternal: async () => {},
    writeClipboard: () => {},
    sendStatus: () => {},
  }) as unknown as IpcDeps;

/** `csv:loadEvents` -> `['csv','loadEvents']`, `ping` -> `['ping']`. */
const pathFor = (channel: IpcChannel): string[] => channel.split(':');

/** Liest einen verschachtelten Pfad; `undefined`, wenn er nicht existiert. */
const at = (api: Record<string, any>, [head, ...rest]: string[]): unknown =>
  rest.length === 0 ? api[head] : at(api[head] ?? {}, rest);

let sandbox: string;

before(() => {
  // `registerIpcHandlers` baut die echten Dienste auf. Deren Pfadauflösung
  // soll im Test nirgends im Dateisystem landen.
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-test-'));
  process.env.EVENT_CREATOR_REPO_ROOT = sandbox;
  process.env.EVENT_CREATOR_DATA_DIR = path.join(sandbox, 'data');
});

describe('Kanalliste', () => {
  it('nennt jeden Kanal genau einmal', () => {
    assert.equal(new Set(IPC_CHANNELS).size, IPC_CHANNELS.length, 'Doppelter Kanaleintrag');
  });
});

describe('Registrierung im Hauptprozess', () => {
  it('registriert genau die Kanäle des Vertrags – kein "No handler registered"', () => {
    const handlers = buildIpcHandlers(fakeDeps());
    const registered = Object.keys(handlers).sort();
    const declared = [...IPC_CHANNELS].sort();
    assert.deepEqual(
      registered,
      declared,
      `registriert, aber nicht im Vertrag: ${
        registered.filter((c) => !declared.includes(c as IpcChannel)).join(', ') || '—'
      } | im Vertrag, aber nicht registriert: ${
        declared.filter((c) => !registered.includes(c)).join(', ') || '—'
      }`
    );
  });

  it('hält die Form jedes Handlers ein', () => {
    // `IpcHandlers` ist ein mapped type über `IpcContract`: Ein Handler mit
    // falscher Anfrage oder Antwort wäre schon beim Bauen ein Compilerfehler.
    const handlers = buildIpcHandlers(fakeDeps());
    assert.equal(typeof handlers.ping, 'function');
    assert.equal(typeof handlers['csv:loadEvents'], 'function');
  });

  it('reicht die Nutzlast unverändert an den Dienst weiter', async () => {
    const seen: unknown[] = [];
    const deps = fakeDeps();
    (deps.csv as any).loadEvents = (names: string[]) => {
      seen.push(names);
      return [];
    };
    await buildIpcHandlers(deps)['csv:loadEvents'](['a.csv']);
    assert.deepEqual(seen, [['a.csv']]);
  });

  it('leitet Anmeldung und Upload an die gewählte Stage und weist unbekannte Stages ab', async () => {
    const used: string[] = [];
    const deps = fakeDeps();
    deps.nuernbergspots = (target) => {
      used.push(`auth:${target}`);
      return { getStatus: () => ({ target, connected: false }), login: async () => ({ success: true }), logout: () => {} };
    };
    deps.uploader = (target) => {
      used.push(`upload:${target}`);
      return { uploadFiles: async () => ({ target } as never) };
    };
    const handlers = buildIpcHandlers(deps);

    await handlers['nuernbergspots:getStatus']('test');
    await handlers['nuernbergspots:login']({ target: 'prod', email: 'a@b.de', password: 'x' });
    await handlers['nuernbergspots:logout']('test');
    await handlers['nuernbergspots:upload']({ target: 'test', fileNames: ['a.csv'] });
    assert.deepEqual(used, ['auth:test', 'auth:prod', 'auth:test', 'upload:test']);

    assert.throws(() => handlers['nuernbergspots:getStatus']('staging' as never), /Unbekannte Stage/);
    assert.throws(
      () => handlers['nuernbergspots:upload']({ fileNames: ['a.csv'] } as never),
      /Unbekannte Stage/
    );
  });

  it('schickt Statusmeldungen über den übergebenen Kanal', async () => {
    const sent: [string, unknown][] = [];
    const deps = fakeDeps();
    (deps.runner as any).startRun = (_id: string, onUpdate: (u: unknown) => void) => {
      onUpdate({ phase: 'completed' });
      return { success: true };
    };
    deps.sendStatus = (channel, payload) => sent.push([channel, payload]);
    await buildIpcHandlers(deps)['runner:start']('curt');
    assert.deepEqual(sent, [['runner:statusUpdate', { phase: 'completed' }]]);
  });
});

describe('Abgeleitete Preload-Oberfläche', () => {
  it('legt jeden Kanal unter dem abgeleiteten Pfad ab', () => {
    const api = buildInvokeSurface(IPC_CHANNELS, async () => undefined) as Record<string, any>;

    for (const channel of IPC_CHANNELS) {
      const where = `api.${pathFor(channel).join('.')}`;
      assert.equal(
        typeof at(api, pathFor(channel)),
        'function',
        `Kanal "${channel}" liegt nicht als Funktion unter ${where}`
      );
    }
  });

  it('enthält keinen Aufruf, den es nicht im Vertrag gibt', () => {
    const api = buildInvokeSurface(IPC_CHANNELS, async () => undefined) as Record<string, any>;
    const found: string[] = [];
    for (const [ns, value] of Object.entries(api)) {
      if (typeof value === 'function') found.push(ns);
      else for (const method of Object.keys(value)) found.push(`${ns}:${method}`);
    }
    assert.equal(found.length, IPC_CHANNELS.length, `unerwartete Einträge: ${found.join(', ')}`);
  });

  it('reicht Kanalnamen und Argumente unverändert durch', async () => {
    const calls: unknown[][] = [];
    const api = buildInvokeSurface(IPC_CHANNELS, async (channel, ...args) => {
      calls.push([channel, ...args]);
      return undefined;
    }) as any;

    await api.csv.loadEvents(['a.csv', 'b.csv']);
    await api.apiKey.set('secret');
    await api.ping();

    assert.deepEqual(calls[0], ['csv:loadEvents', ['a.csv', 'b.csv']]);
    assert.deepEqual(calls[1], ['apiKey:set', 'secret']);
    assert.deepEqual(calls[2], ['ping'], 'ein Kanal ohne Anfrage wird ohne Argumente gerufen');
  });

  it('ergänzt die Abonnements, ohne den Namespace zu überschreiben', () => {
    const api = buildElectronApi(IPC_CHANNELS, 'test', async () => undefined, () => () => {}) as Record<string, any>;

    // Genau der Fall, der bei einem schlichten Object-Spread verloren ginge:
    // `runner` existiert als Namespace der Aufrufe *und* des Abonnements.
    assert.equal(typeof api.runner.start, 'function', 'runner.start fehlt');
    assert.equal(typeof api.runner.cancel, 'function', 'runner.cancel fehlt');
    assert.equal(typeof api.runner.onStatusUpdate, 'function', 'runner.onStatusUpdate fehlt');
    assert.equal(typeof api.assistant.analyze, 'function', 'assistant.analyze fehlt');
    assert.equal(typeof api.assistant.onStatusUpdate, 'function', 'assistant.onStatusUpdate fehlt');
    assert.equal(typeof api.settings.onOpenSettings, 'function', 'settings.onOpenSettings fehlt');
    assert.equal(api.platform, 'test');
  });

  it('liefert für jedes Abonnement eine Abmeldefunktion', () => {
    let unsubscribed = 0;
    const api = buildElectronApi(IPC_CHANNELS, 'test', async () => undefined, () => () => {
      unsubscribed += 1;
    }) as Record<string, any>;
    for (const { path: p } of EVENT_SUBSCRIPTIONS) {
      const [ns, method] = p;
      const unsubscribe = api[ns][method](() => {});
      assert.equal(typeof unsubscribe, 'function', `api.${ns}.${method} liefert keine Abmeldefunktion`);
      unsubscribe();
    }
    assert.equal(unsubscribed, EVENT_SUBSCRIPTIONS.length, 'die Abmeldung greift nicht');
  });

  it('abonniert genau die Sendekanäle aus IpcEvents', () => {
    const subscribed: string[] = [];
    const api = buildElectronApi(IPC_CHANNELS, 'test', async () => undefined, (channel) => {
      subscribed.push(channel);
      return () => {};
    }) as Record<string, any>;

    // Erst abonnieren – erst dann wird der Transport berührt.
    for (const { path: p } of EVENT_SUBSCRIPTIONS) {
      const [ns, method] = p;
      api[ns][method](() => {});
    }

    assert.deepEqual(subscribed.sort(), EVENT_SUBSCRIPTIONS.map((e) => e.channel).sort());
    // Jeder abonnierte Kanal muss im Ereignisvertrag stehen, sonst ist seine
    // Nutzlast nicht typisiert.
    const known: IpcEventChannel[] = ['runner:statusUpdate', 'assistant:statusUpdate', 'menu:open-settings'];
    for (const channel of subscribed) {
      assert.ok(known.includes(channel as IpcEventChannel), `unbekannter Sendekanal ${channel}`);
    }
  });
});

describe('Herkunftsprüfung an der Registrierung', () => {
  /** Ein Fenster, wie Electron es für die Prüfung liefert. */
  const makeWindow = () => {
    const mainFrame = { name: 'main' };
    return {
      isDestroyed: () => false,
      webContents: { mainFrame, send: () => {} },
    };
  };

  const callPing = (event: unknown) => {
    const listener = registeredHandlers.get('ping');
    assert.ok(listener, 'ping ist nicht registriert');
    return listener(event);
  };

  it('lässt einen Aufruf aus dem eigenen Hauptframe durch', () => {
    const win = makeWindow();
    registerIpcHandlers(() => win as never);
    assert.equal(
      callPing({ sender: win.webContents, senderFrame: win.webContents.mainFrame }),
      'pong'
    );
  });

  it('weist einen fremden Absender ab, bevor der Handler läuft', () => {
    const win = makeWindow();
    registerIpcHandlers(() => win as never);
    assert.throws(
      () => callPing({ sender: { id: 'fremd' }, senderFrame: {} }),
      /nicht vom eigenen Fenster/
    );
  });

  it('weist einen Aufruf aus einem Unterframe ab', () => {
    const win = makeWindow();
    registerIpcHandlers(() => win as never);
    assert.throws(
      () => callPing({ sender: win.webContents, senderFrame: { name: 'subframe' } }),
      /Hauptframe/
    );
    assert.throws(() => callPing({ sender: win.webContents, senderFrame: null }), /Hauptframe/);
  });

  it('weist Aufrufe ab, wenn es kein Fenster gibt', () => {
    registerIpcHandlers(() => null);
    assert.throws(() => callPing({ sender: {}, senderFrame: {} }), /kein Fenster/);
  });

  it('hat nach der Registrierung genau die Vertragskanäle angelegt', () => {
    const win = makeWindow();
    registeredHandlers.clear();
    registerIpcHandlers(() => win as never);
    assert.deepEqual([...registeredHandlers.keys()].sort(), [...IPC_CHANNELS].sort());
  });
});
