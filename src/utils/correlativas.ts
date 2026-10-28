import type { Subject, SubjectStatus, UserCareerState, UserSubjectState } from '../types/career';
import { CORE_SUBJECTS } from '../data/plan2023';
import { ELECTIVES } from '../data/electives';

export const ALL_SUBJECTS_MAP = new Map<number, Subject>();
CORE_SUBJECTS.forEach((s) => ALL_SUBJECTS_MAP.set(s.id, s));
ELECTIVES.forEach((s) => ALL_SUBJECTS_MAP.set(s.id, s));

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
 * Special rule check for Seminario Integrador (ID 99):
 * Can only be rendered/approved if all subjects from 1 to 23 are approved
 */
export function canRenderSeminario(userState: UserCareerState): {
  canRender: boolean;
  missingIds: number[];
} {
  const ids1to23 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
  const missingIds = ids1to23.filter((id) => !isApprovedOrHigher(userState[id]));
  return {
    canRender: missingIds.length === 0,
    missingIds,
  };
}

/**
 * Special rule check for Proyecto Final (ID 36):
 * Can only be rendered/approved if all previous plan subjects are approved.
 * If includeAnalistaTrack is false, Seminario Integrador (ID 99) is excluded from this requirement.
 */
export function canRenderProyectoFinal(
  userState: UserCareerState,
  includeAnalistaTrack = false
): {
  canRender: boolean;
  missingIds: number[];
} {
  const coreIds = CORE_SUBJECTS
    .map((s) => s.id)
    .filter((id) => id !== 36 && (includeAnalistaTrack || id !== 99));
  const missingIds = coreIds.filter((id) => !isApprovedOrHigher(userState[id]));
  return {
    canRender: missingIds.length === 0,
    missingIds,
  };
}

/**
 * Práctica Profesional Supervisada (PPS):
 * Requires meeting enrollment requirements for Proyecto Final (reg: 25, 26, 30; apr: 12, 20, 23)
 */
export function isPPSEligible(userState: UserCareerState): {
  eligible: boolean;
  missingRegular: number[];
  missingApproved: number[];
} {
  const pf = CORE_SUBJECTS.find((s) => s.id === 36);
  if (!pf) return { eligible: false, missingRegular: [], missingApproved: [] };
  return checkEligibility(pf, userState);
}

/**
 * Check if user fulfills all requirements for "Analista Desarrollador Universitario":
 * - Subjects 1 to 23 approved
 * - Seminario Integrador 99 approved
 * - At least 4 credits of electives approved (any level)
 */
export function checkAnalistaTitle(
  userState: UserCareerState,
  totalElectiveCreditsApproved?: number
): {
  eligible: boolean;
  missingCoreIds: number[];
  seminarioApproved: boolean;
  electiveCredits: number;
} {
  const ids1to23 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
  const missingCoreIds = ids1to23.filter((id) => !isApprovedOrHigher(userState[id]));
  const seminarioApproved = isApprovedOrHigher(userState[99]);

  let electiveCredits = 0;
  if (typeof totalElectiveCreditsApproved === 'number') {
    electiveCredits = totalElectiveCreditsApproved;
  } else {
    ELECTIVES.forEach((e) => {
      if (isApprovedOrHigher(userState[e.id])) {
        electiveCredits += e.credits;
      }
    });
  }

  const eligible = missingCoreIds.length === 0 && seminarioApproved && electiveCredits >= 4;
  return {
    eligible,
    missingCoreIds,
    seminarioApproved,
    electiveCredits,
  };
}

/**
 * Finds all subjects that depend on this subject:
 * - directly or indirectly
 * - split by whether it unlocks upon regularizing or upon approving
 */
export function getUnlockedBySubject(subjectId: number) {
  const all = [...CORE_SUBJECTS, ...ELECTIVES];

  const unlocksOnRegularize = all.filter((s) => s.regularPrereqs.includes(subjectId));
  const unlocksOnApprove = all.filter((s) => s.approvedPrereqs.includes(subjectId));

  return {
    unlocksOnRegularize,
    unlocksOnApprove,
    totalCount: new Set([...unlocksOnRegularize.map((s) => s.id), ...unlocksOnApprove.map((s) => s.id)]).size,
  };
}

/**
 * Simulates applying a hypothetical change and returns the IDs of newly unlocked subjects
 */
export function getNewlyUnlockedOnStateChange(
  subjectId: number,
  newStatus: SubjectStatus,
  currentState: UserCareerState
): number[] {
  // Compute currently available IDs
  const beforeAvailable = new Set<number>();
  CORE_SUBJECTS.forEach((s) => {
    if (checkEligibility(s, currentState).eligible) {
      beforeAvailable.add(s.id);
    }
  });

  // Hypothetical state
  const nextState: UserCareerState = {
    ...currentState,
    [subjectId]: {
      ...currentState[subjectId],
      status: newStatus,
    },
  };

  const afterAvailable = new Set<number>();
  CORE_SUBJECTS.forEach((s) => {
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
  electiveSlotsEquivalent?: number; // defaults to 7
  requiredElectiveCredits?: number; // defaults to 20
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
    electiveSlotsEquivalent = 7,
    requiredElectiveCredits = 20,
  } = params;

  if (!includeElectives) {
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

  // With electives: electives contribute up to requiredElectiveCredits (20), scaled to electiveSlotsEquivalent (7)
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
