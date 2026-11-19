import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type ExpectedSchema = '0014' | '0015';
type ScriptMode = 'seed' | 'check-post-0015' | 'verify' | 'cleanup';

const VALID_MODES: readonly ScriptMode[] = ['seed', 'check-post-0015', 'verify', 'cleanup'];
const VERIFY_CLEANUP_PREFIX = '__VERIFY_US_';
const SEED_PREFIX = '__VERIFY_US_SEED__';
const SEED_EMAIL = '__verify_us_seed__@verify.local';

function escapeLikePattern(literalPrefix: string): string {
  return literalPrefix.replace(/([!_%])/g, '!$1');
}

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

function parseFlagValue(argv: string[], flagName: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith(`${flagName}=`)) {
      return arg.slice(flagName.length + 1).trim();
    }
    if (arg === flagName && argv[i + 1]) {
      return argv[i + 1].trim();
    }
  }
  return null;
}

function loadServerEnvWithoutConnecting(): void {
  // Si DATABASE_URL ya viene de la sesión de PowerShell, NO leer server/.env
  // para evitar inyectar variables externas (EMAIL_PROVIDER, R2_*, GOOGLE_*, etc.).
  if (process.env.DATABASE_URL?.trim()) {
    return;
  }
  const candidateEnvPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(candidateEnvPath)) {
    dotenv.config({ path: candidateEnvPath });
  } else {
    dotenv.config();
  }
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const modeRaw = parseFlagValue(argv, '--mode');
  if (!modeRaw || !VALID_MODES.includes(modeRaw as ScriptMode)) {
    console.error(
      modeRaw === null
        ? '❌ Falta el parámetro obligatorio --mode=<seed|check-post-0015|verify|cleanup>.'
        : `❌ Valor inválido en --mode=${modeRaw}. Valores válidos: ${VALID_MODES.join(' | ')}.`
    );
    console.error(
      '   Ejemplo PowerShell: $env:ALLOW_DESTRUCTIVE_TEST="1"; npm --prefix server run verify:user-state-neon -- --mode=verify --host-ok=<host>'
    );
    process.exit(1);
  }
  const mode = modeRaw as ScriptMode;

  // 1. Guarda de seguridad obligatoria antes de leer credenciales o abrir sockets
  if (process.env.ALLOW_DESTRUCTIVE_TEST !== '1') {
    console.error('❌ BLOQUEADO: este script lee/escribe/borra registros de verificación en PostgreSQL/Neon.');
    console.error('   Para ejecutarlo manualmente contra una RAMA TEMPORAL (NUNCA producción):');
    console.error(
      `   $env:ALLOW_DESTRUCTIVE_TEST="1"; npm --prefix server run verify:user-state-neon -- --mode=${mode} --host-ok=<host>`
    );
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
  console.log(` 🧪 VERIFICACIÓN USER STATE MULTI-PLAN (--mode=${mode})`);
  console.log('======================================================================');
  console.log(`🌐 HOST detectado en DATABASE_URL: ${dbHost}`);
  if (directHost) {
    console.log(`🌐 HOST detectado en DIRECT_URL:   ${directHost}`);
  }
  console.log(`🎯 --host-ok valida exactamente el host de DATABASE_URL: ${dbHost}`);

  const hostOk = parseFlagValue(argv, '--host-ok');
  if (!hostOk || hostOk !== dbHost) {
    console.error('\n❌ Confirmación de host faltante o no coincidente (--host-ok debe coincidir con DATABASE_URL host).');
    console.error('   Verificá que el host pertenezca a tu RAMA TEMPORAL de Neon (no producción) y confirmalo con:');
    console.error(
      `   $env:ALLOW_DESTRUCTIVE_TEST='1'; npm --prefix server run verify:user-state-neon -- --mode=${mode} --host-ok='${dbHost}'`
    );
    process.exit(1);
  }

  const expectRaw = parseFlagValue(argv, '--expect-schema');
  let expectedSchema: ExpectedSchema | null = null;
  if (expectRaw !== null) {
    if (expectRaw !== '0014' && expectRaw !== '0015') {
      console.error(`❌ Valor inválido en --expect-schema=${expectRaw} (esperado: 0014 o 0015).`);
      process.exit(1);
    }
    expectedSchema = expectRaw;
  }

  process.env.JWT_SECRET ||= 'verify_user_state_neon_jwt_secret_local_only_32';
  process.env.REFRESH_SECRET ||= 'verify_user_state_neon_refresh_secret_local_only_32';

  const { and, count, eq, inArray } = await import('drizzle-orm');
  const express = (await import('express')).default;
  const { db, pool } = await import('../db/index.js');
  const {
    careers,
    electiveAssignments,
    faculties,
    finalExamAttempts,
    institutions,
    libraryFiles,
    scheduleProposals,
    scheduleSelections,
    scheduleTerms,
    studyPlans,
    subjectProgress,
    subjects,
    userBasket,
    userSettings,
    users,
  } = await import('../db/schema.js');
  const { DrizzleUserStateStore } = await import('../modules/user-state/userState.store.js');
  const { createUserStateHandlers } = await import('../modules/user-state/userState.controller.js');
  const { DrizzleReviewsStore } = await import('../modules/reviews/reviews.store.js');
  const { PgLibraryService } = await import('../modules/library/library.service.js');
  const { MemoryMockR2Service } = await import('../services/r2.service.js');

  const runId = `${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const prefix = `__VERIFY_US_RUN_${runId}__`;

  const created = {
    instId: null as string | null,
    facId: null as string | null,
    careerIds: [] as string[],
    planIds: [] as string[],
    subjectIds: [] as string[],
    termId: null as string | null,
    userId: null as string | null,
    libraryFileIds: [] as string[],
  };

  async function readGlobalCounts() {
    const [
      instRows,
      facRows,
      carRows,
      planRows,
      subRows,
      termRows,
      userRows,
      setRows,
      elecRows,
      selRows,
      propRows,
      libRows,
    ] = await Promise.all([
      db.select({ value: count() }).from(institutions),
      db.select({ value: count() }).from(faculties),
      db.select({ value: count() }).from(careers),
      db.select({ value: count() }).from(studyPlans),
      db.select({ value: count() }).from(subjects),
      db.select({ value: count() }).from(scheduleTerms),
      db.select({ value: count() }).from(users),
      db.select({ value: count() }).from(userSettings),
      db.select({ value: count() }).from(electiveAssignments),
      db.select({ value: count() }).from(scheduleSelections),
      db.select({ value: count() }).from(scheduleProposals),
      db.select({ value: count() }).from(libraryFiles),
    ]);

    return {
      institutions: Number(instRows[0]?.value ?? 0),
      faculties: Number(facRows[0]?.value ?? 0),
      careers: Number(carRows[0]?.value ?? 0),
      study_plans: Number(planRows[0]?.value ?? 0),
      subjects: Number(subRows[0]?.value ?? 0),
      schedule_terms: Number(termRows[0]?.value ?? 0),
      users: Number(userRows[0]?.value ?? 0),
      user_settings: Number(setRows[0]?.value ?? 0),
      elective_assignments: Number(elecRows[0]?.value ?? 0),
      schedule_selections: Number(selRows[0]?.value ?? 0),
      schedule_proposals: Number(propRows[0]?.value ?? 0),
      library_files: Number(libRows[0]?.value ?? 0),
    };
  }

  async function inspectSchemaState(): Promise<{
    detected: ExpectedSchema;
    pkCols: string[];
    hasLegacyUniqueSel: boolean;
    settingsPlanNotNull: boolean;
  }> {
    const pkRes = await pool.query<{ attname: string }>(`
      SELECT a.attname::text AS attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey::int2[])
      WHERE i.indrelid = 'public.user_settings'::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey::int2[], a.attnum)
    `);
    const pkCols = pkRes.rows.map((r) => r.attname);

    const legacyRes = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.schedule_selections'::regclass
          AND conname = 'uq_user_schedule_selection'
      ) AS exists
    `);
    const hasLegacyUniqueSel = Boolean(legacyRes.rows[0]?.exists);

    const nullRes = await pool.query<{ is_nullable: string }>(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user_settings'
        AND column_name = 'plan_id'
    `);
    const settingsPlanNotNull = nullRes.rows[0]?.is_nullable === 'NO';

    const detected: ExpectedSchema =
      pkCols.length === 2 &&
      pkCols[0] === 'user_id' &&
      pkCols[1] === 'plan_id' &&
      !hasLegacyUniqueSel &&
      settingsPlanNotNull
        ? '0015'
        : '0014';

    return { detected, pkCols, hasLegacyUniqueSel, settingsPlanNotNull };
  }

  async function cleanMatchingTestRecords(literalPrefix: string): Promise<Record<string, number>> {
    const pat = `${escapeLikePattern(literalPrefix)}%`;
    const patLower = `${escapeLikePattern(literalPrefix.toLowerCase())}%`;

    const instRes = await pool.query<{ id: string }>(
      `SELECT id FROM institutions WHERE name LIKE $1 ESCAPE '!' OR code LIKE $1 ESCAPE '!'`,
      [pat]
    );
    const instIds = instRes.rows.map((r) => r.id);

    const facRes = await pool.query<{ id: string }>(
      `SELECT id FROM faculties WHERE name LIKE $1 ESCAPE '!' OR code LIKE $1 ESCAPE '!' OR institution_id = ANY($2::uuid[])`,
      [pat, instIds]
    );
    const facIds = facRes.rows.map((r) => r.id);

    const carRes = await pool.query<{ id: string }>(
      `SELECT id FROM careers WHERE name LIKE $1 ESCAPE '!' OR code LIKE $1 ESCAPE '!' OR faculty_id = ANY($2::uuid[])`,
      [pat, facIds]
    );
    const careerIds = carRes.rows.map((r) => r.id);

    const planRes = await pool.query<{ id: string }>(
      `SELECT id FROM study_plans WHERE name LIKE $1 ESCAPE '!' OR career_id = ANY($2::uuid[])`,
      [pat, careerIds]
    );
    const planIds = planRes.rows.map((r) => r.id);

    const subRes = await pool.query<{ id: string }>(
      `SELECT id FROM subjects WHERE name LIKE $1 ESCAPE '!' OR plan_id = ANY($2::uuid[])`,
      [pat, planIds]
    );
    const subjectIds = subRes.rows.map((r) => r.id);

    const termRes = await pool.query<{ id: string }>(
      `SELECT id FROM schedule_terms WHERE label LIKE $1 ESCAPE '!' OR faculty_id = ANY($2::uuid[])`,
      [pat, facIds]
    );
    const termIds = termRes.rows.map((r) => r.id);

    const userRes = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE LOWER(email) LIKE $1 ESCAPE '!'`,
      [patLower]
    );
    const userIds = userRes.rows.map((r) => r.id);

    const libRes = await pool.query<{ id: string }>(
      `SELECT id FROM library_files
       WHERE title LIKE $1 ESCAPE '!'
          OR storage_key LIKE $1 ESCAPE '!'
          OR uploader_user_id = ANY($2::uuid[])
          OR subject_id = ANY($3::uuid[])
          OR source_subject_id = ANY($3::uuid[])
          OR source_plan_id = ANY($4::uuid[])`,
      [pat, userIds, subjectIds, planIds]
    );
    const libIds = libRes.rows.map((r) => r.id);

    // Orden estricto por FK; NUNCA se toca admin_audit_log
    await pool.query(`DELETE FROM library_files WHERE id = ANY($1::uuid[])`, [libIds]);
    await pool.query(
      `DELETE FROM final_exam_attempts WHERE user_id = ANY($1::uuid[]) OR subject_id = ANY($2::uuid[])`,
      [userIds, subjectIds]
    );
    await pool.query(
      `DELETE FROM elective_assignments WHERE user_id = ANY($1::uuid[]) OR subject_id = ANY($2::uuid[])`,
      [userIds, subjectIds]
    );
    await pool.query(
      `DELETE FROM subject_progress WHERE user_id = ANY($1::uuid[]) OR subject_id = ANY($2::uuid[])`,
      [userIds, subjectIds]
    );
    await pool.query(
      `DELETE FROM user_basket WHERE user_id = ANY($1::uuid[]) OR subject_id = ANY($2::uuid[])`,
      [userIds, subjectIds]
    );
    await pool.query(
      `DELETE FROM schedule_proposals WHERE user_id = ANY($1::uuid[]) OR plan_id = ANY($2::uuid[]) OR schedule_term_id = ANY($3::uuid[])`,
      [userIds, planIds, termIds]
    );
    await pool.query(
      `DELETE FROM schedule_selections WHERE user_id = ANY($1::uuid[]) OR plan_id = ANY($2::uuid[]) OR schedule_term_id = ANY($3::uuid[])`,
      [userIds, planIds, termIds]
    );
    await pool.query(
      `DELETE FROM user_settings WHERE user_id = ANY($1::uuid[]) OR plan_id = ANY($2::uuid[])`,
      [userIds, planIds]
    );
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
    await pool.query(`DELETE FROM schedule_terms WHERE id = ANY($1::uuid[])`, [termIds]);
    await pool.query(
      `DELETE FROM subject_prerequisites WHERE subject_id = ANY($1::uuid[]) OR requires_subject_id = ANY($1::uuid[])`,
      [subjectIds]
    );
    await pool.query(`DELETE FROM subjects WHERE id = ANY($1::uuid[])`, [subjectIds]);
    await pool.query(`DELETE FROM study_plans WHERE id = ANY($1::uuid[])`, [planIds]);
    await pool.query(`DELETE FROM careers WHERE id = ANY($1::uuid[])`, [careerIds]);
    await pool.query(
      `DELETE FROM professors WHERE faculty_id = ANY($1::uuid[]) OR LOWER(display_name) LIKE $2 ESCAPE '!'`,
      [facIds, patLower]
    );
    await pool.query(`DELETE FROM faculties WHERE id = ANY($1::uuid[])`, [facIds]);
    await pool.query(`DELETE FROM institutions WHERE id = ANY($1::uuid[])`, [instIds]);

    const [remInst, remFac, remCar, remPlan, remSub, remTerm, remUser, remLib] = await Promise.all([
      pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM institutions WHERE name LIKE $1 ESCAPE '!' OR code LIKE $1 ESCAPE '!'`, [pat]),
      pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM faculties WHERE name LIKE $1 ESCAPE '!' OR code LIKE $1 ESCAPE '!'`, [pat]),
      pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM careers WHERE name LIKE $1 ESCAPE '!' OR code LIKE $1 ESCAPE '!'`, [pat]),
      pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM study_plans WHERE name LIKE $1 ESCAPE '!'`, [pat]),
      pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM subjects WHERE name LIKE $1 ESCAPE '!'`, [pat]),
      pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM schedule_terms WHERE label LIKE $1 ESCAPE '!'`, [pat]),
      pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM users WHERE LOWER(email) LIKE $1 ESCAPE '!'`, [patLower]),
      pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM library_files WHERE title LIKE $1 ESCAPE '!' OR storage_key LIKE $1 ESCAPE '!'`, [pat]),
    ]);

    return {
      institutions: remInst.rows[0]?.c ?? 0,
      faculties: remFac.rows[0]?.c ?? 0,
      careers: remCar.rows[0]?.c ?? 0,
      study_plans: remPlan.rows[0]?.c ?? 0,
      subjects: remSub.rows[0]?.c ?? 0,
      schedule_terms: remTerm.rows[0]?.c ?? 0,
      users: remUser.rows[0]?.c ?? 0,
      library_files: remLib.rows[0]?.c ?? 0,
    };
  }

  let initialCounts: Awaited<ReturnType<typeof readGlobalCounts>> | null = null;
  let server: http.Server | null = null;
  const expectZeroGlobalDiff = mode === 'verify' || mode === 'check-post-0015';

  try {
    initialCounts = await readGlobalCounts();

    const schemaState = await inspectSchemaState();
    console.log(
      `\n🔎 Esquema detectado: ${schemaState.detected} | PK(user_settings)=(${schemaState.pkCols.join(
        ', '
      )}) | uq_user_schedule_selection=${schemaState.hasLegacyUniqueSel} | user_settings.plan_id NOT NULL=${schemaState.settingsPlanNotNull}`
    );
    if (expectedSchema) {
      assert.equal(
        schemaState.detected,
        expectedSchema,
        `Esquema en BD (${schemaState.detected}) no coincide con --expect-schema=${expectedSchema}`
      );
      console.log(`✅ Esquema validado contra --expect-schema=${expectedSchema}`);
    }

    if (mode === 'seed') {
      assert.equal(
        schemaState.detected,
        '0014',
        '--mode=seed debe ejecutarse con esquema 0014 (antes de correr la migración 0015).'
      );
      await cleanMatchingTestRecords(SEED_PREFIX);

      const isiRes = await pool.query<{ id: string; name: string }>(
        `SELECT sp.id, sp.name
         FROM study_plans sp
         JOIN careers c ON c.id = sp.career_id
         WHERE UPPER(c.code) = 'ISI' AND sp.status = 'published'
         ORDER BY sp.year DESC
         LIMIT 1`
      );
      const indRes = await pool.query<{ id: string; status: string }>(
        `SELECT sp.id, sp.status
         FROM study_plans sp
         JOIN careers c ON c.id = sp.career_id
         WHERE UPPER(c.code) = 'IND'
         ORDER BY sp.created_at DESC
         LIMIT 1`
      );
      if (indRes.rows[0]) {
        console.log(`ℹ️ Plan IND detectado en BD: id=${indRes.rows[0].id} (status=${indRes.rows[0].status})`);
      }

      const instRes = await pool.query<{ id: string }>(
        `INSERT INTO institutions (name, code) VALUES ($1, $2) RETURNING id`,
        [`${SEED_PREFIX}Inst`, `${SEED_PREFIX}INST`]
      );
      const facRes = await pool.query<{ id: string }>(
        `INSERT INTO faculties (institution_id, name, code) VALUES ($1, $2, $3) RETURNING id`,
        [instRes.rows[0].id, `${SEED_PREFIX}Facultad`, `${SEED_PREFIX}FAC`]
      );

      let plan1Id = isiRes.rows[0]?.id || '';
      if (!plan1Id) {
        const car1Res = await pool.query<{ id: string }>(
          `INSERT INTO careers (faculty_id, name, code, status) VALUES ($1, $2, $3, 'published') RETURNING id`,
          [facRes.rows[0].id, `${SEED_PREFIX}Carrera1`, `${SEED_PREFIX}C1`]
        );
        const p1Res = await pool.query<{ id: string }>(
          `INSERT INTO study_plans (career_id, name, year, is_active, status, config) VALUES ($1, $2, 2023, true, 'published', $3::jsonb) RETURNING id`,
          [car1Res.rows[0].id, `${SEED_PREFIX}Plan1`, JSON.stringify({ requiredElectiveCredits: 20, defaultMinPassingGrade: 4, totalLevels: 5 })]
        );
        plan1Id = p1Res.rows[0].id;
      }

      const car2Res = await pool.query<{ id: string }>(
        `INSERT INTO careers (faculty_id, name, code, status) VALUES ($1, $2, $3, 'published') RETURNING id`,
        [facRes.rows[0].id, `${SEED_PREFIX}Carrera2`, `${SEED_PREFIX}C2`]
      );
      const p2Res = await pool.query<{ id: string }>(
        `INSERT INTO study_plans (career_id, name, year, is_active, status, config) VALUES ($1, $2, 2026, true, 'published', $3::jsonb) RETURNING id`,
        [car2Res.rows[0].id, `${SEED_PREFIX}Plan2`, JSON.stringify({ requiredElectiveCredits: 20, defaultMinPassingGrade: 4, totalLevels: 6 })]
      );
      const plan2Id = p2Res.rows[0].id;

      await pool.query(
        `INSERT INTO subjects (plan_id, code_in_plan, display_code, name, short_name, level, modality, contra_cuatrimestral, weekly_hours, kind)
         VALUES ($1, 9901, '9901', $2, 'SeedS2', 1, '1C', false, 4.0, 'obligatoria')`,
        [plan2Id, `${SEED_PREFIX}S2`]
      );

      const termRes = await pool.query<{ id: string }>(
        `INSERT INTO schedule_terms (faculty_id, academic_year, term, label, is_current, is_draft)
         VALUES ($1, 2026, '1C', $2, false, true)
         RETURNING id`,
        [facRes.rows[0].id, `${SEED_PREFIX}1C2026`]
      );
      const termId = termRes.rows[0].id;

      const userRes = await pool.query<{ id: string }>(
        `INSERT INTO users (email, role, status, selected_plan_id, email_verified_at)
         VALUES ($1, 'user', 'active', $2, NOW())
         RETURNING id`,
        [SEED_EMAIL, plan1Id]
      );
      const seedUserId = userRes.rows[0].id;

      const extraSettings = {
        theme: 'dark',
        perPlan: {
          [plan1Id]: {
            includePromotionsInGPA: true,
            minPassingGrade: 4,
            includeAnalistaTrack: false,
            allowBlockedElectivesPlanning: false,
            includeElectivesInProgress: true,
            soundEnabled: true,
            tutorialCompleted: false,
          },
          [plan2Id]: {
            includePromotionsInGPA: false,
            minPassingGrade: 7,
            includeAnalistaTrack: true,
            allowBlockedElectivesPlanning: true,
            includeElectivesInProgress: false,
            soundEnabled: false,
            tutorialCompleted: true,
          },
          'isi-old': {
            minPassingGrade: 9,
          },
          '00000000-0000-4000-8000-000000000999': {
            minPassingGrade: 10,
          },
        },
      };

      await pool.query(
        `INSERT INTO user_settings (
           user_id, plan_id, include_promotions_in_gpa, min_passing_grade,
           include_analista_track, allow_blocked_electives_planning,
           include_electives_in_progress, sound_enabled, tutorial_completed,
           notify_library_email, extra_settings
         ) VALUES ($1, $2, true, 4, false, false, true, true, false, true, $3::jsonb)`,
        [seedUserId, plan1Id, JSON.stringify(extraSettings)]
      );

      const selectionsPlan1 = { '1': 'seed-comm-plan1' };
      const selectionsByPlan = {
        [plan1Id]: selectionsPlan1,
        [plan2Id]: { '9901': 'seed-comm-plan2' },
        'isi-old': { '55': 'seed-comm-old' },
        '00000000-0000-4000-8000-000000000999': { '99': 'seed-comm-ghost' },
      };

      await pool.query(
        `INSERT INTO schedule_selections (user_id, plan_id, schedule_term_id, selections, selections_by_plan)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
        [seedUserId, plan1Id, termId, JSON.stringify(selectionsPlan1), JSON.stringify(selectionsByPlan)]
      );

      // Propuesta legacy sin plan_id (NULL) para comprobar que Paso A de 0015 la completa con selected_plan_id
      await pool.query(
        `INSERT INTO schedule_proposals (user_id, plan_id, schedule_term_id, name, selections)
         VALUES ($1, NULL, $2, $3, $4::jsonb)`,
        [seedUserId, termId, `${SEED_PREFIX}LegacyProposal`, JSON.stringify(selectionsPlan1)]
      );

      console.log('\n🌱 Datos semilla creados (NO eliminados; quedarán para el ensayo de 0015):');
      console.log(`   - user:   ${seedUserId} (${SEED_EMAIL})`);
      console.log(`   - plan1:  ${plan1Id}`);
      console.log(`   - plan2:  ${plan2Id} (${SEED_PREFIX}Plan2)`);
      console.log(`   - term:   ${termId} (${SEED_PREFIX}1C2026)`);
      console.log('   - claves en extra_settings.perPlan y selections_by_plan: [plan1, plan2, "isi-old", "00000000-0000-4000-8000-000000000999"]');
    } else if (mode === 'check-post-0015') {
      assert.equal(
        schemaState.detected,
        '0015',
        '--mode=check-post-0015 requiere esquema 0015 (después de ejecutar db:migrate de deploy-b).'
      );

      const userRes = await pool.query<{ id: string; selected_plan_id: string | null }>(
        `SELECT id, selected_plan_id FROM users WHERE email = $1 LIMIT 1`,
        [SEED_EMAIL]
      );
      const seedUser = userRes.rows[0];
      assert.ok(seedUser, `No se encontró el usuario semilla ${SEED_EMAIL}. Ejecutá --mode=seed antes de migrar 0015.`);
      assert.ok(seedUser.selected_plan_id, 'El usuario semilla debe tener selected_plan_id');
      const plan1Id = seedUser.selected_plan_id;

      const plan2Res = await pool.query<{ id: string }>(
        `SELECT id FROM study_plans WHERE name = $1 LIMIT 1`,
        [`${SEED_PREFIX}Plan2`]
      );
      const plan2Id = plan2Res.rows[0]?.id;
      assert.ok(plan2Id, `No se encontró el plan semilla ${SEED_PREFIX}Plan2.`);

      const termRes = await pool.query<{ id: string }>(
        `SELECT id FROM schedule_terms WHERE label = $1 LIMIT 1`,
        [`${SEED_PREFIX}1C2026`]
      );
      const termId = termRes.rows[0]?.id;
      assert.ok(termId, `No se encontró el período semilla ${SEED_PREFIX}1C2026.`);

      const [nullSettings, nullSelections, nullProposals] = await Promise.all([
        pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM user_settings WHERE plan_id IS NULL`),
        pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM schedule_selections WHERE plan_id IS NULL`),
        pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM schedule_proposals WHERE plan_id IS NULL`),
      ]);
      assert.equal(nullSettings.rows[0]?.c, 0, 'user_settings no debe tener filas con plan_id IS NULL');
      assert.equal(nullSelections.rows[0]?.c, 0, 'schedule_selections no debe tener filas con plan_id IS NULL');
      assert.equal(nullProposals.rows[0]?.c, 0, 'schedule_proposals no debe tener filas con plan_id IS NULL');

      const settingsRows = await pool.query<{
        plan_id: string;
        include_promotions_in_gpa: boolean;
        min_passing_grade: number;
        include_analista_track: boolean;
        allow_blocked_electives_planning: boolean;
        include_electives_in_progress: boolean;
        sound_enabled: boolean;
        tutorial_completed: boolean;
        notify_library_email: boolean;
      }>(
        `SELECT plan_id, include_promotions_in_gpa, min_passing_grade, include_analista_track,
                allow_blocked_electives_planning, include_electives_in_progress,
                sound_enabled, tutorial_completed, notify_library_email
         FROM user_settings
         WHERE user_id = $1`,
        [seedUser.id]
      );
      assert.equal(
        settingsRows.rows.length,
        2,
        `El usuario semilla debe haberse expandido a exactamente 2 filas en user_settings (obtuvo ${settingsRows.rows.length})`
      );
      const rowP1 = settingsRows.rows.find((r) => r.plan_id === plan1Id);
      const rowP2 = settingsRows.rows.find((r) => r.plan_id === plan2Id);
      assert.ok(rowP1 && rowP2, 'Deben existir filas de user_settings exactamente para plan1 y plan2');
      assert.equal(rowP1.min_passing_grade, 4);
      assert.equal(rowP1.include_analista_track, false);
      assert.equal(rowP1.include_electives_in_progress, true);
      assert.equal(rowP1.sound_enabled, true);
      assert.equal(rowP1.tutorial_completed, false);
      assert.equal(rowP2.include_promotions_in_gpa, false);
      assert.equal(rowP2.min_passing_grade, 7);
      assert.equal(rowP2.include_analista_track, true);
      assert.equal(rowP2.allow_blocked_electives_planning, true);
      assert.equal(rowP2.include_electives_in_progress, false);
      assert.equal(rowP2.sound_enabled, false);
      assert.equal(rowP2.tutorial_completed, true);
      assert.equal(rowP2.notify_library_email, true);

      const selRows = await pool.query<{
        plan_id: string;
        schedule_term_id: string;
        selections: Record<string, string>;
      }>(
        `SELECT plan_id, schedule_term_id, selections
         FROM schedule_selections
         WHERE user_id = $1 AND schedule_term_id = $2`,
        [seedUser.id, termId]
      );
      assert.equal(
        selRows.rows.length,
        2,
        `El usuario semilla debe haberse expandido a exactamente 2 filas en schedule_selections (obtuvo ${selRows.rows.length})`
      );
      const selP1 = selRows.rows.find((r) => r.plan_id === plan1Id);
      const selP2 = selRows.rows.find((r) => r.plan_id === plan2Id);
      assert.ok(selP1 && selP2, 'Deben existir filas de schedule_selections exactamente para plan1 y plan2');
      assert.deepEqual(selP1.selections, { '1': 'seed-comm-plan1' });
      assert.deepEqual(selP2.selections, { '9901': 'seed-comm-plan2' });

      const propRes = await pool.query<{ plan_id: string }>(
        `SELECT plan_id FROM schedule_proposals WHERE user_id = $1 AND name = $2`,
        [seedUser.id, `${SEED_PREFIX}LegacyProposal`]
      );
      assert.equal(propRes.rows[0]?.plan_id, plan1Id, 'schedule_proposals.plan_id legacy NULL debe haberse rellenado con plan1');

      const ghostRes = await pool.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM user_settings WHERE user_id = $1 AND plan_id = '00000000-0000-4000-8000-000000000999'::uuid`,
        [seedUser.id]
      );
      assert.equal(ghostRes.rows[0]?.c, 0, 'UUID inexistente no debe haber generado filas');

      console.log('\n✅ CHECK-POST-0015 OK:');
      console.log('   - user_settings expandido a 2 filas exactas (plan1 y plan2) con columnas preservadas');
      console.log('   - schedule_selections expandido a 2 filas exactas (plan1 y plan2)');
      console.log('   - schedule_proposals.plan_id legacy completado sin NULLs');
      console.log('   - Clave no-UUID ("isi-old") y UUID inexistente ("...0999") ignorados sin error');
      console.log('   - 0 filas con plan_id IS NULL en toda la base');
    } else if (mode === 'cleanup') {
      const remaining = await cleanMatchingTestRecords(VERIFY_CLEANUP_PREFIX);
      const nonZero = Object.entries(remaining).filter(([, c]) => c > 0);
      console.log('\n🧹 Residuos restantes con prefijo __VERIFY_US_% (sin tocar admin_audit_log):');
      for (const [tbl, c] of Object.entries(remaining)) {
        console.log(`   - ${tbl}: ${c}`);
      }
      assert.equal(
        nonZero.length,
        0,
        `Quedaron residuos tras cleanup: ${nonZero.map(([t, c]) => `${t}=${c}`).join(', ')}`
      );
      console.log('✅ CLEANUP OK: 0 residuos restantes.');
    } else {
      // mode === 'verify'

    // Sembrar catálogo y usuario temporales aislados bajo prefijo único
    const [inst] = await db
      .insert(institutions)
      .values({
        name: `${prefix}Inst`,
        code: `${prefix}INST`,
      })
      .returning();
    created.instId = inst.id;

    const [fac] = await db
      .insert(faculties)
      .values({
        institutionId: inst.id,
        name: `${prefix}Facultad`,
        code: `${prefix}FAC`,
      })
      .returning();
    created.facId = fac.id;

    const [careerA] = await db
      .insert(careers)
      .values({
        facultyId: fac.id,
        name: `${prefix}Sistemas`,
        code: `${prefix}A`,
        status: 'published',
      })
      .returning();
    created.careerIds.push(careerA.id);

    const [careerB] = await db
      .insert(careers)
      .values({
        facultyId: fac.id,
        name: `${prefix}Industrial6`,
        code: `${prefix}B`,
        status: 'published',
      })
      .returning();
    created.careerIds.push(careerB.id);

    const [planA] = await db
      .insert(studyPlans)
      .values({
        careerId: careerA.id,
        name: `${prefix}PlanA`,
        year: 2023,
        isActive: true,
        status: 'published',
        config: {
          requiredElectiveCredits: 20,
          defaultMinPassingGrade: 4,
          totalLevels: 5,
        },
      })
      .returning();
    created.planIds.push(planA.id);

    const [planB] = await db
      .insert(studyPlans)
      .values({
        careerId: careerB.id,
        name: `${prefix}PlanB6`,
        year: 2023,
        isActive: true,
        status: 'published',
        config: {
          requiredElectiveCredits: 20,
          defaultMinPassingGrade: 4,
          totalLevels: 6,
        },
      })
      .returning();
    created.planIds.push(planB.id);

    const [subACore] = await db
      .insert(subjects)
      .values({
        planId: planA.id,
        codeInPlan: 1,
        displayCode: '1',
        name: `${prefix}CoreA`,
        shortName: 'CoreA',
        level: 1,
        modality: '1C',
        weeklyHours: '4.0',
        kind: 'obligatoria',
      })
      .returning();
    created.subjectIds.push(subACore.id);

    const [subBCore] = await db
      .insert(subjects)
      .values({
        planId: planB.id,
        codeInPlan: 1,
        displayCode: '1',
        name: `${prefix}CoreB`,
        shortName: 'CoreB',
        level: 1,
        modality: '1C',
        weeklyHours: '4.0',
        kind: 'obligatoria',
      })
      .returning();
    created.subjectIds.push(subBCore.id);

    const [subBElec6] = await db
      .insert(subjects)
      .values({
        planId: planB.id,
        codeInPlan: 106,
        displayCode: 'E-106',
        name: `${prefix}ElectivaNivel6`,
        shortName: 'Elec6',
        level: 6,
        modality: '1C',
        weeklyHours: '3.0',
        kind: 'electiva',
        credits: 4,
      })
      .returning();
    created.subjectIds.push(subBElec6.id);

    const [term] = await db
      .insert(scheduleTerms)
      .values({
        facultyId: fac.id,
        academicYear: 2026,
        term: '1C',
        label: `${prefix}1C2026`,
        isCurrent: true,
        isDraft: false,
      })
      .returning();
    created.termId = term.id;

    const [tempUser] = await db
      .insert(users)
      .values({
        email: `${prefix.toLowerCase()}@verify.local`,
        role: 'user',
        status: 'active',
        selectedPlanId: planA.id,
        emailVerifiedAt: new Date(),
      })
      .returning();
    created.userId = tempUser.id;

    // App HTTP efímera con los handlers reales sobre PostgreSQL/Drizzle
    const store = new DrizzleUserStateStore();
    const reviewsStore = new DrizzleReviewsStore();
    const handlers = createUserStateHandlers(store, reviewsStore);
    const app = express();
    app.use(express.json());
    app.use(async (req, _res, next) => {
      const [u] = await db
        .select({
          id: users.id,
          email: users.email,
          role: users.role,
          selectedPlanId: users.selectedPlanId,
        })
        .from(users)
        .where(eq(users.id, tempUser.id))
        .limit(1);
      if (u) {
        req.user = {
          id: u.id,
          email: u.email,
          role: u.role as 'user' | 'admin',
          selectedPlanId: u.selectedPlanId,
          emailVerified: true,
        };
      }
      next();
    });

    app.get('/api/state', handlers.getUserState);
    app.put('/api/settings', handlers.updateSettings);
    app.put('/api/electives', handlers.updateElectives);
    app.put('/api/schedule/selections', handlers.saveScheduleSelections);
    app.post('/api/schedule/proposals', handlers.saveScheduleProposal);
    app.get('/api/export', handlers.exportData);

    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('No se pudo obtener el puerto efímero local');
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    async function api(method: string, urlPath: string, body?: unknown) {
      const res = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const json = (await res.json()) as any;
      return { status: res.status, data: json };
    }

    // Escenario 1: Usuario con 1 plan
    console.log('\n[Escenario 1] Usuario con 1 plan (settings, selecciones y propuesta)');
    const commA = crypto.randomUUID();
    const putSetA = await api('PUT', '/api/settings', {
      minPassingGrade: 5,
      soundEnabled: false,
      notifyLibraryEmail: true,
    });
    assert.equal(putSetA.status, 200);
    const putSelA = await api('PUT', '/api/schedule/selections', {
      scheduleTermId: term.id,
      selections: { '1': commA },
    });
    assert.equal(putSelA.status, 200);
    const postPropA = await api('POST', '/api/schedule/proposals', {
      scheduleTermId: term.id,
      name: `${prefix}PropA`,
      selections: { '1': commA },
    });
    assert.equal(postPropA.status, 201);

    const stateA1 = await api('GET', '/api/state');
    assert.equal(stateA1.status, 200);
    assert.equal(stateA1.data?.data?.selectedPlanId, planA.id);
    assert.equal(stateA1.data?.data?.settings?.minPassingGrade, 5);
    assert.equal(stateA1.data?.data?.settings?.soundEnabled, false);
    assert.equal(stateA1.data?.data?.scheduleSelections?.['1'], commA);
    assert.equal(stateA1.data?.data?.scheduleProposals?.length, 1);
    console.log('✅ Escenario 1 OK');

    // Escenario 2: Usuario con 2 planes en paralelo (settings, selecciones mismo término y propuestas)
    console.log('\n[Escenario 2] Usuario con 2 planes (mismo término horario, sin mezcla entre planes)');
    await db.update(users).set({ selectedPlanId: planB.id }).where(eq(users.id, tempUser.id));

    const commB = crypto.randomUUID();
    const putSetB = await api('PUT', '/api/settings', {
      minPassingGrade: 8,
      includeAnalistaTrack: true,
    });
    assert.equal(putSetB.status, 200);
    const putSelB = await api('PUT', '/api/schedule/selections', {
      scheduleTermId: term.id,
      selections: { '1': commB },
    });
    assert.equal(putSelB.status, 200);
    const postPropB = await api('POST', '/api/schedule/proposals', {
      scheduleTermId: term.id,
      name: `${prefix}PropB`,
      selections: { '1': commB },
    });
    assert.equal(postPropB.status, 201);

    // Verificar Plan B
    const stateB = await api('GET', '/api/state');
    assert.equal(stateB.data?.data?.selectedPlanId, planB.id);
    assert.equal(stateB.data?.data?.settings?.minPassingGrade, 8);
    assert.equal(stateB.data?.data?.settings?.includeAnalistaTrack, true);
    assert.equal(stateB.data?.data?.scheduleSelections?.['1'], commB);
    assert.equal(stateB.data?.data?.scheduleProposals?.length, 1);
    assert.equal(stateB.data?.data?.scheduleProposals?.[0]?.name, `${prefix}PropB`);

    // Volver a Plan A y verificar aislamiento completo
    await db.update(users).set({ selectedPlanId: planA.id }).where(eq(users.id, tempUser.id));
    const stateA2 = await api('GET', '/api/state');
    assert.equal(stateA2.data?.data?.selectedPlanId, planA.id);
    assert.equal(stateA2.data?.data?.settings?.minPassingGrade, 5);
    assert.equal(stateA2.data?.data?.settings?.includeAnalistaTrack, false);
    assert.equal(stateA2.data?.data?.settings?.soundEnabled, false);
    assert.equal(stateA2.data?.data?.scheduleSelections?.['1'], commA);
    assert.equal(stateA2.data?.data?.scheduleProposals?.length, 1);
    assert.equal(stateA2.data?.data?.scheduleProposals?.[0]?.name, `${prefix}PropA`);

    // Verificar invariantes físicas en Postgres según esquema detectado
    const setDbRes = await pool.query<{ plan_id: string | null }>(
      `SELECT plan_id FROM user_settings WHERE user_id = $1`,
      [tempUser.id]
    );
    const selDbRes = await pool.query<{ plan_id: string | null }>(
      `SELECT plan_id FROM schedule_selections WHERE user_id = $1 AND schedule_term_id = $2`,
      [tempUser.id, term.id]
    );
    const propDbRes = await pool.query<{ plan_id: string | null }>(
      `SELECT plan_id FROM schedule_proposals WHERE user_id = $1`,
      [tempUser.id]
    );
    assert.ok(setDbRes.rows.every((r) => r.plan_id !== null), 'user_settings no debe tener plan_id NULL');
    assert.ok(selDbRes.rows.every((r) => r.plan_id !== null), 'schedule_selections no debe tener plan_id NULL');
    assert.ok(propDbRes.rows.every((r) => r.plan_id !== null), 'schedule_proposals no debe tener plan_id NULL');
    if (schemaState.detected === '0014') {
      assert.equal(setDbRes.rows.length, 1, 'En 0014 debe haber exactamente 1 fila en user_settings');
      assert.equal(selDbRes.rows.length, 1, 'En 0014 debe haber exactamente 1 fila en schedule_selections');
    }
    console.log('✅ Escenario 2 OK');

    // Escenario 3: notifyLibraryEmail sincronizado entre planes
    console.log('\n[Escenario 3] notifyLibraryEmail sincronizado entre planes');
    await db.update(users).set({ selectedPlanId: planB.id }).where(eq(users.id, tempUser.id));
    await api('PUT', '/api/settings', { notifyLibraryEmail: false });
    await db.update(users).set({ selectedPlanId: planA.id }).where(eq(users.id, tempUser.id));
    const afterOptOutA = await api('GET', '/api/state');
    assert.equal(afterOptOutA.data?.data?.settings?.notifyLibraryEmail, false);

    await api('PUT', '/api/settings', { notifyLibraryEmail: true });
    await db.update(users).set({ selectedPlanId: planB.id }).where(eq(users.id, tempUser.id));
    const afterOptInB = await api('GET', '/api/state');
    assert.equal(afterOptInB.data?.data?.settings?.notifyLibraryEmail, true);
    console.log('✅ Escenario 3 OK');

    // Escenario 4: Electivas en nivel 6 para Plan B
    console.log('\n[Escenario 4] Electiva asignada en nivel 6 (sin tope fijo 1..5)');
    const putElec6 = await api('PUT', '/api/electives', {
      assignedElectives: { '6': [subBElec6.codeInPlan] },
    });
    assert.equal(putElec6.status, 200);
    const stateElec6 = await api('GET', '/api/state');
    assert.deepEqual(stateElec6.data?.data?.assignedElectives?.['6'], [subBElec6.codeInPlan]);
    const exportElec6 = await api('GET', '/api/export');
    assert.deepEqual(exportElec6.data?.data?.assignedElectives?.['6'], [subBElec6.codeInPlan]);
    console.log('✅ Escenario 4 OK');

    // Escenario 5: markRecommendationsSeen sin insertar plan_id = NULL (incluso sin fila previa en user_settings)
    console.log('\n[Escenario 5] markRecommendationsSeen sin plan_id NULL (con usuario sin fila previa)');
    await db.delete(userSettings).where(eq(userSettings.userId, tempUser.id));
    const recKey = `${prefix}prof::${prefix}sub`;
    await reviewsStore.markRecommendationsSeen(tempUser.id, [recKey]);
    const seenAfter = await reviewsStore.getUserSeenRecommendationKeys(tempUser.id);
    assert.ok(seenAfter.has(recKey), 'getUserSeenRecommendationKeys debe incluir la clave marcada');
    const afterRecRows = await pool.query<{ plan_id: string | null }>(
      `SELECT plan_id FROM user_settings WHERE user_id = $1`,
      [tempUser.id]
    );
    assert.ok(afterRecRows.rows.length >= 1, 'Debe haber al menos 1 fila tras markRecommendationsSeen');
    assert.ok(afterRecRows.rows.every((r) => r.plan_id !== null), 'plan_id nunca debe quedar NULL');
    console.log('✅ Escenario 5 OK');

    // Escenario 6: PgLibraryService.getPendingUploaderFiles() sin filas duplicadas
    console.log('\n[Escenario 6] PgLibraryService.getPendingUploaderFiles() sin duplicación multi-plan');
    if (schemaState.detected === '0015') {
      // Asegurar que existan 2 filas en user_settings para probar el join/consulta real en BD 0015
      await pool.query(
        `INSERT INTO user_settings (user_id, plan_id, notify_library_email) VALUES ($1, $2, true) ON CONFLICT DO NOTHING`,
        [tempUser.id, planA.id]
      );
      await pool.query(
        `INSERT INTO user_settings (user_id, plan_id, notify_library_email) VALUES ($1, $2, true) ON CONFLICT DO NOTHING`,
        [tempUser.id, planB.id]
      );
    }

    const [libFile] = await db
      .insert(libraryFiles)
      .values({
        uploaderUserId: tempUser.id,
        subjectId: subACore.id,
        kind: 'apunte',
        title: `${prefix}Apunte`,
        originalFilename: 'verify.pdf',
        storageKey: `${prefix}/verify.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1234,
        status: 'approved',
        uploaderNotifiedAt: null,
      })
      .returning();
    created.libraryFileIds.push(libFile.id);

    const pgLib = new PgLibraryService(new MemoryMockR2Service());
    const pending1 = (await pgLib.getPendingUploaderFiles()).filter((f) => f.fileId === libFile.id);
    assert.equal(pending1.length, 1, 'getPendingUploaderFiles no debe duplicar filas');
    assert.equal(pending1[0]?.notifyLibraryEmail, true);

    if (schemaState.detected === '0015') {
      await pool.query(
        `UPDATE user_settings SET notify_library_email = false WHERE user_id = $1 AND plan_id = $2`,
        [tempUser.id, planB.id]
      );
    } else {
      await pool.query(
        `UPDATE user_settings SET notify_library_email = false WHERE user_id = $1`,
        [tempUser.id]
      );
    }
    const pending2 = (await pgLib.getPendingUploaderFiles()).filter((f) => f.fileId === libFile.id);
    assert.equal(pending2.length, 1, 'Opt-out en un plan tampoco debe duplicar ni perderse');
    assert.equal(pending2[0]?.notifyLibraryEmail, false);
    console.log('✅ Escenario 6 OK');

    console.log('\n🎉 TODOS LOS ESCENARIOS DE USER STATE CONTRA NEON PASARON');
    } // fin mode === 'verify'
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }

    const cleanupErrors: Array<{ table: string; message: string }> = [];
    async function safeExec(table: string, fn: () => Promise<unknown>) {
      try {
        await fn();
      } catch (err: any) {
        cleanupErrors.push({ table, message: err?.message || String(err) });
      }
    }

    // Limpieza ordenada por FK; NUNCA se toca admin_audit_log
    if (created.libraryFileIds.length > 0) {
      await safeExec('library_files', () =>
        db.delete(libraryFiles).where(inArray(libraryFiles.id, created.libraryFileIds))
      );
    }
    if (created.userId) {
      const uid = created.userId;
      await safeExec('final_exam_attempts', () =>
        db.delete(finalExamAttempts).where(eq(finalExamAttempts.userId, uid))
      );
      await safeExec('elective_assignments', () =>
        db.delete(electiveAssignments).where(eq(electiveAssignments.userId, uid))
      );
      await safeExec('subject_progress', () =>
        db.delete(subjectProgress).where(eq(subjectProgress.userId, uid))
      );
      await safeExec('user_basket', () => db.delete(userBasket).where(eq(userBasket.userId, uid)));
      await safeExec('schedule_proposals', () =>
        db.delete(scheduleProposals).where(eq(scheduleProposals.userId, uid))
      );
      await safeExec('schedule_selections', () =>
        db.delete(scheduleSelections).where(eq(scheduleSelections.userId, uid))
      );
      await safeExec('user_settings', () =>
        db.delete(userSettings).where(eq(userSettings.userId, uid))
      );
      await safeExec('users', () => db.delete(users).where(eq(users.id, uid)));
    }
    if (created.termId) {
      const tid = created.termId;
      await safeExec('schedule_terms', () =>
        db.delete(scheduleTerms).where(eq(scheduleTerms.id, tid))
      );
    }
    if (created.subjectIds.length > 0) {
      await safeExec('subjects', () =>
        db.delete(subjects).where(inArray(subjects.id, created.subjectIds))
      );
    }
    if (created.planIds.length > 0) {
      await safeExec('study_plans', () =>
        db.delete(studyPlans).where(inArray(studyPlans.id, created.planIds))
      );
    }
    if (created.careerIds.length > 0) {
      await safeExec('careers', () =>
        db.delete(careers).where(inArray(careers.id, created.careerIds))
      );
    }
    if (created.facId) {
      const fid = created.facId;
      await safeExec('faculties', () => db.delete(faculties).where(eq(faculties.id, fid)));
    }
    if (created.instId) {
      const iid = created.instId;
      await safeExec('institutions', () =>
        db.delete(institutions).where(eq(institutions.id, iid))
      );
    }

    let finalCounts: Awaited<ReturnType<typeof readGlobalCounts>> | null = null;
    await safeExec('readGlobalCounts(final)', async () => {
      finalCounts = await readGlobalCounts();
    });

    let globalCountMismatch = false;
    if (initialCounts && finalCounts) {
      const fin = finalCounts as NonNullable<typeof finalCounts>;
      const keys = Object.keys(initialCounts) as Array<keyof typeof initialCounts>;
      console.log('\n📊 Conteos globales (inicial -> final):');
      for (const k of keys) {
        const diff = fin[k] - initialCounts[k];
        if (expectZeroGlobalDiff && diff !== 0) globalCountMismatch = true;
        console.log(
          `   - ${k}: ${initialCounts[k]} -> ${fin[k]} (diff: ${diff >= 0 ? `+${diff}` : diff})`
        );
      }
    } else {
      globalCountMismatch = true;
    }

    if (cleanupErrors.length > 0 || globalCountMismatch) {
      console.error('\n❌ Quedaron errores o diferencias inesperadas tras la ejecución:');
      for (const e of cleanupErrors) {
        console.error(`   - [${e.table}] ${e.message}`);
      }
      process.exitCode = 1;
    } else {
      console.log(
        expectZeroGlobalDiff
          ? '\n✅ Verificación completa: 0 residuos y conteos globales idénticos.'
          : `\n✅ Modo ${mode} completado sin errores.`
      );
    }

    await pool.end().catch(() => undefined);
  }
}

run().catch((err) => {
  console.error('\n❌ Falló verifyUserStateNeon.ts:', err);
  process.exit(1);
});
