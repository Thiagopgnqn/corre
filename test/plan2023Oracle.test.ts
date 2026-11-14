import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatPlanCatalogPayload } from '../server/src/modules/catalog/planConfig.helpers';
import { evaluatePlanProgress } from '../src/utils/correlativas';
import { calculateCriticalPath } from '../src/utils/criticalPath';
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
});
