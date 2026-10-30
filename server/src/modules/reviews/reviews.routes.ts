import { Router, Request, Response, NextFunction } from 'express';
import { requireAdmin, requireAuth } from '../../middlewares/auth.middleware.js';
import { csrfProtection } from '../../middlewares/csrf.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  createHistoricalProfessorBodySchema,
  createReviewBodySchema,
  linkProfessorSubjectBodySchema,
  mergeProfessorsBodySchema,
  moderateReportBodySchema,
  moderateReviewStatusBodySchema,
  renameProfessorBodySchema,
  reportReviewBodySchema,
  updateReviewBodySchema,
} from './reviews.schemas.js';
import { ReviewsService } from './reviews.service.js';

function createUserWriteRateLimiter(options: { maxRequests: number; windowMs: number }) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.user?.id || req.ip || 'anon';
    const now = Date.now();
    const record = buckets.get(key) || { count: 0, resetAt: now + options.windowMs };

    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + options.windowMs;
    }
    record.count += 1;
    buckets.set(key, record);

    if (record.count > options.maxRequests) {
      const waitSec = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      res.status(429).json({
        success: false,
        error: `Demasiadas operaciones seguidas. Por favor esperá ${waitSec} segundos.`,
      });
      return;
    }

    next();
  };
}

export function createReviewsRouter(service: ReviewsService): Router {
  const router = Router();
  const writeLimiter = createUserWriteRateLimiter({ maxRequests: 35, windowMs: 60 * 1000 });

  router.use(requireAuth);

  router.post(
    '/',
    csrfProtection,
    writeLimiter,
    validate({ body: createReviewBodySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await service.createReview({
          userId: req.user!.id,
          planId: req.user?.selectedPlanId,
          ...req.body,
        });
        res.status(201).json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  router.put(
    '/:id',
    csrfProtection,
    writeLimiter,
    validate({ body: updateReviewBodySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await service.updateReview({
          userId: req.user!.id,
          reviewId: String(req.params.id),
          ...req.body,
        });
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  router.delete(
    '/:id',
    csrfProtection,
    writeLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await service.deleteReview({
          userId: req.user!.id,
          reviewId: String(req.params.id),
        });
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    '/:id/helpful',
    csrfProtection,
    writeLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await service.toggleHelpful({
          userId: req.user!.id,
          reviewId: String(req.params.id),
        });
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    '/:id/report',
    csrfProtection,
    writeLimiter,
    validate({ body: reportReviewBodySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await service.reportReview({
          reporterUserId: req.user!.id,
          reviewId: String(req.params.id),
          reason: req.body.reason,
          note: req.body.note,
        });
        res.status(201).json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}

export function createAdminReviewsRouter(service: ReviewsService): Router {
  const router = Router();
  router.use(requireAdmin);

  // Listado de profesores + candidatos a duplicados
  router.get('/professors', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.adminListProfessors({
        adminUserId: req.user!.id,
        planId: req.user?.selectedPlanId,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  // Crear o resolver un profesor histórico (y opcionalmente vincularlo a una materia)
  router.post(
    '/professors',
    csrfProtection,
    validate({ body: createHistoricalProfessorBodySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await service.adminCreateHistoricalProfessor({
          adminUserId: req.user!.id,
          displayName: req.body.displayName,
          facultyId: req.body.facultyId,
          subjectId: req.body.subjectId,
          note: req.body.note,
        });
        res.status(201).json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Fusionar dos profesores (mueve comisiones, ofertas electivas, vínculos, reseñas y guarda alias)
  router.post(
    '/professors/merge',
    csrfProtection,
    validate({ body: mergeProfessorsBodySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await service.adminMergeProfessors({
          sourceProfessorId: req.body.sourceProfessorId,
          targetProfessorId: req.body.targetProfessorId,
        });
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Renombrar display_name de un profesor
  router.patch(
    '/professors/:id',
    csrfProtection,
    validate({ body: renameProfessorBodySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await service.adminRenameProfessor({
          professorId: String(req.params.id),
          displayName: req.body.displayName,
        });
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Vincular manualmente un profesor "histórico" a una materia para habilitar elegibilidad de reseñas
  router.post(
    '/professors/:id/subjects',
    csrfProtection,
    validate({ body: linkProfessorSubjectBodySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await service.adminLinkProfessorToSubject({
          adminUserId: req.user!.id,
          professorId: String(req.params.id),
          subjectId: req.body.subjectId,
          note: req.body.note,
        });
        res.status(201).json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Cola de moderación: reportes abiertos + reseñas ocultas
  router.get('/reviews/reports', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.adminGetModerationQueue();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  // Ocultar, restaurar o eliminar reseña
  router.patch(
    '/reviews/:id/status',
    csrfProtection,
    validate({ body: moderateReviewStatusBodySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await service.adminSetReviewStatus({
          reviewId: String(req.params.id),
          status: req.body.status,
        });
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Descartar o marcar como accionado un reporte específico
  router.patch(
    '/reviews/reports/:reportId',
    csrfProtection,
    validate({ body: moderateReportBodySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await service.adminResolveReport({
          reportId: String(req.params.reportId),
          status: req.body.status,
          reviewStatus: req.body.reviewStatus,
        });
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Estadísticas generales de reseñas y moderación
  router.get('/reviews/stats', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.adminGetStats({
        adminUserId: req.user!.id,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
