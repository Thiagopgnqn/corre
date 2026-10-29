import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

export function errorHandler(
  err: Error & { status?: number; code?: string },
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Loggear internamente sin datos confidenciales
  console.error(`[ERROR] ${req.method} ${req.url}:`, err.message);

  const status = err.status || 500;
  const message =
    env.NODE_ENV === 'production' && status === 500
      ? 'Ocurrió un error interno en el servidor'
      : err.message || 'Error inesperado';

  res.status(status).json({
    success: false,
    error: message,
    code: err.code || 'INTERNAL_ERROR',
  });
}

