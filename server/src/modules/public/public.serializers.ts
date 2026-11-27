import type { CatalogStore } from '../catalog/catalog.store.js';
import {
  formatPlanCatalogPayload,
  sanitizeSummaryPlanConfig,
} from '../catalog/planConfig.helpers.js';
import { MIN_REVIEWS_TO_SHOW_ATTENDED_PERIOD } from '../../config/reviews.config.js';
import type { PlanSubjectRef, StoredReview } from '../reviews/reviews.store.js';
import type { PublicAggregatePayload } from '../reviews/reviews.service.js';
import { formatPublishedMonthYear } from '../reviews/reviews.service.js';

export type PublicCatalogTreeSources = Awaited<ReturnType<CatalogStore['getPublishedTreeSources']>>;
export type PublicFormattedPlanPayload = ReturnType<typeof formatPlanCatalogPayload>;

export interface PublicSummaryPlanConfig {
  requiredElectiveCredits: number;
  defaultMinPassingGrade: number;
  electiveSlotsEquivalent: number;
  totalLevels?: number;
  levelLabel: string;
  shortTag: string;
  finalDegreeTitle?: string;
  intermediateDegrees: Array<{
    key: string;
    name: string;
    shortLabel?: string;
    shortTitle?: string;
    criteria?: unknown;
  }>;
  ppsRequirement: {
    referenceSubjectCode: number;
    label?: string;
    description?: string;
  } | null;
}

function serializeIntermediateDegrees(
  rawList: unknown
): PublicSummaryPlanConfig['intermediateDegrees'] {
  if (!Array.isArray(rawList)) return [];
  const out: PublicSummaryPlanConfig['intermediateDegrees'] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const deg = item as Record<string, unknown>;
    if (typeof deg.key !== 'string' || typeof deg.name !== 'string') continue;
    const entry: PublicSummaryPlanConfig['intermediateDegrees'][number] = {
      key: deg.key,
      name: deg.name,
    };
    if (typeof deg.shortLabel === 'string' && deg.shortLabel.trim()) {
      entry.shortLabel = deg.shortLabel;
    }
    if (typeof deg.shortTitle === 'string' && deg.shortTitle.trim()) {
      entry.shortTitle = deg.shortTitle;
    }
    if (deg.criteria && typeof deg.criteria === 'object') {
      entry.criteria = structuredClone(deg.criteria);
    }
    out.push(entry);
  }
  return out;
}

function serializePpsRequirement(
  rawPps: unknown
): PublicSummaryPlanConfig['ppsRequirement'] {
  if (!rawPps || typeof rawPps !== 'object') return null;
  const pps = rawPps as Record<string, unknown>;
  if (typeof pps.referenceSubjectCode !== 'number') return null;
  const out: NonNullable<PublicSummaryPlanConfig['ppsRequirement']> = {
    referenceSubjectCode: pps.referenceSubjectCode,
  };
  if (typeof pps.label === 'string' && pps.label.trim()) {
    out.label = pps.label;
  }
  if (typeof pps.description === 'string' && pps.description.trim()) {
    out.description = pps.description;
  }
  return out;
}

function serializeSummaryConfig(
  rawConfig: Record<string, unknown>,
  context: { careerCode: string; planName: string }
): PublicSummaryPlanConfig {
  const sanitized = sanitizeSummaryPlanConfig(rawConfig, context) as Record<string, unknown>;
  const out: PublicSummaryPlanConfig = {
    requiredElectiveCredits: Number(sanitized.requiredElectiveCredits ?? 0),
    defaultMinPassingGrade: Number(sanitized.defaultMinPassingGrade ?? 4),
    electiveSlotsEquivalent: Number(sanitized.electiveSlotsEquivalent ?? 0),
    levelLabel: String(sanitized.levelLabel || 'Año'),
    shortTag: String(sanitized.shortTag || context.planName),
    intermediateDegrees: serializeIntermediateDegrees(sanitized.intermediateDegrees),
    ppsRequirement: serializePpsRequirement(sanitized.ppsRequirement),
  };
  if (typeof sanitized.totalLevels === 'number' && Number.isFinite(sanitized.totalLevels)) {
    out.totalLevels = sanitized.totalLevels;
  }
  if (typeof sanitized.finalDegreeTitle === 'string' && sanitized.finalDegreeTitle.trim()) {
    out.finalDegreeTitle = sanitized.finalDegreeTitle;
  }
  return out;
}

export function serializePublicCatalogTree(sources: PublicCatalogTreeSources) {
  return sources.institutions
    .map((inst) => ({
      id: inst.id,
      name: inst.name,
      code: inst.code,
      faculties: sources.faculties
        .filter((f) => f.institutionId === inst.id)
        .map((fac) => ({
          id: fac.id,
          name: fac.name,
          code: fac.code,
          careers: sources.careers
            .filter((c) => c.facultyId === fac.id)
            .map((car) => ({
              id: car.id,
              name: car.name,
              code: car.code,
              plans: sources.plans
                .filter((p) => p.careerId === car.id)
                .map((p) => ({
                  id: p.id,
                  name: p.name,
                  year: p.year,
                  config: serializeSummaryConfig(p.config, {
                    careerCode: car.code,
                    planName: p.name,
                  }),
                })),
            }))
            .filter((car) => car.plans.length > 0),
        }))
        .filter((fac) => fac.careers.length > 0),
    }))
    .filter((inst) => inst.faculties.length > 0);
}

export function serializePublicPlanCatalog(formatted: PublicFormattedPlanPayload) {
  const cfg = formatted.plan.config;
  const planConfig: PublicSummaryPlanConfig & { totalLevels: number } = {
    requiredElectiveCredits: cfg.requiredElectiveCredits,
    defaultMinPassingGrade: cfg.defaultMinPassingGrade,
    electiveSlotsEquivalent: cfg.electiveSlotsEquivalent,
    totalLevels: cfg.totalLevels,
    levelLabel: cfg.levelLabel,
    shortTag: cfg.shortTag,
    intermediateDegrees: serializeIntermediateDegrees(cfg.intermediateDegrees),
    ppsRequirement: serializePpsRequirement(cfg.ppsRequirement),
  };
  if (typeof cfg.finalDegreeTitle === 'string' && cfg.finalDegreeTitle.trim()) {
    planConfig.finalDegreeTitle = cfg.finalDegreeTitle;
  }

  const careerOut: {
    id: string;
    name: string;
    code: string;
    facultyId: string;
    facultyCode?: string;
    facultyName?: string;
    institutionCode?: string;
    institutionName?: string;
  } = {
    id: formatted.career.id,
    name: formatted.career.name,
    code: formatted.career.code,
    facultyId: formatted.career.facultyId,
  };
  if (formatted.career.facultyCode) careerOut.facultyCode = formatted.career.facultyCode;
  if (formatted.career.facultyName) careerOut.facultyName = formatted.career.facultyName;
  if (formatted.career.institutionCode) careerOut.institutionCode = formatted.career.institutionCode;
  if (formatted.career.institutionName) careerOut.institutionName = formatted.career.institutionName;

  const subjectsOut = formatted.subjects.map((s) => {
    const row: {
      id: number;
      uuid: string;
      code: string;
      shortName: string;
      name: string;
      level: number;
      modality: string;
      contraCuatrimestral: boolean;
      weeklyHours: number;
      isElective: boolean;
      kind: 'electiva' | 'obligatoria';
      credits?: number;
      isOptionalTrack: boolean;
      trackKey?: string;
      isIntegrator?: boolean;
      specialRule?: string;
      regularPrereqs: number[];
      approvedPrereqs: number[];
    } = {
      id: s.id,
      uuid: s.uuid,
      code: s.code,
      shortName: s.shortName,
      name: s.name,
      level: s.level,
      modality: s.modality,
      contraCuatrimestral: Boolean(s.contraCuatrimestral),
      weeklyHours: Number(s.weeklyHours),
      isElective: Boolean(s.isElective),
      kind: s.kind === 'electiva' ? 'electiva' : 'obligatoria',
      isOptionalTrack: Boolean(s.isOptionalTrack),
      regularPrereqs: Array.isArray(s.regularPrereqs) ? [...s.regularPrereqs] : [],
      approvedPrereqs: Array.isArray(s.approvedPrereqs) ? [...s.approvedPrereqs] : [],
    };
    if (s.credits !== undefined) row.credits = s.credits;
    if (s.trackKey !== undefined) row.trackKey = s.trackKey;
    if (s.isIntegrator) row.isIntegrator = true;
    if (s.specialRule !== undefined) row.specialRule = s.specialRule;
    return row;
  });

  const acronymsOut: Record<string, number> = {};
  for (const [k, v] of Object.entries(formatted.acronyms)) {
    acronymsOut[k] = Number(v);
  }

  return {
    plan: {
      id: formatted.plan.id,
      name: formatted.plan.name,
      year: formatted.plan.year,
      config: planConfig,
      updatedAt: formatted.plan.updatedAt,
    },
    career: careerOut,
    subjects: subjectsOut,
    rules: formatted.rules.map((r) => ({
      id: r.id,
      subjectCode: r.subjectCode,
      ruleType: r.ruleType,
      params: structuredClone(r.params || {}),
      description: r.description,
    })),
    acronyms: acronymsOut,
  };
}

export function serializePublicThresholds(t: {
  minReviewsForReliableAverage: number;
  showProvisionalAverageBelowThreshold: boolean;
  minReviewsToShowAttendedPeriod: number;
  bayesianPriorGlobalMean: number;
  bayesianPriorWeight: number;
  maxNewReviewsPerDay: number;
  autoHideOpenReportsThreshold: number;
  allowedSubjectStatuses: string[];
}) {
  return {
    minReviewsForReliableAverage: t.minReviewsForReliableAverage,
    showProvisionalAverageBelowThreshold: t.showProvisionalAverageBelowThreshold,
    minReviewsToShowAttendedPeriod: t.minReviewsToShowAttendedPeriod,
    bayesianPriorGlobalMean: t.bayesianPriorGlobalMean,
    bayesianPriorWeight: t.bayesianPriorWeight,
    maxNewReviewsPerDay: t.maxNewReviewsPerDay,
    autoHideOpenReportsThreshold: t.autoHideOpenReportsThreshold,
    allowedSubjectStatuses: [...t.allowedSubjectStatuses],
  };
}

function copyDistribution(d: PublicAggregatePayload['distribution']) {
  return {
    1: d[1],
    2: d[2],
    3: d[3],
    4: d[4],
    5: d[5],
  };
}

export function serializePublicProfessorListItem(item: PublicAggregatePayload & {
  id: string;
  displayName: string;
  normalizedKey: string;
  subjects: Array<{
    subjectId: string;
    subjectCode: number;
    name: string;
    shortName: string;
    level: number;
    isCurrentTerm: boolean;
    isHistoricalLink: boolean;
  }>;
}) {
  return {
    id: item.id,
    displayName: item.displayName,
    normalizedKey: item.normalizedKey,
    reviewCount: item.reviewCount,
    hasReliableAverage: item.hasReliableAverage,
    ratingStatus: item.ratingStatus,
    averageOverall: item.averageOverall,
    bayesianScore: item.bayesianScore,
    averageClarity: item.averageClarity,
    averageTreatment: item.averageTreatment,
    averageAvailability: item.averageAvailability,
    averageDifficulty: item.averageDifficulty,
    recommendPercent: item.recommendPercent,
    recommendCount: item.recommendCount,
    recommendTotal: item.recommendTotal,
    distribution: copyDistribution(item.distribution),
    subjects: item.subjects.map((s) => ({
      subjectId: s.subjectId,
      subjectCode: s.subjectCode,
      name: s.name,
      shortName: s.shortName,
      level: s.level,
      isCurrentTerm: Boolean(s.isCurrentTerm),
      isHistoricalLink: Boolean(s.isHistoricalLink),
    })),
  };
}

export function serializePublicProfessorDetail(prof: PublicAggregatePayload & {
  id: string;
  displayName: string;
  normalizedKey: string;
  subjects: Array<
    PublicAggregatePayload & {
      subjectId: string;
      subjectCode: number;
      name: string;
      shortName: string;
      level: number;
      isCurrentTerm: boolean;
      isHistoricalLink: boolean;
      termLabels: string[];
    }
  >;
}) {
  return {
    id: prof.id,
    displayName: prof.displayName,
    normalizedKey: prof.normalizedKey,
    reviewCount: prof.reviewCount,
    hasReliableAverage: prof.hasReliableAverage,
    ratingStatus: prof.ratingStatus,
    averageOverall: prof.averageOverall,
    bayesianScore: prof.bayesianScore,
    averageClarity: prof.averageClarity,
    averageTreatment: prof.averageTreatment,
    averageAvailability: prof.averageAvailability,
    averageDifficulty: prof.averageDifficulty,
    recommendPercent: prof.recommendPercent,
    recommendCount: prof.recommendCount,
    recommendTotal: prof.recommendTotal,
    distribution: copyDistribution(prof.distribution),
    subjects: prof.subjects.map((s) => ({
      subjectId: s.subjectId,
      subjectCode: s.subjectCode,
      name: s.name,
      shortName: s.shortName,
      level: s.level,
      isCurrentTerm: Boolean(s.isCurrentTerm),
      isHistoricalLink: Boolean(s.isHistoricalLink),
      termLabels: Array.isArray(s.termLabels) ? [...s.termLabels] : [],
      reviewCount: s.reviewCount,
      hasReliableAverage: s.hasReliableAverage,
      ratingStatus: s.ratingStatus,
      averageOverall: s.averageOverall,
      bayesianScore: s.bayesianScore,
      averageClarity: s.averageClarity,
      averageTreatment: s.averageTreatment,
      averageAvailability: s.averageAvailability,
      averageDifficulty: s.averageDifficulty,
      recommendPercent: s.recommendPercent,
      recommendCount: s.recommendCount,
      recommendTotal: s.recommendTotal,
      distribution: copyDistribution(s.distribution),
    })),
  };
}

/**
 * Serializador público de reseñas con lista blanca estricta por propiedad:
 * - Excluye studentLabel, attendedDeclared, attendedPeriod, authorUserId, authorEmail,
 *   userId, professorId, status, y todos los campos viewer*.
 * - Enmascara academicYear/term si el profesor tiene < MIN_REVIEWS_TO_SHOW_ATTENDED_PERIOD (5).
 * - Trunca createdAt a "YYYY-MM" para impedir correlación temporal exacta.
 */
export function serializePublicProfessorReviewItem(params: {
  review: StoredReview;
  subject: PlanSubjectRef | undefined;
  professorPublishedReviewCount: number;
}) {
  const { review, subject, professorPublishedReviewCount } = params;
  const canShowPeriod = professorPublishedReviewCount >= MIN_REVIEWS_TO_SHOW_ATTENDED_PERIOD;
  const { publishedMonthYear } = formatPublishedMonthYear(review.createdAt);

  return {
    id: String(review.id),
    overall: Number(review.overall),
    clarity: review.clarity !== null && review.clarity !== undefined ? Number(review.clarity) : null,
    treatment:
      review.treatment !== null && review.treatment !== undefined ? Number(review.treatment) : null,
    availability:
      review.availability !== null && review.availability !== undefined
        ? Number(review.availability)
        : null,
    difficulty:
      review.difficulty !== null && review.difficulty !== undefined ? Number(review.difficulty) : null,
    wouldRecommend: typeof review.wouldRecommend === 'boolean' ? review.wouldRecommend : null,
    comment: typeof review.comment === 'string' ? review.comment : null,
    subjectId: String(review.subjectId),
    subjectCode: Number(subject?.codeInPlan || 0),
    subjectName: String(subject?.name || 'Materia de la carrera'),
    academicYear: canShowPeriod && review.academicYear !== null ? Number(review.academicYear) : null,
    term: canShowPeriod && review.term !== null ? review.term : null,
    createdAt: publishedMonthYear,
    helpfulCount: Number(review.helpfulCount || 0),
  };
}

export function truncatePublicDescription(desc: unknown, maxLength = 300): string | null {
  if (typeof desc !== 'string') return null;
  const trimmed = desc.trim();
  if (!trimmed) return null;
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength);
}

export function serializePublicLibrarySubject(sub: {
  id: string;
  name: string;
  codeInPlan: number;
  level: number;
  kind: string;
  approvedFilesCount?: number;
}) {
  return {
    id: String(sub.id),
    name: String(sub.name),
    codeInPlan: Number(sub.codeInPlan),
    level: Number(sub.level),
    kind: String(sub.kind),
    approvedFilesCount: Number(sub.approvedFilesCount || 0),
  };
}

export function serializePublicLibraryFile(file: {
  id: string;
  subjectId: string;
  subjectCode: number;
  subjectName: string;
  kind: string;
  academicYear: number | null;
  term: string | null;
  examInstance: string | null;
  hasSolution: boolean;
  title: string;
  description?: string | null;
  professors?: Array<{ id?: string; displayName?: string }>;
  professorNames?: string[];
  mimeType: string;
  sizeBytes: number;
  downloadCount: number;
  helpfulCount: number;
  createdAt: Date | string;
}) {
  const professorNames: string[] = Array.isArray(file.professorNames)
    ? file.professorNames.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
    : Array.isArray(file.professors)
    ? file.professors
        .map((p) => p?.displayName)
        .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
    : [];

  return {
    id: String(file.id),
    subjectId: String(file.subjectId),
    subjectCode: Number(file.subjectCode),
    subjectName: String(file.subjectName),
    kind: String(file.kind),
    academicYear:
      file.academicYear !== null && file.academicYear !== undefined ? Number(file.academicYear) : null,
    term: typeof file.term === 'string' ? file.term : null,
    examInstance: typeof file.examInstance === 'string' ? file.examInstance : null,
    hasSolution: Boolean(file.hasSolution),
    title: String(file.title),
    description: truncatePublicDescription(file.description, 300),
    professorNames,
    mimeType: String(file.mimeType),
    sizeBytes: Number(file.sizeBytes),
    downloadCount: Number(file.downloadCount || 0),
    helpfulCount: Number(file.helpfulCount || 0),
    createdAt: file.createdAt instanceof Date ? file.createdAt.toISOString() : String(file.createdAt),
  };
}
