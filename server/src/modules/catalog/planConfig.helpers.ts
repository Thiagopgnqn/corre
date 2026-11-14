export interface NormalizedIntermediateDegree {
  key: string;
  name: string;
  requiredElectiveCredits?: number;
  specialRuleSubjectCode?: number;
}

export interface PpsRequirementConfig {
  referenceSubjectCode: number;
}

export interface NormalizedPlanConfig {
  requiredElectiveCredits: number;
  defaultMinPassingGrade: number;
  electiveSlotsEquivalent: number;
  totalLevels: number;
  levelLabel: string;
  shortTag: string;
  intermediateDegrees: NormalizedIntermediateDegree[];
  ppsRequirement: PpsRequirementConfig | null;
  [key: string]: unknown;
}

export interface CatalogSubjectInput {
  id: string;
  codeInPlan: number;
  name: string;
  shortName: string;
  level: number;
  modality: string;
  contraCuatrimestral: boolean;
  weeklyHours: number | string;
  kind: string;
  credits: number | null;
  isOptionalTrack: boolean;
  trackKey: string | null;
}

export interface CatalogRuleInput {
  id: string;
  subjectId: string;
  ruleType: string;
  params: Record<string, unknown> | null;
  description: string;
}

function parseFiniteNonNegativeNumber(val: unknown): number | null {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) return null;
  return val;
}

function parsePositiveInt(val: unknown): number | null {
  if (typeof val !== 'number' || !Number.isFinite(val)) return null;
  const rounded = Math.floor(val);
  return rounded > 0 ? rounded : null;
}

function normalizeIntermediateDegrees(raw: unknown): NormalizedIntermediateDegree[] {
  if (!Array.isArray(raw)) return [];
  const normalized: NormalizedIntermediateDegree[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const key = typeof obj.key === 'string' ? obj.key.trim() : '';
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!key || !name) continue;

    const degree: NormalizedIntermediateDegree = { key, name };
    const reqCredits = parseFiniteNonNegativeNumber(obj.requiredElectiveCredits);
    if (reqCredits !== null) degree.requiredElectiveCredits = reqCredits;

    const ruleSubjCode = parsePositiveInt(obj.specialRuleSubjectCode);
    if (ruleSubjCode !== null) degree.specialRuleSubjectCode = ruleSubjCode;

    normalized.push(degree);
  }

  return normalized;
}

export function normalizePpsRequirement(raw: unknown): PpsRequirementConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const refCode = parsePositiveInt((raw as Record<string, unknown>).referenceSubjectCode);
  return refCode !== null ? { referenceSubjectCode: refCode } : null;
}

/**
 * Strips forbidden legacy/duplicate fields (such as ppsSubjectCode) before exposing config objects in summary endpoints.
 */
export function sanitizeSummaryPlanConfig(
  rawConfig: Record<string, unknown> | null | undefined,
  context?: { careerCode?: string | null; planName?: string | null }
): Record<string, unknown> {
  const source: Record<string, unknown> =
    rawConfig && typeof rawConfig === 'object' ? { ...rawConfig } : {};
  delete source.ppsSubjectCode;

  const fallbackTag = [context?.careerCode, context?.planName]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' · ');

  return {
    ...source,
    requiredElectiveCredits: parseFiniteNonNegativeNumber(source.requiredElectiveCredits) ?? 0,
    defaultMinPassingGrade: parsePositiveInt(source.defaultMinPassingGrade) ?? 4,
    electiveSlotsEquivalent: parseFiniteNonNegativeNumber(source.electiveSlotsEquivalent) ?? 0,
    levelLabel:
      typeof source.levelLabel === 'string' && source.levelLabel.trim().length > 0
        ? source.levelLabel.trim()
        : 'Año',
    shortTag:
      typeof source.shortTag === 'string' && source.shortTag.trim().length > 0
        ? source.shortTag.trim()
        : fallbackTag || 'Plan',
    intermediateDegrees: normalizeIntermediateDegrees(source.intermediateDegrees),
    ppsRequirement: normalizePpsRequirement(source.ppsRequirement),
  };
}

/**
 * Normalizes a study plan's config JSONB using neutral defaults only (zero career-specific fallbacks).
 */
export function normalizePlanConfig(
  rawConfig: Record<string, unknown> | null | undefined,
  subjects: Array<{ level: number }>,
  context?: { careerCode?: string | null; planName?: string | null }
): NormalizedPlanConfig {
  const sanitized = sanitizeSummaryPlanConfig(rawConfig, context);

  let derivedMaxLevel = 1;
  for (const s of subjects) {
    const lvl = parsePositiveInt(Number(s.level));
    if (lvl !== null && lvl > derivedMaxLevel) {
      derivedMaxLevel = lvl;
    }
  }

  const totalLevels = parsePositiveInt((rawConfig as Record<string, unknown> | undefined)?.totalLevels) ?? derivedMaxLevel;

  return {
    ...sanitized,
    requiredElectiveCredits: sanitized.requiredElectiveCredits as number,
    defaultMinPassingGrade: sanitized.defaultMinPassingGrade as number,
    electiveSlotsEquivalent: sanitized.electiveSlotsEquivalent as number,
    totalLevels,
    levelLabel: sanitized.levelLabel as string,
    shortTag: sanitized.shortTag as string,
    intermediateDegrees: sanitized.intermediateDegrees as NormalizedIntermediateDegree[],
    ppsRequirement: sanitized.ppsRequirement as PpsRequirementConfig | null,
  };
}

export interface BuildPlanCatalogInput {
  plan: {
    id: string;
    name: string;
    year: number;
    config: Record<string, unknown> | null | undefined;
    updatedAt: Date | string;
  };
  career: {
    id: string;
    name: string;
    code: string;
    facultyId: string;
  };
  subjects: CatalogSubjectInput[];
  prerequisites: Array<{
    subjectId: string;
    requiresSubjectId: string;
    type: string;
  }>;
  rules: CatalogRuleInput[];
  acronyms: Array<{
    acronym: string;
    subjectId: string;
  }>;
}

export function formatPlanCatalogPayload(input: BuildPlanCatalogInput) {
  const { plan, career, subjects, prerequisites, rules, acronyms } = input;

  const uuidToCode = new Map<string, number>();
  subjects.forEach((s) => uuidToCode.set(s.id, s.codeInPlan));

  const regularMap = new Map<number, number[]>();
  const approvedMap = new Map<number, number[]>();

  prerequisites.forEach((p) => {
    const subjectCode = uuidToCode.get(p.subjectId);
    const reqCode = uuidToCode.get(p.requiresSubjectId);
    if (!subjectCode || !reqCode) return;

    if (p.type === 'regular') {
      const list = regularMap.get(subjectCode) || [];
      list.push(reqCode);
      regularMap.set(subjectCode, list);
    } else {
      const list = approvedMap.get(subjectCode) || [];
      list.push(reqCode);
      approvedMap.set(subjectCode, list);
    }
  });

  const acronymsMap: Record<string, number> = {};
  acronyms.forEach((a) => {
    const code = uuidToCode.get(a.subjectId);
    if (code) acronymsMap[a.acronym] = code;
  });

  const formattedSubjects = subjects.map((s) => ({
    id: s.codeInPlan,
    uuid: s.id,
    code: s.shortName,
    shortName: s.shortName,
    name: s.name,
    level: s.level,
    modality: s.modality,
    contraCuatrimestral: s.contraCuatrimestral,
    weeklyHours: Number(s.weeklyHours),
    isElective: s.kind === 'electiva',
    kind: s.kind === 'electiva' ? ('electiva' as const) : ('obligatoria' as const),
    credits: s.credits ?? undefined,
    isOptionalTrack: s.isOptionalTrack,
    trackKey: s.trackKey ?? undefined,
    regularPrereqs: regularMap.get(s.codeInPlan) || [],
    approvedPrereqs: approvedMap.get(s.codeInPlan) || [],
  }));

  const normalizedConfig = normalizePlanConfig(plan.config, formattedSubjects, {
    careerCode: career.code,
    planName: plan.name,
  });

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      year: plan.year,
      config: normalizedConfig,
      updatedAt: plan.updatedAt,
    },
    career: {
      id: career.id,
      name: career.name,
      code: career.code,
      facultyId: career.facultyId,
    },
    subjects: formattedSubjects,
    rules: rules.map((r) => ({
      id: r.id,
      subjectCode: uuidToCode.get(r.subjectId),
      ruleType: r.ruleType,
      params: r.params || {},
      description: r.description,
    })),
    acronyms: acronymsMap,
  };
}
