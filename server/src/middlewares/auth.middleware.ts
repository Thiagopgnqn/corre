import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';

export interface AuthUserPayload {
  id: string;
  email: string;
  role: 'user' | 'admin';
  selectedPlanId: string | null;
  emailVerified?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}

export interface LiveUserStatusRecord {
  id: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  emailVerified: boolean;
}

interface CachedUserRecord extends LiveUserStatusRecord {
  expiresAt: number;
}

const userStatusCache = new Map<string, CachedUserRecord>();
const lastSeenDebounce = new Map<string, number>();

type LiveUserResolver = (userId: string) => Promise<LiveUserStatusRecord | null>;
let customLiveUserResolver: LiveUserResolver | null = null;

export function setLiveUserResolverForTesting(resolver: LiveUserResolver | null): void {
  customLiveUserResolver = resolver;
}

export function invalidateUserStatusCache(userId?: string): void {
  if (userId) {
    userStatusCache.delete(userId);
  } else {
    userStatusCache.clear();
  }
}

export async function getUserLiveStatus(userId: string): Promise<LiveUserStatusRecord | null> {
  if (customLiveUserResolver) {
    return customLiveUserResolver(userId);
  }

  const now = Date.now();
  const cached = userStatusCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  try {
    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        status: users.status,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) {
      userStatusCache.delete(userId);
      return null;
    }

    const record: CachedUserRecord = {
      id: row.id,
      email: row.email,
      role: (row.role as 'user' | 'admin') || 'user',
      status: (row.status as 'active' | 'suspended') || 'active',
      emailVerified: Boolean(row.emailVerifiedAt),
      expiresAt: now + 5000, // 5 segundos de caché en memoria para alto rendimiento
    };
    userStatusCache.set(userId, record);
    return record;
  } catch (_err) {
    // Si la columna status o last_seen_at aún no fue migrada en la base de datos, consultar columnas base existentes
    try {
      const [fallbackRow] = await db
        .select({
          id: users.id,
          email: users.email,
          role: users.role,
          emailVerifiedAt: users.emailVerifiedAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (fallbackRow) {
        const record: CachedUserRecord = {
          id: fallbackRow.id,
          email: fallbackRow.email,
          role: (fallbackRow.role as 'user' | 'admin') || 'user',
          status: 'active',
          emailVerified: Boolean(fallbackRow.emailVerifiedAt),
          expiresAt: now + 5000,
        };
        userStatusCache.set(userId, record);
        return record;
      }
    } catch {
      // Ignorar fallback si la base no responde
    }

    // Si la base no responde (o en entorno de test sin postgres vivo), se devuelve el último caché si existe
    if (cached) return cached;
    return null;
  }
}

/**
 * Rutas permitidas para usuarios cuya sesión está activa pero todavía no verificaron su email.
 * Toda otra ruta protegida responderá 403 con código EMAIL_NOT_VERIFIED.
 */
export function isUnverifiedAllowedRoute(path: string, method: string): boolean {
  const cleanPath = path.split('?')[0].replace(/\/+$/, '') || '/';

  if (cleanPath === '/api/health') return true;
  if (cleanPath === '/api/me' && method.toUpperCase() === 'GET') return true;
  if (cleanPath.startsWith('/api/auth')) return true;

  return false;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Buscar token en cookies HttpOnly o header Authorization
  const token = req.cookies?.accessToken || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({
      success: false,
      error: 'Sesión no iniciada o token no provisto',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AuthUserPayload;

    // Verificar users.status en la base de datos en toda petición autenticada (Ajuste 2)
    const liveUser = await getUserLiveStatus(decoded.id);

    if (liveUser && liveUser.status === 'suspended') {
      res.status(403).json({
        success: false,
        code: 'ACCOUNT_SUSPENDED',
        error: 'Tu cuenta ha sido suspendida. Si creés que se trata de un error, contactá a soporte.',
      });
      return;
    }

    req.user = {
      ...decoded,
      role: liveUser ? liveUser.role : decoded.role,
      emailVerified: liveUser ? liveUser.emailVerified : decoded.emailVerified === true,
    };

    // Actualizar users.last_seen_at debounced como máximo una vez por hora por usuario (Ajuste 2)
    const now = Date.now();
    const lastSeen = lastSeenDebounce.get(decoded.id) || 0;
    if (now - lastSeen > 60 * 60 * 1000) {
      lastSeenDebounce.set(decoded.id, now);
      db.update(users)
        .set({ lastSeenAt: new Date() })
        .where(eq(users.id, decoded.id))
        .catch(() => {});
    }

    // Si la ruta requiere sesión y el usuario NO tiene el email verificado,
    // comprobar si es una de las excepciones explícitas permitidas
    const fullPath = (req.originalUrl || req.baseUrl + req.path || req.path || '').split('?')[0];
    if (!isUnverifiedAllowedRoute(fullPath, req.method)) {
      if (req.user.emailVerified !== true) {
        res.status(403).json({
          success: false,
          code: 'EMAIL_NOT_VERIFIED',
          error: 'Tenés que verificar tu correo electrónico para acceder a esta función.',
        });
        return;
      }
    }

    next();
  } catch (err) {
    res.status(401).json({
      success: false,
      error: 'Sesión expirada o inválida',
      code: 'TOKEN_EXPIRED',
    });
  }
}

export function requireVerifiedEmail(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.emailVerified !== true) {
      res.status(403).json({
        success: false,
        code: 'EMAIL_NOT_VERIFIED',
        error: 'Tenés que verificar tu correo electrónico para acceder a esta función.',
      });
      return;
    }
    next();
  });
}

/**
 * Middleware que comprueba rol 'admin' y status 'active' en cada petición en la base de datos (Ajuste 1 y 4).
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, async () => {
    if (!req.user) return;

    const liveUser = await getUserLiveStatus(req.user.id);
    if (!liveUser || liveUser.role !== 'admin' || liveUser.status !== 'active') {
      res.status(403).json({
        success: false,
        code: 'FORBIDDEN_NOT_ADMIN',
        error: 'Acceso denegado: se requieren privilegios de administrador activos',
      });
      return;
    }
    next();
  });
}

/**
 * Middleware para acciones destructivas o sensibles en el panel de administración.
 * Exige una reautenticación reciente (contraseña o Google) con validez máxima de 10 minutos (Ajuste 1).
 */
export function requireRecentReauth(req: Request, res: Response, next: NextFunction): void {
  const reauthToken =
    req.cookies?.admin_reauth_token ||
    (req.headers['x-admin-reauth-token'] as string | undefined);

  if (!reauthToken) {
    res.status(403).json({
      success: false,
      code: 'REAUTH_REQUIRED',
      error: 'Esta acción requiere reautenticación reciente (contraseña o Google).',
    });
    return;
  }

  try {
    const decoded = jwt.verify(reauthToken, env.JWT_SECRET) as {
      purpose: string;
      userId: string;
      adminEmail: string;
      iat: number;
    };

    if (
      decoded.purpose !== 'admin-reauth' ||
      !req.user ||
      decoded.userId !== req.user.id ||
      Date.now() / 1000 - decoded.iat > 600 // 10 minutos
    ) {
      res.status(403).json({
        success: false,
        code: 'REAUTH_REQUIRED',
        error: 'El ticket de reautenticación es inválido o ha expirado. Por favor volvé a autenticarte.',
      });
      return;
    }

    next();
  } catch (_err) {
    res.status(403).json({
      success: false,
      code: 'REAUTH_REQUIRED',
      error: 'El ticket de reautenticación ha expirado o es inválido.',
    });
  }
}

/**
 * Rate Limiting específico para rutas /api/admin/* (Ajuste 1).
 */
export function createAdminRateLimiter() {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.user?.id || req.ip || 'anon-admin';
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxRequests = ['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase()) ? 150 : 40;

    const record = buckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }
    record.count += 1;
    buckets.set(key, record);

    if (record.count > maxRequests) {
      const waitSec = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      res.status(429).json({
        success: false,
        code: 'ADMIN_RATE_LIMITED',
        error: `Demasiadas solicitudes al panel de administración. Por favor esperá ${waitSec} segundos.`,
      });
      return;
    }

    next();
  };
}

export const adminRateLimiter = createAdminRateLimiter();
