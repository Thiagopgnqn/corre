import fs from 'fs';
import path from 'path';
import * as xlsxModule from 'xlsx';
import {
  parseCourseSheet,
  importAllSchedules,
  DEFAULT_GENERATED_SCHEDULE_OUTPUT,
  SEED_SCHEDULE_OUTPUT,
  formatTime,
  normalizeDay,
  areSlotsEqual,
  deduplicateSlots,
  getSlotTurno,
  calculateCommissionTurno,
  parseProfessorsCell,
  type SubjectSchedule,
  type Slot,
  type DiscardedCommissionEntry,
} from '../scripts/importSchedule';
import {
  resolveSubjectId,
  resolveSubjectIds,
  isGenericElective,
} from './fixtures/subjectAliases';
import { validateScheduleData } from '../src/utils/scheduleLogic';
import { getSubjectShortName } from '../src/components/schedule/ScheduleWeeklyGrid';
import { HISTORICAL_SUBJECT_SHORT_NAMES } from './fixtures/subjectShortNames';
import { formatPlanCatalogPayload } from '../server/src/modules/catalog/planConfig.helpers';
import type { ActivePlanCatalog, Subject } from '../src/types/career';
import { CORE_SUBJECTS } from './fixtures/plan2023';
import { ELECTIVES } from './fixtures/electives';

const XLSX = (xlsxModule as any).default || xlsxModule;

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('Running tests for Schedule Importer...');

// 1. Time normalization unit tests
assert(formatTime(0.3333333333333333) === '08:00', 'Float 0.333333 should format to 08:00');
assert(formatTime(0.3645833333333333) === '08:45', 'Float 0.364583 should format to 08:45');
assert(formatTime(0.4027777777777778) === '09:40', 'Float 0.402777 should format to 09:40');
assert(formatTime(0.5347222222222222) === '12:50', 'Float 0.534722 should format to 12:50');
assert(formatTime(0.5833333333333334) === '14:00', 'Float 0.583333 should format to 14:00');
assert(formatTime('8:00') === '08:00', 'String 8:00 should format to 08:00');
assert(formatTime('08:00') === '08:00', 'String 08:00 should format to 08:00');
assert(formatTime(' 9:30 ') === '09:30', 'String " 9:30 " with spaces should format to 09:30');
assert(formatTime('14:00') === '14:00', 'String 14:00 should format to 14:00');
console.log('✓ Time normalization tests passed');

// 2. Day header normalization unit tests
assert(normalizeDay('Lunes') === 'LUN', 'Lunes -> LUN');
assert(normalizeDay('MIERCOLES') === 'MIE', 'MIERCOLES -> MIE');
assert(normalizeDay(' Miércoles ') === 'MIE', '" Miércoles " -> MIE');
assert(normalizeDay('Miercoles') === 'MIE', 'Miercoles -> MIE');
assert(normalizeDay('JUEVES') === 'JUE', 'JUEVES -> JUE');
assert(normalizeDay(' Viernes ') === 'VIE', 'Viernes -> VIE');
assert(normalizeDay('Sábado') === 'SAB', 'Sábado -> SAB');
assert(normalizeDay('sabado') === 'SAB', 'sabado -> SAB');
assert(normalizeDay('domingo') === null, 'domingo -> null');
console.log('✓ Day header normalization tests passed');

// 3. Subject aliases unit tests
assert(resolveSubjectId('ASI') === 16, 'ASI -> 16');
assert(resolveSubjectId('Análisis de sistemas') === 16, 'Análisis de sistemas -> 16');
assert(resolveSubjectId('Análisis de Sistemas de Información') === 16, 'Análisis de Sistemas de Información -> 16');
assert(resolveSubjectId('SSL') === 13, 'SSL -> 13');
assert(resolveSubjectId('Sintaxis y Semántica de los Lenguajes') === 13, 'Sintaxis y Semántica -> 13');
assert(resolveSubjectId('PPR') === 14, 'PPR -> 14');
assert(resolveSubjectId('Paradigmas de Programación') === 14, 'Paradigmas -> 14');
assert(resolveSubjectId('Probabilidad y Estadísitica') === 17, 'Probabilidad typo -> 17');
assert(resolveSubjectId('Sistemas Operativos') === 15, 'Sistemas Operativos -> 15');
assert(resolveSubjectId('Elec Backend') === 301, 'Elec Backend -> 301');
assert(resolveSubjectId('DEC') === 507, 'DEC -> 507');
assert(resolveSubjectId('Texto Inexistente 123XYZ') === null, 'Unmapped text returns null');

// Nuevas electivas mapeadas
assert(resolveSubjectId('UIX') === 408, 'UIX -> 408');
assert(resolveSubjectId('Experiencia e interfaces de usuario (electiva)') === 408, 'UIX full name -> 408');
assert(resolveSubjectId('Habilidades blandas') === 512, 'Habilidades blandas -> 512');
assert(resolveSubjectId('HB') === 512, 'HB -> 512');
assert(resolveSubjectId('Creatividad y desarrollo de Entornos virtuales') === 513, 'Entornos virtuales -> 513');
assert(resolveSubjectId('Práctica Profesional Supervisada') === 514, 'PPS -> 514');
assert(resolveSubjectId('PPS') === 514, 'PPS -> 514');
console.log('✓ Subject aliases tests (including new electives) passed');

// 4. Compound cells (AED SPN) unit tests
const aedSpn = resolveSubjectIds('AED\nSPN');
assert(aedSpn.includes(6) && aedSpn.includes(8), 'AED\\nSPN must resolve to [6, 8]');
const aedSpnFull = resolveSubjectIds('Algoritmos y\nEstructuras de Datos\nSPN');
assert(aedSpnFull.includes(6) && aedSpnFull.includes(8), 'Full name AED SPN must resolve to [6, 8]');
console.log('✓ Compound cells tests (AED SPN) passed');

// 5. Generic electives detector unit tests
assert(isGenericElective('Elect') === true, 'Elect is generic');
assert(isGenericElective('Electiva') === true, 'Electiva is generic');
assert(isGenericElective('Electiva 1') === true, 'Electiva 1 is generic');
assert(isGenericElective('Electiva 2') === true, 'Electiva 2 is generic');
assert(isGenericElective('Electiva 1       GMP / GIP') === true, 'Electiva 1 GMP/GIP is generic');
assert(isGenericElective('Elec Backend') === false, 'Elec Backend has specific ID, not generic');
assert(isGenericElective('UIX') === false, 'UIX has specific ID 408, not generic');
console.log('✓ Generic electives detector tests passed');

// 6. Slots deduplication unit tests
const duplicatedSlots: Slot[] = [
  { day: 'MIE', start: '21:35', end: '23:05' },
  { day: 'MIE', start: '21:35', end: '23:05' },
  { day: 'VIE', start: '18:15', end: '19:45' },
  { day: 'VIE', start: '18:15', end: '19:45' },
  { day: 'VIE', start: '19:55', end: '20:40' },
];
const deduped = deduplicateSlots(duplicatedSlots);
assert(deduped.length === 3, `Expected 3 unique slots, got ${deduped.length}`);
console.log('✓ Slot deduplication unit tests passed');

// 7. Turno calculation unit tests
assert(getSlotTurno('08:00') === 'mañana', '08:00 -> mañana');
assert(getSlotTurno('12:50') === 'mañana', '12:50 -> mañana');
assert(getSlotTurno('12:51') === 'tarde', '12:51 -> tarde');
assert(getSlotTurno('14:00') === 'tarde', '14:00 -> tarde');
assert(getSlotTurno('17:19') === 'tarde', '17:19 -> tarde');
assert(getSlotTurno('17:20') === 'noche', '17:20 -> noche');
assert(getSlotTurno('21:35') === 'noche', '21:35 -> noche');

// Majority rule
const mixedSlotsTarde: Slot[] = [
  { day: 'LUN', start: '14:00', end: '15:30' },
  { day: 'MIE', start: '14:00', end: '15:30' },
  { day: 'VIE', start: '18:15', end: '19:45' },
];
assert(calculateCommissionTurno(mixedSlotsTarde) === 'tarde', '2 tarde slots + 1 noche slot -> tarde (majority)');

// Tie rule: earliest class
const tiedSlots: Slot[] = [
  { day: 'LUN', start: '08:00', end: '09:30' },
  { day: 'MIE', start: '14:00', end: '15:30' },
];
assert(calculateCommissionTurno(tiedSlots) === 'mañana', 'Tie between morning and afternoon -> mañana (earliest start)');
console.log('✓ Turno calculation by time and majority tests passed');

// 8. Discarding suspicious 1-slot commission test
const wb4 = XLSX.readFile(path.resolve('data-source/4to año.xlsx'));
const discarded: DiscardedCommissionEntry[] = [];
parseCourseSheet(wb4.Sheets['4k2'], '4k2', '4to año.xlsx', [], discarded);
parseCourseSheet(wb4.Sheets['4K4'], '4K4', '4to año.xlsx', [], discarded);
assert(
  discarded.some((d) => d.sheet === '4k2' && d.subjectId === 16),
  'Materia 16 in 4k2 must be discarded as suspicious'
);
assert(
  discarded.some((d) => d.sheet === '4K4' && d.subjectId === 16),
  'Materia 16 in 4K4 must be discarded as suspicious'
);
console.log('✓ Discarding suspicious 1-slot unbacked commissions verified (4K2 and 4K4)');

// 9. Professor cell parsing (rejoining continuation lines)
const parsedProfs = parseProfessorsCell('Zanatta, Valentin\nSantiago\nPérez, Juan');
assert(parsedProfs.length === 2, 'Expected 2 professors, got ' + parsedProfs.length);
assert(parsedProfs[0] === 'Zanatta, Valentin Santiago', 'Continuation line joined correctly');
assert(parsedProfs[1] === 'Pérez, Juan', 'Second professor preserved');
console.log('✓ Professor name parsing and line continuation tests passed');

// 10. Comparison function with detailed diffs
export function compareSchedules(
  expected: SubjectSchedule[],
  actual: SubjectSchedule[]
): { equal: boolean; diffs: string[] } {
  const diffs: string[] = [];

  const expMap = new Map<string, SubjectSchedule>();
  for (const s of expected) expMap.set(`${s.subjectId}`, s);

  const actMap = new Map<string, SubjectSchedule>();
  for (const s of actual) actMap.set(`${s.subjectId}`, s);

  for (const [sId, exp] of expMap.entries()) {
    const act = actMap.get(sId);
    if (!act) {
      diffs.push(`Materia ID ${sId} falta en el resultado obtenido`);
      continue;
    }
    if (act.term !== exp.term) {
      diffs.push(`Materia ID ${sId} término diferente: esperado ${exp.term}, obtenido ${act.term}`);
    }
    const expComm = exp.commissions[0];
    const actComm = act.commissions[0];
    if (!actComm) {
      diffs.push(`Materia ID ${sId} no tiene comisiones`);
      continue;
    }
    if (actComm.id !== expComm.id) {
      diffs.push(`Materia ID ${sId} id comisión diferente: esperado "${expComm.id}", obtenido "${actComm.id}"`);
    }
    if (actComm.code !== expComm.code) {
      diffs.push(`Materia ID ${sId} code diferente: esperado "${expComm.code}", obtenido "${actComm.code}"`);
    }
    if (actComm.courseCode !== expComm.courseCode) {
      diffs.push(`Materia ID ${sId} courseCode diferente: esperado "${expComm.courseCode}", obtenido "${actComm.courseCode}"`);
    }
    if (actComm.turno !== expComm.turno) {
      diffs.push(`Materia ID ${sId} turno diferente: esperado "${expComm.turno}", obtenido "${actComm.turno}"`);
    }

    // Compare professors (order independent)
    const expProfs = [...expComm.professors].sort();
    const actProfs = [...actComm.professors].sort();
    if (JSON.stringify(expProfs) !== JSON.stringify(actProfs)) {
      diffs.push(`Materia ID ${sId} docentes diferentes:\n  Esperado: [${expProfs.join(', ')}]\n  Obtenido: [${actProfs.join(', ')}]`);
    }

    // Compare slots (order independent)
    if (!areSlotsEqual(expComm.slots, actComm.slots)) {
      const sortKey = (s: Slot) => `${s.day}_${s.start}_${s.end}`;
      const eSlots = [...expComm.slots].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      const aSlots = [...actComm.slots].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      diffs.push(
        `Materia ID ${sId} slots diferentes:\n  Esperado: ${JSON.stringify(eSlots)}\n  Obtenido: ${JSON.stringify(aSlots)}`
      );
    }
  }

  for (const sId of actMap.keys()) {
    if (!expMap.has(sId)) {
      diffs.push(`Materia ID ${sId} sobra en el resultado obtenido`);
    }
  }

  return { equal: diffs.length === 0, diffs };
}

// 11. Test parse of sheet 2K1 against fixture horarios_ejemplo_2K1.json
const fixturePath = path.resolve('data-source/expected/horarios_ejemplo_2K1.json');
assert(fs.existsSync(fixturePath), `Fixture file must exist at ${fixturePath}`);
const fixtureData = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

const workbookPath = path.resolve('data-source/2do año.xlsx');
assert(fs.existsSync(workbookPath), `Workbook must exist at ${workbookPath}`);
const wb = XLSX.readFile(workbookPath);
const sheet2K1 = wb.Sheets['2K1'];
assert(Boolean(sheet2K1), 'Sheet 2K1 must exist in 2do año.xlsx');

const warnings: any[] = [];
const parsed2K1 = parseCourseSheet(sheet2K1, '2K1', '2do año.xlsx', warnings);

const cmpResult = compareSchedules(fixtureData.schedule, parsed2K1);
if (!cmpResult.equal) {
  console.error('❌ Mismatch details with fixture 2K1:');
  cmpResult.diffs.forEach((d) => console.error('  ' + d));
  throw new Error(`Sheet 2K1 parse does not match expected fixture. ${cmpResult.diffs.length} differences found.`);
}
console.log('✓ Sheet 2K1 parse matches fixture horarios_ejemplo_2K1.json EXACTLY (order-independent)');

// 12. Test specific fixture rules verified in 2K1
// 12a. Merged range over gap row clamped to 12:50
const probYEst = parsed2K1.find((s) => s.subjectId === 17);
assert(Boolean(probYEst), 'Subject 17 must exist');
const lunSlot = probYEst!.commissions[0].slots.find((s) => s.day === 'LUN');
assert(lunSlot?.start === '11:20' && lunSlot?.end === '12:50', 'Slot across gap must be clamped to 12:50');
console.log('✓ Shift gap clamping to 12:50 verified');

// 12b. Break row preserves separated slots
const fis2 = parsed2K1.find((s) => s.subjectId === 10);
assert(Boolean(fis2), 'Subject 10 must exist');
const mieSlots = fis2!.commissions[0].slots.filter((s) => s.day === 'MIE');
assert(mieSlots.length === 2, 'Física 2 on MIE must have 2 slots separated by break');
assert(
  mieSlots.some((s) => s.start === '08:00' && s.end === '09:30') &&
  mieSlots.some((s) => s.start === '09:40' && s.end === '10:25'),
  'Slots separated by break must not be joined'
);
console.log('✓ Recreo separation verified');

// 12c. Annual consolidation
assert(parsed2K1.find((s) => s.subjectId === 9)?.term === 'A', 'Análisis 2 must be term A');
assert(parsed2K1.find((s) => s.subjectId === 10)?.term === 'A', 'Física 2 must be term A');
assert(parsed2K1.find((s) => s.subjectId === 15)?.term === 'A', 'Sistemas Operativos must be term A');
assert(parsed2K1.find((s) => s.subjectId === 16)?.term === 'A', 'Análisis de Sistemas must be term A');
assert(parsed2K1.find((s) => s.subjectId === 13)?.term === '1C', 'Sintaxis must be term 1C');
assert(parsed2K1.find((s) => s.subjectId === 14)?.term === '2C', 'Paradigmas must be term 2C');
console.log('✓ Annual consolidation and cuatrimestral separation verified');

// 13. Verify full schedule.json if present
const scheduleJsonPath = path.resolve('server/seed-data/schedule.json');
if (fs.existsSync(scheduleJsonPath)) {
  const scheduleData = JSON.parse(fs.readFileSync(scheduleJsonPath, 'utf-8'));
  const validation = validateScheduleData(scheduleData);
  assert(validation.valid, `schedule.json validation failed: ${validation.errors.join(', ')}`);
  console.log(`✓ schedule.json is valid according to validateScheduleData (${validation.commissionsCount} commissions, ${validation.reservedElectiveSlotsCount} reserved elective slots)`);
}

function buildNormalizedIsiCatalogFromSeed(): ActivePlanCatalog {
  const catalogSeed = JSON.parse(
    fs.readFileSync(path.resolve('server/seed-data/plan2023-catalog.json'), 'utf-8')
  );
  const codeToUuid = new Map<number, string>();
  const subjects = catalogSeed.subjects.map((s: any, idx: number) => {
    const id = `sched-test-subj-${idx + 1}`;
    codeToUuid.set(s.codeInPlan, id);
    return {
      id,
      codeInPlan: s.codeInPlan,
      displayCode: (s as { displayCode?: string | null }).displayCode ?? null,
      name: s.name,
      shortName: s.shortName,
      level: s.level,
      modality: s.modality,
      contraCuatrimestral: Boolean(s.contraCuatrimestral),
      weeklyHours: s.weeklyHours,
      kind: s.kind,
      credits: s.credits ?? null,
      isOptionalTrack: Boolean(s.isOptionalTrack),
      trackKey: s.trackKey ?? null,
      isIntegrator: Boolean(s.isIntegrator),
    };
  });

  const prerequisites: Array<{ subjectId: string; requiresSubjectId: string; type: string }> = [];
  for (const s of catalogSeed.subjects) {
    const subjectId = codeToUuid.get(s.codeInPlan)!;
    for (const req of s.regularPrereqs ?? []) {
      const requiresSubjectId = codeToUuid.get(req);
      if (requiresSubjectId) prerequisites.push({ subjectId, requiresSubjectId, type: 'regular' });
    }
    for (const req of s.approvedPrereqs ?? []) {
      const requiresSubjectId = codeToUuid.get(req);
      if (requiresSubjectId) prerequisites.push({ subjectId, requiresSubjectId, type: 'approved' });
    }
  }

  return formatPlanCatalogPayload({
    plan: {
      id: 'plan-isi-2023',
      name: catalogSeed.studyPlan.name,
      year: catalogSeed.studyPlan.year,
      config: catalogSeed.studyPlan.config,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    career: {
      id: 'career-isi',
      name: catalogSeed.career.name,
      code: catalogSeed.career.code,
      facultyId: 'faculty-frc',
      facultyCode: catalogSeed.faculty.code,
      facultyName: catalogSeed.faculty.name,
      institutionCode: catalogSeed.institution.code,
      institutionName: catalogSeed.institution.name,
    },
    subjects,
    prerequisites,
    rules: [],
    acronyms: [],
  }) as ActivePlanCatalog;
}

// 14. Verify catalog shortName alignment, schedule.json parity (41 subjects) and exact 15 expected historical diffs (60 subjects)
const isiCatalog = buildNormalizedIsiCatalogFromSeed();
const isiSubjectById = new Map<number, Subject>(isiCatalog.subjects.map((s) => [s.id, s]));

assert(
  getSubjectShortName(21, isiSubjectById.get(21)!.name, isiSubjectById.get(21)) === 'Com. de Datos',
  'ID 21 must be Comunicación de Datos'
);
assert(
  getSubjectShortName(22, isiSubjectById.get(22)!.name, isiSubjectById.get(22)) === 'Análisis Numérico',
  'ID 22 must be Análisis Numérico'
);
assert(
  getSubjectShortName(23, isiSubjectById.get(23)!.name, isiSubjectById.get(23)) === 'Diseño de Sist. (DSI)',
  'ID 23 must be Diseño de Sistemas de Información'
);
assert(
  getSubjectShortName(24, isiSubjectById.get(24)!.name, isiSubjectById.get(24)) === 'Legislación',
  'ID 24 must be Legislación'
);
assert(
  getSubjectShortName(29, isiSubjectById.get(29)!.name, isiSubjectById.get(29)) === 'Automatización (TPA)',
  'ID 29 must be Tecnologías para la Automatización'
);

// Check that every ID in HISTORICAL_SUBJECT_SHORT_NAMES actually exists in CORE_SUBJECTS or ELECTIVES
const allKnownIds = new Set([...CORE_SUBJECTS.map((s: any) => s.id), ...ELECTIVES.map((e: any) => e.id)]);
Object.keys(HISTORICAL_SUBJECT_SHORT_NAMES).forEach((idStr) => {
  const id = Number(idStr);
  assert(allKnownIds.has(id), `HISTORICAL_SUBJECT_SHORT_NAMES contains unknown subject ID ${id}`);
});
assert(
  getSubjectShortName(22, 'Análisis Numérico', isiSubjectById.get(22)) === 'Análisis Numérico',
  'getSubjectShortName for 22 should return Análisis Numérico'
);

// 14b. Parity test over all 41 subjects present in server/seed-data/schedule.json against historical fixture
const seedSchedulePayload = JSON.parse(fs.readFileSync(scheduleJsonPath, 'utf-8'));
const scheduledSubjectIds = Array.from(
  new Set<number>(seedSchedulePayload.schedule.map((entry: { subjectId: number }) => entry.subjectId))
).sort((a, b) => a - b);
assert(
  scheduledSubjectIds.length === 41,
  `Expected 41 distinct subjects in server/seed-data/schedule.json, got ${scheduledSubjectIds.length}`
);
for (const subjectId of scheduledSubjectIds) {
  const catalogSubj = isiSubjectById.get(subjectId);
  assert(Boolean(catalogSubj), `Scheduled subject #${subjectId} must exist in normalized ISI catalog`);
  const resolvedShort = getSubjectShortName(catalogSubj!.id, catalogSubj!.name, catalogSubj);
  assert(
    resolvedShort === HISTORICAL_SUBJECT_SHORT_NAMES[subjectId],
    `Schedule parity mismatch for #${subjectId}: got "${resolvedShort}", expected "${HISTORICAL_SUBJECT_SHORT_NAMES[subjectId]}"`
  );
}

// 14c. Full 60-subject catalog check: only the 15 explicitly listed differences vs HISTORICAL_SUBJECT_SHORT_NAMES are allowed
interface ExpectedShortNameDiff {
  id: number;
  oldName: string | null;
  newName: string;
  reason: string;
}

const EXPECTED_SHORT_NAME_DIFFS: ExpectedShortNameDiff[] = [
  {
    id: 301,
    oldName: null,
    newName: 'Backend de Aplicaciones',
    reason: 'Electiva 3er año ausente en el diccionario histórico y sin oferta en schedule.json',
  },
  {
    id: 401,
    oldName: 'Gerenciamiento Proyectos',
    newName: 'Green Software',
    reason: 'Electiva reasignada en catálogo Plan 2023 respecto al diccionario histórico (sin comisiones en schedule.json)',
  },
  {
    id: 402,
    oldName: 'Arquitectura Software',
    newName: 'Gestión Industrial de la Producción',
    reason: 'Electiva reasignada en catálogo Plan 2023 respecto al diccionario histórico (sin comisiones en schedule.json)',
  },
  {
    id: 403,
    oldName: 'Testing de Software',
    newName: 'Gestión de la Mejora de los Procesos',
    reason: 'Electiva reasignada en catálogo Plan 2023 respecto al diccionario histórico (sin comisiones en schedule.json)',
  },
  {
    id: 404,
    oldName: 'Seguridad en Redes',
    newName: 'Desarrollo y Operaciones DevOps',
    reason: 'Electiva reasignada en catálogo Plan 2023 respecto al diccionario histórico (sin comisiones en schedule.json)',
  },
  {
    id: 406,
    oldName: 'Gobierno de TI',
    newName: 'Comunicación Multimedial en el Desarrollo de Sistemas de Información',
    reason: 'Electiva reasignada en catálogo Plan 2023 respecto al diccionario histórico (sin comisiones en schedule.json)',
  },
  {
    id: 407,
    oldName: 'Bioinformática',
    newName: 'Arquitectura de Software',
    reason: 'Electiva reasignada en catálogo Plan 2023 respecto al diccionario histórico (sin comisiones en schedule.json)',
  },
  {
    id: 501,
    oldName: 'Criptografía Aplicada',
    newName: 'Desarrollo de Tecnologías Blockchain',
    reason: 'Electiva reasignada en catálogo Plan 2023 respecto al diccionario histórico (sin comisiones en schedule.json)',
  },
  {
    id: 502,
    oldName: 'Auditoría de Sistemas',
    newName: 'Creatividad e Innovación en Ingeniería',
    reason: 'Electiva reasignada en catálogo Plan 2023 respecto al diccionario histórico (sin comisiones en schedule.json)',
  },
  {
    id: 503,
    oldName: 'Cloud Computing',
    newName: 'Auditoría de SI/TI',
    reason: 'Electiva reasignada en catálogo Plan 2023 respecto al diccionario histórico (sin comisiones en schedule.json)',
  },
  {
    id: 504,
    oldName: 'DevOps & CI/CD',
    newName: 'Gerenciamiento Estratégico',
    reason: 'Electiva reasignada en catálogo Plan 2023 respecto al diccionario histórico (sin comisiones en schedule.json)',
  },
  {
    id: 505,
    oldName: 'Arquitecturas Cloud Nativas',
    newName: 'Consultoría en Negocios Digitales',
    reason: 'Electiva reasignada en catálogo Plan 2023 respecto al diccionario histórico (sin comisiones en schedule.json)',
  },
  {
    id: 506,
    oldName: 'Deep Learning',
    newName: 'Emprendimientos Tecnológicos',
    reason: 'Electiva reasignada en catálogo Plan 2023 respecto al diccionario histórico (sin comisiones en schedule.json)',
  },
  {
    id: 508,
    oldName: 'Procesamiento Lenguaje Natural',
    newName: 'Testing de Software',
    reason: 'Electiva reasignada en catálogo Plan 2023 respecto al diccionario histórico (sin comisiones en schedule.json)',
  },
  {
    id: 510,
    oldName: 'Big Data',
    newName: 'Integración de Aplicaciones en Entorno Web',
    reason: 'Electiva reasignada en catálogo Plan 2023 respecto al diccionario histórico (sin comisiones en schedule.json)',
  },
];

assert(
  isiCatalog.subjects.length === 60,
  `Expected 60 catalog subjects in ISI Plan 2023, got ${isiCatalog.subjects.length}`
);
assert(
  EXPECTED_SHORT_NAME_DIFFS.length === 15,
  `Expected 15 documented shortName diffs, got ${EXPECTED_SHORT_NAME_DIFFS.length}`
);

const expectedDiffById = new Map(EXPECTED_SHORT_NAME_DIFFS.map((d) => [d.id, d]));
const observedDiffIds = new Set<number>();

for (const subj of isiCatalog.subjects) {
  const resolved = getSubjectShortName(subj.id, subj.name, subj);
  const historical = HISTORICAL_SUBJECT_SHORT_NAMES[subj.id] ?? null;
  if (resolved !== historical) {
    observedDiffIds.add(subj.id);
    const expected = expectedDiffById.get(subj.id);
    assert(
      Boolean(expected),
      `Unexpected shortName difference for #${subj.id}: old="${historical}" new="${resolved}"`
    );
    assert(
      historical === expected!.oldName,
      `Expected oldName mismatch for #${subj.id}: got "${historical}", expected "${expected!.oldName}"`
    );
    assert(
      resolved === expected!.newName,
      `Expected newName mismatch for #${subj.id}: got "${resolved}", expected "${expected!.newName}"`
    );
  }
}

for (const expected of EXPECTED_SHORT_NAME_DIFFS) {
  assert(
    observedDiffIds.has(expected.id),
    `Expected shortName diff for #${expected.id} ("${expected.oldName}" -> "${expected.newName}") disappeared`
  );
}
assert(
  observedDiffIds.size === EXPECTED_SHORT_NAME_DIFFS.length,
  `Expected exact count of ${EXPECTED_SHORT_NAME_DIFFS.length} shortName differences, observed ${observedDiffIds.size}`
);

console.log('✓ Catalog shortName, 41-subject schedule.json parity & 15-diff verification passed');

// 15. Verify importAllSchedules runs cleanly after src/data/schedule.json removal and does NOT overwrite seed by default
assert(
  DEFAULT_GENERATED_SCHEDULE_OUTPUT !== SEED_SCHEDULE_OUTPUT &&
    DEFAULT_GENERATED_SCHEDULE_OUTPUT.endsWith(path.join('artifacts', 'schedule.generated.json')),
  'Default schedule importer output must point to artifacts/schedule.generated.json and never overwrite server/seed-data/schedule.json'
);
const seedMtimeBefore = fs.existsSync(SEED_SCHEDULE_OUTPUT) ? fs.statSync(SEED_SCHEDULE_OUTPUT).mtimeMs : null;
const fullImportPreview = importAllSchedules({ writeOutput: false });
assert(fullImportPreview.validation.valid, 'importAllSchedules({ writeOutput: false }) must pass validation');
assert(fullImportPreview.finalSchedules.length > 0, 'importAllSchedules({ writeOutput: false }) must return schedules');
assert(fullImportPreview.outputPath === DEFAULT_GENERATED_SCHEDULE_OUTPUT, 'Default resolved outputPath must be artifacts/schedule.generated.json');
if (seedMtimeBefore !== null) {
  assert(
    fs.statSync(SEED_SCHEDULE_OUTPUT).mtimeMs === seedMtimeBefore,
    'importAllSchedules must not modify server/seed-data/schedule.json unless writeSeed is explicitly true'
  );
}
console.log('✓ importAllSchedules end-to-end execution and seed protection verified');

console.log('\nALL SCHEDULE IMPORT TESTS PASSED SUCCESSFULLY!\n');
