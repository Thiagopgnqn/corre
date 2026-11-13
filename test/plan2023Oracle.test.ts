import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORE_SUBJECTS } from '../src/data/plan2023';
import {
  ELECTIVES,
  REQUIRED_ELECTIVE_CREDITS_TOTAL,
  ELECTIVE_SLOTS_EQUIVALENT,
} from '../src/data/electives';
import {
  getSubjectStatus,
  isApprovedOrHigher,
  canRenderSeminario,
  canRenderProyectoFinal,
  checkAnalistaTitle,
  isPPSEligible,
  calculateProgressBreakdown,
} from '../src/utils/correlativas';
import { calculateCriticalPath } from '../src/utils/criticalPath';
import type {
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

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const oraclePath = path.resolve(currentDir, 'fixtures/plan2023Oracle.json');
const oracle: OracleFile = JSON.parse(fs.readFileSync(oraclePath, 'utf8'));

function evaluatePlan2023WithCurrentEngine(
  activeState: UserCareerState,
  settings: AppSettings,
  examAttempts: ExamAttempt[]
) {
  const activeCoreSubjects = settings.includeAnalistaTrack
    ? CORE_SUBJECTS
    : CORE_SUBJECTS.filter((s) => s.id !== 99);

  let approvedCount = 0;
  let promotedCount = 0;
  let regularizedCount = 0;
  let takingCount = 0;
  let blockedCount = 0;
  let availableCount = 0;
  let libreCount = 0;

  let totalWeeklyHours = 0;
  let approvedWeeklyHours = 0;

  const gradesToAverage: number[] = [];
  const coreStatuses: Record<string, SubjectStatus> = {};
  const availableCoreIds: number[] = [];

  activeCoreSubjects.forEach((subject) => {
    totalWeeklyHours += subject.weeklyHours;
    const status = getSubjectStatus(subject, activeState);
    coreStatuses[String(subject.id)] = status;
    if (status === 'disponible') {
      availableCoreIds.push(subject.id);
    }
    const st = activeState[subject.id];

    if (status === 'aprobada') {
      approvedCount++;
      approvedWeeklyHours += subject.weeklyHours;
      if (st?.grade !== undefined && st.grade >= settings.minPassingGrade) {
        gradesToAverage.push(st.grade);
      }
    } else if (status === 'promocionada') {
      promotedCount++;
      approvedWeeklyHours += subject.weeklyHours;
      if (st?.grade !== undefined && st.grade >= settings.minPassingGrade) {
        gradesToAverage.push(st.grade);
      }
    } else if (status === 'regularizada') {
      regularizedCount++;
    } else if (status === 'cursando') {
      takingCount++;
    } else if (status === 'disponible') {
      availableCount++;
    } else if (status === 'libre') {
      libreCount++;
      blockedCount++;
    } else {
      blockedCount++;
    }
  });

  const electiveStatuses: Record<string, SubjectStatus> = {};
  const availableElectiveIds: number[] = [];
  let totalElectiveCreditsApproved = 0;
  let totalElectiveCreditsRegularized = 0;
  let totalElectiveCreditsTaking = 0;

  ELECTIVES.forEach((el) => {
    const computedStatus = getSubjectStatus(el, activeState);
    electiveStatuses[String(el.id)] = computedStatus;
    if (computedStatus === 'disponible') {
      availableElectiveIds.push(el.id);
    }

    const st = activeState[el.id];
    if (isApprovedOrHigher(st)) {
      totalElectiveCreditsApproved += el.credits;
      if (st?.grade !== undefined && st.grade >= settings.minPassingGrade) {
        gradesToAverage.push(st.grade);
      }
    } else if (st?.status === 'regularizada') {
      totalElectiveCreditsRegularized += el.credits;
    } else if (st?.status === 'cursando') {
      totalElectiveCreditsTaking += el.credits;
    }
  });

  const coreApproved = approvedCount + promotedCount;
  const corePending = blockedCount + availableCount;

  const breakdown = calculateProgressBreakdown({
    coreApproved,
    coreRegularized: regularizedCount,
    coreTaking: takingCount,
    corePending,
    totalCore: activeCoreSubjects.length,
    electiveCreditsApproved: totalElectiveCreditsApproved,
    electiveCreditsRegularized: totalElectiveCreditsRegularized,
    electiveCreditsTaking: totalElectiveCreditsTaking,
    includeElectives: settings.includeElectivesInProgress,
    electiveSlotsEquivalent: ELECTIVE_SLOTS_EQUIVALENT,
    requiredElectiveCredits: REQUIRED_ELECTIVE_CREDITS_TOTAL,
  });

  const careerPercentageBySubjects = breakdown.percentageApproved;
  const careerPercentageByHours = totalWeeklyHours > 0
    ? Math.round((approvedWeeklyHours / totalWeeklyHours) * 100)
    : 0;

  const failGrades = examAttempts
    .filter((att) => !att.isPassed || att.grade < settings.minPassingGrade)
    .map((att) => att.grade);

  const allGradesWithFails = [...gradesToAverage, ...failGrades];

  const averageGradeWithoutFails = gradesToAverage.length > 0
    ? Number((gradesToAverage.reduce((a, b) => a + b, 0) / gradesToAverage.length).toFixed(2))
    : 0;

  const averageGradeWithFails = allGradesWithFails.length > 0
    ? Number((allGradesWithFails.reduce((a, b) => a + b, 0) / allGradesWithFails.length).toFixed(2))
    : averageGradeWithoutFails;

  const averageGrade = settings.includeFailsInGPA
    ? averageGradeWithFails
    : averageGradeWithoutFails;

  const missingElectiveCreditsForDegree = Math.max(0, REQUIRED_ELECTIVE_CREDITS_TOTAL - totalElectiveCreditsApproved);
  const missingCoreForDegree = activeCoreSubjects
    .filter((s) => !isApprovedOrHigher(activeState[s.id]))
    .map((s) => s.id);

  const seminario = canRenderSeminario(activeState);
  const proyectoFinal = canRenderProyectoFinal(activeState, settings.includeAnalistaTrack);
  const analista = checkAnalistaTitle(activeState, totalElectiveCreditsApproved);
  const pps = isPPSEligible(activeState);

  const isDegreeEligible =
    missingCoreForDegree.length === 0 &&
    totalElectiveCreditsApproved >= REQUIRED_ELECTIVE_CREDITS_TOTAL;

  const progress: CareerProgress = {
    totalSubjects: activeCoreSubjects.length,
    approvedCount,
    promotedCount,
    regularizedCount,
    takingCount,
    blockedCount,
    availableCount,
    totalWeeklyHours,
    approvedWeeklyHours,
    careerPercentageBySubjects,
    careerPercentageByHours,
    percentageApproved: breakdown.percentageApproved,
    percentageTaking: breakdown.percentageTaking,
    percentageRegularized: breakdown.percentageRegularized,
    percentagePending: breakdown.percentagePending,
    totalEquivalentSlots: breakdown.totalEquivalentSlots,
    approvedEquivalentSlots: breakdown.approvedEquivalentSlots,
    averageGrade,
    averageGradeWithPromotions: averageGrade,
    averageGradeWithoutFails,
    averageGradeWithFails,
    totalFailsCount: failGrades.length,
    libreCount,
    pendingFinalsCount: regularizedCount,
    totalElectiveCreditsApproved,
    totalElectiveCreditsTaking,
    totalElectiveCreditsRegularized,
    totalElectiveCreditsRequired: REQUIRED_ELECTIVE_CREDITS_TOTAL,
    missingElectiveCreditsForDegree,
    missingCoreForDegree,
    isAnalistaEligible: analista.eligible,
    missingForAnalista: {
      missingCoreIds: analista.missingCoreIds,
      seminarioApproved: analista.seminarioApproved,
      electiveCredits: analista.electiveCredits,
    },
    isPPSEligible: pps.eligible,
    isDegreeEligible,
  };

  const criticalPath = calculateCriticalPath(activeState, settings.includeAnalistaTrack);

  return {
    progress,
    availableCoreIds,
    availableElectiveIds,
    coreStatuses,
    electiveStatuses,
    seminario,
    proyectoFinal,
    analista,
    pps,
    criticalPath: {
      chainIds: criticalPath.chain.map((s: Subject) => s.id),
      length: criticalPath.length,
      estimatedTerms: criticalPath.estimatedTerms,
    },
  };
}

describe('Plan 2023 Frozen Regression Oracle', () => {
  it('contains expected oracle scenarios including explicit PPS enabled & blocked cases', () => {
    assert.ok(oracle.scenarios.length >= 13);
    const ids = new Set(oracle.scenarios.map((s) => s.id));
    assert.ok(ids.has('05-pps-blocked-approved-prereqs-only-regular'));
    assert.ok(ids.has('06-pps-blocked-missing-one-regular-with-514-approved'));
    assert.ok(ids.has('07-pps-enabled-minimal'));
  });

  for (const scenario of oracle.scenarios) {
    it(`matches frozen oracle output for scenario: ${scenario.id}`, () => {
      const actual = evaluatePlan2023WithCurrentEngine(
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
});
