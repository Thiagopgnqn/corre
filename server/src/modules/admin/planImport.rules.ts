/**
 * Shared constants, header definitions, and pure rule validators for the Etapa 2
 * study-plan `.xlsx` template and parser.
 *
 * Kept free of Node/DB dependencies so frontend tests can directly verify parity
 * between accepted rule types and `src/utils/correlativas.ts` (`evaluateSpecialRule`).
 */

/**
 * IMPORTANT: Must stay strictly aligned with `evaluateSpecialRule` in
 * `src/utils/correlativas.ts`. Currently the engine ONLY implements:
 * - `'approved_range'`: `{ fromCode: number; toCode: number }`
 * - `'all_previous_core_approved'`: `{ excludeTrackKeys?: string[] }`
 *
 * `min_credits` is NOT implemented in `correlativas.ts` and therefore MUST be rejected
 * during plan import until implemented and tested in the frontend engine.
 */
export const SUPPORTED_SPECIAL_RULE_TYPES = [
  'approved_range',
  'all_previous_core_approved',
] as const;

export type SupportedSpecialRuleType = (typeof SUPPORTED_SPECIAL_RULE_TYPES)[number];

export const PLAN_IMPORT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const PLAN_IMPORT_MAX_SHEETS = 10;
export const PLAN_IMPORT_MAX_ROWS = 2000;
export const PLAN_IMPORT_WORKER_TIMEOUT_MS = 5000;

export const ALLOWED_SUBJECT_MODALITIES = ['A', '1C', '2C', '1C/2C', '1C-CC', '2C-CC'] as const;
export type AllowedSubjectModality = (typeof ALLOWED_SUBJECT_MODALITIES)[number];

export const ALLOWED_SUBJECT_KINDS = ['obligatoria', 'electiva'] as const;
export type AllowedSubjectKind = (typeof ALLOWED_SUBJECT_KINDS)[number];

export const ALLOWED_PREREQ_TYPES = ['regular', 'aprobada'] as const;
export type AllowedPrereqType = (typeof ALLOWED_PREREQ_TYPES)[number];

export const PLAN_TEMPLATE_SHEETS = {
  PLAN: 'Plan',
  SUBJECTS: 'Materias',
  PREREQUISITES: 'Correlativas',
  RULES: 'Reglas',
  ACRONYMS: 'Acrónimos',
  INSTRUCTIONS: 'Instrucciones',
} as const;

export const PLAN_TEMPLATE_HEADERS: Record<string, readonly string[]> = {
  [PLAN_TEMPLATE_SHEETS.PLAN]: [
    'Nombre del plan',
    'Año del plan',
    'Etiqueta nivel',
    'Total niveles',
    'Créditos electivas requeridos',
    'Equivalente slots electivas',
    'Nota mínima aprobación',
    'Título final',
    'Etiqueta corta',
    'Código materia PPS',
    'Título PPS',
    'Descripción PPS',
    'Título intermedio',
    'Etiqueta título intermedio',
    'Título corto intermedio',
    'Clave trayecto intermedio',
    'Créditos electivas intermedio',
    'Código materia regla intermedio',
  ],
  [PLAN_TEMPLATE_SHEETS.SUBJECTS]: [
    'Código',
    'Código visible',
    'Nombre',
    'Nombre corto',
    'Nivel',
    'Modalidad',
    'Contra-cuatrimestral',
    'Horas semanales',
    'Tipo',
    'Créditos',
    'Integradora',
    'Trayecto opcional',
    'Clave trayecto',
  ],
  [PLAN_TEMPLATE_SHEETS.PREREQUISITES]: [
    'Código materia',
    'Código requisito',
    'Tipo requisito',
  ],
  [PLAN_TEMPLATE_SHEETS.RULES]: [
    'Código materia',
    'Tipo regla',
    'Parámetros JSON',
    'Descripción',
  ],
  [PLAN_TEMPLATE_SHEETS.ACRONYMS]: ['Sigla', 'Código materia'],
  [PLAN_TEMPLATE_SHEETS.INSTRUCTIONS]: [
    'Hoja',
    'Columna / Regla',
    'Obligatoria',
    'Formato y valores permitidos',
  ],
};

export function isSupportedSpecialRuleType(value: string): value is SupportedSpecialRuleType {
  return (SUPPORTED_SPECIAL_RULE_TYPES as readonly string[]).includes(value);
}

/**
 * Normalizes a subject name for shared-subject suggestion matching within a faculty.
 * Matches `seed.ts` normalization (NFD accent removal + lowercase + alphanumeric tokens).
 */
export function normalizeSharedSubjectName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function deriveShortSubjectName(name: string, maxLen = 22): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen).trim();
}

function isPlainSafeRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return false;
    }
  }
  return true;
}

export function validateSpecialRuleParams(
  ruleType: string,
  rawParams: unknown,
  knownSubjectCodes: Set<number>,
  coreSubjectCodes: Set<number>,
  knownTrackKeys: Set<string>
): { ok: true; ruleType: SupportedSpecialRuleType; params: Record<string, unknown> } | { ok: false; error: string } {
  if (!isSupportedSpecialRuleType(ruleType)) {
    return {
      ok: false,
      error: `Tipo de regla "${ruleType}" no soportado por el motor actual (permitidos: ${SUPPORTED_SPECIAL_RULE_TYPES.join(', ')}).`,
    };
  }

  let parsedObj: unknown = rawParams;
  if (typeof rawParams === 'string') {
    const trimmed = rawParams.trim();
    if (!trimmed) {
      parsedObj = {};
    } else {
      try {
        parsedObj = JSON.parse(trimmed);
      } catch {
        return { ok: false, error: 'Parámetros JSON inválidos (no se pudo parsear JSON).' };
      }
    }
  } else if (parsedObj === undefined || parsedObj === null) {
    parsedObj = {};
  }

  if (!isPlainSafeRecord(parsedObj)) {
    return { ok: false, error: 'Parámetros JSON debe ser un objeto válido.' };
  }

  if (ruleType === 'approved_range') {
    const keys = Object.keys(parsedObj);
    const invalidKeys = keys.filter((k) => k !== 'fromCode' && k !== 'toCode');
    if (invalidKeys.length > 0) {
      return {
        ok: false,
        error: `Claves no permitidas en approved_range: ${invalidKeys.join(', ')} (solo fromCode y toCode).`,
      };
    }

    const fromCode = parsedObj.fromCode;
    const toCode = parsedObj.toCode;
    if (
      typeof fromCode !== 'number' ||
      !Number.isInteger(fromCode) ||
      fromCode < 1 ||
      typeof toCode !== 'number' ||
      !Number.isInteger(toCode) ||
      toCode < 1
    ) {
      return {
        ok: false,
        error: 'approved_range requiere fromCode y toCode enteros positivos.',
      };
    }
    if (fromCode > toCode) {
      return {
        ok: false,
        error: `approved_range inválido: fromCode (${fromCode}) no puede ser mayor a toCode (${toCode}).`,
      };
    }
    if (!knownSubjectCodes.has(fromCode) || !knownSubjectCodes.has(toCode)) {
      return {
        ok: false,
        error: `approved_range referencia códigos inexistentes en Materias (fromCode=${fromCode}, toCode=${toCode}).`,
      };
    }
    let hasCoreInRange = false;
    for (const c of coreSubjectCodes) {
      if (c >= fromCode && c <= toCode) {
        hasCoreInRange = true;
        break;
      }
    }
    if (!hasCoreInRange) {
      return {
        ok: false,
        error: `approved_range [${fromCode}..${toCode}] no abarca ninguna materia obligatoria del plan.`,
      };
    }

    const cleanParams = Object.create(null) as Record<string, unknown>;
    cleanParams.fromCode = fromCode;
    cleanParams.toCode = toCode;
    return { ok: true, ruleType, params: { fromCode: Number(fromCode), toCode: Number(toCode) } };
  }

  // all_previous_core_approved
  const keys = Object.keys(parsedObj);
  const invalidKeys = keys.filter((k) => k !== 'excludeTrackKeys');
  if (invalidKeys.length > 0) {
    return {
      ok: false,
      error: `Claves no permitidas en all_previous_core_approved: ${invalidKeys.join(', ')} (solo excludeTrackKeys).`,
    };
  }

  if (parsedObj.excludeTrackKeys === undefined) {
    return { ok: true, ruleType, params: {} };
  }

  if (!Array.isArray(parsedObj.excludeTrackKeys)) {
    return {
      ok: false,
      error: 'all_previous_core_approved.excludeTrackKeys debe ser un arreglo de strings.',
    };
  }

  const normalizedKeys: string[] = [];
  for (const item of parsedObj.excludeTrackKeys) {
    if (typeof item !== 'string' || !item.trim()) {
      return {
        ok: false,
        error: 'excludeTrackKeys no puede contener valores vacíos ni no-string.',
      };
    }
    const cleanKey = item.trim();
    if (!knownTrackKeys.has(cleanKey)) {
      return {
        ok: false,
        error: `excludeTrackKeys referencia clave de trayecto "${cleanKey}" inexistente en Materias.`,
      };
    }
    if (!normalizedKeys.includes(cleanKey)) {
      normalizedKeys.push(cleanKey);
    }
  }

  return {
    ok: true,
    ruleType,
    params: normalizedKeys.length > 0 ? { excludeTrackKeys: normalizedKeys } : {},
  };
}
