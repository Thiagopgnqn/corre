import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { registerSchema, loginSchema } from './auth.schemas.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authRateLimiter } from '../../middlewares/rateLimiter.middleware.js';
import { csrfProtection } from '../../middlewares/csrf.middleware.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';

export const authRouter = Router();

// Rate limiter para registro (máximo 5 intentos por cada 15 min)
const registerLimiter = authRateLimiter({
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
});

// Rate limiter para login (máximo 10 intentos por cada 15 min)
const loginLimiter = authRateLimiter({
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
});

authRouter.post(
  '/register',
  registerLimiter,
  csrfProtection,
  validate({ body: registerSchema }),
  AuthController.register
);

authRouter.post(
  '/login',
  loginLimiter,
  csrfProtection,
  validate({ body: loginSchema }),
  AuthController.login
);

authRouter.post('/refresh', csrfProtection, AuthController.refresh);

authRouter.post('/logout', csrfProtection, AuthController.logout);

authRouter.get('/me', requireAuth, AuthController.me);

