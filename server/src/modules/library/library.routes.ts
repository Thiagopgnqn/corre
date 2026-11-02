import { Router } from 'express';
import { requireAuth, requireVerifiedEmail } from '../../middlewares/auth.middleware.js';
import { csrfProtection } from '../../middlewares/csrf.middleware.js';
import {
  getTermsStatus,
  acceptTerms,
  listSubjects,
  listFiles,
  getFileDetail,
  initUpload,
  completeUpload,
  downloadFile,
  toggleHelpful,
  reportFile,
  listMyUploads,
  updateMyFile,
  deleteMyFile,
} from './library.controller.js';

const router = Router();

// Todas las rutas de la biblioteca exigen usuario autenticado con email verificado
router.use(requireAuth);
router.use(requireVerifiedEmail);

// 1. Términos y condiciones
router.get('/terms-status', getTermsStatus);
router.post('/accept-terms', csrfProtection, acceptTerms);

// 2. Navegación y consulta de catálogo público
router.get('/subjects', listSubjects);
router.get('/subjects-summary', listSubjects);
router.get('/subjects/:subjectId/files', listFiles);
router.get('/files', listFiles);
router.get('/files/:id', getFileDetail);

// 3. Subidas directas a Cloudflare R2
router.post('/uploads/init', csrfProtection, initUpload);
router.post('/uploads/:id/complete', csrfProtection, completeUpload);
router.post('/uploads/complete', csrfProtection, completeUpload);

// 4. Descargas protegidas
router.get('/files/:id/download', downloadFile);

// 5. Interacción social y reportes
router.post('/files/:id/helpful', csrfProtection, toggleHelpful);
router.post('/files/:id/report', csrfProtection, reportFile);

// 6. Gestión de aportes propios
router.get('/my-uploads', listMyUploads);
router.patch('/my-uploads/:id', csrfProtection, updateMyFile);
router.delete('/my-uploads/:id', csrfProtection, deleteMyFile);

export default router;

