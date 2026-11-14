import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatPlanCatalogPayload } from '../server/src/modules/catalog/planConfig.helpers';
import { evaluatePlanProgress } from '../src/utils/correlativas';
import { calculateCriticalPath } from '../src/utils/criticalPath';
import { getSampleStudentForPlan } from '../src/utils/storage';
import { CORE_SUBJECTS } from './fixtures/plan2023';
import { ELECTIVES } from './fixtures/electives';
import type {
  ActivePlanCatalog,
  CareerProgress,
  ExamAttempt,
  Subject,
  SubjectStatus,
  UserCareerState,
} from '../src/types/career';
import type { AppSettings } from '../src/utils/storage';

interface OracleScenario {
  id: string;
  description: string;
  input: {
    userState: UserCareerState;
    settings: AppSettings;
    examAttempts: ExamAttempt[];
  };
  expected: {
    progress: CareerProgress;
    availableCoreIds: number[];
    availableElectiveIds: number[];
    coreStatuses: Record<string, SubjectStatus>;
    electiveStatuses: Record<string, SubjectStatus>;
    seminario: { canRender: boolean; missingIds: number[] };
    proyectoFinal: { canRender: boolean; missingIds: number[] };
    analista: {
      eligible: boolean;
      missingCoreIds: number[];
      seminarioApproved: boolean;
      electiveCredits: number;
    };
    pps: {
      eligible: boolean;
      missingRegular: number[];
      missingApproved: number[];
    };
    criticalPath: {
      chainIds: number[];
      length: number;
      estimatedTerms: number;
    };
  };
}

interface OracleFile {
  planId: string;
  description: string;
  scenarios: OracleScenario[];
}

interface RawSeedCatalog {
  career: { code: string; name: string };
  studyPlan: { name: string; year: number; config: Record<string, unknown> };
  subjects: Array<{
    codeInPlan: number;
    name: string;
    shortName?: string;
    level: number;
    modality: string;
    contraCuatrimestral?: boolean;
    weeklyHours: number;
    kind: string;
    credits?: number | null;
    isOptionalTrack?: boolean;
    trackKey?: string | null;
    isIntegrator?: boolean;
    regularPrereqs?: number[];
    approvedPrereqs?: number[];
  }>;
  specialRules?: Array<{
    subjectCode: number;
    ruleType: string;
    params?: Record<string, unknown>;
    description?: string;
  }>;
  acronyms?: Array<{
    acronym: string;
    subjectCode: number;
  }>;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const oraclePath = path.resolve(currentDir, 'fixtures/plan2023Oracle.json');
const seedCatalogPath = path.resolve(currentDir, '../server/seed-data/plan2023-catalog.json');
const oracle: OracleFile = JSON.parse(fs.readFileSync(oraclePath, 'utf8'));
const seedRaw: RawSeedCatalog = JSON.parse(fs.readFileSync(seedCatalogPath, 'utf8'));

function buildPlanFromSeedCatalog(sortDbOrder: boolean): ActivePlanCatalog {
  const rawSubjects = [...seedRaw.subjects];
  if (sortDbOrder) {
    rawSubjects.sort((a, b) => a.level - b.level || a.codeInPlan - b.codeInPlan);
  }

  const codeToUuid = new Map<number, string>();
  const subjects = rawSubjects.map((s, idx) => {
    const id = `subj-${s.codeInPlan}-${idx}`;
    codeToUuid.set(s.codeInPlan, id);
    return {
      id,
      codeInPlan: s.codeInPlan,
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
  for (const s of rawSubjects) {
    const subjectId = codeToUuid.get(s.codeInPlan)!;
    for (const reqCode of s.regularPrereqs ?? []) {
      const requiresSubjectId = codeToUuid.get(reqCode);
      if (requiresSubjectId) {
        prerequisites.push({ subjectId, requiresSubjectId, type: 'regular' });
      }
    }
    for (const reqCode of s.approvedPrereqs ?? []) {
      const requiresSubjectId = codeToUuid.get(reqCode);
      if (requiresSubjectId) {
        prerequisites.push({ subjectId, requiresSubjectId, type: 'approved' });
      }
    }
  }

  const rules = (seedRaw.specialRules ?? []).map((r, idx) => ({
    id: `rule-${idx}`,
    subjectId: codeToUuid.get(r.subjectCode)!,
    ruleType: r.ruleType,
    params: r.params ?? {},
    description: r.description ?? '',
  }));

  const acronyms = (seedRaw.acronyms ?? []).map((a) => ({
    acronym: a.acronym,
    subjectId: codeToUuid.get(a.subjectCode)!,
  }));

  return formatPlanCatalogPayload({
    plan: {
      id: 'plan-isi-2023',
      name: seedRaw.studyPlan.name,
      year: seedRaw.studyPlan.year,
      config: seedRaw.studyPlan.config,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    career: {
      id: 'career-isi',
      name: seedRaw.career.name,
      code: seedRaw.career.code,
      facultyId: 'fac-frc',
    },
    subjects,
    prerequisites,
    rules,
    acronyms,
  }) as unknown as ActivePlanCatalog;
}

const seedOrderPlan = buildPlanFromSeedCatalog(false);
const dbSortedPlan = buildPlanFromSeedCatalog(true);

function evaluatePlan2023WithEngine(
  plan: ActivePlanCatalog,
  activeState: UserCareerState,
  settings: AppSettings,
  examAttempts: ExamAttempt[]
) {
  const evaluated = evaluatePlanProgress({
    plan,
    userState: activeState,
    settings,
    examAttempts,
  });

  const criticalPath = calculateCriticalPath(
    activeState,
    plan,
    settings.includeAnalistaTrack
  );

  return {
    progress: evaluated.progress,
    availableCoreIds: evaluated.availableCoreIds,
    availableElectiveIds: evaluated.availableElectiveIds,
    coreStatuses: evaluated.coreStatuses,
    electiveStatuses: evaluated.electiveStatuses,
    seminario: evaluated.seminario,
    proyectoFinal: evaluated.proyectoFinal,
    analista: evaluated.analista,
    pps: evaluated.pps,
    criticalPath: {
      chainIds: criticalPath.chain.map((s: Subject) => s.id),
      length: criticalPath.length,
      estimatedTerms: criticalPath.estimatedTerms,
    },
  };
}

describe('Plan 2023 Frozen Regression Oracle', () => {
  it('contains expected oracle scenarios including explicit PPS, Seminario and settings boundary cases', () => {
    assert.ok(oracle.scenarios.length >= 20);
    const ids = new Set(oracle.scenarios.map((s) => s.id));
    assert.ok(ids.has('05-pps-blocked-approved-prereqs-only-regular'));
    assert.ok(ids.has('06-pps-blocked-missing-one-regular-with-514-approved'));
    assert.ok(ids.has('07-pps-enabled-minimal'));
    assert.ok(ids.has('14-seminario-edge-only-subject-1'));
    assert.ok(ids.has('15-seminario-edge-missing-23-with-24'));
    assert.ok(ids.has('16-seminario-edge-missing-1-with-24'));
    assert.ok(ids.has('17-seminario-edge-exact-1-to-23'));
    assert.ok(ids.has('18-seminario-edge-1-to-23-plus-24'));
    assert.ok(ids.has('19-include-promotions-in-gpa-false'));
    assert.ok(ids.has('20-allow-blocked-electives-planning-true'));
  });

  for (const scenario of oracle.scenarios) {
    it(`matches frozen oracle output for scenario: ${scenario.id}`, () => {
      const actual = evaluatePlan2023WithEngine(
        seedOrderPlan,
        scenario.input.userState,
        scenario.input.settings,
        scenario.input.examAttempts
      );

      assert.deepStrictEqual(actual.availableCoreIds, scenario.expected.availableCoreIds);
      assert.deepStrictEqual(actual.availableElectiveIds, scenario.expected.availableElectiveIds);
      assert.deepStrictEqual(actual.coreStatuses, scenario.expected.coreStatuses);
      assert.deepStrictEqual(actual.electiveStatuses, scenario.expected.electiveStatuses);
      assert.deepStrictEqual(actual.progress, scenario.expected.progress);
      assert.deepStrictEqual(actual.seminario, scenario.expected.seminario);
      assert.deepStrictEqual(actual.proyectoFinal, scenario.expected.proyectoFinal);
      assert.deepStrictEqual(actual.analista, scenario.expected.analista);
      assert.deepStrictEqual(actual.pps, scenario.expected.pps);
      assert.deepStrictEqual(actual.criticalPath, scenario.expected.criticalPath);

      const pctSum =
        actual.progress.percentageApproved +
        actual.progress.percentageRegularized +
        actual.progress.percentageTaking +
        actual.progress.percentagePending;
      assert.equal(pctSum, 100, `${scenario.id}: percentages must sum strictly to 100`);

      // Verify identical output when catalog subjects are sorted in DB order (level ASC, codeInPlan ASC)
      const dbActual = evaluatePlan2023WithEngine(
        dbSortedPlan,
        scenario.input.userState,
        scenario.input.settings,
        scenario.input.examAttempts
      );
      assert.deepStrictEqual(dbActual.availableCoreIds, scenario.expected.availableCoreIds);
      assert.deepStrictEqual(
        [...dbActual.availableElectiveIds].sort((a, b) => a - b),
        [...scenario.expected.availableElectiveIds].sort((a, b) => a - b)
      );
      assert.deepStrictEqual(dbActual.coreStatuses, scenario.expected.coreStatuses);
      assert.deepStrictEqual(dbActual.electiveStatuses, scenario.expected.electiveStatuses);
      assert.deepStrictEqual(dbActual.progress, scenario.expected.progress);
      assert.deepStrictEqual(dbActual.seminario, scenario.expected.seminario);
      assert.deepStrictEqual(dbActual.proyectoFinal, scenario.expected.proyectoFinal);
      assert.deepStrictEqual(dbActual.analista, scenario.expected.analista);
      assert.deepStrictEqual(dbActual.pps, scenario.expected.pps);
      assert.deepStrictEqual(dbActual.criticalPath, scenario.expected.criticalPath);
    });
  }

  it('explicitly distinguishes enabled and blocked PPS eligibility scenarios', () => {
    const blockedOnlyReg = oracle.scenarios.find((s) => s.id === '05-pps-blocked-approved-prereqs-only-regular')!;
    assert.equal(blockedOnlyReg.expected.pps.eligible, false);
    assert.deepStrictEqual(blockedOnlyReg.expected.pps.missingRegular, []);
    assert.deepStrictEqual(blockedOnlyReg.expected.pps.missingApproved, [12, 20, 23]);

    const blockedMissing30 = oracle.scenarios.find((s) => s.id === '06-pps-blocked-missing-one-regular-with-514-approved')!;
    assert.equal(blockedMissing30.expected.pps.eligible, false);
    assert.deepStrictEqual(blockedMissing30.expected.pps.missingRegular, [30]);
    assert.deepStrictEqual(blockedMissing30.expected.pps.missingApproved, []);

    const enabledMin = oracle.scenarios.find((s) => s.id === '07-pps-enabled-minimal')!;
    assert.equal(enabledMin.expected.pps.eligible, true);
    assert.deepStrictEqual(enabledMin.expected.pps.missingRegular, []);
    assert.deepStrictEqual(enabledMin.expected.pps.missingApproved, []);
    assert.equal(enabledMin.expected.progress.isPPSEligible, true);
  });

  it('explicitly freezes Seminario (99) boundaries and settings edge cases from current behavior', () => {
    const emptyAnalista = oracle.scenarios.find((s) => s.id === '02-empty-with-analista')!;
    assert.equal(emptyAnalista.expected.seminario.canRender, false);
    assert.equal(emptyAnalista.expected.seminario.missingIds.length, 23);

    const onlySubj1 = oracle.scenarios.find((s) => s.id === '14-seminario-edge-only-subject-1')!;
    assert.equal(onlySubj1.expected.seminario.canRender, false);
    assert.equal(onlySubj1.expected.seminario.missingIds.length, 22);

    const missing23 = oracle.scenarios.find((s) => s.id === '15-seminario-edge-missing-23-with-24')!;
    assert.equal(missing23.expected.seminario.canRender, false);
    assert.deepStrictEqual(missing23.expected.seminario.missingIds, [23]);

    const missing1 = oracle.scenarios.find((s) => s.id === '16-seminario-edge-missing-1-with-24')!;
    assert.equal(missing1.expected.seminario.canRender, false);
    assert.deepStrictEqual(missing1.expected.seminario.missingIds, [1]);

    const exact23 = oracle.scenarios.find((s) => s.id === '17-seminario-edge-exact-1-to-23')!;
    assert.equal(exact23.expected.seminario.canRender, true);
    assert.deepStrictEqual(exact23.expected.seminario.missingIds, []);

    const plus24 = oracle.scenarios.find((s) => s.id === '18-seminario-edge-1-to-23-plus-24')!;
    assert.equal(plus24.expected.seminario.canRender, true);
    assert.deepStrictEqual(plus24.expected.seminario.missingIds, []);

    const promoFalse = oracle.scenarios.find((s) => s.id === '19-include-promotions-in-gpa-false')!;
    assert.equal(promoFalse.expected.progress.averageGrade, 8.5);

    const sampleNoBlocked = oracle.scenarios.find((s) => s.id === '03-sample-3rd-year-no-fails-in-gpa')!;
    const sampleBlockedTrue = oracle.scenarios.find((s) => s.id === '20-allow-blocked-electives-planning-true')!;
    assert.deepStrictEqual(sampleBlockedTrue.expected, sampleNoBlocked.expected);
  });

  it('builds the 60 UI Subject models from formatted catalog payload matching all fixture keys', () => {
    const fixtureSubjects = [...CORE_SUBJECTS, ...ELECTIVES];
    const seedById = new Map(seedRaw.subjects.map((s) => [s.codeInPlan, s]));

    assert.equal(seedOrderPlan.subjects.length, 60);
    assert.equal(fixtureSubjects.length, 60);

    // Excepciones explícitas de claves del fixture que no llegan idénticas en payload.subjects (ninguna):
    const FIXTURE_TO_PAYLOAD_KEY_EXCEPTIONS: Record<string, string> = {};

    // Excepciones explícitas de claves adicionales emitidas por el payload que los fixtures estáticos no tenían:
    const PAYLOAD_ONLY_KEY_EXCEPTIONS: Record<string, string> = {
      uuid: 'UUID de fila en la base de datos generado en DB (el fixture estático no tiene IDs UUID)',
      shortName: 'Nombre abreviado para grilla horaria agregado en DB/seed (short_name)',
      contraCuatrimestral: 'Flag derivado de modalidad en DB (los fixtures codifican *-CC en modality)',
      kind: 'Discriminador explícito obligatoria|electiva de DB (los fixtures distinguían por archivo)',
      isElective: 'El fixture de CORE_SUBJECTS omite isElective cuando es false; el payload lo emite siempre como booleano',
      isOptionalTrack: 'Flag explícito de trayecto opcional agregado en DB (el fixture marcaba la 99 implícitamente)',
      trackKey: 'Identificador de trayecto opcional agregado en DB (en Sistemas es "analista" solo en la 99)',
    };

    const payloadById = new Map(seedOrderPlan.subjects.map((s) => [s.id, s]));

    for (const fixtureSubj of fixtureSubjects) {
      const payloadSubj = payloadById.get(fixtureSubj.id);
      assert.ok(payloadSubj, `Falta la materia #${fixtureSubj.id} en el payload formateado`);

      const seedEntry = seedById.get(fixtureSubj.id);
      assert.ok(seedEntry, `Falta la materia #${fixtureSubj.id} en plan2023-catalog.json`);

      const fixtureRecord = fixtureSubj as unknown as Record<string, unknown>;
      const payloadRecord = payloadSubj as unknown as Record<string, unknown>;

      for (const key of Object.keys(fixtureRecord)) {
        if (key in FIXTURE_TO_PAYLOAD_KEY_EXCEPTIONS) continue;

        assert.ok(
          key in payloadRecord && payloadRecord[key] !== undefined,
          `Falta la clave "${key}" en el payload de la materia #${fixtureSubj.id} (${fixtureSubj.name})`
        );

        if (key === 'regularPrereqs' || key === 'approvedPrereqs') {
          const actualArr = [...((payloadRecord[key] as number[]) || [])].sort((a, b) => a - b);
          const expectedArr = [...((fixtureRecord[key] as number[]) || [])].sort((a, b) => a - b);
          assert.deepStrictEqual(actualArr, expectedArr, `${key} de #${fixtureSubj.id}`);
        } else {
          assert.deepStrictEqual(
            payloadRecord[key],
            fixtureRecord[key],
            `Diferencia en clave "${key}" de #${fixtureSubj.id}`
          );
        }
      }

      for (const key of Object.keys(payloadRecord)) {
        if (payloadRecord[key] === undefined) continue;
        if (!(key in fixtureRecord)) {
          assert.ok(
            key in PAYLOAD_ONLY_KEY_EXCEPTIONS,
            `Clave inesperada "${key}" presente solo en el payload de #${fixtureSubj.id} sin excepción documentada`
          );
        }
      }

      // Verificaciones adicionales de trayecto opcional contra seed y materia 99
      assert.equal(
        Boolean(payloadSubj.isOptionalTrack),
        Boolean(seedEntry.isOptionalTrack),
        `isOptionalTrack vs seed de #${fixtureSubj.id}`
      );
      assert.equal(
        payloadSubj.trackKey ?? undefined,
        seedEntry.trackKey ?? undefined,
        `trackKey vs seed de #${fixtureSubj.id}`
      );
      if (fixtureSubj.id === 99) {
        assert.equal(payloadSubj.isOptionalTrack, true);
        assert.equal(payloadSubj.trackKey, 'analista');
        assert.equal(
          payloadSubj.specialRule,
          'Para RENDIRLO hay que tener aprobadas todas las materias de 1 a 23.'
        );
      } else if (fixtureSubj.id === 36) {
        assert.equal(payloadSubj.isOptionalTrack, false);
        assert.equal(payloadSubj.trackKey, undefined);
        assert.equal(
          payloadSubj.specialRule,
          'Para RENDIRLO hay que tener aprobadas todas las materias previas del plan (1 a 35 + Seminario 99 + Electivas).'
        );
      } else {
        assert.equal(payloadSubj.isOptionalTrack, false);
        assert.equal(payloadSubj.trackKey, undefined);
        assert.equal('specialRule' in payloadSubj, false);
      }
    }
  });

  it('reproduces the exact getSample3rdYearStudent userState and assignedElectives for ISI Plan 2023', () => {
    const sampleOracleScenario = oracle.scenarios.find((s) =>
      s.id.startsWith('03-')
    );
    assert.ok(sampleOracleScenario, 'Debe existir el escenario 03 de muestra de 3er año en plan2023Oracle.json');

    const expectedAssignedElectives = {
      1: [],
      2: [],
      3: [301],
      4: [404],
      5: [],
    };

    for (const sortDbOrder of [false, true]) {
      const plan = buildPlanFromSeedCatalog(sortDbOrder);
      const generated = getSampleStudentForPlan(plan);

      assert.deepStrictEqual(
        generated.userState,
        sampleOracleScenario.input.userState,
        `getSampleStudentForPlan(sortDbOrder=${sortDbOrder}) debe coincidir materia por materia (estado y nota) con getSample3rdYearStudent`
      );
      assert.deepStrictEqual(
        generated.assignedElectives,
        expectedAssignedElectives,
        `assignedElectives(sortDbOrder=${sortDbOrder}) debe coincidir exactamente con getSample3rdYearStudent`
      );
    }
  });
});
