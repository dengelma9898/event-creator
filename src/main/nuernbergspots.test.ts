import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NuernbergspotsAuth } from './nuernbergspots-auth.js';
import { ENVIRONMENTS, getNuernbergspotsConfig, PROD_CONFIG, TEST_CONFIG } from './nuernbergspots-config.js';
import type { SessionStore, StoredSession } from './session-store.js';
import { UploadService, type UploadDeps } from './upload-service.js';

// ---------------------------------------------------------------------------
// Attrappen
// ---------------------------------------------------------------------------

class MemoryStore implements SessionStore {
  public session: StoredSession | null = null;
  public canSave = true;
  load() {
    return this.session;
  }
  save(session: StoredSession) {
    if (!this.canSave) return false;
    this.session = session;
    return true;
  }
  clear() {
    this.session = null;
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Call = { url: string; init?: RequestInit };

/** Ein `fetch`, das die Antworten der Reihe nach liefert und jeden Aufruf merkt. */
function scriptedFetch(...answers: (Response | Error)[]) {
  const calls: Call[] = [];
  const queue = [...answers];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = queue.shift();
    if (!next) throw new Error('Unerwarteter Aufruf');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fn, calls };
}

const loginOk = (overrides: Record<string, unknown> = {}) =>
  json(200, { idToken: 'id-1', refreshToken: 'refresh-1', expiresIn: '3600', email: 'anna@example.de', ...overrides });

const refreshOk = (overrides: Record<string, unknown> = {}) =>
  json(200, { id_token: 'id-2', refresh_token: 'refresh-1', expires_in: '3600', ...overrides });

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

describe('Nürnbergspots-Konfiguration', () => {
  it('nimmt ohne Angabe Produktion', () => {
    assert.equal(getNuernbergspotsConfig(undefined, {}).target, 'prod');
    assert.equal(getNuernbergspotsConfig(undefined, {}).apiBaseUrl, 'https://nuernbergspots.de/prd');
    assert.equal(getNuernbergspotsConfig('prod', {}).firebaseApiKey, PROD_CONFIG.firebaseApiKey);
  });

  it('kennt Test (Citylife) und Prod (Nürnbergspots) mit eigenem Firebase-Key und eigener API', () => {
    const test = getNuernbergspotsConfig('test', {});
    assert.equal(test.target, 'test');
    assert.equal(test.apiBaseUrl, 'https://nuernbergspots.de/dev');
    assert.equal(test.firebaseApiKey, TEST_CONFIG.firebaseApiKey);
    assert.notEqual(test.firebaseApiKey, PROD_CONFIG.firebaseApiKey);
    assert.deepEqual(Object.keys(ENVIRONMENTS).sort(), ['prod', 'test']);
  });

  it('lässt Domi die API-Adresse überschreiben, behält aber den Key der gewählten Stage', () => {
    const config = getNuernbergspotsConfig('test', { NUERNBERGSPOTS_API_URL: 'http://localhost:3000/' });
    assert.equal(config.apiBaseUrl, 'http://localhost:3000');
    assert.equal(config.firebaseApiKey, TEST_CONFIG.firebaseApiKey);
  });
});

// ---------------------------------------------------------------------------
// Anmeldung
// ---------------------------------------------------------------------------

describe('NuernbergspotsAuth je Stage', () => {
  it('meldet an der Firebase-Instanz der gewählten Stage an und bleibt dort verbunden', async () => {
    const store = new MemoryStore();
    const { fn, calls } = scriptedFetch(loginOk());
    const auth = new NuernbergspotsAuth({ store, config: TEST_CONFIG, fetch: fn });

    await auth.login({ target: 'test', email: 'a@b.de', password: 'x' });

    assert.ok(calls[0].url.includes(`key=${TEST_CONFIG.firebaseApiKey}`), 'Login geht an das Citylife-Projekt');
    assert.ok(!calls[0].url.includes(PROD_CONFIG.firebaseApiKey));
    assert.deepEqual(auth.getStatus(), { target: 'test', connected: true, email: 'anna@example.de' });
  });

  it('hält die Sitzungen der Stages getrennt', async () => {
    const prodStore = new MemoryStore();
    const testStore = new MemoryStore();
    const prod = new NuernbergspotsAuth({ store: prodStore, config: PROD_CONFIG, fetch: scriptedFetch(loginOk()).fn });
    const test = new NuernbergspotsAuth({ store: testStore, config: TEST_CONFIG, fetch: scriptedFetch().fn });

    await prod.login({ target: 'prod', email: 'a@b.de', password: 'x' });

    assert.equal(prod.getStatus().connected, true);
    assert.equal(test.getStatus().connected, false, 'Prod-Anmeldung gilt nicht für Test');
    assert.deepEqual(await test.getIdToken(), { ok: false, kind: 'not-connected' });
  });
});

describe('NuernbergspotsAuth.login', () => {
  const make = (fetchFn: typeof fetch, store = new MemoryStore(), now = () => 1_000_000) => ({
    store,
    auth: new NuernbergspotsAuth({ store, config: PROD_CONFIG, fetch: fetchFn, now }),
  });

  it('meldet an und legt nur das Refresh-Token ab – nie das Passwort', async () => {
    const { fn, calls } = scriptedFetch(loginOk());
    const { auth, store } = make(fn);

    const result = await auth.login({ target: 'prod', email: ' anna@example.de ', password: 'geheim' });

    assert.deepEqual(result, { success: true, email: 'anna@example.de' });
    assert.deepEqual(store.session, { email: 'anna@example.de', refreshToken: 'refresh-1' });
    assert.ok(!JSON.stringify(store.session).includes('geheim'), 'Passwort darf nicht gespeichert werden');
    assert.match(calls[0].url, /accounts:signInWithPassword\?key=/);
    assert.equal(JSON.parse(String(calls[0].init?.body)).email, 'anna@example.de', 'E-Mail wird getrimmt');
  });

  it('übersetzt falsche Zugangsdaten in einen Alltagssatz', async () => {
    const { fn } = scriptedFetch(json(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } }));
    const { auth, store } = make(fn);

    const result = await auth.login({ target: 'prod', email: 'a@b.de', password: 'falsch' });

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /E-Mail oder Passwort stimmen nicht/);
    assert.equal(store.session, null);
  });

  it('erkennt zu viele Versuche trotz Zusatztext im Fehlercode', async () => {
    const { fn } = scriptedFetch(
      json(400, { error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER : Access to this account has been disabled' } })
    );
    const result = await make(fn).auth.login({ target: 'prod', email: 'a@b.de', password: 'x' });
    assert.match(result.error ?? '', /Zu viele Versuche/);
  });

  it('meldet fehlendes Netz verständlich', async () => {
    const { fn } = scriptedFetch(new TypeError('fetch failed'));
    const result = await make(fn).auth.login({ target: 'prod', email: 'a@b.de', password: 'x' });
    assert.match(result.error ?? '', /Internetverbindung/);
  });

  it('verlangt E-Mail und Passwort, ohne das Netz zu berühren', async () => {
    const { fn, calls } = scriptedFetch();
    const result = await make(fn).auth.login({ target: 'prod', email: '  ', password: '' });
    assert.equal(result.success, false);
    assert.equal(calls.length, 0);
  });

  it('meldet ehrlich, wenn die Sitzung nicht sicher gespeichert werden kann', async () => {
    const store = new MemoryStore();
    store.canSave = false;
    const { fn } = scriptedFetch(loginOk());
    const result = await make(fn, store).auth.login({ target: 'prod', email: 'a@b.de', password: 'x' });
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /sicher/);
    assert.equal(make(fn, store).auth.getStatus().connected, false);
  });
});

describe('NuernbergspotsAuth Status & Abmeldung', () => {
  it('zeigt „verbunden“ nur mit gespeicherter Sitzung und trennt beim Abmelden', async () => {
    const store = new MemoryStore();
    const auth = new NuernbergspotsAuth({ store, config: PROD_CONFIG, fetch: scriptedFetch(loginOk()).fn });
    assert.deepEqual(auth.getStatus(), { target: 'prod', connected: false });

    await auth.login({ target: 'prod', email: 'anna@example.de', password: 'x' });
    assert.deepEqual(auth.getStatus(), { target: 'prod', connected: true, email: 'anna@example.de' });

    auth.logout();
    assert.deepEqual(auth.getStatus(), { target: 'prod', connected: false });
    assert.equal(store.session, null);
  });
});

describe('NuernbergspotsAuth.getIdToken', () => {
  const connected = () => {
    const store = new MemoryStore();
    store.session = { email: 'anna@example.de', refreshToken: 'refresh-1' };
    return store;
  };

  it('verlangt eine Anmeldung, wenn keine Sitzung existiert', async () => {
    const { fn, calls } = scriptedFetch();
    const auth = new NuernbergspotsAuth({ store: new MemoryStore(), config: PROD_CONFIG, fetch: fn });
    assert.deepEqual(await auth.getIdToken(), { ok: false, kind: 'not-connected' });
    assert.equal(calls.length, 0);
  });

  it('holt ein Token mit dem Refresh-Token und merkt es sich', async () => {
    const { fn, calls } = scriptedFetch(refreshOk());
    const auth = new NuernbergspotsAuth({ store: connected(), config: PROD_CONFIG, fetch: fn, now: () => 0 });

    assert.deepEqual(await auth.getIdToken(), { ok: true, token: 'id-2' });
    assert.deepEqual(await auth.getIdToken(), { ok: true, token: 'id-2' });
    assert.equal(calls.length, 1, 'zweiter Aufruf kommt aus dem Speicher');
    assert.match(calls[0].url, /securetoken\.googleapis\.com\/v1\/token\?key=/);
    assert.match(String(calls[0].init?.body), /grant_type=refresh_token&refresh_token=refresh-1/);
  });

  it('erneuert das Token, bevor es abläuft', async () => {
    let now = 0;
    const { fn, calls } = scriptedFetch(refreshOk(), refreshOk({ id_token: 'id-3' }));
    const auth = new NuernbergspotsAuth({ store: connected(), config: PROD_CONFIG, fetch: fn, now: () => now });

    await auth.getIdToken();
    now = 56 * 60 * 1000; // weniger als 5 Minuten Restlaufzeit
    assert.deepEqual(await auth.getIdToken(), { ok: true, token: 'id-3' });
    assert.equal(calls.length, 2);
  });

  it('übernimmt ein rotiertes Refresh-Token', async () => {
    const store = connected();
    const { fn } = scriptedFetch(refreshOk({ refresh_token: 'refresh-NEU' }));
    await new NuernbergspotsAuth({ store, config: PROD_CONFIG, fetch: fn }).getIdToken();
    assert.equal(store.session?.refreshToken, 'refresh-NEU');
  });

  it('beendet die Sitzung, wenn Firebase das Refresh-Token endgültig ablehnt', async () => {
    const store = connected();
    const { fn } = scriptedFetch(json(400, { error: { message: 'TOKEN_EXPIRED' } }));
    const auth = new NuernbergspotsAuth({ store, config: PROD_CONFIG, fetch: fn });

    assert.deepEqual(await auth.getIdToken(), { ok: false, kind: 'session-expired' });
    assert.equal(store.session, null);
  });

  it('behält die Sitzung bei einem Netzfehler – ein zweiter Versuch genügt', async () => {
    const store = connected();
    const { fn } = scriptedFetch(new TypeError('fetch failed'));
    const auth = new NuernbergspotsAuth({ store, config: PROD_CONFIG, fetch: fn });

    assert.deepEqual(await auth.getIdToken(), { ok: false, kind: 'network' });
    assert.notEqual(store.session, null);
  });

  it('behält die Sitzung auch bei einem Serverfehler (5xx)', async () => {
    const store = connected();
    const { fn } = scriptedFetch(json(503, { error: { message: 'UNAVAILABLE' } }));
    const auth = new NuernbergspotsAuth({ store, config: PROD_CONFIG, fetch: fn });

    assert.deepEqual(await auth.getIdToken(), { ok: false, kind: 'network' });
    assert.notEqual(store.session, null);
  });

  it('holt nach invalidateToken() ein frisches Token', async () => {
    const { fn, calls } = scriptedFetch(refreshOk(), refreshOk({ id_token: 'id-3' }));
    const auth = new NuernbergspotsAuth({ store: connected(), config: PROD_CONFIG, fetch: fn, now: () => 0 });

    await auth.getIdToken();
    auth.invalidateToken();
    assert.deepEqual(await auth.getIdToken(), { ok: true, token: 'id-3' });
    assert.equal(calls.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

describe('UploadService', () => {
  const CONFIG = { ...PROD_CONFIG, apiBaseUrl: 'https://api.test/prd' };

  const makeService = (
    fetchFn: typeof fetch,
    overrides: Partial<UploadDeps> & { tokens?: ({ ok: true; token: string } | { ok: false; kind: any })[] } = {}
  ) => {
    const tokens = [...(overrides.tokens ?? [])];
    const invalidated: number[] = [];
    const service = new UploadService({
      auth: {
        getIdToken: async () => tokens.shift() ?? { ok: true as const, token: 'tok' },
        invalidateToken: () => {
          invalidated.push(1);
        },
      },
      paths: {
        resolveCsvFile: (name: string) =>
          name.endsWith('.csv') && !name.includes('/')
            ? { ok: true as const, filePath: `/data/${name}` }
            : { ok: false as const, error: 'nicht gefunden' },
        csvCheckScript: '/check.js',
        repoRoot: '/repo',
      },
      config: CONFIG,
      fetch: fetchFn,
      gate: async () => ({ violations: [], ran: true }),
      readFile: () => Buffer.from('Titel,Startdatum\nKonzert,2030-01-01\n'),
      ...overrides,
    } as UploadDeps);
    return { service, invalidated };
  };

  const imported = (data: Record<string, unknown>) => json(200, { data, timestamp: 'x' });

  it('lädt eine Datei als multipart mit Bearer-Token hoch und entpackt { data }', async () => {
    const { fn, calls } = scriptedFetch(
      imported({ totalRows: 3, successful: 2, skipped: 1, failed: 0, results: [] })
    );
    const { service } = makeService(fn);

    const result = await service.uploadFiles(['curt-events-data-2030-01-01.csv']);

    assert.equal(result.success, true);
    assert.equal(result.created, 2);
    assert.equal(result.duplicates, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.totalRows, 3, 'totalRows kommt aus der Backend-Antwort');
    assert.equal(result.target, 'prod');
    assert.equal(result.detailsForDomi, undefined, 'bei sauberem Upload keine Diagnose');

    assert.equal(calls[0].url, 'https://api.test/prd/events/import/csv');
    assert.equal(calls[0].init?.method, 'POST');
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer tok');
    const form = calls[0].init?.body as FormData;
    const file = form.get('file') as File;
    assert.equal(file.name, 'curt-events-data-2030-01-01.csv');
    assert.equal(await file.text(), 'Titel,Startdatum\nKonzert,2030-01-01\n');
  });

  it('versteht auch eine Antwort ohne { data }-Hülle', async () => {
    const { fn } = scriptedFetch(json(200, { successful: 4, skipped: 0, failed: 0, results: [] }));
    const result = await makeService(fn).service.uploadFiles(['a.csv']);
    assert.equal(result.created, 4);
  });

  it('zählt ohne totalRows die drei Zähler zusammen', async () => {
    const { fn } = scriptedFetch(imported({ successful: 2, skipped: 1, failed: 1 }));
    const result = await makeService(fn).service.uploadFiles(['a.csv']);
    assert.equal(result.totalRows, 4);
  });

  it('meldet die Stage im Ergebnis und in den Details für Domi', async () => {
    const { fn } = scriptedFetch(new TypeError('fetch failed'));
    const { service } = makeService(fn, { config: { ...TEST_CONFIG, apiBaseUrl: 'https://api.test/dev' } });
    const result = await service.uploadFiles(['a.csv']);
    assert.equal(result.target, 'test');
    assert.match(result.detailsForDomi ?? '', /Stage: Test \(Citylife\)/);
    assert.match(result.detailsForDomi ?? '', /https:\/\/api\.test\/dev\/events\/import\/csv/);
  });

  it('meldet abgelehnte Zeilen einer Datei, Duplikate zählen nicht als abgelehnt', async () => {
    const { fn, calls } = scriptedFetch(
      imported({ successful: 7, skipped: 3, failed: 1, results: [
        { rowIndex: 4, success: false, errors: [{ message: 'Startdatum fehlt' }] },
        { rowIndex: 5, success: false, skipped: true, errors: [] },
      ] })
    );
    const result = await makeService(fn).service.uploadFiles(['q-events-data-2030-01-01-2.csv']);

    assert.equal(calls.length, 1);
    assert.equal(result.success, true);
    assert.equal(result.created, 7);
    assert.equal(result.duplicates, 3);
    assert.equal(result.failed, 1);
    assert.equal(result.totalRows, 11, '7 + 3 + 1, aus den Zählern');
    assert.deepEqual(result.files[0].failedRows, ['Zeile 4: Startdatum fehlt'], 'Duplikate zählen nicht als abgelehnt');
    assert.match(result.detailsForDomi ?? '', /Zeile 4: Startdatum fehlt/, 'abgelehnte Zeilen landen in der Diagnose');
  });

  it('weist mehrere Dateien auf einmal ab und sendet nichts', async () => {
    const { fn, calls } = scriptedFetch();
    const result = await makeService(fn).service.uploadFiles([
      'q-events-data-2030-01-01.csv',
      'q-events-data-2030-01-01-2.csv',
    ]);

    assert.equal(calls.length, 0);
    assert.equal(result.success, false);
    assert.equal(result.errorKind, 'invalid-file');
    assert.match(result.error ?? '', /immer nur eine Datei/);
  });

  it('sendet einen Dateinamen nur einmal', async () => {
    const { fn, calls } = scriptedFetch(imported({ successful: 1, skipped: 0, failed: 0 }));
    await makeService(fn).service.uploadFiles(['a.csv', 'a.csv']);
    assert.equal(calls.length, 1);
  });

  it('sendet nie eine Datei, die das Import-Gate nicht besteht', async () => {
    const { fn, calls } = scriptedFetch();
    const { service } = makeService(fn, {
      gate: async () => ({ violations: [{ ruleId: 'past-event' }], ran: true }),
    });

    const result = await service.uploadFiles(['a.csv']);

    assert.equal(calls.length, 0);
    assert.equal(result.success, false);
    assert.equal(result.errorKind, 'invalid-file');
    assert.match(result.error ?? '', /Startdatum in der Vergangenheit/);
  });

  it('sendet nie eine Datei, die gar nicht geprüft werden konnte', async () => {
    const { fn, calls } = scriptedFetch();
    const { service } = makeService(fn, { gate: async () => ({ violations: [], ran: false }) });

    const result = await service.uploadFiles(['a.csv']);

    assert.equal(calls.length, 0);
    assert.match(result.error ?? '', /nicht geprüft werden/);
  });

  it('weist Namen ab, die nicht in den Ausgabeordner auflösen', async () => {
    const { fn, calls } = scriptedFetch();
    const result = await makeService(fn).service.uploadFiles(['../../etc/passwd']);
    assert.equal(calls.length, 0);
    assert.equal(result.errorKind, 'invalid-file');
  });

  it('macht ohne Dateien nichts', async () => {
    const { fn, calls } = scriptedFetch();
    const result = await makeService(fn).service.uploadFiles([]);
    assert.equal(calls.length, 0);
    assert.equal(result.success, false);
  });

  it('fordert eine Anmeldung, wenn keine Sitzung besteht', async () => {
    const { fn, calls } = scriptedFetch();
    const { service } = makeService(fn, { tokens: [{ ok: false, kind: 'not-connected' }] });

    const result = await service.uploadFiles(['a.csv']);

    assert.equal(calls.length, 0);
    assert.equal(result.errorKind, 'not-connected');
  });

  it('wiederholt bei einem abgelehnten Token genau einmal mit frischem Token', async () => {
    const { fn, calls } = scriptedFetch(json(401, { message: 'Unauthorized' }), imported({ successful: 1, skipped: 0, failed: 0 }));
    const { service, invalidated } = makeService(fn, {
      tokens: [{ ok: true, token: 'alt' }, { ok: true, token: 'neu' }],
    });

    const result = await service.uploadFiles(['a.csv']);

    assert.equal(result.success, true);
    assert.equal(invalidated.length, 1);
    assert.equal((calls[1].init?.headers as Record<string, string>).Authorization, 'Bearer neu');
  });

  it('meldet „Anmeldung abgelaufen“, wenn auch das frische Token abgelehnt wird', async () => {
    const { fn, calls } = scriptedFetch(json(401, {}), json(401, {}));
    const result = await makeService(fn).service.uploadFiles(['a.csv']);
    assert.equal(calls.length, 2);
    assert.equal(result.errorKind, 'session-expired');
  });

  it('meldet fehlende Berechtigung bei 403', async () => {
    const { fn } = scriptedFetch(json(403, { message: 'Anonymous users cannot create or modify events' }));
    const result = await makeService(fn).service.uploadFiles(['a.csv']);
    assert.equal(result.errorKind, 'forbidden');
    assert.match(result.error ?? '', /Frag Domi/);
  });

  it('meldet bei einem Netzfehler genau eine fehlgeschlagene Datei', async () => {
    const { fn, calls } = scriptedFetch(new TypeError('fetch failed'));
    const result = await makeService(fn).service.uploadFiles(['a.csv']);

    assert.equal(calls.length, 1);
    assert.equal(result.files.length, 1);
    assert.equal(result.errorKind, 'network');
    assert.match(result.detailsForDomi ?? '', /network/);
  });

  it('meldet 5xx als Serverproblem, 400 als ungültige Datei', async () => {
    const server = await makeService(scriptedFetch(json(500, {})).fn).service.uploadFiles(['a.csv']);
    assert.equal(server.errorKind, 'server');
    const bad = await makeService(scriptedFetch(json(400, {})).fn).service.uploadFiles(['a.csv']);
    assert.equal(bad.errorKind, 'invalid-file');
  });
});
