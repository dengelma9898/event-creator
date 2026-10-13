import type { NuernbergspotsConfig } from './nuernbergspots-config.js';
import type { SessionStore } from './session-store.js';
import type { NuernbergspotsLoginInput, NuernbergspotsLoginResult, NuernbergspotsStatus } from '../shared/types.js';

type FetchFn = typeof fetch;

/** Warum kein ID-Token geliefert werden konnte. */
export type TokenFailure = 'not-connected' | 'session-expired' | 'network';

export type TokenResult = { ok: true; token: string } | { ok: false; kind: TokenFailure };

/** So viel Restlaufzeit muss ein Token mindestens haben, sonst wird erneuert. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Firebase-Fehlercodes, bei denen das Refresh-Token endgültig unbrauchbar ist. */
const DEAD_SESSION_CODES = ['TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN', 'USER_DISABLED', 'USER_NOT_FOUND'];

/** Alltagssprache für die Anmeldefehler von Firebase. */
function loginErrorText(code: string): string {
  switch (code) {
    case 'EMAIL_NOT_FOUND':
    case 'INVALID_PASSWORD':
    case 'INVALID_LOGIN_CREDENTIALS':
      return 'E-Mail oder Passwort stimmen nicht. Bitte noch einmal prüfen.';
    case 'INVALID_EMAIL':
      return 'Diese E-Mail-Adresse sieht nicht richtig aus.';
    case 'USER_DISABLED':
      return 'Dieser Zugang ist gesperrt. Frag Domi.';
    case 'TOO_MANY_ATTEMPTS_TRY_LATER':
      return 'Zu viele Versuche. Bitte warte ein paar Minuten und probiere es dann noch einmal.';
    default:
      return 'Die Anmeldung hat nicht geklappt. Bitte versuche es noch einmal oder frag Domi.';
  }
}

/** Liest den Fehlercode aus einer Firebase-Fehlerantwort (`error.message`). */
async function readFirebaseErrorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    // Manche Codes tragen Zusätze: "TOO_MANY_ATTEMPTS_TRY_LATER : Access to ..."
    return (body.error?.message ?? '').split(' ')[0];
  } catch {
    return '';
  }
}

/**
 * Meldet die App bei Nürnbergspots an – über die Firebase-Auth-REST-API, im
 * Hauptprozess (der Renderer darf per CSP nie ins Netz).
 *
 * Es wird nur das Refresh-Token abgelegt, nie das Passwort. Das ID-Token – es
 * ist eine Stunde gültig – wird im Arbeitsspeicher gehalten und vor Ablauf still
 * erneuert.
 */
export class NuernbergspotsAuth {
  private idToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly deps: {
      store: SessionStore;
      config: NuernbergspotsConfig;
      fetch?: FetchFn;
      now?: () => number;
    }
  ) {}

  private get doFetch(): FetchFn {
    return this.deps.fetch ?? fetch;
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  public getStatus(): NuernbergspotsStatus {
    const session = this.deps.store.load();
    const target = this.deps.config.target;
    return session ? { target, connected: true, email: session.email } : { target, connected: false };
  }

  public async login(input: NuernbergspotsLoginInput): Promise<NuernbergspotsLoginResult> {
    const email = input.email.trim();
    if (!email || !input.password) {
      return { success: false, error: 'Bitte E-Mail und Passwort eintragen.' };
    }

    let response: Response;
    try {
      response = await this.doFetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${this.deps.config.firebaseApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: input.password, returnSecureToken: true }),
        }
      );
    } catch {
      return { success: false, error: 'Keine Internetverbindung. Bitte prüfe kurz dein WLAN.' };
    }

    if (!response.ok) {
      return { success: false, error: loginErrorText(await readFirebaseErrorCode(response)) };
    }

    const body = (await response.json()) as {
      idToken?: string;
      refreshToken?: string;
      expiresIn?: string;
      email?: string;
    };
    if (!body.idToken || !body.refreshToken) {
      return { success: false, error: loginErrorText('') };
    }

    const savedEmail = body.email || email;
    if (!this.deps.store.save({ email: savedEmail, refreshToken: body.refreshToken })) {
      return { success: false, error: 'Die Anmeldung konnte nicht sicher auf diesem Mac gespeichert werden.' };
    }

    this.idToken = {
      value: body.idToken,
      expiresAt: this.now() + Number(body.expiresIn ?? 3600) * 1000,
    };
    return { success: true, email: savedEmail };
  }

  public logout(): void {
    this.idToken = null;
    this.deps.store.clear();
  }

  /**
   * Verwirft das gemerkte ID-Token (nicht die Sitzung). Der nächste
   * `getIdToken()` holt ein frisches – für den Fall, dass das Backend ein noch
   * nicht abgelaufenes Token ablehnt.
   */
  public invalidateToken(): void {
    this.idToken = null;
  }

  /**
   * Liefert ein gültiges ID-Token oder den Grund, warum keines zu haben ist.
   * Nur eine *endgültige* Ablehnung durch Firebase beendet die Sitzung; ein
   * Netzfehler lässt sie bestehen, damit ein zweiter Versuch genügt.
   */
  public async getIdToken(): Promise<TokenResult> {
    const session = this.deps.store.load();
    if (!session) {
      this.idToken = null;
      return { ok: false, kind: 'not-connected' };
    }

    if (this.idToken && this.idToken.expiresAt - this.now() > REFRESH_MARGIN_MS) {
      return { ok: true, token: this.idToken.value };
    }

    let response: Response;
    try {
      response = await this.doFetch(
        `https://securetoken.googleapis.com/v1/token?key=${this.deps.config.firebaseApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: session.refreshToken,
          }).toString(),
        }
      );
    } catch {
      return { ok: false, kind: 'network' };
    }

    if (!response.ok) {
      const code = await readFirebaseErrorCode(response);
      if (response.status === 400 && DEAD_SESSION_CODES.includes(code)) {
        this.logout();
        return { ok: false, kind: 'session-expired' };
      }
      return { ok: false, kind: 'network' };
    }

    const body = (await response.json()) as { id_token?: string; refresh_token?: string; expires_in?: string };
    if (!body.id_token) {
      return { ok: false, kind: 'network' };
    }

    // Firebase darf das Refresh-Token rotieren; das neue gilt ab jetzt.
    if (body.refresh_token && body.refresh_token !== session.refreshToken) {
      this.deps.store.save({ email: session.email, refreshToken: body.refresh_token });
    }

    this.idToken = {
      value: body.id_token,
      expiresAt: this.now() + Number(body.expires_in ?? 3600) * 1000,
    };
    return { ok: true, token: body.id_token };
  }
}
