export interface PlanSettingsValues {
  includePromotionsInGPA: boolean;
  minPassingGrade: number;
  includeAnalistaTrack: boolean;
  allowBlockedElectivesPlanning: boolean;
  includeElectivesInProgress: boolean;
  soundEnabled: boolean;
  tutorialCompleted: boolean;
  notifyLibraryEmail: boolean;
}

export const DEFAULT_PLAN_SETTINGS: PlanSettingsValues = {
  includePromotionsInGPA: true,
  minPassingGrade: 4,
  includeAnalistaTrack: false,
  allowBlockedElectivesPlanning: false,
  includeElectivesInProgress: true,
  soundEnabled: true,
  tutorialCompleted: false,
  notifyLibraryEmail: true,
};

export interface StoredUserSettingsLike {
  planId?: string | null;
  includePromotionsInGPA?: boolean | null;
  minPassingGrade?: number | null;
  includeAnalistaTrack?: boolean | null;
  allowBlockedElectivesPlanning?: boolean | null;
  includeElectivesInProgress?: boolean | null;
  soundEnabled?: boolean | null;
  tutorialCompleted?: boolean | null;
  notifyLibraryEmail?: boolean | null;
  extraSettings?: unknown;
}

export interface StoredScheduleSelectionLike {
  planId?: string | null;
  selections?: unknown;
  selectionsByPlan?: unknown;
}

function asPlainObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function pickSettingsSnapshot(
  raw: Record<string, any>,
  notifyLibraryEmail: boolean
): PlanSettingsValues {
  const parsedMinGrade =
    typeof raw.minPassingGrade === 'number' && !Number.isNaN(raw.minPassingGrade)
      ? raw.minPassingGrade
      : DEFAULT_PLAN_SETTINGS.minPassingGrade;

  return {
    includePromotionsInGPA:
      typeof raw.includePromotionsInGPA === 'boolean'
        ? raw.includePromotionsInGPA
        : DEFAULT_PLAN_SETTINGS.includePromotionsInGPA,
    minPassingGrade: parsedMinGrade,
    includeAnalistaTrack:
      typeof raw.includeAnalistaTrack === 'boolean'
        ? raw.includeAnalistaTrack
        : DEFAULT_PLAN_SETTINGS.includeAnalistaTrack,
    allowBlockedElectivesPlanning:
      typeof raw.allowBlockedElectivesPlanning === 'boolean'
        ? raw.allowBlockedElectivesPlanning
        : DEFAULT_PLAN_SETTINGS.allowBlockedElectivesPlanning,
    includeElectivesInProgress:
      typeof raw.includeElectivesInProgress === 'boolean'
        ? raw.includeElectivesInProgress
        : DEFAULT_PLAN_SETTINGS.includeElectivesInProgress,
    soundEnabled:
      typeof raw.soundEnabled === 'boolean'
        ? raw.soundEnabled
        : DEFAULT_PLAN_SETTINGS.soundEnabled,
    tutorialCompleted:
      typeof raw.tutorialCompleted === 'boolean'
        ? raw.tutorialCompleted
        : DEFAULT_PLAN_SETTINGS.tutorialCompleted,
    notifyLibraryEmail,
  };
}

/**
 * Extrae las preferencias del plan activo desde `user_settings`.
 * Mientras exista la PK heredada por `user_id` (antes de la limpieza posterior a 0008),
 * conserva un mapa `extraSettings.perPlan[planId]` para no perder preferencias al cambiar de plan.
 */
export function extractPlanSettings(
  settingsRow: StoredUserSettingsLike | null | undefined,
  planId?: string | null
): PlanSettingsValues {
  if (!settingsRow) {
    return { ...DEFAULT_PLAN_SETTINGS };
  }

  const notifyLibraryEmail = settingsRow.notifyLibraryEmail ?? true;
  const extra = asPlainObject(settingsRow.extraSettings);
  const perPlan = asPlainObject(extra.perPlan);

  if (planId && perPlan[planId] && typeof perPlan[planId] === 'object') {
    return pickSettingsSnapshot(asPlainObject(perPlan[planId]), notifyLibraryEmail);
  }

  if (!planId || !settingsRow.planId || settingsRow.planId === planId) {
    return {
      includePromotionsInGPA: settingsRow.includePromotionsInGPA ?? true,
      minPassingGrade: settingsRow.minPassingGrade ?? 4,
      includeAnalistaTrack: settingsRow.includeAnalistaTrack ?? false,
      allowBlockedElectivesPlanning: settingsRow.allowBlockedElectivesPlanning ?? false,
      includeElectivesInProgress: settingsRow.includeElectivesInProgress ?? true,
      soundEnabled: settingsRow.soundEnabled ?? true,
      tutorialCompleted: settingsRow.tutorialCompleted ?? false,
      notifyLibraryEmail,
    };
  }

  return {
    ...DEFAULT_PLAN_SETTINGS,
    notifyLibraryEmail,
  };
}

/**
 * Combina cambios de settings sobre el plan activo sin sobrescribir `perPlan` de otros planes.
 */
export function mergePlanSettings(
  existingRow: StoredUserSettingsLike | null | undefined,
  planId: string | null | undefined,
  incoming: Partial<PlanSettingsValues> & { extraSettings?: unknown }
): PlanSettingsValues & { planId: string | null; extraSettings: Record<string, any> } {
  const currentForPlan = extractPlanSettings(existingRow, planId);
  const nextNotify =
    incoming.notifyLibraryEmail !== undefined
      ? Boolean(incoming.notifyLibraryEmail)
      : currentForPlan.notifyLibraryEmail;

  const parsedMinGrade =
    incoming.minPassingGrade !== undefined
      ? parseInt(String(incoming.minPassingGrade), 10)
      : currentForPlan.minPassingGrade;

  const resolved: PlanSettingsValues = {
    includePromotionsInGPA:
      incoming.includePromotionsInGPA !== undefined
        ? Boolean(incoming.includePromotionsInGPA)
        : currentForPlan.includePromotionsInGPA,
    minPassingGrade: Number.isNaN(parsedMinGrade) ? currentForPlan.minPassingGrade : parsedMinGrade,
    includeAnalistaTrack:
      incoming.includeAnalistaTrack !== undefined
        ? Boolean(incoming.includeAnalistaTrack)
        : currentForPlan.includeAnalistaTrack,
    allowBlockedElectivesPlanning:
      incoming.allowBlockedElectivesPlanning !== undefined
        ? Boolean(incoming.allowBlockedElectivesPlanning)
        : currentForPlan.allowBlockedElectivesPlanning,
    includeElectivesInProgress:
      incoming.includeElectivesInProgress !== undefined
        ? Boolean(incoming.includeElectivesInProgress)
        : currentForPlan.includeElectivesInProgress,
    soundEnabled:
      incoming.soundEnabled !== undefined ? Boolean(incoming.soundEnabled) : currentForPlan.soundEnabled,
    tutorialCompleted:
      incoming.tutorialCompleted !== undefined
        ? Boolean(incoming.tutorialCompleted)
        : currentForPlan.tutorialCompleted,
    notifyLibraryEmail: nextNotify,
  };

  const existingExtra = asPlainObject(existingRow?.extraSettings);
  const incomingExtra = asPlainObject(incoming.extraSettings);
  const existingPerPlan = asPlainObject(existingExtra.perPlan);
  const nextPerPlan: Record<string, any> = { ...existingPerPlan };

  if (existingRow?.planId && existingRow.planId !== planId && !nextPerPlan[existingRow.planId]) {
    nextPerPlan[existingRow.planId] = extractPlanSettings(existingRow, existingRow.planId);
  }
  if (planId) {
    nextPerPlan[planId] = { ...resolved };
  }

  const nextExtra: Record<string, any> = {
    ...existingExtra,
    ...incomingExtra,
    perPlan: nextPerPlan,
  };

  return {
    ...resolved,
    planId: planId ?? existingRow?.planId ?? null,
    extraSettings: nextExtra,
  };
}

function asStringMap(value: unknown): Record<string, string> {
  const obj = asPlainObject(value);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.trim() !== '') {
      out[k] = v;
    } else if (typeof v === 'number' && !Number.isNaN(v)) {
      out[k] = String(v);
    }
  }
  return out;
}

/**
 * Extrae las selecciones de horarios del plan activo sin mezclar otros planes.
 */
export function extractPlanScheduleSelections(
  selRow: StoredScheduleSelectionLike | null | undefined,
  planId?: string | null
): Record<string, string> {
  if (!selRow) return {};

  const byPlan = asPlainObject(selRow.selectionsByPlan);
  if (planId && Object.prototype.hasOwnProperty.call(byPlan, planId)) {
    return asStringMap(byPlan[planId]);
  }

  if (!planId || !selRow.planId || selRow.planId === planId) {
    return asStringMap(selRow.selections);
  }

  return {};
}

/**
 * Actualiza las selecciones de horarios del plan activo preservando las de otros planes.
 */
export function mergePlanScheduleSelections(
  existingSelRow: StoredScheduleSelectionLike | null | undefined,
  planId: string | null | undefined,
  nextSelections: Record<string, unknown>
): {
  planId: string | null;
  selections: Record<string, string>;
  selectionsByPlan: Record<string, Record<string, string>>;
} {
  const existingByPlan = asPlainObject(existingSelRow?.selectionsByPlan);
  const nextByPlan: Record<string, Record<string, string>> = {};

  for (const [k, v] of Object.entries(existingByPlan)) {
    nextByPlan[k] = asStringMap(v);
  }

  if (
    existingSelRow?.planId &&
    existingSelRow.planId !== planId &&
    !Object.prototype.hasOwnProperty.call(nextByPlan, existingSelRow.planId)
  ) {
    nextByPlan[existingSelRow.planId] = asStringMap(existingSelRow.selections);
  }

  const normalizedNext = asStringMap(nextSelections);
  if (planId) {
    nextByPlan[planId] = normalizedNext;
  }

  return {
    planId: planId ?? existingSelRow?.planId ?? null,
    selections: normalizedNext,
    selectionsByPlan: nextByPlan,
  };
}

/**
 * Calcula el nivel máximo permitido para electivas de un plan:
 * usa `config.totalLevels` y el mayor `level` entre sus materias, con mínimo 5 por compatibilidad.
 */
export function resolvePlanMaxLevel(
  totalLevels?: number | null,
  subjects?: Array<{ level?: number | null }>
): number {
  let max =
    typeof totalLevels === 'number' && Number.isFinite(totalLevels) && totalLevels >= 1
      ? Math.floor(totalLevels)
      : 0;

  if (Array.isArray(subjects)) {
    for (const subject of subjects) {
      if (typeof subject?.level === 'number' && Number.isFinite(subject.level) && subject.level > max) {
        max = Math.floor(subject.level);
      }
    }
  }

  return Math.max(5, max);
}
