export const AUTH_HINT_STORAGE_KEY = 'stack_auth_hint';

export type AuthHintValue = '1' | '0' | null;

export type AppScreenState =
  | 'loading'
  | 'session-error-screen'
  | 'verify-email-screen'
  | 'main-app'
  | 'auth-screen'
  | 'public-shell';

export function isDefinitiveAuthRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403;
}

function resolveStorage(
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (storage !== undefined) return storage;
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

export function readAuthHint(
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
): AuthHintValue {
  const target = resolveStorage(storage);
  if (!target) return null;
  try {
    const val = target.getItem(AUTH_HINT_STORAGE_KEY);
    if (val === '1' || val === '0') return val;
    return null;
  } catch {
    return null;
  }
}

export function writeAuthHint(
  value: '1' | '0',
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.setItem(AUTH_HINT_STORAGE_KEY, value);
  } catch {
    // Ignorar errores de cuota o modo privado
  }
}

/**
 * Determina la pantalla raíz de la aplicación.
 * INVARIANTE CRÍTICA: una sesión activa con email no verificado SIEMPRE muestra
 * `verify-email-screen` y NUNCA accede al shell público ni a la app principal.
 */
export function determineAppScreen(params: {
  isLoading: boolean;
  isAuthenticated: boolean;
  isEmailVerified: boolean;
  isLoginOpen?: boolean;
  hasSessionError?: boolean;
}): AppScreenState {
  if (params.isLoading) return 'loading';
  if (params.hasSessionError && !params.isAuthenticated) return 'session-error-screen';
  if (params.isAuthenticated && !params.isEmailVerified) return 'verify-email-screen';
  if (params.isAuthenticated) return 'main-app';
  if (params.isLoginOpen) return 'auth-screen';
  return 'public-shell';
}

export function normalizeReturnToHash(rawHash?: string | null): string | null {
  if (typeof rawHash !== 'string') return null;
  const trimmed = rawHash.trim();
  if (!trimmed || trimmed === '#') return null;
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

export function resolveReturnToHashAfterAuth(params: {
  currentReturnToHash: string | null;
  emailVerified: boolean;
  applyHash?: (hash: string) => void;
}): {
  shouldCloseLogin: boolean;
  consumedHash: string | null;
  remainingReturnToHash: string | null;
} {
  if (!params.emailVerified) {
    // Mantener el retorno pendiente mientras el usuario completa VerifyEmailScreen
    return {
      shouldCloseLogin: true,
      consumedHash: null,
      remainingReturnToHash: params.currentReturnToHash,
    };
  }
  const target = normalizeReturnToHash(params.currentReturnToHash);
  if (target && params.applyHash) {
    params.applyHash(target);
  }
  return {
    shouldCloseLogin: true,
    consumedHash: target,
    remainingReturnToHash: null,
  };
}

/**
 * Verificación inicial de sesión basada en `stack_auth_hint`:
 * - `'0'`: cero peticiones de red (`/api/me` / `/refresh`)
 * - `'1'` o ausente: una sola consulta `fetchMe()` con alerta cold-start tras 2.5s;
 *   guarda `'1'` si responde usuario válido, `'0'` únicamente ante rechazo
 *   definitivo (`401`/`403` o respuesta explícita sin sesión), y preserva la
 *   marca sin cambios ante errores transitorios (red, timeout, 5xx/503).
 */
export async function runInitialSessionCheck<TUser>(params: {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  fetchMe: () => Promise<{ success?: boolean; user?: TUser | null }>;
  onWakingChange?: (waking: boolean) => void;
  wakingDelayMs?: number;
}): Promise<{
  status: 'authenticated' | 'anonymous' | 'transient_error';
  user: TUser | null;
  hintAfter: AuthHintValue;
  didProbeNetwork: boolean;
  error?: unknown;
}> {
  const hint = readAuthHint(params.storage);
  if (hint === '0') {
    return { status: 'anonymous', user: null, hintAfter: '0', didProbeNetwork: false };
  }

  const delayMs = params.wakingDelayMs ?? 2500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (delayMs > 0) {
    timer = setTimeout(() => {
      params.onWakingChange?.(true);
    }, delayMs);
  }

  try {
    const res = await params.fetchMe();
    if (res?.success && res.user) {
      writeAuthHint('1', params.storage);
      return { status: 'authenticated', user: res.user, hintAfter: '1', didProbeNetwork: true };
    }
    writeAuthHint('0', params.storage);
    return { status: 'anonymous', user: null, hintAfter: '0', didProbeNetwork: true };
  } catch (err) {
    if (isDefinitiveAuthRejection(err)) {
      writeAuthHint('0', params.storage);
      return { status: 'anonymous', user: null, hintAfter: '0', didProbeNetwork: true };
    }
    return {
      status: 'transient_error',
      user: null,
      hintAfter: readAuthHint(params.storage),
      didProbeNetwork: true,
      error: err,
    };
  } finally {
    if (timer) clearTimeout(timer);
    params.onWakingChange?.(false);
  }
}
