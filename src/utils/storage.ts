import type {
  ActivePlanCatalog,
  AssignedElectivesByYear,
  ExamAttempt,
  Subject,
  UserCareerState,
} from '../types/career';
import type { ScheduleDraft, SubjectSchedule } from '../types/schedule';
import type { SubjectEnrollment } from '../types/enrollment';

export const STORAGE_KEY_STATE = 'mi_carrera_user_state_v1';
export const STORAGE_KEY_ASSIGNED_ELECTIVES = 'mi_carrera_assigned_electives_v2';
export const STORAGE_KEY_OLD_SLOTS = 'mi_carrera_electives_slots_v1';
export const STORAGE_KEY_BASKET = 'mi_carrera_semester_basket_v1';
export const STORAGE_KEY_SETTINGS = 'mi_carrera_settings_v1';
export const STORAGE_KEY_TUTORIAL = 'mi_carrera_tutorial_completed_v1';
export const STORAGE_KEY_SCHEDULE_SELECTIONS = 'mi_carrera_schedule_selections_v1';
export const STORAGE_KEY_SCHEDULE_DRAFTS = 'mi_carrera_schedule_drafts_v1';
export const STORAGE_KEY_CUSTOM_SCHEDULES = 'mi_carrera_custom_schedules_v1';
export const STORAGE_KEY_SCHEDULE_TERM = 'mi_carrera_schedule_term_v1';
export const STORAGE_KEY_ENROLLMENTS = 'mi_carrera_enrollments_v1';
export const STORAGE_KEY_EXAM_ATTEMPTS = 'mi_carrera_exam_attempts_v1';
export const STORAGE_KEY_LEGACY_MIGRATED_PREFIX = 'mi_carrera_legacy_migrated_v1';
export const STORAGE_KEY_LEGACY_PLAN_ID = 'mi_carrera_legacy_plan_id_v1';

const PLAN_SCOPED_LEGACY_KEYS = [
  STORAGE_KEY_STATE,
  STORAGE_KEY_ASSIGNED_ELECTIVES,
  STORAGE_KEY_BASKET,
  STORAGE_KEY_SETTINGS,
  STORAGE_KEY_TUTORIAL,
  STORAGE_KEY_SCHEDULE_SELECTIONS,
  STORAGE_KEY_SCHEDULE_DRAFTS,
  STORAGE_KEY_CUSTOM_SCHEDULES,
  STORAGE_KEY_SCHEDULE_TERM,
  STORAGE_KEY_ENROLLMENTS,
  STORAGE_KEY_EXAM_ATTEMPTS,
];

export interface AppSettings {
  includePromotionsInGPA: boolean;
  minPassingGrade: number;
  includeAnalistaTrack: boolean; // Default false
  allowBlockedElectivesPlanning: boolean; // Default false
  includeElectivesInProgress: boolean; // Default true
  tutorialCompleted: boolean; // Default false
  notifyLibraryEmail?: boolean; // Default true
  includeFailsInGPA?: boolean; // Default false
}

export const DEFAULT_SETTINGS: AppSettings = {
  includePromotionsInGPA: true,
  minPassingGrade: 4,
  includeAnalistaTrack: false,
  allowBlockedElectivesPlanning: false,
  includeElectivesInProgress: true,
  tutorialCompleted: false,
  notifyLibraryEmail: true,
  includeFailsInGPA: false,
};

export function getPlanStorageKey(baseKey: string, planId?: string | null): string {
  if (!planId || planId === 'current') return baseKey;
  return `${baseKey}::plan:${planId}`;
}

export function buildEmptyAssignedElectives(totalLevels: number = 5): AssignedElectivesByYear {
  const safeLevels = Math.max(1, Math.floor(totalLevels));
  const res: AssignedElectivesByYear = {};
  for (let lvl = 1; lvl <= safeLevels; lvl++) {
    res[lvl] = [];
  }
  return res;
}

export const INITIAL_ASSIGNED_ELECTIVES: AssignedElectivesByYear = buildEmptyAssignedElectives(5);

function hasNonEmptyParsedValue(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.length > 0;
    if (parsed && typeof parsed === 'object') {
      return Object.values(parsed as Record<string, unknown>).some((v) =>
        Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined
      );
    }
    return Boolean(parsed);
  } catch {
    return raw.trim().length > 0;
  }
}

/**
 * Returns true if unscoped legacy localStorage keys contain saved data that has not been
 * migrated into a plan-scoped namespace yet.
 */
export function hasUnmigratedLegacyLocalStorage(
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage !== 'undefined'
    ? localStorage
    : undefined
): boolean {
  if (!storage) return false;
  if (storage.getItem(STORAGE_KEY_LEGACY_MIGRATED_PREFIX) !== null) {
    return false;
  }

  return [
    STORAGE_KEY_STATE,
    STORAGE_KEY_ASSIGNED_ELECTIVES,
    STORAGE_KEY_BASKET,
    STORAGE_KEY_SCHEDULE_SELECTIONS,
    STORAGE_KEY_SCHEDULE_DRAFTS,
    STORAGE_KEY_CUSTOM_SCHEDULES,
    STORAGE_KEY_ENROLLMENTS,
    STORAGE_KEY_EXAM_ATTEMPTS,
  ].some((key) => hasNonEmptyParsedValue(storage.getItem(key)));
}

/**
 * Idempotent copy-not-delete migration of legacy pre-multicarrera localStorage keys
 * into plan-scoped keys for the given `planId`. Never deletes the original legacy keys.
 *
 * Automatic migration (`!options?.force`) is ONLY safe when `STORAGE_KEY_LEGACY_PLAN_ID`
 * explicitly proves the unscoped keys belong to `planId`. Otherwise it returns `migrated: false`
 * without copying so unscoped data (e.g. Sistemas) is never blindly injected into another plan.
 */
export function migrateLegacyLocalStorageToPlan(
  planId: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof localStorage !== 'undefined'
    ? localStorage
    : undefined,
  options?: { force?: boolean }
): { migrated: boolean; copiedKeys: string[] } {
  if (!storage || !planId || planId === 'current') {
    return { migrated: false, copiedKeys: [] };
  }

  const doneKey = getPlanStorageKey(STORAGE_KEY_LEGACY_MIGRATED_PREFIX, planId);
  if (
    storage.getItem(STORAGE_KEY_LEGACY_MIGRATED_PREFIX) !== null ||
    storage.getItem(doneKey) === 'true'
  ) {
    return { migrated: false, copiedKeys: [] };
  }

  if (!options?.force) {
    const recordedLegacyPlanId = storage.getItem(STORAGE_KEY_LEGACY_PLAN_ID);
    if (!recordedLegacyPlanId || recordedLegacyPlanId !== planId) {
      return { migrated: false, copiedKeys: [] };
    }
  }

  const copiedKeys: string[] = [];
  for (const baseKey of PLAN_SCOPED_LEGACY_KEYS) {
    const scopedKey = getPlanStorageKey(baseKey, planId);
    const existingScoped = storage.getItem(scopedKey);
    const legacyVal = storage.getItem(baseKey);
    if (existingScoped === null && legacyVal !== null) {
      storage.setItem(scopedKey, legacyVal);
      copiedKeys.push(baseKey);
    }
  }

  storage.setItem(doneKey, 'true');
  storage.setItem(STORAGE_KEY_LEGACY_MIGRATED_PREFIX, planId);
  return {
    migrated: copiedKeys.length > 0,
    copiedKeys,
  };
}

/**
 * Sanitizes and deduplicates assigned electives across all plan levels.
 * Ensures no elective ID exists in more than one level.
 */
export function sanitizeAssignedElectives(
  raw: Record<number, number[]>,
  validElectiveIds?: Set<number> | number[],
  totalLevels: number = 5
): AssignedElectivesByYear {
  const safeLevels = Math.max(1, Math.floor(totalLevels));
  const result = buildEmptyAssignedElectives(safeLevels);
  const seenElectiveIds = new Set<number>();

  const validSet = validElectiveIds
    ? validElectiveIds instanceof Set
      ? validElectiveIds
      : new Set(validElectiveIds)
    : null;

  for (let level = 1; level <= safeLevels; level++) {
    const list = Array.isArray(raw?.[level]) ? raw[level] : [];
    list.forEach((id) => {
      const numId = Number(id);
      const isValid = validSet ? validSet.has(numId) : Number.isInteger(numId) && numId > 0;
      if (isValid && !seenElectiveIds.has(numId)) {
        seenElectiveIds.add(numId);
        result[level].push(numId);
      }
    });
  }

  return result;
}

export function loadUserState(planId?: string | null): UserCareerState {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(getPlanStorageKey(STORAGE_KEY_STATE, planId));
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.error('Error loading state from localStorage:', e);
    return {};
  }
}

export function saveUserState(state: UserCareerState, planId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(getPlanStorageKey(STORAGE_KEY_STATE, planId), JSON.stringify(state));
  } catch (e) {
    console.error('Error saving state to localStorage:', e);
  }
}

export interface ElectiveStorageOptions {
  electives?: Subject[];
  validElectiveIds?: Set<number> | number[];
  totalLevels?: number;
  planId?: string | null;
}

export function loadAssignedElectives(
  userState?: UserCareerState,
  options: ElectiveStorageOptions = {}
): AssignedElectivesByYear {
  const totalLevels = options.totalLevels ?? 5;
  const validIds =
    options.validElectiveIds ??
    (options.electives ? options.electives.map((e) => e.id) : undefined);

  if (typeof localStorage === 'undefined') {
    return migrateLegacyElectives(userState || {}, options.electives || [], totalLevels, options.planId);
  }

  try {
    const raw = localStorage.getItem(getPlanStorageKey(STORAGE_KEY_ASSIGNED_ELECTIVES, options.planId));
    if (raw) {
      const parsed = JSON.parse(raw);
      return sanitizeAssignedElectives(parsed, validIds, totalLevels);
    }

    return migrateLegacyElectives(
      userState || loadUserState(options.planId),
      options.electives || [],
      totalLevels,
      options.planId
    );
  } catch (e) {
    console.error('Error loading assigned electives:', e);
    return buildEmptyAssignedElectives(totalLevels);
  }
}

/**
 * Migrates electives from legacy slots or active userState
 * Automatically places any configured/marked elective in the level corresponding to its suggested level
 */
export function migrateLegacyElectives(
  userState: UserCareerState,
  electives: Subject[] = [],
  totalLevels: number = 5,
  planId?: string | null
): AssignedElectivesByYear {
  const safeLevels = Math.max(1, Math.floor(totalLevels));
  const result = buildEmptyAssignedElectives(safeLevels);
  const seenIds = new Set<number>();

  if (typeof localStorage !== 'undefined' && electives.length > 0) {
    try {
      const oldSlotsRaw = localStorage.getItem(STORAGE_KEY_OLD_SLOTS);
      if (oldSlotsRaw) {
        const oldSlots = JSON.parse(oldSlotsRaw);
        if (Array.isArray(oldSlots)) {
          oldSlots.forEach((slot: { level?: number; selectedElectiveId?: string | number }) => {
            if (slot.selectedElectiveId) {
              const numId = Number(slot.selectedElectiveId);
              const found = electives.find((e) => e.id === numId);
              if (found && !seenIds.has(numId)) {
                const rawTarget =
                  slot.level && slot.level >= 1 && slot.level <= safeLevels
                    ? slot.level
                    : found.level;
                const targetYear = Math.min(safeLevels, Math.max(1, rawTarget));
                seenIds.add(numId);
                result[targetYear].push(numId);
              }
            }
          });
        }
      }
    } catch {
      // Ignore legacy read errors
    }
  }

  electives.forEach((e) => {
    const st = userState[e.id];
    if (st && st.status && st.status !== 'bloqueada' && st.status !== 'disponible') {
      if (!seenIds.has(e.id)) {
        seenIds.add(e.id);
        const targetYear = Math.min(safeLevels, Math.max(1, e.level));
        result[targetYear].push(e.id);
      }
    }
  });

  if (electives.length > 0) {
    saveAssignedElectives(result, {
      validElectiveIds: electives.map((e) => e.id),
      totalLevels: safeLevels,
      planId,
    });
  }
  return result;
}

export function saveAssignedElectives(
  data: AssignedElectivesByYear,
  options: ElectiveStorageOptions = {}
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const totalLevels = options.totalLevels ?? 5;
    const validIds =
      options.validElectiveIds ??
      (options.electives ? options.electives.map((e) => e.id) : undefined);
    const sanitized = sanitizeAssignedElectives(data, validIds, totalLevels);
    localStorage.setItem(
      getPlanStorageKey(STORAGE_KEY_ASSIGNED_ELECTIVES, options.planId),
      JSON.stringify(sanitized)
    );
  } catch (e) {
    console.error('Error saving assigned electives:', e);
  }
}

export function loadBasket(planId?: string | null): number[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getPlanStorageKey(STORAGE_KEY_BASKET, planId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveBasket(basket: number[], planId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(getPlanStorageKey(STORAGE_KEY_BASKET, planId), JSON.stringify(basket));
  } catch (e) {
    console.error('Error saving basket:', e);
  }
}

export function loadSettings(planId?: string | null): AppSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(getPlanStorageKey(STORAGE_KEY_SETTINGS, planId));
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      includeAnalistaTrack: parsed.includeAnalistaTrack ?? false,
      allowBlockedElectivesPlanning: parsed.allowBlockedElectivesPlanning ?? false,
      includeElectivesInProgress: parsed.includeElectivesInProgress ?? true,
      tutorialCompleted: parsed.tutorialCompleted ?? false,
      notifyLibraryEmail: parsed.notifyLibraryEmail ?? true,
      includeFailsInGPA: parsed.includeFailsInGPA ?? false,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Checks whether the tutorial should start automatically.
 */
export function shouldAutoStartTutorial(
  userState?: UserCareerState,
  planId?: string | null
): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    const rawTut = localStorage.getItem(getPlanStorageKey(STORAGE_KEY_TUTORIAL, planId));
    if (rawTut === 'true') return false;

    const settings = loadSettings(planId);
    if (settings.tutorialCompleted) return false;

    const activeState = userState || loadUserState(planId);
    const hasExistingData = Object.keys(activeState).length > 0;
    if (hasExistingData) {
      markTutorialCompleted(planId);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function markTutorialCompleted(planId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(getPlanStorageKey(STORAGE_KEY_TUTORIAL, planId), 'true');
    const settings = loadSettings(planId);
    saveSettings({ ...settings, tutorialCompleted: true }, planId);
  } catch (e) {
    console.error('Error marking tutorial completed:', e);
  }
}

export function resetTutorialState(planId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(getPlanStorageKey(STORAGE_KEY_TUTORIAL, planId));
    const settings = loadSettings(planId);
    saveSettings({ ...settings, tutorialCompleted: false }, planId);
  } catch (e) {
    console.error('Error resetting tutorial state:', e);
  }
}

export function saveSettings(settings: AppSettings, planId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(getPlanStorageKey(STORAGE_KEY_SETTINGS, planId), JSON.stringify(settings));
  } catch (e) {
    console.error('Error saving settings:', e);
  }
}

export function loadScheduleSelections(planId?: string | null): Record<number, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(getPlanStorageKey(STORAGE_KEY_SCHEDULE_SELECTIONS, planId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveScheduleSelections(
  selections: Record<number, string>,
  planId?: string | null
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      getPlanStorageKey(STORAGE_KEY_SCHEDULE_SELECTIONS, planId),
      JSON.stringify(selections)
    );
  } catch (e) {
    console.error('Error saving schedule selections:', e);
  }
}

export function loadScheduleDrafts(planId?: string | null): ScheduleDraft[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getPlanStorageKey(STORAGE_KEY_SCHEDULE_DRAFTS, planId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveScheduleDrafts(drafts: ScheduleDraft[], planId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      getPlanStorageKey(STORAGE_KEY_SCHEDULE_DRAFTS, planId),
      JSON.stringify(drafts)
    );
  } catch (e) {
    console.error('Error saving schedule drafts:', e);
  }
}

export function loadCustomSchedules(planId?: string | null): SubjectSchedule[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(getPlanStorageKey(STORAGE_KEY_CUSTOM_SCHEDULES, planId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCustomSchedules(
  schedules: SubjectSchedule[],
  planId?: string | null
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      getPlanStorageKey(STORAGE_KEY_CUSTOM_SCHEDULES, planId),
      JSON.stringify(schedules)
    );
  } catch (e) {
    console.error('Error saving custom schedules:', e);
  }
}

export function clearCustomSchedules(planId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(getPlanStorageKey(STORAGE_KEY_CUSTOM_SCHEDULES, planId));
  } catch (e) {
    console.error('Error clearing custom schedules:', e);
  }
}

export function loadScheduleTerm(planId?: string | null): '1C' | '2C' {
  if (typeof localStorage === 'undefined') return '1C';
  try {
    const raw = localStorage.getItem(getPlanStorageKey(STORAGE_KEY_SCHEDULE_TERM, planId));
    return raw === '2C' ? '2C' : '1C';
  } catch {
    return '1C';
  }
}

export function saveScheduleTerm(term: '1C' | '2C', planId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(getPlanStorageKey(STORAGE_KEY_SCHEDULE_TERM, planId), term);
  } catch (e) {
    console.error('Error saving schedule term:', e);
  }
}

export function loadEnrollments(planId?: string | null): SubjectEnrollment[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getPlanStorageKey(STORAGE_KEY_ENROLLMENTS, planId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadExamAttempts(planId?: string | null): ExamAttempt[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getPlanStorageKey(STORAGE_KEY_EXAM_ATTEMPTS, planId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveExamAttempts(attempts: ExamAttempt[], planId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      getPlanStorageKey(STORAGE_KEY_EXAM_ATTEMPTS, planId),
      JSON.stringify(attempts)
    );
  } catch (e) {
    console.error('Error saving exam attempts:', e);
  }
}

export function saveEnrollments(
  enrollments: SubjectEnrollment[],
  planId?: string | null
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      getPlanStorageKey(STORAGE_KEY_ENROLLMENTS, planId),
      JSON.stringify(enrollments)
    );
  } catch (e) {
    console.error('Error saving enrollments:', e);
  }
}

export function exportCareerToJson(
  userState: UserCareerState,
  settings: AppSettings,
  basket: number[],
  assignedElectives: AssignedElectivesByYear,
  extra?: {
    scheduleDrafts?: ScheduleDraft[];
    scheduleSelections?: Record<number, string>;
    customSchedules?: SubjectSchedule[];
    scheduleTerm?: '1C' | '2C';
    enrollments?: SubjectEnrollment[];
    examAttempts?: ExamAttempt[];
    planId?: string | null;
    planTag?: string;
  }
): string {
  const planId = extra?.planId;
  const exportPayload = {
    version: '2.2',
    exportDate: new Date().toISOString(),
    planId: planId ?? undefined,
    plan: extra?.planTag || 'Stack Plan',
    userState,
    settings,
    basket,
    assignedElectives,
    scheduleDrafts: extra?.scheduleDrafts || loadScheduleDrafts(planId),
    scheduleSelections: extra?.scheduleSelections || loadScheduleSelections(planId),
    customSchedules: extra?.customSchedules || loadCustomSchedules(planId),
    scheduleTerm: extra?.scheduleTerm || loadScheduleTerm(planId),
    enrollments: extra?.enrollments || loadEnrollments(planId),
    examAttempts: extra?.examAttempts || loadExamAttempts(planId),
  };
  return JSON.stringify(exportPayload, null, 2);
}

export function importCareerFromJson(
  jsonString: string,
  options: ElectiveStorageOptions = {}
): {
  success: boolean;
  userState?: UserCareerState;
  settings?: AppSettings;
  basket?: number[];
  assignedElectives?: AssignedElectivesByYear;
  scheduleDrafts?: ScheduleDraft[];
  scheduleSelections?: Record<number, string>;
  customSchedules?: SubjectSchedule[];
  scheduleTerm?: '1C' | '2C';
  enrollments?: SubjectEnrollment[];
  examAttempts?: ExamAttempt[];
  error?: string;
} {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object') {
      return { success: false, error: 'Formato de archivo inválido.' };
    }

    const totalLevels = options.totalLevels ?? 5;
    const validIds =
      options.validElectiveIds ??
      (options.electives ? options.electives.map((e) => e.id) : undefined);

    const userState = parsed.userState || {};
    const settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
    const basket = Array.isArray(parsed.basket) ? parsed.basket : [];
    const assignedElectives = parsed.assignedElectives
      ? sanitizeAssignedElectives(parsed.assignedElectives, validIds, totalLevels)
      : migrateLegacyElectives(userState, options.electives || [], totalLevels, options.planId);

    const scheduleDrafts = Array.isArray(parsed.scheduleDrafts) ? parsed.scheduleDrafts : [];
    const scheduleSelections =
      parsed.scheduleSelections && typeof parsed.scheduleSelections === 'object'
        ? parsed.scheduleSelections
        : {};
    const customSchedules = Array.isArray(parsed.customSchedules) ? parsed.customSchedules : null;
    const scheduleTerm = parsed.scheduleTerm === '2C' ? '2C' : '1C';
    const enrollments = Array.isArray(parsed.enrollments) ? parsed.enrollments : undefined;
    const examAttempts = Array.isArray(parsed.examAttempts) ? parsed.examAttempts : undefined;

    const planId = options.planId;
    saveUserState(userState, planId);
    saveSettings(settings, planId);
    saveBasket(basket, planId);
    saveAssignedElectives(assignedElectives, { validElectiveIds: validIds, totalLevels, planId });
    saveScheduleDrafts(scheduleDrafts, planId);
    saveScheduleSelections(scheduleSelections, planId);
    if (customSchedules) {
      saveCustomSchedules(customSchedules, planId);
    }
    saveScheduleTerm(scheduleTerm, planId);
    if (enrollments) {
      saveEnrollments(enrollments, planId);
    }
    if (examAttempts) {
      saveExamAttempts(examAttempts, planId);
    }

    return {
      success: true,
      userState,
      settings,
      basket,
      assignedElectives,
      scheduleDrafts,
      scheduleSelections,
      customSchedules: customSchedules || undefined,
      scheduleTerm,
      enrollments,
      examAttempts,
    };
  } catch {
    return { success: false, error: 'El archivo JSON está corrupto o mal formado.' };
  }
}

export function clearCareerData(planId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(getPlanStorageKey(STORAGE_KEY_STATE, planId));
  localStorage.removeItem(getPlanStorageKey(STORAGE_KEY_ASSIGNED_ELECTIVES, planId));
  localStorage.removeItem(getPlanStorageKey(STORAGE_KEY_OLD_SLOTS, planId));
  localStorage.removeItem(getPlanStorageKey(STORAGE_KEY_BASKET, planId));
  localStorage.removeItem(getPlanStorageKey(STORAGE_KEY_SCHEDULE_SELECTIONS, planId));
  localStorage.removeItem(getPlanStorageKey(STORAGE_KEY_SCHEDULE_DRAFTS, planId));
  localStorage.removeItem(getPlanStorageKey(STORAGE_KEY_CUSTOM_SCHEDULES, planId));
  localStorage.removeItem(getPlanStorageKey(STORAGE_KEY_SCHEDULE_TERM, planId));
  localStorage.removeItem(getPlanStorageKey(STORAGE_KEY_ENROLLMENTS, planId));
  localStorage.removeItem(getPlanStorageKey(STORAGE_KEY_EXAM_ATTEMPTS, planId));
}

/**
 * Generates a dynamic sample academic progress state from the active plan catalog
 * (without hardcoding specific subject codes).
 */
export function getSampleStudentForPlan(plan?: ActivePlanCatalog | null): {
  userState: UserCareerState;
  assignedElectives: AssignedElectivesByYear;
} {
  const totalLevels = plan?.plan.config.totalLevels ?? 5;
  const assignedElectives = buildEmptyAssignedElectives(totalLevels);
  if (!plan) {
    return { userState: {}, assignedElectives };
  }

  const userState: UserCareerState = {};
  const coreSubjects = plan.subjects.filter((s) => !s.isElective && !s.isOptionalTrack);
  const electives = plan.subjects.filter((s) => Boolean(s.isElective));

  coreSubjects.forEach((subj, idx) => {
    if (subj.level === 1) {
      userState[subj.id] = {
        status: idx % 3 === 0 ? 'aprobada' : 'promocionada',
        grade: idx % 3 === 0 ? 8 : 9,
      };
    } else if (subj.level === 2) {
      if (idx % 4 === 0) {
        userState[subj.id] = { status: 'regularizada' };
      } else if (idx % 4 === 1) {
        userState[subj.id] = { status: 'cursando' };
      } else {
        userState[subj.id] = { status: 'aprobada', grade: 8 };
      }
    } else if (subj.level === 3 && idx % 3 === 0) {
      userState[subj.id] = { status: 'cursando' };
    }
  });

  if (electives.length > 0) {
    const first = electives[0];
    userState[first.id] = { status: 'aprobada', grade: 9 };
    const lvl1 = Math.min(totalLevels, Math.max(1, first.level));
    assignedElectives[lvl1].push(first.id);
  }
  if (electives.length > 1) {
    const second = electives[1];
    userState[second.id] = { status: 'cursando' };
    const lvl2 = Math.min(totalLevels, Math.max(1, second.level));
    assignedElectives[lvl2].push(second.id);
  }

  return { userState, assignedElectives };
}
