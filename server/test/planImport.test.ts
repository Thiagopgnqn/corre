import * as xlsxModule from 'xlsx';
import {
  PLAN_IMPORT_MAX_BYTES,
  PLAN_TEMPLATE_HEADERS,
  PLAN_TEMPLATE_SHEETS,
  SUPPORTED_SPECIAL_RULE_TYPES,
  isSupportedSpecialRuleType,
} from '../src/modules/admin/planImport.rules.js';
import { buildPlanImportTemplateBuffer } from '../src/modules/admin/planImport.template.js';
import {
  PlanImportConcurrencyError,
  PlanImportTimeoutError,
  isPlanImportLocked,
  parsePlanWorkbookBuffer,
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
        'Plan Arquitectura 2026',
        2026,
        'Cuatrimestre',
        '', // omit Total niveles to verify max(level) derivation
        0,
        0,
        6,
        'Arquitecto/a',
        'ARQ · Plan 2026',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ],
    ],
    [PLAN_TEMPLATE_SHEETS.SUBJECTS]: [
      [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.SUBJECTS]],
      [1, 'ARQ-1', 'Dibujo Técnico', 'Dibujo Téc.', 1, '1C', 'NO', 6, 'obligatoria', '', 'NO', 'NO', ''],
      [2, 'ARQ-2', 'Estructuras I', 'Estruct. I', 2, '2C', 'NO', 6, 'obligatoria', '', 'NO', 'NO', ''],
      [3, 'ARQ-3', 'Proyecto Urbano Final', 'Proy. Final', 3, 'A', 'NO', 8, 'obligatoria', '', 'SI', 'NO', ''],
    ],
    [PLAN_TEMPLATE_SHEETS.PREREQUISITES]: [
      [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.PREREQUISITES]],
      [2, 1, 'regular'],
      [3, 2, 'aprobada'],
    ],
    [PLAN_TEMPLATE_SHEETS.RULES]: [
      [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES]],
      [3, 'approved_range', '{"fromCode":1,"toCode":2}', 'Aprobadas 1 a 2 requeridas.'],
    ],
    [PLAN_TEMPLATE_SHEETS.ACRONYMS]: [
      [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.ACRONYMS]],
      ['DT', 1],
      ['PUF', 3],
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

  const parsedTemplate = await parsePlanWorkbookBuffer({
    fileName: 'plantilla-plan.xlsx',
    buffer: templateBuffer,
  });
  assert(
    parsedTemplate.valid === true &&
      parsedTemplate.errors.length === 0 &&
      parsedTemplate.data?.plan.name === 'Plan Modelo 2026' &&
      parsedTemplate.data?.subjects.length === 5 &&
      parsedTemplate.data?.prerequisites.length === 5 &&
      parsedTemplate.data?.specialRules.length === 1 &&
      parsedTemplate.data?.acronyms.length === 3,
    'La plantilla descargable se valida y parsea limpia sin errores en modo ida y vuelta'
  );

  // 2. Neutral 3-level plan without Total niveles / without electives / custom displayCode
  console.log('\n📌 2. Parseo neutro (3 cuatrimestres, displayCode explícito, reglas soportadas)');
  const validBuf = buildWorkbookBuffer(makeValidNeutralSheets());
  const validRes = await parsePlanWorkbookBuffer({ fileName: 'arq2026.xlsx', buffer: validBuf });
  assert(
    validRes.valid === true &&
      validRes.data?.plan.totalLevels === 3 &&
      validRes.data?.plan.defaultMinPassingGrade === 6 &&
      validRes.data?.subjects[0].displayCode === 'ARQ-1' &&
      validRes.data?.specialRules[0].ruleType === 'approved_range',
    'Deriva totalLevels desde Materias y conserva displayCode explícito sin prefijos automáticos'
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
  for (let r = 10; r <= 2020; r++) {
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

  // Directed cycle detection (1 -> 2 -> 3 -> 1)
  const cycleSheets = makeValidNeutralSheets();
  cycleSheets[PLAN_TEMPLATE_SHEETS.PREREQUISITES].push([1, 3, 'regular']);
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
    [3, 'min_credits', '{"minCredits":10}', 'No soportado'],
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

  // Reject invalid approved_range (fromCode > toCode)
  const badRangeSheets = makeValidNeutralSheets();
  badRangeSheets[PLAN_TEMPLATE_SHEETS.RULES] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES]],
    [3, 'approved_range', '{"fromCode":2,"toCode":1}', 'Rango invertido'],
  ];
  const badRangeRes = await parsePlanWorkbookBuffer({
    fileName: 'badrange.xlsx',
    buffer: buildWorkbookBuffer(badRangeSheets),
  });
  assert(!badRangeRes.valid && badRangeRes.errors.some((e) => e.message.includes('mayor a toCode')), 'Valida rango inválido en approved_range');

  // Prototype pollution attempt in JSON params
  const protoSheets = makeValidNeutralSheets();
  protoSheets[PLAN_TEMPLATE_SHEETS.RULES] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES]],
    [3, 'approved_range', '{"fromCode":1,"toCode":2,"__proto__":{"polluted":true}}', 'Prototipo'],
  ];
  const protoRes = await parsePlanWorkbookBuffer({
    fileName: 'proto.xlsx',
    buffer: buildWorkbookBuffer(protoSheets),
  });
  assert(
    !protoRes.valid && ({} as Record<string, unknown>).polluted === undefined,
    'Bloquea claves peligrosas (__proto__) sin contaminar Object.prototype'
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

  console.log('\n======================================================================');
  console.log(` 📊 RESULTADO TESTS PLAN IMPORT WORKER: ${passed} pasaron, ${failed} fallaron`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('❌ Error fatal en planImport.test.ts:', err);
  process.exit(1);
});
