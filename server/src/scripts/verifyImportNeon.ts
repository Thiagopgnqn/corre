import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { PlanImportTxContext } from '../modules/admin/planImport.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function extractSafeHost(connectionString: string, varName: string): string {
  try {
    const parsed = new URL(connectionString);
    if (!parsed.hostname) {
      throw new Error('hostname vacío');
    }
    return parsed.hostname;
  } catch (err) {
    throw new Error(
      `No se pudo extraer un host válido de ${varName}: ${err instanceof Error ? err.message : 'URL inválida'}`
    );
  }
}

function parseHostOkArg(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--host-ok=')) {
      return arg.slice('--host-ok='.length).trim();
    }
    if (arg === '--host-ok' && argv[i + 1]) {
      return argv[i + 1].trim();
    }
  }
  return null;
}

function loadServerEnvWithoutConnecting(): void {
  const candidateEnvPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(candidateEnvPath)) {
    dotenv.config({ path: candidateEnvPath });
  } else {
    dotenv.config();
  }
}

async function run(): Promise<void> {
  // 1. Guarda de seguridad obligatoria antes de leer credenciales o abrir sockets
  if (process.env.ALLOW_DESTRUCTIVE_TEST !== '1') {
    console.error('❌ BLOQUEADO: este script escribe y borra registros temporales en PostgreSQL/Neon.');
    console.error('   Para ejecutarlo manualmente contra una RAMA TEMPORAL (NUNCA producción):');
    console.error('   ALLOW_DESTRUCTIVE_TEST=1 npm --prefix server run verify:import-neon -- --host-ok=<host>');
    process.exit(1);
  }

  loadServerEnvWithoutConnecting();

  const databaseUrl = process.env.DATABASE_URL?.trim() || '';
  if (!databaseUrl) {
    console.error('❌ Falta DATABASE_URL en entorno o en server/.env.');
    process.exit(1);
  }

  const dbHost = extractSafeHost(databaseUrl, 'DATABASE_URL');
  const directUrl = process.env.DIRECT_URL?.trim() || '';
  const directHost = directUrl ? extractSafeHost(directUrl, 'DIRECT_URL') : null;

  console.log('======================================================================');
  console.log(' 🔍 VERIFICACIÓN MANUAL ETAPA 2 (DRIZZLE REAL CONTRA NEON)');
  console.log('======================================================================');
  console.log(`🌐 HOST detectado en DATABASE_URL: ${dbHost}`);
  if (directHost) {
    console.log(`🌐 HOST detectado en DIRECT_URL:   ${directHost}`);
  }

  const hostOk = parseHostOkArg(process.argv.slice(2));
  if (!hostOk || hostOk !== dbHost) {
    console.error('\n❌ Confirmación de host faltante o no coincidente.');
    console.error('   Verificá que el host pertenezca a tu RAMA TEMPORAL de Neon (no producción) y confirmalo con:');
    console.error(`   ALLOW_DESTRUCTIVE_TEST=1 npm --prefix server run verify:import-neon -- --host-ok=${dbHost}`);
    process.exit(1);
  }

  // Asegurar defaults locales no críticos si solo están configuradas URLs de DB para la prueba manual
  process.env.JWT_SECRET ||= 'verify_import_neon_jwt_secret_local_only_32';
  process.env.REFRESH_SECRET ||= 'verify_import_neon_refresh_secret_local_only_32';

  // Imports dinámicos recién después de validar ALLOW_DESTRUCTIVE_TEST=1 y --host-ok
  const { and, count, eq, inArray, or } = await import('drizzle-orm');
  const { db, pool } = await import('../db/index.js');
  const {
    acronyms,
    adminAuditLog,
    careers,
    faculties,
    institutions,
    planSpecialRules,
    sharedSubjects,
    studyPlans,
    subjectPrerequisites,
    subjects,
    users,
  } = await import('../db/schema.js');
  const { buildPlanImportTemplateBuffer } = await import('../modules/admin/planImport.template.js');
  const {
    DrizzlePlanImportStore,
    PlanImportServiceError,
    confirmPlanImport,
    deleteAdminDraftPlan,
    getAdminPlanDetail,
    previewPlanImport,
    setPlanImportStoreForTesting,
  } = await import('../modules/admin/planImport.service.js');

  const runId = crypto.randomBytes(4).toString('hex').toUpperCase();
  const tag = `__VERIFY_IMPORT_${runId}__`;
  const tempAdminEmail = `__verify_import_${runId.toLowerCase()}@verify.local`;
  const instCode = `${tag}INST`;
  const facCode = `${tag}FAC`;
  const peerCareerCode = `VP_${runId}`;
  const pubCareerCode = `VPUB_${runId}`;
  const fictCareerCode = `VF_${runId}`;
  const rbCareerCode = `VRB_${runId}`;
  const twoPlanCareerCode = `VTWO_${runId}`;
  const pubOnlyDraftCareerCode = `VPDR_${runId}`;

  const readGlobalCounts = async () => {
    const [[c], [p], [s], [sh], [pr]] = await Promise.all([
      db.select({ value: count() }).from(careers),
      db.select({ value: count() }).from(studyPlans),
      db.select({ value: count() }).from(subjects),
      db.select({ value: count() }).from(sharedSubjects),
      db.select({ value: count() }).from(subjectPrerequisites),
    ]);
    return {
      careers: Number(c?.value ?? 0),
      study_plans: Number(p?.value ?? 0),
      subjects: Number(s?.value ?? 0),
      shared_subjects: Number(sh?.value ?? 0),
      subject_prerequisites: Number(pr?.value ?? 0),
    };
  };

  let initialCounts: Awaited<ReturnType<typeof readGlobalCounts>> | null = null;
  let tempUserId: string | null = null;
  let instId: string | null = null;
  let facId: string | null = null;
  const trackedCareerIds = new Set<string>();
  const trackedPlanIds = new Set<string>();
  const trackedSubjectIds = new Set<string>();

  try {
    setPlanImportStoreForTesting(null);

    initialCounts = await readGlobalCounts();
    console.log('\n📊 Conteos globales INICIALES:');
    console.log(
      `   careers=${initialCounts.careers} | study_plans=${initialCounts.study_plans} | subjects=${initialCounts.subjects} | shared_subjects=${initialCounts.shared_subjects} | subject_prerequisites=${initialCounts.subject_prerequisites}`
    );

    console.log(`\n🔧 Creando entorno temporal aislado con prefijo ${tag}...`);
    const [tempAdmin] = await db
      .insert(users)
      .values({
        email: tempAdminEmail,
        canonicalEmail: tempAdminEmail,
        role: 'admin',
        status: 'active',
        emailVerifiedAt: new Date(),
      })
      .returning({ id: users.id });
    tempUserId = tempAdmin.id;

    const [inst] = await db
      .insert(institutions)
      .values({ name: `[VERIFY ${runId}] Institución`, code: instCode })
      .returning({ id: institutions.id });
    instId = inst.id;

    const [fac] = await db
      .insert(faculties)
      .values({ institutionId: instId, name: `[VERIFY ${runId}] Facultad`, code: facCode })
      .returning({ id: faculties.id });
    facId = fac.id;

    // Plan par con materia compartida "Dibujo Técnico" para probar preservación en DELETE
    const [peerCareer] = await db
      .insert(careers)
      .values({
        facultyId: facId,
        name: `[VERIFY ${runId}] Carrera Par`,
        code: peerCareerCode,
        status: 'draft',
      })
      .returning({ id: careers.id });
    trackedCareerIds.add(peerCareer.id);

    const [peerPlan] = await db
      .insert(studyPlans)
      .values({
        careerId: peerCareer.id,
        name: `[VERIFY ${runId}] Plan Par`,
        year: 2026,
        status: 'draft',
        isActive: true,
        config: { requiredElectiveCredits: 0, defaultMinPassingGrade: 4 },
      })
      .returning({ id: studyPlans.id });
    trackedPlanIds.add(peerPlan.id);

    const [peerShared] = await db
      .insert(sharedSubjects)
      .values({
        facultyId: facId,
        stableCode: `${tag}SH_DIB`,
        normalizedName: 'dibujo tecnico',
        displayName: 'Dibujo Técnico',
      })
      .returning({ id: sharedSubjects.id });

    await db.insert(subjects).values({
      planId: peerPlan.id,
      sharedSubjectId: peerShared.id,
      codeInPlan: 1,
      displayCode: 'PAR-1',
      name: 'Dibujo Técnico',
      shortName: 'Dibujo Téc.',
      level: 1,
      modality: 'A',
      contraCuatrimestral: false,
      weeklyHours: '4.0',
      kind: 'obligatoria',
      isOptionalTrack: false,
      isIntegrator: false,
    });

    // Plan published para verificar rechazo 409 PLAN_NOT_DRAFT
    const [pubCareer] = await db
      .insert(careers)
      .values({
        facultyId: facId,
        name: `[VERIFY ${runId}] Carrera Publicada`,
        code: pubCareerCode,
        status: 'published',
      })
      .returning({ id: careers.id });
    trackedCareerIds.add(pubCareer.id);

    const [pubPlan] = await db
      .insert(studyPlans)
      .values({
        careerId: pubCareer.id,
        name: `[VERIFY ${runId}] Plan Publicado`,
        year: 2026,
        status: 'published',
        isActive: true,
        config: { requiredElectiveCredits: 0, defaultMinPassingGrade: 4 },
      })
      .returning({ id: studyPlans.id });
    trackedPlanIds.add(pubPlan.id);

    const xlsxBuffer = buildPlanImportTemplateBuffer();
    const fileBase64 = xlsxBuffer.toString('base64');

    // ----------------------------------------------------------------------
    // PASO 1: Vista previa (solo lectura, 0 escrituras en Postgres)
    // ----------------------------------------------------------------------
    console.log('\n[1/6] Probando previewPlanImport en Neon (debe escribir 0 filas)...');
    const careersBeforePreview = await db.select({ id: careers.id }).from(careers).where(eq(careers.facultyId, facId));
    const plansBeforePreview = await db
      .select({ id: studyPlans.id })
      .from(studyPlans)
      .where(inArray(studyPlans.careerId, careersBeforePreview.map((c) => c.id)));
    const sharedBeforePreview = await db
      .select({ id: sharedSubjects.id })
      .from(sharedSubjects)
      .where(eq(sharedSubjects.facultyId, facId));
    const auditBeforePreview = await db
      .select({ id: adminAuditLog.id })
      .from(adminAuditLog)
      .where(eq(adminAuditLog.adminEmail, tempAdminEmail));

    const initialPreview = await previewPlanImport({
      facultyId: facId,
      targetMode: 'new_career_and_plan',
      careerName: `Ingeniería Ficticia (${runId})`,
      careerCode: fictCareerCode,
      fileName: 'ingenieria-ficticia.xlsx',
      fileBase64,
    });

    assert.equal(initialPreview.valid, true, 'La plantilla Ingeniería Ficticia debe validar en /preview');
    const dibujoSuggestion = initialPreview.sharedSubjectSuggestions.find((s) => s.subjectCode === 1);
    assert.ok(
      dibujoSuggestion?.candidates.some((c) => c.sharedSubjectId === peerShared.id),
      'Debe sugerir la materia compartida Dibujo Técnico de la misma facultad'
    );
    assert.equal(dibujoSuggestion?.selectedDecision, null, 'Nunca debe auto-vincular en plan nuevo');

    const careersAfterPreview = await db.select({ id: careers.id }).from(careers).where(eq(careers.facultyId, facId));
    const plansAfterPreview = await db
      .select({ id: studyPlans.id })
      .from(studyPlans)
      .where(inArray(studyPlans.careerId, careersAfterPreview.map((c) => c.id)));
    const sharedAfterPreview = await db
      .select({ id: sharedSubjects.id })
      .from(sharedSubjects)
      .where(eq(sharedSubjects.facultyId, facId));
    const auditAfterPreview = await db
      .select({ id: adminAuditLog.id })
      .from(adminAuditLog)
      .where(eq(adminAuditLog.adminEmail, tempAdminEmail));

    assert.equal(careersAfterPreview.length, careersBeforePreview.length, 'Preview no debe crear carreras');
    assert.equal(plansAfterPreview.length, plansBeforePreview.length, 'Preview no debe crear planes');
    assert.equal(sharedAfterPreview.length, sharedBeforePreview.length, 'Preview no debe crear shared_subjects');
    assert.equal(auditAfterPreview.length, auditBeforePreview.length, 'Preview no debe escribir audit log');
    console.log('  ✅ Vista previa verificada en Neon: 0 filas escritas, sugerencia compartida sin auto-link');

    // ----------------------------------------------------------------------
    // PASO 2: Importar "Ingeniería Ficticia" en draft
    // ----------------------------------------------------------------------
    console.log('\n[2/6] Importando "Ingeniería Ficticia" en draft vía DrizzlePlanImportStore...');
    const decisions = [
      { subjectCode: 1, action: 'link_existing' as const, sharedSubjectId: peerShared.id },
    ];
    const importPreview = await previewPlanImport({
      facultyId: facId,
      targetMode: 'new_career_and_plan',
      careerName: `Ingeniería Ficticia (${runId})`,
      careerCode: fictCareerCode,
      fileName: 'ingenieria-ficticia.xlsx',
      fileBase64,
      sharedSubjectDecisions: decisions,
    });

    const createdResult = await confirmPlanImport({
      input: {
        facultyId: facId,
        targetMode: 'new_career_and_plan',
        careerName: `Ingeniería Ficticia (${runId})`,
        careerCode: fictCareerCode,
        fileName: 'ingenieria-ficticia.xlsx',
        fileBase64,
        sharedSubjectDecisions: decisions,
        previewHash: importPreview.previewHash,
      },
      adminUserId: tempUserId,
      adminEmail: tempAdminEmail,
      ip: '127.0.0.1',
    });

    assert.equal(createdResult.status, 'draft');
    trackedCareerIds.add(createdResult.careerId);
    trackedPlanIds.add(createdResult.planId);
    assert.equal(createdResult.counts.subjects, 10);
    assert.equal(createdResult.counts.prerequisites, 12);
    assert.equal(createdResult.counts.specialRules, 2);
    assert.equal(createdResult.counts.acronyms, 4);
    assert.equal(createdResult.counts.linkedExistingShared, 1);
    assert.equal(createdResult.counts.createdNewShared, 9);

    const detailAfterCreate = await getAdminPlanDetail(createdResult.planId);
    assert.equal(detailAfterCreate.adminMeta.planStatus, 'draft');
    assert.equal(detailAfterCreate.subjects.length, 10);

    const subsInitial = await db
      .select()
      .from(subjects)
      .where(eq(subjects.planId, createdResult.planId));
    const uuidByCode = new Map(subsInitial.map((s) => [s.codeInPlan, s.id]));
    const sharedByCode = new Map(subsInitial.map((s) => [s.codeInPlan, s.sharedSubjectId]));
    assert.equal(sharedByCode.get(1), peerShared.id);
    console.log(
      `  ✅ Plan draft creado en Neon (planId=${createdResult.planId}, 10 materias, 12 correlativas, 2 reglas, 4 acrónimos)`
    );

    // ----------------------------------------------------------------------
    // PASO 3: Re-importación idempotente (mismos conteos y mismos UUIDs)
    // ----------------------------------------------------------------------
    console.log('\n[3/6] Re-importando idempotentemente sobre el draft existente...');
    const reimportPreview = await previewPlanImport({
      facultyId: facId,
      targetMode: 'existing_draft_plan',
      planId: createdResult.planId,
      fileName: 'ingenieria-ficticia.xlsx',
      fileBase64,
      sharedSubjectDecisions: decisions,
    });
    assert.equal(reimportPreview.draftDiff?.toCreateCodes.length, 0);
    assert.equal(reimportPreview.draftDiff?.toUpdateCodes.length, 10);
    assert.equal(reimportPreview.draftDiff?.toRemoveCodes.length, 0);

    const reimported = await confirmPlanImport({
      input: {
        facultyId: facId,
        targetMode: 'existing_draft_plan',
        planId: createdResult.planId,
        fileName: 'ingenieria-ficticia.xlsx',
        fileBase64,
        sharedSubjectDecisions: decisions,
        previewHash: reimportPreview.previewHash,
      },
      adminUserId: tempUserId,
      adminEmail: tempAdminEmail,
      ip: '127.0.0.1',
    });

    const subsAfterReimport = await db
      .select()
      .from(subjects)
      .where(eq(subjects.planId, createdResult.planId));
    const subIdsAfter = subsAfterReimport.map((s) => s.id);
    const prereqsAfter = await db
      .select()
      .from(subjectPrerequisites)
      .where(inArray(subjectPrerequisites.subjectId, subIdsAfter));
    const rulesAfter = await db
      .select()
      .from(planSpecialRules)
      .where(eq(planSpecialRules.planId, createdResult.planId));
    const acronymsAfter = await db
      .select()
      .from(acronyms)
      .where(eq(acronyms.planId, createdResult.planId));

    assert.equal(reimported.planId, createdResult.planId);
    assert.equal(subsAfterReimport.length, 10);
    assert.equal(prereqsAfter.length, 12);
    assert.equal(rulesAfter.length, 2);
    assert.equal(acronymsAfter.length, 4);
    for (const s of subsAfterReimport) {
      assert.equal(
        s.id,
        uuidByCode.get(s.codeInPlan),
        `UUID de materia ${s.codeInPlan} debe preservarse en re-importación idempotente`
      );
      assert.equal(
        s.sharedSubjectId,
        sharedByCode.get(s.codeInPlan),
        `sharedSubjectId de materia ${s.codeInPlan} debe preservarse`
      );
    }
    console.log('  ✅ Re-importación idempotente verificada: 10/10 UUIDs y conteos exactamente preservados');

    // ----------------------------------------------------------------------
    // PASO 4: Rechazo sobre plan published
    // ----------------------------------------------------------------------
    console.log('\n[4/6] Verificando rechazo al intentar importar sobre un plan published...');
    let publishedRejectedCode: string | null = null;
    try {
      await previewPlanImport({
        facultyId: facId,
        targetMode: 'existing_draft_plan',
        planId: pubPlan.id,
        fileName: 'ingenieria-ficticia.xlsx',
        fileBase64,
      });
    } catch (err) {
      if (err instanceof PlanImportServiceError) {
        publishedRejectedCode = `${err.statusCode}:${err.code}`;
      }
    }
    assert.equal(publishedRejectedCode, '409:PLAN_NOT_DRAFT', 'Debe rechazar re-import sobre plan published');

    let confirmPublishedRejectedCode: string | null = null;
    try {
      await confirmPlanImport({
        input: {
          facultyId: facId,
          targetMode: 'existing_draft_plan',
          planId: pubPlan.id,
          fileName: 'ingenieria-ficticia.xlsx',
          fileBase64,
          previewHash: '0'.repeat(64),
        },
        adminUserId: tempUserId,
        adminEmail: tempAdminEmail,
        ip: '127.0.0.1',
      });
    } catch (err) {
      if (err instanceof PlanImportServiceError) {
        confirmPublishedRejectedCode = `${err.statusCode}:${err.code}`;
      }
    }
    assert.ok(
      confirmPublishedRejectedCode?.startsWith('409:'),
      'confirmPlanImport también debe rechazar el destino published'
    );
    console.log('  ✅ Plan published protegido: rechazado con 409 PLAN_NOT_DRAFT');

    // ----------------------------------------------------------------------
    // PASO 5: Rollback atómico en Postgres ante falla a mitad de escritura
    // ----------------------------------------------------------------------
    console.log('\n[5/6] Probando rollback ACID real en Postgres al forzar falla en replacePlanPrerequisites...');
    const rollbackPreview = await previewPlanImport({
      facultyId: facId,
      targetMode: 'new_career_and_plan',
      careerName: `Ingeniería Ficticia Rollback (${runId})`,
      careerCode: rbCareerCode,
      fileName: 'rollback.xlsx',
      fileBase64,
    });

    class DrizzleRollbackProbeStore extends DrizzlePlanImportStore {
      async runInTransaction<T>(fn: (tx: PlanImportTxContext) => Promise<T>): Promise<T> {
        return super.runInTransaction(async (tx) => {
          const wrappedTx = Object.create(tx) as typeof tx;
          wrappedTx.replacePlanPrerequisites = async (planId, planSubjectIds, rows) => {
            // Fuerza un error real de FK en PostgreSQL luego de haber insertado carrera, plan y materias
            return tx.replacePlanPrerequisites(planId, planSubjectIds, [
              ...rows,
              {
                subjectId: planSubjectIds[0],
                requiresSubjectId: '00000000-0000-0000-0000-000000000000',
                type: 'regular',
              },
            ]);
          };
          return fn(wrappedTx);
        });
      }
    }

    const careersBeforeRollback = await db.select({ id: careers.id }).from(careers).where(eq(careers.facultyId, facId));
    const sharedBeforeRollback = await db
      .select({ id: sharedSubjects.id })
      .from(sharedSubjects)
      .where(eq(sharedSubjects.facultyId, facId));

    let rollbackErrorCaught: unknown = null;
    setPlanImportStoreForTesting(new DrizzleRollbackProbeStore());
    try {
      await confirmPlanImport({
        input: {
          facultyId: facId,
          targetMode: 'new_career_and_plan',
          careerName: `Ingeniería Ficticia Rollback (${runId})`,
          careerCode: rbCareerCode,
          fileName: 'rollback.xlsx',
          fileBase64,
          previewHash: rollbackPreview.previewHash,
        },
        adminUserId: tempUserId,
        adminEmail: tempAdminEmail,
        ip: '127.0.0.1',
      });
    } catch (err) {
      rollbackErrorCaught = err;
    } finally {
      setPlanImportStoreForTesting(null);
    }

    assert.ok(rollbackErrorCaught, 'La violación FK forzada en PostgreSQL debe abortar la transacción');
    const rbCareersLeft = await db
      .select({ id: careers.id })
      .from(careers)
      .where(and(eq(careers.facultyId, facId), eq(careers.code, rbCareerCode)));
    const careersAfterRollback = await db.select({ id: careers.id }).from(careers).where(eq(careers.facultyId, facId));
    const sharedAfterRollback = await db
      .select({ id: sharedSubjects.id })
      .from(sharedSubjects)
      .where(eq(sharedSubjects.facultyId, facId));

    assert.equal(rbCareersLeft.length, 0, 'Rollback debe revertir la carrera parcial');
    assert.equal(careersAfterRollback.length, careersBeforeRollback.length, 'No deben quedar carreras extra');
    assert.equal(sharedAfterRollback.length, sharedBeforeRollback.length, 'Rollback debe revertir shared_subjects nuevas');
    console.log('  ✅ Rollback ACID verificado en Postgres: 0 registros huérfanos tras error FK en correlativas');

    // ----------------------------------------------------------------------
    // PASO 6: DELETE draft limpia sus registros, preserva shared compartidas y limpia carrera draft vacía
    // ----------------------------------------------------------------------
    console.log('\n[6/6] Probando deleteAdminDraftPlan (carrera draft vacía, 2 planes y carrera published)...');
    const sharedBeforeDelete = await db
      .select({ id: sharedSubjects.id })
      .from(sharedSubjects)
      .where(eq(sharedSubjects.facultyId, facId));
    assert.equal(sharedBeforeDelete.length, 10, 'Antes de borrar: 1 shared compartida + 9 exclusivas del draft');

    const deleteSingleRes = await deleteAdminDraftPlan({
      planId: createdResult.planId,
      adminUserId: tempUserId,
      adminEmail: tempAdminEmail,
      ip: '127.0.0.1',
    });

    const deletedPlans = await db.select({ id: studyPlans.id }).from(studyPlans).where(eq(studyPlans.id, createdResult.planId));
    const deletedCareerRows = await db.select({ id: careers.id }).from(careers).where(eq(careers.id, createdResult.careerId));
    const deletedSubs = await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.planId, createdResult.planId));
    const deletedRules = await db.select({ id: planSpecialRules.id }).from(planSpecialRules).where(eq(planSpecialRules.planId, createdResult.planId));
    const deletedAcronyms = await db.select({ id: acronyms.id }).from(acronyms).where(eq(acronyms.planId, createdResult.planId));
    const sharedAfterDelete = await db
      .select({ id: sharedSubjects.id })
      .from(sharedSubjects)
      .where(eq(sharedSubjects.facultyId, facId));

    assert.equal(deletedPlans.length, 0, 'El plan borrador debe eliminarse');
    assert.equal(deleteSingleRes.deletedCareer, true, 'Al borrar el último plan de una carrera draft debe informar deletedCareer=true');
    assert.equal(deleteSingleRes.deletedCareerId, createdResult.careerId);
    assert.equal(deletedCareerRows.length, 0, 'Al borrar el último plan de una carrera draft debe eliminarse la carrera');
    assert.equal(deletedSubs.length, 0, 'Las materias del borrador deben eliminarse por cascada');
    assert.equal(deletedRules.length, 0, 'Las reglas del borrador deben eliminarse por cascada');
    assert.equal(deletedAcronyms.length, 0, 'Los acrónimos del borrador deben eliminarse por cascada');
    assert.deepEqual(
      sharedAfterDelete.map((s) => s.id),
      [peerShared.id],
      'DELETE debe limpiar las 9 shared_subjects huérfanas y preservar la compartida con el plan par'
    );

    // Subcaso 6b: carrera 'draft' con DOS planes -> borrar el primero conserva la carrera; borrar el segundo la elimina
    const [twoPlanCareer] = await db
      .insert(careers)
      .values({
        facultyId: facId,
        name: `[VERIFY ${runId}] Carrera Dos Planes`,
        code: twoPlanCareerCode,
        status: 'draft',
      })
      .returning({ id: careers.id });
    trackedCareerIds.add(twoPlanCareer.id);

    const [twoPlanA] = await db
      .insert(studyPlans)
      .values({
        careerId: twoPlanCareer.id,
        name: `[VERIFY ${runId}] Plan A`,
        year: 2026,
        status: 'draft',
        isActive: true,
        config: { requiredElectiveCredits: 0, defaultMinPassingGrade: 4 },
      })
      .returning({ id: studyPlans.id });
    const [twoPlanB] = await db
      .insert(studyPlans)
      .values({
        careerId: twoPlanCareer.id,
        name: `[VERIFY ${runId}] Plan B`,
        year: 2027,
        status: 'draft',
        isActive: true,
        config: { requiredElectiveCredits: 0, defaultMinPassingGrade: 4 },
      })
      .returning({ id: studyPlans.id });
    trackedPlanIds.add(twoPlanA.id);
    trackedPlanIds.add(twoPlanB.id);

    const delTwoARes = await deleteAdminDraftPlan({
      planId: twoPlanA.id,
      adminUserId: tempUserId,
      adminEmail: tempAdminEmail,
      ip: '127.0.0.1',
    });
    const twoCareerAfterA = await db.select({ id: careers.id }).from(careers).where(eq(careers.id, twoPlanCareer.id));
    const twoPlanBStillThere = await db.select({ id: studyPlans.id }).from(studyPlans).where(eq(studyPlans.id, twoPlanB.id));
    assert.equal(delTwoARes.deletedCareer, false, 'Carrera draft con 2 planes: borrar el primero NO borra la carrera');
    assert.equal(twoCareerAfterA.length, 1, 'La carrera draft con 2do plan activo debe seguir existiendo');
    assert.equal(twoPlanBStillThere.length, 1, 'El segundo plan debe seguir intacto');

    const delTwoBRes = await deleteAdminDraftPlan({
      planId: twoPlanB.id,
      adminUserId: tempUserId,
      adminEmail: tempAdminEmail,
      ip: '127.0.0.1',
    });
    const twoCareerAfterB = await db.select({ id: careers.id }).from(careers).where(eq(careers.id, twoPlanCareer.id));
    assert.equal(delTwoBRes.deletedCareer, true, 'Carrera draft con 2 planes: borrar el último SÍ borra la carrera');
    assert.equal(twoCareerAfterB.length, 0, 'La carrera draft vacía debe quedar eliminada');

    // Subcaso 6c: carrera 'published' con un último plan draft -> el plan se borra pero la carrera published NO se toca
    const [pubOnlyDraftCareer] = await db
      .insert(careers)
      .values({
        facultyId: facId,
        name: `[VERIFY ${runId}] Carrera Published Protegida`,
        code: pubOnlyDraftCareerCode,
        status: 'published',
      })
      .returning({ id: careers.id });
    trackedCareerIds.add(pubOnlyDraftCareer.id);

    const [draftUnderPubPlan] = await db
      .insert(studyPlans)
      .values({
        careerId: pubOnlyDraftCareer.id,
        name: `[VERIFY ${runId}] Draft en Published`,
        year: 2028,
        status: 'draft',
        isActive: true,
        config: { requiredElectiveCredits: 0, defaultMinPassingGrade: 4 },
      })
      .returning({ id: studyPlans.id });
    trackedPlanIds.add(draftUnderPubPlan.id);

    const delUnderPubRes = await deleteAdminDraftPlan({
      planId: draftUnderPubPlan.id,
      adminUserId: tempUserId,
      adminEmail: tempAdminEmail,
      ip: '127.0.0.1',
    });
    const pubCareerStillExists = await db
      .select({ id: careers.id, status: careers.status })
      .from(careers)
      .where(eq(careers.id, pubOnlyDraftCareer.id));
    assert.equal(delUnderPubRes.deletedCareer, false, 'Carrera published NO debe borrarse aunque quede sin planes');
    assert.equal(pubCareerStillExists.length, 1);
    assert.equal(pubCareerStillExists[0].status, 'published');

    console.log('  ✅ DELETE draft verificado: huérfanas, carrera draft vacía (1 y 2 planes) y protección de carrera published');

    console.log('\n======================================================================');
    console.log(' 🎉 TODAS LAS VERIFICACIONES DRIZZLE EN NEON PASARON EXITOSAMENTE');
    console.log('======================================================================\n');
  } finally {
    console.log('🧹 Limpiando registros temporales por orden seguro de FK (SIN tocar admin_audit_log)...');
    setPlanImportStoreForTesting(null);

    const cleanupErrors: Array<{ table: string; message: string }> = [];
    const safeExec = async (table: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await fn();
      } catch (err) {
        cleanupErrors.push({
          table,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    const allCareerIdsSet = new Set<string>(trackedCareerIds);
    const allPlanIdsSet = new Set<string>(trackedPlanIds);
    const allSubjectIdsSet = new Set<string>(trackedSubjectIds);

    await safeExec('discover_ids', async () => {
      if (facId) {
        const facCareers = await db.select({ id: careers.id }).from(careers).where(eq(careers.facultyId, facId));
        for (const r of facCareers) allCareerIdsSet.add(r.id);
      }
      const cIds = Array.from(allCareerIdsSet);
      if (cIds.length > 0) {
        const facPlans = await db.select({ id: studyPlans.id }).from(studyPlans).where(inArray(studyPlans.careerId, cIds));
        for (const r of facPlans) allPlanIdsSet.add(r.id);
      }
      const pIds = Array.from(allPlanIdsSet);
      if (pIds.length > 0) {
        const facSubs = await db.select({ id: subjects.id }).from(subjects).where(inArray(subjects.planId, pIds));
        for (const r of facSubs) allSubjectIdsSet.add(r.id);
      }
    });

    const allCareerIds = Array.from(allCareerIdsSet);
    const allPlanIds = Array.from(allPlanIdsSet);
    const allSubjectIds = Array.from(allSubjectIdsSet);

    await safeExec('acronyms', async () => {
      if (allPlanIds.length > 0) {
        await db.delete(acronyms).where(inArray(acronyms.planId, allPlanIds));
      }
    });
    await safeExec('plan_special_rules', async () => {
      if (allPlanIds.length > 0) {
        await db.delete(planSpecialRules).where(inArray(planSpecialRules.planId, allPlanIds));
      }
    });
    await safeExec('subject_prerequisites', async () => {
      if (allSubjectIds.length > 0) {
        await db
          .delete(subjectPrerequisites)
          .where(
            or(
              inArray(subjectPrerequisites.subjectId, allSubjectIds),
              inArray(subjectPrerequisites.requiresSubjectId, allSubjectIds)
            )
          );
      }
    });
    await safeExec('subjects', async () => {
      if (allPlanIds.length > 0) {
        await db.delete(subjects).where(inArray(subjects.planId, allPlanIds));
      }
    });
    await safeExec('shared_subjects', async () => {
      if (facId) {
        await db.delete(sharedSubjects).where(eq(sharedSubjects.facultyId, facId));
      }
    });
    await safeExec('study_plans', async () => {
      if (allPlanIds.length > 0 || allCareerIds.length > 0) {
        const cond =
          allPlanIds.length > 0 && allCareerIds.length > 0
            ? or(inArray(studyPlans.id, allPlanIds), inArray(studyPlans.careerId, allCareerIds))
            : allPlanIds.length > 0
              ? inArray(studyPlans.id, allPlanIds)
              : inArray(studyPlans.careerId, allCareerIds);
        await db.delete(studyPlans).where(cond);
      }
    });
    await safeExec('careers', async () => {
      if (facId || allCareerIds.length > 0) {
        const cond =
          facId && allCareerIds.length > 0
            ? or(eq(careers.facultyId, facId), inArray(careers.id, allCareerIds))
            : facId
              ? eq(careers.facultyId, facId)
              : inArray(careers.id, allCareerIds);
        await db.delete(careers).where(cond);
      }
    });
    await safeExec('faculties', async () => {
      if (facId || instId) {
        const cond =
          facId && instId
            ? or(eq(faculties.id, facId), eq(faculties.institutionId, instId))
            : facId
              ? eq(faculties.id, facId)
              : eq(faculties.institutionId, instId!);
        await db.delete(faculties).where(cond);
      }
    });
    await safeExec('institutions', async () => {
      if (instId) {
        await db.delete(institutions).where(eq(institutions.id, instId));
      }
    });
    await safeExec('users', async () => {
      if (tempUserId) {
        // ON DELETE SET NULL actualiza únicamente admin_user_id = NULL en admin_audit_log (permitido por el trigger).
        await db.delete(users).where(eq(users.id, tempUserId));
      }
    });

    const leftovers: Record<string, number> = {};
    const safeCount = async (table: string, fn: () => Promise<number>): Promise<void> => {
      try {
        leftovers[table] = await fn();
      } catch (err) {
        leftovers[table] = -1;
        cleanupErrors.push({
          table: `count(${table})`,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    await safeCount('acronyms', async () =>
      allPlanIds.length > 0
        ? Number((await db.select({ value: count() }).from(acronyms).where(inArray(acronyms.planId, allPlanIds)))[0]?.value ?? 0)
        : 0
    );
    await safeCount('plan_special_rules', async () =>
      allPlanIds.length > 0
        ? Number((await db.select({ value: count() }).from(planSpecialRules).where(inArray(planSpecialRules.planId, allPlanIds)))[0]?.value ?? 0)
        : 0
    );
    await safeCount('subject_prerequisites', async () =>
      allSubjectIds.length > 0
        ? Number(
            (
              await db
                .select({ value: count() })
                .from(subjectPrerequisites)
                .where(
                  or(
                    inArray(subjectPrerequisites.subjectId, allSubjectIds),
                    inArray(subjectPrerequisites.requiresSubjectId, allSubjectIds)
                  )
                )
            )[0]?.value ?? 0
          )
        : 0
    );
    await safeCount('subjects', async () =>
      allPlanIds.length > 0
        ? Number((await db.select({ value: count() }).from(subjects).where(inArray(subjects.planId, allPlanIds)))[0]?.value ?? 0)
        : 0
    );
    await safeCount('shared_subjects', async () =>
      facId
        ? Number((await db.select({ value: count() }).from(sharedSubjects).where(eq(sharedSubjects.facultyId, facId)))[0]?.value ?? 0)
        : 0
    );
    await safeCount('study_plans', async () =>
      allPlanIds.length > 0 || allCareerIds.length > 0
        ? Number(
            (
              await db
                .select({ value: count() })
                .from(studyPlans)
                .where(
                  allPlanIds.length > 0 && allCareerIds.length > 0
                    ? or(inArray(studyPlans.id, allPlanIds), inArray(studyPlans.careerId, allCareerIds))
                    : allPlanIds.length > 0
                      ? inArray(studyPlans.id, allPlanIds)
                      : inArray(studyPlans.careerId, allCareerIds)
                )
            )[0]?.value ?? 0
          )
        : 0
    );
    await safeCount('careers', async () =>
      facId || allCareerIds.length > 0
        ? Number(
            (
              await db
                .select({ value: count() })
                .from(careers)
                .where(
                  facId && allCareerIds.length > 0
                    ? or(eq(careers.facultyId, facId), inArray(careers.id, allCareerIds))
                    : facId
                      ? eq(careers.facultyId, facId)
                      : inArray(careers.id, allCareerIds)
                )
            )[0]?.value ?? 0
          )
        : 0
    );
    await safeCount('faculties', async () =>
      facId
        ? Number((await db.select({ value: count() }).from(faculties).where(eq(faculties.id, facId)))[0]?.value ?? 0)
        : 0
    );
    await safeCount('institutions', async () =>
      instId
        ? Number((await db.select({ value: count() }).from(institutions).where(eq(institutions.id, instId)))[0]?.value ?? 0)
        : 0
    );
    await safeCount('users', async () =>
      tempUserId
        ? Number((await db.select({ value: count() }).from(users).where(eq(users.id, tempUserId)))[0]?.value ?? 0)
        : 0
    );

    let auditRowsCount = 0;
    await safeExec('count(admin_audit_log)', async () => {
      const [auditRow] = await db
        .select({ value: count() })
        .from(adminAuditLog)
        .where(eq(adminAuditLog.adminEmail, tempAdminEmail));
      auditRowsCount = Number(auditRow?.value ?? 0);
    });

    let finalCounts: Awaited<ReturnType<typeof readGlobalCounts>> | null = null;
    await safeExec('readGlobalCounts(final)', async () => {
      finalCounts = await readGlobalCounts();
    });

    console.log('\n📋 Resumen de residuos temporales en tablas no-auditoría:');
    for (const [table, qty] of Object.entries(leftovers)) {
      console.log(`   - ${table}: ${qty}`);
    }
    console.log(
      `ℹ️ admin_audit_log (resto esperado por diseño — tabla inmutable): ${auditRowsCount} fila(s) para prefijo=${tag} (${tempAdminEmail}); NO cuenta como fallo.`
    );

    let globalCountMismatch = false;
    if (initialCounts && finalCounts) {
      const fin = finalCounts as NonNullable<typeof finalCounts>;
      const keys: Array<keyof typeof initialCounts> = [
        'careers',
        'study_plans',
        'subjects',
        'shared_subjects',
        'subject_prerequisites',
      ];
      console.log('\n📊 Comparación de conteos globales (inicial -> final):');
      for (const k of keys) {
        const diff = fin[k] - initialCounts[k];
        if (diff !== 0) globalCountMismatch = true;
        console.log(`   - ${k}: ${initialCounts[k]} -> ${fin[k]} (diff: ${diff >= 0 ? `+${diff}` : diff})`);
      }
    } else if (!finalCounts) {
      globalCountMismatch = true;
    }

    try {
      const nonZeroLeftovers = Object.entries(leftovers).filter(([, qty]) => qty !== 0);
      if (cleanupErrors.length > 0 || nonZeroLeftovers.length > 0 || globalCountMismatch) {
        console.error('\n❌ Quedaron errores o residuos distintos de admin_audit_log tras la limpieza:');
        for (const e of cleanupErrors) {
          console.error(`   - [${e.table}] ${e.message}`);
        }
        for (const [t, qty] of nonZeroLeftovers) {
          console.error(`   - Residuo en ${t}: ${qty}`);
        }
        process.exitCode = 1;
      } else {
        console.log('\n✅ Limpieza verificada: 0 residuos distintos de la auditoría y conteos globales restaurados.');
      }
    } finally {
      await pool.end().catch(() => undefined);
    }
  }
}

run().catch((err) => {
  console.error('\n❌ Falló verifyImportNeon.ts:', err);
  process.exit(1);
});
