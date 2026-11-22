process.env.NODE_ENV = 'test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test_jwt_secret_super_seguro_de_al_menos_32_caracteres_2026';
process.env.REFRESH_SECRET =
  process.env.REFRESH_SECRET || 'test_refresh_secret_super_seguro_min_32_caracteres_2026';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://offline:offline@localhost:5432/offline_test';

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import zlib from 'node:zlib';
import jwt from 'jsonwebtoken';
import * as xlsxModule from 'xlsx';
import {
  PLAN_IMPORT_MAX_BYTES,
  PLAN_TEMPLATE_HEADERS,
  PLAN_TEMPLATE_SHEETS,
  SUPPORTED_SPECIAL_RULE_TYPES,
  classifySharedSubjectMatch,
  isSupportedSpecialRuleType,
  normalizeSharedSubjectName,
} from '../src/modules/admin/planImport.rules.js';
import { buildPlanImportTemplateBuffer } from '../src/modules/admin/planImport.template.js';
import {
  PlanImportConcurrencyError,
  PlanImportTimeoutError,
  PlanImportUncompressedLimitError,
  isPlanImportLocked,
  parsePlanWorkbookBuffer,
  withPlanImportLock,
} from '../src/modules/admin/planImport.parser.js';

const XLSX = (xlsxModule as any).default || xlsxModule;

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

function buildWorkbookBuffer(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

function makeValidNeutralSheets(): Record<string, unknown[][]> {
  return {
    [PLAN_TEMPLATE_SHEETS.PLAN]: [
      [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.PLAN]],
      [
        'Plan Ingeniería Ficticia 2026',
        2026,
        'Año',
        '', // omit Total niveles to verify max(level) derivation (= 5)
        6,
        2,
        6,
        'Ingeniero/a Ficticio/a',
        'IFIC · Plan 2026',
        7,
        'Habilitación Práctica Ficticia',
        'Cumplís los requisitos para cursar la práctica supervisada ficticia.',
        'Técnico/a Universitario/a Ficticio/a',
        'Técnico',
        'Técnico Ficticio',
        'tecnico',
        4,
        5,
      ],
    ],
    [PLAN_TEMPLATE_SHEETS.SUBJECTS]: [
      [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.SUBJECTS]],
      [1, 'IFIC-1', 'Dibujo Técnico', 'Dibujo Téc.', 1, 'A', 'NO', 4, 'obligatoria', '', 'NO', 'NO', ''],
      [2, 'IFIC-2', 'Física General', 'Física Gral.', 1, 'A', 'NO', 6, 'obligatoria', '', 'NO', 'NO', ''],
      [3, 'IFIC-3', 'Termodinámica Básica', 'Termodinámica', 2, '1C', 'NO', 5, 'obligatoria', '', 'NO', 'NO', ''],
      [4, 'IFIC-4', 'Taller de Diseño Aplicado', 'Taller Diseño', 2, '2C', 'NO', 4, 'obligatoria', '', 'SI', 'NO', ''],
      [5, 'IFIC-5', 'Taller Intermedio de Síntesis', 'Taller Síntesis', 3, 'A', 'NO', 6, 'obligatoria', '', 'SI', 'SI', 'tecnico'],
      [6, 'IFIC-6', 'Ingeniería de Procesos Ficticios', 'Ing. Procesos', 4, '1C', 'NO', 6, 'obligatoria', '', 'NO', 'NO', ''],
      [7, 'IFIC-7', 'Práctica Profesional Ficticia', 'Práctica Fict.', 4, '2C', 'NO', 4, 'obligatoria', '', 'NO', 'NO', ''],
      [8, 'IFIC-8', 'Proyecto Integrador Final', 'Proyecto Final', 5, 'A', 'NO', 8, 'obligatoria', '', 'SI', 'NO', ''],
      [101, 'ELEC-101', 'Seminario Ficticio Alpha', 'Seminario Alpha', 4, '1C-CC', 'SI', 4, 'electiva', 4, 'NO', 'NO', ''],
      [102, 'ELEC-102', 'Laboratorio Ficticio Beta', 'Lab. Beta', 5, '2C', 'NO', 4, 'electiva', 6, 'NO', 'NO', ''],
    ],
    [PLAN_TEMPLATE_SHEETS.PREREQUISITES]: [
      [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.PREREQUISITES]],
      [3, 2, 'regular'],
      [4, 1, 'aprobada'],
      [5, 3, 'regular'],
      [5, 4, 'regular'],
      [6, 5, 'regular'],
      [7, 3, 'aprobada'],
      [7, 4, 'aprobada'],
      [7, 5, 'regular'],
      [8, 5, 'aprobada'],
      [8, 6, 'regular'],
      [101, 3, 'regular'],
      [102, 6, 'regular'],
    ],
    [PLAN_TEMPLATE_SHEETS.RULES]: [
      [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES]],
      [5, 'approved_range', 1, 4, '', 'Obligatorias 1 a 4 aprobadas requeridas.'],
      [8, 'all_previous_core_approved', '', '', '', 'Todas las obligatorias previas aprobadas.'],
    ],
    [PLAN_TEMPLATE_SHEETS.ACRONYMS]: [
      [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.ACRONYMS]],
      ['DIB', 1],
      ['TIS', 5],
      ['PPF', 7],
      ['PIF', 8],
    ],
  };
}

async function runTests(): Promise<void> {
  console.log('\n======================================================================');
  console.log(' 🧪 TESTS PLAN IMPORT: PLANTILLA, PARSER WORKER Y VALIDACIONES (TRAMO 2A)');
  console.log('======================================================================\n');

  // 1. Template structure + self-roundtrip
  console.log('📌 1. Plantilla canónica .xlsx y encabezados exactos');
  const templateBuffer = buildPlanImportTemplateBuffer();
  const rawTemplateWb = XLSX.read(templateBuffer, { type: 'buffer' });
  const expectedSheetNames = Object.values(PLAN_TEMPLATE_SHEETS);
  const allHeadersMatch = expectedSheetNames.every((sheetName) => {
    const ws = rawTemplateWb.Sheets[sheetName];
    if (!ws) return false;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
    const headerRow = (rows[0] || []).map((cell) => String(cell).trim());
    return JSON.stringify(headerRow) === JSON.stringify([...PLAN_TEMPLATE_HEADERS[sheetName]]);
  });
  assert(
    templateBuffer.length > 0 &&
      JSON.stringify(rawTemplateWb.SheetNames) === JSON.stringify(expectedSheetNames) &&
      allHeadersMatch,
    'buildPlanImportTemplateBuffer() incluye las 6 hojas y encabezados exactos esperados'
  );

  const instRows = XLSX.utils.sheet_to_json(
    rawTemplateWb.Sheets[PLAN_TEMPLATE_SHEETS.INSTRUCTIONS],
    { header: 1 }
  ) as unknown[][];
  const instMap = new Map<string, string>();
  for (const r of instRows.slice(1)) {
    const sh = String(r[0] || '').trim();
    const col = String(r[1] || '').trim();
    const example = String(r[4] || '').trim();
    if (sh && col) instMap.set(`${sh}:${col}`, example);
  }
  const missingExamples: string[] = [];
  for (const sheetName of [
    PLAN_TEMPLATE_SHEETS.PLAN,
    PLAN_TEMPLATE_SHEETS.SUBJECTS,
    PLAN_TEMPLATE_SHEETS.PREREQUISITES,
    PLAN_TEMPLATE_SHEETS.RULES,
    PLAN_TEMPLATE_SHEETS.ACRONYMS,
  ]) {
    for (const col of PLAN_TEMPLATE_HEADERS[sheetName]) {
      if (!instMap.get(`${sheetName}:${col}`)) {
        missingExamples.push(`${sheetName}:${col}`);
      }
    }
  }
  assert(
    missingExamples.length === 0,
    'Instrucciones documenta con un Ejemplo concreto cada columna de todas las hojas de la plantilla',
    missingExamples.join(', ')
  );

  const parsedTemplate = await parsePlanWorkbookBuffer({
    fileName: 'plantilla-plan.xlsx',
    buffer: templateBuffer,
  });
  const templateDump = JSON.stringify(parsedTemplate.data);
  const containsForbiddenCareerCopy =
    /Sistemas de Información|Analista Universitario|Ingeniería Industrial|Gestión Industrial/i.test(
      templateDump
    );
  assert(
    parsedTemplate.valid === true &&
      parsedTemplate.errors.length === 0 &&
      parsedTemplate.data?.plan.name === 'Plan Ingeniería Ficticia 2026' &&
      parsedTemplate.data?.plan.totalLevels === 5 &&
      parsedTemplate.data?.subjects.length === 10 &&
      parsedTemplate.data?.prerequisites.length === 12 &&
      parsedTemplate.data?.specialRules.length === 2 &&
      parsedTemplate.data?.acronyms.length === 4 &&
      !containsForbiddenCareerCopy,
    'La plantilla descargable usa Ingeniería Ficticia (5 niveles, sin Sistemas/Industrial) y pasa ida y vuelta'
  );

  // 2. Neutral 5-level plan without Total niveles / custom displayCode / intermediate + PPS
  console.log('\n📌 2. Parseo Ingeniería Ficticia (5 niveles, electivas, intermedio, PPS y displayCode explícito)');
  const validBuf = buildWorkbookBuffer(makeValidNeutralSheets());
  const validRes = await parsePlanWorkbookBuffer({ fileName: 'ingenieria-ficticia-2026.xlsx', buffer: validBuf });
  assert(
    validRes.valid === true &&
      validRes.data?.plan.totalLevels === 5 &&
      validRes.data?.plan.defaultMinPassingGrade === 6 &&
      validRes.data?.plan.intermediateDegrees[0]?.specialRuleSubjectCode === 5 &&
      validRes.data?.plan.ppsRequirement?.referenceSubjectCode === 7 &&
      validRes.data?.subjects[0].displayCode === 'IFIC-1' &&
      validRes.data?.specialRules[0].ruleType === 'approved_range' &&
      validRes.data?.specialRules[1].ruleType === 'all_previous_core_approved',
    'Deriva totalLevels=5 desde Materias y conserva displayCode explícito, título intermedio y PPS sin prefijos automáticos'
  );

  // 3. File extension, size, magic bytes & macro artifacts
  console.log('\n📌 3. Controles de archivo: extensión, 5 MB, ZIP PK, macros VBA y fórmulas');
  const badExt = await parsePlanWorkbookBuffer({ fileName: 'plan.xlsm', buffer: validBuf });
  assert(!badExt.valid && badExt.errors[0].message.includes('.xlsx'), 'Rechaza extensión distinta a .xlsx');

  const emptyBufRes = await parsePlanWorkbookBuffer({ fileName: 'empty.xlsx', buffer: Buffer.alloc(0) });
  assert(!emptyBufRes.valid, 'Rechaza buffer vacío');

  const overLimit = await parsePlanWorkbookBuffer({
    fileName: 'big.xlsx',
    buffer: Buffer.alloc(PLAN_IMPORT_MAX_BYTES + 1, 0x50),
  });
  assert(!overLimit.valid && overLimit.errors[0].message.includes('5 MB'), 'Rechaza archivos > 5 MB');

  const nonZip = await parsePlanWorkbookBuffer({
    fileName: 'fake.xlsx',
    buffer: Buffer.from('THIS IS NOT A ZIP ARCHIVE'),
  });
  assert(!nonZip.valid && nonZip.errors[0].message.includes('PK'), 'Rechaza archivo sin firma ZIP PK');

  const macroSpoof = Buffer.concat([validBuf, Buffer.from('xl/vbaProject.bin')]);
  const macroRes = await parsePlanWorkbookBuffer({ fileName: 'macro.xlsx', buffer: macroSpoof });
  assert(!macroRes.valid && macroRes.errors[0].message.includes('macros VBA'), 'Rechaza artefactos vbaProject.bin');

  // Formula cell inside Excel & formula injection string
  const formulaSheets = makeValidNeutralSheets();
  const formulaWb = XLSX.utils.book_new();
  for (const [k, v] of Object.entries(formulaSheets)) {
    XLSX.utils.book_append_sheet(formulaWb, XLSX.utils.aoa_to_sheet(v), k);
  }
  formulaWb.Sheets[PLAN_TEMPLATE_SHEETS.SUBJECTS]['C2'] = { t: 's', v: 'Dibujo', f: '1+1' };
  const formulaBuf = Buffer.from(XLSX.write(formulaWb, { type: 'buffer', bookType: 'xlsx' }));
  const formulaRes = await parsePlanWorkbookBuffer({ fileName: 'formula.xlsx', buffer: formulaBuf });
  assert(!formulaRes.valid && formulaRes.errors.some((e) => e.message.includes('fórmulas')), 'Rechaza celdas con fórmula (.f)');

  const csvInjSheets = makeValidNeutralSheets();
  csvInjSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS][1][2] = '=cmd|"/C calc"!A0';
  const csvInjRes = await parsePlanWorkbookBuffer({
    fileName: 'csvinj.xlsx',
    buffer: buildWorkbookBuffer(csvInjSheets),
  });
  assert(!csvInjRes.valid && csvInjRes.errors.some((e) => e.message.includes('prefijo de fórmula')), 'Rechaza strings con prefijo =/@/control');

  // 4. Limits (>10 sheets and >2000 rows) + header/domain checks
  console.log('\n📌 4. Límites de hojas (>10), filas (>2000), ciclos DFS y validación de reglas');
  const elevenSheets = makeValidNeutralSheets();
  for (let s = 1; s <= 6; s++) {
    elevenSheets[`Extra_${s}`] = [['Col'], ['Dato']];
  }
  const elevenRes = await parsePlanWorkbookBuffer({
    fileName: '11sheets.xlsx',
    buffer: buildWorkbookBuffer(elevenSheets),
  });
  assert(!elevenRes.valid && elevenRes.errors[0].message.includes('10'), 'Rechaza > 10 hojas');

  const manyRowsSheets = makeValidNeutralSheets();
  for (let r = 200; r <= 2220; r++) {
    manyRowsSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS].push([
      r,
      String(r),
      `Materia ${r}`,
      `Mat ${r}`,
      1,
      '1C',
      'NO',
      4,
      'obligatoria',
      '',
      'NO',
      'NO',
      '',
    ]);
  }
  const manyRowsRes = await parsePlanWorkbookBuffer({
    fileName: '2001rows.xlsx',
    buffer: buildWorkbookBuffer(manyRowsSheets),
  });
  assert(!manyRowsRes.valid && manyRowsRes.errors[0].message.includes('2000'), 'Rechaza > 2000 filas');

  // Directed cycle detection (1 -> 5 -> 4 -> 1)
  const cycleSheets = makeValidNeutralSheets();
  cycleSheets[PLAN_TEMPLATE_SHEETS.PREREQUISITES].push([1, 5, 'regular']);
  const cycleRes = await parsePlanWorkbookBuffer({
    fileName: 'cycle.xlsx',
    buffer: buildWorkbookBuffer(cycleSheets),
  });
  assert(!cycleRes.valid && cycleRes.errors.some((e) => e.message.includes('Ciclo detectado')), 'Detecta ciclos DFS en correlativas');

  // Self dependency
  const selfSheets = makeValidNeutralSheets();
  selfSheets[PLAN_TEMPLATE_SHEETS.PREREQUISITES].push([2, 2, 'regular']);
  const selfRes = await parsePlanWorkbookBuffer({
    fileName: 'self.xlsx',
    buffer: buildWorkbookBuffer(selfSheets),
  });
  assert(!selfRes.valid && selfRes.errors.some((e) => e.message.includes('Auto-correlativa')), 'Rechaza auto-correlativas');

  // Duplicate codeInPlan & nonexistent prereq
  const dupSheets = makeValidNeutralSheets();
  dupSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS].push([1, 'DUP', 'Duplicada', 'Dup', 1, '1C', 'NO', 4, 'obligatoria', '', 'NO', 'NO', '']);
  dupSheets[PLAN_TEMPLATE_SHEETS.PREREQUISITES].push([2, 999, 'regular']);
  const dupRes = await parsePlanWorkbookBuffer({
    fileName: 'dup.xlsx',
    buffer: buildWorkbookBuffer(dupSheets),
  });
  assert(
    !dupRes.valid &&
      dupRes.errors.some((e) => e.message.includes('duplicado: 1')) &&
      dupRes.errors.some((e) => e.message.includes('999')),
    'Rechaza códigos duplicados y destinos de correlativa inexistentes'
  );

  // Special rules: min_credits and unknown rule types MUST be blocked
  const minCreditsSheets = makeValidNeutralSheets();
  minCreditsSheets[PLAN_TEMPLATE_SHEETS.RULES] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES]],
    [3, 'min_credits', 10, '', '', 'No soportado'],
  ];
  const minCreditsRes = await parsePlanWorkbookBuffer({
    fileName: 'mincredits.xlsx',
    buffer: buildWorkbookBuffer(minCreditsSheets),
  });
  assert(
    !isSupportedSpecialRuleType('min_credits') &&
      JSON.stringify(SUPPORTED_SPECIAL_RULE_TYPES) ===
        JSON.stringify(['approved_range', 'all_previous_core_approved']) &&
      !minCreditsRes.valid &&
      minCreditsRes.errors.some((e) => e.message.includes('min_credits') && e.message.includes('no soportado')),
    'Rechaza min_credits y cualquier regla no implementada en src/utils/correlativas.ts'
  );

  // Reject invalid approved_range (Desde > Hasta)
  const badRangeSheets = makeValidNeutralSheets();
  badRangeSheets[PLAN_TEMPLATE_SHEETS.RULES] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES]],
    [3, 'approved_range', 2, 1, '', 'Rango invertido'],
  ];
  const badRangeRes = await parsePlanWorkbookBuffer({
    fileName: 'badrange.xlsx',
    buffer: buildWorkbookBuffer(badRangeSheets),
  });
  assert(!badRangeRes.valid && badRangeRes.errors.some((e) => e.message.includes('mayor a "Hasta código"')), 'Valida rango inválido en approved_range');

  // Optional description generates clear default + comma-separated excludeTrackKeys validation
  const trackRuleSheets = makeValidNeutralSheets();
  for (let col = 12; col <= 17; col++) {
    trackRuleSheets[PLAN_TEMPLATE_SHEETS.PLAN][1][col] = '';
  }
  trackRuleSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS][1][11] = 'SI';
  trackRuleSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS][1][12] = 'tr_a';
  trackRuleSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS][2][11] = 'SI';
  trackRuleSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS][2][12] = 'tr_b';
  trackRuleSheets[PLAN_TEMPLATE_SHEETS.RULES] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES]],
    [3, 'all_previous_core_approved', '', '', 'tr_a, tr_b', ''],
  ];
  const trackRuleRes = await parsePlanWorkbookBuffer({
    fileName: 'trackrule.xlsx',
    buffer: buildWorkbookBuffer(trackRuleSheets),
  });
  const badTrackRuleSheets = makeValidNeutralSheets();
  for (let col = 12; col <= 17; col++) {
    badTrackRuleSheets[PLAN_TEMPLATE_SHEETS.PLAN][1][col] = '';
  }
  badTrackRuleSheets[PLAN_TEMPLATE_SHEETS.RULES] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES]],
    [3, 'all_previous_core_approved', 1, '', 'inexistente', ''],
  ];
  const badTrackRuleRes = await parsePlanWorkbookBuffer({
    fileName: 'badtrackrule.xlsx',
    buffer: buildWorkbookBuffer(badTrackRuleSheets),
  });
  assert(
    trackRuleRes.valid === true &&
      JSON.stringify(trackRuleRes.data?.specialRules[0]?.params) ===
        JSON.stringify({ excludeTrackKeys: ['tr_a', 'tr_b'] }) &&
      (trackRuleRes.data?.specialRules[0]?.description || '').includes('tr_a, tr_b') &&
      !badTrackRuleRes.valid,
    'Reglas acepta columnas simples (Trayectos excluidos separados por coma) y descripción por defecto'
  );

  // Coherencia entre Modalidad y Contra-cuatrimestral
  const badCcConflict1 = makeValidNeutralSheets();
  badCcConflict1[PLAN_TEMPLATE_SHEETS.SUBJECTS][1][5] = '1C';
  badCcConflict1[PLAN_TEMPLATE_SHEETS.SUBJECTS][1][6] = 'SI';
  const badCcConflict2 = makeValidNeutralSheets();
  badCcConflict2[PLAN_TEMPLATE_SHEETS.SUBJECTS][1][5] = '1C-CC';
  badCcConflict2[PLAN_TEMPLATE_SHEETS.SUBJECTS][1][6] = 'NO';
  const blankCcDerivesTrue = makeValidNeutralSheets();
  blankCcDerivesTrue[PLAN_TEMPLATE_SHEETS.SUBJECTS][1][5] = '2C-CC';
  blankCcDerivesTrue[PLAN_TEMPLATE_SHEETS.SUBJECTS][1][6] = '';

  const ccRes1 = await parsePlanWorkbookBuffer({
    fileName: 'cc1.xlsx',
    buffer: buildWorkbookBuffer(badCcConflict1),
  });
  const ccRes2 = await parsePlanWorkbookBuffer({
    fileName: 'cc2.xlsx',
    buffer: buildWorkbookBuffer(badCcConflict2),
  });
  const ccResOk = await parsePlanWorkbookBuffer({
    fileName: 'cc3.xlsx',
    buffer: buildWorkbookBuffer(blankCcDerivesTrue),
  });
  assert(
    !ccRes1.valid &&
      ccRes1.errors.some((e) => e.message.includes('Contradicción')) &&
      !ccRes2.valid &&
      ccRes2.errors.some((e) => e.message.includes('Contradicción')) &&
      ccResOk.valid &&
      ccResOk.data?.subjects[0].contraCuatrimestral === true,
    'Rechaza contradicciones entre Modalidad y Contra-cuatrimestral y deduce true en 1C-CC/2C-CC vacío'
  );

  // Prototype pollution attempt in Trayectos excluidos (plus existing header/cell checks below)
  const protoSheets = makeValidNeutralSheets();
  protoSheets[PLAN_TEMPLATE_SHEETS.RULES] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES]],
    [3, 'all_previous_core_approved', '', '', '__proto__, constructor', 'Prototipo'],
  ];
  const protoRes = await parsePlanWorkbookBuffer({
    fileName: 'proto.xlsx',
    buffer: buildWorkbookBuffer(protoSheets),
  });
  assert(
    !protoRes.valid && ({} as Record<string, unknown>).polluted === undefined,
    'Bloquea claves peligrosas (__proto__) sin contaminar Object.prototype'
  );

  // __proto__ and constructor in headers AND cells
  const protoHeaderSheets = makeValidNeutralSheets();
  protoHeaderSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS][0][2] = '__proto__';
  const ctorHeaderSheets = makeValidNeutralSheets();
  ctorHeaderSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS][0][2] = 'constructor';
  const protoCellSheets = makeValidNeutralSheets();
  protoCellSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS][1][2] = '__proto__';
  const ctorCellSheets = makeValidNeutralSheets();
  ctorCellSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS][1][2] = 'constructor';

  const protoHeaderRes = await parsePlanWorkbookBuffer({
    fileName: 'proto-header.xlsx',
    buffer: buildWorkbookBuffer(protoHeaderSheets),
  });
  const ctorHeaderRes = await parsePlanWorkbookBuffer({
    fileName: 'ctor-header.xlsx',
    buffer: buildWorkbookBuffer(ctorHeaderSheets),
  });
  const protoCellRes = await parsePlanWorkbookBuffer({
    fileName: 'proto-cell.xlsx',
    buffer: buildWorkbookBuffer(protoCellSheets),
  });
  const ctorCellRes = await parsePlanWorkbookBuffer({
    fileName: 'ctor-cell.xlsx',
    buffer: buildWorkbookBuffer(ctorCellSheets),
  });
  assert(
    !protoHeaderRes.valid &&
      !ctorHeaderRes.valid &&
      !protoCellRes.valid &&
      !ctorCellRes.valid &&
      ({} as Record<string, unknown>).polluted === undefined &&
      ({}).constructor === Object,
    'Rechaza __proto__ y constructor en encabezados y celdas sin contaminar prototipos'
  );

  // 5. Worker isolation: timeout + concurrency limit = 1 + no secrets leak
  console.log('\n📌 5. Aislamiento del Worker: timeout, mutex concurrencia = 1 y liberación');
  let timeoutCaught: unknown = null;
  try {
    await parsePlanWorkbookBuffer({
      fileName: 'slow.xlsx',
      buffer: validBuf,
      timeoutMs: 40,
      artificialWorkerDelayMs: 400,
    });
  } catch (err) {
    timeoutCaught = err;
  }
  assert(
    timeoutCaught instanceof PlanImportTimeoutError &&
      timeoutCaught.statusCode === 408 &&
      !isPlanImportLocked(),
    'Aborta worker excedido de tiempo (terminate + 408) y libera lock correctamente'
  );

  // Global concurrency limit = 1
  const firstPromise = parsePlanWorkbookBuffer({
    fileName: 'first.xlsx',
    buffer: validBuf,
    artificialWorkerDelayMs: 120,
  });
  let secondError: unknown = null;
  try {
    await parsePlanWorkbookBuffer({
      fileName: 'second.xlsx',
      buffer: validBuf,
    });
  } catch (err) {
    secondError = err;
  }
  const firstDone = await firstPromise;
  assert(
    firstDone.valid === true &&
      secondError instanceof PlanImportConcurrencyError &&
      secondError.statusCode === 409 &&
      !isPlanImportLocked(),
    'Limita concurrencia global a 1 proceso simultáneo (rechaza el 2do con 409) y libera al terminar'
  );

  // ---------------------------------------------------------------------------
  // 6. Endpoints HTTP Admin (/api/admin/plans/*), RBAC, CSRF y Reauth
  // ---------------------------------------------------------------------------
  const { env } = await import('../src/config/env.js');
  const { createApp } = await import('../src/app.js');
  const { setLiveUserResolverForTesting } = await import('../src/middlewares/auth.middleware.js');
  const {
    InMemoryPlanImportStore,
    previewPlanImport,
    setPlanImportStoreForTesting,
  } = await import('../src/modules/admin/planImport.service.js');

  const store = new InMemoryPlanImportStore();
  const instId = '11111111-1111-4111-8111-111111111111';
  const facId = '22222222-2222-4222-8222-222222222222';
  const otherFacId = '22222222-2222-4222-8222-222222222223';
  const existingCareerId = '33333333-3333-4333-8333-333333333333';
  const existingPlanId = '44444444-4444-4444-8444-444444444444';
  const archivedPlanId = '44444444-4444-4444-8444-444444444445';
  const sharedDibujoId = '55555555-5555-4555-8555-555555555555';
  const sharedOtherFacId = '55555555-5555-4555-8555-555555555556';

  store.institutions.push({ id: instId, name: 'Universidad Tecnológica Nacional', code: 'UTN' });
  store.faculties.push(
    { id: facId, institutionId: instId, name: 'Facultad Regional Córdoba', code: 'FRC' },
    { id: otherFacId, institutionId: instId, name: 'Facultad Regional Buenos Aires', code: 'FRBA' }
  );
  store.careers.push({
    id: existingCareerId,
    facultyId: facId,
    name: 'Ingeniería en Sistemas de Información',
    code: 'ISI',
    status: 'published',
  });
  store.plans.push(
    {
      id: existingPlanId,
      careerId: existingCareerId,
      name: 'Plan 2023',
      year: 2023,
      isActive: true,
      status: 'published',
      config: { careerCode: 'ISI' },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      id: archivedPlanId,
      careerId: existingCareerId,
      name: 'Plan 2008',
      year: 2008,
      isActive: false,
      status: 'archived',
      config: { careerCode: 'ISI' },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }
  );
  store.sharedSubjects.push(
    {
      id: sharedDibujoId,
      facultyId: facId,
      stableCode: 'FRC-DIBUJO_TECNICO-01',
      displayName: 'Dibujo Técnico',
      normalizedName: 'dibujo tecnico',
    },
    {
      id: sharedOtherFacId,
      facultyId: otherFacId,
      stableCode: 'FRBA-ESTRUCTURAS_I-01',
      displayName: 'Estructuras I',
      normalizedName: 'estructuras i',
    }
  );
  store.subjects.push({
    id: '66666666-6666-4666-8666-666666666661',
    planId: existingPlanId,
    sharedSubjectId: sharedDibujoId,
    codeInPlan: 1,
    displayCode: '1',
    name: 'Dibujo Técnico',
    shortName: 'Dibujo',
    level: 1,
    modality: '1C',
    contraCuatrimestral: false,
    weeklyHours: 4,
    kind: 'obligatoria',
    credits: null,
    isOptionalTrack: false,
    trackKey: null,
    isIntegrator: false,
  });

  setPlanImportStoreForTesting(store);

  const mockUsers = new Map<
    string,
    { id: string; email: string; role: 'user' | 'admin'; status: 'active'; emailVerified: boolean }
  >([
    [
      'admin-import-1',
      {
        id: 'admin-import-1',
        email: 'admin-import@stack.com',
        role: 'admin',
        status: 'active',
        emailVerified: true,
      },
    ],
    [
      'admin-import-2',
      {
        id: 'admin-import-2',
        email: 'admin-import-2@stack.com',
        role: 'admin',
        status: 'active',
        emailVerified: true,
      },
    ],
    [
      'user-regular-1',
      {
        id: 'user-regular-1',
        email: 'alumno@frc.utn.edu.ar',
        role: 'user',
        status: 'active',
        emailVerified: true,
      },
    ],
  ]);
  setLiveUserResolverForTesting(async (id: string) => mockUsers.get(id) ?? null);

  const adminToken = jwt.sign(
    { id: 'admin-import-1', email: 'admin-import@stack.com', role: 'admin', emailVerified: true },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  const adminToken2 = jwt.sign(
    { id: 'admin-import-2', email: 'admin-import-2@stack.com', role: 'admin', emailVerified: true },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  const userToken = jwt.sign(
    { id: 'user-regular-1', email: 'alumno@frc.utn.edu.ar', role: 'user', emailVerified: true },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  const reauthToken = jwt.sign(
    {
      purpose: 'admin-reauth',
      userId: 'admin-import-1',
      adminEmail: 'admin-import@stack.com',
      iat: Math.floor(Date.now() / 1000),
    },
    env.JWT_SECRET,
    { expiresIn: '10m' }
  );
  const reauthToken2 = jwt.sign(
    {
      purpose: 'admin-reauth',
      userId: 'admin-import-2',
      adminEmail: 'admin-import-2@stack.com',
      iat: Math.floor(Date.now() / 1000),
    },
    env.JWT_SECRET,
    { expiresIn: '10m' }
  );

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  async function apiRequest(opts: {
    method: string;
    path: string;
    token?: string;
    body?: unknown;
    reauth?: string;
    skipCsrf?: boolean;
  }): Promise<{ status: number; data: any; rawBuffer: Buffer; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
      const headers: Record<string, string> = {};
      if (!opts.skipCsrf) headers['X-Requested-With'] = 'XMLHttpRequest';
      if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
      if (opts.reauth) headers['Cookie'] = `admin_reauth_token=${opts.reauth}`;
      if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload).toString();
      }
      const req = http.request(
        { hostname: '127.0.0.1', port, path: opts.path, method: opts.method, headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          res.on('end', () => {
            const rawBuffer = Buffer.concat(chunks);
            let data: any = null;
            try {
              data = JSON.parse(rawBuffer.toString('utf8'));
            } catch {
              data = rawBuffer.toString('utf8');
            }
            resolve({ status: res.statusCode || 500, data, rawBuffer, headers: res.headers });
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  try {
    console.log('\n📌 6. Seguridad HTTP, RBAC, CSRF, Reautenticación y Enrutamiento /plans/*');

    const unauthRes = await apiRequest({ method: 'GET', path: '/api/admin/plans' });
    assert(unauthRes.status === 401, 'GET /api/admin/plans sin token retorna 401');

    const nonAdminTemplate = await apiRequest({
      method: 'GET',
      path: '/api/admin/plans/template',
      token: userToken,
    });
    assert(nonAdminTemplate.status === 403, 'GET /api/admin/plans/template con usuario regular retorna 403');

    const missingCsrf = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: { dummy: true },
      skipCsrf: true,
    });
    assert(missingCsrf.status === 403, 'POST /api/admin/plans/preview sin header CSRF retorna 403');

    const templateRes = await apiRequest({
      method: 'GET',
      path: '/api/admin/plans/template',
      token: adminToken,
    });
    assert(
      templateRes.status === 200 &&
        String(templateRes.headers['content-type'] || '').includes('spreadsheetml.sheet') &&
        templateRes.rawBuffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
      'GET /api/admin/plans/template resuelve antes de :id y descarga binario XLSX válido (PK)'
    );

    const legacyCareer = await apiRequest({
      method: 'POST',
      path: '/api/admin/careers',
      token: adminToken,
      body: { facultyId: facId, name: 'Legacy', code: 'LEG' },
    });
    const legacyPlan = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans',
      token: adminToken,
      body: { careerId: existingCareerId, name: 'Legacy', year: 2026, subjects: [] },
    });
    assert(
      legacyCareer.status === 404 && legacyPlan.status === 404,
      'Endpoints rotos legados POST /api/admin/careers y POST /api/admin/plans fueron eliminados (404)'
    );

    const neutralBase64 = validBuf.toString('base64');
    const previewInput = {
      facultyId: facId,
      targetMode: 'new_career_and_plan' as const,
      careerName: 'Ingeniería Ficticia',
      careerCode: 'IFIC',
      fileName: 'ingenieria-ficticia-2026.xlsx',
      fileBase64: neutralBase64,
    };

    const importWithoutReauth = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/import',
      token: adminToken,
      body: { ...previewInput, previewHash: '0'.repeat(64) },
    });
    assert(
      importWithoutReauth.status === 403 && importWithoutReauth.data?.code === 'REAUTH_REQUIRED',
      'POST /api/admin/plans/import exige cookie de reautenticación reciente (403 REAUTH_REQUIRED)'
    );

    const deleteWithoutReauth = await apiRequest({
      method: 'DELETE',
      path: `/api/admin/plans/${existingPlanId}`,
      token: adminToken,
    });
    assert(
      deleteWithoutReauth.status === 403 && deleteWithoutReauth.data?.code === 'REAUTH_REQUIRED',
      'DELETE /api/admin/plans/:id exige cookie de reautenticación reciente (403 REAUTH_REQUIRED)'
    );

    console.log('\n📌 7. Vista Previa (/preview), Sugerencias Shared Subjects y Blindaje previewHash');
    const takeStoreSnapshot = () =>
      JSON.stringify({
        careers: store.careers,
        plans: store.plans,
        subjects: store.subjects,
        prerequisites: store.prerequisites,
        rules: store.rules,
        acronyms: store.acronyms,
        sharedSubjects: store.sharedSubjects,
        auditLogs: store.auditLogs,
      });
    let previewTxCalls = 0;
    const origRunInTx = store.runInTransaction.bind(store);
    store.runInTransaction = async (fn) => {
      previewTxCalls += 1;
      return origRunInTx(fn);
    };
    const snapshotBeforePreview = takeStoreSnapshot();

    const previewRes = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: previewInput,
    });
    const snapshotAfterPreview = takeStoreSnapshot();
    store.runInTransaction = origRunInTx;
    const previewData = previewRes.data?.data;
    const sugg1 = previewData?.sharedSubjectSuggestions?.find((s: any) => s.subjectCode === 1);
    const sugg2 = previewData?.sharedSubjectSuggestions?.find((s: any) => s.subjectCode === 2);
    const previewSubjects = previewData?.normalizedPlan?.subjects || [];

    assert(
      previewRes.status === 200 &&
        previewTxCalls === 0 &&
        snapshotBeforePreview === snapshotAfterPreview,
      'Vista previa (/preview) es estrictamente solo lectura: store espía registra 0 transacciones y 0 escrituras'
    );
    assert(
      previewRes.status === 200 &&
        previewData?.valid === true &&
        typeof previewData?.previewHash === 'string' &&
        previewData.previewHash.length === 64,
      'POST /api/admin/plans/preview valida Ingeniería Ficticia (5 niveles) y emite previewHash SHA-256'
    );
    assert(
      sugg1?.candidates?.length === 1 &&
        sugg1.candidates[0].sharedSubjectId === sharedDibujoId &&
        sugg1.selectedDecision === null &&
        sugg2?.candidates?.length === 0,
      'Sugiere shared_subject existente solo de la misma facultad y NUNCA lo autovincula (selectedDecision === null)'
    );
    assert(
      previewSubjects.every(
        (s: any) =>
          typeof s.code === 'string' &&
          (s.code.startsWith('IFIC-') || s.code.startsWith('ELEC-')) &&
          !s.code.startsWith('E-') &&
          !s.code.startsWith('X-')
      ),
      'El preview neutro preserva code propio (IFIC-*/ELEC-*) sin inyectar prefijos E-/X- de ISI'
    );

    // Manipulación del binario sin recalcular preview -> 409 PREVIEW_HASH_MISMATCH
    const tamperedSheets = makeValidNeutralSheets();
    (tamperedSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS][1] as unknown[])[2] = 'Dibujo Técnico Modificado';
    const tamperedBuf = buildWorkbookBuffer(tamperedSheets);
    const tamperedImportRes = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/import',
      token: adminToken,
      reauth: reauthToken,
      body: {
        ...previewInput,
        fileBase64: tamperedBuf.toString('base64'),
        previewHash: previewData.previewHash,
      },
    });
    assert(
      tamperedImportRes.status === 409 && tamperedImportRes.data?.code === 'PREVIEW_HASH_MISMATCH',
      'Rechaza /import con 409 PREVIEW_HASH_MISMATCH si cambia el .xlsx después del preview'
    );

    // Manipulación de decisiones respecto al previewHash original -> 409 PREVIEW_HASH_MISMATCH
    const tamperedDecisionRes = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/import',
      token: adminToken,
      reauth: reauthToken,
      body: {
        ...previewInput,
        sharedSubjectDecisions: [{ subjectCode: 1, action: 'link_existing', sharedSubjectId: sharedDibujoId }],
        previewHash: previewData.previewHash,
      },
    });
    assert(
      tamperedDecisionRes.status === 409 &&
        tamperedDecisionRes.data?.code === 'PREVIEW_HASH_MISMATCH',
      'Rechaza /import con 409 PREVIEW_HASH_MISMATCH si cambian sharedSubjectDecisions respecto al preview'
    );

    console.log('\n📌 8. Confirmación Atómica (/import), Listado Enriquecido y Detalle Draft');
    const linkedDecisions = [
      { subjectCode: 1, action: 'link_existing' as const, sharedSubjectId: sharedDibujoId },
    ];
    const boundPreviewRes = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: { ...previewInput, sharedSubjectDecisions: linkedDecisions },
    });
    const boundHash = boundPreviewRes.data?.data?.previewHash;
    const importRes = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/import',
      token: adminToken,
      reauth: reauthToken,
      body: { ...previewInput, sharedSubjectDecisions: linkedDecisions, previewHash: boundHash },
    });
    const importedPlanId = importRes.data?.data?.planId as string;
    const lastAudit = store.auditLogs[store.auditLogs.length - 1];

    assert(
      importRes.status === 201 &&
        importRes.data?.data?.status === 'draft' &&
        importRes.data?.data?.counts?.linkedExistingShared === 1 &&
        importRes.data?.data?.counts?.createdNewShared === 9 &&
        typeof importedPlanId === 'string',
      'POST /api/admin/plans/import crea carrera/plan en status draft, vincula shared elegido y crea nuevos 1:1'
    );
    assert(
      lastAudit?.action === 'plan.import.create_draft' &&
        lastAudit?.details?.previewHash === boundHash &&
        typeof lastAudit?.details?.fileSha256 === 'string' &&
        !JSON.stringify(lastAudit).includes('fileBase64') &&
        !JSON.stringify(lastAudit).includes(neutralBase64.slice(0, 24)),
      'admin_audit_log guarda solo metadatos resumidos y hashes (sin guardar el contenido binario del .xlsx)'
    );

    const listPlansRes = await apiRequest({
      method: 'GET',
      path: '/api/admin/plans',
      token: adminToken,
    });
    const listedDraft = (listPlansRes.data?.data?.plans || []).find((p: any) => p.id === importedPlanId);
    assert(
      listPlansRes.status === 200 &&
        listedDraft?.status === 'draft' &&
        listedDraft?.careerStatus === 'draft' &&
        listedDraft?.subjectCount === 10 &&
        listedDraft?.rulesCount === 2 &&
        listedDraft?.acronymsCount === 4 &&
        listedDraft?.sharedSubjectsCount === 10 &&
        listedDraft?.facultyName === 'Facultad Regional Córdoba',
      'GET /api/admin/plans devuelve listado enriquecido con conteos, facultades y estados draft'
    );

    const detailRes = await apiRequest({
      method: 'GET',
      path: `/api/admin/plans/${importedPlanId}`,
      token: adminToken,
    });
    const dibujoBinding = detailRes.data?.data?.adminMeta?.sharedSubjectBindings?.find(
      (b: any) => b.codeInPlan === 1
    );
    assert(
      detailRes.status === 200 &&
        detailRes.data?.data?.adminMeta?.planStatus === 'draft' &&
        detailRes.data?.data?.career?.code === 'IFIC' &&
        dibujoBinding?.linkedPlansCount === 2,
      'GET /api/admin/plans/:id entrega detalle normalizado incluso en estado draft'
    );

    console.log('\n📌 9. Re-importación Idempotente en Draft, Bloqueos de Borrado y Eliminación Segura');
    const countStateForPlan = (pid: string) => {
      const subs = store.subjects.filter((s) => s.planId === pid);
      const subIdSet = new Set(subs.map((s) => s.id));
      return {
        subjectIds: subs.map((s) => s.id).sort(),
        prereqsCount: store.prerequisites.filter((p) => subIdSet.has(p.subjectId)).length,
        rulesCount: store.rules.filter((r) => r.planId === pid).length,
        acronymsCount: store.acronyms.filter((a) => a.planId === pid).length,
        totalSharedSubjects: store.sharedSubjects.length,
      };
    };
    const sameBefore = countStateForPlan(importedPlanId);
    const sameFilePreview = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: {
        facultyId: facId,
        targetMode: 'existing_draft_plan',
        planId: importedPlanId,
        fileName: 'ingenieria-ficticia-2026.xlsx',
        fileBase64: neutralBase64,
        sharedSubjectDecisions: linkedDecisions,
      },
    });
    const sameFileConfirm = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/import',
      token: adminToken,
      reauth: reauthToken,
      body: {
        facultyId: facId,
        targetMode: 'existing_draft_plan',
        planId: importedPlanId,
        fileName: 'ingenieria-ficticia-2026.xlsx',
        fileBase64: neutralBase64,
        sharedSubjectDecisions: linkedDecisions,
        previewHash: sameFilePreview.data?.data?.previewHash,
      },
    });
    const sameAfter = countStateForPlan(importedPlanId);
    assert(
      sameFilePreview.status === 200 &&
        sameFilePreview.data?.data?.draftDiff?.toCreateCodes?.length === 0 &&
        sameFilePreview.data?.data?.draftDiff?.toRemoveCodes?.length === 0 &&
        sameFileConfirm.status === 200 &&
        JSON.stringify(sameBefore) === JSON.stringify(sameAfter),
      'Re-importar exactamente el mismo archivo sobre el mismo draft no crea duplicados y preserva UUIDs/conteos'
    );

    const reuploadSheets = makeValidNeutralSheets();
    (reuploadSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS][1] as unknown[])[2] =
      'Dibujo Técnico para Ingeniería';
    reuploadSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS].pop(); // remove code 102
    reuploadSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS].push([
      103,
      'ELEC-103',
      'Optativa Ficticia Gamma',
      'Opt. Gamma',
      5,
      '2C',
      'NO',
      4,
      'electiva',
      6,
      'NO',
      'NO',
      '',
    ]);
    reuploadSheets[PLAN_TEMPLATE_SHEETS.PREREQUISITES] = [
      [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.PREREQUISITES]],
      [3, 2, 'regular'],
      [4, 1, 'aprobada'],
      [5, 3, 'regular'],
      [5, 4, 'regular'],
      [6, 5, 'regular'],
      [7, 3, 'aprobada'],
      [7, 4, 'aprobada'],
      [7, 5, 'regular'],
      [8, 5, 'aprobada'],
      [8, 6, 'regular'],
      [101, 3, 'regular'],
      [103, 6, 'regular'],
    ];
    reuploadSheets[PLAN_TEMPLATE_SHEETS.ACRONYMS] = [
      [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.ACRONYMS]],
      ['DIB', 1],
      ['TIS', 5],
      ['PPF', 7],
      ['PIF', 8],
    ];
    const reuploadBase64 = buildWorkbookBuffer(reuploadSheets).toString('base64');
    const existingCode1Id = store.subjects.find(
      (s) => s.planId === importedPlanId && s.codeInPlan === 1
    )?.id;

    const reuploadInput = {
      facultyId: facId,
      targetMode: 'existing_draft_plan' as const,
      planId: importedPlanId,
      fileName: 'ingenieria-ficticia-2026-v2.xlsx',
      fileBase64: reuploadBase64,
    };
    const reuploadPreview = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: reuploadInput,
    });
    const reuploadSugg1 = reuploadPreview.data?.data?.sharedSubjectSuggestions?.find(
      (s: any) => s.subjectCode === 1
    );
    const reuploadSugg2 = reuploadPreview.data?.data?.sharedSubjectSuggestions?.find(
      (s: any) => s.subjectCode === 2
    );
    assert(
      reuploadPreview.status === 200 &&
        JSON.stringify(reuploadPreview.data?.data?.draftDiff?.toCreateCodes) === '[103]' &&
        JSON.stringify(reuploadPreview.data?.data?.draftDiff?.toUpdateCodes) === '[1,2,3,4,5,6,7,8,101]' &&
        JSON.stringify(reuploadPreview.data?.data?.draftDiff?.toRemoveCodes) === '[102]' &&
        reuploadSugg1?.selectedDecision?.action === 'link_existing' &&
        reuploadSugg1?.selectedDecision?.sharedSubjectId === sharedDibujoId &&
        reuploadSugg1?.candidates?.some((c: any) => c.sharedSubjectId === sharedDibujoId) &&
        reuploadSugg2?.selectedDecision === null,
      'Preview sobre existing_draft_plan calcula diff exacto (crear 103, actualizar 9, quitar 102) y preselecciona vínculos cruzados guardados'
    );

    const reuploadConfirm = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/import',
      token: adminToken,
      reauth: reauthToken,
      body: { ...reuploadInput, previewHash: reuploadPreview.data.data.previewHash },
    });
    const keptCode1Sub = store.subjects.find(
      (s) => s.planId === importedPlanId && s.codeInPlan === 1
    );
    const newCode103Sub = store.subjects.find(
      (s) => s.planId === importedPlanId && s.codeInPlan === 103
    );
    const sharedDibujoAfterReupload = store.sharedSubjects.find((s) => s.id === sharedDibujoId);
    assert(
      reuploadConfirm.status === 200 &&
        keptCode1Sub?.id === existingCode1Id &&
        keptCode1Sub?.sharedSubjectId === sharedDibujoId &&
        keptCode1Sub?.name === 'Dibujo Técnico para Ingeniería' &&
        sharedDibujoAfterReupload?.displayName === 'Dibujo Técnico' &&
        Boolean(newCode103Sub) &&
        !store.subjects.some((s) => s.planId === importedPlanId && s.codeInPlan === 102),
      'Re-importación idempotente preserva UUIDs y shared link sin mutar shared_subjects compartido con otros planes'
    );

    // No se puede re-importar sobre un plan published
    const reimportPublished = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: {
        facultyId: facId,
        targetMode: 'existing_draft_plan',
        planId: existingPlanId,
        fileName: 'x.xlsx',
        fileBase64: reuploadBase64,
      },
    });
    assert(
      reimportPublished.status === 409 && reimportPublished.data?.code === 'PLAN_NOT_DRAFT',
      'Bloquea con 409 PLAN_NOT_DRAFT cualquier intento de re-importar sobre un plan published'
    );

    // No se puede re-importar sobre un plan archived
    const reimportArchived = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: {
        facultyId: facId,
        targetMode: 'existing_draft_plan',
        planId: archivedPlanId,
        fileName: 'x.xlsx',
        fileBase64: reuploadBase64,
      },
    });
    assert(
      reimportArchived.status === 409 && reimportArchived.data?.code === 'PLAN_NOT_DRAFT',
      'Bloquea con 409 PLAN_NOT_DRAFT cualquier intento de re-importar sobre un plan archived'
    );

    // Referencia en Biblioteca impide quitar materia (y eliminar el plan borrador) sin tocar R2
    const spyR2DeleteCalls: string[] = [];
    const {
      InMemoryLibraryService,
      setLibraryServiceForTesting,
    } = await import('../src/modules/library/library.service.js');
    const spyR2 = {
      deleteObject: async (key: string) => {
        spyR2DeleteCalls.push(key);
        return true;
      },
      getPresignedUploadUrl: async () => 'https://example.invalid',
      getPresignedDownloadUrl: async () => 'https://example.invalid',
      headObject: async () => ({ exists: true, contentLength: 1 }),
      getObjectStream: async () => null as any,
    };
    setLibraryServiceForTesting(new InMemoryLibraryService(spyR2 as any));

    store.libraryFileRefs.push(
      { subjectId: newCode103Sub!.id, sourcePlanId: importedPlanId },
      { subjectId: newCode103Sub!.id, sourceSubjectId: newCode103Sub!.id, sourcePlanId: importedPlanId }
    );

    const blockedRemovalPreview = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: {
        facultyId: facId,
        targetMode: 'existing_draft_plan',
        planId: importedPlanId,
        fileName: 'ingenieria-ficticia-sin-103.xlsx',
        fileBase64: neutralBase64,
        sharedSubjectDecisions: linkedDecisions,
      },
    });
    const blockedRemovalConfirm = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/import',
      token: adminToken,
      reauth: reauthToken,
      body: {
        facultyId: facId,
        targetMode: 'existing_draft_plan',
        planId: importedPlanId,
        fileName: 'ingenieria-ficticia-sin-103.xlsx',
        fileBase64: neutralBase64,
        sharedSubjectDecisions: linkedDecisions,
        previewHash: blockedRemovalPreview.data?.data?.previewHash,
      },
    });
    assert(
      blockedRemovalPreview.status === 200 &&
        JSON.stringify(blockedRemovalPreview.data?.data?.draftDiff?.blockedRemovalCodes) === '[103]' &&
        (blockedRemovalPreview.data?.data?.errors || []).some(
          (e: any) => typeof e.message === 'string' && e.message.includes('2 archivo(s) de Biblioteca')
        ) &&
        blockedRemovalConfirm.status === 409 &&
        blockedRemovalConfirm.data?.code === 'DRAFT_SUBJECT_REMOVAL_BLOCKED' &&
        blockedRemovalConfirm.data?.details?.libraryFilesCount === 2 &&
        String(blockedRemovalConfirm.data?.error || '').includes('2 archivo(s) de Biblioteca') &&
        spyR2DeleteCalls.length === 0,
      'Bloquea quitar una materia del draft (409 DRAFT_SUBJECT_REMOVAL_BLOCKED) con conteo exacto de Biblioteca y 0 llamadas a R2'
    );

    const blockDeleteRes = await apiRequest({
      method: 'DELETE',
      path: `/api/admin/plans/${importedPlanId}`,
      token: adminToken,
      reauth: reauthToken,
    });
    assert(
      blockDeleteRes.status === 409 &&
        blockDeleteRes.data?.code === 'PLAN_DELETE_HAS_REFERENCES' &&
        blockDeleteRes.data?.details?.libraryFilesCount === 2 &&
        String(blockDeleteRes.data?.error || '').includes('2 archivo(s) de Biblioteca') &&
        spyR2DeleteCalls.length === 0,
      'DELETE /api/admin/plans/:id bloquea con 409 PLAN_DELETE_HAS_REFERENCES indicando cantidad exacta de Biblioteca y 0 llamadas a R2'
    );
    setLibraryServiceForTesting(null);

    const blockPublishedDelete = await apiRequest({
      method: 'DELETE',
      path: `/api/admin/plans/${existingPlanId}`,
      token: adminToken,
      reauth: reauthToken,
    });
    assert(
      blockPublishedDelete.status === 409 &&
        blockPublishedDelete.data?.code === 'ONLY_DRAFT_PLAN_DELETABLE',
      'DELETE /api/admin/plans/:id bloquea con 409 si el plan está published'
    );

    // Quitar referencia -> DELETE draft exitoso, preservando sharedDibujoId compartido con ISI 2023 y borrando carrera 'draft' vacía
    const importedCareerId = importRes.data?.data?.careerId as string;
    store.libraryFileRefs.length = 0;
    const sharedBeforeDeleteCount = store.sharedSubjects.length;
    const deleteDraftRes = await apiRequest({
      method: 'DELETE',
      path: `/api/admin/plans/${importedPlanId}`,
      token: adminToken,
      reauth: reauthToken,
    });
    assert(
      deleteDraftRes.status === 200 &&
        deleteDraftRes.data?.data?.deletedCareer === true &&
        deleteDraftRes.data?.data?.deletedCareerId === importedCareerId &&
        !store.plans.some((p) => p.id === importedPlanId) &&
        !store.careers.some((c) => c.id === importedCareerId) &&
        !store.subjects.some((s) => s.planId === importedPlanId) &&
        store.sharedSubjects.some((sh) => sh.id === sharedDibujoId) &&
        store.sharedSubjects.length < sharedBeforeDeleteCount,
      'DELETE /api/admin/plans/:id elimina draft sin referencias, limpia shared huérfanas, preserva shared compartidas y elimina la carrera draft vacía'
    );

    // El código de carrera queda libre para volver a importarse tras eliminar su único plan draft
    const reuseCareerCodePreview = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken2,
      body: previewInput,
    });
    assert(
      reuseCareerCodePreview.status === 200 && reuseCareerCodePreview.data?.data?.valid === true,
      'Tras eliminar el último plan de una carrera draft, su código queda disponible sin 409 CAREER_CODE_ALREADY_EXISTS'
    );

    // Carrera 'draft' con DOS planes: borrar el primero NO borra la carrera; borrar el segundo (último) SÍ la borra
    const twoPlansSheets = makeValidNeutralSheets();
    twoPlansSheets[PLAN_TEMPLATE_SHEETS.PLAN][1][0] = 'Plan Ingeniería Química 2026';
    twoPlansSheets[PLAN_TEMPLATE_SHEETS.PLAN][1][1] = 2026;
    const plan1Buf = buildWorkbookBuffer(twoPlansSheets).toString('base64');
    const prevPlan1 = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken2,
      body: {
        facultyId: facId,
        targetMode: 'new_career_and_plan',
        careerName: 'Ingeniería Química',
        careerCode: 'IQUI',
        fileName: 'iquim-2026.xlsx',
        fileBase64: plan1Buf,
      },
    });
    const impPlan1 = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/import',
      token: adminToken2,
      reauth: reauthToken2,
      body: {
        facultyId: facId,
        targetMode: 'new_career_and_plan',
        careerName: 'Ingeniería Química',
        careerCode: 'IQUI',
        fileName: 'iquim-2026.xlsx',
        fileBase64: plan1Buf,
        previewHash: prevPlan1.data.data.previewHash,
      },
    });
    const twoPlanCareerId = impPlan1.data?.data?.careerId as string;
    const twoPlanFirstId = impPlan1.data?.data?.planId as string;

    const twoPlansSheets2 = makeValidNeutralSheets();
    twoPlansSheets2[PLAN_TEMPLATE_SHEETS.PLAN][1][0] = 'Plan Ingeniería Química 2027';
    twoPlansSheets2[PLAN_TEMPLATE_SHEETS.PLAN][1][1] = 2027;
    const plan2Buf = buildWorkbookBuffer(twoPlansSheets2).toString('base64');
    const prevPlan2 = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken2,
      body: {
        facultyId: facId,
        targetMode: 'existing_career_new_plan',
        careerId: twoPlanCareerId,
        fileName: 'iquim-2027.xlsx',
        fileBase64: plan2Buf,
      },
    });
    const impPlan2 = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/import',
      token: adminToken2,
      reauth: reauthToken2,
      body: {
        facultyId: facId,
        targetMode: 'existing_career_new_plan',
        careerId: twoPlanCareerId,
        fileName: 'iquim-2027.xlsx',
        fileBase64: plan2Buf,
        previewHash: prevPlan2.data.data.previewHash,
      },
    });
    const twoPlanSecondId = impPlan2.data?.data?.planId as string;

    const delFirstOfTwoRes = await apiRequest({
      method: 'DELETE',
      path: `/api/admin/plans/${twoPlanFirstId}`,
      token: adminToken2,
      reauth: reauthToken2,
    });
    assert(
      delFirstOfTwoRes.status === 200 &&
        delFirstOfTwoRes.data?.data?.deletedCareer === false &&
        delFirstOfTwoRes.data?.data?.deletedCareerId === null &&
        store.careers.some((c) => c.id === twoPlanCareerId) &&
        store.plans.some((p) => p.id === twoPlanSecondId),
      'Carrera draft con 2 planes: al borrar el primero NO se borra la carrera porque conserva el segundo plan'
    );

    const delSecondOfTwoRes = await apiRequest({
      method: 'DELETE',
      path: `/api/admin/plans/${twoPlanSecondId}`,
      token: adminToken2,
      reauth: reauthToken2,
    });
    assert(
      delSecondOfTwoRes.status === 200 &&
        delSecondOfTwoRes.data?.data?.deletedCareer === true &&
        delSecondOfTwoRes.data?.data?.deletedCareerId === twoPlanCareerId &&
        !store.careers.some((c) => c.id === twoPlanCareerId),
      'Carrera draft con 2 planes: al borrar el último plan SÍ se borra también la carrera'
    );

    // Carrera 'published' cuyo único plan (draft) se elimina: el plan se borra pero la carrera published NO se toca
    const pubCareerWithOnlyDraftId = '99999999-9999-4999-8999-999999999901';
    const draftUnderPubCareerId = '99999999-9999-4999-8999-999999999902';
    store.careers.push({
      id: pubCareerWithOnlyDraftId,
      facultyId: facId,
      name: 'Ingeniería Publicada Protegida',
      code: 'IPUB',
      status: 'published',
    });
    store.plans.push({
      id: draftUnderPubCareerId,
      careerId: pubCareerWithOnlyDraftId,
      name: 'Borrador Sobre Publicada',
      year: 2028,
      status: 'draft',
      isActive: true,
      config: { requiredElectiveCredits: 0, defaultMinPassingGrade: 4 },
    });
    const delDraftUnderPubRes = await apiRequest({
      method: 'DELETE',
      path: `/api/admin/plans/${draftUnderPubCareerId}`,
      token: adminToken2,
      reauth: reauthToken2,
    });
    assert(
      delDraftUnderPubRes.status === 200 &&
        delDraftUnderPubRes.data?.data?.deletedCareer === false &&
        delDraftUnderPubRes.data?.data?.deletedCareerId === null &&
        !store.plans.some((p) => p.id === draftUnderPubCareerId) &&
        store.careers.some((c) => c.id === pubCareerWithOnlyDraftId && c.status === 'published'),
      'Carrera published sin otros planes NO se borra aunque se elimine su último plan draft'
    );
    store.careers = store.careers.filter((c) => c.id !== pubCareerWithOnlyDraftId);

    console.log('\n📌 10. Rollback Transaccional y Concurrencia HTTP = 1 (409)');
    const rollbackPreview = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: {
        facultyId: facId,
        targetMode: 'new_career_and_plan',
        careerName: 'Ingeniería Civil',
        careerCode: 'ICIV',
        fileName: 'civil.xlsx',
        fileBase64: neutralBase64,
      },
    });
    const plansCountBeforeRollback = store.plans.length;
    const careersCountBeforeRollback = store.careers.length;
    const subjectsCountBeforeRollback = store.subjects.length;
    const auditCountBeforeRollback = store.auditLogs.length;

    store.shouldThrowOnOperation = 'replacePlanSpecialRules';
    const failedImportRes = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/import',
      token: adminToken,
      reauth: reauthToken,
      body: {
        facultyId: facId,
        targetMode: 'new_career_and_plan',
        careerName: 'Ingeniería Civil',
        careerCode: 'ICIV',
        fileName: 'civil.xlsx',
        fileBase64: neutralBase64,
        previewHash: rollbackPreview.data.data.previewHash,
      },
    });
    store.shouldThrowOnOperation = undefined;

    assert(
      failedImportRes.status === 500 &&
        store.plans.length === plansCountBeforeRollback &&
        store.careers.length === careersCountBeforeRollback &&
        store.subjects.length === subjectsCountBeforeRollback &&
        store.auditLogs.length === auditCountBeforeRollback,
      'Fallo a mitad de transacción hace rollback atómico completo sin dejar carreras/planes/materias huérfanas'
    );

    // Concurrencia HTTP = 1 -> 409 PLAN_IMPORT_IN_PROGRESS
    const concurrentPreviewInput = {
      ...previewInput,
      careerName: 'Ingeniería Industrial',
      careerCode: 'IND',
      fileName: 'industrial.xlsx',
    };
    const lockHolderPromise = previewPlanImport(concurrentPreviewInput, {
      artificialWorkerDelayMs: 220,
    });
    await new Promise((r) => setTimeout(r, 25));
    const concurrentHttpRes = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: concurrentPreviewInput,
    });
    await lockHolderPromise;
    assert(
      concurrentHttpRes.status === 409 &&
        concurrentHttpRes.data?.code === 'PLAN_IMPORT_IN_PROGRESS' &&
        !isPlanImportLocked(),
      'Concurrencia HTTP simultánea en /api/admin/plans/preview responde 409 PLAN_IMPORT_IN_PROGRESS y libera lock'
    );

    // g) Normalización romano-arábiga y sugerencias "similar" de baja confianza sin auto-vincular
    assert(
      normalizeSharedSubjectName('Análisis Matemático I') === 'analisis matematico 1' &&
        normalizeSharedSubjectName('Análisis Matemático 1') === 'analisis matematico 1' &&
        classifySharedSubjectMatch('Análisis Matemático 1', 'Análisis Matemático I')?.matchType ===
          'exact' &&
        classifySharedSubjectMatch('Análisis Matemático 1', 'Análisis Matemático I')
          ?.confidence === 'high' &&
        classifySharedSubjectMatch('Probabilidad y Estadísticas', 'Probabilidad y Estadística')
          ?.matchType === 'similar' &&
        classifySharedSubjectMatch('Probabilidad y Estadísticas', 'Probabilidad y Estadística')
          ?.confidence === 'low' &&
        classifySharedSubjectMatch('Física 2', 'Física 1') === null &&
        classifySharedSubjectMatch('Física II', 'Física I') === null,
      'classifySharedSubjectMatch distingue romano-arábigo (exact/high), plurales (similar/low) y no mezcla niveles (Física 1 vs 2)'
    );

    store.sharedSubjects.push(
      {
        id: '77777777-7777-4777-8777-777777777701',
        facultyId: facId,
        stableCode: 'FRC-AM1-01',
        displayName: 'Análisis Matemático I',
        normalizedName: 'analisis matematico i', // formato legado sin convertir romano -> debe matchear igual
      },
      {
        id: '77777777-7777-4777-8777-777777777702',
        facultyId: facId,
        stableCode: 'FRC-PYE-01',
        displayName: 'Probabilidad y Estadística',
        normalizedName: 'probabilidad y estadistica',
      },
      {
        id: '77777777-7777-4777-8777-777777777703',
        facultyId: facId,
        stableCode: 'FRC-FIS1-01',
        displayName: 'Física 1',
        normalizedName: 'fisica 1',
      }
    );

    const similaritySheets: Record<string, unknown[][]> = {
      [PLAN_TEMPLATE_SHEETS.PLAN]: [
        [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.PLAN]],
        ['Plan Prueba Matching 2026', 2026, 'Año', 1, 0, 0, 6, 'Graduado/a', 'MATCH · 2026'],
      ],
      [PLAN_TEMPLATE_SHEETS.SUBJECTS]: [
        [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.SUBJECTS]],
        [1, 'MAT-1', 'Análisis Matemático 1', 'AM 1', 1, 'A', 'NO', 5, 'obligatoria', '', 'NO', 'NO', ''],
        [2, 'MAT-2', 'Probabilidad y Estadísticas', 'Prob. y Est.', 1, '1C', 'NO', 4, 'obligatoria', '', 'NO', 'NO', ''],
        [3, 'MAT-3', 'Física 2', 'Física 2', 1, '2C', 'NO', 5, 'obligatoria', '', 'NO', 'NO', ''],
      ],
      [PLAN_TEMPLATE_SHEETS.PREREQUISITES]: [
        [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.PREREQUISITES]],
      ],
      [PLAN_TEMPLATE_SHEETS.RULES]: [
        [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES]],
      ],
      [PLAN_TEMPLATE_SHEETS.ACRONYMS]: [
        [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.ACRONYMS]],
      ],
    };

    const similarityPreview = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: {
        facultyId: facId,
        targetMode: 'new_career_and_plan',
        careerName: 'Licenciatura Ficticia en Matemática',
        careerCode: 'LFMA',
        fileName: 'matching.xlsx',
        fileBase64: buildWorkbookBuffer(similaritySheets).toString('base64'),
      },
    });

    const simSuggestions = similarityPreview.data?.data?.sharedSubjectSuggestions || [];
    const amSugg = simSuggestions.find((s: any) => s.subjectCode === 1);
    const pyeSugg = simSuggestions.find((s: any) => s.subjectCode === 2);
    const fisSugg = simSuggestions.find((s: any) => s.subjectCode === 3);

    assert(
      similarityPreview.status === 200 &&
        amSugg?.candidates?.length === 1 &&
        amSugg.candidates[0].displayName === 'Análisis Matemático I' &&
        amSugg.candidates[0].matchType === 'exact' &&
        amSugg.candidates[0].confidence === 'high' &&
        amSugg.selectedDecision === null &&
        pyeSugg?.candidates?.length === 1 &&
        pyeSugg.candidates[0].displayName === 'Probabilidad y Estadística' &&
        pyeSugg.candidates[0].matchType === 'similar' &&
        pyeSugg.candidates[0].confidence === 'low' &&
        pyeSugg.selectedDecision === null &&
        fisSugg?.candidates?.length === 0 &&
        fisSugg.selectedDecision === null,
      'Preview sugiere "Análisis Matemático I" como exact/high, "Probabilidad y Estadística" como similar/low, no sugiere "Física 1" para "Física 2" y nunca auto-vincula',
      JSON.stringify({
        status: similarityPreview.status,
        errors: similarityPreview.data?.data?.errors,
        suggestions: simSuggestions,
      })
    );

    console.log('\n📌 11. Paso 2 Reducido: Validación de título intermedio estilo Industrial y rechazos sin criterios');
    const makeIndustrialImportSheets = (): Record<string, unknown[][]> => {
      const coreRows1to25: unknown[][] = Array.from({ length: 25 }, (_, i) => {
        const code = i + 1;
        const level = code <= 8 ? 1 : code <= 17 ? 2 : 3;
        return [
          code,
          `IND-${code}`,
          `Materia Troncal Industrial ${code}`,
          `Ind ${code}`,
          level,
          '1C',
          'NO',
          4,
          'obligatoria',
          '',
          'NO',
          'NO',
          '',
        ];
      });
      return {
        [PLAN_TEMPLATE_SHEETS.PLAN]: [
          [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.PLAN]],
          [
            'Ingeniería Industrial Mock 2026',
            2026,
            'Año',
            5,
            4,
            1,
            6,
            'Ingeniero/a Industrial',
            'IND · Mock 2026',
            27,
            'Habilitación PPS',
            'Requiere Inv. Operativa regularizada',
            'Técnico Universitario en Gestión Industrial',
            'Técnico',
            'Téc. Gestión Ind.',
            'tecnico',
            0,
            26,
          ],
        ],
        [PLAN_TEMPLATE_SHEETS.SUBJECTS]: [
          [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.SUBJECTS]],
          ...coreRows1to25,
          [26, 'IND-26', 'Gestión Industrial', 'Gest. Ind.', 4, 'A', 'NO', 6, 'obligatoria', '', 'NO', 'SI', 'tecnico'],
          [27, 'IND-27', 'Investigación Operativa', 'Inv. Op.', 4, '1C', 'NO', 5, 'obligatoria', '', 'NO', 'NO', ''],
          [28, 'IND-28', 'Proyecto Final Industrial', 'Proy. Final', 5, 'A', 'NO', 8, 'obligatoria', '', 'SI', 'NO', ''],
          [101, 'IND-E1', 'Logística Aplicada', 'Logística', 5, '2C', 'NO', 4, 'electiva', 4, 'NO', 'NO', ''],
        ],
        [PLAN_TEMPLATE_SHEETS.PREREQUISITES]: [
          [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.PREREQUISITES]],
          [26, 25, 'aprobada'],
          [27, 25, 'regular'],
          [28, 27, 'regular'],
          [28, 25, 'aprobada'],
        ],
        [PLAN_TEMPLATE_SHEETS.RULES]: [
          [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES]],
          [26, 'approved_range', 1, 25, '', 'Todas las obligatorias de 1° a 3° año aprobadas'],
        ],
        [PLAN_TEMPLATE_SHEETS.ACRONYMS]: [
          [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.ACRONYMS]],
          ['GI', 26],
          ['PF', 28],
        ],
      };
    };

    const industrialImportParsed = await parsePlanWorkbookBuffer({
      fileName: 'industrial-mock.xlsx',
      buffer: buildWorkbookBuffer(makeIndustrialImportSheets()),
    });
    assert(
      industrialImportParsed.valid &&
        industrialImportParsed.errors.length === 0 &&
        industrialImportParsed.data?.plan.intermediateDegrees.length === 1 &&
        industrialImportParsed.data.plan.intermediateDegrees[0].specialRuleSubjectCode === 26 &&
        (industrialImportParsed.data.plan.intermediateDegrees[0].requiredElectiveCredits ?? 0) === 0,
      'Importador acepta plan estilo Industrial (hito nivel 4 opcional + approved_range 1..25 + 0 créditos electivas + Proyecto Final sin regla especial)',
      JSON.stringify(industrialImportParsed.errors)
    );

    const noCriteriaSheets = makeIndustrialImportSheets();
    noCriteriaSheets[PLAN_TEMPLATE_SHEETS.PLAN][1][17] = '';
    noCriteriaSheets[PLAN_TEMPLATE_SHEETS.RULES] = [[...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES]]];
    const noCriteriaParsed = await parsePlanWorkbookBuffer({
      fileName: 'intermedio-sin-criterios.xlsx',
      buffer: buildWorkbookBuffer(noCriteriaSheets),
    });
    assert(
      !noCriteriaParsed.valid &&
        noCriteriaParsed.errors.some((e) => e.message.includes('al menos un criterio evaluable')),
      'Importador rechaza título intermedio sin ningún criterio evaluable'
    );

    const missingMilestoneSheets = makeIndustrialImportSheets();
    missingMilestoneSheets[PLAN_TEMPLATE_SHEETS.PLAN][1][17] = 999;
    const missingMilestoneParsed = await parsePlanWorkbookBuffer({
      fileName: 'intermedio-hito-inexistente.xlsx',
      buffer: buildWorkbookBuffer(missingMilestoneSheets),
    });
    assert(
      !missingMilestoneParsed.valid &&
        missingMilestoneParsed.errors.some((e) => e.message.includes('no existe en la hoja "Materias"')),
      'Importador rechaza materia hito del título intermedio inexistente en Materias'
    );

    const nonOptionalMilestoneSheets = makeIndustrialImportSheets();
    const row26Idx = nonOptionalMilestoneSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS].findIndex((r) => r[0] === 26);
    nonOptionalMilestoneSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS][row26Idx][11] = 'NO';
    nonOptionalMilestoneSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS][row26Idx][12] = '';
    const nonOptionalMilestoneParsed = await parsePlanWorkbookBuffer({
      fileName: 'intermedio-hito-no-opcional.xlsx',
      buffer: buildWorkbookBuffer(nonOptionalMilestoneSheets),
    });
    assert(
      !nonOptionalMilestoneParsed.valid &&
        nonOptionalMilestoneParsed.errors.some((e) => e.message.includes('Trayecto opcional')),
      'Importador rechaza materia hito del título intermedio si Trayecto opcional != SI'
    );

    const missingRangeRuleSheets = makeIndustrialImportSheets();
    missingRangeRuleSheets[PLAN_TEMPLATE_SHEETS.RULES] = [[...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES]]];
    const missingRangeRuleParsed = await parsePlanWorkbookBuffer({
      fileName: 'intermedio-hito-sin-regla.xlsx',
      buffer: buildWorkbookBuffer(missingRangeRuleSheets),
    });
    assert(
      missingRangeRuleParsed.valid === false &&
        missingRangeRuleParsed.errors.some((e) => e.message.includes('approved_range')),
      'Importador rechaza materia hito del título intermedio sin regla approved_range en Reglas'
    );

    console.log('\n📌 12. Seguridad: Zip bomb, Worker compilado sin secretos + resourceLimits, y liberación de lock ante errores no controlados');

    const buildSyntheticZip = (
      entries: Array<{
        name: string;
        data: Buffer;
        spoofUncompressedSize?: number;
        spoofCompressedSize?: number;
      }>
    ): Buffer => {
      const localChunks: Buffer[] = [];
      const cdChunks: Buffer[] = [];
      let offset = 0;

      for (const entry of entries) {
        const nameBuf = Buffer.from(entry.name, 'utf8');
        const compressed = zlib.deflateRawSync(entry.data, { level: 9 });
        const realUncompressed = entry.data.length >>> 0;
        const cdUncompressed =
          entry.spoofUncompressedSize !== undefined
            ? entry.spoofUncompressedSize >>> 0
            : realUncompressed;
        const reportedCompressed =
          entry.spoofCompressedSize !== undefined
            ? entry.spoofCompressedSize >>> 0
            : compressed.length >>> 0;

        const lfh = Buffer.alloc(30);
        lfh.writeUInt32LE(0x04034b50, 0);
        lfh.writeUInt16LE(20, 4);
        lfh.writeUInt16LE(0, 6);
        lfh.writeUInt16LE(8, 8);
        lfh.writeUInt32LE(0, 14);
        lfh.writeUInt32LE(reportedCompressed, 18);
        lfh.writeUInt32LE(cdUncompressed, 22);
        lfh.writeUInt16LE(nameBuf.length, 26);
        lfh.writeUInt16LE(0, 28);
        localChunks.push(lfh, nameBuf, compressed);

        const cdh = Buffer.alloc(46);
        cdh.writeUInt32LE(0x02014b50, 0);
        cdh.writeUInt16LE(20, 4);
        cdh.writeUInt16LE(20, 6);
        cdh.writeUInt16LE(0, 8);
        cdh.writeUInt16LE(8, 10);
        cdh.writeUInt32LE(0, 16);
        cdh.writeUInt32LE(reportedCompressed, 20);
        cdh.writeUInt32LE(cdUncompressed, 24);
        cdh.writeUInt16LE(nameBuf.length, 28);
        cdh.writeUInt16LE(0, 30);
        cdh.writeUInt16LE(0, 32);
        cdh.writeUInt32LE(offset >>> 0, 42);
        cdChunks.push(cdh, nameBuf);

        offset += 30 + nameBuf.length + compressed.length;
      }

      const cdBuf = Buffer.concat(cdChunks);
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(entries.length, 8);
      eocd.writeUInt16LE(entries.length, 10);
      eocd.writeUInt32LE(cdBuf.length >>> 0, 12);
      eocd.writeUInt32LE(offset >>> 0, 16);
      eocd.writeUInt16LE(0, 20);
      return Buffer.concat([...localChunks, cdBuf, eocd]);
    };

    // 2(a) Zip bomb con cabecera falsa (25 MB reales comprimidos en pocos KB)
    const bombXmlPayload = Buffer.from('<row><c t="inlineStr"><is><t>Z</t></is></c></row>'.repeat(500_000));
    const spoofedZipBomb = buildSyntheticZip([
      {
        name: 'xl/worksheets/sheet1.xml',
        data: bombXmlPayload,
        spoofUncompressedSize: 128, // miente al directorio central
      },
    ]);
    assert(
      spoofedZipBomb.length < 256 * 1024,
      `Zip bomb armado en pocos KB comprimidos (${spoofedZipBomb.length} bytes)`
    );

    let directBombErr: unknown = null;
    try {
      await parsePlanWorkbookBuffer({
        fileName: 'zipbomb-spoofed.xlsx',
        buffer: spoofedZipBomb,
      });
    } catch (err) {
      directBombErr = err;
    }
    assert(
      directBombErr instanceof PlanImportUncompressedLimitError && !isPlanImportLocked(),
      'parsePlanWorkbookBuffer rechaza zip bomb con cabecera engañosa antes de SheetJS y libera el lock'
    );

    // 2(a-bis) Total acumulado REAL > 32 MB entre varias entradas (< 20 MB y ratio < 100:1 cada una) con directorio falso chico
    const incompressibleHead = Buffer.alloc(250 * 1024);
    let prng = 0x13579bdf;
    for (let i = 0; i < incompressibleHead.length; i++) {
      prng = (Math.imul(prng, 1664525) + 1013904223) >>> 0;
      incompressibleHead[i] = prng & 0xff;
    }
    const midSized18Mb = Buffer.concat([
      incompressibleHead,
      Buffer.alloc(18 * 1024 * 1024 - incompressibleHead.length, 0x41),
    ]);
    assert(
      midSized18Mb.length < 20 * 1024 * 1024 && midSized18Mb.length * 2 > 32 * 1024 * 1024,
      'Fixture multi-entrada: cada entrada < 20 MB pero suma real > 32 MB'
    );
    const accumulatedSpoofedBomb = buildSyntheticZip([
      {
        name: 'xl/worksheets/sheet1.xml',
        data: midSized18Mb,
        spoofUncompressedSize: 128,
      },
      {
        name: 'xl/worksheets/sheet2.xml',
        data: midSized18Mb,
        spoofUncompressedSize: 128,
      },
    ]);
    assert(
      accumulatedSpoofedBomb.length < 2 * 1024 * 1024,
      `Multi-entry bomb compacto (${accumulatedSpoofedBomb.length} bytes)`
    );

    let accBombErr: unknown = null;
    try {
      await parsePlanWorkbookBuffer({
        fileName: 'zipbomb-accumulated-real.xlsx',
        buffer: accumulatedSpoofedBomb,
      });
    } catch (err) {
      accBombErr = err;
    }
    assert(
      accBombErr instanceof PlanImportUncompressedLimitError && !isPlanImportLocked(),
      'Total acumulado en bytes REALES (>32 MB entre múltiples entradas con directorio falso) rechaza con 413 y libera el lock'
    );

    // 2(a-ter) Zip bomb que miente TANTO uncompressedSize (64) como compressedSize (16) en el directorio
    const doubleSpoofedBomb = buildSyntheticZip([
      {
        name: 'xl/worksheets/sheet1.xml',
        data: bombXmlPayload,
        spoofUncompressedSize: 64,
        spoofCompressedSize: 16,
      },
    ]);
    let doubleSpoofErr: unknown = null;
    try {
      await parsePlanWorkbookBuffer({
        fileName: 'zipbomb-double-spoofed.xlsx',
        buffer: doubleSpoofedBomb,
      });
    } catch (err) {
      doubleSpoofErr = err;
    }
    assert(
      doubleSpoofErr instanceof PlanImportUncompressedLimitError && !isPlanImportLocked(),
      'Rechaza zip bomb aun si el directorio falsea tanto uncompressedSize como compressedSize'
    );

    // Zip bomb por relación extrema declarada en Central Directory
    const declaredHugeZipBomb = buildSyntheticZip([
      {
        name: 'xl/worksheets/sheet1.xml',
        data: Buffer.from('A'.repeat(256)),
        spoofUncompressedSize: 120 * 1024 * 1024,
      },
    ]);
    let declaredBombErr: unknown = null;
    try {
      await parsePlanWorkbookBuffer({
        fileName: 'zipbomb-declared.xlsx',
        buffer: declaredHugeZipBomb,
      });
    } catch (err) {
      declaredBombErr = err;
    }
    assert(
      declaredBombErr instanceof PlanImportUncompressedLimitError && !isPlanImportLocked(),
      'parsePlanWorkbookBuffer rechaza zip bomb por tamaño descomprimido declarado en Central Directory'
    );

    // Zip bomb vía HTTP POST /api/admin/plans/preview responde controlado (413), deja el server vivo y libera lock
    const httpBombRes = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: {
        facultyId: facId,
        targetMode: 'new_career_and_plan',
        careerName: 'Carrera Bomb Test',
        careerCode: 'BOMB',
        fileName: 'zipbomb.xlsx',
        fileBase64: spoofedZipBomb.toString('base64'),
      },
    });
    const postBombHealthyRes = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: {
        facultyId: facId,
        targetMode: 'new_career_and_plan',
        careerName: 'Carrera Post Bomb',
        careerCode: 'CPB',
        fileName: 'valid-post-bomb.xlsx',
        fileBase64: neutralBase64,
      },
    });
    assert(
      httpBombRes.status === 413 &&
        httpBombRes.data?.code === 'PLAN_IMPORT_UNCOMPRESSED_LIMIT' &&
        !isPlanImportLocked() &&
        postBombHealthyRes.status === 200,
      'POST /api/admin/plans/preview responde 413 PLAN_IMPORT_UNCOMPRESSED_LIMIT ante zip bomb, libera lock y mantiene vivo al servidor'
    );

    // 2(b) Worker compilado (dist/): no accede a secretos de process.env y aplica resourceLimits
    const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const distParserPath = path.join(serverRoot, 'dist', 'modules', 'admin', 'planImport.parser.js');
    const distWorkerPath = path.join(serverRoot, 'dist', 'modules', 'admin', 'planImport.worker.js');
    const srcWorkerPath = path.join(serverRoot, 'src', 'modules', 'admin', 'planImport.worker.ts');
    const srcParserPath = path.join(serverRoot, 'src', 'modules', 'admin', 'planImport.parser.ts');
    const needCompile =
      !fs.existsSync(distParserPath) ||
      !fs.existsSync(distWorkerPath) ||
      fs.statSync(srcWorkerPath).mtimeMs > fs.statSync(distWorkerPath).mtimeMs ||
      fs.statSync(srcParserPath).mtimeMs > fs.statSync(distParserPath).mtimeMs;
    if (needCompile) {
      const tscBin = path.join(serverRoot, 'node_modules', 'typescript', 'bin', 'tsc');
      execFileSync(process.execPath, [tscBin, '-p', path.join(serverRoot, 'tsconfig.json')], {
        cwd: serverRoot,
        stdio: 'pipe',
      });
    }

    process.env.ADMIN_REAUTH_SECRET = process.env.ADMIN_REAUTH_SECRET || 'secret-admin-reauth-test-only';
    const compiledParser = await import(`${pathToFileURL(distParserPath).href}?t=${Date.now()}`);
    const compiledSpec = compiledParser.resolveWorkerSpec();
    const compiledLaunchOpts = compiledParser.buildWorkerLaunchOptions(compiledSpec);
    assert(
      compiledSpec.isTsRuntime === false &&
        compiledSpec.workerUrl.pathname.endsWith('/dist/modules/admin/planImport.worker.js') &&
        compiledSpec.execArgv.length === 0 &&
        JSON.stringify(compiledLaunchOpts.env) === '{}' &&
        compiledLaunchOpts.resourceLimits.maxOldGenerationSizeMb === 128 &&
        compiledLaunchOpts.resourceLimits.maxYoungGenerationSizeMb === 32,
      'Worker compilado (dist/) resuelve planImport.worker.js con env={} y resourceLimits (128 MB / 32 MB)'
    );

    const compiledValidRes = await compiledParser.parsePlanWorkbookBuffer({
      fileName: 'compiled-check.xlsx',
      buffer: validBuf,
    });
    assert(compiledValidRes.valid, 'El parser y worker compilados (dist/) parsean .xlsx válidos correctamente');

    // Demuestra en un Worker Node real con las exactas launchOpts del worker compilado que no lee secretos ni excede el heap
    const envAndLimitsObservation = await new Promise<{
      envKeys: string[];
      hasJwt: boolean;
      hasDb: boolean;
      hasRefresh: boolean;
      hasReauth: boolean;
      heapLimitMb: number;
      parentObservedLimits: any;
    }>((resolve, reject) => {
      const w = new Worker(
        `
        const { parentPort } = require('node:worker_threads');
        const v8 = require('node:v8');
        parentPort.postMessage({
          envKeys: Object.keys(process.env),
          hasJwt: process.env.JWT_SECRET !== undefined,
          hasDb: process.env.DATABASE_URL !== undefined,
          hasRefresh: process.env.REFRESH_SECRET !== undefined,
          hasReauth: process.env.ADMIN_REAUTH_SECRET !== undefined,
          heapLimitMb: Math.round(v8.getHeapStatistics().heap_size_limit / (1024 * 1024)),
        });
        `,
        {
          eval: true,
          env: compiledLaunchOpts.env,
          resourceLimits: compiledLaunchOpts.resourceLimits,
        }
      );
      const parentObservedLimits = w.resourceLimits;
      w.once('message', (data) => resolve({ ...data, parentObservedLimits }));
      w.once('error', reject);
    });

    const oomTriggered = await new Promise<boolean>((resolve) => {
      const oomWorker = new Worker(
        `
        const chunks = [];
        while (true) {
          chunks.push(new Array(512 * 1024).fill('x'));
        }
        `,
        {
          eval: true,
          env: compiledLaunchOpts.env,
          resourceLimits: compiledLaunchOpts.resourceLimits,
        }
      );
      let settled = false;
      const done = (val: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        oomWorker.terminate().catch(() => undefined);
        resolve(val);
      };
      const timer = setTimeout(() => done(false), 4000);
      oomWorker.once('error', () => done(true));
      oomWorker.once('exit', (code) => done(code !== 0));
    });

    assert(
      envAndLimitsObservation.envKeys.length === 0 &&
        !envAndLimitsObservation.hasJwt &&
        !envAndLimitsObservation.hasDb &&
        !envAndLimitsObservation.hasRefresh &&
        !envAndLimitsObservation.hasReauth &&
        envAndLimitsObservation.parentObservedLimits?.maxOldGenerationSizeMb === 128 &&
        envAndLimitsObservation.parentObservedLimits?.maxYoungGenerationSizeMb === 32 &&
        envAndLimitsObservation.heapLimitMb <= 220 &&
        oomTriggered,
      `Worker aislado con opciones de dist/ no accede a secretos (envKeys=${envAndLimitsObservation.envKeys.length}), aplica resourceLimits (${envAndLimitsObservation.parentObservedLimits?.maxOldGenerationSizeMb}MB old, heap=${envAndLimitsObservation.heapLimitMb}MB) y aborta OOM controlado`
    );

    // 2(c) Liberación de lock ante errores no controlados (directo y HTTP 500)
    let unhandledCaught: unknown = null;
    try {
      await withPlanImportLock(async () => {
        throw new TypeError('Error inesperado no controlado dentro del lock');
      });
    } catch (err) {
      unhandledCaught = err;
    }
    assert(
      unhandledCaught instanceof TypeError && !isPlanImportLocked(),
      'withPlanImportLock libera el lock en finally ante un error sincrónico/asíncrono no controlado'
    );

    store.shouldThrowOnOperation = 'findSharedSubjectSuggestions';
    const unhandledHttpPreviewRes = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: {
        facultyId: facId,
        targetMode: 'new_career_and_plan',
        careerName: 'Carrera Error No Controlado',
        careerCode: 'ERRC',
        fileName: 'err.xlsx',
        fileBase64: neutralBase64,
      },
    });
    store.shouldThrowOnOperation = undefined;
    const recoveryPreviewRes = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: {
        facultyId: facId,
        targetMode: 'new_career_and_plan',
        careerName: 'Carrera Recuperada',
        careerCode: 'REC',
        fileName: 'recovered.xlsx',
        fileBase64: neutralBase64,
      },
    });
    assert(
      unhandledHttpPreviewRes.status === 500 &&
        !isPlanImportLocked() &&
        recoveryPreviewRes.status === 200,
      'Fallo inesperado (500) dentro de POST /api/admin/plans/preview libera el lock y permite importar nuevamente sin 409'
    );
  } finally {
    setPlanImportStoreForTesting(null);
    setLiveUserResolverForTesting(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(` 📊 RESULTADO TESTS PLAN IMPORT WORKER + API: ${passed} pasaron, ${failed} fallaron`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('❌ Error fatal en planImport.test.ts:', err);
  process.exit(1);
});
