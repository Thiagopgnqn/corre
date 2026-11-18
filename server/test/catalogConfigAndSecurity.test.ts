import './setupTestEnv.js';

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import {
  assertJournalStrictlyIncreasing,
  findMissingMigrations,
  findMigrationHashMismatches,
  readLocalMigrationEntries,
  verifyMigrationState,
  type AppliedMigrationRow,
  type JournalEntry,
} from '../src/db/migrationGuard.js';
import { runMigrations } from '../src/db/migrate.js';
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

  const hasJournal0009 = journal.entries.some(
    (e: any) => e?.idx === 9 && e?.tag === '0009_isi_plan_pps_config'
  );
  assert(
    hasJournal0009,
    'meta/_journal.json registra 0009_isi_plan_pps_config'
  );

  // 1b. Migración 0010 (short_name de 28 materias ISI 2023, idempotencia y CTE catalog_versions)
  console.log('\n📌 1b. Migración 0010 (short_name 28 materias ISI 2023, dos corridas)');
  const sql0010Path = path.resolve(__dirname, '../drizzle/0010_isi_plan_short_names.sql');
  const sql0010 = fs.readFileSync(sql0010Path, 'utf8');

  assert(
    !/\b(DROP|DELETE|ALTER|CREATE|TRUNCATE)\b/i.test(sql0010) &&
      /\bWITH\s+target_names\b/i.test(sql0010) &&
      /\bupd\s+AS\s*\(\s*UPDATE\s+"subjects"\s+s\b/i.test(sql0010) &&
      /\bRETURNING\s+s\."id"/i.test(sql0010),
    '0010 usa una única sentencia CTE aditiva sobre subjects RETURNING s.id'
  );
  assert(
    sql0010.includes(`c."code" = 'ISI'`) &&
      sql0010.includes('sp."year" = 2023') &&
      sql0010.includes(`s."short_name" = s."name"`) &&
      sql0010.includes(`INSERT INTO "catalog_versions"`) &&
      /WHERE\s+"id"\s*=\s*'default'\s+AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+upd\s*\)/i.test(sql0010),
    '0010 apunta a ISI 2023 con condición s.short_name = s.name y sube catalog_versions solo si EXISTS upd'
  );

  const parsedPairs = Array.from(sql0010.matchAll(/\((\d+),\s*'([^']+)'\)/g)).map((m) => ({
    codeInPlan: Number(m[1]),
    shortName: m[2],
  }));
  const expected0010Ids = [
    1, 2, 5, 6, 7, 8, 9, 11, 13, 14, 16, 17, 20, 21, 23, 25, 26, 29, 30, 35, 99, 405, 408, 507, 509, 511, 513, 514,
  ];
  const forbidden0010Ids = [301, 401, 402, 403, 404, 406, 407, 501, 502, 503, 504, 505, 506, 508, 510, 512];
  const parsedIds = parsedPairs.map((p) => p.codeInPlan);
  assert(
    parsedPairs.length === 28 &&
      expected0010Ids.every((id) => parsedIds.includes(id)) &&
      forbidden0010Ids.every((id) => !parsedIds.includes(id)),
    '0010 actualiza exactamente las 28 materias indicadas y excluye las 14 electivas desalineadas y la 301'
  );

  // Simulación funcional de dos corridas de la CTE de 0010
  const targetMap = new Map(parsedPairs.map((p) => [p.codeInPlan, p.shortName]));
  const simulate0010Run = (
    rows: Array<{
      id: string;
      careerCode: string;
      year: number;
      codeInPlan: number;
      name: string;
      shortName: string;
    }>,
    versions: Map<string, string>,
    fakeTs: number,
    fakeHex: string
  ) => {
    const updIds: string[] = [];
    for (const s of rows) {
      const targetShort = targetMap.get(s.codeInPlan);
      if (
        targetShort !== undefined &&
        s.careerCode === 'ISI' &&
        s.year === 2023 &&
        s.shortName === s.name
      ) {
        s.shortName = targetShort;
        updIds.push(s.id);
      }
    }
    if (updIds.length > 0) {
      versions.set('default', `v-${fakeTs}-${fakeHex}`);
    }
    return { updatedRows: updIds.length, version: versions.get('default') || null };
  };

  const simSubjects = [
    ...expected0010Ids.map((code) => ({
      id: `isi-${code}`,
      careerCode: 'ISI',
      year: 2023,
      codeInPlan: code,
      name: code === 11 ? 'Ingeniería y Sociedad' : `Materia ${code}`,
      shortName: code === 11 ? 'Custom Sociedad' : `Materia ${code}`,
    })),
    // Electiva 301 y electiva desalineada 401: NO deben tocarse
    { id: 'isi-301', careerCode: 'ISI', year: 2023, codeInPlan: 301, name: 'Backend de Aplicaciones', shortName: 'Backend de Aplicaciones' },
    { id: 'isi-401', careerCode: 'ISI', year: 2023, codeInPlan: 401, name: 'Green Software', shortName: 'Green Software' },
    // Otra carrera / año con mismo codeInPlan: NO debe tocarse
    { id: 'mec-1', careerCode: 'MEC', year: 2025, codeInPlan: 1, name: 'Mecánica 1', shortName: 'Mecánica 1' },
  ];
  const sim0010Versions = new Map<string, string>([['default', 'v-1700000000000-000000']]);

  const run0010First = simulate0010Run(simSubjects, sim0010Versions, 1700000100111, 'abc123');
  const run0010Second = simulate0010Run(simSubjects, sim0010Versions, 1700000200222, 'def456');

  assert(
    run0010First.updatedRows === 27 &&
      run0010First.version === 'v-1700000100111-abc123' &&
      simSubjects.find((s) => s.id === 'isi-1')?.shortName === 'Análisis Mat. 1' &&
      simSubjects.find((s) => s.id === 'isi-514')?.shortName === 'PPS' &&
      simSubjects.find((s) => s.id === 'isi-11')?.shortName === 'Custom Sociedad' &&
      simSubjects.find((s) => s.id === 'isi-301')?.shortName === 'Backend de Aplicaciones' &&
      simSubjects.find((s) => s.id === 'isi-401')?.shortName === 'Green Software' &&
      simSubjects.find((s) => s.id === 'mec-1')?.shortName === 'Mecánica 1' &&
      run0010Second.updatedRows === 0 &&
      run0010Second.version === run0010First.version,
    '0010 actualiza materias ISI 2023 donde short_name=name en corrida 1, respeta custom/301/401/MEC y es no-op en corrida 2'
  );

  const hasJournal0010 = journal.entries.some(
    (e: any) => e?.idx === 10 && e?.tag === '0010_isi_plan_short_names'
  );
  assert(
    hasJournal0010,
    'meta/_journal.json registra 0010_isi_plan_short_names'
  );

  // 1c. Migración 0011 (subjects.is_integrator, 5 integradoras ISI 2023, dos corridas)
  console.log('\n📌 1c. Migración 0011 (subjects.is_integrator, dos corridas)');
  const sql0011Path = path.resolve(__dirname, '../drizzle/0011_isi_plan_integrator_subjects.sql');
  const sql0011 = fs.readFileSync(sql0011Path, 'utf8');
  const sql0011Statements = sql0011
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  assert(
    sql0011Statements.length === 2 &&
      !/\b(DROP|DELETE|TRUNCATE)\b/i.test(sql0011) &&
      /ALTER TABLE "subjects" ADD COLUMN IF NOT EXISTS "is_integrator" boolean DEFAULT false NOT NULL;/i.test(
        sql0011Statements[0]
      ) &&
      /\bupd\s+AS\s*\(\s*UPDATE\s+"subjects"\s+s\b/i.test(sql0011Statements[1]) &&
      /\bRETURNING\s+s\."id"/i.test(sql0011Statements[1]),
    '0011 separa ALTER COLUMN IF NOT EXISTS y la CTE UPDATE sobre subjects RETURNING s.id'
  );
  assert(
    sql0011Statements[1].includes(`c."code" = 'ISI'`) &&
      sql0011Statements[1].includes('sp."year" = 2023') &&
      sql0011Statements[1].includes(`s."is_integrator" = false`) &&
      sql0011Statements[1].includes(`INSERT INTO "catalog_versions"`) &&
      /WHERE\s+"id"\s*=\s*'default'\s+AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+upd\s*\)/i.test(
        sql0011Statements[1]
      ),
    '0011 apunta a ISI 2023 con WHERE is_integrator = false y sube catalog_versions solo si EXISTS upd'
  );

  const inClauseMatch = sql0011Statements[1].match(/s\."code_in_plan"\s+IN\s*\(([^)]+)\)/i);
  const parsed0011Codes = (inClauseMatch?.[1] || '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  assert(
    JSON.stringify(parsed0011Codes) === JSON.stringify([16, 23, 30, 36, 99]),
    '0011 marca exactamente las 5 integradoras del fixture: [16, 23, 30, 36, 99]'
  );

  const simulate0011Run = (
    rows: Array<{ id: string; careerCode: string; year: number; codeInPlan: number; isIntegrator: boolean }>,
    versions: Map<string, string>,
    fakeTs: number,
    fakeHex: string
  ) => {
    const integratorSet = new Set(parsed0011Codes);
    const updIds: string[] = [];
    for (const s of rows) {
      if (
        s.careerCode === 'ISI' &&
        s.year === 2023 &&
        integratorSet.has(s.codeInPlan) &&
        s.isIntegrator === false
      ) {
        s.isIntegrator = true;
        updIds.push(s.id);
      }
    }
    if (updIds.length > 0) {
      versions.set('default', `v-${fakeTs}-${fakeHex}`);
    }
    return { updatedRows: updIds.length, version: versions.get('default') || null };
  };

  const sim0011Subjects = [
    ...[1, 16, 23, 30, 36, 99, 301].map((code) => ({
      id: `isi-${code}`,
      careerCode: 'ISI',
      year: 2023,
      codeInPlan: code,
      isIntegrator: false,
    })),
    // Otra carrera con mismo codeInPlan 16: NO debe tocarse
    { id: 'mec-16', careerCode: 'MEC', year: 2025, codeInPlan: 16, isIntegrator: false },
  ];
  const sim0011Versions = new Map<string, string>([['default', 'v-1700000000000-000000']]);

  const run0011First = simulate0011Run(sim0011Subjects, sim0011Versions, 1700000300333, '112233');
  const run0011Second = simulate0011Run(sim0011Subjects, sim0011Versions, 1700000400444, '445566');

  assert(
    run0011First.updatedRows === 5 &&
      run0011First.version === 'v-1700000300333-112233' &&
      [16, 23, 30, 36, 99].every((c) => sim0011Subjects.find((s) => s.id === `isi-${c}`)?.isIntegrator === true) &&
      sim0011Subjects.find((s) => s.id === 'isi-1')?.isIntegrator === false &&
      sim0011Subjects.find((s) => s.id === 'isi-301')?.isIntegrator === false &&
      sim0011Subjects.find((s) => s.id === 'mec-16')?.isIntegrator === false &&
      run0011Second.updatedRows === 0 &&
      run0011Second.version === run0011First.version,
    '0011 marca exactamente las 5 integradoras de ISI 2023 en corrida 1, respeta el resto/MEC y es no-op en corrida 2'
  );

  const hasJournal0011 = journal.entries.some(
    (e: any) => e?.idx === 11 && e?.tag === '0011_isi_plan_integrator_subjects'
  );
  assert(
    hasJournal0011,
    'meta/_journal.json registra 0011_isi_plan_integrator_subjects'
  );

  // 1d. Migración 0012 (plan_special_rules.description ISI 2023 = fixtures, dos corridas)
  console.log('\n📌 1d. Migración 0012 (plan_special_rules.description ISI 2023, dos corridas)');
  const sql0012Path = path.resolve(__dirname, '../drizzle/0012_isi_plan_special_rules_descriptions.sql');
  const sql0012 = fs.readFileSync(sql0012Path, 'utf8');

  assert(
    sql0012.split('--> statement-breakpoint').filter((s) => s.trim()).length === 1 &&
      !/\b(DROP|DELETE|TRUNCATE|ALTER TABLE)\b/i.test(sql0012) &&
      /\bupd\s+AS\s*\(\s*UPDATE\s+"plan_special_rules"\s+psr\b/i.test(sql0012) &&
      /\bRETURNING\s+psr\."id"/i.test(sql0012) &&
      sql0012.includes(`c."code" = 'ISI'`) &&
      sql0012.includes('sp."year" = 2023') &&
      sql0012.includes(`psr."description" IS DISTINCT FROM td."description"`) &&
      sql0012.includes(`INSERT INTO "catalog_versions"`) &&
      /WHERE\s+"id"\s*=\s*'default'\s+AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+upd\s*\)/i.test(sql0012),
    '0012 usa CTE única idempotente sobre plan_special_rules RETURNING psr.id con IS DISTINCT FROM y bump condicional'
  );

  const expected0012Descriptions: Record<number, { ruleType: string; description: string }> = {
    99: {
      ruleType: 'approved_range',
      description: 'Para RENDIRLO hay que tener aprobadas todas las materias de 1 a 23.',
    },
    36: {
      ruleType: 'all_previous_core_approved',
      description:
        'Para RENDIRLO hay que tener aprobadas todas las materias previas del plan (1 a 35 + Seminario 99 + Electivas).',
    },
  };
  for (const [codeStr, expected] of Object.entries(expected0012Descriptions)) {
    assert(
      sql0012.includes(`(${codeStr}, '${expected.ruleType}', '${expected.description}')`),
      `0012 contiene descripción exacta de fixture para materia ${codeStr} (${expected.ruleType})`
    );
  }

  const simulate0012Run = (
    rows: Array<{
      id: string;
      careerCode: string;
      year: number;
      codeInPlan: number;
      ruleType: string;
      description: string;
    }>,
    versions: Map<string, string>,
    fakeTs: number,
    fakeHex: string
  ) => {
    const updIds: string[] = [];
    for (const r of rows) {
      const target = expected0012Descriptions[r.codeInPlan];
      if (
        target &&
        r.careerCode === 'ISI' &&
        r.year === 2023 &&
        r.ruleType === target.ruleType &&
        r.description !== target.description
      ) {
        r.description = target.description;
        updIds.push(r.id);
      }
    }
    if (updIds.length > 0) {
      versions.set('default', `v-${fakeTs}-${fakeHex}`);
    }
    return { updatedRows: updIds.length, version: versions.get('default') || null };
  };

  const sim0012Rules = [
    {
      id: 'rule-isi-99',
      careerCode: 'ISI',
      year: 2023,
      codeInPlan: 99,
      ruleType: 'approved_range',
      description: 'Requiere tener aprobadas todas las materias del ciclo básico y nivel 2 (códigos 1 al 23).',
    },
    {
      id: 'rule-isi-36',
      careerCode: 'ISI',
      year: 2023,
      codeInPlan: 36,
      ruleType: 'all_previous_core_approved',
      description:
        'Requiere tener aprobadas todas las materias obligatorias previas del plan (excluye Seminario si no se optó por Analista).',
    },
    // Otra carrera con mismo codeInPlan 36: NO debe tocarse
    {
      id: 'rule-mec-36',
      careerCode: 'MEC',
      year: 2025,
      codeInPlan: 36,
      ruleType: 'all_previous_core_approved',
      description: 'Regla propia de Mecánica.',
    },
  ];
  const sim0012Versions = new Map<string, string>([['default', 'v-1700000000000-000000']]);
  const run0012First = simulate0012Run(sim0012Rules, sim0012Versions, 1700000500555, 'aa1122');
  const run0012Second = simulate0012Run(sim0012Rules, sim0012Versions, 1700000600666, 'bb3344');

  assert(
    run0012First.updatedRows === 2 &&
      run0012First.version === 'v-1700000500555-aa1122' &&
      sim0012Rules[0].description === expected0012Descriptions[99].description &&
      sim0012Rules[1].description === expected0012Descriptions[36].description &&
      sim0012Rules[2].description === 'Regla propia de Mecánica.' &&
      run0012Second.updatedRows === 0 &&
      run0012Second.version === run0012First.version,
    '0012 actualiza las 2 reglas de ISI 2023 en corrida 1, respeta otra carrera y es no-op en corrida 2'
  );

  // Corrida parcial (si una fila ya coincidía y faltaba otra): también actualiza solo la faltante
  const sim0012Partial = [
    { ...sim0012Rules[0] }, // ya actualizada
    {
      id: 'rule-isi-36',
      careerCode: 'ISI',
      year: 2023,
      codeInPlan: 36,
      ruleType: 'all_previous_core_approved',
      description: 'Texto anterior distinto',
    },
  ];
  const partialVersions = new Map<string, string>([['default', 'v-1700000700000-000000']]);
  const run0012Partial = simulate0012Run(sim0012Partial, partialVersions, 1700000800777, 'cc5566');
  const run0012PartialSecond = simulate0012Run(sim0012Partial, partialVersions, 1700000900888, 'dd7788');
  assert(
    run0012Partial.updatedRows === 1 &&
      run0012Partial.version === 'v-1700000800777-cc5566' &&
      run0012PartialSecond.updatedRows === 0 &&
      run0012PartialSecond.version === run0012Partial.version,
    '0012 funciona ante estado parcial actualizando solo la fila distinta y es no-op en corrida 2'
  );

  const hasJournal0012 = journal.entries.some(
    (e: any) => e?.idx === 12 && e?.tag === '0012_isi_plan_special_rules_descriptions'
  );
  assert(
    hasJournal0012,
    'meta/_journal.json registra 0012_isi_plan_special_rules_descriptions'
  );

  // 1e. Migración 0013 (intermediateDegrees + ppsRequirement.description, idempotencia y estado parcial)
  console.log('\n📌 1e. Migración 0013 (intermediateDegrees + ppsRequirement.description, dos corridas y estado parcial)');
  const sql0013Path = path.resolve(__dirname, '../drizzle/0013_isi_plan_intermediate_and_pps_copy.sql');
  const sql0013 = fs.readFileSync(sql0013Path, 'utf8');

  assert(
    sql0013.split('--> statement-breakpoint').filter((s) => s.trim()).length === 1 &&
      !/\b(DROP|DELETE|TRUNCATE|ALTER TABLE)\b/i.test(sql0013) &&
      /\bWITH\s+upd\s+AS\s*\(\s*UPDATE\s+"study_plans"\s+sp\b/i.test(sql0013) &&
      /\bRETURNING\s+sp\."id"/i.test(sql0013) &&
      sql0013.includes(`c."code" = 'ISI'`) &&
      sql0013.includes('sp."year" = 2023') &&
      sql0013.includes(`"shortLabel":"Analista"`) &&
      sql0013.includes(`"shortTitle":"Analista Universitario"`) &&
      sql0013.includes(`Analista Universitario de Sistemas de Información`) &&
      sql0013.includes(`IN ('Analista Universitario en Sistemas', 'Analista Universitario de Sistemas')`) &&
      sql0013.includes(`Cumplís los requisitos para cursar la Práctica Profesional`) &&
      sql0013.includes(`INSERT INTO "catalog_versions"`) &&
      /WHERE\s+"id"\s*=\s*'default'\s+AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+upd\s*\)/i.test(sql0013),
    '0013 usa CTE única aditiva e idempotente sobre study_plans RETURNING sp.id con merge a izquierda y bump condicional de catalog_versions'
  );

  const simulate0013Run = (
    plans: Array<{ id: string; careerCode: string; year: number; config: Record<string, unknown> }>,
    versions: Map<string, string>,
    fakeTs: number,
    fakeHex: string
  ) => {
    const updIds: string[] = [];
    for (const sp of plans) {
      if (sp.careerCode !== 'ISI' || sp.year !== 2023) continue;
      const cfg = sp.config || {};
      const rawPps = cfg.ppsRequirement;
      const ppsIsObj = rawPps !== null && typeof rawPps === 'object' && !Array.isArray(rawPps);
      const ppsObj = ppsIsObj ? (rawPps as Record<string, unknown>) : {};

      const rawDegs = cfg.intermediateDegrees;
      const degsIsArr = Array.isArray(rawDegs) && rawDegs.length > 0;
      const deg0IsObj = degsIsArr && rawDegs[0] !== null && typeof rawDegs[0] === 'object' && !Array.isArray(rawDegs[0]);
      const deg0 = deg0IsObj ? (rawDegs[0] as Record<string, unknown>) : {};
      const deg0NameTrimmed = typeof deg0.name === 'string' ? deg0.name.trim() : '';
      const resolvedName = deg0NameTrimmed || 'Analista Universitario en Sistemas';
      const needsNameUpgrade =
        resolvedName === 'Analista Universitario en Sistemas' ||
        resolvedName === 'Analista Universitario de Sistemas';

      const needsUpdate =
        !ppsIsObj ||
        !Object.prototype.hasOwnProperty.call(ppsObj, 'referenceSubjectCode') ||
        !Object.prototype.hasOwnProperty.call(ppsObj, 'label') ||
        !Object.prototype.hasOwnProperty.call(ppsObj, 'description') ||
        !degsIsArr ||
        !deg0IsObj ||
        !Object.prototype.hasOwnProperty.call(deg0, 'shortLabel') ||
        !Object.prototype.hasOwnProperty.call(deg0, 'shortTitle') ||
        needsNameUpgrade;

      if (!needsUpdate) continue;

      const mergedDeg0 = degsIsArr
        ? {
            key: 'analista',
            shortLabel: 'Analista',
            shortTitle: 'Analista Universitario',
            requiredElectiveCredits: 4,
            specialRuleSubjectCode: 99,
            ...deg0,
            name: needsNameUpgrade ? 'Analista Universitario de Sistemas de Información' : deg0.name,
          }
        : {
            key: 'analista',
            name: 'Analista Universitario de Sistemas de Información',
            shortLabel: 'Analista',
            shortTitle: 'Analista Universitario',
            requiredElectiveCredits: 4,
            specialRuleSubjectCode: 99,
          };

      const nextDegs = degsIsArr ? [mergedDeg0, ...rawDegs.slice(1)] : [mergedDeg0];
      sp.config = {
        ...cfg,
        intermediateDegrees: nextDegs,
        ppsRequirement: {
          referenceSubjectCode: 36,
          label: 'Habilitación PPS',
          description: 'Cumplís los requisitos para cursar la Práctica Profesional',
          ...ppsObj,
        },
      };
      updIds.push(sp.id);
    }

    if (updIds.length > 0) {
      versions.set('default', `v-${fakeTs}-${fakeHex}`);
    }
    return { updatedRows: updIds.length, version: versions.get('default') || null };
  };

  // Corrida 1 y 2 desde estado pre-0013
  const sim0013Standard = [
    {
      id: 'p-isi',
      careerCode: 'ISI',
      year: 2023,
      config: {
        finalDegreeTitle: 'Ingeniero/a',
        ppsRequirement: { referenceSubjectCode: 36, label: 'Habilitación PPS' },
        intermediateDegrees: [
          {
            key: 'analista',
            name: 'Analista Universitario en Sistemas',
            requiredElectiveCredits: 4,
            specialRuleSubjectCode: 99,
          },
          { key: 'extra', name: 'Segundo Elemento Preservado' },
        ],
      } as Record<string, unknown>,
    },
    {
      id: 'p-mec',
      careerCode: 'MEC',
      year: 2023,
      config: { ppsRequirement: { referenceSubjectCode: 10 }, intermediateDegrees: [] } as Record<string, unknown>,
    },
  ];
  const sim0013Versions = new Map<string, string>([['default', 'v-1700000000000-000000']]);
  const run0013First = simulate0013Run(sim0013Standard, sim0013Versions, 1700001000111, 'ee1122');
  const run0013Second = simulate0013Run(sim0013Standard, sim0013Versions, 1700001100222, 'ff3344');

  const stdDegs = sim0013Standard[0].config.intermediateDegrees as Array<Record<string, unknown>>;
  const stdPps = sim0013Standard[0].config.ppsRequirement as Record<string, unknown>;
  assert(
    run0013First.updatedRows === 1 &&
      run0013First.version === 'v-1700001000111-ee1122' &&
      stdDegs.length === 2 &&
      stdDegs[0].name === 'Analista Universitario de Sistemas de Información' &&
      stdDegs[0].shortLabel === 'Analista' &&
      stdDegs[0].shortTitle === 'Analista Universitario' &&
      stdDegs[1].name === 'Segundo Elemento Preservado' &&
      stdPps.description === 'Cumplís los requisitos para cursar la Práctica Profesional' &&
      (sim0013Standard[1].config.intermediateDegrees as unknown[]).length === 0 &&
      run0013Second.updatedRows === 0 &&
      run0013Second.version === run0013First.version,
    '0013 actualiza ISI 2023 en corrida 1 preservando elementos [1..] y otras carreras, y es no-op en corrida 2'
  );

  // Estado desde versión intermedia anterior ("Analista Universitario de Sistemas") también actualiza y es idempotente
  const sim0013Intermediate = [
    {
      id: 'p-isi-inter',
      careerCode: 'ISI',
      year: 2023,
      config: {
        ppsRequirement: {
          referenceSubjectCode: 36,
          label: 'Habilitación PPS',
          description: 'Cumplís los requisitos para cursar la Práctica Profesional',
        },
        intermediateDegrees: [
          {
            key: 'analista',
            name: 'Analista Universitario de Sistemas',
            shortLabel: 'Analista',
            shortTitle: 'Analista Universitario',
            requiredElectiveCredits: 4,
            specialRuleSubjectCode: 99,
          },
        ],
      } as Record<string, unknown>,
    },
  ];
  const sim0013InterVersions = new Map<string, string>([['default', 'v-1700001150000-000000']]);
  const run0013Inter1 = simulate0013Run(sim0013Intermediate, sim0013InterVersions, 1700001160111, 'aa9988');
  const run0013Inter2 = simulate0013Run(sim0013Intermediate, sim0013InterVersions, 1700001170222, 'bb7766');
  const interDeg0 = (sim0013Intermediate[0].config.intermediateDegrees as Array<Record<string, unknown>>)[0];
  assert(
    run0013Inter1.updatedRows === 1 &&
      run0013Inter1.version === 'v-1700001160111-aa9988' &&
      interDeg0.name === 'Analista Universitario de Sistemas de Información' &&
      interDeg0.shortLabel === 'Analista' &&
      interDeg0.shortTitle === 'Analista Universitario' &&
      run0013Inter2.updatedRows === 0 &&
      run0013Inter2.version === run0013Inter1.version,
    '0013 actualiza también la versión intermedia "Analista Universitario de Sistemas" al nombre oficial y es no-op en corrida 2'
  );

  // Estado parcial: shortLabel personalizado ya presente y falta shortTitle + upgrade de name; y nombre custom no se pisa
  const sim0013Partial = [
    {
      id: 'p-isi-partial',
      careerCode: 'ISI',
      year: 2023,
      config: {
        ppsRequirement: { referenceSubjectCode: 36, label: 'Habilitación PPS' },
        intermediateDegrees: [
          {
            key: 'analista',
            name: 'Analista Universitario en Sistemas',
            shortLabel: 'Tecnicatura',
            requiredElectiveCredits: 4,
            specialRuleSubjectCode: 99,
          },
        ],
      } as Record<string, unknown>,
    },
  ];
  const sim0013PartialVersions = new Map<string, string>([['default', 'v-1700001200000-000000']]);
  const run0013Partial1 = simulate0013Run(sim0013Partial, sim0013PartialVersions, 1700001300111, '123abc');
  const run0013Partial2 = simulate0013Run(sim0013Partial, sim0013PartialVersions, 1700001400222, '456def');
  const partDeg0 = (sim0013Partial[0].config.intermediateDegrees as Array<Record<string, unknown>>)[0];

  const sim0013Custom = [
    {
      id: 'p-isi-custom',
      careerCode: 'ISI',
      year: 2023,
      config: {
        ppsRequirement: {
          referenceSubjectCode: 36,
          label: 'PPS Custom',
          description: 'Descripción Custom Admin',
        },
        intermediateDegrees: [
          {
            key: 'analista',
            name: 'Analista Custom Admin',
            shortLabel: 'Custom',
            shortTitle: 'Título Custom',
          },
        ],
      } as Record<string, unknown>,
    },
  ];
  const sim0013CustomVersions = new Map<string, string>([['default', 'v-1700001500000-000000']]);
  const run0013Custom = simulate0013Run(sim0013Custom, sim0013CustomVersions, 1700001600111, '789abc');
  assert(
    run0013Partial1.updatedRows === 1 &&
      run0013Partial1.version === 'v-1700001300111-123abc' &&
      partDeg0.shortLabel === 'Tecnicatura' &&
      partDeg0.shortTitle === 'Analista Universitario' &&
      partDeg0.name === 'Analista Universitario de Sistemas de Información' &&
      run0013Partial2.updatedRows === 0 &&
      run0013Partial2.version === run0013Partial1.version &&
      run0013Custom.updatedRows === 0 &&
      run0013Custom.version === 'v-1700001500000-000000',
    '0013 maneja estado parcial sin pisar shortLabel/claves custom existentes y respeta custom name/description'
  );

  const hasJournal0013 = journal.entries.some(
    (e: any) => e?.idx === 13 && e?.tag === '0013_isi_plan_intermediate_and_pps_copy'
  );
  assert(
    hasJournal0013,
    'meta/_journal.json registra 0013_isi_plan_intermediate_and_pps_copy'
  );

  // 1e-bis. Migración 0014 (subjects.display_code, dos corridas y desacoplamiento E-/X-)
  console.log('\n📌 1e-bis. Migración 0014 (subjects.display_code, dos corridas y desacoplamiento E-/X-)');
  const sql0014Path = path.resolve(__dirname, '../drizzle/0014_subject_display_code.sql');
  const sql0014 = fs.readFileSync(sql0014Path, 'utf8');

  assert(
    sql0014.split('--> statement-breakpoint').filter((s) => s.trim()).length === 2 &&
      !/\b(DROP|DELETE|TRUNCATE)\b/i.test(sql0014) &&
      /ALTER TABLE "subjects"\s+ADD COLUMN IF NOT EXISTS "display_code"\s+varchar\(32\)/i.test(sql0014) &&
      /\bWITH\s+upd\s+AS\s*\(\s*UPDATE\s+"subjects"\s+s\b/i.test(sql0014) &&
      /\bs\."display_code"\s+IS\s+NULL\b/i.test(sql0014) &&
      sql0014.includes(`c."code" = 'ISI'`) &&
      sql0014.includes(`'X-' || s."code_in_plan"::text`) &&
      sql0014.includes(`'E-' || s."code_in_plan"::text`) &&
      sql0014.includes(`ELSE s."code_in_plan"::text`) &&
      sql0014.includes(`INSERT INTO "catalog_versions"`) &&
      /WHERE\s+"id"\s*=\s*'default'\s+AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+upd\s*\)/i.test(sql0014),
    '0014 usa ADD COLUMN IF NOT EXISTS y CTE única idempotente sobre display_code IS NULL con bump condicional'
  );

  const simulate0014Run = (
    rows: Array<{
      id: string;
      careerCode: string;
      year: number;
      codeInPlan: number;
      kind: string;
      displayCode: string | null;
    }>,
    versions: Map<string, string>,
    fakeTs: number,
    fakeHex: string
  ) => {
    let updatedRows = 0;
    for (const s of rows) {
      if (s.displayCode !== null) continue;
      if (s.careerCode === 'ISI' && s.year === 2023 && s.kind === 'electiva') {
        s.displayCode = [408, 512, 513, 514].includes(s.codeInPlan)
          ? `X-${s.codeInPlan}`
          : `E-${s.codeInPlan}`;
      } else {
        s.displayCode = String(s.codeInPlan);
      }
      updatedRows += 1;
    }
    if (updatedRows > 0) {
      versions.set('default', `v-${fakeTs}-${fakeHex}`);
    }
    return { updatedRows, version: versions.get('default') || null };
  };

  const sim0014Rows = [
    { id: 'isi-1', careerCode: 'ISI', year: 2023, codeInPlan: 1, kind: 'obligatoria', displayCode: null },
    { id: 'isi-301', careerCode: 'ISI', year: 2023, codeInPlan: 301, kind: 'electiva', displayCode: null },
    { id: 'isi-408', careerCode: 'ISI', year: 2023, codeInPlan: 408, kind: 'electiva', displayCode: null },
    { id: 'isi-custom', careerCode: 'ISI', year: 2023, codeInPlan: 509, kind: 'electiva', displayCode: 'CUSTOM-509' },
    { id: 'mec-301', careerCode: 'MEC', year: 2026, codeInPlan: 301, kind: 'electiva', displayCode: null },
  ];
  const sim0014Versions = new Map<string, string>([['default', 'v-1700001700000-000000']]);
  const run0014First = simulate0014Run(sim0014Rows, sim0014Versions, 1700001800111, 'ee4455');
  const run0014Second = simulate0014Run(sim0014Rows, sim0014Versions, 1700001900222, 'ff6677');
  assert(
    run0014First.updatedRows === 4 &&
      run0014First.version === 'v-1700001800111-ee4455' &&
      sim0014Rows[0].displayCode === '1' &&
      sim0014Rows[1].displayCode === 'E-301' &&
      sim0014Rows[2].displayCode === 'X-408' &&
      sim0014Rows[3].displayCode === 'CUSTOM-509' &&
      sim0014Rows[4].displayCode === '301' &&
      run0014Second.updatedRows === 0 &&
      run0014Second.version === run0014First.version,
    '0014 backfillea ISI E-/X- y deja no-ISI sin prefijo E-/X-, respeta valores previos y es no-op en corrida 2'
  );

  const lastJournalEntry = journal.entries[journal.entries.length - 1];
  assert(
    lastJournalEntry?.idx === 16 &&
      lastJournalEntry?.tag === '0016_library_files_restrict_delete' &&
      lastJournalEntry?.when === 1793760000000,
    'meta/_journal.json registra 0016_library_files_restrict_delete como última entrada'
  );

  // 1f. Integridad global de _journal.json y simulación exacta de drizzle-orm migrate
  console.log('\n📌 1f. Integridad de _journal.json y simulación de migraciones pendientes en drizzle-orm');
  const journalEntries = (journal.entries ?? []) as JournalEntry[];

  // (a) "when" estrictamente crecientes en orden del arreglo
  let prevWhen = -Infinity;
  let monotonicWhen = true;
  let sequentialIdx = true;
  let nonMonotonicDetail = '';
  for (let i = 0; i < journalEntries.length; i++) {
    const entry = journalEntries[i];
    if (entry.idx !== i) {
      sequentialIdx = false;
      nonMonotonicDetail = `idx esperado ${i}, recibido ${entry.idx}`;
      break;
    }
    if (typeof entry.when !== 'number' || !Number.isFinite(entry.when) || entry.when <= prevWhen) {
      monotonicWhen = false;
      nonMonotonicDetail = `idx=${entry.idx} (${entry.tag}) when=${entry.when} <= prevWhen=${prevWhen}`;
      break;
    }
    prevWhen = entry.when;
  }
  assert(
    monotonicWhen && sequentialIdx,
    '(a) Todos los "when" de _journal.json son estrictamente crecientes en orden del arreglo (e idx consecutivos)',
    nonMonotonicDetail || undefined
  );

  // (b) Cada .sql de server/drizzle/ tiene entrada en journal y viceversa, con coincidencia exacta de tag
  const drizzleDir = path.resolve(__dirname, '../drizzle');
  const sqlFiles = fs
    .readdirSync(drizzleDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const journalSqlNames = journalEntries.map((e) => `${e.tag}.sql`);
  const sortedJournalSqlNames = [...journalSqlNames].sort();
  const sqlWithoutJournal = sqlFiles.filter((f) => !sortedJournalSqlNames.includes(f));
  const journalWithoutSql = sortedJournalFilesMissingCheck(journalSqlNames, sqlFiles);
  const allMatchFilePrefixAndName = journalEntries.every((e, i) => {
    const expectedPrefix = `${String(i).padStart(4, '0')}_`;
    return (
      typeof e.tag === 'string' &&
      e.tag.startsWith(expectedPrefix) &&
      fs.existsSync(path.join(drizzleDir, `${e.tag}.sql`))
    );
  });
  function sortedJournalFilesMissingCheck(journalList: string[], diskList: string[]): string[] {
    const diskSet = new Set(diskList);
    return journalList.filter((name) => !diskSet.has(name));
  }
  assert(
    sqlFiles.length === journalEntries.length &&
      sqlWithoutJournal.length === 0 &&
      journalWithoutSql.length === 0 &&
      allMatchFilePrefixAndName,
    '(b) Cada .sql de server/drizzle/ tiene entrada en _journal.json y viceversa con coincidencia exacta de tag',
    `sqlWithoutJournal=${JSON.stringify(sqlWithoutJournal)} journalWithoutSql=${JSON.stringify(journalWithoutSql)}`
  );

  const simulateDrizzlePending = (
    entries: JournalEntry[],
    lastDbMigration: { created_at: number | string } | null
  ): string[] => {
    const pending: string[] = [];
    for (const migration of entries) {
      if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.when) {
        pending.push(migration.tag);
      }
    }
    return pending;
  };

  // (c) Producción en 0007 (when = 1793670000000) -> pendientes 0008..0016 en orden
  const prod0007 = journalEntries.find((e) => e.idx === 7);
  const pendingFromProd = simulateDrizzlePending(
    journalEntries,
    prod0007 ? { created_at: prod0007.when } : { created_at: 1793670000000 }
  );
  assert(
    prod0007?.when === 1793670000000 &&
      JSON.stringify(pendingFromProd) ===
        JSON.stringify([
          '0008_multicarrera_and_shared_subjects',
          '0009_isi_plan_pps_config',
          '0010_isi_plan_short_names',
          '0011_isi_plan_integrator_subjects',
          '0012_isi_plan_special_rules_descriptions',
          '0013_isi_plan_intermediate_and_pps_copy',
          '0014_subject_display_code',
          '0015_user_state_composite_keys',
          '0016_library_files_restrict_delete',
        ]),
    '(c) Simulación drizzle-orm desde producción en 0007 (1793670000000) aplica exactamente 0008 a 0016 en orden',
    `pendientes=${JSON.stringify(pendingFromProd)}`
  );

  // (d) Rama de prueba en 0010 (when = 1793700000000) -> pendientes 0011..0016 en orden
  const trial0010 = journalEntries.find((e) => e.idx === 10);
  const pendingFromTrial0010 = simulateDrizzlePending(
    journalEntries,
    trial0010 ? { created_at: trial0010.when } : { created_at: 1793700000000 }
  );
  assert(
    trial0010?.when === 1793700000000 &&
      JSON.stringify(pendingFromTrial0010) ===
        JSON.stringify([
          '0011_isi_plan_integrator_subjects',
          '0012_isi_plan_special_rules_descriptions',
          '0013_isi_plan_intermediate_and_pps_copy',
          '0014_subject_display_code',
          '0015_user_state_composite_keys',
          '0016_library_files_restrict_delete',
        ]),
    '(d) Simulación drizzle-orm desde rama en 0010 (1793700000000) aplica exactamente 0011 a 0016 en orden',
    `pendientes=${JSON.stringify(pendingFromTrial0010)}`
  );

  // (d2) Producción Etapa 1 en 0013 (when = 1793730000000) -> pendientes 0014..0016
  const prod0013 = journalEntries.find((e) => e.idx === 13);
  const pendingFromProd0013 = simulateDrizzlePending(
    journalEntries,
    prod0013 ? { created_at: prod0013.when } : { created_at: 1793730000000 }
  );
  const branch0014 = journalEntries.find((e) => e.idx === 14);
  const pendingFrom0014 = simulateDrizzlePending(
    journalEntries,
    branch0014 ? { created_at: branch0014.when } : { created_at: 1793740000000 }
  );
  assert(
    prod0013?.when === 1793730000000 &&
      JSON.stringify(pendingFromProd0013) ===
        JSON.stringify([
          '0014_subject_display_code',
          '0015_user_state_composite_keys',
          '0016_library_files_restrict_delete',
        ]) &&
      branch0014?.when === 1793740000000 &&
      JSON.stringify(pendingFrom0014) ===
        JSON.stringify([
          '0015_user_state_composite_keys',
          '0016_library_files_restrict_delete',
        ]),
    '(d2) Simulación drizzle-orm desde 0013 aplica 0014..0016 y desde 0014 aplica 0015 y 0016 en orden',
    `desde0013=${JSON.stringify(pendingFromProd0013)} desde0014=${JSON.stringify(pendingFrom0014)}`
  );

  // (e) Base vacía (sin filas en __drizzle_migrations) -> todas pendientes
  const pendingFromEmpty = simulateDrizzlePending(journalEntries, null);
  assert(
    pendingFromEmpty.length === journalEntries.length &&
      JSON.stringify(pendingFromEmpty) === JSON.stringify(journalEntries.map((e) => e.tag)),
    '(e) Simulación drizzle-orm con base vacía aplica todas las migraciones del journal (0000 a 0016)',
    `pendientes=${JSON.stringify(pendingFromEmpty)}`
  );

  // 1g. Guarda runtime de migraciones (migrationGuard + demo rojo-verde c5d321f -> c04fbb9)
  console.log('\n📌 1g. Guarda runtime de migraciones (findMissingMigrations, assertJournalStrictlyIncreasing, demo rojo-verde)');
  const localEntries = readLocalMigrationEntries(drizzleDir);
  const fullDbRows: AppliedMigrationRow[] = localEntries.map((entry, idx) => ({
    id: idx + 1,
    hash: entry.hash,
    created_at: String(entry.when),
  }));

  // (f1) Todo registrado -> 0 faltantes, 0 warnings, verifyMigrationState pasa
  const warningsAllOk: string[] = [];
  let verifyAllOkError: Error | null = null;
  try {
    assertJournalStrictlyIncreasing(localEntries);
    verifyMigrationState(localEntries, fullDbRows, (msg) => warningsAllOk.push(msg));
  } catch (err) {
    verifyAllOkError = err as Error;
  }
  assert(
    verifyAllOkError === null &&
      findMissingMigrations(localEntries, fullDbRows).length === 0 &&
      warningsAllOk.length === 0,
    '(f1) Todo registrado en drizzle.__drizzle_migrations pasa sin faltantes ni advertencias'
  );

  // (f2) Falta una migración -> devuelve exactamente la faltante y falla con idx, tag y when
  const rowsMissing0011 = fullDbRows.filter((r) => Number(r.created_at) !== 1793710000000);
  const missing0011 = findMissingMigrations(localEntries, rowsMissing0011);
  let errorMissing0011 = '';
  try {
    verifyMigrationState(localEntries, rowsMissing0011, () => {});
  } catch (err) {
    errorMissing0011 = (err as Error).message;
  }
  assert(
    missing0011.length === 1 &&
      missing0011[0].idx === 11 &&
      missing0011[0].tag === '0011_isi_plan_integrator_subjects' &&
      missing0011[0].when === 1793710000000 &&
      errorMissing0011.includes('idx=11') &&
      errorMissing0011.includes('0011_isi_plan_integrator_subjects') &&
      errorMissing0011.includes('1793710000000'),
    '(f2) Si falta 0011 en __drizzle_migrations falla indicando idx, tag y when',
    errorMissing0011
  );

  // (f3) Falta una con filas extra en la DB -> sigue fallando; con todas + filas extra -> pasa
  const extraRows: AppliedMigrationRow[] = [
    { id: 99, hash: 'extra-hash-1', created_at: '1999999999999' },
    { id: 100, hash: 'extra-hash-2', created_at: '1700000000001' },
  ];
  const rowsMissing0012WithExtras = [
    ...fullDbRows.filter((r) => Number(r.created_at) !== 1793720000000),
    ...extraRows,
  ];
  let errorMissingWithExtras = '';
  try {
    verifyMigrationState(localEntries, rowsMissing0012WithExtras, () => {});
  } catch (err) {
    errorMissingWithExtras = (err as Error).message;
  }
  const missingWithAllAndExtras = findMissingMigrations(localEntries, [...fullDbRows, ...extraRows]);
  let errorAllWithExtras: Error | null = null;
  try {
    verifyMigrationState(localEntries, [...fullDbRows, ...extraRows], () => {});
  } catch (err) {
    errorAllWithExtras = err as Error;
  }
  assert(
    errorMissingWithExtras.includes('idx=12') &&
      errorMissingWithExtras.includes('0012_isi_plan_special_rules_descriptions') &&
      errorMissingWithExtras.includes('1793720000000') &&
      missingWithAllAndExtras.length === 0 &&
      errorAllWithExtras === null,
    '(f3) Falta una migración con filas extra falla igual; todas registradas + filas extra pasan sin fallar',
    errorMissingWithExtras
  );

  // (f4) Hash distinto en migración ya aplicada -> solo avisa (warn), nunca aborta
  const rowsDifferentHash = fullDbRows.map((row) =>
    Number(row.created_at) === 1793700000000 ? { ...row, hash: 'hash-modificado-manual' } : row
  );
  const hashMismatchWarnings: string[] = [];
  let hashMismatchError: Error | null = null;
  const detectedMismatches = findMigrationHashMismatches(localEntries, rowsDifferentHash);
  try {
    verifyMigrationState(localEntries, rowsDifferentHash, (msg) => hashMismatchWarnings.push(msg));
  } catch (err) {
    hashMismatchError = err as Error;
  }
  assert(
    hashMismatchError === null &&
      detectedMismatches.length === 1 &&
      detectedMismatches[0].tag === '0010_isi_plan_short_names' &&
      hashMismatchWarnings.length === 1 &&
      hashMismatchWarnings[0].includes('0010_isi_plan_short_names'),
    '(f4) Hash distinto en migración aplicada emite console.warn sin abortar'
  );

  // (f5) when repetido o decreciente falla la verificación previa estática
  let repeatedError = '';
  try {
    assertJournalStrictlyIncreasing([
      { idx: 0, tag: '0000_a', when: 1000 },
      { idx: 1, tag: '0001_b', when: 1000 },
    ]);
  } catch (err) {
    repeatedError = (err as Error).message;
  }
  let decreasingError = '';
  try {
    assertJournalStrictlyIncreasing([
      { idx: 0, tag: '0000_a', when: 1000 },
      { idx: 1, tag: '0001_b', when: 2000 },
      { idx: 2, tag: '0002_c', when: 1500 },
    ]);
  } catch (err) {
    decreasingError = (err as Error).message;
  }
  assert(
    repeatedError.includes('idx=1') &&
      repeatedError.includes('1000') &&
      decreasingError.includes('idx=2') &&
      decreasingError.includes('1500'),
    '(f5) when repetido o decreciente falla la verificación estática previa del journal'
  );

  // (f6) Base vacía (dbRows = []) -> reporta todas las migraciones como faltantes y falla
  const missingEmpty = findMissingMigrations(localEntries, []);
  let emptyDbError = '';
  try {
    verifyMigrationState(localEntries, [], () => {});
  } catch (err) {
    emptyDbError = (err as Error).message;
  }
  assert(
    missingEmpty.length === localEntries.length &&
      emptyDbError.includes(`Faltan ${localEntries.length} migración(es)`),
    '(f6) Base vacía (dbRows = []) detecta todas las migraciones faltantes y falla'
  );

  // (g) Demo rojo-verde: _journal.json pre-fix (c5d321f) vs corregido (c04fbb9) sobre corte histórico 0000..0013
  const historical0013Entries = localEntries.slice(0, 14);
  const brokenTimestamps = new Map<number, number>([
    [11, 1776729600000],
    [12, 1776816000000],
    [13, 1776902400000],
  ]);
  const c5d321fEntries = historical0013Entries.map((e) => ({
    ...e,
    when: brokenTimestamps.get(e.idx) ?? e.when,
  }));

  // Rojo 1: pre-check + runMigrations detienen c5d321f antes de migrar
  const tmpBrokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'correlativas-mig-c5d321f-'));
  let runMigrationsBrokenMsg = '';
  try {
    fs.mkdirSync(path.join(tmpBrokenDir, 'meta'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpBrokenDir, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', dialect: 'postgresql', entries: c5d321fEntries }, null, 2)
    );
    for (const e of c5d321fEntries) {
      fs.copyFileSync(path.join(drizzleDir, `${e.tag}.sql`), path.join(tmpBrokenDir, `${e.tag}.sql`));
    }
    try {
      await runMigrations({ migrationsFolder: tmpBrokenDir });
    } catch (err) {
      runMigrationsBrokenMsg = (err as Error).message;
    }
  } finally {
    fs.rmSync(tmpBrokenDir, { recursive: true, force: true });
  }

  // Rojo 2: simulación post-migrate contra DB en 0010 también frena 0011..0013 de c5d321f
  const dbRowsUpTo0010 = fullDbRows.slice(0, 11); // id 1..11 (0000..0010)
  const c5d321fSkippedByDrizzle = simulateDrizzlePending(c5d321fEntries, {
    created_at: 1793700000000,
  });
  let postMigrateGuardError = '';
  try {
    verifyMigrationState(c5d321fEntries, dbRowsUpTo0010, () => {});
  } catch (err) {
    postMigrateGuardError = (err as Error).message;
  }

  // Verde: corte 0013 (c04fbb9) aplica 0011..0013 desde 0010 y el journal actual completo pasa pre-check + verifyMigrationState
  const c04fbb9AppliedTags = simulateDrizzlePending(historical0013Entries, { created_at: 1793700000000 });
  let greenError: Error | null = null;
  try {
    assertJournalStrictlyIncreasing(localEntries);
    verifyMigrationState(localEntries, fullDbRows, () => {});
  } catch (err) {
    greenError = err as Error;
  }

  assert(
    runMigrationsBrokenMsg.includes('idx=11') &&
      runMigrationsBrokenMsg.includes('0011_isi_plan_integrator_subjects') &&
      runMigrationsBrokenMsg.includes('1776729600000') &&
      c5d321fSkippedByDrizzle.length === 0 &&
      postMigrateGuardError.includes('0011_isi_plan_integrator_subjects') &&
      postMigrateGuardError.includes('0012_isi_plan_special_rules_descriptions') &&
      postMigrateGuardError.includes('0013_isi_plan_intermediate_and_pps_copy') &&
      c04fbb9AppliedTags.length === 3 &&
      greenError === null,
    '(g) Demo rojo-verde: _journal.json pre-fix (c5d321f) frena el incidente 0011-0013 y c04fbb9/HEAD pasa'
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
        d.plan.config.ppsRequirement?.description === 'Cumplís los requisitos para cursar la Práctica Profesional' &&
        Object.keys(d.plan.config.ppsRequirement || {}).length === 3 &&
        d.plan.config.intermediateDegrees?.[0]?.name === 'Analista Universitario de Sistemas de Información' &&
        d.plan.config.intermediateDegrees?.[0]?.shortLabel === 'Analista' &&
        d.plan.config.intermediateDegrees?.[0]?.shortTitle === 'Analista Universitario' &&
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
        subjById.get(1)?.shortName === 'Análisis Mat. 1' &&
        subjById.get(1)?.isIntegrator === undefined &&
        !('specialRule' in subjById.get(1)) &&
        subjById.get(16)?.isIntegrator === true &&
        subjById.get(23)?.isIntegrator === true &&
        subjById.get(30)?.isIntegrator === true &&
        subjById.get(36)?.isIntegrator === true &&
        subjById.get(36)?.specialRule ===
          'Para RENDIRLO hay que tener aprobadas todas las materias previas del plan (1 a 35 + Seminario 99 + Electivas).' &&
        subjById.get(99)?.code === '99' &&
        subjById.get(99)?.shortName === 'Seminario Integrador' &&
        subjById.get(99)?.isIntegrator === true &&
        subjById.get(99)?.specialRule ===
          'Para RENDIRLO hay que tener aprobadas todas las materias de 1 a 23.' &&
        subjById.get(301)?.code === 'E-301' &&
        subjById.get(301)?.shortName === 'Backend de Aplicaciones' &&
        subjById.get(301)?.isIntegrator === undefined &&
        subjById.get(405)?.code === 'E-405' &&
        subjById.get(501)?.code === 'E-501' &&
        subjById.get(408)?.code === 'X-408' &&
        subjById.get(408)?.shortName === 'Interfaces y UIX' &&
        subjById.get(514)?.code === 'X-514' &&
        subjById.get(514)?.shortName === 'PPS' &&
        d.subjects.filter((s: any) => s.isIntegrator === true).length === 5 &&
        d.subjects.filter((s: any) => typeof s.specialRule === 'string').length === 2,
      'Payload expone subject.code ("1", "99", "E-301", "X-408"), shortName de 0010, isIntegrator (5) y specialRule (99 y 36)'
    );
    assert(
      d.rules.some(
        (r: any) =>
          r.subjectCode === 99 &&
          r.ruleType === 'approved_range' &&
          r.description === 'Para RENDIRLO hay que tener aprobadas todas las materias de 1 a 23.'
      ) &&
        d.rules.some(
          (r: any) =>
            r.subjectCode === 36 &&
            r.ruleType === 'all_previous_core_approved' &&
            r.description ===
              'Para RENDIRLO hay que tener aprobadas todas las materias previas del plan (1 a 35 + Seminario 99 + Electivas).'
        ) &&
        d.acronyms.DDS === 20 &&
        d.acronyms.AED === 6,
      'Payload conserva rules (99 y 36 con descripciones exactas de fixtures) y mapa de siglas (DDS=20, AED=6)'
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

    // 3d-bis. Electivas de otra carrera (no ISI 2023) nunca reciben prefijo E-/X- hardcoded
    const indPlan = store.seedPlanFromCatalogJson(
      {
        ...catalogJson,
        career: { name: 'Ingeniería Industrial', code: 'IND' },
        studyPlan: { name: 'Plan 2025', year: 2025, isActive: true, config: { totalLevels: 5, levelLabel: 'Año' } },
        subjects: [
          {
            codeInPlan: 301,
            displayCode: null,
            name: 'Electiva Sin Prefijo',
            shortName: 'Elec. 301',
            level: 3,
            modality: '1C',
            contraCuatrimestral: false,
            weeklyHours: 4,
            kind: 'electiva',
            credits: 3,
          },
          {
            codeInPlan: 408,
            displayCode: 'OPT-408',
            name: 'Electiva Display Explícito',
            shortName: 'Opt. 408',
            level: 4,
            modality: '2C',
            contraCuatrimestral: false,
            weeklyHours: 4,
            kind: 'electiva',
            credits: 3,
          },
        ],
        specialRules: [],
        acronyms: [],
      },
      { careerStatus: 'published', planStatus: 'published', isActive: true }
    );
    const indRes = await fetch(`${baseUrl}/api/catalog/plans/${indPlan.planId}`);
    const indBody = (await indRes.json()) as any;
    const indSubjById = new Map<number, any>((indBody.data?.subjects || []).map((s: any) => [s.id, s]));
    assert(
      indRes.status === 200 &&
        indSubjById.get(301)?.code === '301' &&
        indSubjById.get(408)?.code === 'OPT-408',
      'Electivas de planes no-ISI no reciben prefijo E-/X- hardcoded y respetan displayCode explícito'
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
