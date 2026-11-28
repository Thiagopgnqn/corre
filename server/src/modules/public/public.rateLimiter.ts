import { Request, Response, NextFunction } from 'express';
import {
  env,
  parsePositiveIntEnv,
  parseRateLimitDebugEnv,
} from '../../config/env.js';

export interface PublicRateRecord {
  count: number;
  resetAt: number;
}

export const MAX_TRACKED_KEYS = 10_000;
export const MAX_KEY_LENGTH = 64;
export const MAX_DEBUG_LOG_REQUESTS = 20;
export const DEFAULT_PUBLIC_TRUSTED_HOPS = 2;
export const DEFAULT_PUBLIC_RATE_LIMIT_PER_MIN = 120;
export const DEFAULT_PUBLIC_RATE_LIMIT_UMBRELLA_PER_MIN = 1500;
export const DEFAULT_WINDOW_MS = 60 * 1000;

export interface PublicRateLimiterEnvConfig {
  trustedHops: number;
  clientMaxPerMin: number;
  umbrellaMaxPerMin: number;
  debug: boolean;
}

/**
 * Resuelve la configuración de entorno del limitador público con defaults seguros
 * ante valores faltantes o inválidos.
 */
export function resolvePublicRateLimiterEnvConfig(
  rawEnv: Record<string, string | undefined> = process.env
): PublicRateLimiterEnvConfig {
  return {
    trustedHops: parsePositiveIntEnv(rawEnv.PUBLIC_TRUSTED_HOPS, DEFAULT_PUBLIC_TRUSTED_HOPS),
    clientMaxPerMin: parsePositiveIntEnv(
      rawEnv.PUBLIC_RATE_LIMIT_PER_MIN,
      DEFAULT_PUBLIC_RATE_LIMIT_PER_MIN
    ),
    umbrellaMaxPerMin: parsePositiveIntEnv(
      rawEnv.PUBLIC_RATE_LIMIT_UMBRELLA_PER_MIN,
      DEFAULT_PUBLIC_RATE_LIMIT_UMBRELLA_PER_MIN
    ),
    debug: parseRateLimitDebugEnv(rawEnv.RATE_LIMIT_DEBUG),
  };
}

/**
 * Normaliza una entrada de IP: quita espacios, prefijo IPv4-mapeado `::ffff:`
 * y acota a MAX_KEY_LENGTH (64) caracteres.
 */
export function normalizeIpEntry(raw: string): string {
  return raw.trim().replace(/^::ffff:/i, '').slice(0, MAX_KEY_LENGTH);
}

/**
 * Extrae y normaliza las entradas no vacías del header X-Forwarded-For.
 */
export function parseForwardedForEntries(req: Pick<Request, 'headers'>): string[] {
  const rawHeader = req.headers?.['x-forwarded-for'];
  const joined = Array.isArray(rawHeader)
    ? rawHeader.join(',')
    : typeof rawHeader === 'string'
      ? rawHeader
      : '';
  if (!joined) return [];
  return joined
    .split(',')
    .map(normalizeIpEntry)
    .filter((entry) => entry.length > 0);
}

function getFallbackSocketIp(req: Pick<Request, 'socket'>): string {
  const normalized = normalizeIpEntry(req.socket?.remoteAddress || '');
  return normalized || 'unknown-ip';
}

/**
 * Calcula la IP del cliente para `/api/public/*` leyendo `X-Forwarded-For` desde
 * la DERECHA según `hops` (PUBLIC_TRUSTED_HOPS). Nunca confía en `req.ip`.
 */
export function getPublicClientIp(
  req: Pick<Request, 'headers' | 'socket'>,
  hops: number = activeTrustedHops
): string {
  const effectiveHops = Number.isInteger(hops) && hops >= 1 ? hops : DEFAULT_PUBLIC_TRUSTED_HOPS;
  const entries = parseForwardedForEntries(req);
  if (entries.length === 0) {
    return getFallbackSocketIp(req);
  }
  if (entries.length >= effectiveHops) {
    return entries[entries.length - effectiveHops];
  }
  // Si hay menos entradas que saltos confiables, tomamos entries[0] para evitar
  // retroceder hacia IPs falsificadas cuando no existen suficientes proxies intermedios.
  return entries[0];
}

/**
 * Obtiene la última IP del salto de proxy más cercano (o `req.socket.remoteAddress`).
 * Sirve como balde paraguas contra rotación de headers llamando directo al servidor.
 */
export function getLastHopIp(req: Pick<Request, 'headers' | 'socket'>): string {
  const entries = parseForwardedForEntries(req);
  if (entries.length > 0) {
    return entries[entries.length - 1];
  }
  return getFallbackSocketIp(req);
}

/**
 * Mapa de contadores con cota máxima de claves y evicción LRU/FIFO tras barrer vencidos.
 */
export class BoundedCounterMap {
  private readonly map = new Map<string, PublicRateRecord>();
  private readonly maxKeys: number;

  constructor(maxKeys: number = MAX_TRACKED_KEYS) {
    this.maxKeys = Number.isFinite(maxKeys) && maxKeys >= 1 ? Math.floor(maxKeys) : MAX_TRACKED_KEYS;
  }

  private normalizeKey(rawKey: string): string {
    const clean = String(rawKey || '').slice(0, MAX_KEY_LENGTH);
    return clean || 'unknown-ip';
  }

  increment(rawKey: string, now: number, windowMs: number): PublicRateRecord {
    const key = this.normalizeKey(rawKey);
    const existing = this.map.get(key);
    if (existing) {
      if (now > existing.resetAt) {
        existing.count = 1;
        existing.resetAt = now + windowMs;
      } else {
        existing.count += 1;
      }
      return existing;
    }

    if (this.map.size >= this.maxKeys) {
      this.sweepExpired(now);
      if (this.map.size >= this.maxKeys) {
        const oldestKey = this.map.keys().next().value;
        if (oldestKey !== undefined) {
          this.map.delete(oldestKey);
        }
      }
    }

    const record: PublicRateRecord = { count: 1, resetAt: now + windowMs };
    this.map.set(key, record);
    return record;
  }

  sweepExpired(now: number): void {
    for (const [key, record] of this.map.entries()) {
      if (now > record.resetAt) {
        this.map.delete(key);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }

  has(rawKey: string): boolean {
    return this.map.has(this.normalizeKey(rawKey));
  }

  get size(): number {
    return this.map.size;
  }
}

let activeTrustedHops = env.PUBLIC_TRUSTED_HOPS;
let activeMaxRequests = env.PUBLIC_RATE_LIMIT_PER_MIN;
let activeUmbrellaMaxRequests = env.PUBLIC_RATE_LIMIT_UMBRELLA_PER_MIN;
let activeWindowMs = DEFAULT_WINDOW_MS;
let activeDebug = env.RATE_LIMIT_DEBUG;
let activeLogger: (message: string) => void = (message) => console.log(message);
let debugLoggedRequests = 0;

let clientBuckets = new BoundedCounterMap(MAX_TRACKED_KEYS);
let umbrellaBuckets = new BoundedCounterMap(MAX_TRACKED_KEYS);

setInterval(() => {
  const now = Date.now();
  clientBuckets.sweepExpired(now);
  umbrellaBuckets.sweepExpired(now);
}, 5 * 60 * 1000).unref();

export function configurePublicRateLimiterForTesting(
  options: {
    maxRequests?: number;
    umbrellaMaxRequests?: number;
    windowMs?: number;
    trustedHops?: number;
    maxTrackedKeys?: number;
    debug?: boolean;
    logger?: (message: string) => void;
  } | null
): void {
  debugLoggedRequests = 0;

  if (!options) {
    activeTrustedHops = env.PUBLIC_TRUSTED_HOPS;
    activeMaxRequests = env.PUBLIC_RATE_LIMIT_PER_MIN;
    activeUmbrellaMaxRequests = env.PUBLIC_RATE_LIMIT_UMBRELLA_PER_MIN;
    activeWindowMs = DEFAULT_WINDOW_MS;
    activeDebug = env.RATE_LIMIT_DEBUG;
    activeLogger = (message) => console.log(message);
    clientBuckets = new BoundedCounterMap(MAX_TRACKED_KEYS);
    umbrellaBuckets = new BoundedCounterMap(MAX_TRACKED_KEYS);
    return;
  }

  activeTrustedHops =
    typeof options.trustedHops === 'number' &&
    Number.isInteger(options.trustedHops) &&
    options.trustedHops >= 1
      ? options.trustedHops
      : env.PUBLIC_TRUSTED_HOPS;
  activeMaxRequests =
    typeof options.maxRequests === 'number' && options.maxRequests > 0
      ? options.maxRequests
      : env.PUBLIC_RATE_LIMIT_PER_MIN;
  activeUmbrellaMaxRequests =
    typeof options.umbrellaMaxRequests === 'number' && options.umbrellaMaxRequests > 0
      ? options.umbrellaMaxRequests
      : env.PUBLIC_RATE_LIMIT_UMBRELLA_PER_MIN;
  activeWindowMs =
    typeof options.windowMs === 'number' && options.windowMs > 0
      ? options.windowMs
      : DEFAULT_WINDOW_MS;
  activeDebug = typeof options.debug === 'boolean' ? options.debug : env.RATE_LIMIT_DEBUG;
  activeLogger = options.logger ?? ((message) => console.log(message));

  const maxKeys =
    typeof options.maxTrackedKeys === 'number' && options.maxTrackedKeys >= 1
      ? Math.floor(options.maxTrackedKeys)
      : MAX_TRACKED_KEYS;
  clientBuckets = new BoundedCounterMap(maxKeys);
  umbrellaBuckets = new BoundedCounterMap(maxKeys);
}

export function resetPublicRateLimiterForTesting(): void {
  debugLoggedRequests = 0;
  clientBuckets.clear();
  umbrellaBuckets.clear();
}

export function publicRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const xffEntries = parseForwardedForEntries(req);
  const clientIp = getPublicClientIp(req, activeTrustedHops);
  const lastHopIp = getLastHopIp(req);

  if (activeDebug && debugLoggedRequests < MAX_DEBUG_LOG_REQUESTS) {
    debugLoggedRequests += 1;
    // Diagnóstico sin direcciones IP para medir saltos reales de proxy en producción.
    activeLogger(
      `[PublicRateLimitDebug ${debugLoggedRequests}/${MAX_DEBUG_LOG_REQUESTS}] xffEntries=${xffEntries.length} clientEqualsLastHop=${clientIp === lastHopIp}`
    );
  }

  const clientRecord = clientBuckets.increment(clientIp, now, activeWindowMs);
  const umbrellaRecord = umbrellaBuckets.increment(lastHopIp, now, activeWindowMs);

  const clientExceeded = clientRecord.count > activeMaxRequests;
  const umbrellaExceeded = umbrellaRecord.count > activeUmbrellaMaxRequests;

  if (clientExceeded || umbrellaExceeded) {
    const blockingResetAt =
      clientExceeded && umbrellaExceeded
        ? Math.max(clientRecord.resetAt, umbrellaRecord.resetAt)
        : clientExceeded
          ? clientRecord.resetAt
          : umbrellaRecord.resetAt;
    const waitSeconds = Math.max(1, Math.ceil((blockingResetAt - now) / 1000));
    res.setHeader('Retry-After', String(waitSeconds));
    res.status(429).json({
      success: false,
      code: 'PUBLIC_RATE_LIMIT_EXCEEDED',
      error: `Demasiadas consultas desde esta IP. Por favor esperá ${waitSeconds} segundos.`,
    });
    return;
  }

  next();
}
