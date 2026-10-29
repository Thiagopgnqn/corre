import { Router } from 'express';
import { requireAdmin } from '../../middlewares/auth.middleware.js';
import { csrfProtection } from '../../middlewares/csrf.middleware.js';
import {
  getAdminPlans,
  createCareer,
  createPlan,
  createSchedule,
} from './admin.controller.js';

const router = Router();

// Todas las rutas de administración requieren rol 'admin'
router.use(requireAdmin);

router.get('/plans', getAdminPlans);
router.post('/careers', csrfProtection, createCareer);
router.post('/plans', csrfProtection, createPlan);
router.post('/schedules', csrfProtection, createSchedule);

export default router;

