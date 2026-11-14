process.env.NODE_ENV = 'test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test_jwt_secret_super_seguro_de_al_menos_32_caracteres_2026';
process.env.REFRESH_SECRET =
  process.env.REFRESH_SECRET || 'test_refresh_secret_super_seguro_min_32_caracteres_2026';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://offline:offline@localhost:5432/offline_test';

import http from 'http';
import jwt from 'jsonwebtoken';
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
  store.plans.push({
    id: existingPlanId,
    careerId: existingCareerId,
    name: 'Plan 2023',
    year: 2023,
    isActive: true,
    status: 'published',
    config: { careerCode: 'ISI' },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
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
      careerName: 'Arquitectura',
      careerCode: 'ARQ',
      fileName: 'arquitectura-2026.xlsx',
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
    const previewRes = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: previewInput,
    });
    const previewData = previewRes.data?.data;
    const sugg1 = previewData?.sharedSubjectSuggestions?.find((s: any) => s.subjectCode === 1);
    const sugg2 = previewData?.sharedSubjectSuggestions?.find((s: any) => s.subjectCode === 2);
    const previewSubjects = previewData?.normalizedPlan?.subjects || [];

    assert(
      previewRes.status === 200 &&
        previewData?.valid === true &&
        typeof previewData?.previewHash === 'string' &&
        previewData.previewHash.length === 64,
      'POST /api/admin/plans/preview valida plan ficticio de 3 niveles y emite previewHash SHA-256'
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
          s.code.startsWith('ARQ-') &&
          !s.code.startsWith('E-') &&
          !s.code.startsWith('X-')
      ),
      'El preview neutro preserva code propio (ARQ-*) sin inyectar prefijos E-/X- de ISI'
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
        importRes.data?.data?.counts?.createdNewShared === 2 &&
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
        listedDraft?.subjectCount === 3 &&
        listedDraft?.rulesCount === 1 &&
        listedDraft?.acronymsCount === 2 &&
        listedDraft?.sharedSubjectsCount === 3 &&
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
        detailRes.data?.data?.career?.code === 'ARQ' &&
        dibujoBinding?.linkedPlansCount === 2,
      'GET /api/admin/plans/:id entrega detalle normalizado incluso en estado draft'
    );

    console.log('\n📌 9. Re-importación Idempotente en Draft, Bloqueos de Borrado y Eliminación Segura');
    const reuploadSheets = makeValidNeutralSheets();
    (reuploadSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS][1] as unknown[])[2] =
      'Dibujo Técnico Arquitectónico';
    reuploadSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS].pop(); // remove code 3
    reuploadSheets[PLAN_TEMPLATE_SHEETS.SUBJECTS].push([
      4,
      'ARQ-4',
      'Urbanismo Sustentable',
      'Urbanismo',
      3,
      '1C',
      'NO',
      6,
      'obligatoria',
      '',
      'SI',
      'NO',
      '',
    ]);
    reuploadSheets[PLAN_TEMPLATE_SHEETS.PREREQUISITES] = [
      [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.PREREQUISITES]],
      [2, 1, 'regular'],
      [4, 2, 'aprobada'],
    ];
    reuploadSheets[PLAN_TEMPLATE_SHEETS.RULES] = [
      [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES]],
      [4, 'approved_range', '{"fromCode":1,"toCode":2}', 'Requiere 1 y 2 aprobadas.'],
    ];
    reuploadSheets[PLAN_TEMPLATE_SHEETS.ACRONYMS] = [
      [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.ACRONYMS]],
      ['DT', 1],
      ['URB', 4],
    ];
    const reuploadBase64 = buildWorkbookBuffer(reuploadSheets).toString('base64');
    const existingCode1Id = store.subjects.find(
      (s) => s.planId === importedPlanId && s.codeInPlan === 1
    )?.id;

    const reuploadInput = {
      facultyId: facId,
      targetMode: 'existing_draft_plan' as const,
      planId: importedPlanId,
      fileName: 'arquitectura-2026-v2.xlsx',
      fileBase64: reuploadBase64,
    };
    const reuploadPreview = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: reuploadInput,
    });
    assert(
      reuploadPreview.status === 200 &&
        JSON.stringify(reuploadPreview.data?.data?.draftDiff?.toCreateCodes) === '[4]' &&
        JSON.stringify(reuploadPreview.data?.data?.draftDiff?.toUpdateCodes) === '[1,2]' &&
        JSON.stringify(reuploadPreview.data?.data?.draftDiff?.toRemoveCodes) === '[3]',
      'Preview sobre existing_draft_plan calcula diff exacto (crear 4, actualizar 1-2, quitar 3)'
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
    const newCode4Sub = store.subjects.find(
      (s) => s.planId === importedPlanId && s.codeInPlan === 4
    );
    const sharedDibujoAfterReupload = store.sharedSubjects.find((s) => s.id === sharedDibujoId);
    assert(
      reuploadConfirm.status === 200 &&
        keptCode1Sub?.id === existingCode1Id &&
        keptCode1Sub?.sharedSubjectId === sharedDibujoId &&
        keptCode1Sub?.name === 'Dibujo Técnico Arquitectónico' &&
        sharedDibujoAfterReupload?.displayName === 'Dibujo Técnico' &&
        Boolean(newCode4Sub) &&
        !store.subjects.some((s) => s.planId === importedPlanId && s.codeInPlan === 3),
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

    // Referencia en Biblioteca impide quitar materia (y eliminar el plan borrador)
    store.libraryFileRefs.push({ subjectId: newCode4Sub!.id, sourcePlanId: importedPlanId });

    const blockedRemovalPreview = await apiRequest({
      method: 'POST',
      path: '/api/admin/plans/preview',
      token: adminToken,
      body: {
        facultyId: facId,
        targetMode: 'existing_draft_plan',
        planId: importedPlanId,
        fileName: 'arquitectura-sin-4.xlsx',
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
        fileName: 'arquitectura-sin-4.xlsx',
        fileBase64: neutralBase64,
        sharedSubjectDecisions: linkedDecisions,
        previewHash: blockedRemovalPreview.data?.data?.previewHash,
      },
    });
    assert(
      blockedRemovalPreview.status === 200 &&
        JSON.stringify(blockedRemovalPreview.data?.data?.draftDiff?.blockedRemovalCodes) === '[4]' &&
        blockedRemovalConfirm.status === 409 &&
        blockedRemovalConfirm.data?.code === 'DRAFT_SUBJECT_REMOVAL_BLOCKED',
      'Bloquea quitar una materia del draft (409 DRAFT_SUBJECT_REMOVAL_BLOCKED) si tiene referencias en Biblioteca'
    );

    const blockDeleteRes = await apiRequest({
      method: 'DELETE',
      path: `/api/admin/plans/${importedPlanId}`,
      token: adminToken,
      reauth: reauthToken,
    });
    assert(
      blockDeleteRes.status === 409 && blockDeleteRes.data?.code === 'PLAN_DELETE_HAS_REFERENCES',
      'DELETE /api/admin/plans/:id bloquea con 409 cuando hay registros asociados (library_files, etc.)'
    );

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

    // Quitar referencia -> DELETE draft exitoso, preservando sharedDibujoId compartido con ISI 2023
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
        !store.plans.some((p) => p.id === importedPlanId) &&
        !store.subjects.some((s) => s.planId === importedPlanId) &&
        store.sharedSubjects.some((sh) => sh.id === sharedDibujoId) &&
        store.sharedSubjects.length < sharedBeforeDeleteCount,
      'DELETE /api/admin/plans/:id elimina draft sin referencias, limpia shared huérfanas y preserva shared compartidas'
    );

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
