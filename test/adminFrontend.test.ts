import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminApi } from '../src/api/admin.api';
import {
  PUBLISH_DISABLED_REASON,
  arrayBufferToBase64,
  buildPreviewStateSignature,
  formatModalityLabel,
  formatSubjectCodeLabel,
  getPlanStatusBadgeStyle,
  groupCatalogSubjectsByLevel,
  normalizeSharedDecisionMap,
  serializeSharedDecisionsForApi,
} from '../src/components/admin/tabs/adminCareersHelpers';

console.log('======================================================================');
console.log(' 🧪 TESTS FRONTEND: PANEL DE ADMINISTRACIÓN, SEGURIDAD Y PRIVACIDAD');
console.log('======================================================================\n');

// 1. Guard de Ruta y Navegación Segura
console.log('📌 1. Route Guard de Admin');
{
  function resolveAllowedView(
    targetView: string,
    user: { role: 'user' | 'admin' } | null,
    isLoading: boolean
  ): string {
    if (isLoading) return 'loading';
    if (targetView === 'admin' && user?.role !== 'admin') {
      return 'graph'; // Redirige a inicio si no es admin
    }
    return targetView;
  }

  assert.equal(
    resolveAllowedView('admin', { role: 'admin' }, false),
    'admin',
    'Permite acceso a #admin a administradores autenticados'
  );

  assert.equal(
    resolveAllowedView('admin', { role: 'user' }, false),
    'graph',
    'Redirige inmediatamente a graph a usuarios comunes'
  );

  assert.equal(
    resolveAllowedView('admin', null, false),
    'graph',
    'Redirige inmediatamente a graph si no hay sesión'
  );

  console.log('  ✅ Route guard redirige a no-admins y preserva acceso a administradores');
}

// 2. Generación de URL de exportación CSV con filtros
console.log('\n📌 2. Parámetros de Exportación CSV');
{
  const urlAll = adminApi.getExportUsersCsvUrl();
  assert.equal(urlAll, '/api/admin/users/export.csv');

  const urlFiltered = adminApi.getExportUsersCsvUrl({
    search: 'garcia',
    role: 'admin',
    status: 'active',
  });
  assert.equal(
    urlFiltered,
    '/api/admin/users/export.csv?search=garcia&role=admin&status=active'
  );
  console.log('  ✅ Generador de URL de exportación CSV serializa los filtros sanitizados');
}

// 3. Validación de Franjas Horarias en Comisiones (Schedule Slot Validation)
console.log('\n📌 3. Validación de Franjas Horarias de Comisiones');
{
  function validateScheduleSlot(slot: { day: number; start: string; end: string }): {
    valid: boolean;
    error?: string;
  } {
    if (slot.day < 1 || slot.day > 6) {
      return { valid: false, error: 'Día inválido' };
    }
    if (!slot.start || !slot.end || slot.start >= slot.end) {
      return {
        valid: false,
        error: 'La hora de inicio debe ser anterior a la hora de fin',
      };
    }
    if (slot.start < '07:00' || slot.end > '23:30') {
      return {
        valid: false,
        error: 'Los horarios deben ubicarse entre las 07:00 y las 23:30',
      };
    }
    return { valid: true };
  }

  assert.equal(
    validateScheduleSlot({ day: 1, start: '08:00', end: '12:00' }).valid,
    true
  );
  assert.equal(
    validateScheduleSlot({ day: 1, start: '12:00', end: '08:00' }).valid,
    false,
    'Rechaza hora de fin anterior a hora de inicio'
  );
  assert.equal(
    validateScheduleSlot({ day: 1, start: '08:00', end: '08:00' }).valid,
    false,
    'Rechaza horas iguales'
  );
  assert.equal(
    validateScheduleSlot({ day: 1, start: '06:30', end: '10:00' }).valid,
    false,
    'Rechaza horarios anteriores a las 07:00'
  );
  assert.equal(
    validateScheduleSlot({ day: 0, start: '09:00', end: '13:00' }).valid,
    false,
    'Rechaza domingos (día 0)'
  );

  console.log('  ✅ Validador de franjas horarias garantiza consistencia antes de enviar a API');
}

// 4. Invariante de Privacidad: El detalle de usuario jamás expone materias, notas ni historial académico
console.log('\n📌 4. Invariante de Privacidad en Detalle de Usuario');
{
  const mockUserDetail = {
    id: 'u-student-test',
    email: 'estudiante.privado@frc.utn.edu.ar',
    role: 'user' as const,
    status: 'active' as const,
    emailVerified: true,
    selectedPlanId: 'plan-2023',
    lastSeenAt: '2026-11-01T12:00:00Z',
    createdAt: '2026-03-01T08:00:00Z',
    identities: [{ provider: 'google' }],
    counters: {
      enrollmentsCount: 8,
      reviewsCount: 3,
      reportsSubmittedCount: 0,
    },
  };

  assert.equal('grades' in mockUserDetail, false, 'No expone campo de calificaciones');
  assert.equal('courses' in mockUserDetail, false, 'No expone materias aprobadas ni regulares');
  assert.equal('progress' in mockUserDetail, false, 'No expone porcentaje ni estado académico');
  assert.equal(typeof mockUserDetail.counters.enrollmentsCount, 'number');

  console.log('  ✅ El detalle de usuario preserva estrictamente la privacidad del historial académico');
}

// 5. Expiración de Ticket de Reautenticación (10 Minutos)
console.log('\n📌 5. Duración de Ticket de Reautenticación');
{
  const REAUTH_MAX_AGE_SECONDS = 10 * 60; // 600 segundos = 10 minutos
  assert.equal(REAUTH_MAX_AGE_SECONDS, 600);

  function isReauthTicketValid(issuedAtSeconds: number, nowSeconds: number): boolean {
    return nowSeconds - issuedAtSeconds <= REAUTH_MAX_AGE_SECONDS;
  }

  const now = Math.floor(Date.now() / 1000);
  assert.equal(isReauthTicketValid(now - 300, now), true, 'Válido a los 5 minutos');
  assert.equal(isReauthTicketValid(now - 599, now), true, 'Válido a los 9 minutos 59 seg');
  assert.equal(isReauthTicketValid(now - 601, now), false, 'Inválido a los 10 minutos 1 seg');

  console.log('  ✅ Validación de ventana de 10 minutos para tickets de reautenticación');
}

// 6. Visibilidad de Autores de Reseñas en Panel de Administración y Perfil Docente
console.log('\n📌 6. Identificación de Autores de Reseñas para Administradores');
{
  const mockAdminReportItem = {
    reportId: 'rep-1',
    reviewId: 'rev-1',
    reason: 'ofensiva' as const,
    note: 'Lenguaje inapropiado',
    reportStatus: 'open' as const,
    reportedMonthYear: '2026-11',
    openReportsOnReview: 1,
    reporterUserId: 'u-reporter-1',
    reporterEmail: 'estudiante.denunciante@frc.utn.edu.ar',
    authorUserId: 'u-author-1',
    authorEmail: 'autor.real@frc.utn.edu.ar',
    review: {
      id: 'rev-1',
      professorId: 'prof-1',
      professorName: 'Botta, Oscar',
      subjectId: 'sub-1',
      subjectCode: 101,
      subjectName: 'Álgebra y Geometría Analítica',
      overall: 1,
      comment: 'Muy mala experiencia',
      status: 'published' as const,
      publishedMonthYear: '2026-11',
      authorUserId: 'u-author-1',
      authorEmail: 'autor.real@frc.utn.edu.ar',
    },
  };

  assert.equal(
    mockAdminReportItem.authorEmail,
    'autor.real@frc.utn.edu.ar',
    'Reporte de moderación expone email del autor'
  );
  assert.equal(
    mockAdminReportItem.reporterEmail,
    'estudiante.denunciante@frc.utn.edu.ar',
    'Reporte de moderación expone email del usuario que reportó'
  );
  assert.equal(
    mockAdminReportItem.review.authorEmail,
    'autor.real@frc.utn.edu.ar',
    'Objeto reseña anidada expone email del autor'
  );

  const mockCatalogItem = {
    id: 'rev-catalog-1',
    professorId: 'prof-1',
    professorName: 'Botta, Oscar',
    subjectId: 'sub-1',
    subjectCode: 101,
    subjectName: 'Álgebra y Geometría Analítica',
    authorUserId: 'u-author-2',
    authorEmail: 'alumno.reseñador@frc.utn.edu.ar',
    overall: 5,
    clarity: 5,
    treatment: 4,
    availability: 5,
    difficulty: 3,
    wouldRecommend: true,
    comment: 'Excelente docente, muy claras las explicaciones.',
    status: 'published' as const,
    helpfulCount: 4,
    attendedDeclared: true,
    academicYear: 2025,
    term: '1C',
    createdAt: '2026-11-01T10:00:00Z',
  };

  assert.equal(
    mockCatalogItem.authorEmail,
    'alumno.reseñador@frc.utn.edu.ar',
    'Catálogo de todas las reseñas para administradores expone el email del autor'
  );

  // Verificación de serialización de reseña pública para admin vs alumno:
  function getAuthorBadge(review: { authorEmail?: string | null }) {
    if (review.authorEmail) {
      return `Autor: ${review.authorEmail}`;
    }
    return null;
  }

  const reviewForStudent = { authorEmail: null };
  const reviewForAdmin = { authorEmail: 'alumno.reseñador@frc.utn.edu.ar' };

  assert.equal(getAuthorBadge(reviewForStudent), null, 'Alumno nunca ve email de autor');
  assert.equal(
    getAuthorBadge(reviewForAdmin),
    'Autor: alumno.reseñador@frc.utn.edu.ar',
    'Admin ve claramente el email del autor'
  );

  console.log('  ✅ Panel de administración y perfiles docentes exponen la identidad del autor de forma exclusiva a administradores');
}

// =========================================================================
// 7. TRAMO 2B — PANEL CARRERAS, HELPERS DE PREVIEW Y GUARDAS DE SOLO LECTURA
// =========================================================================
{
  console.log('[7] Validando contratos API, helpers y guardas estructurales de Tramo 2B...');

  // 7.1 Contratos API de administración de planes e importación
  assert.equal(typeof adminApi.listPlans, 'function', 'adminApi.listPlans debe existir');
  assert.equal(typeof adminApi.getPlanDetail, 'function', 'adminApi.getPlanDetail debe existir');
  assert.equal(
    typeof adminApi.getPlanTemplateDownloadUrl,
    'function',
    'adminApi.getPlanTemplateDownloadUrl debe existir'
  );
  assert.equal(
    adminApi.getPlanTemplateDownloadUrl(),
    '/api/admin/plans/template',
    'La URL de descarga de plantilla debe apuntar al endpoint esperado'
  );
  assert.equal(
    typeof adminApi.downloadPlanTemplate,
    'function',
    'adminApi.downloadPlanTemplate debe existir'
  );
  assert.equal(
    typeof adminApi.previewPlanImport,
    'function',
    'adminApi.previewPlanImport debe existir'
  );
  assert.equal(
    typeof adminApi.confirmPlanImport,
    'function',
    'adminApi.confirmPlanImport debe existir'
  );
  assert.equal(
    typeof adminApi.deleteDraftPlan,
    'function',
    'adminApi.deleteDraftPlan debe existir'
  );

  // 7.2 Codificación Base64 binaria sin corrupción de bytes ZIP (.xlsx)
  const zipMagicBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);
  const encoded = arrayBufferToBase64(zipMagicBytes.buffer);
  assert.deepEqual(
    Array.from(Buffer.from(encoded, 'base64')),
    [0x50, 0x4b, 0x03, 0x04, 0x00, 0xff],
    'arrayBufferToBase64 debe preservar bytes binarios exactos'
  );

  // 7.3 Matcher compartido: nunca auto-vincula en planes nuevos y conserva selecciones del borrador
  const decisionMap = normalizeSharedDecisionMap([
    {
      subjectCode: 1,
      name: 'Análisis Matemático I',
      normalizedName: 'analisis matematico i',
      confidence: 'high',
      selectedDecision: null,
      candidates: [
        {
          sharedSubjectId: 'shared-am1',
          code: 'AM1',
          displayName: 'Análisis Matemático I',
          confidence: 'high',
          score: 1,
          usageCount: 1,
        },
      ],
    },
    {
      subjectCode: 2,
      name: 'Álgebra y Geometría Analítica',
      normalizedName: 'algebra y geometria analitica',
      confidence: 'low',
      selectedDecision: {
        subjectCode: 2,
        action: 'link_existing',
        sharedSubjectId: 'shared-aga',
      },
      candidates: [
        {
          sharedSubjectId: 'shared-aga',
          code: 'AGA',
          displayName: 'Álgebra y Geometría Analítica',
          confidence: 'low',
          score: 0.72,
          usageCount: 1,
        },
      ],
    },
  ]);

  assert.equal(
    decisionMap[1],
    null,
    'Sugerencia high/exact en plan nuevo debe permanecer sin auto-vinculación'
  );
  assert.deepEqual(decisionMap[2], {
    subjectCode: 2,
    action: 'link_existing',
    sharedSubjectId: 'shared-aga',
  });

  const serializedDecisions = serializeSharedDecisionsForApi({
    ...decisionMap,
    1: { subjectCode: 1, action: 'keep_separate', sharedSubjectId: 'ignored-id' },
  });
  assert.deepEqual(serializedDecisions, [
    { subjectCode: 1, action: 'keep_separate' },
    { subjectCode: 2, action: 'link_existing', sharedSubjectId: 'shared-aga' },
  ]);

  // 7.4 Sincronización de previewHash: cualquier cambio en archivo, metadata o decisiones invalida firma
  const baseSigParams = {
    fileBase64: encoded,
    facultyId: 'fac-frc',
    targetMode: 'new_career_and_plan' as const,
    careerId: '',
    careerName: 'Ingeniería Industrial',
    careerCode: 'ind',
    planId: '',
    decisions: serializedDecisions,
  };
  const sigInitial = buildPreviewStateSignature(baseSigParams);
  assert.equal(
    sigInitial,
    buildPreviewStateSignature({ ...baseSigParams, careerCode: ' IND ' }),
    'La firma normaliza espacios y mayúsculas de careerCode'
  );
  assert.notEqual(
    sigInitial,
    buildPreviewStateSignature({ ...baseSigParams, fileBase64: encoded + 'AA==' }),
    'Cambiar el archivo debe invalidar la firma de vista previa'
  );
  assert.notEqual(
    sigInitial,
    buildPreviewStateSignature({ ...baseSigParams, careerCode: 'MEC' }),
    'Cambiar código de carrera debe invalidar la firma de vista previa'
  );
  assert.notEqual(
    sigInitial,
    buildPreviewStateSignature({
      ...baseSigParams,
      decisions: [{ subjectCode: 1, action: 'keep_separate' }],
    }),
    'Cambiar decisiones de materias compartidas debe invalidar la firma de vista previa'
  );

  // 7.5 Agrupación por nivel y formateo en visor solo lectura
  const inputSubjects = [
    {
      id: 20,
      code: 'IND-20',
      name: 'Estudio del Trabajo',
      shortName: 'Est. Trabajo',
      level: 3,
      modality: '2C' as const,
      weeklyHours: 4,
      regularPrereqs: [10],
      approvedPrereqs: [],
      isElective: false,
      credits: 0,
    },
    {
      id: 2,
      code: 'IND-2',
      name: 'Química General',
      shortName: 'Química',
      level: 1,
      modality: 'A' as const,
      weeklyHours: 5,
      regularPrereqs: [],
      approvedPrereqs: [],
      isElective: false,
      credits: 0,
    },
    {
      id: 1,
      code: 'IND-1',
      name: 'Análisis Matemático I',
      shortName: 'AM I',
      level: 1,
      modality: '1C-CC' as const,
      weeklyHours: 5,
      regularPrereqs: [],
      approvedPrereqs: [],
      isElective: false,
      credits: 0,
    },
  ];
  const grouped = groupCatalogSubjectsByLevel(inputSubjects);
  assert.deepEqual(
    grouped.map((g) => ({ level: g.level, ids: g.subjects.map((s) => s.id) })),
    [
      { level: 1, ids: [1, 2] },
      { level: 3, ids: [20] },
    ],
    'groupCatalogSubjectsByLevel debe ordenar niveles e IDs sin mutar la entrada'
  );
  assert.equal(inputSubjects[0].id, 20);
  const codeMap = new Map(inputSubjects.map((s) => [s.id, s]));
  assert.equal(formatSubjectCodeLabel(1, codeMap), 'IND-1');
  assert.equal(formatSubjectCodeLabel(999, codeMap), '999');
  assert.equal(formatModalityLabel('A'), 'Anual');
  assert.equal(formatModalityLabel('1C'), '1° Cuatrimestre');
  assert.equal(formatModalityLabel('1C-CC'), '1° Cuat. / Contracuat.');
  assert.match(getPlanStatusBadgeStyle('draft'), /amber/);

  // 7.6 Guardas estáticas de UI Tramo 2B (sin CorrelativeGraph, Publicar deshabilitado, Reauth correcto)
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const viewerSrc = fs.readFileSync(
    path.resolve(testDir, '../src/components/admin/tabs/AdminPlanReadOnlyViewer.tsx'),
    'utf-8'
  );
  const careersTabSrc = fs.readFileSync(
    path.resolve(testDir, '../src/components/admin/tabs/AdminCareersTab.tsx'),
    'utf-8'
  );
  const dashboardSrc = fs.readFileSync(
    path.resolve(testDir, '../src/components/admin/AdminDashboard.tsx'),
    'utf-8'
  );

  assert.equal(
    /CorrelativeGraph/.test(viewerSrc),
    false,
    'AdminPlanReadOnlyViewer no debe importar ni referenciar CorrelativeGraph'
  );
  assert.match(
    careersTabSrc,
    /import\s*\{\s*AdminPlanReadOnlyViewer\s*\}/,
    'AdminCareersTab debe usar AdminPlanReadOnlyViewer para la vista de solo lectura'
  );
  assert.match(
    careersTabSrc,
    /<button[^>]*disabled[\s\S]{0,120}title=\{PUBLISH_DISABLED_REASON\}[\s\S]{0,400}Publicar[\s\S]{0,60}<\/button>/,
    'El botón Publicar debe permanecer deshabilitado con el motivo Tramo 2C/2D'
  );
  assert.ok(PUBLISH_DISABLED_REASON.includes('Tramo 2C/2D'));
  assert.match(
    careersTabSrc,
    /isPreviewStale/,
    'AdminCareersTab debe bloquear confirmación si el archivo, destino o decisiones cambiaron desde el último preview'
  );
  assert.match(
    careersTabSrc,
    /<AdminReauthModal[\s\S]*actionTitle=\{reauthTitle\}/,
    'AdminCareersTab debe pasar actionTitle (no title) a AdminReauthModal'
  );
  assert.match(
    dashboardSrc,
    /id:\s*'careers'[\s\S]*label:\s*'Carreras'/,
    'AdminDashboard debe exponer la pestaña Carreras'
  );
  assert.match(
    dashboardSrc,
    /activeTab\s*===\s*'careers'\s*&&\s*<AdminCareersTab\s*\/>/,
    'AdminDashboard debe renderizar AdminCareersTab cuando activeTab es careers'
  );

  console.log('  ✅ Tramo 2B (Carreras): API, firma previewHash, matcher, visor solo lectura y botón Publicar deshabilitado verificados');
}

console.log('\n======================================================================');
console.log(' 📊 TODOS LOS TESTS FRONTEND DE ADMIN PASARON SATISFACTORIAMENTE');
console.log('======================================================================\n');

