import { NextFunction, Request, Response, Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { csrfProtection } from '../../middlewares/csrf.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { upsertEnrollmentBodySchema } from './enrollments.schemas.js';
import { EnrollmentsService } from './enrollments.service.js';

export function createEnrollmentsRouter(service: EnrollmentsService): Router {
  const router = Router();
  router.use(requireAuth);

  // Listar cursadas del usuario autenticado
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.listEnrollments({
        userId: req.user!.id,
        planId: typeof req.query.planId === 'string' ? req.query.planId : req.user?.selectedPlanId,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  // Opciones de comisiones (todos los períodos) y docentes vinculados para una materia
  router.get('/options/:subjectId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.getSubjectOptions({
        userId: req.user!.id,
        planId: typeof req.query.planId === 'string' ? req.query.planId : req.user?.selectedPlanId,
        subjectIdOrCode: String(req.params.subjectId),
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  // Crear o actualizar una cursada de una materia
  router.put(
    '/:subjectId',
    csrfProtection,
    validate({ body: upsertEnrollmentBodySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await service.upsertEnrollment({
          userId: req.user!.id,
          planId: req.user?.selectedPlanId,
          subjectIdOrCode: String(req.params.subjectId),
          ...req.body,
        });
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Eliminar una cursada propia
  router.delete(
    '/:id',
    csrfProtection,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await service.deleteEnrollment({
          userId: req.user!.id,
          enrollmentId: String(req.params.id),
        });
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}

