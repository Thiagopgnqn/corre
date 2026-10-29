import { Router } from 'express';
import { getCareers, getPlan, getSchedule } from './catalog.controller.js';

const router = Router();

// Rutas públicas de catálogo (con ETag y caché)
router.get('/careers', getCareers);
router.get('/plans/:planId', getPlan);
router.get('/schedule', getSchedule);

export default router;

