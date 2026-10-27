import type { UserCareerState } from '../types/career';

const STORAGE_KEY_STATE = 'mi_carrera_user_state_v1';
const STORAGE_KEY_ELECTIVES = 'mi_carrera_electives_slots_v1';
const STORAGE_KEY_BASKET = 'mi_carrera_semester_basket_v1';
const STORAGE_KEY_SETTINGS = 'mi_carrera_settings_v1';

export interface AppSettings {
  includePromotionsInGPA: boolean;
  minPassingGrade: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  includePromotionsInGPA: true,
  minPassingGrade: 4,
};

export function loadUserState(): UserCareerState {
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
  try {
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(state));
  } catch (e) {
    console.error('Error saving state to localStorage:', e);
  }
}

export function loadBasket(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BASKET);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveBasket(basket: number[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_BASKET, JSON.stringify(basket));
  } catch (e) {
    console.error('Error saving basket:', e);
  }
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error('Error saving settings:', e);
  }
}

export function exportCareerToJson(userState: UserCareerState, settings: AppSettings, basket: number[]): string {
  const exportPayload = {
    version: '1.0',
    exportDate: new Date().toISOString(),
    plan: 'Plan 2023 ISI UTN',
    userState,
    settings,
    basket,
  };
  return JSON.stringify(exportPayload, null, 2);
}

export function importCareerFromJson(jsonString: string): {
  success: boolean;
  userState?: UserCareerState;
  settings?: AppSettings;
  basket?: number[];
  error?: string;
} {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object') {
      return { success: false, error: 'Formato de archivo inválido.' };
    }

    const userState = parsed.userState || {};
    const settings = parsed.settings || DEFAULT_SETTINGS;
    const basket = Array.isArray(parsed.basket) ? parsed.basket : [];

    saveUserState(userState);
    saveSettings(settings);
    saveBasket(basket);

    return {
      success: true,
      userState,
      settings,
      basket,
    };
  } catch {
    return { success: false, error: 'El archivo JSON está corrupto o mal formado.' };
  }
}

export function clearCareerData(): void {
  localStorage.removeItem(STORAGE_KEY_STATE);
  localStorage.removeItem(STORAGE_KEY_ELECTIVES);
  localStorage.removeItem(STORAGE_KEY_BASKET);
}

/**
 * Returns a rich sample state representing a 3rd year student
 */
export function getSample3rdYearStudent(): UserCareerState {
  return {
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
    // Nivel 2: algunas aprobadas, algunas regularizadas, algunas cursando
    9: { status: 'regularizada' },
    10: { status: 'regularizada' },
    12: { status: 'promocionada', grade: 9 },
    13: { status: 'aprobada', grade: 8 },
    14: { status: 'promocionada', grade: 9 },
    15: { status: 'cursando' },
    16: { status: 'aprobada', grade: 8 },
    17: { status: 'aprobada', grade: 7 },
    // Nivel 3: cursando y regularizada
    19: { status: 'cursando' },
    20: { status: 'cursando' },
  };
}
