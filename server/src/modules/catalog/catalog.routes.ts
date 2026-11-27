import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { getCareers, getPlan, getSchedule, getCatalogVersionHandler } from './catalog.controller.js';

const router = Router();

// Rutas públicas de catálogo (con ETag y caché)
router.get('/version', getCatalogVersionHandler);
router.get('/careers', getCareers);
router.get('/plans/:planId', getPlan);
router.get('/schedule', requireAuth, getSchedule);

export default router;

