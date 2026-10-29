import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { csrfProtection } from '../../middlewares/csrf.middleware.js';
import {
  getUserState,
  updateProgress,
  updateElectives,
  updateBasket,
  updateSettings,
  getScheduleProposals,
  saveScheduleProposal,
  deleteScheduleProposal,
  saveScheduleSelections,
  importData,
  exportData,
  deleteAccount,
} from './userState.controller.js';

const router = Router();

// Todas las rutas de estado de usuario requieren autenticación
router.use(requireAuth);

// Lectura de estado
router.get('/state', getUserState);
router.get('/schedule/proposals', getScheduleProposals);
router.get('/export', exportData);

// Mutaciones de estado protegidas por CSRF
router.put('/progress/:subjectId', csrfProtection, updateProgress);
router.put('/electives', csrfProtection, updateElectives);
router.put('/basket', csrfProtection, updateBasket);
router.put('/settings', csrfProtection, updateSettings);
router.post('/schedule/proposals', csrfProtection, saveScheduleProposal);
router.delete('/schedule/proposals/:id', csrfProtection, deleteScheduleProposal);
router.put('/schedule/selections', csrfProtection, saveScheduleSelections);
router.post('/import', csrfProtection, importData);
router.delete('/me', csrfProtection, deleteAccount);

export default router;

