import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import path from 'path';
import { env } from './config/env.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthService } from './modules/auth/auth.service.js';
import catalogRouter from './modules/catalog/catalog.routes.js';
import { updateSelectedPlan } from './modules/catalog/catalog.controller.js';
import adminRouter from './modules/admin/admin.routes.js';
import userStateRouter from './modules/user-state/userState.routes.js';
import { createProfessorsRouter } from './modules/professors/professors.routes.js';
import {
  createAdminReviewsRouter,
  createReviewsRouter,
} from './modules/reviews/reviews.routes.js';
import { ReviewsService } from './modules/reviews/reviews.service.js';
import { defaultReviewsStore, ReviewsStore } from './modules/reviews/reviews.store.js';
import { createEnrollmentsRouter } from './modules/enrollments/enrollments.routes.js';
import {
  dismissRecommendationBodySchema,
  markRecommendationsSeenBodySchema,
} from './modules/enrollments/enrollments.schemas.js';
import { EnrollmentsService } from './modules/enrollments/enrollments.service.js';
import { requireAuth } from './middlewares/auth.middleware.js';
import { csrfProtection } from './middlewares/csrf.middleware.js';
import { validate } from './middlewares/validate.middleware.js';
import { errorHandler } from './middlewares/error.middleware.js';

export function createApp(options?: { reviewsStore?: ReviewsStore }) {
  const instance = express();
  const reviewsStore = options?.reviewsStore || defaultReviewsStore;
  const reviewsService = new ReviewsService(reviewsStore);
  const enrollmentsService = new EnrollmentsService(reviewsStore);

  // Confianza total en proxies inversos encadenados (Vercel -> Render)
  // Permite que req.ip y req.protocol reflejen la IP y protocolo del cliente real
  instance.set('trust proxy', true);

  // 1. Cabeceras de seguridad
  instance.use(
    helmet({
      contentSecurityPolicy:
        env.NODE_ENV === 'production'
          ? {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
                frameSrc: ["'self'", 'https://accounts.google.com/'],
                connectSrc: ["'self'", 'https://accounts.google.com/'],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
              },
            }
          : false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    })
  );

  // 2. CORS (útil para dev local o llamadas directas con credenciales)
  instance.use(
    cors({
      origin: (origin, callback) => {
        // Permitir peticiones sin origin (ej. server-to-server, curl, Vercel rewrite interno)
        if (!origin) return callback(null, true);

        try {
          const originUrl = new URL(origin).origin;
          const clientUrl = new URL(env.CLIENT_ORIGIN).origin;
          if (originUrl === clientUrl || env.NODE_ENV === 'development' || env.NODE_ENV === 'test') {
            return callback(null, true);
          }
        } catch {
          // Ignorar
        }
        callback(new Error(`CORS no permitido para el origen: ${origin}`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-App-Client'],
    })
  );

  // 3. Parsers de body y cookies
  instance.use(express.json({ limit: '10mb' }));
  instance.use(express.urlencoded({ extended: true }));
  instance.use(cookieParser());

  // 4. Endpoint de salud para Render (y frontend ping)
  instance.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  // 5. Rutas directas /api/me (compatibilidad canónica + elegibilidad de reseñas)
  instance.get('/api/me', requireAuth, AuthController.me);
  instance.put('/api/me/plan', requireAuth, csrfProtection, updateSelectedPlan);
  instance.get('/api/me/reviewable', requireAuth, async (req, res, next) => {
    try {
      const data = await reviewsService.getReviewableForUser({
        userId: req.user!.id,
        planId: typeof req.query.planId === 'string' ? req.query.planId : req.user?.selectedPlanId,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });
  instance.post(
    '/api/me/reviewable/dismiss',
    requireAuth,
    csrfProtection,
    validate({ body: dismissRecommendationBodySchema }),
    async (req, res, next) => {
      try {
        const data = await reviewsService.dismissRecommendation({
          userId: req.user!.id,
          planId: req.user?.selectedPlanId,
          professorId: req.body.professorId,
          subjectId: req.body.subjectId,
        });
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );
  instance.post(
    '/api/me/reviewable/seen',
    requireAuth,
    csrfProtection,
    validate({ body: markRecommendationsSeenBodySchema }),
    async (req, res, next) => {
      try {
        const data = await reviewsService.markRecommendationsSeen({
          userId: req.user!.id,
          planId: req.user?.selectedPlanId,
          keys: req.body.keys,
        });
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // 6. Módulos de la API
  instance.use('/api/auth', authRouter);
  instance.use('/api/catalog', catalogRouter);
  instance.use('/api/professors', createProfessorsRouter(reviewsService));
  instance.use('/api/reviews', createReviewsRouter(reviewsService));
  instance.use('/api/enrollments', createEnrollmentsRouter(enrollmentsService));
  instance.use('/api/admin', adminRouter);
  instance.use('/api/admin', createAdminReviewsRouter(reviewsService));
  instance.use('/api', userStateRouter);

  // 7. Manejador de 404 para rutas no existentes
  instance.use('/api/*', (req, res) => {
    res.status(404).json({
      success: false,
      error: `Ruta no encontrada: ${req.method} ${req.baseUrl}`,
    });
  });

  // 8. Manejador centralizado de errores
  instance.use(errorHandler);

  return instance;
}

export const app = createApp();

// Iniciar servidor solo si app.ts / app.js es el entrypoint principal y no estamos en tests
const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (process.env.NODE_ENV !== 'test' && currentFile === entryFile) {
  // Limpieza periódica liviana de cuentas no verificadas de más de 7 días (cada 12h)
  AuthService.cleanupUnverifiedAccounts(7).catch(() => {});
  setInterval(() => {
    AuthService.cleanupUnverifiedAccounts(7).catch(() => {});
  }, 12 * 60 * 60 * 1000).unref();

  app.listen(env.PORT, () => {
    console.log(`🚀 Servidor backend escuchando en puerto ${env.PORT} (${env.NODE_ENV})`);
    console.log(`🌐 CLIENT_ORIGIN configurado: ${env.CLIENT_ORIGIN}`);
    console.log(`🩺 Health check: http://localhost:${env.PORT}/api/health`);
  });
}
