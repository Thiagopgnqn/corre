import type { TutorialStep } from '../data/tutorialSteps';
import type {
  ActivePlanCatalog,
  PlanConfig,
  PlanCareerMeta,
  PlanIntermediateDegree,
  PlanSpecialRule,
  Subject,
  UserCareerState,
} from '../types/career';
import { APP_NAME } from '../config/brand';
import {
  canRenderSpecialRuleSubject,
  isSubjectIncludedInTrack,
  type OptionalTrackSelection,
} from './correlativas';

export interface SpecialRuleViewModel {
  text: string;
  statusBadge: {
    canRender: boolean;
    message: string;
  } | null;
}

const DEFAULT_FALLBACK_LEVEL_LABEL = 'Año';
const DEFAULT_FALLBACK_FINAL_DEGREE_HEADING = 'Requisitos para el Título Final';
const DEFAULT_FALLBACK_FINAL_MILESTONE = 'Graduación (Título Final)';
const DEFAULT_FALLBACK_PPS_LABEL = 'Habilitación PPS';
const DEFAULT_FALLBACK_PPS_DESC = 'Cumplís los requisitos para cursar la Práctica Profesional';

function trimOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lowerFirst(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/**
 * Pluralizes simple Spanish level nouns used in `plan.config.levelLabel` (e.g. "Año" -> "años").
 */
export function pluralizeLevelLabelLower(levelLabel: string | undefined): string {
  const normalized = lowerFirst(trimOrEmpty(levelLabel) || DEFAULT_FALLBACK_LEVEL_LABEL);
  if (normalized.endsWith('s')) return normalized;
  if (/[aeiouáéíóú]$/i.test(normalized)) return `${normalized}s`;
  return `${normalized}es`;
}

/**
 * Returns the Spanish masculine/apocopated ordinal abbreviation for demo student labels
 * (1 -> "1er", 2 -> "2do", 3 -> "3er", 4 -> "4to", 5 -> "5to", 6 -> "6to", 7 -> "7mo", ...).
 */
export function formatSpanishOrdinal(level: number): string {
  const safeLevel = Number.isFinite(level) && level >= 1 ? Math.trunc(level) : 1;
  switch (safeLevel) {
    case 1:
      return '1er';
    case 2:
      return '2do';
    case 3:
      return '3er';
    case 4:
      return '4to';
    case 5:
      return '5to';
    case 6:
      return '6to';
    case 7:
      return '7mo';
    case 8:
      return '8vo';
    case 9:
      return '9no';
    case 10:
      return '10mo';
    default:
      return `${safeLevel}°`;
  }
}

/**
 * Resolves the normalized special-rule card content and optional capstone eligibility badge
 * using `plan.rules` (`ruleType`) rather than hardcoded subject IDs.
 */
export function resolveSpecialRuleView(
  subject: Pick<Subject, 'id' | 'name' | 'code' | 'specialRule'>,
  plan: ActivePlanCatalog | null | undefined,
  userState: UserCareerState,
  trackSelection: OptionalTrackSelection
): SpecialRuleViewModel | null {
  const matchingRules = (plan?.rules ?? []).filter((r) => r.subjectCode === subject.id);
  const allPrevRule = matchingRules.find((r) => r.ruleType === 'all_previous_core_approved');

  const rawRuleText =
    trimOrEmpty(subject.specialRule) ||
    matchingRules
      .map((r) => trimOrEmpty(r.description))
      .filter(Boolean)
      .join(' / ');

  if (!rawRuleText) {
    return null;
  }

  let displayText = rawRuleText;
  if (allPrevRule && plan) {
    const excludeKeys = new Set(
      Array.isArray(allPrevRule.params?.excludeTrackKeys)
        ? allPrevRule.params.excludeTrackKeys.filter((k): k is string => typeof k === 'string' && k.length > 0)
        : []
    );

    if (excludeKeys.size > 0) {
      const excludedSubjects = plan.subjects.filter(
        (s) =>
          s.isOptionalTrack &&
          Boolean(s.trackKey && excludeKeys.has(s.trackKey)) &&
          !isSubjectIncludedInTrack(s, trackSelection)
      );
      for (const optSubj of excludedSubjects) {
        const idPattern = new RegExp(`\\s*\\+\\s*[^+)]*\\b${escapeRegExp(String(optSubj.id))}\\b`);
        displayText = displayText.replace(idPattern, '');
      }
    }
  }

  let statusBadge: SpecialRuleViewModel['statusBadge'] = null;
  if (allPrevRule && plan) {
    const evaluation = canRenderSpecialRuleSubject(subject.id, userState, plan, trackSelection);
    statusBadge = {
      canRender: evaluation.canRender,
      message: evaluation.canRender
        ? `¡Cumplís todas las materias previas para rendir ${subject.name}!`
        : `Faltan aprobar ${evaluation.missingIds.length} materias previas`,
    };
  }

  return {
    text: displayText,
    statusBadge,
  };
}

/**
 * Resolves concise subject name for the weekly schedule grid using ONLY `subject.shortName`
 * from the active catalog, falling back to `name` truncated to `<= 22` characters (no ID map).
 */
export function getScheduleShortSubjectName(
  subjectId: number,
  fullName: string,
  catalogSubject?: Pick<Subject, 'shortName' | 'name'> | null
): string {
  const shortName = trimOrEmpty(catalogSubject?.shortName);
  if (shortName.length > 0) {
    return shortName;
  }

  const candidateName = trimOrEmpty(fullName) || trimOrEmpty(catalogSubject?.name);
  if (!candidateName) {
    return `Materia #${subjectId}`;
  }
  if (candidateName.length <= 22) {
    return candidateName;
  }
  return `${candidateName.slice(0, 19).trimEnd()}...`;
}

// ── Final Degree & Electives Progress Texts ─────────────────────────────────

export function getFinalDegreeMilestoneTitle(config?: Partial<PlanConfig> | null): string {
  const title = trimOrEmpty(config?.finalDegreeTitle);
  return title ? `Graduación (Título ${title})` : DEFAULT_FALLBACK_FINAL_MILESTONE;
}

export function getFinalDegreeMilestoneDesc(config?: Partial<PlanConfig> | null): string {
  const reqCredits = config?.requiredElectiveCredits ?? 0;
  if (reqCredits <= 0) {
    return 'Todas las materias obligatorias aprobadas';
  }
  return `Todas las materias obligatorias aprobadas + ${reqCredits} créditos de electivas`;
}

export function getFinalDegreeSectionHeading(config?: Partial<PlanConfig> | null): string {
  const title = trimOrEmpty(config?.finalDegreeTitle);
  return title ? `Requisitos para el Título de ${title}` : DEFAULT_FALLBACK_FINAL_DEGREE_HEADING;
}

export function getProgressCalcSubtitle(config?: Partial<PlanConfig> | null): string {
  const reqCredits = config?.requiredElectiveCredits ?? 0;
  if (reqCredits <= 0) {
    return 'Elegí cómo calcular el porcentaje de avance general de la carrera.';
  }
  return `Elegí si el porcentaje de avance general incluye el bloque de ${reqCredits} créditos de electivas.`;
}

export function getProgressWithElectivesBtnLabel(config?: Partial<PlanConfig> | null): string {
  const reqCredits = config?.requiredElectiveCredits ?? 0;
  return reqCredits > 0 ? `Con electivas (${reqCredits} cr)` : 'Con electivas';
}

export function getProgressWeightedFooterLabel(config?: Partial<PlanConfig> | null): string {
  const eq = config?.electiveSlotsEquivalent ?? 0;
  return eq > 0
    ? `Ponderado: obligatorias + bloque electivas (${eq} eq.)`
    : 'Ponderado: obligatorias + bloque electivas';
}

export function getDegreeElectiveReachedLabel(config?: Partial<PlanConfig> | null): string {
  const reqCredits = config?.requiredElectiveCredits ?? 0;
  return `Requisito de ${reqCredits} créditos alcanzado`;
}

export function getDegreeElectiveFootnote(config?: Partial<PlanConfig> | null): string {
  const reqCredits = config?.requiredElectiveCredits ?? 0;
  return `* ${reqCredits} créditos requeridos en total, sin importar el nivel de las electivas aprobadas.`;
}

export function getBadgesSectionSubtitle(planName?: string | null): string {
  const cleanPlanName = trimOrEmpty(planName);
  if (!cleanPlanName) {
    return 'Logros desbloqueados automáticamente al avanzar en el plan de estudios.';
  }
  return `Logros desbloqueados automáticamente al avanzar en el ${lowerFirst(cleanPlanName)}.`;
}

// ── PPS Card Texts ──────────────────────────────────────────────────────────

export function getPpsMilestoneTitle(config?: Partial<PlanConfig> | null): string {
  const label = trimOrEmpty(config?.ppsRequirement?.label);
  return label || DEFAULT_FALLBACK_PPS_LABEL;
}

export function getPpsMilestoneDesc(): string {
  return DEFAULT_FALLBACK_PPS_DESC;
}

// ── Intermediate Degree Texts ───────────────────────────────────────────────

export function getIntermediateDegreeShortLabel(degree: Pick<PlanIntermediateDegree, 'name'>): string {
  const firstWord = trimOrEmpty(degree.name).split(/\s+/)[0];
  return firstWord || 'Intermedio';
}

function getIntermediateSpecialSubject(
  degree: PlanIntermediateDegree,
  subjects: Subject[]
): Subject | undefined {
  if (degree.specialRuleSubjectCode === undefined) return undefined;
  return subjects.find((s) => s.id === degree.specialRuleSubjectCode);
}

function getIntermediateRangeRule(
  degree: PlanIntermediateDegree,
  rules: PlanSpecialRule[]
): PlanSpecialRule | undefined {
  if (degree.specialRuleSubjectCode !== undefined) {
    const bySubject = rules.find(
      (r) => r.subjectCode === degree.specialRuleSubjectCode && r.ruleType === 'approved_range'
    );
    if (bySubject) return bySubject;
  }
  return rules.find((r) => r.ruleType === 'approved_range');
}

export function getIntermediateRangeBounds(
  degree: PlanIntermediateDegree,
  rules: PlanSpecialRule[],
  subjects: Subject[]
): { fromCode: number; toCode: number; totalCount: number } | null {
  const rangeRule = getIntermediateRangeRule(degree, rules);
  const fromCode = typeof rangeRule?.params?.fromCode === 'number' ? rangeRule.params.fromCode : null;
  const toCode = typeof rangeRule?.params?.toCode === 'number' ? rangeRule.params.toCode : null;
  if (fromCode === null || toCode === null) return null;

  const matchedCore = subjects.filter((s) => !s.isElective && s.id >= fromCode && s.id <= toCode);
  const totalCount = matchedCore.length > 0 ? matchedCore.length : Math.max(0, toCode - fromCode + 1);
  return { fromCode, toCode, totalCount };
}

export function getIntermediateDegreeToggleShortLabel(degree: PlanIntermediateDegree): string {
  const shortLabel = getIntermediateDegreeShortLabel(degree);
  return degree.specialRuleSubjectCode !== undefined
    ? `${shortLabel} (${degree.specialRuleSubjectCode})`
    : shortLabel;
}

export function getIntermediateDegreeToggleDropdownLabel(degree: PlanIntermediateDegree): string {
  const shortLabel = getIntermediateDegreeShortLabel(degree);
  return degree.specialRuleSubjectCode !== undefined
    ? `Título ${shortLabel} (${degree.specialRuleSubjectCode})`
    : `Título ${shortLabel}`;
}

/**
 * Returns the concise catalog label of a subject (`shortName` when present, otherwise `name`).
 */
export function getSubjectConciseName(subj: Pick<Subject, 'name' | 'shortName'>): string {
  return trimOrEmpty(subj.shortName) || trimOrEmpty(subj.name);
}

export function getIntermediateDegreeToggleTooltip(
  degree: PlanIntermediateDegree,
  subjects: Subject[],
  enabled: boolean
): string {
  const shortLabel = getIntermediateDegreeShortLabel(degree);
  const specialSubj = getIntermediateSpecialSubject(degree, subjects);
  const subjectPrefix = specialSubj ? `${getSubjectConciseName(specialSubj)} y ` : '';
  const stateLabel = enabled
    ? 'ACTIVADO (Click para desactivar)'
    : 'DESACTIVADO (Click para activar)';
  return `${subjectPrefix}Título ${shortLabel}: ${stateLabel}`;
}

export function getIntermediateDegreeMobileSubtitle(
  degree: PlanIntermediateDegree,
  subjects: Subject[]
): string {
  const specialSubj = getIntermediateSpecialSubject(degree, subjects);
  const reqCredits = degree.requiredElectiveCredits ?? 0;
  const parts: string[] = [];
  if (specialSubj) parts.push(getSubjectConciseName(specialSubj));
  if (reqCredits > 0) parts.push(`${reqCredits} cr. electivas`);
  return parts.join(' y ') || 'Seguimiento de título intermedio';
}

export function getIntermediateDegreeMilestoneTitle(degree: PlanIntermediateDegree): string {
  return `Título Intermedio: ${trimOrEmpty(degree.name) || 'Título Intermedio'}`;
}

export function getIntermediateDegreeCardHeading(degree: PlanIntermediateDegree): string {
  return `Título Intermedio: ${trimOrEmpty(degree.name) || 'Título Intermedio'}`;
}

export function getIntermediateDegreeMilestoneDesc(
  degree: PlanIntermediateDegree,
  rules: PlanSpecialRule[],
  subjects: Subject[]
): string {
  const bounds = getIntermediateRangeBounds(degree, rules, subjects);
  const specialSubj = getIntermediateSpecialSubject(degree, subjects);
  const reqCredits = degree.requiredElectiveCredits ?? 0;

  const parts: string[] = [];
  if (bounds) {
    parts.push(`Materias ${bounds.fromCode} a ${bounds.toCode}`);
  }
  if (specialSubj) {
    parts.push(`${getSubjectConciseName(specialSubj)} ${specialSubj.code}`);
  }
  if (reqCredits > 0) {
    parts.push(`${reqCredits} créditos de electivas`);
  }
  return parts.join(' + ') || trimOrEmpty(degree.name);
}

export function getIntermediateDegreeRangeLabel(
  degree: PlanIntermediateDegree,
  rules: PlanSpecialRule[],
  subjects: Subject[]
): string {
  const bounds = getIntermediateRangeBounds(degree, rules, subjects);
  return bounds ? `Materias ${bounds.fromCode} a ${bounds.toCode}:` : 'Materias requeridas:';
}

export function getIntermediateDegreeRangeProgressText(
  degree: PlanIntermediateDegree,
  rules: PlanSpecialRule[],
  subjects: Subject[],
  missingCount: number
): string {
  const bounds = getIntermediateRangeBounds(degree, rules, subjects);
  const total = bounds ? bounds.totalCount : 0;
  if (total === 0) {
    return missingCount === 0 ? 'Completado' : `Faltan ${missingCount}`;
  }
  const done = Math.max(0, total - missingCount);
  return `${done} / ${total} aprobadas`;
}

export function getIntermediateDegreeSpecialSubjectLabel(
  degree: PlanIntermediateDegree,
  subjects: Subject[]
): string | null {
  const specialSubj = getIntermediateSpecialSubject(degree, subjects);
  if (!specialSubj) return null;
  return `${getSubjectConciseName(specialSubj)} (${specialSubj.code}):`;
}

export function getIntermediateDegreeCreditsValueLabel(
  approvedCredits: number,
  degree: PlanIntermediateDegree
): string {
  const reqCredits = degree.requiredElectiveCredits ?? 0;
  return `${approvedCredits} / ${reqCredits} cr (aprobados)`;
}

// ── Levels & Demo Labels ────────────────────────────────────────────────────

export function getLevelNumbers(config?: Partial<PlanConfig> | null): number[] {
  const total =
    typeof config?.totalLevels === 'number' && Number.isFinite(config.totalLevels) && config.totalLevels >= 1
      ? Math.trunc(config.totalLevels)
      : 5;
  return Array.from({ length: total }, (_, idx) => idx + 1);
}

export function getLevelProgressRowLabel(level: number, config?: Partial<PlanConfig> | null): string {
  const label = trimOrEmpty(config?.levelLabel) || DEFAULT_FALLBACK_LEVEL_LABEL;
  return `Nivel ${level} (${label} ${level})`;
}

export function getLevelOrdinalTabLabel(level: number, config?: Partial<PlanConfig> | null): string {
  const label = trimOrEmpty(config?.levelLabel) || DEFAULT_FALLBACK_LEVEL_LABEL;
  return `${level}° ${label}`;
}

export function getElectivesAssignedHeading(level: number, config?: Partial<PlanConfig> | null): string {
  const label = trimOrEmpty(config?.levelLabel) || DEFAULT_FALLBACK_LEVEL_LABEL;
  return `Electivas asignadas a ${level}° ${label}`;
}

export function getElectivesSuggestedLevelsFootnote(
  electives: Pick<Subject, 'level'>[],
  career?: Partial<PlanCareerMeta> | null
): string {
  const distinctLevels = Array.from(
    new Set(electives.map((e) => e.level).filter((l) => Number.isFinite(l) && l > 0))
  ).sort((a, b) => a - b);

  const levelsPart =
    distinctLevels.length > 0 ? `(${distinctLevels.map((lvl) => `${lvl}°`).join(', ')}) ` : '';
  const instCode = trimOrEmpty(career?.institutionCode);
  const instSuffix = instCode ? `de la ${instCode}` : 'del plan de estudios';
  return `* Los niveles ${levelsPart}de las electivas son solo sugerencias académicas ${instSuffix}.`;
}

export function getDemoTargetLevel(config?: Partial<PlanConfig> | null): number {
  const total =
    typeof config?.totalLevels === 'number' && Number.isFinite(config.totalLevels) && config.totalLevels >= 1
      ? Math.trunc(config.totalLevels)
      : 5;
  return Math.ceil(total / 2);
}

export function getDemoNavbarLabel(config?: Partial<PlanConfig> | null): string {
  const demoLevel = getDemoTargetLevel(config);
  const labelLower = lowerFirst(trimOrEmpty(config?.levelLabel) || DEFAULT_FALLBACK_LEVEL_LABEL);
  return `Cargar demo (${formatSpanishOrdinal(demoLevel)} ${labelLower})`;
}

export function getDemoOnboardingLabel(config?: Partial<PlanConfig> | null): string {
  const demoLevel = getDemoTargetLevel(config);
  const labelLower = lowerFirst(trimOrEmpty(config?.levelLabel) || DEFAULT_FALLBACK_LEVEL_LABEL);
  return `Cargar demo: Alumno de ${formatSpanishOrdinal(demoLevel)} ${labelLower}`;
}

// ── Schedule Header & ICS Export Metadata ───────────────────────────────────

export function getSchedulePlanHeaderTag(plan?: ActivePlanCatalog | null): string {
  if (!plan) return 'Plan de Estudios';
  const instCode = trimOrEmpty(plan.career?.institutionCode);
  const careerCode = trimOrEmpty(plan.career?.code);
  const planName = trimOrEmpty(plan.plan?.name);
  const left = [instCode, careerCode].filter(Boolean).join(' ');
  if (left && planName) return `${left} (${planName})`;
  if (left) return left;
  if (planName) return planName;
  return trimOrEmpty(plan.plan?.config?.shortTag) || trimOrEmpty(plan.career?.name) || 'Plan de Estudios';
}

export function getScheduleClipboardHeader(plan?: ActivePlanCatalog | null): string {
  return `📅 MI HORARIO DE CURSADA — ${getSchedulePlanHeaderTag(plan)}\n`;
}

export function getScheduleIcsFilename(
  career?: Partial<PlanCareerMeta> | null,
  dateIso?: string
): string {
  const rawInst = trimOrEmpty(career?.institutionCode);
  const slug = rawInst
    ? rawInst.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'cursada'
    : 'cursada';
  const datePart = dateIso || new Date().toISOString().slice(0, 10);
  return `horarios-${slug}-${datePart}.ics`;
}

export function getScheduleIcsUidDomain(career?: Partial<PlanCareerMeta> | null): string {
  const rawInst = trimOrEmpty(career?.institutionCode);
  const slug = rawInst
    ? rawInst.toLowerCase().replace(/[^a-z0-9-]+/g, '') || 'local'
    : 'local';
  return `@micarrera.${slug}`;
}

// ── Library Career Copy (preserving legal text structure) ───────────────────

export function getLibraryHeroDescription(career?: Partial<PlanCareerMeta> | null): string {
  const careerName = trimOrEmpty(career?.name);
  const audience = careerName ? `estudiantes de ${careerName}` : 'tu carrera';
  return `Exámenes parciales y finales, resoluciones, apuntes y resúmenes compartidos por y para ${audience}.`;
}

/**
 * Replaces only the career community phrase in `LibraryTermsPage` while keeping the legal
 * wording untouched for future legal review.
 */
export function getLibraryTermsIntroParagraph(
  career?: Partial<PlanCareerMeta> | null,
  appName: string = APP_NAME
): string {
  const careerName = trimOrEmpty(career?.name);
  const community = careerName
    ? `la comunidad estudiantil de ${careerName}`
    : 'la comunidad estudiantil';
  return `La Biblioteca de ${appName} es un espacio colaborativo desarrollado para ${community}, cuyo único propósito es facilitar el intercambio académico libre y sin costo de recursos de aprendizaje.`;
}

// ── Plan-Aware Tutorial Steps ───────────────────────────────────────────────

/**
 * Generates localized tutorial steps from the active catalog metadata without altering
 * step IDs, selectors, or non-plan-specific tour steps.
 */
export function buildPlanTutorialSteps(
  baseSteps: TutorialStep[],
  plan?: ActivePlanCatalog | null
): TutorialStep[] {
  if (!plan) return baseSteps;

  const config = plan.plan.config;
  const totalLevels =
    typeof config.totalLevels === 'number' && Number.isFinite(config.totalLevels) && config.totalLevels >= 1
      ? Math.trunc(config.totalLevels)
      : 5;
  const levelLabel = trimOrEmpty(config.levelLabel) || DEFAULT_FALLBACK_LEVEL_LABEL;
  const levelLower = lowerFirst(levelLabel);
  const pluralLevelLower = pluralizeLevelLabelLower(levelLabel);
  const reqCredits = config.requiredElectiveCredits ?? 0;
  const finalDegreeTitle = trimOrEmpty(config.finalDegreeTitle);
  const primaryDegree = config.intermediateDegrees?.[0];
  const hasElectives = reqCredits > 0 || plan.subjects.some((s) => s.isElective);

  const output: TutorialStep[] = [];

  for (const step of baseSteps) {
    if (step.id === 'graph-overview') {
      output.push({
        ...step,
        description: `Cada nodo es una materia del plan oficial y las ${totalLevels} columnas representan los ${pluralLevelLower} de la carrera (1° a ${totalLevels}° ${levelLower}). Podés arrastrar el lienzo y hacer zoom con la rueda del mouse.`,
      });
      continue;
    }

    if (step.id === 'electives-tour') {
      if (!hasElectives) continue;
      const degreeClause =
        reqCredits > 0
          ? finalDegreeTitle
            ? ` Para el título de ${finalDegreeTitle} se requieren ${reqCredits} créditos en total.`
            : ` Se requieren ${reqCredits} créditos en total.`
          : '';
      const titleSuffix = reqCredits > 0 ? ` (Total ${reqCredits} cr)` : '';
      output.push({
        ...step,
        title: `Electivas Libres por ${levelLabel}${titleSuffix}`,
        description: `Sin cupos rígidos por nivel: podés agregar cualquier electiva en cualquier ${levelLower} donde cumplas sus correlativas.${degreeClause}`,
      });
      continue;
    }

    if (step.id === 'analista-switch') {
      if (!primaryDegree) continue;
      const shortLabel = getIntermediateDegreeShortLabel(primaryDegree);
      const specialSubj = getIntermediateSpecialSubject(primaryDegree, plan.subjects);
      const degCredits = primaryDegree.requiredElectiveCredits ?? 0;
      const subjectPart = specialSubj
        ? `Hará visible el ${getSubjectConciseName(specialSubj)} (${specialSubj.code})`
        : 'Habilitará el trayecto específico';
      const creditsPart =
        degCredits > 0
          ? specialSubj
            ? ` y habilitará el seguimiento con sus ${degCredits} créditos de electivas requeridos`
            : ` con sus ${degCredits} créditos de electivas requeridos`
          : ' y habilitará el seguimiento del título intermedio';
      output.push({
        ...step,
        title: `Título Intermedio de ${shortLabel}`,
        description: `Si querés tramitar el título intermedio, activá este interruptor. ${subjectPart}${creditsPart}.`,
      });
      continue;
    }

    output.push(step);
  }

  return output;
}
