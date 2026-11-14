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
  console.log('📌 1. Migración 0009 (datos idempotentes, sin ppsSubjectCode, CTE catalog_versions)');
  const sqlPath = path.resolve(__dirname, '../drizzle/0009_isi_plan_pps_config.sql');
  const journalPath = path.resolve(__dirname, '../drizzle/meta/_journal.json');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));

  assert(
    !/\b(DROP|DELETE|ALTER|CREATE|TRUNCATE)\b/i.test(sql) &&
      /\bWITH\s+upd\s+AS\s*\(/i.test(sql) &&
      /\bUPDATE\s+"study_plans"/i.test(sql) &&
      /\bRETURNING\s+sp\."id"/i.test(sql),
    '0009 usa una única sentencia CTE aditiva (WITH upd AS ... UPDATE study_plans RETURNING sp.id)'
  );
  assert(
    sql.includes(`'{"finalDegreeTitle":"Ingeniero/a"}'::jsonb`) &&
      sql.includes(`COALESCE(sp."config", '{}'::jsonb)`) &&
      sql.includes(`'{"referenceSubjectCode":36,"label":"Habilitación PPS"}'::jsonb`),
    '0009 realiza merge no destructivo a izquierda (nivel raíz y dentro de ppsRequirement) sin pisar claves existentes'
  );
  assert(
    sql.includes(`NOT (COALESCE(sp."config", '{}'::jsonb) ? 'finalDegreeTitle')`) &&
      sql.includes(`IS DISTINCT FROM 'object'`) &&
      sql.includes(`? 'referenceSubjectCode'`) &&
      sql.includes(`? 'label'`),
    '0009 es idempotente verificando ausencia de cualquiera de las claves requeridas (finalDegreeTitle, referenceSubjectCode, label)'
  );
  assert(
    sql.includes(`c."code" = 'ISI'`) && sql.includes('sp."year" = 2023') && !sql.includes('ppsSubjectCode'),
    '0009 apunta exclusivamente a ISI Plan 2023 y no incluye ppsSubjectCode'
  );
  assert(
    sql.includes(`INSERT INTO "catalog_versions"`) &&
      sql.includes(`ON CONFLICT ("id") DO NOTHING`) &&
      sql.includes(`UPDATE "catalog_versions"`) &&
      /WHERE\s+"id"\s*=\s*'default'\s+AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+upd\s*\)/i.test(sql) &&
      sql.includes(`'v-' ||`),
    '0009 crea idempotentemente "default" y actualiza catalog_versions con formato bumpCatalogVersion() solo si EXISTS (SELECT 1 FROM upd)'
  );

  // Simulación funcional de dos corridas de la CTE de 0009 (con/sin fila 'default' y con ppsRequirement parcial previo)
  const simulate0009Run = (
    plans: Array<{ id: string; careerCode: string; year: number; config: Record<string, unknown> }>,
    versions: Map<string, string>,
    fakeTs: number,
    fakeHex: string
  ) => {
    const updIds: string[] = [];
    for (const sp of plans) {
      const cfg = sp.config || {};
      const rawPps = cfg.ppsRequirement;
      const ppsIsObject = rawPps !== null && typeof rawPps === 'object' && !Array.isArray(rawPps);
      const ppsObj = ppsIsObject ? (rawPps as Record<string, unknown>) : {};
      const missingKey =
        !Object.prototype.hasOwnProperty.call(cfg, 'finalDegreeTitle') ||
        !ppsIsObject ||
        !Object.prototype.hasOwnProperty.call(ppsObj, 'referenceSubjectCode') ||
        !Object.prototype.hasOwnProperty.call(ppsObj, 'label');

      if (sp.careerCode === 'ISI' && sp.year === 2023 && missingKey) {
        sp.config = {
          finalDegreeTitle: 'Ingeniero/a',
          ...cfg,
          ppsRequirement: {
            referenceSubjectCode: 36,
            label: 'Habilitación PPS',
            ...ppsObj,
          },
        };
        updIds.push(sp.id);
      }
    }
    const generatedVer = `v-${fakeTs}-${fakeHex}`;
    if (updIds.length > 0) {
      if (!versions.has('default')) {
        versions.set('default', generatedVer);
      } else {
        versions.set('default', generatedVer);
      }
    }
    return { updatedRows: updIds.length, version: versions.get('default') || null };
  };

  const simPlansNoRow = [{ id: 'p-isi', careerCode: 'ISI', year: 2023, config: { totalLevels: 5 } }];
  const simVersionsEmpty = new Map<string, string>();
  const run1NoRow = simulate0009Run(simPlansNoRow, simVersionsEmpty, 1700000000123, 'a1b2c3');
  const run2NoRow = simulate0009Run(simPlansNoRow, simVersionsEmpty, 1700000000999, 'ffffff');

  const simPlansPartialPps = [
    {
      id: 'p-isi-partial',
      careerCode: 'ISI',
      year: 2023,
      config: { ppsRequirement: { referenceSubjectCode: 99 } } as Record<string, unknown>,
    },
  ];
  const simVersionsExisting = new Map<string, string>([['default', 'v-1600000000000-000000']]);
  const run1Partial = simulate0009Run(simPlansPartialPps, simVersionsExisting, 1700000000456, '09ef12');
  const run2Partial = simulate0009Run(simPlansPartialPps, simVersionsExisting, 1700000000888, 'eeeeee');

  const partialPpsAfter = simPlansPartialPps[0].config.ppsRequirement as Record<string, unknown>;
  assert(
    run1NoRow.updatedRows === 1 &&
      /^v-\d+-[0-9a-f]{6}$/.test(run1NoRow.version || '') &&
      (simPlansNoRow[0].config as Record<string, unknown>).finalDegreeTitle === 'Ingeniero/a' &&
      run2NoRow.updatedRows === 0 &&
      run2NoRow.version === run1NoRow.version &&
      run1Partial.updatedRows === 1 &&
      run1Partial.version === 'v-1700000000456-09ef12' &&
      simPlansPartialPps[0].config.finalDegreeTitle === 'Ingeniero/a' &&
      partialPpsAfter.referenceSubjectCode === 99 &&
      partialPpsAfter.label === 'Habilitación PPS' &&
      run2Partial.updatedRows === 0 &&
      run2Partial.version === run1Partial.version,
    '0009 completa finalDegreeTitle y ppsRequirement.label preservando claves existentes, incrementa catalog_versions solo en corrida 1 y es no-op en corrida 2'
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
      neutralCfg.finalDegreeTitle === undefined &&
      Array.isArray(neutralCfg.intermediateDegrees) &&
      neutralCfg.intermediateDegrees.length === 0 &&
      neutralCfg.ppsRequirement === null,
    'Normalizador neutro devuelve 0 créditos/slots, nivel máximo derivado (3), Año, [], finalDegreeTitle undefined y ppsRequirement null'
  );

  const partialLabelCfg = normalizePlanConfig(
    {
      finalDegreeTitle: 'Ingeniero/a Mecánico/a',
      ppsRequirement: { referenceSubjectCode: 40 },
    },
    [{ level: 5 }],
    { careerCode: 'MEC', planName: 'Plan 2025' }
  );
  assert(
    partialLabelCfg.finalDegreeTitle === 'Ingeniero/a Mecánico/a' &&
      partialLabelCfg.ppsRequirement?.referenceSubjectCode === 40 &&
      partialLabelCfg.ppsRequirement?.label === undefined &&
      Object.keys(partialLabelCfg.ppsRequirement || {}).length === 1,
    'Normalizador preserva finalDegreeTitle y deja ppsRequirement.label undefined si no está en DB (sin otros campos)'
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
        d.career?.id === publishedIsi.careerId &&
        d.career?.facultyId === publishedIsi.facultyId &&
        d.career?.name === 'Ingeniería en Sistemas de Información' &&
        d.career?.code === 'ISI' &&
        d.career?.facultyName === 'Facultad Regional Córdoba' &&
        d.career?.facultyCode === 'FRC' &&
        d.career?.institutionName === 'Universidad Tecnológica Nacional' &&
        d.career?.institutionCode === 'UTN' &&
        d.plan.config.finalDegreeTitle === 'Ingeniero/a' &&
        d.plan.config.ppsRequirement?.referenceSubjectCode === 36 &&
        d.plan.config.ppsRequirement?.label === 'Habilitación PPS' &&
        Object.keys(d.plan.config.ppsRequirement || {}).length === 2 &&
        !('ppsSubjectCode' in d.plan.config) &&
        d.plan.config.electiveSlotsEquivalent === 7 &&
        d.plan.config.totalLevels === 5 &&
        d.plan.config.levelLabel === 'Año' &&
        d.plan.config.shortTag === 'ISI · Plan 2023',
      'Payload incluye career (con facultyName/institutionName aditivos sin alterar campos existentes), finalDegreeTitle, ppsRequirement {36, "Habilitación PPS"} y excluye ppsSubjectCode'
    );
    const byIdRes = await fetch(`${baseUrl}/api/catalog/plans/${publishedIsi.planId}`);
    const byIdBody = (await byIdRes.json()) as any;
    assert(
      byIdRes.status === 200 &&
        byIdBody.data?.career?.facultyName === 'Facultad Regional Córdoba' &&
        byIdBody.data?.career?.institutionName === 'Universidad Tecnológica Nacional',
      'GET /api/catalog/plans/:planId también devuelve career.facultyName e institutionName'
    );
    assert(
      d.subjects.length === 60 &&
        d.subjects.filter((s: any) => !s.isElective && s.kind === 'obligatoria').length === 37 &&
        d.subjects.filter((s: any) => s.isElective && s.kind === 'electiva').length === 23 &&
        d.subjects.every((s: any) => typeof s.shortName === 'string' && s.shortName.length > 0),
      'Payload contiene 60 materias (37 obligatorias + 23 electivas) con shortName y kind'
    );
    const subjById = new Map<number, any>(d.subjects.map((s: any) => [s.id, s]));
    assert(
      subjById.get(1)?.code === '1' &&
        subjById.get(99)?.code === '99' &&
        subjById.get(301)?.code === 'E-301' &&
        subjById.get(405)?.code === 'E-405' &&
        subjById.get(501)?.code === 'E-501' &&
        subjById.get(408)?.code === 'X-408' &&
        subjById.get(514)?.code === 'X-514',
      'Payload expone subject.code con formato exacto ("1", "99", "E-301", "X-408") en vez de shortName'
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
