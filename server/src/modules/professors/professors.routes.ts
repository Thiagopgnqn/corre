import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { ReviewsService } from '../reviews/reviews.service.js';

export function createProfessorsRouter(service: ReviewsService): Router {
  const router = Router();

  // Todas las rutas requieren sesión autenticada
  router.use(requireAuth);

  // IMPORTANTE: declarar /ratings antes de /:id para evitar colisión de ruta dinámica
  router.get('/ratings', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawIds = typeof req.query.ids === 'string' ? req.query.ids : '';
      const rawNames = typeof req.query.names === 'string' ? req.query.names : '';

      const ids = rawIds
        ? rawIds
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const names = rawNames
        ? rawNames
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      const data = await service.getRatingsBatch({
        userId: req.user!.id,
        planId: typeof req.query.planId === 'string' ? req.query.planId : req.user?.selectedPlanId,
        ids,
        names,
      });

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const subjectId = typeof req.query.subjectId === 'string' ? req.query.subjectId : undefined;
      const minRating =
        typeof req.query.minRating === 'string' && req.query.minRating !== ''
          ? Number(req.query.minRating)
          : undefined;
      const withReviewsOnly =
        req.query.withReviews === 'true' || req.query.withReviewsOnly === 'true';
      const rawSort = typeof req.query.sort === 'string' ? req.query.sort : 'rating';
      const sort: 'rating' | 'reviews' | 'name' =
        rawSort === 'reviews' || rawSort === 'name' ? rawSort : 'rating';

      const data = await service.listProfessors({
        userId: req.user!.id,
        planId: typeof req.query.planId === 'string' ? req.query.planId : req.user?.selectedPlanId,
        search,
        subjectId,
        minRating,
        withReviewsOnly,
        sort,
      });

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.getProfessorDetail({
        userId: req.user!.id,
        planId: typeof req.query.planId === 'string' ? req.query.planId : req.user?.selectedPlanId,
        professorId: String(req.params.id),
      });

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/reviews', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const subjectId = typeof req.query.subjectId === 'string' ? req.query.subjectId : undefined;
      const page = typeof req.query.page === 'string' ? parseInt(req.query.page, 10) || 1 : 1;
      const pageSize =
        typeof req.query.pageSize === 'string' ? parseInt(req.query.pageSize, 10) || 10 : 10;
      const sort = req.query.sort === 'helpful' ? 'helpful' : 'recent';

      const data = await service.getProfessorReviews({
        userId: req.user!.id,
        planId: typeof req.query.planId === 'string' ? req.query.planId : req.user?.selectedPlanId,
        professorId: String(req.params.id),
        subjectId,
        page,
        pageSize,
        sort,
      });

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
