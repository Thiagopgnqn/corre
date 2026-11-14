import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { csrfProtection } from '../../middlewares/csrf.middleware.js';
import { ReviewsStore } from '../reviews/reviews.store.js';
import { createUserStateHandlers } from './userState.controller.js';
import { UserStateStore } from './userState.store.js';

export function createUserStateRouter(
  store?: UserStateStore,
  reviewsStore?: ReviewsStore
): Router {
  const router = Router();
  const handlers = createUserStateHandlers(store, reviewsStore);

  // Todas las rutas de estado de usuario requieren autenticación
  router.use(requireAuth);

  // Lectura de estado
  router.get('/state', handlers.getUserState);
  router.get('/schedule/proposals', handlers.getScheduleProposals);
  router.get('/export', handlers.exportData);

  // Mutaciones de estado protegidas por CSRF
  router.put('/progress/:subjectId', csrfProtection, handlers.updateProgress);
  router.put('/electives', csrfProtection, handlers.updateElectives);
  router.put('/basket', csrfProtection, handlers.updateBasket);
  router.put('/settings', csrfProtection, handlers.updateSettings);
  router.post('/schedule/proposals', csrfProtection, handlers.saveScheduleProposal);
  router.delete('/schedule/proposals/:id', csrfProtection, handlers.deleteScheduleProposal);
  router.put('/schedule/selections', csrfProtection, handlers.saveScheduleSelections);
  router.post('/import', csrfProtection, handlers.importData);
  router.delete('/me', csrfProtection, handlers.deleteAccount);
  router.post('/exam-attempts', csrfProtection, handlers.saveExamAttempt);
  router.delete('/exam-attempts/:id', csrfProtection, handlers.deleteExamAttempt);

  return router;
}

const router = createUserStateRouter();

export default router;
