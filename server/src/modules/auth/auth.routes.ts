import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import {
  registerSchema,
  loginSchema,
  googleLoginSchema,
  verifyEmailSchema,
} from './auth.schemas.js';
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

// Rate limiter para login y Google (máximo 10 intentos por cada 15 min)
const loginLimiter = authRateLimiter({
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
});

// Rate limiter para verificación de código (máximo 10 intentos por cada 15 min)
const verifyLimiter = authRateLimiter({
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
});

// Rate limiter para reenvío de código (máximo 5 intentos por cada 15 min)
const resendLimiter = authRateLimiter({
  maxAttempts: 5,
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
  '/google',
  loginLimiter,
  csrfProtection,
  validate({ body: googleLoginSchema }),
  AuthController.google
);

authRouter.post(
  '/login',
  loginLimiter,
  csrfProtection,
  validate({ body: loginSchema }),
  AuthController.login
);

authRouter.post(
  '/verify-email',
  verifyLimiter,
  requireAuth,
  csrfProtection,
  validate({ body: verifyEmailSchema }),
  AuthController.verifyEmail
);

authRouter.post(
  '/resend-code',
  resendLimiter,
  requireAuth,
  csrfProtection,
  AuthController.resendCode
);

authRouter.post(
  '/cancel-registration',
  requireAuth,
  csrfProtection,
  AuthController.cancelRegistration
);

authRouter.post('/refresh', csrfProtection, AuthController.refresh);

authRouter.post('/logout', csrfProtection, AuthController.logout);

authRouter.get('/me', requireAuth, AuthController.me);


