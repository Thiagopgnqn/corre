import { Request, Response, NextFunction } from 'express';
import { getClientIp } from '../../middlewares/rateLimiter.middleware.js';

interface PublicRateRecord {
  count: number;
  resetAt: number;
}

const DEFAULT_MAX_REQUESTS = 120;
const DEFAULT_WINDOW_MS = 60 * 1000;

let activeMaxRequests = DEFAULT_MAX_REQUESTS;
let activeWindowMs = DEFAULT_WINDOW_MS;

const publicIpHits = new Map<string, PublicRateRecord>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of publicIpHits.entries()) {
    if (now > record.resetAt) publicIpHits.delete(ip);
  }
}, 5 * 60 * 1000).unref();

export function configurePublicRateLimiterForTesting(
  options: { maxRequests?: number; windowMs?: number } | null
): void {
  if (!options) {
    activeMaxRequests = DEFAULT_MAX_REQUESTS;
    activeWindowMs = DEFAULT_WINDOW_MS;
    publicIpHits.clear();
    return;
  }
  activeMaxRequests =
    typeof options.maxRequests === 'number' && options.maxRequests > 0
      ? options.maxRequests
      : DEFAULT_MAX_REQUESTS;
  activeWindowMs =
    typeof options.windowMs === 'number' && options.windowMs > 0
      ? options.windowMs
      : DEFAULT_WINDOW_MS;
  publicIpHits.clear();
}

export function resetPublicRateLimiterForTesting(): void {
  publicIpHits.clear();
}

export function publicRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const ip = getClientIp(req);

  const record = publicIpHits.get(ip) || { count: 0, resetAt: now + activeWindowMs };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + activeWindowMs;
  }

  record.count += 1;
  publicIpHits.set(ip, record);

  if (record.count > activeMaxRequests) {
    const waitSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
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
