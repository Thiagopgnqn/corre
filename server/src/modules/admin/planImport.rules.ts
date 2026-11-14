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
    'Desde código',
    'Hasta código',
    'Trayectos excluidos',
    'Descripción',
  ],
  [PLAN_TEMPLATE_SHEETS.ACRONYMS]: ['Sigla', 'Código materia'],
  [PLAN_TEMPLATE_SHEETS.INSTRUCTIONS]: [
    'Hoja',
    'Columna / Regla',
    'Obligatoria',
    'Formato y valores permitidos',
    'Ejemplo',
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

const RESERVED_PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function parsePositiveIntCell(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

export interface SpecialRuleColumnsInput {
  fromCodeRaw: string;
  toCodeRaw: string;
  excludeTrackKeysRaw: string;
}

export function validateModalityAndContraCuatrimestral(
  modality: AllowedSubjectModality,
  rawContraCuatrimestral: string
): { ok: true; contraCuatrimestral: boolean } | { ok: false; error: string } {
  const upper = rawContraCuatrimestral.trim().toUpperCase();
  const isCcModality = modality === '1C-CC' || modality === '2C-CC';

  if (upper === '') {
    return { ok: true, contraCuatrimestral: isCcModality };
  }

  let explicitBool: boolean;
  if (upper === 'SI' || upper === 'SÍ' || upper === 'TRUE' || upper === '1' || upper === 'S') {
    explicitBool = true;
  } else if (upper === 'NO' || upper === 'FALSE' || upper === '0' || upper === 'N') {
    explicitBool = false;
  } else {
    return { ok: false, error: 'Contra-cuatrimestral debe ser SI, NO o dejarse vacío.' };
  }

  if (isCcModality && !explicitBool) {
    return {
      ok: false,
      error: `Contradicción: la modalidad "${modality}" implica dictado contra-cuatrimestral y no admite Contra-cuatrimestral = NO.`,
    };
  }
  if (!isCcModality && explicitBool) {
    return {
      ok: false,
      error: `Contradicción: la modalidad "${modality}" no es contra-cuatrimestral; para dictado contra-cuatrimestral usá 1C-CC o 2C-CC.`,
    };
  }

  return { ok: true, contraCuatrimestral: explicitBool };
}

export function validateSpecialRuleColumns(
  ruleType: string,
  columns: SpecialRuleColumnsInput,
  knownSubjectCodes: Set<number>,
  coreSubjectCodes: Set<number>,
  knownTrackKeys: Set<string>
):
  | {
      ok: true;
      ruleType: SupportedSpecialRuleType;
      params: Record<string, unknown>;
      defaultDescription: string;
    }
  | { ok: false; error: string } {
  if (!isSupportedSpecialRuleType(ruleType)) {
    return {
      ok: false,
      error: `Tipo de regla "${ruleType}" no soportado por el motor actual (permitidos: ${SUPPORTED_SPECIAL_RULE_TYPES.join(', ')}).`,
    };
  }

  const fromTrim = columns.fromCodeRaw.trim();
  const toTrim = columns.toCodeRaw.trim();
  const excludeTrim = columns.excludeTrackKeysRaw.trim();

  if (ruleType === 'approved_range') {
    if (excludeTrim) {
      return {
        ok: false,
        error: 'La regla approved_range no utiliza "Trayectos excluidos" (dejalo vacío).',
      };
    }

    const fromCode = parsePositiveIntCell(fromTrim);
    const toCode = parsePositiveIntCell(toTrim);
    if (fromCode === null || toCode === null) {
      return {
        ok: false,
        error: 'approved_range requiere "Desde código" y "Hasta código" como enteros positivos.',
      };
    }
    if (fromCode > toCode) {
      return {
        ok: false,
        error: `approved_range inválido: "Desde código" (${fromCode}) no puede ser mayor a "Hasta código" (${toCode}).`,
      };
    }
    if (!knownSubjectCodes.has(fromCode) || !knownSubjectCodes.has(toCode)) {
      return {
        ok: false,
        error: `approved_range referencia códigos inexistentes en Materias (Desde=${fromCode}, Hasta=${toCode}).`,
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

    return {
      ok: true,
      ruleType,
      params: { fromCode, toCode },
      defaultDescription: `Requiere tener aprobadas todas las materias obligatorias de código ${fromCode} a ${toCode}.`,
    };
  }

  // all_previous_core_approved
  if (fromTrim || toTrim) {
    return {
      ok: false,
      error: 'La regla all_previous_core_approved no utiliza "Desde código" ni "Hasta código".',
    };
  }

  if (!excludeTrim) {
    return {
      ok: true,
      ruleType,
      params: {},
      defaultDescription: 'Requiere tener aprobadas todas las materias obligatorias previas.',
    };
  }

  const rawParts = excludeTrim.split(',');
  const normalizedKeys: string[] = [];
  for (const part of rawParts) {
    const cleanKey = part.trim().toLowerCase();
    if (!cleanKey) {
      return {
        ok: false,
        error: 'Trayectos excluidos tiene una coma sobrante o un valor vacío.',
      };
    }
    if (RESERVED_PROTOTYPE_KEYS.has(cleanKey)) {
      return {
        ok: false,
        error: `Clave reservada "${cleanKey}" no permitida en Trayectos excluidos.`,
      };
    }
    if (!knownTrackKeys.has(cleanKey)) {
      return {
        ok: false,
        error: `Trayectos excluidos referencia la clave "${cleanKey}", que no existe en "Clave trayecto" de Materias.`,
      };
    }
    if (!normalizedKeys.includes(cleanKey)) {
      normalizedKeys.push(cleanKey);
    }
  }

  return {
    ok: true,
    ruleType,
    params: { excludeTrackKeys: normalizedKeys },
    defaultDescription: `Requiere tener aprobadas todas las materias obligatorias previas (excepto trayectos: ${normalizedKeys.join(', ')}).`,
  };
}
