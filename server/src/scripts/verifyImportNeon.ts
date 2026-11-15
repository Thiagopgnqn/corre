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
  const { and, eq, inArray } = await import('drizzle-orm');
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

  let tempUserId: string | null = null;
  let instId: string | null = null;
  let facId: string | null = null;

  try {
    setPlanImportStoreForTesting(null);

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
    // PASO 6: DELETE draft limpia sus registros y preserva shared_subjects compartidas
    // ----------------------------------------------------------------------
    console.log('\n[6/6] Probando deleteAdminDraftPlan y preservación de shared_subjects compartidas...');
    const sharedBeforeDelete = await db
      .select({ id: sharedSubjects.id })
      .from(sharedSubjects)
      .where(eq(sharedSubjects.facultyId, facId));
    assert.equal(sharedBeforeDelete.length, 10, 'Antes de borrar: 1 shared compartida + 9 exclusivas del draft');

    await deleteAdminDraftPlan({
      planId: createdResult.planId,
      adminUserId: tempUserId,
      adminEmail: tempAdminEmail,
      ip: '127.0.0.1',
    });

    const deletedPlans = await db.select({ id: studyPlans.id }).from(studyPlans).where(eq(studyPlans.id, createdResult.planId));
    const deletedSubs = await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.planId, createdResult.planId));
    const deletedRules = await db.select({ id: planSpecialRules.id }).from(planSpecialRules).where(eq(planSpecialRules.planId, createdResult.planId));
    const deletedAcronyms = await db.select({ id: acronyms.id }).from(acronyms).where(eq(acronyms.planId, createdResult.planId));
    const sharedAfterDelete = await db
      .select({ id: sharedSubjects.id })
      .from(sharedSubjects)
      .where(eq(sharedSubjects.facultyId, facId));

    assert.equal(deletedPlans.length, 0, 'El plan borrador debe eliminarse');
    assert.equal(deletedSubs.length, 0, 'Las materias del borrador deben eliminarse por cascada');
    assert.equal(deletedRules.length, 0, 'Las reglas del borrador deben eliminarse por cascada');
    assert.equal(deletedAcronyms.length, 0, 'Los acrónimos del borrador deben eliminarse por cascada');
    assert.deepEqual(
      sharedAfterDelete.map((s) => s.id),
      [peerShared.id],
      'DELETE debe limpiar las 9 shared_subjects huérfanas y preservar la compartida con el plan par'
    );
    console.log('  ✅ DELETE draft verificado: borró 9 huérfanas y conservó shared_subject compartida');

    console.log('\n======================================================================');
    console.log(' 🎉 TODAS LAS VERIFICACIONES DRIZZLE EN NEON PASARON EXITOSAMENTE');
    console.log('======================================================================\n');
  } finally {
    console.log('🧹 Limpiando TODOS los registros temporales de verificación...');
    try {
      setPlanImportStoreForTesting(null);
      await db.delete(adminAuditLog).where(eq(adminAuditLog.adminEmail, tempAdminEmail));
      if (instId) {
        await db.delete(institutions).where(eq(institutions.id, instId));
      }
      if (tempUserId) {
        await db.delete(users).where(eq(users.id, tempUserId));
      }

      const leftoverInst = instId
        ? await db.select({ id: institutions.id }).from(institutions).where(eq(institutions.id, instId))
        : [];
      const leftoverAudit = await db
        .select({ id: adminAuditLog.id })
        .from(adminAuditLog)
        .where(eq(adminAuditLog.adminEmail, tempAdminEmail));
      const leftoverUsers = tempUserId
        ? await db.select({ id: users.id }).from(users).where(eq(users.id, tempUserId))
        : [];

      assert.equal(leftoverInst.length, 0);
      assert.equal(leftoverAudit.length, 0);
      assert.equal(leftoverUsers.length, 0);
      console.log('✅ Limpieza verificada: 0 registros temporales restantes en la base.');
    } catch (cleanupErr) {
      console.error('❌ Error durante la limpieza en finally:', cleanupErr);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  }
}

run().catch((err) => {
  console.error('\n❌ Falló verifyImportNeon.ts:', err);
  process.exit(1);
});
