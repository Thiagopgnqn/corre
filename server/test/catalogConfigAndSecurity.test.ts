import './setupTestEnv.js';

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import {
  InMemoryCatalogStore,
  setCatalogStoreForTesting,
} from '../src/modules/catalog/catalog.store.js';
import { normalizePlanConfig } from '../src/modules/catalog/planConfig.helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('======================================================================');
  console.log(' 🧪 TESTS ETAPA 1B-1: CATÁLOGO NEUTRO, PPS CONFIG, MIGRACIÓN 0009 Y 404');
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

  // 1. Migración 0009
  console.log('📌 1. Migración 0009 (datos idempotentes, sin ppsSubjectCode)');
  const sqlPath = path.resolve(__dirname, '../drizzle/0009_isi_plan_pps_config.sql');
  const journalPath = path.resolve(__dirname, '../drizzle/meta/_journal.json');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));

  assert(
    !/^\s*(DROP|DELETE|ALTER|CREATE|INSERT|TRUNCATE)\s+/im.test(sql) && /\bUPDATE\s+"study_plans"/i.test(sql),
    '0009 contiene únicamente UPDATE de datos sobre study_plans'
  );
  assert(
    sql.includes(`'{"ppsRequirement":{"referenceSubjectCode":36}}'::jsonb || COALESCE(sp."config", '{}'::jsonb)`),
    '0009 realiza merge no destructivo a izquierda sin pisar claves existentes'
  );
  assert(
    sql.includes(`NOT (COALESCE(sp."config", '{}'::jsonb) ? 'ppsRequirement')`),
    '0009 es idempotente mediante verificación de clave ppsRequirement ausente'
  );
  assert(
    sql.includes(`c."code" = 'ISI'`) && sql.includes('sp."year" = 2023') && !sql.includes('ppsSubjectCode'),
    '0009 apunta exclusivamente a ISI Plan 2023 y no incluye ppsSubjectCode'
  );
  const lastJournalEntry = journal.entries[journal.entries.length - 1];
  assert(
    lastJournalEntry?.idx === 9 && lastJournalEntry?.tag === '0009_isi_plan_pps_config',
    'meta/_journal.json registra 0009_isi_plan_pps_config como última entrada'
  );

  // 2. Normalizador neutro (sin hardcoded de Sistemas)
  console.log('\n📌 2. normalizePlanConfig aplica defaults neutros sin valores de Sistemas');
  const neutralCfg = normalizePlanConfig(
    {},
    [{ level: 1 }, { level: 2 }, { level: 3 }],
    { careerCode: 'MEC', planName: 'Plan 2025' }
  );
  assert(
    neutralCfg.requiredElectiveCredits === 0 &&
      neutralCfg.defaultMinPassingGrade === 4 &&
      neutralCfg.electiveSlotsEquivalent === 0 &&
      neutralCfg.totalLevels === 3 &&
      neutralCfg.levelLabel === 'Año' &&
      neutralCfg.shortTag === 'MEC · Plan 2025' &&
      Array.isArray(neutralCfg.intermediateDegrees) &&
      neutralCfg.intermediateDegrees.length === 0 &&
      neutralCfg.ppsRequirement === null,
    'Normalizador neutro devuelve 0 créditos/slots, nivel máximo derivado (3), Año, [] y ppsRequirement null'
  );

  const legacyStrippedCfg = normalizePlanConfig(
    { ppsSubjectCode: 36, requiredElectiveCredits: 12 },
    [{ level: 4 }],
    { careerCode: 'IND', planName: 'Plan 2024' }
  );
  assert(
    !('ppsSubjectCode' in legacyStrippedCfg) && legacyStrippedCfg.ppsRequirement === null,
    'Elimina ppsSubjectCode sin convertirlo en segunda fuente de verdad'
  );

  // 3. HTTP /api/catalog/plans/* & /api/catalog/careers
  console.log('\n📌 3. Seguridad y payload HTTP de /api/catalog/*');
  const catalogJsonPath = path.resolve(__dirname, '../seed-data/plan2023-catalog.json');
  const catalogJson = JSON.parse(fs.readFileSync(catalogJsonPath, 'utf8'));

  const store = new InMemoryCatalogStore();
  const publishedIsi = store.seedPlanFromCatalogJson(catalogJson, {
    careerStatus: 'published',
    planStatus: 'published',
    isActive: true,
    createdAt: new Date('2025-01-01T00:00:00Z'),
  });
  const draftPlan = store.seedPlanFromCatalogJson(
    {
      ...catalogJson,
      career: { name: 'Ingeniería Mecánica', code: 'MEC' },
      studyPlan: { name: 'Plan Borrador', year: 2026, isActive: true, config: { ppsSubjectCode: 999 } },
    },
    { careerStatus: 'published', planStatus: 'draft', isActive: true }
  );
  const archivedPlan = store.seedPlanFromCatalogJson(
    {
      ...catalogJson,
      career: { name: 'Ingeniería Química', code: 'QUI' },
      studyPlan: { name: 'Plan Archivado', year: 2010, isActive: true, config: {} },
    },
    { careerStatus: 'published', planStatus: 'archived', isActive: true }
  );
  const inactivePlan = store.seedPlanFromCatalogJson(
    {
      ...catalogJson,
      career: { name: 'Ingeniería Civil', code: 'CIV' },
      studyPlan: { name: 'Plan Inactivo', year: 2022, isActive: false, config: {} },
    },
    { careerStatus: 'published', planStatus: 'published', isActive: false }
  );
  const draftCareerPlan = store.seedPlanFromCatalogJson(
    {
      ...catalogJson,
      career: { name: 'Ingeniería Eléctrica', code: 'ELE' },
      studyPlan: { name: 'Plan 2025', year: 2025, isActive: true, config: {} },
    },
    { careerStatus: 'draft', planStatus: 'published', isActive: true }
  );

  setCatalogStoreForTesting(store);

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 3a. current devuelve 200 con payload aditivo completo y sin ppsSubjectCode
    const currentRes = await fetch(`${baseUrl}/api/catalog/plans/current`);
    assert(currentRes.status === 200, 'GET /api/catalog/plans/current responde 200 para ISI publicado');
    const currentBody = (await currentRes.json()) as any;
    const d = currentBody.data;
    assert(
      d.plan.id === publishedIsi.planId &&
        d.career?.code === 'ISI' &&
        d.plan.config.ppsRequirement?.referenceSubjectCode === 36 &&
        !('ppsSubjectCode' in d.plan.config) &&
        d.plan.config.electiveSlotsEquivalent === 7 &&
        d.plan.config.totalLevels === 5 &&
        d.plan.config.levelLabel === 'Año' &&
        d.plan.config.shortTag === 'ISI · Plan 2023',
      'Payload incluye career, ppsRequirement {36}, config completa de ISI y excluye ppsSubjectCode'
    );
    assert(
      d.subjects.length === 60 &&
        d.subjects.filter((s: any) => !s.isElective && s.kind === 'obligatoria').length === 37 &&
        d.subjects.filter((s: any) => s.isElective && s.kind === 'electiva').length === 23 &&
        d.subjects.every((s: any) => typeof s.shortName === 'string' && s.shortName.length > 0),
      'Payload contiene 60 materias (37 obligatorias + 23 electivas) con shortName y kind'
    );
    assert(
      d.rules.some((r: any) => r.subjectCode === 99 && r.ruleType === 'approved_range') &&
        d.rules.some((r: any) => r.subjectCode === 36 && r.ruleType === 'all_previous_core_approved') &&
        d.acronyms.DDS === 20 &&
        d.acronyms.AED === 6,
      'Payload conserva rules (99 y 36) y mapa de siglas (DDS=20, AED=6)'
    );

    // 3b. ETag -> 304
    const etag = currentRes.headers.get('etag');
    const notModifiedRes = await fetch(`${baseUrl}/api/catalog/plans/${publishedIsi.planId}`, {
      headers: etag ? { 'If-None-Match': etag } : {},
    });
    assert(Boolean(etag) && notModifiedRes.status === 304, 'Soporta ETag y devuelve 304 ante If-None-Match');

    // 3c. Draft / archived / inactive / draft career -> 404
    for (const [label, id] of [
      ['plan draft', draftPlan.planId],
      ['plan archived', archivedPlan.planId],
      ['plan inactivo', inactivePlan.planId],
      ['plan publicado en carrera draft', draftCareerPlan.planId],
      ['id no UUID', 'no-es-uuid'],
    ]) {
      const res = await fetch(`${baseUrl}/api/catalog/plans/${id}`);
      assert(res.status === 404, `GET /api/catalog/plans/:planId rechaza ${label} con 404`);
    }

    // 3d. /api/catalog/careers filtra solo publicados + activos y omite ppsSubjectCode
    const careersRes = await fetch(`${baseUrl}/api/catalog/careers`);
    assert(careersRes.status === 200, 'GET /api/catalog/careers responde 200');
    const careersBody = (await careersRes.json()) as any;
    const exposedPlans = (careersBody.data || []).flatMap((inst: any) =>
      inst.faculties.flatMap((fac: any) =>
        fac.careers.flatMap((car: any) => car.plans.map((p: any) => ({ careerCode: car.code, plan: p })))
      )
    );
    assert(
      exposedPlans.length === 1 &&
        exposedPlans[0].plan.id === publishedIsi.planId &&
        !('ppsSubjectCode' in exposedPlans[0].plan.config) &&
        exposedPlans[0].plan.config.ppsRequirement?.referenceSubjectCode === 36,
      'GET /api/catalog/careers expone únicamente planes publicados+activos en carreras publicadas sin ppsSubjectCode'
    );

    // 3e. current cuando no hay ningún plan publicado -> 404
    const emptyStore = new InMemoryCatalogStore();
    emptyStore.seedPlanFromCatalogJson(catalogJson, {
      careerStatus: 'published',
      planStatus: 'draft',
      isActive: true,
    });
    setCatalogStoreForTesting(emptyStore);
    const noCurrentRes = await fetch(`${baseUrl}/api/catalog/plans/current`);
    assert(noCurrentRes.status === 404, 'GET /api/catalog/plans/current responde 404 si no hay planes publicados');
  } finally {
    setCatalogStoreForTesting(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(` 📊 RESULTADO TESTS CATÁLOGO Y 0009: ${passed} pasaron, ${failed} fallaron`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Error fatal en catalogConfigAndSecurity.test.ts:', err);
  process.exit(1);
});
