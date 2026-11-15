import type {
  ActivePlanCatalog,
  CareerProgress,
  ExamAttempt,
  PlanSpecialRule,
  Subject,
  SubjectStatus,
  UserCareerState,
  UserSubjectState,
} from '../types/career';

export type OptionalTrackSelection = boolean | string[];

/**
 * Builds a fast lookup Map keyed by subject plan code (`id`).
 */
export function buildSubjectsMap(subjects: Subject[]): Map<number, Subject> {
  const map = new Map<number, Subject>();
  subjects.forEach((s) => map.set(s.id, s));
  return map;
}

/**
 * Checks if a subject state satisfies "Regularizada o superior" (Regularizada, Aprobada, Promocionada)
 */
export function isRegularOrHigher(state?: UserSubjectState): boolean {
  if (!state) return false;
  return state.status === 'regularizada' || state.status === 'aprobada' || state.status === 'promocionada';
}

/**
 * Checks if a subject state satisfies "Aprobada o superior" (Aprobada, Promocionada)
 */
export function isApprovedOrHigher(state?: UserSubjectState): boolean {
  if (!state) return false;
  return state.status === 'aprobada' || state.status === 'promocionada';
}

/**
 * Evaluates whether a subject is eligible to be taken (available/disponible)
 */
export function checkEligibility(
  subject: Subject,
  userState: UserCareerState
): {
  eligible: boolean;
  missingRegular: number[];
  missingApproved: number[];
} {
  const missingRegular = subject.regularPrereqs.filter((reqId) => {
    const st = userState[reqId];
    return !isRegularOrHigher(st);
  });

  const missingApproved = subject.approvedPrereqs.filter((reqId) => {
    const st = userState[reqId];
    return !isApprovedOrHigher(st);
  });

  const eligible = missingRegular.length === 0 && missingApproved.length === 0;

  return {
    eligible,
    missingRegular,
    missingApproved,
  };
}

/**
 * Resolves the computed visual status of a subject
 */
export function getSubjectStatus(subject: Subject, userState: UserCareerState): SubjectStatus {
  const savedState = userState[subject.id];
  if (savedState && savedState.status && savedState.status !== 'bloqueada' && savedState.status !== 'disponible') {
    return savedState.status;
  }

  const { eligible } = checkEligibility(subject, userState);
  return eligible ? 'disponible' : 'bloqueada';
}

/**
 * Returns true if the subject belongs to core curriculum or an actively selected optional track.
 */
export function isSubjectIncludedInTrack(
  subject: Subject,
  trackSelection: OptionalTrackSelection = false
): boolean {
  if (!subject.isOptionalTrack) return true;
  if (Array.isArray(trackSelection)) {
    return Boolean(subject.trackKey && trackSelection.includes(subject.trackKey));
  }
  return Boolean(trackSelection);
}

function extractSubjects(planOrSubjects: ActivePlanCatalog | Subject[]): Subject[] {
  return Array.isArray(planOrSubjects) ? planOrSubjects : planOrSubjects.subjects;
}

/**
 * Returns non-elective subjects included for the given track selection, preserving plan order.
 */
export function getActiveCoreSubjects(
  planOrSubjects: ActivePlanCatalog | Subject[],
  trackSelection: OptionalTrackSelection = false
): Subject[] {
  return extractSubjects(planOrSubjects).filter(
    (s) => !s.isElective && isSubjectIncludedInTrack(s, trackSelection)
  );
}

/**
 * Returns elective subjects defined by the active plan.
 */
export function getElectiveSubjects(planOrSubjects: ActivePlanCatalog | Subject[]): Subject[] {
  return extractSubjects(planOrSubjects).filter((s) => Boolean(s.isElective));
}

/**
 * Evaluates a declarative special rule defined in `plan.rules`.
 */
export function evaluateSpecialRule(
  rule: PlanSpecialRule,
  subjects: Subject[],
  userState: UserCareerState,
  trackSelection: OptionalTrackSelection = false
): {
  satisfied: boolean;
  missingIds: number[];
} {
  if (rule.ruleType === 'approved_range') {
    const fromCode = typeof rule.params.fromCode === 'number' ? rule.params.fromCode : 0;
    const toCode = typeof rule.params.toCode === 'number' ? rule.params.toCode : 0;
    const rangeSubjects = subjects
      .filter(
        (s) =>
          !s.isElective &&
          s.id !== rule.subjectCode &&
          s.id >= fromCode &&
          s.id <= toCode
      )
      .sort((a, b) => a.id - b.id);

    const missingIds = rangeSubjects
      .filter((s) => !isApprovedOrHigher(userState[s.id]))
      .map((s) => s.id);

    return {
      satisfied: missingIds.length === 0,
      missingIds,
    };
  }

  if (rule.ruleType === 'all_previous_core_approved') {
    const excludeTrackKeys = Array.isArray(rule.params.excludeTrackKeys)
      ? rule.params.excludeTrackKeys.filter((k): k is string => typeof k === 'string')
      : [];

    const requiredSubjects = subjects.filter((s) => {
      if (s.isElective || s.id === rule.subjectCode) return false;
      if (!s.isOptionalTrack) return true;
      if (Array.isArray(trackSelection)) {
        return Boolean(s.trackKey && trackSelection.includes(s.trackKey));
      }
      if (trackSelection === true) return true;
      if (s.trackKey && excludeTrackKeys.includes(s.trackKey)) return false;
      return false;
    });

    const missingIds = requiredSubjects
      .filter((s) => !isApprovedOrHigher(userState[s.id]))
      .map((s) => s.id);

    return {
      satisfied: missingIds.length === 0,
      missingIds,
    };
  }

  return {
    satisfied: true,
    missingIds: [],
  };
}

/**
 * Evaluates whether a specific subject with a plan special rule can be rendered/approved.
 */
export function canRenderSpecialRuleSubject(
  subjectCode: number,
  userState: UserCareerState,
  plan: ActivePlanCatalog,
  trackSelection: OptionalTrackSelection = false
): {
  canRender: boolean;
  missingIds: number[];
} {
  const rule = plan.rules.find((r) => r.subjectCode === subjectCode);
  if (!rule) {
    return { canRender: true, missingIds: [] };
  }

  const res = evaluateSpecialRule(rule, plan.subjects, userState, trackSelection);
  return {
    canRender: res.satisfied,
    missingIds: res.missingIds,
  };
}

/**
 * Evaluates the intermediate degree's milestone subject special rule (e.g. Seminario Integrador) from plan metadata.
 */
export function canRenderSeminario(
  userState: UserCareerState,
  plan: ActivePlanCatalog
): {
  canRender: boolean;
  missingIds: number[];
} {
  const primaryDegree = plan.plan.config.intermediateDegrees[0];
  const rule =
    (primaryDegree?.specialRuleSubjectCode !== undefined
      ? plan.rules.find(
          (r) =>
            r.subjectCode === primaryDegree.specialRuleSubjectCode &&
            r.ruleType === 'approved_range'
        )
      : undefined) || plan.rules.find((r) => r.ruleType === 'approved_range');

  if (!rule) {
    return {
      canRender: false,
      missingIds: [],
    };
  }

  const res = evaluateSpecialRule(rule, plan.subjects, userState, false);
  return {
    canRender: res.satisfied,
    missingIds: res.missingIds,
  };
}

/**
 * Evaluates the plan's capstone ("all_previous_core_approved") special rule.
 */
export function canRenderProyectoFinal(
  userState: UserCareerState,
  plan: ActivePlanCatalog,
  includeAnalistaTrack: OptionalTrackSelection = false
): {
  canRender: boolean;
  missingIds: number[];
} {
  const rule = plan.rules.find((r) => r.ruleType === 'all_previous_core_approved');
  if (!rule) {
    return {
      canRender: false,
      missingIds: [],
    };
  }

  const res = evaluateSpecialRule(rule, plan.subjects, userState, includeAnalistaTrack);
  return {
    canRender: res.satisfied,
    missingIds: res.missingIds,
  };
}

/**
 * Evaluates PPS eligibility against the plan's `ppsRequirement.referenceSubjectCode`.
 * Plans with `ppsRequirement: null` do not have PPS enabled (`eligible: false`).
 */
export function isPPSEligible(
  userState: UserCareerState,
  plan: ActivePlanCatalog
): {
  eligible: boolean;
  missingRegular: number[];
  missingApproved: number[];
} {
  const referenceCode = plan.plan.config.ppsRequirement?.referenceSubjectCode;
  if (!referenceCode) {
    return { eligible: false, missingRegular: [], missingApproved: [] };
  }

  const refSubject =
    plan.subjects.find((s) => s.id === referenceCode && !s.isElective) ||
    plan.subjects.find((s) => s.id === referenceCode);
  if (!refSubject) {
    return { eligible: false, missingRegular: [], missingApproved: [] };
  }

  return checkEligibility(refSubject, userState);
}

/**
 * Evaluates whether the user satisfies the plan's primary intermediate degree requirements.
 */
export function checkAnalistaTitle(
  userState: UserCareerState,
  plan: ActivePlanCatalog,
  totalElectiveCreditsApproved?: number
): {
  eligible: boolean;
  missingCoreIds: number[];
  seminarioApproved: boolean;
  electiveCredits: number;
} {
  const electives = getElectiveSubjects(plan);
  let electiveCredits = 0;
  if (typeof totalElectiveCreditsApproved === 'number') {
    electiveCredits = totalElectiveCreditsApproved;
  } else {
    electives.forEach((e) => {
      if (isApprovedOrHigher(userState[e.id])) {
        electiveCredits += e.credits ?? 0;
      }
    });
  }

  const primaryDegree = plan.plan.config.intermediateDegrees[0];
  if (!primaryDegree) {
    return {
      eligible: false,
      missingCoreIds: [],
      seminarioApproved: false,
      electiveCredits,
    };
  }

  const requiredCredits = primaryDegree.requiredElectiveCredits ?? 0;
  const milestoneCode = primaryDegree.specialRuleSubjectCode;
  const milestoneExists =
    milestoneCode !== undefined && plan.subjects.some((s) => s.id === milestoneCode);
  const ownRangeRule =
    milestoneCode !== undefined
      ? plan.rules.find(
          (r) => r.subjectCode === milestoneCode && r.ruleType === 'approved_range'
        )
      : undefined;
  const rangeRule = ownRangeRule || plan.rules.find((r) => r.ruleType === 'approved_range');
  const hasEvaluableCriterion =
    (milestoneExists && Boolean(ownRangeRule)) || requiredCredits > 0;

  if (!hasEvaluableCriterion) {
    return {
      eligible: false,
      missingCoreIds: rangeRule
        ? evaluateSpecialRule(rangeRule, plan.subjects, userState, false).missingIds
        : [],
      seminarioApproved: false,
      electiveCredits,
    };
  }

  const missingCoreIds = rangeRule
    ? evaluateSpecialRule(rangeRule, plan.subjects, userState, false).missingIds
    : [];

  const seminarioApproved =
    milestoneCode !== undefined
      ? milestoneExists && isApprovedOrHigher(userState[milestoneCode])
      : true;

  const eligible =
    missingCoreIds.length === 0 && seminarioApproved && electiveCredits >= requiredCredits;

  return {
    eligible,
    missingCoreIds,
    seminarioApproved,
    electiveCredits,
  };
}

/**
 * Finds all subjects in the active catalog that depend directly on this subject.
 */
export function getUnlockedBySubject(subjectId: number, allSubjects: Subject[]) {
  const unlocksOnRegularize = allSubjects.filter((s) => s.regularPrereqs.includes(subjectId));
  const unlocksOnApprove = allSubjects.filter((s) => s.approvedPrereqs.includes(subjectId));

  return {
    unlocksOnRegularize,
    unlocksOnApprove,
    totalCount: new Set([...unlocksOnRegularize.map((s) => s.id), ...unlocksOnApprove.map((s) => s.id)]).size,
  };
}

/**
 * Simulates applying a hypothetical change and returns the IDs of newly unlocked core subjects
 */
export function getNewlyUnlockedOnStateChange(
  subjectId: number,
  newStatus: SubjectStatus,
  currentState: UserCareerState,
  coreSubjects: Subject[]
): number[] {
  const beforeAvailable = new Set<number>();
  coreSubjects.forEach((s) => {
    if (checkEligibility(s, currentState).eligible) {
      beforeAvailable.add(s.id);
    }
  });

  const nextState: UserCareerState = {
    ...currentState,
    [subjectId]: {
      ...currentState[subjectId],
      status: newStatus,
    },
  };

  const afterAvailable = new Set<number>();
  coreSubjects.forEach((s) => {
    if (checkEligibility(s, nextState).eligible) {
      afterAvailable.add(s.id);
    }
  });

  const newlyUnlocked: number[] = [];
  afterAvailable.forEach((id) => {
    if (!beforeAvailable.has(id) && id !== subjectId) {
      newlyUnlocked.push(id);
    }
  });

  return newlyUnlocked;
}

/**
 * Largest Remainder (Hamilton) method to round an array of numbers so their sum is strictly 100
 */
export function roundPercentagesStrict100(values: number[]): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum === 0) return values.map(() => 0);

  const normalized = values.map((v) => (v / sum) * 100);
  const floorValues = normalized.map(Math.floor);
  const remainder = Math.round(100 - floorValues.reduce((a, b) => a + b, 0));

  const diffs = normalized
    .map((val, idx) => ({ idx, diff: val - floorValues[idx] }))
    .sort((a, b) => b.diff - a.diff);

  for (let i = 0; i < remainder; i++) {
    floorValues[diffs[i % diffs.length].idx]++;
  }

  return floorValues;
}

export interface ProgressBreakdownParams {
  coreApproved: number;
  coreRegularized: number;
  coreTaking: number;
  corePending: number;
  totalCore: number;
  electiveCreditsApproved: number;
  electiveCreditsRegularized: number;
  electiveCreditsTaking: number;
  includeElectives: boolean;
  electiveSlotsEquivalent?: number;
  requiredElectiveCredits?: number;
}

export interface ProgressBreakdownResult {
  percentageApproved: number;
  percentageRegularized: number;
  percentageTaking: number;
  percentagePending: number;
  totalEquivalentSlots: number;
  approvedEquivalentSlots: number;
}

/**
 * Calculates the career progress breakdown across approved, regularized, taking and pending
 * Guaranteeing that percentageApproved + percentageRegularized + percentageTaking + percentagePending === 100
 */
export function calculateProgressBreakdown(params: ProgressBreakdownParams): ProgressBreakdownResult {
  const {
    coreApproved,
    coreRegularized,
    coreTaking,
    corePending,
    totalCore,
    electiveCreditsApproved,
    electiveCreditsRegularized,
    electiveCreditsTaking,
    includeElectives,
    electiveSlotsEquivalent = 0,
    requiredElectiveCredits = 0,
  } = params;

  if (!includeElectives || requiredElectiveCredits <= 0 || electiveSlotsEquivalent <= 0) {
    const rawValues = [coreApproved, coreRegularized, coreTaking, corePending];
    const [percentageApproved, percentageRegularized, percentageTaking, percentagePending] =
      roundPercentagesStrict100(rawValues);

    return {
      percentageApproved,
      percentageRegularized,
      percentageTaking,
      percentagePending,
      totalEquivalentSlots: totalCore,
      approvedEquivalentSlots: coreApproved,
    };
  }

  const crApr = Math.min(electiveCreditsApproved, requiredElectiveCredits);
  const crReg = Math.min(electiveCreditsRegularized, Math.max(0, requiredElectiveCredits - crApr));
  const crCur = Math.min(electiveCreditsTaking, Math.max(0, requiredElectiveCredits - crApr - crReg));
  const crPen = Math.max(0, requiredElectiveCredits - crApr - crReg - crCur);

  const slotsApr = (crApr / requiredElectiveCredits) * electiveSlotsEquivalent;
  const slotsReg = (crReg / requiredElectiveCredits) * electiveSlotsEquivalent;
  const slotsCur = (crCur / requiredElectiveCredits) * electiveSlotsEquivalent;
  const slotsPen = (crPen / requiredElectiveCredits) * electiveSlotsEquivalent;

  const totalEquivalentSlots = totalCore + electiveSlotsEquivalent;
  const approvedEquivalentSlots = coreApproved + slotsApr;
  const regularizedEquivalentSlots = coreRegularized + slotsReg;
  const takingEquivalentSlots = coreTaking + slotsCur;
  const pendingEquivalentSlots = corePending + slotsPen;

  const rawValues = [
    approvedEquivalentSlots,
    regularizedEquivalentSlots,
    takingEquivalentSlots,
    pendingEquivalentSlots,
  ];

  const [percentageApproved, percentageRegularized, percentageTaking, percentagePending] =
    roundPercentagesStrict100(rawValues);

  return {
    percentageApproved,
    percentageRegularized,
    percentageTaking,
    percentagePending,
    totalEquivalentSlots,
    approvedEquivalentSlots: Number(approvedEquivalentSlots.toFixed(2)),
  };
}

export interface PlanEvaluationSettings {
  minPassingGrade: number;
  includeAnalistaTrack: boolean;
  includeElectivesInProgress: boolean;
  includeFailsInGPA?: boolean;
}

export interface PlanEvaluationResult {
  progress: CareerProgress;
  coreStatuses: Record<string, SubjectStatus>;
  electiveStatuses: Record<string, SubjectStatus>;
  availableCoreIds: number[];
  availableElectiveIds: number[];
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
}

/**
 * Evaluates full career progress, statuses, milestones and special rules for any active plan catalog.
 */
export function evaluatePlanProgress(params: {
  plan: ActivePlanCatalog;
  userState: UserCareerState;
  settings: PlanEvaluationSettings;
  examAttempts: ExamAttempt[];
}): PlanEvaluationResult {
  const { plan, userState, settings, examAttempts } = params;
  const activeCoreSubjects = getActiveCoreSubjects(plan, settings.includeAnalistaTrack);
  const electives = getElectiveSubjects(plan);
  const requiredElectiveCredits = plan.plan.config.requiredElectiveCredits;
  const electiveSlotsEquivalent = plan.plan.config.electiveSlotsEquivalent;

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
    const status = getSubjectStatus(subject, userState);
    coreStatuses[String(subject.id)] = status;
    if (status === 'disponible') {
      availableCoreIds.push(subject.id);
    }

    const st = userState[subject.id];
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

  electives.forEach((el) => {
    const computedStatus = getSubjectStatus(el, userState);
    electiveStatuses[String(el.id)] = computedStatus;
    if (computedStatus === 'disponible') {
      availableElectiveIds.push(el.id);
    }

    const credits = el.credits ?? 0;
    const st = userState[el.id];
    if (isApprovedOrHigher(st)) {
      totalElectiveCreditsApproved += credits;
      if (st?.grade !== undefined && st.grade >= settings.minPassingGrade) {
        gradesToAverage.push(st.grade);
      }
    } else if (st?.status === 'regularizada') {
      totalElectiveCreditsRegularized += credits;
    } else if (st?.status === 'cursando') {
      totalElectiveCreditsTaking += credits;
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
    electiveSlotsEquivalent,
    requiredElectiveCredits,
  });

  const careerPercentageBySubjects = breakdown.percentageApproved;
  const careerPercentageByHours =
    totalWeeklyHours > 0 ? Math.round((approvedWeeklyHours / totalWeeklyHours) * 100) : 0;

  const failGrades = examAttempts
    .filter((att) => !att.isPassed || att.grade < settings.minPassingGrade)
    .map((att) => att.grade);

  const allGradesWithFails = [...gradesToAverage, ...failGrades];

  const averageGradeWithoutFails =
    gradesToAverage.length > 0
      ? Number((gradesToAverage.reduce((a, b) => a + b, 0) / gradesToAverage.length).toFixed(2))
      : 0;

  const averageGradeWithFails =
    allGradesWithFails.length > 0
      ? Number((allGradesWithFails.reduce((a, b) => a + b, 0) / allGradesWithFails.length).toFixed(2))
      : averageGradeWithoutFails;

  const averageGrade = settings.includeFailsInGPA ? averageGradeWithFails : averageGradeWithoutFails;

  const missingElectiveCreditsForDegree = Math.max(
    0,
    requiredElectiveCredits - totalElectiveCreditsApproved
  );
  const missingCoreForDegree = activeCoreSubjects
    .filter((s) => !isApprovedOrHigher(userState[s.id]))
    .map((s) => s.id);

  const seminario = canRenderSeminario(userState, plan);
  const proyectoFinal = canRenderProyectoFinal(userState, plan, settings.includeAnalistaTrack);
  const analista = checkAnalistaTitle(userState, plan, totalElectiveCreditsApproved);
  const pps = isPPSEligible(userState, plan);

  const isDegreeEligible =
    missingCoreForDegree.length === 0 && totalElectiveCreditsApproved >= requiredElectiveCredits;

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
    totalElectiveCreditsRequired: requiredElectiveCredits,
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

  return {
    progress,
    coreStatuses,
    electiveStatuses,
    availableCoreIds,
    availableElectiveIds,
    seminario,
    proyectoFinal,
    analista,
    pps,
  };
}
