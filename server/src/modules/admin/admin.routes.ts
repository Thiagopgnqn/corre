import { Router } from 'express';
import {
  requireAdmin,
  requireRecentReauth,
  adminRateLimiter,
} from '../../middlewares/auth.middleware.js';
import { csrfProtection } from '../../middlewares/csrf.middleware.js';
import {
  reauthPassword,
  reauthGoogle,
  getStats,
  listUsers,
  getUserDetail,
  verifyUserEmail,
  resendVerificationCode,
  setUserStatus,
  revokeUserSessions,
  setUserRole,
  deleteUser,
  exportUsersCsv,
  listTerms,
  createTerm,
  setCurrentTerm,
  duplicateTerm,
  listCommissions,
  createCommission,
  editCommission,
  getCommissionImpact,
  retireCommission,
  deleteCommission,
  previewScheduleImport,
  applyScheduleImport,
  listAdminReviews,
  suspendReviewAuthor,
  listAuditLogs,
  getAdminPlans,
  createCareer,
  createPlan,
  createSchedule,
} from './admin.controller.js';

const router = Router();

// Todas las rutas de administración requieren rol 'admin' verificado en base de datos y rate limiter (Ajuste 1 y 4)
router.use(requireAdmin);
router.use(adminRateLimiter);

// 1. Reautenticación reciente (10 minutos)
router.post('/reauth/password', csrfProtection, reauthPassword);
router.post('/reauth/google', csrfProtection, reauthGoogle);

// 2. Estadísticas agregadas
router.get('/stats', getStats);

// 3. Usuarios
router.get('/users', listUsers);
router.get('/users/export', exportUsersCsv);
router.get('/users/:id', getUserDetail);
router.patch('/users/:id/verify-email', csrfProtection, verifyUserEmail);
router.post('/users/:id/resend-code', csrfProtection, resendVerificationCode);
router.patch('/users/:id/status', csrfProtection, requireRecentReauth, setUserStatus);
router.post('/users/:id/revoke-sessions', csrfProtection, revokeUserSessions);
router.patch('/users/:id/role', csrfProtection, requireRecentReauth, setUserRole);
router.delete('/users/:id', csrfProtection, requireRecentReauth, deleteUser);

// 4. Catálogo y Horarios
router.get('/terms', listTerms);
router.post('/terms', csrfProtection, createTerm);
router.patch('/terms/:id/current', csrfProtection, setCurrentTerm);
router.post('/terms/:id/duplicate', csrfProtection, duplicateTerm);

router.get('/commissions', listCommissions);
router.post('/commissions', csrfProtection, createCommission);
router.get('/commissions/:id/impact', getCommissionImpact);
router.patch('/commissions/:id', csrfProtection, editCommission);
router.patch('/commissions/:id/retire', csrfProtection, retireCommission);
router.delete('/commissions/:id', csrfProtection, requireRecentReauth, deleteCommission);

router.post('/schedules/preview-import', csrfProtection, previewScheduleImport);
router.post('/schedules/apply-import', csrfProtection, requireRecentReauth, applyScheduleImport);

// 5. Moderación de Reseñas: listar todas y suspender autor
router.get('/reviews', listAdminReviews);
router.post('/reviews/:id/suspend-author', csrfProtection, requireRecentReauth, suspendReviewAuthor);

// 6. Auditoría
router.get('/audit-logs', listAuditLogs);

// 7. Rutas base de catálogo preexistentes
router.get('/plans', getAdminPlans);
router.post('/careers', csrfProtection, createCareer);
router.post('/plans', csrfProtection, createPlan);
router.post('/schedules', csrfProtection, createSchedule);

export default router;
