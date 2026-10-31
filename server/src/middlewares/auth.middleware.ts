import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

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

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
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
    req.user = {
      ...decoded,
      emailVerified: decoded.emailVerified === true,
    };

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

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: 'Acceso denegado: se requieren privilegios de administrador',
      });
      return;
    }
    next();
  });
}

