// Configurar entorno aislado en memoria ANTES de importar módulos del servidor (CERO conexión a Neon)
import './setupTestEnv.js';

import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import { LIBRARY_CONFIG } from '../src/config/library.config.js';
import { createApp } from '../src/app.js';
import {
  setLiveUserResolverForTesting,
  type LiveUserStatusRecord,
} from '../src/middlewares/auth.middleware.js';
import {
  InMemoryCatalogStore,
  setCatalogStoreForTesting,
} from '../src/modules/catalog/catalog.store.js';
import {
  buildPendingUploaderFileItems,
  InMemoryLibraryService,
  resetInitUploadRateLimits,
  setLibraryServiceForTesting,
} from '../src/modules/library/library.service.js';
import { InMemoryReviewsStore } from '../src/modules/reviews/reviews.store.js';
import {
  extractPlanScheduleSelections,
  extractPlanSettings,
  mergePlanScheduleSelections,
  mergePlanSettings,
  resolvePlanMaxLevel,
} from '../src/modules/user-state/userState.helpers.js';
import { InMemoryUserStateStore } from '../src/modules/user-state/userState.store.js';
import { MemoryMockR2Service } from '../src/services/r2.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('======================================================================');
  console.log(' 🧪 TESTS ETAPA 1A: MULTI-CARRERA, MIGRACIÓN 0008 Y AISLAMIENTO');
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

  // ---------------------------------------------------------------------------
  // 1. VERIFICACIÓN DE MIGRACIÓN 0008 (ADITIVA, IDEMPOTENTE, SIN RIESGO A R2/DATOS)
  // ---------------------------------------------------------------------------
  console.log('📌 1. Migración 0008: Reglas aditivas, idempotencia y backfills');

  const migrationPath = path.resolve(
    __dirname,
    '../drizzle/0008_multicarrera_and_shared_subjects.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert(!/^\s*DROP\s+/im.test(sql) && !/;\s*DROP\s+/im.test(sql), '0008 es 100% aditiva (sin sentencias DROP)');
  assert(
    sql.includes('ADD COLUMN IF NOT EXISTS "status"') &&
      sql.includes("CHECK (\"status\" IN ('draft', 'published', 'archived'))"),
    'Agrega careers.status y study_plans.status con constraint de estado'
  );
  assert(
    sql.includes('CREATE TABLE IF NOT EXISTS "shared_subjects"') &&
      sql.includes('CONSTRAINT "uq_shared_subjects_faculty_code" UNIQUE ("faculty_id", "stable_code")') &&
      sql.includes('CREATE INDEX IF NOT EXISTS "idx_shared_subjects_faculty_norm"'),
    'shared_subjects usa índice único (faculty_id, stable_code) y normalized_name NO único'
  );
  assert(
    sql.includes('WHERE s."shared_subject_id" IS NULL') &&
      sql.includes('ON CONFLICT ("faculty_id", "stable_code") DO NOTHING'),
    'Backfill 1-a-1 de subjects -> shared_subjects es idempotente y nunca fusiona por nombre'
  );
  assert(
    sql.includes('ALTER TABLE "library_files" ADD COLUMN IF NOT EXISTS "shared_subject_id"') &&
      sql.includes('ALTER TABLE "library_files" ADD COLUMN IF NOT EXISTS "source_subject_id"') &&
      sql.includes('ALTER TABLE "library_files" ADD COLUMN IF NOT EXISTS "source_plan_id"') &&
      !/SET\s+"storage_key"/i.test(sql),
    'Backfill de library_files agrega columnas nuevas sin alterar storage_key'
  );
  assert(
    sql.includes('ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "plan_id"') &&
      sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_settings_user_plan"') &&
      sql.includes('ALTER TABLE "schedule_selections" ADD COLUMN IF NOT EXISTS "selections_by_plan"') &&
      sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_schedule_selection_user_plan_term"') &&
      sql.includes('ALTER TABLE "schedule_proposals" ADD COLUMN IF NOT EXISTS "plan_id"'),
    'user_settings, schedule_selections y schedule_proposals agregan scoping por plan sin DROP de PK anterior'
  );

  // Verificar que todos los bloques DO $$ ... ADD CONSTRAINT atrapen duplicate_object OR duplicate_table
  const addConstraintCount = (sql.match(/ADD\s+CONSTRAINT\s+/gi) || []).length;
  const whenClauses = Array.from(
    sql.matchAll(/EXCEPTION\s+WHEN\s+([^\n;]+?)\s+THEN\s+null;/gi),
    (m) => m[1].trim()
  );
  const allHandleBoth =
    whenClauses.length === addConstraintCount &&
    whenClauses.length === 11 &&
    whenClauses.every(
      (clause) => /\bduplicate_object\b/i.test(clause) && /\bduplicate_table\b/i.test(clause)
    );
  assert(
    allHandleBoth,
    `Todos los bloques ADD CONSTRAINT (${whenClauses.length}/${addConstraintCount}) atrapan duplicate_object OR duplicate_table`
  );

  // Simular doble corrida idempotente de 0008 (DDL UNIQUE/CHECK/FK con duplicate_object/duplicate_table + backfill 1-a-1)
  const simConstraints = new Map<string, 'unique' | 'check' | 'fk'>();
  const simSharedRows = new Map<string, { id: string; facultyId: string; stableCode: string; normalizedName: string }>();
  const simSubjects = [
    { id: 'aaaa1111-1111-4111-8111-111111111111', facultyId: 'fac-1', careerCode: 'ISI', planYear: 2023, codeInPlan: 1, name: 'Análisis Matemático I', sharedSubjectId: null as string | null },
    { id: 'bbbb2222-2222-4222-8222-222222222222', facultyId: 'fac-1', careerCode: 'IND', planYear: 2023, codeInPlan: 1, name: 'Análisis Matemático I', sharedSubjectId: null as string | null },
  ];
  const ddlBlocks = Array.from(
    sql.matchAll(
      /DO \$\$\s+BEGIN\s+ALTER TABLE "[^"]+" ADD CONSTRAINT "([^"]+)" (UNIQUE|CHECK|FOREIGN KEY)[\s\S]*?EXCEPTION\s+WHEN\s+([^\n;]+?)\s+THEN\s+null;\s+END \$\$;/gi
    )
  ).map((m) => ({
    name: m[1],
    kind: (m[2].toUpperCase() === 'UNIQUE' ? 'unique' : m[2].toUpperCase() === 'CHECK' ? 'check' : 'fk') as
      | 'unique'
      | 'check'
      | 'fk',
    catchesDuplicateObject: /\bduplicate_object\b/i.test(m[3]),
    catchesDuplicateTable: /\bduplicate_table\b/i.test(m[3]),
  }));

  function runMigration0008Sim() {
    for (const block of ddlBlocks) {
      if (simConstraints.has(block.name)) {
        // En Postgres, ADD CONSTRAINT ... UNIQUE puede lanzar duplicate_table (42P07) por el índice/relación subyacente
        const pgErrCode = block.kind === 'unique' ? 'duplicate_table' : 'duplicate_object';
        const handled =
          (pgErrCode === 'duplicate_object' && block.catchesDuplicateObject) ||
          (pgErrCode === 'duplicate_table' && block.catchesDuplicateTable);
        if (!handled) {
          throw new Error(`Constraint "${block.name}" no capturó ${pgErrCode} al re-ejecutar`);
        }
      } else {
        simConstraints.set(block.name, block.kind);
      }
    }

    for (const sub of simSubjects) {
      if (sub.sharedSubjectId !== null) continue;
      const stableCode = `${sub.careerCode}-${sub.planYear}-${sub.codeInPlan}`;
      const key = `${sub.facultyId}::${stableCode}`;
      let shared = simSharedRows.get(key);
      if (!shared) {
        shared = { id: crypto.randomUUID(), facultyId: sub.facultyId, stableCode, normalizedName: 'analisis matematico i' };
        simSharedRows.set(key, shared);
      }
      sub.sharedSubjectId = shared.id;
    }
  }
  runMigration0008Sim();
  const firstRunSharedIds = simSubjects.map((s) => s.sharedSubjectId);
  let secondRunThrew = false;
  try {
    runMigration0008Sim(); // Segunda ejecución idempotente
  } catch {
    secondRunThrew = true;
  }
  assert(
    !secondRunThrew &&
      ddlBlocks.length === 11 &&
      simConstraints.has('uq_shared_subjects_faculty_code') &&
      simSharedRows.size === 2 &&
      simSubjects[0].sharedSubjectId !== simSubjects[1].sharedSubjectId &&
      simSubjects[0].sharedSubjectId === firstRunSharedIds[0] &&
      simSubjects[1].sharedSubjectId === firstRunSharedIds[1],
    'Simulación doble corrida 0008: maneja duplicate_table/duplicate_object, no duplica filas ni une materias homónimas'
  );

  // ---------------------------------------------------------------------------
  // 2. HELPERS PUROS DE AISLAMIENTO POR PLAN (USER_SETTINGS Y SCHEDULE_SELECTIONS)
  // ---------------------------------------------------------------------------
  console.log('\n📌 2. Helpers de estado por plan: user_settings y schedule_selections');

  const hPlanA = crypto.randomUUID();
  const hPlanB = crypto.randomUUID();
  const legacySettings = {
    planId: null,
    includePromotionsInGPA: false,
    minPassingGrade: 6,
    includeAnalistaTrack: false,
    allowBlockedElectivesPlanning: false,
    includeElectivesInProgress: true,
    soundEnabled: false,
    tutorialCompleted: true,
    notifyLibraryEmail: true,
    extraSettings: {},
  };

  // Migrar configuración legada al editar Plan A, luego editar Plan B, y releer Plan A
  const mergedA = mergePlanSettings(legacySettings, hPlanA, { includeAnalistaTrack: true, minPassingGrade: 6 });
  const mergedAB = mergePlanSettings(mergedA, hPlanB, { includeAnalistaTrack: false, minPassingGrade: 4 });
  const readBackA = extractPlanSettings(mergedAB, hPlanA);
  const readBackB = extractPlanSettings(mergedAB, hPlanB);
  assert(
    readBackA.includeAnalistaTrack === true &&
      readBackA.minPassingGrade === 6 &&
      readBackB.includeAnalistaTrack === false &&
      readBackB.minPassingGrade === 4,
    'userState.helpers preserva settings independientes al alternar Plan A -> Plan B -> Plan A'
  );

  const legacySelection = {
    planId: null,
    selections: { '1': '1K1' },
    selectionsByPlan: {},
  };
  const selA = mergePlanScheduleSelections(legacySelection, hPlanA, { '1': '1K1', '2': '1K2' });
  const selAB = mergePlanScheduleSelections(selA, hPlanB, { '1': '2B1' });
  const readSelA = extractPlanScheduleSelections(selAB, hPlanA);
  const readSelB = extractPlanScheduleSelections(selAB, hPlanB);
  assert(
    readSelA['1'] === '1K1' && readSelA['2'] === '1K2' && readSelB['1'] === '2B1' && !readSelB['2'],
    'userState.helpers preserva selecciones de horarios por plan sin sobrescribir el otro plan'
  );

  // ---------------------------------------------------------------------------
  // 3. ENTORNO HTTP MULTI-PLAN EN MEMORIA (PLAN A, PLAN B, BIBLIOTECA COMPARTIDA)
  // ---------------------------------------------------------------------------
  console.log('\n📌 3. Configurando app Express con dos facultades y tres carreras/planes');

  resetInitUploadRateLimits();
  const mockR2 = new MemoryMockR2Service();
  const libraryStore = new InMemoryLibraryService(mockR2);
  setLibraryServiceForTesting(libraryStore);

  const reviewsStore = new InMemoryReviewsStore();
  const userStateStore = new InMemoryUserStateStore();
  const catalogStore = new InMemoryCatalogStore();
  setCatalogStoreForTesting(catalogStore);

  const instId = crypto.randomUUID();
  const facA = crypto.randomUUID();
  const facB = crypto.randomUUID();
  const careerDraftId = crypto.randomUUID();
  const careerAId = crypto.randomUUID();
  const careerBId = crypto.randomUUID();
  const careerA2Id = crypto.randomUUID();
  const planA = crypto.randomUUID();
  const planB = crypto.randomUUID();
  const planA2 = crypto.randomUUID(); // Segunda carrera en Facultad A (comparte materia con Plan A)

  catalogStore.institutions.push({ id: instId, name: 'UTN', code: 'UTN' });
  catalogStore.faculties.push(
    { id: facA, institutionId: instId, name: 'FRC', code: 'FRC' },
    { id: facB, institutionId: instId, name: 'FRBA', code: 'FRBA' }
  );
  catalogStore.careers.push(
    { id: careerDraftId, facultyId: facA, name: 'Borrador', code: 'DRAFT', status: 'published' },
    { id: careerAId, facultyId: facA, name: 'Ingeniería en Sistemas', code: 'ISI', status: 'published' },
    { id: careerBId, facultyId: facB, name: 'Ingeniería Industrial', code: 'IND', status: 'published' },
    { id: careerA2Id, facultyId: facA, name: 'Ingeniería Electrónica', code: 'IEL', status: 'published' }
  );
  catalogStore.plans.push(
    {
      id: planA,
      careerId: careerAId,
      name: 'Sistemas Plan 2023',
      year: 2023,
      status: 'published',
      isActive: true,
      config: {},
      createdAt: new Date('2024-02-01T00:00:00Z'),
      updatedAt: new Date('2024-02-01T00:00:00Z'),
    },
    {
      id: planB,
      careerId: careerBId,
      name: 'Industrial Plan 2024',
      year: 2024,
      status: 'published',
      isActive: true,
      config: {},
      createdAt: new Date('2024-03-01T00:00:00Z'),
      updatedAt: new Date('2024-03-01T00:00:00Z'),
    },
    {
      id: planA2,
      careerId: careerA2Id,
      name: 'Electrónica Plan 2023',
      year: 2023,
      status: 'published',
      isActive: true,
      config: {},
      createdAt: new Date('2024-04-01T00:00:00Z'),
      updatedAt: new Date('2024-04-01T00:00:00Z'),
    }
  );

  // Sembrar planes en stores
  reviewsStore.seedPlan(planA, facA);
  reviewsStore.seedPlan(planB, facB);
  reviewsStore.seedPlan(planA2, facA);
  userStateStore.seedPlan({ id: planA, name: 'Sistemas Plan 2023', facultyId: facA });
  userStateStore.seedPlan({ id: planB, name: 'Industrial Plan 2024', facultyId: facB });
  userStateStore.seedPlan({ id: planA2, name: 'Electrónica Plan 2023', facultyId: facA });

  // Sembrar períodos lectivos por facultad
  const termA = userStateStore.seedTerm({
    id: crypto.randomUUID(),
    facultyId: facA,
    academicYear: 2026,
    term: '1C',
    isCurrent: true,
  });
  const termB = userStateStore.seedTerm({
    id: crypto.randomUUID(),
    facultyId: facB,
    academicYear: 2026,
    term: '1C',
    isCurrent: true,
  });

  // Sembrar materias con códigos numéricos superpuestos (101 en ambos planes) + shared_subject entre Plan A y Plan B
  const sharedAlgebraId = crypto.randomUUID();
  const subA_core = reviewsStore.seedSubject({
    id: crypto.randomUUID(),
    planId: planA,
    codeInPlan: 101,
    name: 'Álgebra y Geometría Analítica (ISI)',
    level: 1,
    kind: 'obligatoria',
  });
  const subA_elec1 = reviewsStore.seedSubject({
    id: crypto.randomUUID(),
    planId: planA,
    codeInPlan: 102,
    name: 'Electiva Cloud Computing',
    level: 4,
    kind: 'electiva',
  });
  const subA_elec2 = reviewsStore.seedSubject({
    id: crypto.randomUUID(),
    planId: planA,
    codeInPlan: 103,
    name: 'Electiva Visión Artificial',
    level: 5,
    kind: 'electiva',
  });
  const subB_core = reviewsStore.seedSubject({
    id: crypto.randomUUID(),
    planId: planB,
    codeInPlan: 101,
    name: 'Álgebra Lineal (IND)',
    level: 1,
    kind: 'obligatoria',
  });
  const subB_elec1 = reviewsStore.seedSubject({
    id: crypto.randomUUID(),
    planId: planB,
    codeInPlan: 201,
    name: 'Electiva Logística Industrial',
    level: 4,
    kind: 'electiva',
  });
  const subB_only = reviewsStore.seedSubject({
    id: crypto.randomUUID(),
    planId: planB,
    codeInPlan: 202,
    name: 'Investigación Operativa Exclusiva B',
    level: 4,
    kind: 'obligatoria',
  });

  // Espejar materias en UserStateStore
  userStateStore.seedSubject({ id: subA_core.id, planId: planA, codeInPlan: 101, kind: 'obligatoria' });
  userStateStore.seedSubject({ id: subA_elec1.id, planId: planA, codeInPlan: 102, kind: 'electiva' });
  userStateStore.seedSubject({ id: subA_elec2.id, planId: planA, codeInPlan: 103, kind: 'electiva' });
  userStateStore.seedSubject({ id: subB_core.id, planId: planB, codeInPlan: 101, kind: 'obligatoria' });
  userStateStore.seedSubject({ id: subB_elec1.id, planId: planB, codeInPlan: 201, kind: 'electiva' });
  userStateStore.seedSubject({ id: subB_only.id, planId: planB, codeInPlan: 202, kind: 'obligatoria' });

  // Espejar materias en LibraryStore (subA_core y subB_core comparten sharedAlgebraId; subB_only es exclusivo de Plan B)
  libraryStore.seedSubject({
    id: subA_core.id,
    name: subA_core.name,
    codeInPlan: 101,
    level: 1,
    kind: 'obligatoria',
    planId: planA,
    sharedSubjectId: sharedAlgebraId,
  });
  libraryStore.seedSubject({
    id: subB_core.id,
    name: subB_core.name,
    codeInPlan: 101,
    level: 1,
    kind: 'obligatoria',
    planId: planB,
    sharedSubjectId: sharedAlgebraId,
  });
  libraryStore.seedSubject({
    id: subB_only.id,
    name: subB_only.name,
    codeInPlan: 202,
    level: 4,
    kind: 'obligatoria',
    planId: planB,
    sharedSubjectId: crypto.randomUUID(),
  });

  // Sembrar docentes y comisiones en Plan A (Facultad A) y Plan B (Facultad B)
  const profA = await reviewsStore.createOrResolveProfessor({
    facultyId: facA,
    displayName: 'Docente Sistemas, Ana',
  });
  const profB = await reviewsStore.createOrResolveProfessor({
    facultyId: facB,
    displayName: 'Docente Industrial, Bruno',
  });
  const commA = reviewsStore.seedCommission({
    subjectId: subA_core.id,
    commissionCode: '1K1',
    academicYear: 2026,
    term: '1C',
  });
  const commB = reviewsStore.seedCommission({
    subjectId: subB_core.id,
    commissionCode: '1D1',
    academicYear: 2026,
    term: '1C',
  });
  reviewsStore.seedCommissionTeaching({
    professorId: profA.id,
    subjectId: subA_core.id,
    commissionCode: '1K1',
    termLabel: '2026 1C',
    isCurrent: true,
  });
  reviewsStore.seedCommissionTeaching({
    professorId: profB.id,
    subjectId: subB_core.id,
    commissionCode: '1D1',
    termLabel: '2026 1C',
    isCurrent: true,
  });

  // Sembrar usuarios
  const multiUserId = crypto.randomUUID();
  const studentBOnlyId = crypto.randomUUID();
  const authorBId = crypto.randomUUID();
  const quotaUserId = crypto.randomUUID();
  const pendingQuotaUserId = crypto.randomUUID();
  const adminId = crypto.randomUUID();

  const liveUsers = new Map<string, LiveUserStatusRecord>();
  function setUserPlanInAllStores(userId: string, selectedPlanId: string | null) {
    const curr = liveUsers.get(userId);
    if (curr) {
      liveUsers.set(userId, { ...curr, selectedPlanId });
    }
    userStateStore.seedUser(userId, selectedPlanId);
    reviewsStore.seedUserPlan(userId, selectedPlanId);
  }

  function registerUser(params: {
    id: string;
    email: string;
    role: 'user' | 'admin';
    selectedPlanId: string | null;
  }) {
    liveUsers.set(params.id, {
      id: params.id,
      email: params.email,
      role: params.role,
      status: 'active',
      emailVerified: true,
      selectedPlanId: params.selectedPlanId,
    });
    libraryStore.seedUser({
      id: params.id,
      email: params.email,
      role: params.role,
      emailVerified: true,
      termsAccepted: true,
    });
    userStateStore.seedUser(params.id, params.selectedPlanId);
    reviewsStore.seedUserPlan(params.id, params.selectedPlanId);
  }

  registerUser({ id: multiUserId, email: 'multi@frc.utn.edu.ar', role: 'user', selectedPlanId: planA });
  registerUser({ id: studentBOnlyId, email: 'alumnob@frc.utn.edu.ar', role: 'user', selectedPlanId: planB });
  registerUser({ id: authorBId, email: 'autorb@frc.utn.edu.ar', role: 'user', selectedPlanId: planB });
  registerUser({ id: quotaUserId, email: 'cuota.cross@frc.utn.edu.ar', role: 'user', selectedPlanId: planA });
  registerUser({ id: pendingQuotaUserId, email: 'pendiente.cross@frc.utn.edu.ar', role: 'user', selectedPlanId: planA });
  registerUser({ id: adminId, email: 'admin.multi@stack.com', role: 'admin', selectedPlanId: planA });

  setLiveUserResolverForTesting(async (userId: string) => liveUsers.get(userId) || null);

  function signUserToken(userId: string) {
    const u = liveUsers.get(userId)!;
    return jwt.sign(
      {
        id: u.id,
        email: u.email,
        role: u.role,
        emailVerified: true,
        selectedPlanId: u.selectedPlanId,
      },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  const app = createApp({ reviewsStore, userStateStore });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  async function api(method: string, reqPath: string, token?: string, body?: any) {
    return new Promise<{ status: number; data: any }>((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (payload) headers['Content-Length'] = Buffer.byteLength(payload).toString();

      const req = http.request(
        { hostname: '127.0.0.1', port, path: reqPath, method, headers },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            let parsed: any = raw;
            try {
              parsed = JSON.parse(raw);
            } catch {
              // raw text fallback
            }
            resolve({ status: res.statusCode || 500, data: parsed });
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  const multiToken = signUserToken(multiUserId);
  const studentBToken = signUserToken(studentBOnlyId);
  const quotaToken = signUserToken(quotaUserId);
  const pendingToken = signUserToken(pendingQuotaUserId);
  const adminToken = signUserToken(adminId);

  try {
    // -------------------------------------------------------------------------
    // 4. AISLAMIENTO USER-STATE ENTRE PLAN A Y PLAN B
    // -------------------------------------------------------------------------
    console.log('\n📌 4. Aislamiento de UserState (progreso, electivas, canasta, horarios, import)');

    // 4.1 Guardar estado completo en Plan A
    const putProgA = await api('PUT', `/api/progress/${subA_core.id}`, multiToken, {
      status: 'aprobada',
      grade: 9,
    });
    const putElecA = await api('PUT', '/api/electives', multiToken, {
      assignedElectives: { 3: [102] },
    });
    const putBasketA = await api('PUT', '/api/basket', multiToken, {
      basket: [103],
    });
    const putSettingsA = await api('PUT', '/api/settings', multiToken, {
      includeAnalistaTrack: true,
      minPassingGrade: 6,
      tutorialCompleted: true,
    });
    const putSelA = await api('PUT', '/api/schedule/selections', multiToken, {
      selections: { '101': '1K1' },
    });
    const postPropA = await api('POST', '/api/schedule/proposals', multiToken, {
      name: 'Propuesta Plan A',
      selections: { '101': '1K1' },
    });
    const postExamA = await api('POST', '/api/exam-attempts', multiToken, {
      subjectIdOrCode: subA_core.id,
      date: '2026-07-10',
      grade: 9,
      notes: 'Final A',
    });

    assert(
      putProgA.status === 200 &&
        putElecA.status === 200 &&
        putBasketA.status === 200 &&
        putSettingsA.status === 200 &&
        putSelA.status === 200 &&
        postPropA.status === 201 &&
        postExamA.status === 200,
      'Guardar estado completo en Plan A responde con éxito'
    );

    const proposalAId = postPropA.data?.data?.id as string;
    const examAId = postExamA.data?.data?.id as string;

    // Sembrar progreso en Plan A en reviewsStore para pruebas de reviewable
    reviewsStore.seedUserProgress(multiUserId, subA_core.id, 'aprobada', 9);
    // Sembrar también una cursada y una reseña en Plan B (authorBId y multiUserId)
    reviewsStore.seedUserProgress(authorBId, subB_core.id, 'aprobada', 8);
    const revB = await reviewsStore.createReview({
      userId: authorBId,
      professorId: profB.id,
      subjectId: subB_core.id,
      academicYear: 2025,
      term: '1C',
      overall: 5,
      clarity: null,
      treatment: null,
      availability: null,
      difficulty: null,
      wouldRecommend: true,
      comment: 'Excelente en Industrial.',
    });
    const revBId = revB.id;
    const enrB = await reviewsStore.saveUserEnrollment({
      userId: multiUserId,
      subjectId: subB_core.id,
      commissionId: commB.id,
      academicYear: 2025,
      term: '1C',
      source: 'manual',
      professorIds: [profB.id],
    });

    // 4.2 Cambiar al usuario activo a Plan B y validar ?planId= ignorado + 404 cruzados
    setUserPlanInAllStores(multiUserId, planB);

    const stateWhileBIgnoringQuery = await api('GET', `/api/state?planId=${planA}`, multiToken);
    const propsWhileBIgnoringQuery = await api('GET', `/api/schedule/proposals?planId=${planA}`, multiToken);
    assert(
      stateWhileBIgnoringQuery.status === 200 &&
        stateWhileBIgnoringQuery.data.data.selectedPlanId === planB &&
        Object.keys(stateWhileBIgnoringQuery.data.data.progress).length === 0 &&
        stateWhileBIgnoringQuery.data.data.assignedElectives['3'].length === 0 &&
        stateWhileBIgnoringQuery.data.data.basket.length === 0 &&
        Object.keys(stateWhileBIgnoringQuery.data.data.scheduleSelections).length === 0 &&
        stateWhileBIgnoringQuery.data.data.scheduleProposals.length === 0 &&
        stateWhileBIgnoringQuery.data.data.examAttempts.length === 0 &&
        propsWhileBIgnoringQuery.data.data.length === 0,
      'Al estar en Plan B, ?planId=PlanA es ignorado y no filtra ningún dato de Plan A'
    );

    const crossProg404 = await api('PUT', `/api/progress/${subA_core.id}`, multiToken, { status: 'aprobada', grade: 7 });
    const crossExamCreate404 = await api('POST', '/api/exam-attempts', multiToken, {
      subjectIdOrCode: subA_core.id,
      date: '2026-07-11',
      grade: 8,
    });
    const crossExamDel404 = await api('DELETE', `/api/exam-attempts/${examAId}`, multiToken);
    const crossTermProp404 = await api('POST', '/api/schedule/proposals', multiToken, {
      name: 'Intento cruzado',
      scheduleTermId: termA.id,
      selections: { '101': '1K1' },
    });
    const crossTermSel404 = await api('PUT', '/api/schedule/selections', multiToken, {
      scheduleTermId: termA.id,
      selections: { '101': '1K1' },
    });
    const crossUpdateProp404 = await api('POST', '/api/schedule/proposals', multiToken, {
      id: proposalAId,
      name: 'Sobrescritura ilegal',
      selections: { '101': '1D1' },
    });
    const crossDelProp404 = await api('DELETE', `/api/schedule/proposals/${proposalAId}`, multiToken);

    assert(
      crossProg404.status === 404 &&
        crossExamCreate404.status === 404 &&
        crossExamDel404.status === 404 &&
        crossTermProp404.status === 404 &&
        crossTermSel404.status === 404 &&
        crossUpdateProp404.status === 404 &&
        crossDelProp404.status === 404,
      'IDs ajenos de materia, período lectivo, propuesta y examen devuelven 404 en otro plan'
    );

    // 4.3 Mutar electivas, canasta, settings, horarios e importData en Plan B
    const putElecB = await api('PUT', '/api/electives', multiToken, { assignedElectives: { 4: [201] } });
    const putBasketB = await api('PUT', '/api/basket', multiToken, { basket: [201] });
    const putSettingsB = await api('PUT', '/api/settings', multiToken, {
      includeAnalistaTrack: false,
      minPassingGrade: 4,
    });
    const importB = await api('POST', '/api/import', multiToken, {
      settings: { includeAnalistaTrack: false, minPassingGrade: 4, tutorialCompleted: false },
      userState: { '101': { status: 'regularizada' } },
      assignedElectives: { 5: [201] },
      basket: [101],
      scheduleSelections: { '101': '1D2' },
      scheduleDrafts: [{ name: 'Borrador Plan B', selections: { '101': '1D2' } }],
    });

    assert(
      putElecB.status === 200 && putBasketB.status === 200 && putSettingsB.status === 200 && importB.status === 200,
      'Guardar electivas, canasta, settings e importData en Plan B responde 200'
    );

    // 4.4 Volver a Plan A y verificar que NADA de Plan A fue borrado o pisado por Plan B
    setUserPlanInAllStores(multiUserId, planA);

    const stateBackInA = await api('GET', '/api/state', multiToken);
    const dataA = stateBackInA.data?.data;
    assert(
      stateBackInA.status === 200 &&
        dataA.selectedPlanId === planA &&
        dataA.progress['101']?.status === 'aprobada' &&
        dataA.progress['101']?.grade === 9 &&
        Array.isArray(dataA.assignedElectives['3']) &&
        dataA.assignedElectives['3'].includes(102) &&
        !dataA.assignedElectives['5'].includes(201) &&
        Array.isArray(dataA.basket) &&
        dataA.basket.length === 1 &&
        dataA.basket[0] === 103 &&
        dataA.settings.includeAnalistaTrack === true &&
        dataA.settings.minPassingGrade === 6 &&
        dataA.scheduleSelections['101'] === '1K1' &&
        dataA.scheduleProposals.length === 1 &&
        dataA.scheduleProposals[0].name === 'Propuesta Plan A' &&
        dataA.examAttempts.length === 1 &&
        dataA.examAttempts[0].id === examAId,
      'Al volver a Plan A, electivas, canasta, importData, propuestas y ajustes de Plan A permanecen intactos'
    );

    const exportA = await api('GET', `/api/export?planId=${planB}`, multiToken);
    assert(
      exportA.status === 200 &&
        exportA.data.data.basket.length === 1 &&
        exportA.data.data.basket[0] === 103 &&
        exportA.data.data.scheduleDrafts.length === 1 &&
        exportA.data.data.scheduleDrafts[0].name === 'Propuesta Plan A',
      'GET /api/export ignora ?planId= extranjero y exporta solo datos del plan activo'
    );

    // 4.5 Sincronización global de notifyLibraryEmail, electivas en nivel 6 y no-duplicación de notificaciones al uploader
    setUserPlanInAllStores(multiUserId, planB);
    const putNotifyFalseB = await api('PUT', '/api/settings', multiToken, {
      notifyLibraryEmail: false,
    });
    setUserPlanInAllStores(multiUserId, planA);
    const stateNotifyA = await api('GET', '/api/state', multiToken);
    const putNotifyTrueA = await api('PUT', '/api/settings', multiToken, {
      notifyLibraryEmail: true,
    });
    setUserPlanInAllStores(multiUserId, planB);
    const stateNotifyB = await api('GET', '/api/state', multiToken);
    assert(
      putNotifyFalseB.status === 200 &&
        stateNotifyA.data?.data?.settings?.notifyLibraryEmail === false &&
        stateNotifyA.data?.data?.settings?.minPassingGrade === 6 &&
        putNotifyTrueA.status === 200 &&
        stateNotifyB.data?.data?.settings?.notifyLibraryEmail === true &&
        stateNotifyB.data?.data?.settings?.minPassingGrade === 4,
      'notifyLibraryEmail se sincroniza globalmente entre planes sin pisar preferencias por plan'
    );

    const plan6Id = crypto.randomUUID();
    userStateStore.seedPlan({
      id: plan6Id,
      name: 'Medicina / Plan 6 niveles',
      facultyId: facA,
      totalLevels: 6,
      status: 'published',
      isActive: true,
      careerStatus: 'published',
    });
    userStateStore.seedSubject({
      planId: plan6Id,
      codeInPlan: 601,
      kind: 'electiva',
      level: 6,
    });
    setUserPlanInAllStores(multiUserId, plan6Id);
    const putElec6 = await api('PUT', '/api/electives', multiToken, {
      assignedElectives: { 6: [601] },
    });
    const stateElec6 = await api('GET', '/api/state', multiToken);
    const exportElec6 = await api('GET', '/api/export', multiToken);
    const importElec6 = await api('POST', '/api/import', multiToken, {
      assignedElectives: { 6: [601] },
    });
    const stateAfterImport6 = await api('GET', '/api/state', multiToken);
    assert(
      resolvePlanMaxLevel(6, []) === 6 &&
        resolvePlanMaxLevel(null, [{ level: 6 }]) === 6 &&
        resolvePlanMaxLevel(3, []) === 5 &&
        putElec6.status === 200 &&
        stateElec6.data?.data?.assignedElectives?.['6']?.includes(601) &&
        exportElec6.data?.data?.assignedElectives?.['6']?.includes(601) &&
        importElec6.status === 200 &&
        importElec6.data?.data?.electivesCount === 1 &&
        stateAfterImport6.data?.data?.assignedElectives?.['6']?.includes(601),
      'Electivas en nivel 6 funcionan en /api/electives, /api/state, /api/export y /api/import sin tope 1..5',
      `put=${putElec6.status}, state=${JSON.stringify(stateElec6.data?.data?.assignedElectives)}, export=${JSON.stringify(exportElec6.data?.data?.assignedElectives)}, import=${JSON.stringify(importElec6.data)}`
    );

    const uploaderFileRow = [
      {
        fileId: crypto.randomUUID(),
        uploaderUserId: multiUserId,
        status: 'approved',
        title: 'Resumen multi-plan',
        rejectionReason: null,
        subjectName: 'Álgebra',
        userEmail: 'multi@frc.utn.edu.ar',
        userStatus: 'active',
      },
    ];
    const itemsBothTrue = buildPendingUploaderFileItems(uploaderFileRow, [
      { userId: multiUserId, notifyLibraryEmail: true },
      { userId: multiUserId, notifyLibraryEmail: true },
    ]);
    const itemsMixedOptOut = buildPendingUploaderFileItems(uploaderFileRow, [
      { userId: multiUserId, notifyLibraryEmail: true },
      { userId: multiUserId, notifyLibraryEmail: false },
    ]);
    assert(
      itemsBothTrue.length === 1 &&
        itemsBothTrue[0].notifyLibraryEmail === true &&
        itemsMixedOptOut.length === 1 &&
        itemsMixedOptOut[0].notifyLibraryEmail === false,
      'buildPendingUploaderFileItems no duplica filas con múltiples user_settings y respeta opt-out global'
    );

    setUserPlanInAllStores(multiUserId, planA);

    // -------------------------------------------------------------------------
    // 5. AISLAMIENTO REVIEWS, PROFESSORS Y ENROLLMENTS ENTRE FACULTADES/PLANES
    // -------------------------------------------------------------------------
    console.log('\n📌 5. Aislamiento cross-plan de profesores, cursadas y reseñas');

    const profsInA = await api('GET', `/api/professors?planId=${planB}`, multiToken);
    const profItems = profsInA.data?.data?.professors || [];
    const crossProfDetail404 = await api('GET', `/api/professors/${profB.id}`, multiToken);
    const crossProfRevs404 = await api('GET', `/api/professors/${profB.id}/reviews`, multiToken);
    assert(
      profsInA.status === 200 &&
        profItems.some((p: any) => p.id === profA.id) &&
        !profItems.some((p: any) => p.id === profB.id) &&
        crossProfDetail404.status === 404 &&
        crossProfRevs404.status === 404,
      'Listado y detalle de profesores filtran por facultad activa e ignoran ?planId= ajeno (404 cross-facultad)'
    );

    const reviewableA = await api('GET', `/api/me/reviewable?planId=${planB}`, multiToken);
    const reviewableEligible = reviewableA.data?.data?.eligible || [];
    const enrollmentsA = await api('GET', `/api/enrollments?planId=${planB}`, multiToken);
    const enrollmentsList = enrollmentsA.data?.data?.enrollments || [];
    const crossOptions404 = await api('GET', `/api/enrollments/options/${subB_core.id}`, multiToken);
    const crossUpsertSub404 = await api('PUT', `/api/enrollments/${subB_core.id}`, multiToken, {
      commissionId: commB.id,
      academicYear: 2026,
      term: '1C',
    });
    const crossUpsertComm404 = await api('PUT', `/api/enrollments/${subA_core.id}`, multiToken, {
      commissionId: commB.id,
      academicYear: 2026,
      term: '1C',
    });
    const crossDeleteEnr404 = await api('DELETE', `/api/enrollments/${enrB.id}`, multiToken);

    assert(
      reviewableA.status === 200 &&
        reviewableEligible.some((x: any) => x.subjectId === subA_core.id) &&
        !reviewableEligible.some((x: any) => x.subjectId === subB_core.id) &&
        enrollmentsA.status === 200 &&
        !enrollmentsList.some((e: any) => e.id === enrB.id) &&
        crossOptions404.status === 404 &&
        crossUpsertSub404.status === 404 &&
        crossUpsertComm404.status === 404 &&
        crossDeleteEnr404.status === 404 &&
        reviewsStore.enrollmentsMap.has(enrB.id),
      'Enrollments y reviewable devuelven 404 ante materia/comisión/cursada de otro plan sin borrar cursadas de Plan B'
    );

    const crossRevCreate404 = await api('POST', '/api/reviews', multiToken, {
      professorId: profB.id,
      subjectId: subB_core.id,
      overall: 5,
    });
    const crossRevPut404 = await api('PUT', `/api/reviews/${revBId}`, multiToken, { overall: 3 });
    const crossRevDel404 = await api('DELETE', `/api/reviews/${revBId}`, multiToken);
    const crossRevVote404 = await api('POST', `/api/reviews/${revBId}/helpful`, multiToken);
    const crossRevRep404 = await api('POST', `/api/reviews/${revBId}/report`, multiToken, {
      reason: 'falsa o spam',
    });
    assert(
      crossRevCreate404.status === 404 &&
        crossRevPut404.status === 404 &&
        crossRevDel404.status === 404 &&
        crossRevVote404.status === 404 &&
        crossRevRep404.status === 404,
      'Crear/editar/borrar/votar/reportar reseñas de materias de otro plan responde 404',
      `statuses: create=${crossRevCreate404.status}, put=${crossRevPut404.status}, del=${crossRevDel404.status}, vote=${crossRevVote404.status}, rep=${crossRevRep404.status}`
    );

    // -------------------------------------------------------------------------
    // 6. BIBLIOTECA COMPARTIDA POR SHARED_SUBJECT_ID, 404 CROSS-PLAN Y CUOTAS
    // -------------------------------------------------------------------------
    console.log('\n📌 6. Biblioteca: shared_subjects entre carreras, 404 en no compartidas y cuotas por usuario');

    // 6.1 Alumno A en Plan A sube material en subA_core (compartida con subB_core via sharedAlgebraId)
    const pdfSharedBuf = Buffer.from('%PDF-1.4 Apunte compartido de Álgebra %%EOF');
    const initShared = await api('POST', '/api/library/uploads/init', multiToken, {
      subjectId: subA_core.id,
      kind: 'apunte',
      title: 'Resumen Álgebra Compartido',
      originalFilename: 'resumen-algebra.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdfSharedBuf.length,
    });
    assert(initShared.status === 201, 'Alumno en Plan A inicia subida en materia compartida (201)');
    const sharedFileId = initShared.data.data.fileId as string;
    await mockR2.putObjectDirect(initShared.data.data.storageKey, pdfSharedBuf, 'application/pdf');
    const completeShared = await api('POST', `/api/library/uploads/${sharedFileId}/complete`, multiToken);
    const approveShared = await api('PATCH', `/api/admin/library/files/${sharedFileId}/approve`, adminToken);
    assert(
      completeShared.status === 200 && approveShared.status === 200,
      'Subida compartida se completa y se aprueba correctamente'
    );

    // 6.2 Alumno B en Plan B ve el material aprobado en su materia subB_core, con nombre del Plan B y anonimato
    const subsB = await api('GET', '/api/library/subjects', studentBToken);
    const bSharedRow = (subsB.data?.data?.subjects || subsB.data?.data || []).find(
      (s: any) => s.id === subB_core.id
    );
    const listSharedInB = await api('GET', `/api/library/subjects/${subB_core.id}/files`, studentBToken);
    const listBIgnoringQuery = await api('GET', `/api/library/files?planId=${planA}`, studentBToken);
    const detailInB = await api('GET', `/api/library/files/${sharedFileId}`, studentBToken);
    const downloadInB = await api('GET', `/api/library/files/${sharedFileId}/download`, studentBToken);
    const helpfulInB = await api('POST', `/api/library/files/${sharedFileId}/helpful`, studentBToken);

    const itemInB = listSharedInB.data?.data?.items?.[0];
    assert(
      subsB.status === 200 &&
        bSharedRow?.approvedFilesCount === 1 &&
        listSharedInB.status === 200 &&
        listSharedInB.data?.data?.items?.length === 1 &&
        itemInB?.id === sharedFileId &&
        itemInB?.subjectName === subB_core.name &&
        itemInB?.uploaderDisplay === 'Subido por un estudiante' &&
        !('uploaderUserId' in itemInB) &&
        !('uploaderEmail' in itemInB) &&
        listBIgnoringQuery.status === 200 &&
        detailInB.status === 200 &&
        downloadInB.status === 200 &&
        helpfulInB.status === 200,
      'Alumno en Plan B ve y descarga material compartido por shared_subject_id con nombre de Plan B y sin filtrar autor'
    );

    // 6.3 Material en materia exclusiva de Plan B (NO compartida) devuelve 404 para alumno en Plan A
    const pdfBOnlyBuf = Buffer.from('%PDF-1.4 Parcial exclusivo de Industrial Plan B %%EOF');
    const initBOnly = await api('POST', '/api/library/uploads/init', studentBToken, {
      subjectId: subB_only.id,
      kind: 'parcial',
      title: 'Parcial IO Plan B',
      academicYear: 2025,
      term: '2C',
      originalFilename: 'parcial-io.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdfBOnlyBuf.length,
    });
    const bOnlyFileId = initBOnly.data.data.fileId as string;
    await mockR2.putObjectDirect(initBOnly.data.data.storageKey, pdfBOnlyBuf, 'application/pdf');
    await api('POST', `/api/library/uploads/${bOnlyFileId}/complete`, studentBToken);
    await api('PATCH', `/api/admin/library/files/${bOnlyFileId}/approve`, adminToken);

    const crossLibSubFiles404 = await api('GET', `/api/library/subjects/${subB_only.id}/files`, multiToken);
    const crossLibQuery404 = await api('GET', `/api/library/subjects/${subB_only.id}/files?planId=${planB}`, multiToken);
    const crossLibInit404 = await api('POST', '/api/library/uploads/init', multiToken, {
      subjectId: subB_only.id,
      kind: 'apunte',
      title: 'Intento subida cruzada',
      originalFilename: 'x.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 512,
    });
    const crossLibDetail404 = await api('GET', `/api/library/files/${bOnlyFileId}`, multiToken);
    const crossLibDownload404 = await api('GET', `/api/library/files/${bOnlyFileId}/download`, multiToken);
    const crossLibHelpful404 = await api('POST', `/api/library/files/${bOnlyFileId}/helpful`, multiToken);
    const crossLibReport404 = await api('POST', `/api/library/files/${bOnlyFileId}/report`, multiToken, {
      reason: 'wrong_subject',
    });
    const crossLibDeleteOther404 = await api('DELETE', `/api/library/my-uploads/${bOnlyFileId}`, multiToken);

    assert(
      crossLibSubFiles404.status === 404 &&
        crossLibQuery404.status === 404 &&
        crossLibInit404.status === 404 &&
        crossLibDetail404.status === 404 &&
        crossLibDownload404.status === 404 &&
        crossLibHelpful404.status === 404 &&
        crossLibReport404.status === 404 &&
        crossLibDeleteOther404.status === 404,
      'Biblioteca devuelve 404 ante materias/archivos no compartidos de otro plan incluso con ?planId='
    );

    // 6.4 Cuotas estrictamente por usuario (globales al userId, nunca compartidas con otros usuarios en shared_subjects)
    libraryStore.files.set('seed-quota-full', {
      id: 'seed-quota-full',
      uploaderUserId: quotaUserId,
      subjectId: subA_core.id,
      sharedSubjectId: sharedAlgebraId,
      sourceSubjectId: subA_core.id,
      sourcePlanId: planA,
      professorId: null,
      kind: 'apunte',
      title: 'Archivo pesado en Plan A',
      description: null,
      academicYear: null,
      term: null,
      examInstance: null,
      professorText: null,
      hasSolution: null,
      originalFilename: 'pesado.pdf',
      storageKey: 'library/pesado.pdf',
      mimeType: 'application/pdf',
      sizeBytes: LIBRARY_CONFIG.MAX_USER_QUOTA_BYTES - 1024,
      sha256: 'sha256-pesado-cross-plan',
      status: 'approved',
      rejectionReason: null,
      rejectedAt: null,
      helpfulCount: 0,
      downloadCount: 0,
      reportsCount: 0,
      moderatorUserId: null,
      moderatedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    // Cambiar quotaUserId a Plan B: su cuota de usuario NO se resetea al cambiar de plan
    setUserPlanInAllStores(quotaUserId, planB);
    const quotaTokenInB = signUserToken(quotaUserId);
    const quotaBlockedInB = await api('POST', '/api/library/uploads/init', quotaTokenInB, {
      subjectId: subB_core.id,
      kind: 'apunte',
      title: 'Intento exceder cuota en Plan B',
      originalFilename: 'excede.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4096,
    });

    // Otro estudiante (studentBOnlyId) en Plan B sobre la MISMA materia compartida NO hereda el bloqueo de cuota
    const freshPdfForShared = Buffer.from('%PDF-1.4 Segundo aporte independiente en shared subject %%EOF');
    const studentBNotBlocked = await api('POST', '/api/library/uploads/init', studentBToken, {
      subjectId: subB_core.id,
      kind: 'apunte',
      title: 'Aporte independiente en shared subject',
      originalFilename: 'indep.pdf',
      mimeType: 'application/pdf',
      sizeBytes: freshPdfForShared.length,
    });

    assert(
      quotaBlockedInB.status === 429 &&
        (quotaBlockedInB.data?.code === 'LIMIT_STORAGE_QUOTA' || quotaBlockedInB.data?.code === 'LIMIT_USER_QUOTA') &&
        studentBNotBlocked.status === 201,
      'Cuota de almacenamiento es global por userId entre planes (429) y no bloquea a otro estudiante en el mismo shared_subject (201)'
    );

    // Limite de pendientes por usuario (MAX_PENDING_UPLOADS) también por userId
    for (let i = 0; i < LIBRARY_CONFIG.MAX_PENDING_UPLOADS; i++) {
      libraryStore.files.set(`seed-pend-${i}`, {
        id: `seed-pend-${i}`,
        uploaderUserId: pendingQuotaUserId,
        subjectId: subA_core.id,
        sharedSubjectId: sharedAlgebraId,
        sourceSubjectId: subA_core.id,
        sourcePlanId: planA,
        professorId: null,
        kind: 'apunte',
        title: `Pendiente ${i}`,
        description: null,
        academicYear: null,
        term: null,
        examInstance: null,
        professorText: null,
        hasSolution: null,
        originalFilename: `p${i}.pdf`,
        storageKey: `library/p${i}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 512,
        sha256: `sha256-pend-${i}`,
        status: 'pending',
        rejectionReason: null,
        rejectedAt: null,
        helpfulCount: 0,
        downloadCount: 0,
        reportsCount: 0,
        moderatorUserId: null,
        moderatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    }
    const pendingBlockedRes = await api('POST', '/api/library/uploads/init', pendingToken, {
      subjectId: subA_core.id,
      kind: 'apunte',
      title: 'Pendiente extra 31',
      originalFilename: 'p31.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 512,
    });
    assert(
      pendingBlockedRes.status === 429 && pendingBlockedRes.data?.code === 'LIMIT_PENDING_UPLOADS',
      'Límite de archivos pendientes se aplica por usuario (429 LIMIT_PENDING_UPLOADS)'
    );

    // -------------------------------------------------------------------------
    // 9. USUARIOS CON selectedPlanId = null Y EXCLUSIÓN DE PLANES EN BORRADOR
    // -------------------------------------------------------------------------
    console.log('\n📌 9. Resolución fallback para selectedPlanId = null sin elegir planes draft');

    const isolatedNullUserId = crypto.randomUUID();
    const draftFacId = crypto.randomUUID();
    const draftPlanId = crypto.randomUUID();
    const publishedFallbackId = crypto.randomUUID();

    const isoUserState = new InMemoryUserStateStore();
    const isoReviews = new InMemoryReviewsStore();
    // Sembrar PRIMERO un plan en borrador con isActive: true
    isoUserState.seedPlan({
      id: draftPlanId,
      name: 'Carrera en Borrador',
      facultyId: draftFacId,
      status: 'draft',
      isActive: true,
    });
    isoReviews.seedPlan(draftPlanId, draftFacId, {
      status: 'draft',
      isActive: true,
    });
    isoUserState.seedUser(isolatedNullUserId, null);
    isoReviews.seedUserPlan(isolatedNullUserId, null);

    const onlyDraftState = await isoUserState.resolveUserActivePlan(isolatedNullUserId, null);
    const onlyDraftRev = await isoReviews.resolvePlanContext(isolatedNullUserId, null);
    assert(
      onlyDraftState !== null &&
        onlyDraftState.planId === null &&
        onlyDraftRev === null,
      'InMemoryUserStateStore e InMemoryReviewsStore NO eligen un plan draft (status="draft", isActive=true) como fallback'
    );

    // Agregar DESPUÉS un plan publicado: ambos deben seleccionarlo ignorando el draft anterior
    isoUserState.seedPlan({
      id: publishedFallbackId,
      name: 'Sistemas Plan 2023',
      facultyId: draftFacId,
      status: 'published',
      isActive: true,
      careerCode: 'ISI',
      year: 2023,
    });
    isoReviews.seedPlan(publishedFallbackId, draftFacId, {
      status: 'published',
      isActive: true,
      careerCode: 'ISI',
      year: 2023,
    });
    const pubFallbackState = await isoUserState.resolveUserActivePlan(isolatedNullUserId, null);
    const pubFallbackRev = await isoReviews.resolvePlanContext(isolatedNullUserId, null);
    assert(
      pubFallbackState?.planId === publishedFallbackId &&
        isoUserState.usersPlan.get(isolatedNullUserId) === publishedFallbackId &&
        pubFallbackRev?.planId === publishedFallbackId,
      'Cuando existe un plan publicado además de un draft, selectedPlanId=null resuelve al plan publicado y lo backfillea'
    );

    // Caso HTTP real en testApp: usuario autenticado con selectedPlanId=null (también con un draft presente)
    const httpDraftPlanId = crypto.randomUUID();
    catalogStore.plans.unshift({
      id: httpDraftPlanId,
      careerId: careerDraftId,
      name: 'Plan Borrador HTTP',
      year: 2026,
      status: 'draft',
      isActive: true,
      config: {},
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });
    const draftLibSub = {
      id: crypto.randomUUID(),
      name: 'Materia Draft Biblioteca',
      codeInPlan: 999,
      level: 1,
      kind: 'obligatoria',
      planId: httpDraftPlanId,
      sharedSubjectId: crypto.randomUUID(),
    };
    libraryStore.seedSubject(draftLibSub);
    const draftLibFileId = crypto.randomUUID();
    libraryStore.files.set(draftLibFileId, {
      id: draftLibFileId,
      uploaderUserId: multiUserId,
      subjectId: draftLibSub.id,
      sharedSubjectId: draftLibSub.sharedSubjectId,
      sourcePlanId: httpDraftPlanId,
      kind: 'apunte',
      title: 'Apunte en Draft',
      description: null,
      academicYear: 2026,
      term: '1C',
      examInstance: null,
      professorText: null,
      hasSolution: false,
      originalFilename: 'draft.pdf',
      storageKey: 'library/draft.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 512,
      status: 'approved',
      rejectionReason: null,
      downloadCount: 0,
      helpfulCount: 0,
      reportsCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    userStateStore.seedPlan({
      id: httpDraftPlanId,
      name: 'Plan Borrador HTTP',
      facultyId: facA,
      status: 'draft',
      isActive: true,
    });
    reviewsStore.seedPlan(httpDraftPlanId, facA, {
      status: 'draft',
      isActive: true,
    });
    const nullHttpUserId = crypto.randomUUID();
    registerUser({
      id: nullHttpUserId,
      email: 'sin.plan.http@frc.utn.edu.ar',
      role: 'user',
      selectedPlanId: null,
    });
    const nullHttpToken = signUserToken(nullHttpUserId);

    reviewsStore.seedUserProgress(nullHttpUserId, subA_core.id, 'aprobada', 8);
    const nullStateRes = await api('GET', '/api/state', nullHttpToken);
    const nullEnrollList = await api('GET', '/api/enrollments', nullHttpToken);
    const nullEnrollPut = await api('PUT', `/api/enrollments/${subA_core.id}`, nullHttpToken, {
      academicYear: 2026,
      term: '1C',
    });
    const nullProfs = await api('GET', '/api/professors', nullHttpToken);
    const nullReviewable = await api('GET', '/api/me/reviewable', nullHttpToken);
    const nullCreateRev = await api('POST', '/api/reviews', nullHttpToken, {
      professorId: profA.id,
      subjectId: subA_core.id,
      academicYear: 2026,
      term: '1C',
      overall: 5,
      comment: 'Reseña en plan fallback publicado cuando selectedPlanId es null.',
    });
    const nullLibSubs = await api('GET', '/api/library/subjects', nullHttpToken);
    const nullLibFiles = await api('GET', '/api/library/files', nullHttpToken);
    const nullLibDraftDetail = await api('GET', `/api/library/files/${draftLibFileId}`, nullHttpToken);

    const nullProfIds = new Set(
      (nullProfs.data?.data?.professors || []).map((p: any) => p.id)
    );
    const nullLibSubIds = new Set(
      (nullLibSubs.data?.data || []).map((s: any) => s.id)
    );
    const nullLibFileIds = new Set(
      (nullLibFiles.data?.data?.items || []).map((f: any) => f.id)
    );
    assert(
      nullStateRes.status === 200 &&
        nullStateRes.data?.data?.selectedPlanId === planA &&
        nullEnrollList.status === 200 &&
        nullEnrollPut.status === 200 &&
        nullProfs.status === 200 &&
        nullProfIds.has(profA.id) &&
        !nullProfIds.has(profB.id) &&
        nullReviewable.status === 200 &&
        nullCreateRev.status === 201 &&
        nullLibSubs.status === 200 &&
        nullLibSubIds.has(subA_core.id) &&
        !nullLibSubIds.has(draftLibSub.id) &&
        !nullLibSubIds.has(subB_only.id) &&
        nullLibFiles.status === 200 &&
        !nullLibFileIds.has(draftLibFileId) &&
        nullLibDraftDetail.status === 404,
      'Usuario con selectedPlanId=null opera /api/state (planA), /api/enrollments, /api/professors, /api/me/reviewable, POST /api/reviews y /api/library sin elegir el draft',
      `statuses=${nullStateRes.status}/${nullEnrollList.status}/${nullEnrollPut.status}/${nullProfs.status}/${nullReviewable.status}/${nullCreateRev.status}/${nullLibSubs.status}/${nullLibFiles.status}/${nullLibDraftDetail.status}, selectedPlanId=${nullStateRes.data?.data?.selectedPlanId}`
    );

    // -------------------------------------------------------------------------
    // 10. MIGRACIÓN 0015 (CLAVES COMPUESTAS, EXPANSIÓN SEGURA Y STORE COMPUESTO)
    // -------------------------------------------------------------------------
    console.log('\n📌 10. Migración 0015: Claves compuestas, expansión segura y filtro no-UUID');
    const sql0015Path = path.resolve(__dirname, '../drizzle/0015_user_state_composite_keys.sql');
    const sql0015 = fs.readFileSync(sql0015Path, 'utf-8');
    const journal0015Path = path.resolve(__dirname, '../drizzle/meta/_journal.json');
    const journal0015 = JSON.parse(fs.readFileSync(journal0015Path, 'utf-8'));
    const entry0015 = (journal0015.entries || []).find(
      (e: any) => e.tag === '0015_user_state_composite_keys'
    );

    const includeElectivesIdx = sql0015.indexOf('"include_electives_in_progress"');
    const soundEnabledIdx = sql0015.indexOf('"sound_enabled"');
    const includeElectivesJsonIdx = sql0015.indexOf("'includeElectivesInProgress'");
    const soundEnabledJsonIdx = sql0015.indexOf("'soundEnabled'");

    assert(
      !sql0015.includes('\r\n') &&
        entry0015?.idx === 15 &&
        entry0015?.when === 1793750000000 &&
        sql0015.includes('ALTER TABLE "user_settings" ALTER COLUMN "plan_id" SET NOT NULL') &&
        sql0015.includes('ALTER TABLE "schedule_selections" ALTER COLUMN "plan_id" SET NOT NULL') &&
        sql0015.includes('ALTER TABLE "schedule_proposals" ALTER COLUMN "plan_id" SET NOT NULL') &&
        sql0015.includes('ADD CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id", "plan_id")') &&
        sql0015.includes('DROP CONSTRAINT IF EXISTS "uq_user_schedule_selection"') &&
        sql0015.includes('DROP INDEX IF EXISTS "uq_user_schedule_selection"') &&
        sql0015.includes("kv.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'") &&
        sql0015.includes('JOIN "study_plans" sp ON sp."id" = r."plan_uuid"') &&
        includeElectivesIdx !== -1 &&
        soundEnabledIdx !== -1 &&
        includeElectivesIdx < soundEnabledIdx &&
        includeElectivesJsonIdx !== -1 &&
        soundEnabledJsonIdx !== -1 &&
        includeElectivesJsonIdx < soundEnabledJsonIdx,
      '0015_user_state_composite_keys.sql usa LF, journal when=1793750000000, PK compuesta, NOT NULL, filtro UUID regex + JOIN study_plans y orden exacto de columnas'
    );

    // Simulación sintética de Step C con claves no-UUID ("isi-old"), UUID inexistente y valores malformados
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validPlanSet = new Set([planA, planB]);
    const simSettingsTable = new Map<string, any>();
    simSettingsTable.set(`${multiUserId}::${planA}`, {
      userId: multiUserId,
      planId: planA,
      minPassingGrade: 6,
      includeElectivesInProgress: true,
      soundEnabled: false,
      notifyLibraryEmail: true,
      extraSettings: {
        seenRecommendationKeys: ['rec1'],
        perPlan: {
          [planA]: { minPassingGrade: 6, soundEnabled: false },
          [planB]: {
            minPassingGrade: 7,
            includeAnalistaTrack: true,
            includeElectivesInProgress: false,
            soundEnabled: true,
            tutorialCompleted: true,
          },
          'isi-old': { minPassingGrade: 9 },
          '00000000-0000-4000-8000-000000000999': { minPassingGrade: 10 },
          [plan6Id]: 'malformed-string-not-object',
        },
      },
    });

    function runSynthetic0015Expansion(): number {
      let inserted = 0;
      for (const row of Array.from(simSettingsTable.values())) {
        const perPlan =
          row.extraSettings?.perPlan &&
          typeof row.extraSettings.perPlan === 'object' &&
          !Array.isArray(row.extraSettings.perPlan)
            ? row.extraSettings.perPlan
            : {};
        for (const [key, val] of Object.entries(perPlan)) {
          if (!UUID_RE.test(key) || !validPlanSet.has(key)) continue;
          if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
          const compKey = `${row.userId}::${key}`;
          if (simSettingsTable.has(compKey)) continue;
          const obj = val as Record<string, any>;
          simSettingsTable.set(compKey, {
            userId: row.userId,
            planId: key,
            includePromotionsInGPA:
              typeof obj.includePromotionsInGPA === 'boolean' ? obj.includePromotionsInGPA : true,
            minPassingGrade:
              typeof obj.minPassingGrade === 'number' ? obj.minPassingGrade : 4,
            includeAnalistaTrack:
              typeof obj.includeAnalistaTrack === 'boolean' ? obj.includeAnalistaTrack : false,
            allowBlockedElectivesPlanning:
              typeof obj.allowBlockedElectivesPlanning === 'boolean'
                ? obj.allowBlockedElectivesPlanning
                : false,
            includeElectivesInProgress:
              typeof obj.includeElectivesInProgress === 'boolean'
                ? obj.includeElectivesInProgress
                : true,
            soundEnabled: typeof obj.soundEnabled === 'boolean' ? obj.soundEnabled : true,
            tutorialCompleted:
              typeof obj.tutorialCompleted === 'boolean' ? obj.tutorialCompleted : false,
            notifyLibraryEmail: row.notifyLibraryEmail,
            extraSettings: {},
          });
          inserted++;
        }
      }
      return inserted;
    }

    const expPass1 = runSynthetic0015Expansion();
    const expPass2 = runSynthetic0015Expansion();
    const expandedPlanB = simSettingsTable.get(`${multiUserId}::${planB}`);
    const expandedPlanA = simSettingsTable.get(`${multiUserId}::${planA}`);
    assert(
      expPass1 === 1 &&
        expPass2 === 0 &&
        simSettingsTable.size === 2 &&
        expandedPlanA?.soundEnabled === false &&
        expandedPlanB?.minPassingGrade === 7 &&
        expandedPlanB?.includeElectivesInProgress === false &&
        expandedPlanB?.soundEnabled === true &&
        expandedPlanB?.tutorialCompleted === true &&
        !simSettingsTable.has(`${multiUserId}::isi-old`),
      'Expansión 0015 materializa planes válidos, ignora clave no-UUID ("isi-old") y UUID inexistente, respeta includeElectivesInProgress vs soundEnabled y es idempotente'
    );

    // Verificar claves compuestas directas en InMemoryUserStateStore para 2 planes sobre el mismo término horario
    const sameFacultyTerm = termA.id;
    const planA2InFacA = crypto.randomUUID();
    userStateStore.seedPlan({
      id: planA2InFacA,
      name: 'Carrera Alternativa Misma Facultad',
      facultyId: facA,
      status: 'published',
      isActive: true,
      careerStatus: 'published',
    });
    setUserPlanInAllStores(multiUserId, planA2InFacA);
    const putSelPlanA2 = await api('PUT', '/api/schedule/selections', multiToken, {
      scheduleTermId: sameFacultyTerm,
      selections: { '101': 'ALT-K1' },
    });
    setUserPlanInAllStores(multiUserId, planA);
    const statePlanAAfterSameTerm = await api('GET', '/api/state', multiToken);
    setUserPlanInAllStores(multiUserId, planA2InFacA);
    const statePlanA2AfterSameTerm = await api('GET', '/api/state', multiToken);

    const multiSettingsKeys = Array.from(userStateStore.settings.keys()).filter((k) =>
      k.startsWith(`${multiUserId}::`)
    );
    const multiSelectionKeys = Array.from(userStateStore.selections.keys()).filter((k) =>
      k.startsWith(`${multiUserId}::`)
    );
    assert(
      putSelPlanA2.status === 200 &&
        statePlanAAfterSameTerm.data?.data?.scheduleSelections?.['101'] === '1K1' &&
        statePlanA2AfterSameTerm.data?.data?.scheduleSelections?.['101'] === 'ALT-K1' &&
        multiSettingsKeys.includes(`${multiUserId}::${planA}`) &&
        multiSettingsKeys.includes(`${multiUserId}::${planB}`) &&
        multiSelectionKeys.includes(`${multiUserId}::${planA}::${sameFacultyTerm}`) &&
        multiSelectionKeys.includes(`${multiUserId}::${planA2InFacA}::${sameFacultyTerm}`),
      'InMemoryUserStateStore guarda filas compuestas separadas por (userId, planId) y (userId, planId, termId) en la misma facultad'
    );

    setUserPlanInAllStores(multiUserId, planA);
  } finally {
    setCatalogStoreForTesting(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(` 📊 RESULTADO TESTS MULTI-CARRERA (1A): ${passed} pasaron, ${failed} fallaron`);
  console.log('======================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Error fatal ejecutando tests multi-carrera:', err);
  process.exit(1);
});
