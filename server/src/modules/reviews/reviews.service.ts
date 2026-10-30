import {
  ALLOWED_REVIEW_SUBJECT_STATUSES,
  AUTO_HIDE_OPEN_REPORTS_THRESHOLD,
  BAYESIAN_PRIOR_GLOBAL_MEAN,
  BAYESIAN_PRIOR_WEIGHT,
  MAX_NEW_REVIEWS_PER_USER_PER_DAY,
  MIN_REVIEWS_FOR_RELIABLE_AVERAGE,
  MIN_REVIEWS_TO_SHOW_ATTENDED_PERIOD,
  SHOW_PROVISIONAL_AVERAGE_BELOW_THRESHOLD,
} from '../../config/reviews.config.js';
import {
  analyzeProfessorNames,
  normalizeTextTokenizable,
  parseProfessorName,
} from '../professors/professorNormalizer.js';
import {
  sanitizePlainText,
  validateAndSanitizeReviewComment,
} from './contentFilter.js';
import {
  ComputedAggregate,
  emptyAggregate,
  PlanSubjectRef,
  ReportReason,
  ReviewsStore,
  ReviewStatus,
  StoredReview,
} from './reviews.store.js';

const SPANISH_MONTHS_SHORT = [
  'ene.',
  'feb.',
  'mar.',
  'abr.',
  'may.',
  'jun.',
  'jul.',
  'ago.',
  'sep.',
  'oct.',
  'nov.',
  'dic.',
];

export function formatPublishedMonthYear(date: Date): {
  publishedMonthYear: string;
  publishedLabel: string;
} {
  const year = date.getUTCFullYear();
  const monthIdx = date.getUTCMonth();
  const mm = String(monthIdx + 1).padStart(2, '0');
  return {
    publishedMonthYear: `${year}-${mm}`,
    publishedLabel: `${SPANISH_MONTHS_SHORT[monthIdx]} ${year}`,
  };
}

/**
 * Calcula el puntaje bayesiano para ordenar rankings:
 *   score = (v * R + m * C) / (v + m)
 */
export function calculateBayesianScore(
  reviewCount: number,
  rawAverage: number | null,
  priorMean: number = BAYESIAN_PRIOR_GLOBAL_MEAN,
  priorWeight: number = BAYESIAN_PRIOR_WEIGHT
): number {
  if (reviewCount <= 0 || rawAverage === null) return 0;
  const score = (reviewCount * rawAverage + priorWeight * priorMean) / (reviewCount + priorWeight);
  return Math.round(score * 1000) / 1000;
}

export interface PublicAggregatePayload {
  reviewCount: number;
  hasReliableAverage: boolean;
  ratingStatus: 'sin_resenas' | 'pocas_resenas' | 'confiable';
  averageOverall: number | null;
  bayesianScore: number;
  averageClarity: number | null;
  averageTreatment: number | null;
  averageAvailability: number | null;
  averageDifficulty: number | null;
  recommendPercent: number | null;
  recommendCount: number;
  recommendTotal: number;
  distribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
}

export function formatPublicAggregate(
  agg: ComputedAggregate,
  showProvisionalAverage: boolean = SHOW_PROVISIONAL_AVERAGE_BELOW_THRESHOLD
): PublicAggregatePayload {
  const hasReliableAverage = agg.reviewCount >= MIN_REVIEWS_FOR_RELIABLE_AVERAGE;
  const ratingStatus: 'sin_resenas' | 'pocas_resenas' | 'confiable' =
    agg.reviewCount === 0
      ? 'sin_resenas'
      : hasReliableAverage
      ? 'confiable'
      : 'pocas_resenas';

  const canExposeOverallAverage =
    agg.reviewCount > 0 && (hasReliableAverage || showProvisionalAverage);

  return {
    reviewCount: agg.reviewCount,
    hasReliableAverage,
    ratingStatus,
    averageOverall: canExposeOverallAverage ? agg.avgOverall : null,
    bayesianScore: calculateBayesianScore(agg.reviewCount, agg.avgOverall),
    averageClarity: hasReliableAverage ? agg.avgClarity : null,
    averageTreatment: hasReliableAverage ? agg.avgTreatment : null,
    averageAvailability: hasReliableAverage ? agg.avgAvailability : null,
    averageDifficulty: hasReliableAverage ? agg.avgDifficulty : null,
    recommendPercent: hasReliableAverage ? agg.recommendPercent : null,
    recommendCount: agg.recommendCount,
    recommendTotal: agg.recommendTotal,
    distribution: { ...agg.distribution },
  };
}

export interface PublicReviewPayload {
  id: string;
  professorId: string;
  subjectId: string;
  subjectCode: number;
  subjectName: string;
  studentLabel: string;
  academicYear: number | null;
  term: '1C' | '2C' | 'A' | null;
  attendedPeriod: string | null;
  attendedDeclared: boolean;
  overall: number;
  clarity: number | null;
  treatment: number | null;
  availability: number | null;
  difficulty: number | null;
  wouldRecommend: boolean | null;
  comment: string | null;
  helpfulCount: number;
  viewerHasVotedHelpful: boolean;
  viewerHasReported: boolean;
  publishedMonthYear: string;
  publishedLabel: string;
}

/**
 * Serializador estricto de anonimato:
 * - Jamás expone `userId`, `email` ni timestamps exactos (`createdAt`/`updatedAt`).
 * - Solo emite mes y año de publicación (`YYYY-MM` + etiqueta legible).
 * - Si el profesor tiene menos de 5 reseñas publicadas (`MIN_REVIEWS_TO_SHOW_ATTENDED_PERIOD`),
 *   oculta por completo `academicYear`, `term` y `attendedPeriod` (`null`).
 */
export function serializePublicReview(params: {
  review: StoredReview;
  subject: PlanSubjectRef | undefined;
  professorPublishedReviewCount: number;
  viewerHasVotedHelpful?: boolean;
  viewerHasReported?: boolean;
}): PublicReviewPayload {
  const { review, subject, professorPublishedReviewCount } = params;
  const subjectName = subject?.name || 'Materia de la carrera';
  const subjectCode = subject?.codeInPlan || 0;
  const { publishedMonthYear, publishedLabel } = formatPublishedMonthYear(review.createdAt);

  const canShowAttendedPeriod =
    professorPublishedReviewCount >= MIN_REVIEWS_TO_SHOW_ATTENDED_PERIOD;

  const safeYear = canShowAttendedPeriod ? review.academicYear : null;
  const safeTerm = canShowAttendedPeriod ? review.term : null;

  let attendedPeriod: string | null = null;
  if (canShowAttendedPeriod && (safeYear || safeTerm)) {
    if (safeYear && safeTerm) {
      attendedPeriod = `${safeYear} · ${safeTerm === 'A' ? 'Anual' : safeTerm}`;
    } else if (safeYear) {
      attendedPeriod = String(safeYear);
    } else if (safeTerm) {
      attendedPeriod = safeTerm === 'A' ? 'Anual' : safeTerm;
    }
  }

  return {
    id: review.id,
    professorId: review.professorId,
    subjectId: review.subjectId,
    subjectCode,
    subjectName,
    studentLabel: `Estudiante de ${subjectName}`,
    academicYear: safeYear,
    term: safeTerm,
    attendedPeriod,
    attendedDeclared: Boolean(review.attendedDeclared),
    overall: review.overall,
    clarity: review.clarity,
    treatment: review.treatment,
    availability: review.availability,
    difficulty: review.difficulty,
    wouldRecommend: review.wouldRecommend,
    comment: review.comment,
    helpfulCount: review.helpfulCount,
    viewerHasVotedHelpful: Boolean(params.viewerHasVotedHelpful),
    viewerHasReported: Boolean(params.viewerHasReported),
    publishedMonthYear,
    publishedLabel,
  };
}

function appError(message: string, status: number, code?: string): Error {
  const err = new Error(message);
  (err as any).status = status;
  if (code) (err as any).code = code;
  return err;
}

export class ReviewsService {
  constructor(private readonly store: ReviewsStore) {}

  async listProfessors(params: {
    userId: string;
    planId?: string | null;
    search?: string;
    subjectId?: string;
    minRating?: number;
    withReviewsOnly?: boolean;
    sort?: 'rating' | 'reviews' | 'name';
  }) {
    const ctx = await this.store.resolvePlanContext(params.userId, params.planId);
    if (!ctx) {
      return { professors: [], thresholds: this.getThresholdsMeta() };
    }

    const [facultyProfessors, teachingPairs] = await Promise.all([
      this.store.listFacultyProfessors(ctx.facultyId),
      this.store.getTeachingPairsForPlan(ctx.planId, ctx.facultyId),
    ]);

    const pairsByProf = new Map<string, typeof teachingPairs>();
    for (const pair of teachingPairs) {
      const list = pairsByProf.get(pair.professorId) || [];
      list.push(pair);
      pairsByProf.set(pair.professorId, list);
    }

    // Incluir docentes vinculados al plan del usuario (o todos los de la facultad si no hubiera pares cargados aún)
    const relevantProfessors =
      teachingPairs.length > 0
        ? facultyProfessors.filter((p) => pairsByProf.has(p.id))
        : facultyProfessors;

    const profIds = relevantProfessors.map((p) => p.id);
    const statsMap = await this.store.getProfessorStatsMap(profIds);

    let targetSubjectUuid: string | null = null;
    if (params.subjectId && params.subjectId.trim()) {
      const resolvedSub = await this.store.getSubjectByIdOrCode(
        ctx.planId,
        params.subjectId.trim()
      );
      if (!resolvedSub) {
        return { professors: [], thresholds: this.getThresholdsMeta() };
      }
      targetSubjectUuid = resolvedSub.id;
    }

    const searchNorm = params.search ? normalizeTextTokenizable(params.search) : '';
    const searchTokens = searchNorm ? searchNorm.split(' ').filter(Boolean) : [];

    let items = relevantProfessors.map((p) => {
      const agg = statsMap.get(p.id) || emptyAggregate();
      const pubAgg = formatPublicAggregate(agg);
      const subjectsTaught = (pairsByProf.get(p.id) || [])
        .map((tp) => ({
          subjectId: tp.subjectId,
          subjectCode: tp.subjectCode,
          name: tp.subjectName,
          shortName: tp.subjectShortName,
          level: tp.subjectLevel,
          isCurrentTerm: tp.isCurrentTerm,
          isHistoricalLink: tp.isHistoricalLink,
        }))
        .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'es'));

      return {
        id: p.id,
        displayName: p.displayName,
        normalizedKey: p.normalizedKey,
        ...pubAgg,
        subjects: subjectsTaught,
      };
    });

    if (targetSubjectUuid) {
      items = items.filter((item) => item.subjects.some((s) => s.subjectId === targetSubjectUuid));
    }

    if (searchTokens.length > 0) {
      items = items.filter((item) => {
        const profText = `${normalizeTextTokenizable(item.displayName)} ${item.normalizedKey}`;
        const subText = item.subjects
          .map((s) => `${normalizeTextTokenizable(s.name)} ${normalizeTextTokenizable(s.shortName)}`)
          .join(' ');
        const combined = `${profText} ${subText}`;
        return searchTokens.every((tok) => combined.includes(tok));
      });
    }

    if (params.withReviewsOnly) {
      items = items.filter((item) => item.reviewCount > 0);
    }

    if (params.minRating !== undefined && !Number.isNaN(params.minRating) && params.minRating > 0) {
      items = items.filter(
        (item) => item.averageOverall !== null && item.averageOverall >= params.minRating!
      );
    }

    const sortMode = params.sort || 'rating';
    items.sort((a, b) => {
      if (sortMode === 'name') {
        return a.displayName.localeCompare(b.displayName, 'es');
      }
      if (sortMode === 'reviews') {
        if (b.reviewCount !== a.reviewCount) return b.reviewCount - a.reviewCount;
        if (b.bayesianScore !== a.bayesianScore) return b.bayesianScore - a.bayesianScore;
        return a.displayName.localeCompare(b.displayName, 'es');
      }
      // Default: 'rating' -> Promedio Bayesiano descendente
      if (b.bayesianScore !== a.bayesianScore) return b.bayesianScore - a.bayesianScore;
      if (b.reviewCount !== a.reviewCount) return b.reviewCount - a.reviewCount;
      return a.displayName.localeCompare(b.displayName, 'es');
    });

    return {
      professors: items,
      thresholds: this.getThresholdsMeta(),
    };
  }

  async getProfessorDetail(params: {
    userId: string;
    planId?: string | null;
    professorId: string;
  }) {
    const found = await this.store.getProfessorById(params.professorId);
    if (!found) {
      throw appError('Profesor no encontrado', 404);
    }

    const ctx = await this.store.resolvePlanContext(params.userId, params.planId);
    const [statsMap, subStatsMap, teachingPairs] = await Promise.all([
      this.store.getProfessorStatsMap([params.professorId]),
      this.store.getProfessorSubjectStatsMap(params.professorId),
      ctx
        ? this.store.getTeachingPairsForPlan(ctx.planId, found.professor.facultyId)
        : Promise.resolve([]),
    ]);

    const overallAgg = formatPublicAggregate(
      statsMap.get(params.professorId) || emptyAggregate()
    );

    const profPairs = teachingPairs.filter((tp) => tp.professorId === params.professorId);
    const allSubIds = Array.from(
      new Set([...profPairs.map((p) => p.subjectId), ...Array.from(subStatsMap.keys())])
    );
    const subInfoMap = await this.store.getSubjectsByIds(allSubIds);

    const subjectBreakdown = allSubIds
      .map((subId) => {
        const sub = subInfoMap.get(subId);
        const pair = profPairs.find((p) => p.subjectId === subId);
        const subAgg = formatPublicAggregate(subStatsMap.get(subId) || emptyAggregate());
        return {
          subjectId: subId,
          subjectCode: sub?.codeInPlan || pair?.subjectCode || 0,
          name: sub?.name || pair?.subjectName || 'Materia',
          shortName: sub?.shortName || pair?.subjectShortName || 'Materia',
          level: sub?.level || pair?.subjectLevel || 1,
          isCurrentTerm: pair?.isCurrentTerm ?? false,
          isHistoricalLink: pair?.isHistoricalLink ?? false,
          termLabels: pair?.termLabels || [],
          ...subAgg,
        };
      })
      .sort((a, b) => b.reviewCount - a.reviewCount || a.level - b.level);

    const firstReviews = await this.getProfessorReviews({
      userId: params.userId,
      planId: ctx?.planId,
      professorId: params.professorId,
      page: 1,
      pageSize: 10,
      sort: 'recent',
    });

    return {
      professor: {
        id: found.professor.id,
        displayName: found.professor.displayName,
        normalizedKey: found.professor.normalizedKey,
        aliases: found.aliases.map((a) => a.aliasRaw),
        ...overallAgg,
        subjects: subjectBreakdown,
      },
      reviewsPage: firstReviews,
      thresholds: this.getThresholdsMeta(),
    };
  }

  async getProfessorReviews(params: {
    userId: string;
    planId?: string | null;
    professorId: string;
    subjectId?: string;
    page?: number;
    pageSize?: number;
    sort?: 'recent' | 'helpful';
  }) {
    const found = await this.store.getProfessorById(params.professorId);
    if (!found) {
      throw appError('Profesor no encontrado', 404);
    }

    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(50, Math.max(1, params.pageSize || 10));
    const sort = params.sort === 'helpful' ? 'helpful' : 'recent';

    let subjectUuid: string | undefined;
    if (params.subjectId && params.subjectId.trim()) {
      const ctx = await this.store.resolvePlanContext(params.userId, params.planId);
      if (ctx) {
        const sub = await this.store.getSubjectByIdOrCode(ctx.planId, params.subjectId.trim());
        if (!sub) {
          return {
            items: [],
            page,
            pageSize,
            total: 0,
            totalPages: 0,
          };
        }
        subjectUuid = sub.id;
      }
    }

    const [statsMap, result] = await Promise.all([
      this.store.getProfessorStatsMap([params.professorId]),
      this.store.listPublishedReviews({
        professorId: params.professorId,
        subjectUuid,
        sort,
        page,
        pageSize,
        viewerUserId: params.userId,
      }),
    ]);

    const profTotalPublished = statsMap.get(params.professorId)?.reviewCount || 0;
    const subMap = await this.store.getSubjectsByIds(
      Array.from(new Set(result.items.map((r) => r.subjectId)))
    );

    const serialized = result.items.map((r) =>
      serializePublicReview({
        review: r,
        subject: subMap.get(r.subjectId),
        professorPublishedReviewCount: profTotalPublished,
        viewerHasVotedHelpful: result.viewerHelpfulIds.has(r.id),
        viewerHasReported: result.viewerReportedIds.has(r.id),
      })
    );

    return {
      items: serialized,
      page,
      pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / pageSize),
    };
  }

  /**
   * Valoraciones en lote para pintar insignias y popovers en el Armador de Horarios
   * en una única petición HTTP (soporta búsqueda por UUIDs y/o por nombres crudos).
   */
  async getRatingsBatch(params: {
    userId: string;
    planId?: string | null;
    ids?: string[];
    names?: string[];
  }) {
    const ctx = await this.store.resolvePlanContext(params.userId, params.planId);
    const facultyId = ctx?.facultyId || (await this.store.getDefaultFacultyId());
    if (!facultyId) {
      return { byId: {}, byNormalizedName: {}, thresholds: this.getThresholdsMeta() };
    }

    const [allProfs, allAliases] = await Promise.all([
      this.store.listFacultyProfessors(facultyId),
      this.store.listFacultyAliases(facultyId),
    ]);

    const profById = new Map(allProfs.map((p) => [p.id, p]));
    const profIdByNormKey = new Map<string, string>();
    for (const p of allProfs) {
      profIdByNormKey.set(p.normalizedKey, p.id);
    }
    for (const a of allAliases) {
      profIdByNormKey.set(a.aliasNormalized, a.professorId);
    }

    const requestedIds = new Set<string>();
    for (const rawId of params.ids || []) {
      const id = rawId.trim();
      if (profById.has(id)) requestedIds.add(id);
    }

    const requestedNormToProfId = new Map<string, string>();
    for (const rawName of params.names || []) {
      const parsed = parseProfessorName(rawName);
      if (!parsed.normalizedKey) continue;
      const pid = profIdByNormKey.get(parsed.normalizedKey);
      if (pid) {
        requestedIds.add(pid);
        requestedNormToProfId.set(parsed.normalizedKey, pid);
      }
    }

    // Si no se pidieron filtros específicos, devolver todos los docentes de la facultad (son ~346, muy liviano)
    if ((params.ids?.length || 0) === 0 && (params.names?.length || 0) === 0) {
      for (const p of allProfs) {
        requestedIds.add(p.id);
        requestedNormToProfId.set(p.normalizedKey, p.id);
      }
      for (const a of allAliases) {
        requestedNormToProfId.set(a.aliasNormalized, a.professorId);
      }
    }

    const targetIds = Array.from(requestedIds);
    const [statsMap, recentMap] = await Promise.all([
      this.store.getProfessorStatsMap(targetIds),
      this.store.listRecentPublishedReviewsBatch(targetIds, 2),
    ]);

    const allRecentSubjectIds = new Set<string>();
    for (const list of recentMap.values()) {
      for (const r of list) allRecentSubjectIds.add(r.subjectId);
    }
    const subMap = await this.store.getSubjectsByIds(Array.from(allRecentSubjectIds));

    const byId: Record<string, any> = {};
    for (const pid of targetIds) {
      const prof = profById.get(pid);
      if (!prof) continue;
      const agg = formatPublicAggregate(statsMap.get(pid) || emptyAggregate());
      const recents = (recentMap.get(pid) || []).map((r) =>
        serializePublicReview({
          review: r,
          subject: subMap.get(r.subjectId),
          professorPublishedReviewCount: agg.reviewCount,
        })
      );
      byId[pid] = {
        professorId: pid,
        displayName: prof.displayName,
        normalizedKey: prof.normalizedKey,
        ...agg,
        recentReviews: recents,
      };
    }

    const byNormalizedName: Record<string, string> = {};
    for (const [normKey, pid] of requestedNormToProfId.entries()) {
      if (byId[pid]) {
        byNormalizedName[normKey] = pid;
      }
    }
    for (const pid of targetIds) {
      const prof = profById.get(pid);
      if (prof) byNormalizedName[prof.normalizedKey] = pid;
    }

    return {
      byId,
      byNormalizedName,
      thresholds: this.getThresholdsMeta(),
    };
  }

  /**
   * Devuelve qué pares (profesor, materia) puede reseñar el usuario según su progreso real,
   * cuáles están bloqueados (con explicación clara) y las reseñas propias ya publicadas.
   */
  async getReviewableForUser(params: { userId: string; planId?: string | null }) {
    const ctx = await this.store.resolvePlanContext(params.userId, params.planId);
    if (!ctx) {
      return {
        eligible: [],
        blocked: [],
        myReviews: [],
        recommendedPendingCount: 0,
        unseenRecommendedCount: 0,
        allowedStatuses: [...ALLOWED_REVIEW_SUBJECT_STATUSES],
        dailyLimit: {
          maxPerDay: MAX_NEW_REVIEWS_PER_USER_PER_DAY,
          usedLast24h: 0,
          remainingToday: MAX_NEW_REVIEWS_PER_USER_PER_DAY,
        },
      };
    }

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
      allProfs,
      teachingPairs,
      progressMap,
      ownReviews,
      usedLast24h,
      userEnrollments,
      dismissedSet,
      seenSet,
    ] = await Promise.all([
      this.store.listFacultyProfessors(ctx.facultyId),
      this.store.getTeachingPairsForPlan(ctx.planId, ctx.facultyId),
      this.store.getUserSubjectProgressMap(params.userId),
      this.store.listUserOwnReviews(params.userId),
      this.store.countUserNewReviewsSince(params.userId, since24h),
      this.store.listUserEnrollments(params.userId, ctx.planId),
      this.store.listUserDismissedRecommendations(params.userId),
      this.store.getUserSeenRecommendationKeys(params.userId),
    ]);

    const profMap = new Map(allProfs.map((p) => [p.id, p]));
    const ownByPair = new Map<string, StoredReview>();
    for (const r of ownReviews) {
      ownByPair.set(`${r.professorId}::${r.subjectId}`, r);
    }

    const enrolledMap = new Map<
      string,
      {
        academicYear: number | null;
        term: '1C' | '2C' | 'A' | null;
        commissionCode: string | null;
      }
    >();
    for (const enr of userEnrollments) {
      for (const ep of enr.professors) {
        const key = `${ep.professorId}::${enr.subjectId}`;
        const prev = enrolledMap.get(key);
        if (
          !prev ||
          (enr.academicYear !== null && (prev.academicYear === null || enr.academicYear > prev.academicYear))
        ) {
          enrolledMap.set(key, {
            academicYear: enr.academicYear,
            term: enr.term,
            commissionCode: enr.commissionCode,
          });
        }
      }
    }

    const allowedSet = new Set<string>(ALLOWED_REVIEW_SUBJECT_STATUSES);
    const eligible: Array<any> = [];
    const blocked: Array<any> = [];

    for (const pair of teachingPairs) {
      const prof = profMap.get(pair.professorId);
      if (!prof) continue;

      const prog = progressMap.get(pair.subjectId);
      const currentStatus = prog?.status || 'pendiente';
      const pairKey = `${pair.professorId}::${pair.subjectId}`;
      const existingReview = ownByPair.get(pairKey);
      const enrollInfo = enrolledMap.get(pairKey);

      if (allowedSet.has(currentStatus)) {
        const recommended = Boolean(enrollInfo);
        const dismissed = dismissedSet.has(pairKey);
        const seen = seenSet.has(pairKey);
        eligible.push({
          professorId: prof.id,
          professorName: prof.displayName,
          subjectId: pair.subjectId,
          subjectCode: pair.subjectCode,
          subjectName: pair.subjectName,
          subjectLevel: pair.subjectLevel,
          userSubjectStatus: currentStatus,
          isCurrentTerm: pair.isCurrentTerm,
          isHistoricalLink: pair.isHistoricalLink,
          alreadyReviewed: Boolean(existingReview),
          existingReviewId: existingReview?.id || null,
          recommended,
          dismissed,
          seen,
          enrollmentAcademicYear: enrollInfo?.academicYear ?? null,
          enrollmentTerm: enrollInfo?.term ?? null,
          enrollmentCommissionCode: enrollInfo?.commissionCode ?? null,
        });
      } else {
        const statusHuman =
          currentStatus === 'cursando'
            ? 'cursando actualmente'
            : 'pendiente de cursar';
        blocked.push({
          professorId: prof.id,
          professorName: prof.displayName,
          subjectId: pair.subjectId,
          subjectCode: pair.subjectCode,
          subjectName: pair.subjectName,
          subjectLevel: pair.subjectLevel,
          userSubjectStatus: currentStatus,
          recommended: false,
          blockedReason: `Debés tener "${pair.subjectName}" regularizada, aprobada o promocionada para reseñar a este docente (estado actual: ${statusHuman}).`,
        });
      }
    }

    const priorityScore = (item: any) => {
      if (!item.alreadyReviewed && item.recommended && !item.dismissed) return 0;
      if (!item.alreadyReviewed && item.recommended && item.dismissed) return 1;
      if (!item.alreadyReviewed) return 2;
      if (item.recommended) return 3;
      return 4;
    };

    eligible.sort(
      (a, b) =>
        priorityScore(a) - priorityScore(b) ||
        a.professorName.localeCompare(b.professorName, 'es') ||
        a.subjectName.localeCompare(b.subjectName, 'es')
    );

    blocked.sort(
      (a, b) =>
        a.professorName.localeCompare(b.professorName, 'es') ||
        a.subjectName.localeCompare(b.subjectName, 'es')
    );

    const activeRecommended = eligible.filter(
      (e) => e.recommended && !e.alreadyReviewed && !e.dismissed
    );
    const recommendedPendingCount = activeRecommended.length;
    const unseenRecommendedCount = activeRecommended.filter((e) => !e.seen).length;

    const ownSubIds = Array.from(new Set(ownReviews.map((r) => r.subjectId)));
    const ownSubMap = await this.store.getSubjectsByIds(ownSubIds);

    const myReviews = ownReviews.map((r) => {
      const sub = ownSubMap.get(r.subjectId);
      const prof = profMap.get(r.professorId);
      const { publishedMonthYear, publishedLabel } = formatPublishedMonthYear(r.createdAt);
      return {
        id: r.id,
        professorId: r.professorId,
        professorName: prof?.displayName || 'Docente',
        subjectId: r.subjectId,
        subjectCode: sub?.codeInPlan || 0,
        subjectName: sub?.name || 'Materia',
        academicYear: r.academicYear,
        term: r.term,
        attendedDeclared: Boolean(r.attendedDeclared),
        overall: r.overall,
        clarity: r.clarity,
        treatment: r.treatment,
        availability: r.availability,
        difficulty: r.difficulty,
        wouldRecommend: r.wouldRecommend,
        comment: r.comment,
        status: r.status,
        helpfulCount: r.helpfulCount,
        publishedMonthYear,
        publishedLabel,
      };
    });

    return {
      eligible,
      blocked,
      myReviews,
      recommendedPendingCount,
      unseenRecommendedCount,
      allowedStatuses: [...ALLOWED_REVIEW_SUBJECT_STATUSES],
      dailyLimit: {
        maxPerDay: MAX_NEW_REVIEWS_PER_USER_PER_DAY,
        usedLast24h,
        remainingToday: Math.max(0, MAX_NEW_REVIEWS_PER_USER_PER_DAY - usedLast24h),
      },
    };
  }

  async dismissRecommendation(params: {
    userId: string;
    planId?: string | null;
    professorId: string;
    subjectId: string | number;
  }) {
    const ctx = await this.store.resolvePlanContext(params.userId, params.planId);
    if (!ctx) {
      throw appError('No se encontró un plan de estudios activo', 400);
    }
    const [profData, subject] = await Promise.all([
      this.store.getProfessorById(params.professorId),
      this.store.getSubjectByIdOrCode(ctx.planId, params.subjectId),
    ]);
    if (!profData) {
      throw appError('Profesor no encontrado', 404);
    }
    if (!subject) {
      throw appError('Materia no encontrada en tu plan de estudios', 404);
    }

    await this.store.dismissRecommendation(params.userId, profData.professor.id, subject.id);
    await this.store.markRecommendationsSeen(params.userId, [
      `${profData.professor.id}::${subject.id}`,
    ]);

    return {
      dismissed: true,
      professorId: profData.professor.id,
      subjectId: subject.id,
      subjectCode: subject.codeInPlan,
    };
  }

  async markRecommendationsSeen(params: {
    userId: string;
    planId?: string | null;
    keys?: string[];
  }) {
    let keysToMark = (params.keys || []).filter(
      (k): k is string => typeof k === 'string' && k.includes('::')
    );

    if (keysToMark.length === 0) {
      const reviewable = await this.getReviewableForUser({
        userId: params.userId,
        planId: params.planId,
      });
      keysToMark = reviewable.eligible
        .filter((e: any) => e.recommended && !e.alreadyReviewed && !e.dismissed)
        .map((e: any) => `${e.professorId}::${e.subjectId}`);
    }

    if (keysToMark.length > 0) {
      await this.store.markRecommendationsSeen(params.userId, keysToMark);
    }

    return {
      seenCount: keysToMark.length,
      unseenRecommendedCount: 0,
    };
  }

  async createReview(params: {
    userId: string;
    planId?: string | null;
    professorId: string;
    subjectId: string | number;
    academicYear?: number | null;
    term?: '1C' | '2C' | 'A' | null;
    overall: number;
    clarity?: number | null;
    treatment?: number | null;
    availability?: number | null;
    difficulty?: number | null;
    wouldRecommend?: boolean | null;
    comment?: string | null;
  }) {
    const ctx = await this.store.resolvePlanContext(params.userId, params.planId);
    if (!ctx) {
      throw appError('No se encontró un plan de estudios activo para tu cuenta', 400);
    }

    // 1. Verificar existencia del profesor y materia
    const [profData, subject] = await Promise.all([
      this.store.getProfessorById(params.professorId),
      this.store.getSubjectByIdOrCode(ctx.planId, params.subjectId),
    ]);

    if (!profData) {
      throw appError('El profesor seleccionado no existe', 404);
    }
    if (!subject) {
      throw appError('La materia seleccionada no pertenece a tu plan de estudios', 404);
    }

    // 2. Validar elegibilidad (a): el profesor dicta o dictó esa materia en algún período o vínculo histórico
    const teaches = await this.store.doesProfessorTeachSubject(profData.professor.id, subject.id);
    if (!teaches) {
      throw appError(
        `No podés reseñar a ${profData.professor.displayName} en "${subject.name}" porque no figura dictando esa materia en ningún período cargado.`,
        403,
        'PROFESSOR_DOES_NOT_TEACH_SUBJECT'
      );
    }

    // 3. Validar elegibilidad (b): progreso académico del usuario en esa materia
    const progressMap = await this.store.getUserSubjectProgressMap(params.userId);
    const userProg = progressMap.get(subject.id);
    const currentStatus = userProg?.status || 'pendiente';
    const allowedSet = new Set<string>(ALLOWED_REVIEW_SUBJECT_STATUSES);

    if (!allowedSet.has(currentStatus)) {
      throw appError(
        `Solo podés reseñar profesores de materias que tengas en estado ${ALLOWED_REVIEW_SUBJECT_STATUSES.join(
          ', '
        )} (tu estado actual en "${subject.name}" es "${currentStatus}").`,
        403,
        'SUBJECT_NOT_COMPLETED'
      );
    }

    // 4. Validar unicidad (user_id, professor_id, subject_id)
    const existing = await this.store.findUserReview(
      params.userId,
      profData.professor.id,
      subject.id
    );
    if (existing) {
      throw appError(
        `Ya publicaste una reseña para ${profData.professor.displayName} en "${subject.name}". Podés editarla o eliminarla desde "Mis reseñas".`,
        409,
        'DUPLICATE_REVIEW'
      );
    }

    // 5. Validar tope diario de reseñas nuevas (ventana móvil de 24h)
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const countLast24h = await this.store.countUserNewReviewsSince(params.userId, since24h);
    if (countLast24h >= MAX_NEW_REVIEWS_PER_USER_PER_DAY) {
      throw appError(
        `Alcanzaste el límite máximo de ${MAX_NEW_REVIEWS_PER_USER_PER_DAY} reseñas nuevas por día. Intentá nuevamente mañana.`,
        429,
        'DAILY_REVIEW_LIMIT_REACHED'
      );
    }

    // 6. Sanitizar y filtrar contenido del comentario (sin HTML, sin datos personales, sin insultos)
    const contentCheck = validateAndSanitizeReviewComment(params.comment);
    if (!contentCheck.valid) {
      throw appError(contentCheck.reason, 400, contentCheck.code);
    }

    // 7. Crear reseña y recalcular agregados
    const created = await this.store.createReview({
      userId: params.userId,
      professorId: profData.professor.id,
      subjectId: subject.id,
      academicYear: params.academicYear ?? null,
      term: params.term ?? null,
      overall: params.overall,
      clarity: params.clarity ?? null,
      treatment: params.treatment ?? null,
      availability: params.availability ?? null,
      difficulty: params.difficulty ?? null,
      wouldRecommend: params.wouldRecommend ?? null,
      comment: contentCheck.sanitized,
    });

    const statsMap = await this.store.getProfessorStatsMap([profData.professor.id]);
    const profCount = statsMap.get(profData.professor.id)?.reviewCount || 1;

    return serializePublicReview({
      review: created,
      subject,
      professorPublishedReviewCount: profCount,
    });
  }

  async updateReview(params: {
    userId: string;
    reviewId: string;
    academicYear?: number | null;
    term?: '1C' | '2C' | 'A' | null;
    overall: number;
    clarity?: number | null;
    treatment?: number | null;
    availability?: number | null;
    difficulty?: number | null;
    wouldRecommend?: boolean | null;
    comment?: string | null;
  }) {
    const existing = await this.store.getReviewById(params.reviewId);
    if (!existing || existing.status === 'removed') {
      throw appError('Reseña no encontrada', 404);
    }

    if (existing.userId !== params.userId) {
      throw appError('Solo el autor puede editar esta reseña', 403, 'FORBIDDEN_NOT_AUTHOR');
    }

    const contentCheck = validateAndSanitizeReviewComment(params.comment);
    if (!contentCheck.valid) {
      throw appError(contentCheck.reason, 400, contentCheck.code);
    }

    const updated = await this.store.updateReview(params.reviewId, {
      academicYear: params.academicYear ?? null,
      term: params.term ?? null,
      overall: params.overall,
      clarity: params.clarity ?? null,
      treatment: params.treatment ?? null,
      availability: params.availability ?? null,
      difficulty: params.difficulty ?? null,
      wouldRecommend: params.wouldRecommend ?? null,
      comment: contentCheck.sanitized,
    });

    const [subMap, statsMap] = await Promise.all([
      this.store.getSubjectsByIds([updated.subjectId]),
      this.store.getProfessorStatsMap([updated.professorId]),
    ]);

    return serializePublicReview({
      review: updated,
      subject: subMap.get(updated.subjectId),
      professorPublishedReviewCount: statsMap.get(updated.professorId)?.reviewCount || 0,
    });
  }

  async deleteReview(params: { userId: string; reviewId: string }) {
    const existing = await this.store.getReviewById(params.reviewId);
    if (!existing) {
      throw appError('Reseña no encontrada', 404);
    }

    if (existing.userId !== params.userId) {
      throw appError('Solo el autor puede eliminar esta reseña', 403, 'FORBIDDEN_NOT_AUTHOR');
    }

    await this.store.deleteReview(params.reviewId);
    return { deleted: true };
  }

  async toggleHelpful(params: { userId: string; reviewId: string }) {
    const existing = await this.store.getReviewById(params.reviewId);
    if (!existing || existing.status !== 'published') {
      throw appError('Reseña no encontrada', 404);
    }
    return await this.store.toggleHelpfulVote(params.reviewId, params.userId);
  }

  async reportReview(params: {
    reporterUserId: string;
    reviewId: string;
    reason: ReportReason;
    note?: string | null;
  }) {
    const existing = await this.store.getReviewById(params.reviewId);
    if (!existing || existing.status === 'removed') {
      throw appError('Reseña no encontrada', 404);
    }

    const cleanNote = sanitizePlainText(params.note);
    const result = await this.store.createReport({
      reviewId: params.reviewId,
      reporterUserId: params.reporterUserId,
      reason: params.reason,
      note: cleanNote,
      autoHideThreshold: AUTO_HIDE_OPEN_REPORTS_THRESHOLD,
    });

    if (result.duplicate) {
      throw appError(
        'Ya enviaste un reporte sobre esta reseña anteriormente.',
        409,
        'DUPLICATE_REPORT'
      );
    }

    return {
      reportId: result.reportId,
      openReportsCount: result.openReportsCount,
      autoHidden: result.autoHidden,
      message: result.autoHidden
        ? 'Gracias por tu reporte. La reseña fue ocultada preventivamente hasta que un administrador la revise.'
        : 'Reporte registrado correctamente. Un administrador lo revisará a la brevedad.',
    };
  }

  // ==========================================================================
  // OPERACIONES DE ADMINISTRACIÓN
  // ==========================================================================

  async adminListProfessors(params: { adminUserId: string; planId?: string | null }) {
    const ctx = await this.store.resolvePlanContext(params.adminUserId, params.planId);
    const facultyId = ctx?.facultyId || (await this.store.getDefaultFacultyId());
    if (!facultyId) {
      return { professors: [], duplicateCandidates: [] };
    }

    const profs = await this.store.listFacultyProfessors(facultyId);
    const statsMap = await this.store.getProfessorStatsMap(profs.map((p) => p.id));
    const analysis = analyzeProfessorNames(profs.map((p) => p.displayName));

    const profByNorm = new Map(profs.map((p) => [p.normalizedKey, p]));
    const duplicateCandidates = analysis.proposedSameCandidates.map((cand) => ({
      ...cand,
      professorAId: profByNorm.get(cand.professorA.normalizedKey)?.id || null,
      professorBId: profByNorm.get(cand.professorB.normalizedKey)?.id || null,
    }));

    return {
      professors: profs
        .map((p) => ({
          id: p.id,
          facultyId: p.facultyId,
          displayName: p.displayName,
          normalizedKey: p.normalizedKey,
          reviewCount: statsMap.get(p.id)?.reviewCount || 0,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es')),
      duplicateCandidates,
    };
  }

  async adminCreateHistoricalProfessor(params: {
    adminUserId: string;
    displayName: string;
    facultyId?: string;
    subjectId?: string | number;
    note?: string | null;
  }) {
    const ctx = await this.store.resolvePlanContext(params.adminUserId);
    const facultyId = params.facultyId || ctx?.facultyId || (await this.store.getDefaultFacultyId());
    if (!facultyId) {
      throw appError('No se encontró una facultad válida', 400);
    }

    const professor = await this.store.createOrResolveProfessor({
      facultyId,
      displayName: params.displayName,
    });

    let linkedSubject: PlanSubjectRef | null = null;
    if (params.subjectId !== undefined && ctx) {
      linkedSubject = await this.store.getSubjectByIdOrCode(ctx.planId, params.subjectId);
      if (!linkedSubject) {
        throw appError('Materia no encontrada para vincular al profesor histórico', 404);
      }
      await this.store.linkHistoricalSubject({
        professorId: professor.id,
        subjectId: linkedSubject.id,
        adminUserId: params.adminUserId,
        note: sanitizePlainText(params.note),
      });
    }

    return {
      professor,
      linkedSubject,
    };
  }

  async adminLinkProfessorToSubject(params: {
    adminUserId: string;
    professorId: string;
    subjectId: string | number;
    note?: string | null;
  }) {
    const prof = await this.store.getProfessorById(params.professorId);
    if (!prof) {
      throw appError('Profesor no encontrado', 404);
    }

    const ctx = await this.store.resolvePlanContext(params.adminUserId);
    if (!ctx) {
      throw appError('No hay plan de estudios activo', 400);
    }

    const subject = await this.store.getSubjectByIdOrCode(ctx.planId, params.subjectId);
    if (!subject) {
      throw appError('Materia no encontrada en el catálogo', 404);
    }

    const link = await this.store.linkHistoricalSubject({
      professorId: prof.professor.id,
      subjectId: subject.id,
      adminUserId: params.adminUserId,
      note: sanitizePlainText(params.note),
    });

    return {
      ...link,
      professor: prof.professor,
      subject,
    };
  }

  async adminRenameProfessor(params: { professorId: string; displayName: string }) {
    const updated = await this.store.renameProfessor(params.professorId, params.displayName);
    if (!updated) {
      throw appError('Profesor no encontrado', 404);
    }
    return updated;
  }

  async adminMergeProfessors(params: {
    sourceProfessorId: string;
    targetProfessorId: string;
  }) {
    return await this.store.mergeProfessors(params.sourceProfessorId, params.targetProfessorId);
  }

  async adminGetModerationQueue() {
    return await this.store.listModerationQueue();
  }

  async adminSetReviewStatus(params: { reviewId: string; status: ReviewStatus }) {
    const updated = await this.store.setReviewStatus(params.reviewId, params.status);
    if (!updated) {
      throw appError('Reseña no encontrada', 404);
    }
    return {
      id: updated.id,
      professorId: updated.professorId,
      status: updated.status,
    };
  }

  async adminResolveReport(params: {
    reportId: string;
    status: 'dismissed' | 'actioned';
    reviewStatus?: ReviewStatus;
  }) {
    const ok = await this.store.resolveReport(
      params.reportId,
      params.status,
      params.reviewStatus
    );
    if (!ok) {
      throw appError('Reporte no encontrado', 404);
    }
    return { reportId: params.reportId, status: params.status };
  }

  async adminGetStats(params: { adminUserId: string }) {
    const ctx = await this.store.resolvePlanContext(params.adminUserId);
    return await this.store.getAdminStats(ctx?.facultyId);
  }

  private getThresholdsMeta() {
    return {
      minReviewsForReliableAverage: MIN_REVIEWS_FOR_RELIABLE_AVERAGE,
      showProvisionalAverageBelowThreshold: SHOW_PROVISIONAL_AVERAGE_BELOW_THRESHOLD,
      minReviewsToShowAttendedPeriod: MIN_REVIEWS_TO_SHOW_ATTENDED_PERIOD,
      bayesianPriorGlobalMean: BAYESIAN_PRIOR_GLOBAL_MEAN,
      bayesianPriorWeight: BAYESIAN_PRIOR_WEIGHT,
      maxNewReviewsPerDay: MAX_NEW_REVIEWS_PER_USER_PER_DAY,
      autoHideOpenReportsThreshold: AUTO_HIDE_OPEN_REPORTS_THRESHOLD,
      allowedSubjectStatuses: [...ALLOWED_REVIEW_SUBJECT_STATUSES],
    };
  }
}

