import { Request, Response, NextFunction } from 'express';

interface AttemptRecord {
  count: number;
  resetAt: number;
}

const ipAttempts = new Map<string, AttemptRecord>();
const emailAttempts = new Map<string, AttemptRecord>();

// Limpiar intentos expirados cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of ipAttempts.entries()) {
    if (now > record.resetAt) ipAttempts.delete(key);
  }
  for (const [key, record] of emailAttempts.entries()) {
    if (now > record.resetAt) emailAttempts.delete(key);
  }
}, 5 * 60 * 1000);

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp) return firstIp;
  } else if (Array.isArray(forwarded) && forwarded.length > 0) {
    const firstIp = forwarded[0].trim();
    if (firstIp) return firstIp;
  }
  return req.ip || req.socket.remoteAddress || 'unknown-ip';
}

export function authRateLimiter(options: { maxAttempts: number; windowMs: number }) {
  const { maxAttempts, windowMs } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const ip = getClientIp(req);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : null;

    // 1. Verificar límite por IP
    const ipRecord = ipAttempts.get(ip) || { count: 0, resetAt: now + windowMs };
    if (now > ipRecord.resetAt) {
      ipRecord.count = 0;
      ipRecord.resetAt = now + windowMs;
    }
    ipRecord.count += 1;
    ipAttempts.set(ip, ipRecord);

    if (ipRecord.count > maxAttempts) {
      const waitSeconds = Math.ceil((ipRecord.resetAt - now) / 1000);
      res.status(429).json({
        success: false,
        error: `Demasiados intentos desde esta IP. Por favor esperá ${waitSeconds} segundos.`,
      });
      return;
    }

    // 2. Verificar límite por Email (si aplica)
    if (email) {
      const emailRecord = emailAttempts.get(email) || { count: 0, resetAt: now + windowMs };
      if (now > emailRecord.resetAt) {
        emailRecord.count = 0;
        emailRecord.resetAt = now + windowMs;
      }
      emailRecord.count += 1;
      emailAttempts.set(email, emailRecord);

      if (emailRecord.count > maxAttempts) {
        const waitSeconds = Math.ceil((emailRecord.resetAt - now) / 1000);
        res.status(429).json({
          success: false,
          error: `Demasiados intentos para este usuario. Por favor esperá ${waitSeconds} segundos.`,
        });
        return;
      }
    }

    next();
  };
}

