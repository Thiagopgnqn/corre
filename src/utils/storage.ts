import type { UserCareerState, AssignedElectivesByYear } from '../types/career';
import { ELECTIVES } from '../data/electives';

const STORAGE_KEY_STATE = 'mi_carrera_user_state_v1';
const STORAGE_KEY_ASSIGNED_ELECTIVES = 'mi_carrera_assigned_electives_v2';
const STORAGE_KEY_OLD_SLOTS = 'mi_carrera_electives_slots_v1';
const STORAGE_KEY_BASKET = 'mi_carrera_semester_basket_v1';
const STORAGE_KEY_SETTINGS = 'mi_carrera_settings_v1';
export const STORAGE_KEY_TUTORIAL = 'mi_carrera_tutorial_completed_v1';

export interface AppSettings {
  includePromotionsInGPA: boolean;
  minPassingGrade: number;
  includeAnalistaTrack: boolean; // Default false
  allowBlockedElectivesPlanning: boolean; // Default false
  includeElectivesInProgress: boolean; // Default true
  tutorialCompleted: boolean; // Default false
}

export const DEFAULT_SETTINGS: AppSettings = {
  includePromotionsInGPA: true,
  minPassingGrade: 4,
  includeAnalistaTrack: false,
  allowBlockedElectivesPlanning: false,
  includeElectivesInProgress: true,
  tutorialCompleted: false,
};

export const INITIAL_ASSIGNED_ELECTIVES: AssignedElectivesByYear = {
  1: [],
  2: [],
  3: [],
  4: [],
  5: [],
};

/**
 * Sanitizes and deduplicates assigned electives across all years
 * Ensures no elective ID exists in more than one year
 */
export function sanitizeAssignedElectives(raw: Record<number, number[]>): AssignedElectivesByYear {
  const result: AssignedElectivesByYear = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  const seenElectiveIds = new Set<number>();

  const validElectiveIds = new Set(ELECTIVES.map((e) => e.id));

  [1, 2, 3, 4, 5].forEach((year) => {
    const list = Array.isArray(raw[year]) ? raw[year] : [];
    list.forEach((id) => {
      const numId = Number(id);
      if (validElectiveIds.has(numId) && !seenElectiveIds.has(numId)) {
        seenElectiveIds.add(numId);
        result[year].push(numId);
      }
    });
  });

  return result;
}

export function loadUserState(): UserCareerState {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STATE);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.error('Error loading state from localStorage:', e);
    return {};
  }
}

export function saveUserState(state: UserCareerState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(state));
  } catch (e) {
    console.error('Error saving state to localStorage:', e);
  }
}

export function loadAssignedElectives(userState?: UserCareerState): AssignedElectivesByYear {
  if (typeof localStorage === 'undefined') return migrateLegacyElectives(userState || {});
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ASSIGNED_ELECTIVES);
    if (raw) {
      const parsed = JSON.parse(raw);
      return sanitizeAssignedElectives(parsed);
    }

    // Auto-migration from legacy schema or userState
    return migrateLegacyElectives(userState || loadUserState());
  } catch (e) {
    console.error('Error loading assigned electives:', e);
    return { ...INITIAL_ASSIGNED_ELECTIVES };
  }
}

/**
 * Migrates electives from legacy slots or active userState
 * Automatically places any configured/marked elective in the year corresponding to its level
 */
export function migrateLegacyElectives(userState: UserCareerState): AssignedElectivesByYear {
  const result: AssignedElectivesByYear = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  const seenIds = new Set<number>();

  if (typeof localStorage !== 'undefined') {
    // 1. Check old slot storage if available
    try {
      const oldSlotsRaw = localStorage.getItem(STORAGE_KEY_OLD_SLOTS);
      if (oldSlotsRaw) {
        const oldSlots = JSON.parse(oldSlotsRaw);
        if (Array.isArray(oldSlots)) {
          oldSlots.forEach((slot: { level?: number; selectedElectiveId?: string | number }) => {
            if (slot.selectedElectiveId) {
              const numId = Number(slot.selectedElectiveId);
              const found = ELECTIVES.find((e) => e.id === numId);
              if (found && !seenIds.has(numId)) {
                const targetYear = slot.level && slot.level >= 1 && slot.level <= 5 ? slot.level : found.level;
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

  // 2. Also check if user has marked any elective in userState
  ELECTIVES.forEach((e) => {
    const st = userState[e.id];
    if (st && st.status && st.status !== 'bloqueada' && st.status !== 'disponible') {
      if (!seenIds.has(e.id)) {
        seenIds.add(e.id);
        const targetYear = e.level >= 1 && e.level <= 5 ? e.level : 3;
        result[targetYear].push(e.id);
      }
    }
  });

  saveAssignedElectives(result);
  return result;
}

export function saveAssignedElectives(data: AssignedElectivesByYear): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const sanitized = sanitizeAssignedElectives(data);
    localStorage.setItem(STORAGE_KEY_ASSIGNED_ELECTIVES, JSON.stringify(sanitized));
  } catch (e) {
    console.error('Error saving assigned electives:', e);
  }
}

export function loadBasket(): number[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BASKET);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveBasket(basket: number[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_BASKET, JSON.stringify(basket));
  } catch (e) {
    console.error('Error saving basket:', e);
  }
}

export function loadSettings(): AppSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      includeAnalistaTrack: parsed.includeAnalistaTrack ?? false,
      allowBlockedElectivesPlanning: parsed.allowBlockedElectivesPlanning ?? false,
      includeElectivesInProgress: parsed.includeElectivesInProgress ?? true,
      tutorialCompleted: parsed.tutorialCompleted ?? false,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Checks whether the tutorial should start automatically.
 * Rule:
 * 1. If tutorial was already completed/skipped, return false.
 * 2. If user already had saved career data prior to this update, do not show automatically (return false)
 *    and record tutorialCompleted as true.
 * 3. Only brand new users with no prior data will see it automatically.
 */
export function shouldAutoStartTutorial(userState?: UserCareerState): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    const rawTut = localStorage.getItem(STORAGE_KEY_TUTORIAL);
    if (rawTut === 'true') return false;

    // Check settings flag
    const settings = loadSettings();
    if (settings.tutorialCompleted) return false;

    // Check if user already has saved career subjects prior to this update
    const activeState = userState || loadUserState();
    const hasExistingData = Object.keys(activeState).length > 0;
    if (hasExistingData) {
      // Legacy user: silently mark completed so it doesn't disturb them
      markTutorialCompleted();
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function markTutorialCompleted(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_TUTORIAL, 'true');
    const settings = loadSettings();
    saveSettings({ ...settings, tutorialCompleted: true });
  } catch (e) {
    console.error('Error marking tutorial completed:', e);
  }
}

export function resetTutorialState(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY_TUTORIAL);
    const settings = loadSettings();
    saveSettings({ ...settings, tutorialCompleted: false });
  } catch (e) {
    console.error('Error resetting tutorial state:', e);
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error('Error saving settings:', e);
  }
}

export function exportCareerToJson(
  userState: UserCareerState,
  settings: AppSettings,
  basket: number[],
  assignedElectives: AssignedElectivesByYear
): string {
  const exportPayload = {
    version: '2.0',
    exportDate: new Date().toISOString(),
    plan: 'Plan 2023 ISI UTN',
    userState,
    settings,
    basket,
    assignedElectives,
  };
  return JSON.stringify(exportPayload, null, 2);
}

export function importCareerFromJson(jsonString: string): {
  success: boolean;
  userState?: UserCareerState;
  settings?: AppSettings;
  basket?: number[];
  assignedElectives?: AssignedElectivesByYear;
  error?: string;
} {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object') {
      return { success: false, error: 'Formato de archivo inválido.' };
    }

    const userState = parsed.userState || {};
    const settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
    const basket = Array.isArray(parsed.basket) ? parsed.basket : [];
    const assignedElectives = parsed.assignedElectives
      ? sanitizeAssignedElectives(parsed.assignedElectives)
      : migrateLegacyElectives(userState);

    saveUserState(userState);
    saveSettings(settings);
    saveBasket(basket);
    saveAssignedElectives(assignedElectives);

    return {
      success: true,
      userState,
      settings,
      basket,
      assignedElectives,
    };
  } catch {
    return { success: false, error: 'El archivo JSON está corrupto o mal formado.' };
  }
}

export function clearCareerData(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY_STATE);
  localStorage.removeItem(STORAGE_KEY_ASSIGNED_ELECTIVES);
  localStorage.removeItem(STORAGE_KEY_OLD_SLOTS);
  localStorage.removeItem(STORAGE_KEY_BASKET);
}

/**
 * Returns a rich sample state representing a 3rd year student
 */
export function getSample3rdYearStudent(): {
  userState: UserCareerState;
  assignedElectives: AssignedElectivesByYear;
} {
  const userState: UserCareerState = {
    // Nivel 1 completo con notas
    1: { status: 'aprobada', grade: 8 },
    2: { status: 'promocionada', grade: 9 },
    3: { status: 'aprobada', grade: 7 },
    4: { status: 'promocionada', grade: 10 },
    5: { status: 'promocionada', grade: 8 },
    6: { status: 'promocionada', grade: 9 },
    7: { status: 'aprobada', grade: 8 },
    8: { status: 'promocionada', grade: 9 },
    11: { status: 'promocionada', grade: 10 },
    // Nivel 2
    9: { status: 'regularizada' },
    10: { status: 'regularizada' },
    12: { status: 'promocionada', grade: 9 },
    13: { status: 'aprobada', grade: 8 },
    14: { status: 'promocionada', grade: 9 },
    15: { status: 'cursando' },
    16: { status: 'aprobada', grade: 8 },
    17: { status: 'aprobada', grade: 7 },
    // Nivel 3
    19: { status: 'cursando' },
    20: { status: 'cursando' },
    // Electivas de prueba
    301: { status: 'aprobada', grade: 9 }, // Backend de Aplicaciones (4 cr)
    404: { status: 'cursando' }, // DevOps (3 cr)
  };

  const assignedElectives: AssignedElectivesByYear = {
    1: [],
    2: [],
    3: [301], // Backend en 3° año
    4: [404], // DevOps en 4° año
    5: [],
  };

  return { userState, assignedElectives };
}
