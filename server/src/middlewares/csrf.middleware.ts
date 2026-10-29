import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

/**
 * Middleware de protección CSRF para peticiones mutantes (POST, PUT, PATCH, DELETE).
 * 1. Exige el encabezado personalizado 'x-requested-with' o 'x-app-client'.
 * 2. Verifica que 'Origin' o 'Referer' coincida con CLIENT_ORIGIN (excepto en dev local si no viene origin).
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // 1. Verificar header personalizado anti-CSRF
  const requestedWith = req.headers['x-requested-with'] || req.headers['x-app-client'];
  if (!requestedWith) {
    res.status(403).json({
      success: false,
      error: 'Acceso no autorizado: falta encabezado de seguridad X-Requested-With',
    });
    return;
  }

  // 2. Verificar Origin o Referer contra CLIENT_ORIGIN
  const origin = req.headers['origin'] || req.headers['referer'];
  if (origin && env.CLIENT_ORIGIN) {
    try {
      const originUrl = new URL(origin as string).origin;
      const clientUrl = new URL(env.CLIENT_ORIGIN).origin;

      if (originUrl !== clientUrl && env.NODE_ENV === 'production') {
        res.status(403).json({
          success: false,
          error: 'Acceso no autorizado: origen no permitido',
        });
        return;
      }
    } catch {
      res.status(403).json({
        success: false,
        error: 'Acceso no autorizado: origen inválido',
      });
      return;
    }
  }

  next();
}

