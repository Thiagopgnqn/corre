// Configurar entorno aislado en memoria ANTES de evaluar módulos del servidor (CERO Neon / CERO R2)
import './setupTestEnv.js';

import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import type { Express, Request } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const { env } = await import('../src/config/env.js');
  const { createApp } = await import('../src/app.js');
  const { InMemoryCatalogStore, setCatalogStoreForTesting } = await import(
    '../src/modules/catalog/catalog.store.js'
  );
  const { InMemoryReviewsStore, DrizzleReviewsStore, buildPublishedReviewsCountQuery } = await import(
    '../src/modules/reviews/reviews.store.js'
  );
  const { InMemoryUserStateStore } = await import('../src/modules/user-state/userState.store.js');
  const { InMemoryLibraryService, setLibraryServiceForTesting } = await import(
    '../src/modules/library/library.service.js'
  );
  const { MemoryMockR2Service } = await import('../src/services/r2.service.js');
  const { setLiveUserResolverForTesting } = await import('../src/middlewares/auth.middleware.js');
  const {
    BoundedCounterMap,
    configurePublicRateLimiterForTesting,
    getLastHopIp,
    getPublicClientIp,
    resetPublicRateLimiterForTesting,
    resolvePublicRateLimiterEnvConfig,
  } = await import('../src/modules/public/public.rateLimiter.js');

  console.log('======================================================================');
  console.log(' 🧪 TESTS TRAMO 1: ACCESO PÚBLICO DE SOLO LECTURA (/api/public/*)');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.error(`  ❌ ${name}${detail ? ` -> ${detail}` : ''}`);
      failed++;
    }
  }

  // Cargar JSON base real de ISI Plan 2023 desde seeds para probar árbol completo sin DB
  const catalogJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../seed-data/plan2023-catalog.json'), 'utf-8')
  );

  const catalogStore = new InMemoryCatalogStore();
  setCatalogStoreForTesting(catalogStore);

  const reviewsStore = new InMemoryReviewsStore();
  const userStateStore = new InMemoryUserStateStore();
  const mockR2 = new MemoryMockR2Service();
  const libraryService = new InMemoryLibraryService(mockR2);
  setLibraryServiceForTesting(libraryService);

  // Sembrar Facultad principal (FRC) + plan publicado ISI Plan 2023
  const isiPublished = catalogStore.seedPlanFromCatalogJson(catalogJson, {
    careerStatus: 'published',
    planStatus: 'published',
    isActive: true,
  });

  // Segundo plan publicado en la misma facultad (Mecánica) para pruebas de selector público y ?planId=
  const mecPublished = catalogStore.seedPlanFromCatalogJson(
    {
      ...catalogJson,
      career: { name: 'Ingeniería Mecánica', code: 'MEC' },
      studyPlan: {
        name: 'Plan 2024',
        year: 2024,
        isActive: true,
        config: { totalLevels: 5, levelLabel: 'Año' },
      },
      subjects: [
        {
          codeInPlan: 701,
          displayCode: 'MEC-701',
          name: 'Estática y Resistencia de Materiales',
          shortName: 'Estática',
          level: 2,
          modality: 'A',
          contraCuatrimestral: false,
          weeklyHours: 6,
          kind: 'obligatoria',
          credits: 0,
        },
      ],
      specialRules: [],
      acronyms: [{ acronym: 'ERM', subjectCode: 701 }],
    },
    { careerStatus: 'published', planStatus: 'published', isActive: true }
  );

  // Planes NO elegibles públicamente (todos deben dar 404 en /api/public/*)
  const indDraft = catalogStore.seedPlanFromCatalogJson(
    {
      ...catalogJson,
      career: { name: 'Ingeniería Industrial', code: 'IND' },
      studyPlan: {
        name: 'Plan Borrador 2026',
        year: 2026,
        isActive: true,
        config: { totalLevels: 5, levelLabel: 'Año' },
      },
      subjects: [
        {
          codeInPlan: 801,
          displayCode: '801',
          name: 'Economía Industrial',
          shortName: 'Economía Ind.',
          level: 3,
          modality: '1C',
          contraCuatrimestral: false,
          weeklyHours: 4,
          kind: 'obligatoria',
        },
      ],
      specialRules: [],
      acronyms: [],
    },
    { careerStatus: 'published', planStatus: 'draft', isActive: true }
  );

  const archivedPlan = catalogStore.seedPlanFromCatalogJson(
    {
      ...catalogJson,
      career: { name: 'Ingeniería Eléctrica', code: 'IE' },
      studyPlan: {
        name: 'Plan Histórico',
        year: 2005,
        isActive: true,
        config: { totalLevels: 5, levelLabel: 'Año' },
      },
      subjects: [],
      specialRules: [],
      acronyms: [],
    },
    { careerStatus: 'published', planStatus: 'archived', isActive: true }
  );

  const inactivePlan = catalogStore.seedPlanFromCatalogJson(
    {
      ...catalogJson,
      career: { name: 'Ingeniería Química', code: 'IQ' },
      studyPlan: {
        name: 'Plan Inactivo',
        year: 2024,
        isActive: false,
        config: { totalLevels: 5, levelLabel: 'Año' },
      },
      subjects: [],
      specialRules: [],
      acronyms: [],
    },
    { careerStatus: 'published', planStatus: 'published', isActive: false }
  );

  const draftCareerPlan = catalogStore.seedPlanFromCatalogJson(
    {
      ...catalogJson,
      career: { name: 'Carrera En Construcción', code: 'BORR' },
      studyPlan: {
        name: 'Plan Publicado en Carrera Draft',
        year: 2026,
        isActive: true,
        config: { totalLevels: 5, levelLabel: 'Año' },
      },
      subjects: [],
      specialRules: [],
      acronyms: [],
    },
    { careerStatus: 'draft', planStatus: 'published', isActive: true }
  );

  // Espejar materias de ISI y MEC en ReviewsStore y LibraryService
  const isiArtifacts = await catalogStore.getPlanArtifacts(isiPublished.planId);
  const mecArtifacts = await catalogStore.getPlanArtifacts(mecPublished.planId);

  reviewsStore.seedPlan(isiPublished.planId, isiPublished.facultyId, {
    careerCode: 'ISI',
    year: 2023,
    status: 'published',
    isActive: true,
    careerStatus: 'published',
  });
  reviewsStore.seedPlan(mecPublished.planId, mecPublished.facultyId, {
    careerCode: 'MEC',
    year: 2024,
    status: 'published',
    isActive: true,
    careerStatus: 'published',
  });

  const isiSubject1 = isiArtifacts.subjects.find((s) => s.codeInPlan === 1)!;
  const isiSubject2 = isiArtifacts.subjects.find((s) => s.codeInPlan === 2)!;
  const mecSubject1 = mecArtifacts.subjects[0]!;

  for (const s of isiArtifacts.subjects) {
    reviewsStore.seedSubject({
      id: s.id,
      planId: isiPublished.planId,
      codeInPlan: s.codeInPlan,
      name: s.name,
      shortName: s.shortName,
      level: s.level,
      kind: s.kind,
    });
    libraryService.subjects.set(s.id, {
      id: s.id,
      name: s.name,
      codeInPlan: s.codeInPlan,
      level: s.level,
      kind: s.kind,
      planId: isiPublished.planId,
      sharedSubjectId: null,
    });
  }

  for (const s of mecArtifacts.subjects) {
    reviewsStore.seedSubject({
      id: s.id,
      planId: mecPublished.planId,
      codeInPlan: s.codeInPlan,
      name: s.name,
      shortName: s.shortName,
      level: s.level,
      kind: s.kind,
    });
    libraryService.subjects.set(s.id, {
      id: s.id,
      name: s.name,
      codeInPlan: s.codeInPlan,
      level: s.level,
      kind: s.kind,
      planId: mecPublished.planId,
      sharedSubjectId: null,
    });
  }

  // Sembrar docentes y reseñas
  const profMain = await reviewsStore.createOrResolveProfessor({
    facultyId: isiPublished.facultyId,
    displayName: 'Botta, Oscar Ernesto',
  });
  reviewsStore.aliasesList.push({
    id: crypto.randomUUID(),
    professorId: profMain.id,
    facultyId: isiPublished.facultyId,
    aliasRaw: 'Oscar, Botta',
    aliasNormalized: 'botta oscar',
  });
  reviewsStore.seedCommissionTeaching({
    professorId: profMain.id,
    subjectId: isiSubject1.id,
    termLabel: '2026 1C',
    isCurrent: true,
  });
  reviewsStore.seedCommissionTeaching({
    professorId: profMain.id,
    subjectId: mecSubject1.id,
    termLabel: '2026 1C',
    isCurrent: true,
  });

  const profMecOnly = await reviewsStore.createOrResolveProfessor({
    facultyId: mecPublished.facultyId,
    displayName: 'Mecánica, Laura',
  });
  reviewsStore.seedCommissionTeaching({
    professorId: profMecOnly.id,
    subjectId: mecSubject1.id,
    termLabel: '2026 1C',
    isCurrent: true,
  });

  const profUnder5 = await reviewsStore.createOrResolveProfessor({
    facultyId: isiPublished.facultyId,
    displayName: 'Pocas Reseñas, Martín',
  });
  reviewsStore.seedCommissionTeaching({
    professorId: profUnder5.id,
    subjectId: isiSubject2.id,
    termLabel: '2026 1C',
    isCurrent: true,
  });

  libraryService.professors.set(profMain.id, { id: profMain.id, displayName: profMain.displayName });

  // Usuarios para sembrar reseñas, archivos y probar no-regresión autenticada
  const authStudent = {
    id: crypto.randomUUID(),
    email: 'alumno.isi.privado@frc.utn.edu.ar',
    role: 'user' as const,
    selectedPlanId: isiPublished.planId,
  };
  const reporter1 = { id: crypto.randomUUID(), email: 'rep1@frc.utn.edu.ar' };
  const uploaderUser = { id: crypto.randomUUID(), email: 'uploader.secreto@frc.utn.edu.ar' };

  setLiveUserResolverForTesting(async (uid) => {
    if (uid === authStudent.id) {
      return {
        id: authStudent.id,
        email: authStudent.email,
        role: 'user',
        status: 'active',
        emailVerified: true,
        selectedPlanId: authStudent.selectedPlanId,
      };
    }
    return null;
  });

  reviewsStore.seedUserPlan(authStudent.id, authStudent.selectedPlanId);
  const authToken = jwt.sign(
    {
      id: authStudent.id,
      email: authStudent.email,
      role: 'user',
      emailVerified: true,
      selectedPlanId: authStudent.selectedPlanId,
    },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Sembrar 11 reseñas limpias en profMain (ISI Subject 1) -> >= 5 muestra período y prueba pageSize <= 10
  let firstCleanReviewId = '';
  for (let i = 1; i <= 11; i++) {
    const rev = await reviewsStore.createReview({
      userId: crypto.randomUUID(),
      professorId: profMain.id,
      subjectId: isiSubject1.id,
      academicYear: 2025,
      term: '1C',
      overall: 5,
      clarity: 5,
      treatment: 4,
      availability: 4,
      difficulty: 3,
      wouldRecommend: true,
      comment: `Comentario público limpio ${i}`,
    });
    if (i === 1) firstCleanReviewId = rev.id;
  }

  // Sembrar 1 reseña hidden, 1 removed y 1 reportada (open report) en profMain (ISI)
  const revHidden = await reviewsStore.createReview({
    userId: crypto.randomUUID(),
    professorId: profMain.id,
    subjectId: isiSubject1.id,
    academicYear: 2025,
    term: '1C',
    overall: 2,
    clarity: 2,
    treatment: 2,
    availability: 2,
    difficulty: 4,
    wouldRecommend: false,
    comment: 'NO_DEBE_VER_HIDDEN',
  });
  await reviewsStore.setReviewStatus(revHidden.id, 'hidden');

  const revRemoved = await reviewsStore.createReview({
    userId: crypto.randomUUID(),
    professorId: profMain.id,
    subjectId: isiSubject1.id,
    academicYear: 2025,
    term: '1C',
    overall: 1,
    clarity: 1,
    treatment: 1,
    availability: 1,
    difficulty: 5,
    wouldRecommend: false,
    comment: 'NO_DEBE_VER_REMOVED',
  });
  await reviewsStore.setReviewStatus(revRemoved.id, 'removed');

  const revReported = await reviewsStore.createReview({
    userId: crypto.randomUUID(),
    professorId: profMain.id,
    subjectId: isiSubject1.id,
    academicYear: 2025,
    term: '1C',
    overall: 2,
    clarity: 2,
    treatment: 2,
    availability: 2,
    difficulty: 4,
    wouldRecommend: false,
    comment: 'NO_DEBE_VER_REPORTADA',
  });
  const repReported = await reviewsStore.createReport({
    reviewId: revReported.id,
    reporterUserId: reporter1.id,
    reason: 'ofensiva',
    note: 'Reporte abierto pendiente de moderación',
    autoHideThreshold: 3,
  });

  // Reseña limpia para profMain en MEC (otro plan) para probar aislamiento entre planes
  await reviewsStore.createReview({
    userId: crypto.randomUUID(),
    professorId: profMain.id,
    subjectId: mecSubject1.id,
    academicYear: 2025,
    term: '1C',
    overall: 4,
    clarity: 4,
    treatment: 4,
    availability: 4,
    difficulty: 3,
    wouldRecommend: true,
    comment: 'RESENA_SOLO_MEC',
  });

  // Declarar asistencia para asegurar que attendedDeclared jamás salga en /api/public/professors/:id/reviews
  const enrollmentId = crypto.randomUUID();
  reviewsStore.enrollmentsMap.set(enrollmentId, {
    id: enrollmentId,
    userId: authStudent.id,
    subjectId: isiSubject2.id,
    commissionId: null,
    academicYear: 2024,
    term: '2C',
    source: 'manual',
    status: 'aprobada',
    professorIds: [profUnder5.id],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Reseña para profUnder5 (1 sola reseña < 5 -> academicYear y term deben salir null, y attendedDeclared no debe salir)
  await reviewsStore.createReview({
    userId: authStudent.id,
    professorId: profUnder5.id,
    subjectId: isiSubject2.id,
    academicYear: 2024,
    term: '2C',
    overall: 4,
    clarity: 4,
    treatment: 5,
    availability: 4,
    difficulty: 3,
    wouldRecommend: true,
    comment: 'Comentario profesor con 1 reseña',
  });

  // Sembrar archivos en Biblioteca (uploading, pending, approved, rejected, hidden, removed) + >30 aprobados para tope 30
  const longDescription450 = 'D'.repeat(450);
  const seedLibFile = (opts: {
    subjectId: string;
    planId: string;
    status: string;
    title: string;
    description?: string | null;
    withProfessor?: boolean;
    createdAt?: Date;
  }) => {
    const id = crypto.randomUUID();
    const createdAt = opts.createdAt ?? new Date();
    libraryService.files.set(id, {
      id,
      uploaderUserId: uploaderUser.id,
      subjectId: opts.subjectId,
      sharedSubjectId: null,
      sourceSubjectId: opts.subjectId,
      sourcePlanId: opts.planId,
      kind: 'parcial',
      academicYear: 2025,
      term: '1C',
      examInstance: '1er Parcial',
      hasSolution: true,
      title: opts.title,
      description: opts.description ?? 'Descripción breve',
      originalFilename: `secreto-${id}.pdf`,
      storageKey: `library/privado/${id}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      sha256: crypto.createHash('sha256').update(id).digest('hex'),
      status: opts.status,
      rejectionReason: opts.status === 'rejected' ? 'Motivo confidencial rechazo' : null,
      downloadCount: 7,
      helpfulCount: 3,
      adminNotifiedAt: new Date(),
      uploaderNotifiedAt: new Date(),
      reviewedBy: crypto.randomUUID(),
      reviewedAt: new Date(),
      createdAt,
      updatedAt: createdAt,
    });
    if (opts.withProfessor) {
      libraryService.fileProfessors.set(id, new Set([profMain.id]));
    }
    return id;
  };

  const approvedFileId = seedLibFile({
    subjectId: isiSubject1.id,
    planId: isiPublished.planId,
    status: 'approved',
    title: 'Parcial Aprobado ISI',
    description: longDescription450,
    withProfessor: true,
    createdAt: new Date(Date.now() + 60_000),
  });
  libraryService.helpfulVotes.add(`${approvedFileId}:${authStudent.id}`);

  for (const nonApprovedStatus of ['uploading', 'pending', 'rejected', 'hidden', 'removed']) {
    seedLibFile({
      subjectId: isiSubject1.id,
      planId: isiPublished.planId,
      status: nonApprovedStatus,
      title: `Archivo ${nonApprovedStatus.toUpperCase()} NO PUBLICO`,
    });
  }

  // Archivo aprobado exclusivo de MEC para aislar entre planes
  seedLibFile({
    subjectId: mecSubject1.id,
    planId: mecPublished.planId,
    status: 'approved',
    title: 'Parcial Exclusivo MEC',
  });

  // Sembrar 32 archivos aprobados extra en isiSubject2 para probar pageSize max 30
  for (let i = 1; i <= 32; i++) {
    seedLibFile({
      subjectId: isiSubject2.id,
      planId: isiPublished.planId,
      status: 'approved',
      title: `Guía Extra Paginación ${i}`,
      createdAt: new Date(Date.now() - i * 60_000),
    });
  }

  const app = createApp({ reviewsStore, userStateStore });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  async function req(
    method: string,
    urlPath: string,
    opts?: { token?: string; headers?: Record<string, string>; body?: unknown }
  ) {
    const headers: Record<string, string> = { ...(opts?.headers || {}) };
    if (opts?.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts?.body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers,
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, text, json };
  }

  // Introspector recursivo de rutas registradas en Express
  function normalizeLayerPrefix(regexp: RegExp): string {
    const src = regexp.source;
    if (src === '^\\/?(?=\\/|$)') return '';
    const cleaned = src
      .replace(/^\^/, '')
      .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
      .replace(/\\\//g, '/')
      .replace(/\(\?:\(\[\^\\\/]\+\?\)\)/g, ':param');
    return cleaned === '/' ? '' : cleaned;
  }

  function extractExpressRoutes(expressApp: Express): Array<{ method: string; path: string }> {
    const out: Array<{ method: string; path: string }> = [];

    function walkStack(stack: any[], prefix: string) {
      for (const layer of stack) {
        if (layer.route) {
          const routePath = layer.route.path === '/' ? '' : String(layer.route.path);
          const full = `${prefix}${routePath}` || '/';
          for (const m of Object.keys(layer.route.methods || {})) {
            if (layer.route.methods[m]) {
              out.push({ method: m.toUpperCase(), path: full });
            }
          }
        } else if (layer.name === 'router' && layer.handle?.stack) {
          const mount = normalizeLayerPrefix(layer.regexp);
          // Ignorar el catch-all 404 `/api/*`
          if (mount.includes('*')) continue;
          walkStack(layer.handle.stack, `${prefix}${mount}`);
        }
      }
    }

    const rootStack = (expressApp as any)._router?.stack || [];
    walkStack(rootStack, '');
    return out;
  }

  try {
    resetPublicRateLimiterForTesting();

    // =========================================================================
    // 1. MATRIZ COMPLETA DE RUTAS EXPRESS
    // =========================================================================
    console.log('📌 1. Matriz completa de rutas Express (públicas 200 vs protegidas 401 vs métodos 405)');

    const discovered = extractExpressRoutes(app);

    const PUBLIC_GET_200_ROUTES = new Set<string>([
      'GET /api/health',
      'GET /api/catalog/version',
      'GET /api/catalog/careers',
      'GET /api/catalog/plans/:planId',
      'GET /api/public/catalog/version',
      'GET /api/public/catalog/careers',
      'GET /api/public/catalog/plans/:planId',
      'GET /api/public/professors',
      'GET /api/public/professors/:id',
      'GET /api/public/professors/:id/reviews',
      'GET /api/public/library/subjects',
      'GET /api/public/library/files',
    ]);

    const UNAUTHENTICATED_AUTH_ENTRY_ROUTES = new Set<string>([
      'POST /api/auth/register',
      'POST /api/auth/google',
      'POST /api/auth/login',
      'POST /api/auth/refresh',
      'POST /api/auth/logout',
    ]);

    const PROTECTED_401_ROUTES = new Set<string>([
      // Direct /api/me
      'GET /api/me',
      'PUT /api/me/plan',
      'GET /api/me/reviewable',
      'POST /api/me/reviewable/dismiss',
      'POST /api/me/reviewable/seen',
      // Auth protegidas
      'POST /api/auth/verify-email',
      'POST /api/auth/resend-code',
      'POST /api/auth/cancel-registration',
      'GET /api/auth/me',
      // Catalog schedule (ahora protegida)
      'GET /api/catalog/schedule',
      // Professors (autenticado)
      'GET /api/professors/ratings',
      'GET /api/professors',
      'GET /api/professors/:id',
      'GET /api/professors/:id/reviews',
      // Reviews
      'POST /api/reviews',
      'PUT /api/reviews/:id',
      'DELETE /api/reviews/:id',
      'POST /api/reviews/:id/helpful',
      'POST /api/reviews/:id/report',
      // Enrollments
      'GET /api/enrollments/options/:subjectId',
      'GET /api/enrollments',
      'PUT /api/enrollments/:subjectId',
      'DELETE /api/enrollments/:id',
      // Admin (admin.routes.ts + createAdminReviewsRouter)
      'POST /api/admin/reauth',
      'POST /api/admin/reauth/password',
      'POST /api/admin/reauth/google',
      'GET /api/admin/reauth/status',
      'GET /api/admin/stats',
      'GET /api/admin/users',
      'GET /api/admin/users/export',
      'GET /api/admin/users/export.csv',
      'GET /api/admin/users/:id',
      'PATCH /api/admin/users/:id/role',
      'PATCH /api/admin/users/:id/status',
      'PATCH /api/admin/users/:id/verify-email',
      'POST /api/admin/users/:id/verify-email',
      'POST /api/admin/users/:id/resend-code',
      'POST /api/admin/users/:id/revoke-sessions',
      'DELETE /api/admin/users/:id',
      'GET /api/admin/audit-logs',
      'GET /api/admin/terms',
      'POST /api/admin/terms',
      'PATCH /api/admin/terms/:id/current',
      'PATCH /api/admin/terms/:id/default',
      'POST /api/admin/terms/:id/duplicate',
      'GET /api/admin/terms/:id/commissions',
      'GET /api/admin/commissions',
      'POST /api/admin/commissions',
      'GET /api/admin/commissions/:id/impact',
      'PATCH /api/admin/commissions/:id',
      'PATCH /api/admin/commissions/:id/retire',
      'DELETE /api/admin/commissions/:id',
      'POST /api/admin/schedule/preview-import',
      'POST /api/admin/schedule/apply-import',
      'POST /api/admin/schedules/preview-import',
      'POST /api/admin/schedules/apply-import',
      'POST /api/admin/schedules',
      'GET /api/admin/library/pending',
      'GET /api/admin/library/files',
      'GET /api/admin/library/files/:id/preview-url',
      'GET /api/admin/library/files/:id/uploader',
      'PATCH /api/admin/library/files/:id/approve',
      'PATCH /api/admin/library/files/:id/reject',
      'PATCH /api/admin/library/files/:id/remove',
      'POST /api/admin/library/files/:id/resend-admin-notification',
      'POST /api/admin/library/files/:id/suspend-author',
      'GET /api/admin/library/reports',
      'PATCH /api/admin/library/reports/:id',
      'GET /api/admin/library/stats',
      'POST /api/admin/library/test-storage',
      'GET /api/admin/plans',
      'GET /api/admin/plans/template',
      'POST /api/admin/plans/preview',
      'POST /api/admin/plans/import',
      'GET /api/admin/plans/:id',
      'DELETE /api/admin/plans/:id',
      'GET /api/admin/professors',
      'GET /api/admin/professors/duplicates',
      'POST /api/admin/professors',
      'POST /api/admin/professors/merge',
      'PATCH /api/admin/professors/:id',
      'POST /api/admin/professors/:id/subjects',
      'GET /api/admin/reviews/reports',
      'GET /api/admin/reviews/all',
      'GET /api/admin/reviews',
      'PATCH /api/admin/reviews/:id/status',
      'PATCH /api/admin/reviews/reports/:reportId',
      'POST /api/admin/reviews/:id/suspend-author',
      'GET /api/admin/reviews/stats',
      // Library (autenticado)
      'GET /api/library/terms-status',
      'POST /api/library/accept-terms',
      'GET /api/library/subjects',
      'GET /api/library/subjects-summary',
      'GET /api/library/subjects/:subjectId/files',
      'GET /api/library/files',
      'GET /api/library/files/:id',
      'POST /api/library/uploads/init',
      'POST /api/library/uploads/:id/complete',
      'POST /api/library/uploads/complete',
      'GET /api/library/files/:id/download',
      'POST /api/library/files/:id/helpful',
      'POST /api/library/files/:id/report',
      'GET /api/library/my-uploads',
      'PATCH /api/library/my-uploads/:id',
      'DELETE /api/library/my-uploads/:id',
      // User state (/api/*)
      'GET /api/state',
      'PUT /api/progress/:subjectId',
      'PUT /api/electives',
      'PUT /api/basket',
      'PUT /api/settings',
      'GET /api/schedule/proposals',
      'POST /api/schedule/proposals',
      'DELETE /api/schedule/proposals/:id',
      'PUT /api/schedule/selections',
      'POST /api/exam-attempts',
      'DELETE /api/exam-attempts/:id',
      'GET /api/export',
      'POST /api/import',
      'DELETE /api/me',
    ]);

    const discoveredKeys = discovered.map((r) => `${r.method} ${r.path}`);
    const discoveredSet = new Set(discoveredKeys);

    const unclassified = discoveredKeys.filter(
      (k) =>
        !PUBLIC_GET_200_ROUTES.has(k) &&
        !UNAUTHENTICATED_AUTH_ENTRY_ROUTES.has(k) &&
        !PROTECTED_401_ROUTES.has(k)
    );
    const missingFromApp = [
      ...PUBLIC_GET_200_ROUTES,
      ...UNAUTHENTICATED_AUTH_ENTRY_ROUTES,
      ...PROTECTED_401_ROUTES,
    ].filter((k) => !discoveredSet.has(k));

    assert(
      unclassified.length === 0 && missingFromApp.length === 0,
      'Matriz completa: cero rutas sin clasificar y cero rutas faltantes respecto a Express',
      `unclassified=${JSON.stringify(unclassified)} missing=${JSON.stringify(missingFromApp)}`
    );

    // Toda ruta protegida devuelve 401 sin sesión (enviando header CSRF para no enmascarar con 403)
    const sampleId = crypto.randomUUID();
    const non401Routes: Array<{ route: string; status: number }> = [];
    for (const routeKey of PROTECTED_401_ROUTES) {
      const [method, rawPath] = routeKey.split(' ');
      const targetPath = rawPath
        .replace(':subjectId', sampleId)
        .replace(':planId', isiPublished.planId)
        .replace(':reportId', sampleId)
        .replace(':id', sampleId);
      const r = await req(method, targetPath, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: method === 'GET' || method === 'DELETE' ? undefined : {},
      });
      if (r.status !== 401) {
        non401Routes.push({ route: routeKey, status: r.status });
      }
    }
    assert(
      non401Routes.length === 0,
      `Todas las ${PROTECTED_401_ROUTES.size} rutas protegidas devuelven 401 sin sesión`,
      JSON.stringify(non401Routes)
    );

    // Toda ruta pública permitida responde 200 sin sesión, sin cookies y sin CSRF
    const non200Public: Array<{ route: string; status: number }> = [];
    for (const routeKey of PUBLIC_GET_200_ROUTES) {
      const [, rawPath] = routeKey.split(' ');
      const targetPath = rawPath
        .replace(':planId', isiPublished.planId)
        .replace(':id', profMain.id);
      const r = await req('GET', targetPath);
      if (r.status !== 200) {
        non200Public.push({ route: routeKey, status: r.status });
      }
    }
    assert(
      non200Public.length === 0,
      `Todas las ${PUBLIC_GET_200_ROUTES.size} rutas públicas responden 200 sin sesión ni CSRF`,
      JSON.stringify(non200Public)
    );

    // Métodos distintos de GET rechazados en todos los endpoints /api/public/*
    const publicPaths = [
      '/api/public/catalog/version',
      '/api/public/catalog/careers',
      `/api/public/catalog/plans/${isiPublished.planId}`,
      '/api/public/professors',
      `/api/public/professors/${profMain.id}`,
      `/api/public/professors/${profMain.id}/reviews`,
      '/api/public/library/subjects',
      '/api/public/library/files',
    ];
    const non405Methods: Array<{ method: string; path: string; status: number; allow: string | null }> = [];
    for (const pubPath of publicPaths) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const r = await req(method, pubPath, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          body: {},
        });
        if (r.status !== 405 || r.headers.get('allow') !== 'GET') {
          non405Methods.push({ method, path: pubPath, status: r.status, allow: r.headers.get('allow') });
        }
      }
    }
    assert(
      non405Methods.length === 0,
      'Métodos POST/PUT/PATCH/DELETE rechazados con 405 y Allow: GET en todo /api/public/*',
      JSON.stringify(non405Methods)
    );

    // Entradas públicas de auth exigen CSRF (403 sin X-Requested-With) y mantienen su contrato sin sesión
    const authEntryResults = await Promise.all(
      Array.from(UNAUTHENTICATED_AUTH_ENTRY_ROUTES).map(async (routeKey) => {
        const [method, p] = routeKey.split(' ');
        const noCsrf = await req(method, p, { body: {} });
        return { routeKey, noCsrfStatus: noCsrf.status };
      })
    );
    const refreshNoCookie = await req('POST', '/api/auth/refresh', {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: {},
    });
    const logoutNoCookie = await req('POST', '/api/auth/logout', {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: {},
    });
    assert(
      authEntryResults.every((r) => r.noCsrfStatus === 403) &&
        refreshNoCookie.status === 401 &&
        logoutNoCookie.status === 200,
      'Entradas públicas de auth rechazan mutaciones sin CSRF (403); /refresh sin cookie da 401 y /logout da 200'
    );

    // =========================================================================
    // 2. ESCÁNER RECURSIVO DE LISTA BLANCA, TRUNCADO Y CACHE-CONTROL
    // =========================================================================
    console.log('\n📌 2. Lista blanca recursiva de claves, truncado de description y Cache-Control');

    const GLOBAL_BANNED_KEYS = new Set([
      'email',
      'userEmail',
      'authorEmail',
      'uploaderEmail',
      'adminEmail',
      'reporterEmail',
      'targetEmail',
      'canonicalEmail',
      'passwordHash',
      'userId',
      'authorUserId',
      'uploaderUserId',
      'reporterUserId',
      'reviewedBy',
      'adminUserId',
      'storageKey',
      'sha256',
      'originalFilename',
      'downloadUrl',
      'previewUrl',
      'uploadUrl',
      'presignedUrl',
      'status',
      'rejectionReason',
      'uploader',
      'uploaderDisplay',
      'uploaderName',
      'sharedSubjectId',
      'sourcePlanId',
      'sourceSubjectId',
      'adminNotifiedAt',
      'uploaderNotifiedAt',
      'reviewedAt',
      'userHasVotedHelpful',
      'viewerHasVotedHelpful',
      'viewerHasReported',
      'reviewsPage',
      'recentReviews',
      'aliases',
      'ppsSubjectCode',
    ]);

    function findForbiddenKeys(
      value: unknown,
      opts: { allowComment: boolean; banReviewPrivateFields?: boolean },
      trail = '$'
    ): string[] {
      const violations: string[] = [];
      if (Array.isArray(value)) {
        value.forEach((item, idx) => {
          violations.push(...findForbiddenKeys(item, opts, `${trail}[${idx}]`));
        });
        return violations;
      }
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          const isViewerPrefixed = key.startsWith('viewer');
          const isUploaderPrefixed = key.startsWith('uploader');
          const isAuthorPrefixed = key.startsWith('author');
          const isCommentForbidden = key === 'comment' && !opts.allowComment;
          const isExtraBanned =
            opts.banReviewPrivateFields &&
            ['studentLabel', 'attendedDeclared', 'attendedPeriod', 'professorId', 'updatedAt', 'publishedMonthYear', 'publishedLabel'].includes(
              key
            );
          if (
            GLOBAL_BANNED_KEYS.has(key) ||
            isViewerPrefixed ||
            isUploaderPrefixed ||
            isAuthorPrefixed ||
            isCommentForbidden ||
            isExtraBanned
          ) {
            violations.push(`${trail}.${key}`);
          }
          violations.push(...findForbiddenKeys(child, opts, `${trail}.${key}`));
        }
      }
      return violations;
    }

    const rPubVer = await req('GET', '/api/public/catalog/version');
    const rPubCareers = await req('GET', '/api/public/catalog/careers');
    const rPubPlan = await req('GET', `/api/public/catalog/plans/${isiPublished.planId}`);
    const rPubProfs = await req('GET', '/api/public/professors');
    const rPubProfDetail = await req('GET', `/api/public/professors/${profMain.id}`);
    const rPubProfReviews = await req('GET', `/api/public/professors/${profMain.id}/reviews`);
    const rPubProfUnder5Reviews = await req('GET', `/api/public/professors/${profUnder5.id}/reviews`);
    const rPubLibSubs = await req('GET', '/api/public/library/subjects');
    const rPubLibFiles = await req('GET', '/api/public/library/files?pageSize=30');

    const scanTargets: Array<{ name: string; res: any; allowComment: boolean; banReviewPrivate?: boolean }> = [
      { name: '/catalog/version', res: rPubVer, allowComment: false },
      { name: '/catalog/careers', res: rPubCareers, allowComment: false },
      { name: '/catalog/plans/:planId', res: rPubPlan, allowComment: false },
      { name: '/professors', res: rPubProfs, allowComment: false },
      { name: '/professors/:id', res: rPubProfDetail, allowComment: false },
      { name: '/professors/:id/reviews', res: rPubProfReviews, allowComment: true, banReviewPrivate: true },
      { name: '/library/subjects', res: rPubLibSubs, allowComment: false },
      { name: '/library/files', res: rPubLibFiles, allowComment: false },
    ];

    const keyViolations: string[] = [];
    for (const t of scanTargets) {
      const found = findForbiddenKeys(t.res.json, {
        allowComment: t.allowComment,
        banReviewPrivateFields: t.banReviewPrivate,
      });
      if (found.length > 0) {
        keyViolations.push(`${t.name}: ${found.join(', ')}`);
      }
      assert(
        !t.res.text.includes(authStudent.email) &&
          !t.res.text.includes(uploaderUser.email) &&
          !t.res.text.includes(authStudent.id) &&
          !t.res.text.includes(uploaderUser.id),
        `Respuesta pública ${t.name} no filtra emails ni userIds sembrados`
      );
    }
    assert(
      keyViolations.length === 0,
      'Escáner recursivo: ninguna clave prohibida aparece en /api/public/*',
      JSON.stringify(keyViolations)
    );

    // Estructura exacta de reseña pública (15 claves) y archivo de biblioteca (17 claves)
    const expectedReviewKeys = [
      'academicYear',
      'clarity',
      'comment',
      'createdAt',
      'difficulty',
      'helpfulCount',
      'id',
      'overall',
      'subjectCode',
      'subjectId',
      'subjectName',
      'term',
      'treatment',
      'wouldRecommend',
      'availability',
    ].sort();
    const firstRev = rPubProfReviews.json?.data?.items?.[0];
    assert(
      firstRev &&
        JSON.stringify(Object.keys(firstRev).sort()) === JSON.stringify(expectedReviewKeys) &&
        /^\d{4}-\d{2}$/.test(firstRev.createdAt) &&
        firstRev.academicYear === 2025 &&
        firstRev.term === '1C',
      'Reseña pública expone exactamente las 15 claves de lista blanca, fecha YYYY-MM y período con >=5 reseñas'
    );

    const under5Rev = rPubProfUnder5Reviews.json?.data?.items?.[0];
    assert(
      under5Rev && under5Rev.academicYear === null && under5Rev.term === null,
      'Reseña pública de profesor con <5 reseñas oculta academicYear y term (null)'
    );

    const expectedLibFileKeys = [
      'academicYear',
      'createdAt',
      'description',
      'downloadCount',
      'examInstance',
      'hasSolution',
      'helpfulCount',
      'id',
      'kind',
      'mimeType',
      'professorNames',
      'sizeBytes',
      'subjectCode',
      'subjectId',
      'subjectName',
      'term',
      'title',
    ].sort();
    const approvedPubFile = (rPubLibFiles.json?.data?.items || []).find(
      (f: any) => f.id === approvedFileId
    );
    assert(
      approvedPubFile &&
        JSON.stringify(Object.keys(approvedPubFile).sort()) === JSON.stringify(expectedLibFileKeys) &&
        typeof approvedPubFile.description === 'string' &&
        approvedPubFile.description.length === 300 &&
        Array.isArray(approvedPubFile.professorNames) &&
        approvedPubFile.professorNames.includes('Botta, Oscar Ernesto'),
      'Archivo público expone exactamente 17 claves, description truncada a 300 chars y professorNames[]'
    );

    // Cabeceras Cache-Control + ETag 304
    const revCacheControl = rPubProfReviews.headers.get('cache-control') || '';
    const planEtag = rPubPlan.headers.get('etag');
    const rPubPlan304 = await req('GET', `/api/public/catalog/plans/${isiPublished.planId}`, {
      headers: planEtag ? { 'If-None-Match': planEtag } : {},
    });
    assert(
      revCacheControl === 'public, max-age=60' &&
        !revCacheControl.includes('stale-while-revalidate') &&
        rPubVer.headers.get('cache-control') === 'public, max-age=60, stale-while-revalidate=300' &&
        rPubPlan.headers.get('cache-control') === 'public, max-age=3600, stale-while-revalidate=86400' &&
        rPubProfs.headers.get('cache-control') === 'public, max-age=300, stale-while-revalidate=600' &&
        rPubLibFiles.headers.get('cache-control') === 'public, max-age=300, stale-while-revalidate=600' &&
        Boolean(planEtag) &&
        rPubPlan304.status === 304,
      'Cabeceras Cache-Control correctas (reviews max-age=60 SIN stale-while-revalidate) y ETag/304 funcional'
    );

    // =========================================================================
    // 3. AISLAMIENTO DE PLANES (404 EN NO PUBLICADOS) Y USUARIO AUTENTICADO
    // =========================================================================
    console.log('\n📌 3. Aislamiento de planes (404 draft/archived/inactive/draft-career/invalid) y usuario autenticado');

    const badPlanCases = [
      ['plan draft (Industrial)', indDraft.planId],
      ['plan archived', archivedPlan.planId],
      ['plan inactivo', inactivePlan.planId],
      ['carrera draft', draftCareerPlan.planId],
      ['UUID inexistente', crypto.randomUUID()],
      ['string no-UUID', 'no-es-uuid'],
    ];
    const isolationFailures: string[] = [];
    for (const [label, badId] of badPlanCases) {
      const endpoints = [
        `/api/public/catalog/plans/${badId}`,
        `/api/public/professors?planId=${badId}`,
        `/api/public/professors/${profMain.id}?planId=${badId}`,
        `/api/public/professors/${profMain.id}/reviews?planId=${badId}`,
        `/api/public/library/subjects?planId=${badId}`,
        `/api/public/library/files?planId=${badId}`,
      ];
      for (const ep of endpoints) {
        const r = await req('GET', ep);
        if (r.status !== 404) {
          isolationFailures.push(`${label} -> ${ep} devolvió ${r.status}`);
        }
      }
    }
    assert(
      isolationFailures.length === 0,
      'Todos los endpoints /api/public/* con planId responden 404 ante draft, archived, inactivo, carrera draft e inexistente',
      JSON.stringify(isolationFailures)
    );

    // Selector público sí permite otro plan PUBLICADO (MEC) y acota resultados
    const rMecCareersIds = (rPubCareers.json?.data || []).flatMap((i: any) =>
      i.faculties.flatMap((f: any) => f.careers.flatMap((c: any) => c.plans.map((p: any) => p.id)))
    );
    const rMecProfs = await req('GET', `/api/public/professors?planId=${mecPublished.planId}`);
    const rMecReviews = await req(
      'GET',
      `/api/public/professors/${profMain.id}/reviews?planId=${mecPublished.planId}`
    );
    const rMecLibFiles = await req('GET', `/api/public/library/files?planId=${mecPublished.planId}`);

    assert(
      rMecCareersIds.length === 2 &&
        rMecCareersIds.includes(isiPublished.planId) &&
        rMecCareersIds.includes(mecPublished.planId) &&
        !rMecCareersIds.includes(indDraft.planId) &&
        rMecProfs.status === 200 &&
        rMecProfs.json.data.professors.some((p: any) => p.id === profMecOnly.id) &&
        !rMecProfs.json.data.professors.some((p: any) => p.id === profUnder5.id) &&
        rMecReviews.json.data.items.length === 1 &&
        rMecReviews.json.data.items[0].comment === 'RESENA_SOLO_MEC' &&
        rMecLibFiles.json.data.items.length === 1 &&
        rMecLibFiles.json.data.items[0].title === 'Parcial Exclusivo MEC',
      'El parámetro ?planId= en /api/public/* permite elegir otro plan publicado y acota profesores, reseñas y biblioteca'
    );

    // Usuario autenticado sigue ignorando ?planId= en /api/professors y /api/library/*
    const authProfs = await req('GET', `/api/professors?planId=${mecPublished.planId}`, {
      token: authToken,
    });
    const authLibSubs = await req('GET', `/api/library/subjects?planId=${mecPublished.planId}`, {
      token: authToken,
    });
    const authLibFiles = await req('GET', `/api/library/files?planId=${mecPublished.planId}`, {
      token: authToken,
    });

    assert(
      authProfs.status === 200 &&
        !authProfs.json.data.professors.some((p: any) => p.id === profMecOnly.id) &&
        authProfs.json.data.professors.some((p: any) => p.id === profUnder5.id) &&
        authLibSubs.status === 200 &&
        !authLibSubs.json.data.some((s: any) => s.id === mecSubject1.id) &&
        authLibFiles.status === 200 &&
        !authLibFiles.json.data.items.some((f: any) => f.title === 'Parcial Exclusivo MEC'),
      'Usuario autenticado sigue ignorando ?planId= en /api/professors y /api/library/*'
    );

    // =========================================================================
    // 4. MODERACIÓN (BIBLIOTECA + RESEÑAS) Y TOPES DE PAGINACIÓN
    // =========================================================================
    console.log('\n📌 4. Moderación estricta de Biblioteca/Reseñas y topes de paginación (10 reseñas / 30 archivos)');

    const isiSub1Count = (rPubLibSubs.json?.data || []).find(
      (s: any) => s.id === isiSubject1.id
    )?.approvedFilesCount;
    const isiSub1Files = await req(
      'GET',
      `/api/public/library/files?subjectId=${isiSubject1.id}&pageSize=50`
    );
    const allIsiFilesClamp = await req('GET', '/api/public/library/files?pageSize=999');

    assert(
      isiSub1Count === 1 &&
        isiSub1Files.json.data.total === 1 &&
        isiSub1Files.json.data.items.length === 1 &&
        isiSub1Files.json.data.items[0].id === approvedFileId &&
        allIsiFilesClamp.json.data.pageSize === 30 &&
        allIsiFilesClamp.json.data.items.length === 30,
      'Biblioteca pública cuenta/lista SOLO archivos approved (excluye uploading/pending/rejected/hidden/removed) y clampea pageSize <= 30'
    );

    const isiReviewsClamp = await req(
      'GET',
      `/api/public/professors/${profMain.id}/reviews?pageSize=50`
    );
    const isiReviewsPage2 = await req(
      'GET',
      `/api/public/professors/${profMain.id}/reviews?page=2&pageSize=10`
    );
    const allReturnedComments = [
      ...(isiReviewsClamp.json?.data?.items || []),
      ...(isiReviewsPage2.json?.data?.items || []),
    ].map((r: any) => r.comment);

    assert(
      isiReviewsClamp.json.data.pageSize === 10 &&
        isiReviewsClamp.json.data.items.length === 10 &&
        isiReviewsClamp.json.data.total === 11 &&
        allReturnedComments.length === 11 &&
        !allReturnedComments.includes('NO_DEBE_VER_HIDDEN') &&
        !allReturnedComments.includes('NO_DEBE_VER_REMOVED') &&
        !allReturnedComments.includes('NO_DEBE_VER_REPORTADA') &&
        !allReturnedComments.includes('RESENA_SOLO_MEC') &&
        allReturnedComments.some((c: string) => c.startsWith('Comentario público limpio')) &&
        firstCleanReviewId.length > 0,
      'Reseñas públicas excluyen hidden, removed, con reporte open y de otro plan; y clampean pageSize <= 10'
    );

    // Al descartar el reporte abierto (moderada y cleared manteniendo published), pasa a mostrarse
    await reviewsStore.resolveReport(repReported.reportId, 'dismissed', 'published');
    const afterDismiss1 = await req(
      'GET',
      `/api/public/professors/${profMain.id}/reviews?pageSize=10`
    );
    const afterDismiss2 = await req(
      'GET',
      `/api/public/professors/${profMain.id}/reviews?page=2&pageSize=10`
    );
    const commentsAfterDismiss = [
      ...(afterDismiss1.json?.data?.items || []),
      ...(afterDismiss2.json?.data?.items || []),
    ].map((r: any) => r.comment);
    assert(
      afterDismiss1.json.data.total === 12 &&
        commentsAfterDismiss.includes('NO_DEBE_VER_REPORTADA'),
      'Al descartar el reporte abierto como dismissed, la reseña moderada vuelve a mostrarse en /api/public/professors/:id/reviews'
    );

    // =========================================================================
    // 5. RATE LIMIT POR IP CON X-FORWARDED-FOR INDEPENDIENTE
    // =========================================================================
    console.log('\n📌 5. Rate limit por IP independiente vía X-Forwarded-For');

    configurePublicRateLimiterForTesting({ maxRequests: 3, windowMs: 60_000 });
    const ip1 = '203.0.113.10';
    const ip2 = '198.51.100.22';

    const ip1Statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await req('GET', '/api/public/catalog/version', {
        headers: { 'X-Forwarded-For': ip1 },
      });
      ip1Statuses.push(r.status);
    }
    const ip1Limited = await req('GET', '/api/public/catalog/version', {
      headers: { 'X-Forwarded-For': ip1 },
    });
    const ip2Ok = await req('GET', '/api/public/catalog/version', {
      headers: { 'X-Forwarded-For': ip2 },
    });

    assert(
      ip1Statuses.every((s) => s === 200) &&
        ip1Limited.status === 429 &&
        Number(ip1Limited.headers.get('retry-after')) >= 1 &&
        ip2Ok.status === 200,
      'IP limitada vía X-Forwarded-For recibe 429 + Retry-After sin afectar a otra IP distinta (200)'
    );

    // =========================================================================
    // 6. HARDENING DEL RATE LIMIT PÚBLICO Y GUARDAS DRIZZLE (a–g)
    // =========================================================================
    console.log('\n📌 6. Hardening: XFF desde la derecha, doble balde, env defaults, tope memoria y Drizzle');

    // (a) Spoofing a la izquierda con hops=2: misma IP real cuenta en el mismo balde y no afecta a otra IP
    configurePublicRateLimiterForTesting({
      maxRequests: 2,
      umbrellaMaxRequests: 100,
      trustedHops: 2,
      windowMs: 60_000,
    });
    const spoofA1 = await req('GET', '/api/public/catalog/version', {
      headers: { 'X-Forwarded-For': '1.1.1.1, 203.0.113.10, 10.0.1.5' },
    });
    const spoofA2 = await req('GET', '/api/public/catalog/version', {
      headers: { 'X-Forwarded-For': '2.2.2.2, 203.0.113.10, 10.0.1.5' },
    });
    const spoofA3 = await req('GET', '/api/public/catalog/version', {
      headers: { 'X-Forwarded-For': '3.3.3.3, 203.0.113.10, 10.0.1.5' },
    });
    const otherCleanIp = await req('GET', '/api/public/catalog/version', {
      headers: { 'X-Forwarded-For': '9.9.9.9, 198.51.100.22, 10.0.1.5' },
    });
    assert(
      spoofA1.status === 200 &&
        spoofA2.status === 200 &&
        spoofA3.status === 429 &&
        Number(spoofA3.headers.get('retry-after')) >= 1 &&
        otherCleanIp.status === 200,
      '(a) Spoofing a la izquierda con hops=2 comparte balde por 203.0.113.10 y bloquea sin afectar 198.51.100.22'
    );

    // (b) Llamada directa rotando valor izquierdo dispara el paraguas por lastHop
    configurePublicRateLimiterForTesting({
      maxRequests: 50,
      umbrellaMaxRequests: 3,
      trustedHops: 2,
      windowMs: 60_000,
    });
    const umb1 = await req('GET', '/api/public/catalog/version', {
      headers: { 'X-Forwarded-For': '192.0.2.1, 203.0.113.99' },
    });
    const umb2 = await req('GET', '/api/public/catalog/version', {
      headers: { 'X-Forwarded-For': '192.0.2.2, 203.0.113.99' },
    });
    const umb3 = await req('GET', '/api/public/catalog/version', {
      headers: { 'X-Forwarded-For': '192.0.2.3, 203.0.113.99' },
    });
    const umb4Blocked = await req('GET', '/api/public/catalog/version', {
      headers: { 'X-Forwarded-For': '192.0.2.4, 203.0.113.99' },
    });
    const otherLastHopOk = await req('GET', '/api/public/catalog/version', {
      headers: { 'X-Forwarded-For': '192.0.2.4, 198.51.100.77' },
    });
    assert(
      umb1.status === 200 &&
        umb2.status === 200 &&
        umb3.status === 200 &&
        umb4Blocked.status === 429 &&
        otherLastHopOk.status === 200,
      '(b) Rotar XFF izquierdo llamando con un solo salto no evade el paraguas por lastHop'
    );

    // (c) Header de una sola entrada con hops=2, prefijo ::ffff:, acotado a 64 chars y sin header
    const singleHopReq = {
      headers: { 'x-forwarded-for': '::ffff:203.0.113.55' },
      socket: { remoteAddress: '10.0.0.1' },
    } as any;
    const noHeaderReq = {
      headers: {},
      socket: { remoteAddress: '::ffff:198.51.100.44' },
    } as any;
    const longEntry = 'a'.repeat(120);
    const truncatedReq = {
      headers: { 'x-forwarded-for': `${longEntry}, 10.0.0.2` },
      socket: { remoteAddress: '10.0.0.1' },
    } as any;
    assert(
      getPublicClientIp(singleHopReq, 2) === '203.0.113.55' &&
        getLastHopIp(singleHopReq) === '203.0.113.55' &&
        getPublicClientIp(noHeaderReq, 2) === '198.51.100.44' &&
        getLastHopIp(noHeaderReq) === '198.51.100.44' &&
        getPublicClientIp(truncatedReq, 2).length === 64,
      '(c) Header de 1 entrada con hops=2 usa esa entrada, normaliza ::ffff:, acota a 64 chars y fallback a socket'
    );

    // (d) Variables de entorno inválidas caen a defaults seguros y RATE_LIMIT_DEBUG loguea máx 20 sin IPs
    const invalidEnv = resolvePublicRateLimiterEnvConfig({
      PUBLIC_TRUSTED_HOPS: '0',
      PUBLIC_RATE_LIMIT_PER_MIN: '-15',
      PUBLIC_RATE_LIMIT_UMBRELLA_PER_MIN: 'no-es-numero',
      RATE_LIMIT_DEBUG: 'true',
    });
    const decimalEnv = resolvePublicRateLimiterEnvConfig({
      PUBLIC_TRUSTED_HOPS: '2.5',
      PUBLIC_RATE_LIMIT_PER_MIN: '',
      PUBLIC_RATE_LIMIT_UMBRELLA_PER_MIN: '-1',
      RATE_LIMIT_DEBUG: '1',
    });
    const debugLogs: string[] = [];
    configurePublicRateLimiterForTesting({
      maxRequests: 100,
      umbrellaMaxRequests: 100,
      trustedHops: 2,
      debug: true,
      logger: (msg) => debugLogs.push(msg),
    });
    for (let i = 0; i < 25; i++) {
      await req('GET', '/api/public/catalog/version', {
        headers: { 'X-Forwarded-For': `203.0.113.${10 + i}, 10.0.1.5` },
      });
    }
    const debugLogsContainAnyIp = debugLogs.some(
      (line) => line.includes('203.0.113.') || line.includes('10.0.1.5') || line.includes('127.0.0.1')
    );
    assert(
      invalidEnv.trustedHops === 2 &&
        invalidEnv.clientMaxPerMin === 120 &&
        invalidEnv.umbrellaMaxPerMin === 1500 &&
        invalidEnv.debug === false &&
        decimalEnv.trustedHops === 2 &&
        decimalEnv.clientMaxPerMin === 120 &&
        decimalEnv.umbrellaMaxPerMin === 1500 &&
        decimalEnv.debug === true &&
        debugLogs.length === 20 &&
        debugLogs.every((l) => l.includes('xffEntries=2') && l.includes('clientEqualsLastHop=false')) &&
        !debugLogsContainAnyIp,
      '(d) Variables de entorno inválidas usan defaults seguros y RATE_LIMIT_DEBUG=1 loguea solo 20 requests sin IPs'
    );

    // (e) Tope de memoria: BoundedCounterMap(5) nunca supera tamaño 5 tras 20 IPs distintas (y barre vencidas)
    const bounded = new BoundedCounterMap(5);
    let maxObservedSize = 0;
    const baseNow = 1_000_000;
    for (let i = 0; i < 20; i++) {
      bounded.increment(`203.0.113.${i}`, baseNow + i * 10, 60_000);
      if (bounded.size > maxObservedSize) maxObservedSize = bounded.size;
    }
    const boundedAfterExpiry = new BoundedCounterMap(2);
    boundedAfterExpiry.increment('198.51.100.1', baseNow, 100);
    boundedAfterExpiry.increment('198.51.100.2', baseNow + 200, 60_000);
    // .1 ya venció en baseNow + 250 -> debe barrerse antes de desalojar a .2
    boundedAfterExpiry.increment('198.51.100.3', baseNow + 250, 60_000);
    assert(
      maxObservedSize === 5 &&
        bounded.size === 5 &&
        !bounded.has('203.0.113.0') &&
        bounded.has('203.0.113.19') &&
        boundedAfterExpiry.size === 2 &&
        !boundedAfterExpiry.has('198.51.100.1') &&
        boundedAfterExpiry.has('198.51.100.2') &&
        boundedAfterExpiry.has('198.51.100.3'),
      '(e) BoundedCounterMap(5) acota en 5 entradas con 20 IPs y barre vencidas antes de desalojar activas'
    );

    // (f) DrizzleReviewsStore.getProfessorById con id no-UUID devuelve null sin abrir conexión DB
    const drizzleStore = new DrizzleReviewsStore();
    const nonUuidProf = await drizzleStore.getProfessorById('no-es-un-uuid-valido');
    assert(
      nonUuidProf === null,
      '(f) DrizzleReviewsStore.getProfessorById("no-es-un-uuid-valido") retorna null sin consultar Postgres'
    );

    // (g) buildPublishedReviewsCountQuery(.toSQL()) refleja el filtro NOT EXISTS sobre review_reports ('open')
    const sqlWithExclusion = buildPublishedReviewsCountQuery({
      professorId: '11111111-1111-4111-8111-111111111111',
      excludeOpenReports: true,
    }).toSQL();
    const sqlWithoutExclusion = buildPublishedReviewsCountQuery({
      professorId: '11111111-1111-4111-8111-111111111111',
      excludeOpenReports: false,
    }).toSQL();
    assert(
      /not exists/i.test(sqlWithExclusion.sql) &&
        sqlWithExclusion.sql.includes('"review_reports"') &&
        sqlWithExclusion.params.includes('published') &&
        sqlWithExclusion.params.includes('open') &&
        !sqlWithoutExclusion.sql.includes('"review_reports"'),
      '(g) buildPublishedReviewsCountQuery(.toSQL()) aplica NOT EXISTS sobre review_reports con estado open'
    );
  } finally {
    configurePublicRateLimiterForTesting(null);
    setCatalogStoreForTesting(null);
    setLibraryServiceForTesting(null);
    setLiveUserResolverForTesting(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(` 📊 RESULTADO TESTS ACCESO PÚBLICO (TRAMO 1): ${passed} pasaron, ${failed} fallaron`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Error fatal en publicAccess.test.ts:', err);
  process.exit(1);
});
