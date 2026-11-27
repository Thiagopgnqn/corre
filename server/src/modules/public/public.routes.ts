import { Router, Request, Response, NextFunction } from 'express';
import { ReviewsService } from '../reviews/reviews.service.js';
import { createPublicController } from './public.controller.js';
import { publicRateLimiter } from './public.rateLimiter.js';

export function createPublicRouter(reviewsService: ReviewsService): Router {
  const router = Router();
  const controller = createPublicController(reviewsService);

  // Endpoints públicos estrictamente de solo lectura (GET), sin sesión ni cookies ni CSRF
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({
        success: false,
        error: 'Método no permitido en endpoints públicos',
      });
      return;
    }
    next();
  });

  router.use(publicRateLimiter);

  router.get('/catalog/version', controller.getCatalogVersion);
  router.get('/catalog/careers', controller.getCareers);
  router.get('/catalog/plans/:planId', controller.getPlan);

  router.get('/professors', controller.listProfessors);
  router.get('/professors/:id', controller.getProfessorDetail);
  router.get('/professors/:id/reviews', controller.getProfessorReviews);

  router.get('/library/subjects', controller.listLibrarySubjects);
  router.get('/library/files', controller.listLibraryFiles);

  return router;
}
