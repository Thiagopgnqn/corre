import crypto from 'crypto';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  careers,
  commissionProfessors,
  commissions,
  commissionSlots,
  electiveOfferingProfessors,
  electiveOfferings,
  enrollmentProfessors,
  faculties,
  professorAliases,
  professorReviews,
  professors,
  professorStats,
  professorSubjectLinks,
  professorSubjectStats,
  reviewHelpfulVotes,
  reviewRecommendationDismissals,
  reviewReports,
  scheduleTerms,
  studyPlans,
  subjectEnrollments,
  subjectProgress,
  subjects,
  users,
  userSettings,
} from '../../db/schema.js';
import {
  cleanDisplayName,
  parseProfessorName,
  pickBestDisplayName,
} from '../professors/professorNormalizer.js';

export type ReviewStatus = 'published' | 'hidden' | 'removed';
export type ReportReason = 'ofensiva' | 'datos personales' | 'falsa o spam' | 'otra';
export type ReportStatus = 'open' | 'dismissed' | 'actioned';

export interface PlanContext {
  planId: string;
  facultyId: string;
}

export interface PlanSubjectRef {
  id: string;
  codeInPlan: number;
  name: string;
  shortName: string;
  level: number;
  kind: string;
}

export interface ProfessorEntity {
  id: string;
  facultyId: string;
  displayName: string;
  normalizedKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfessorAliasEntity {
  id: string;
  professorId: string;
  facultyId: string;
  aliasRaw: string;
  aliasNormalized: string;
}

export interface TeachingPair {
  professorId: string;
  subjectId: string;
  subjectCode: number;
  subjectName: string;
  subjectShortName: string;
  subjectLevel: number;
  isCurrentTerm: boolean;
  isHistoricalLink: boolean;
  termLabels: string[];
}

export interface ComputedAggregate {
  reviewCount: number;
  avgOverall: number | null;
  avgClarity: number | null;
  avgTreatment: number | null;
  avgAvailability: number | null;
  avgDifficulty: number | null;
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

export interface StoredReview {
  id: string;
  userId: string;
  professorId: string;
  subjectId: string;
  academicYear: number | null;
  term: '1C' | '2C' | 'A' | null;
  overall: number;
  clarity: number | null;
  treatment: number | null;
  availability: number | null;
  difficulty: number | null;
  wouldRecommend: boolean | null;
  comment: string | null;
  status: ReviewStatus;
  helpfulCount: number;
  attendedDeclared: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type EnrollmentSource = 'manual' | 'schedule_builder';
export type EnrollmentTerm = '1C' | '2C' | 'A';

export interface CommissionSlotBrief {
  day: number;
  dayLabel: string;
  startTime: string;
  endTime: string;
  room: string | null;
  mode: string | null;
}

export interface SubjectCommissionOption {
  id: string;
  code: string;
  turno: string;
  termOffer: '1C' | '2C' | 'A';
  scheduleTermId: string;
  academicYear: number;
  term: '1C' | '2C';
  periodLabel: string;
  isCurrent: boolean;
  slots: CommissionSlotBrief[];
  professors: Array<{
    professorId: string;
    displayName: string;
  }>;
}

export interface SubjectProfessorOption {
  professorId: string;
  displayName: string;
  isCurrentTerm: boolean;
  isHistoricalLink: boolean;
  termLabels: string[];
}

export interface CommissionEnrollmentMeta {
  id: string;
  subjectId: string;
  code: string;
  turno: string;
  termOffer: '1C' | '2C' | 'A';
  academicYear: number;
  scheduleTerm: '1C' | '2C';
  isCurrent: boolean;
  professorIds: string[];
}

export interface StoredEnrollment {
  id: string;
  userId: string;
  subjectId: string;
  subjectCode: number;
  subjectName: string;
  subjectShortName: string;
  subjectLevel: number;
  commissionId: string | null;
  commissionCode: string | null;
  turno: string | null;
  academicYear: number | null;
  term: EnrollmentTerm | null;
  source: EnrollmentSource;
  professors: Array<{
    professorId: string;
    displayName: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminModerationReportItem {
  reportId: string;
  reviewId: string;
  reason: ReportReason;
  note: string | null;
  reportStatus: ReportStatus;
  reportedMonthYear: string;
  openReportsOnReview: number;
  review: {
    id: string;
    professorId: string;
    professorName: string;
    subjectId: string;
    subjectCode: number;
    subjectName: string;
    overall: number;
    comment: string | null;
    status: ReviewStatus;
    publishedMonthYear: string;
  };
}

export interface AdminHiddenReviewItem {
  id: string;
  professorId: string;
  professorName: string;
  subjectId: string;
  subjectCode: number;
  subjectName: string;
  overall: number;
  comment: string | null;
  status: ReviewStatus;
  openReportsCount: number;
  publishedMonthYear: string;
}

export function emptyAggregate(): ComputedAggregate {
  return {
    reviewCount: 0,
    avgOverall: null,
    avgClarity: null,
    avgTreatment: null,
    avgAvailability: null,
    avgDifficulty: null,
    recommendPercent: null,
    recommendCount: 0,
    recommendTotal: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  };
}

export function computeAggregatesFromReviews(reviews: StoredReview[]): ComputedAggregate {
  const published = reviews.filter((r) => r.status === 'published');
  if (published.length === 0) return emptyAggregate();

  let sumOverall = 0;
  let sumClarity = 0;
  let countClarity = 0;
  let sumTreatment = 0;
  let countTreatment = 0;
  let sumAvailability = 0;
  let countAvailability = 0;
  let sumDifficulty = 0;
  let countDifficulty = 0;
  let recYes = 0;
  let recTotal = 0;
  const dist: { 1: number; 2: number; 3: number; 4: number; 5: number } = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };

  for (const r of published) {
    sumOverall += r.overall;
    if (r.overall >= 1 && r.overall <= 5) {
      dist[r.overall as 1 | 2 | 3 | 4 | 5] += 1;
    }
    if (r.clarity !== null && r.clarity !== undefined) {
      sumClarity += r.clarity;
      countClarity += 1;
    }
    if (r.treatment !== null && r.treatment !== undefined) {
      sumTreatment += r.treatment;
      countTreatment += 1;
    }
    if (r.availability !== null && r.availability !== undefined) {
      sumAvailability += r.availability;
      countAvailability += 1;
    }
    if (r.difficulty !== null && r.difficulty !== undefined) {
      sumDifficulty += r.difficulty;
      countDifficulty += 1;
    }
    if (r.wouldRecommend !== null && r.wouldRecommend !== undefined) {
      recTotal += 1;
      if (r.wouldRecommend) recYes += 1;
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    reviewCount: published.length,
    avgOverall: round2(sumOverall / published.length),
    avgClarity: countClarity > 0 ? round2(sumClarity / countClarity) : null,
    avgTreatment: countTreatment > 0 ? round2(sumTreatment / countTreatment) : null,
    avgAvailability: countAvailability > 0 ? round2(sumAvailability / countAvailability) : null,
    avgDifficulty: countDifficulty > 0 ? round2(sumDifficulty / countDifficulty) : null,
    recommendPercent: recTotal > 0 ? Math.round((recYes / recTotal) * 100) : null,
    recommendCount: recYes,
    recommendTotal: recTotal,
    distribution: dist,
  };
}

function formatYearMonth(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export interface ReviewsStore {
  resolvePlanContext(userId: string, requestedPlanId?: string | null): Promise<PlanContext | null>;
  getDefaultFacultyId(): Promise<string | null>;
  getPlanSubjects(planId: string): Promise<PlanSubjectRef[]>;
  getSubjectByIdOrCode(planId: string, idOrCode: string | number): Promise<PlanSubjectRef | null>;
  getSubjectsByIds(subjectIds: string[]): Promise<Map<string, PlanSubjectRef>>;

  listFacultyProfessors(facultyId: string): Promise<ProfessorEntity[]>;
  listFacultyAliases(facultyId: string): Promise<ProfessorAliasEntity[]>;
  getProfessorById(
    professorId: string
  ): Promise<{ professor: ProfessorEntity; aliases: ProfessorAliasEntity[] } | null>;

  getTeachingPairsForPlan(planId: string, facultyId: string): Promise<TeachingPair[]>;
  doesProfessorTeachSubject(professorId: string, subjectUuid: string): Promise<boolean>;
  getUserSubjectProgressMap(
    userId: string
  ): Promise<Map<string, { status: string; grade: number | null }>>;

  getGlobalPublishedSummary(
    facultyId?: string
  ): Promise<{ totalReviews: number; globalMean: number | null }>;
  getProfessorStatsMap(professorIds: string[]): Promise<Map<string, ComputedAggregate>>;
  getProfessorSubjectStatsMap(professorId: string): Promise<Map<string, ComputedAggregate>>;

  listPublishedReviews(params: {
    professorId: string;
    subjectUuid?: string;
    sort: 'recent' | 'helpful';
    page: number;
    pageSize: number;
    viewerUserId?: string;
  }): Promise<{
    items: StoredReview[];
    total: number;
    viewerHelpfulIds: Set<string>;
    viewerReportedIds: Set<string>;
  }>;

  listRecentPublishedReviewsBatch(
    professorIds: string[],
    limitPerProfessor: number
  ): Promise<Map<string, StoredReview[]>>;

  listUserOwnReviews(userId: string): Promise<StoredReview[]>;
  getReviewById(reviewId: string): Promise<StoredReview | null>;
  findUserReview(
    userId: string,
    professorId: string,
    subjectUuid: string
  ): Promise<StoredReview | null>;
  countUserNewReviewsSince(userId: string, since: Date): Promise<number>;

  createReview(input: {
    userId: string;
    professorId: string;
    subjectId: string;
    academicYear: number | null;
    term: '1C' | '2C' | 'A' | null;
    overall: number;
    clarity: number | null;
    treatment: number | null;
    availability: number | null;
    difficulty: number | null;
    wouldRecommend: boolean | null;
    comment: string | null;
  }): Promise<StoredReview>;

  updateReview(
    reviewId: string,
    input: {
      academicYear: number | null;
      term: '1C' | '2C' | 'A' | null;
      overall: number;
      clarity: number | null;
      treatment: number | null;
      availability: number | null;
      difficulty: number | null;
      wouldRecommend: boolean | null;
      comment: string | null;
    }
  ): Promise<StoredReview>;

  deleteReview(reviewId: string): Promise<void>;
  toggleHelpfulVote(
    reviewId: string,
    userId: string
  ): Promise<{ voted: boolean; helpfulCount: number }>;

  createReport(params: {
    reviewId: string;
    reporterUserId: string;
    reason: ReportReason;
    note: string | null;
    autoHideThreshold: number;
  }): Promise<{
    duplicate: boolean;
    reportId?: string;
    openReportsCount: number;
    autoHidden: boolean;
  }>;

  // Administración
  createOrResolveProfessor(params: {
    facultyId: string;
    displayName: string;
  }): Promise<ProfessorEntity>;
  renameProfessor(professorId: string, displayName: string): Promise<ProfessorEntity | null>;
  linkHistoricalSubject(params: {
    professorId: string;
    subjectId: string;
    adminUserId: string | null;
    note: string | null;
  }): Promise<{ created: boolean; linkId: string }>;
  mergeProfessors(
    sourceProfessorId: string,
    targetProfessorId: string
  ): Promise<{
    targetProfessor: ProfessorEntity;
    movedCommissions: number;
    movedElectives: number;
    movedEnrollments: number;
    movedDismissals: number;
    movedReviews: number;
    deduplicatedReviews: number;
  }>;

  // Cursadas (enrollments), recomendaciones y attended_declared
  hasUserDeclaredAttendance(
    userId: string,
    professorId: string,
    subjectUuid: string
  ): Promise<boolean>;
  recalculateAttendedDeclaredForUserSubject(userId: string, subjectUuid: string): Promise<void>;
  recalculateAttendedDeclaredForProfessor(professorId: string): Promise<void>;

  getSubjectEnrollmentOptions(
    planId: string,
    facultyId: string,
    subjectUuid: string
  ): Promise<{
    commissions: SubjectCommissionOption[];
    professors: SubjectProfessorOption[];
  }>;
  getCommissionForEnrollment(commissionId: string): Promise<CommissionEnrollmentMeta | null>;
  findSubjectCommissionByCode(params: {
    subjectUuid: string;
    code: string;
    academicYear?: number | null;
    term?: string | null;
  }): Promise<CommissionEnrollmentMeta | null>;
  listUserEnrollments(userId: string, planId?: string | null): Promise<StoredEnrollment[]>;
  getEnrollmentById(enrollmentId: string): Promise<StoredEnrollment | null>;
  saveUserEnrollment(params: {
    enrollmentId?: string | null;
    userId: string;
    subjectId: string;
    commissionId: string | null;
    academicYear: number | null;
    term: EnrollmentTerm | null;
    source: EnrollmentSource;
    professorIds: string[];
  }): Promise<StoredEnrollment>;
  deleteUserEnrollment(
    userId: string,
    enrollmentId: string
  ): Promise<{ deleted: boolean; subjectId?: string }>;

  listUserDismissedRecommendations(userId: string): Promise<Set<string>>;
  dismissRecommendation(userId: string, professorId: string, subjectUuid: string): Promise<void>;
  getUserSeenRecommendationKeys(userId: string): Promise<Set<string>>;
  markRecommendationsSeen(userId: string, keys: string[]): Promise<void>;

  listModerationQueue(): Promise<{
    openReports: AdminModerationReportItem[];
    hiddenReviews: AdminHiddenReviewItem[];
  }>;
  setReviewStatus(reviewId: string, status: ReviewStatus): Promise<StoredReview | null>;
  resolveReport(
    reportId: string,
    status: 'dismissed' | 'actioned',
    reviewStatus?: ReviewStatus
  ): Promise<boolean>;
  getAdminStats(facultyId?: string): Promise<{
    totalProfessors: number;
    professorsWithReviews: number;
    publishedReviews: number;
    hiddenReviews: number;
    removedReviews: number;
    openReports: number;
    globalMean: number | null;
  }>;

  getAffectedProfessorIdsByUser(userId: string): Promise<string[]>;
  recalculateProfessorStats(professorId: string): Promise<void>;
}

function mapDbStatsRow(row: {
  reviewCount: number;
  avgOverall: string | null;
  avgClarity: string | null;
  avgTreatment: string | null;
  avgAvailability: string | null;
  avgDifficulty: string | null;
  recommendRate: string | null;
  stars1: number;
  stars2: number;
  stars3: number;
  stars4: number;
  stars5: number;
}): ComputedAggregate {
  if (!row || row.reviewCount === 0) return emptyAggregate();
  const recPct = row.recommendRate !== null ? Math.round(Number(row.recommendRate)) : null;
  return {
    reviewCount: row.reviewCount,
    avgOverall: row.avgOverall !== null ? Number(row.avgOverall) : null,
    avgClarity: row.avgClarity !== null ? Number(row.avgClarity) : null,
    avgTreatment: row.avgTreatment !== null ? Number(row.avgTreatment) : null,
    avgAvailability: row.avgAvailability !== null ? Number(row.avgAvailability) : null,
    avgDifficulty: row.avgDifficulty !== null ? Number(row.avgDifficulty) : null,
    recommendPercent: recPct,
    recommendCount:
      recPct !== null ? Math.round((recPct / 100) * row.reviewCount) : 0,
    recommendTotal: recPct !== null ? row.reviewCount : 0,
    distribution: {
      1: row.stars1,
      2: row.stars2,
      3: row.stars3,
      4: row.stars4,
      5: row.stars5,
    },
  };
}

const DAY_LABELS: Record<number, string> = {
  1: 'LUN',
  2: 'MAR',
  3: 'MIE',
  4: 'JUE',
  5: 'VIE',
  6: 'SAB',
};

function mapDbReviewRow(r: typeof professorReviews.$inferSelect): StoredReview {
  return {
    id: r.id,
    userId: r.userId,
    professorId: r.professorId,
    subjectId: r.subjectId,
    academicYear: r.academicYear ?? null,
    term: (r.term as '1C' | '2C' | 'A' | null) ?? null,
    overall: r.overall,
    clarity: r.clarity ?? null,
    treatment: r.treatment ?? null,
    availability: r.availability ?? null,
    difficulty: r.difficulty ?? null,
    wouldRecommend: r.wouldRecommend ?? null,
    comment: r.comment ?? null,
    status: r.status as ReviewStatus,
    helpfulCount: r.helpfulCount,
    attendedDeclared: Boolean(r.attendedDeclared),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function isMissingMigrationError(err: unknown): boolean {
  const code = (err as any)?.code;
  return code === '42P01' || code === '42703';
}

// ============================================================================
// 1. IMPLEMENTACIÓN POSTGRESQL / DRIZZLE ORM (PRODUCCIÓN)
// ============================================================================

export class DrizzleReviewsStore implements ReviewsStore {
  async resolvePlanContext(
    userId: string,
    requestedPlanId?: string | null
  ): Promise<PlanContext | null> {
    let planId = requestedPlanId || null;

    if (!planId || planId === 'current' || planId === 'default') {
      const [user] = await db
        .select({ selectedPlanId: users.selectedPlanId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      planId = user?.selectedPlanId || null;
    }

    let planRow;
    if (planId) {
      [planRow] = await db.select().from(studyPlans).where(eq(studyPlans.id, planId)).limit(1);
    }
    if (!planRow) {
      [planRow] = await db
        .select()
        .from(studyPlans)
        .where(eq(studyPlans.isActive, true))
        .limit(1);
    }
    if (!planRow) return null;

    const [career] = await db
      .select()
      .from(careers)
      .where(eq(careers.id, planRow.careerId))
      .limit(1);
    if (!career) return null;

    return { planId: planRow.id, facultyId: career.facultyId };
  }

  async getDefaultFacultyId(): Promise<string | null> {
    const [fac] = await db.select({ id: faculties.id }).from(faculties).limit(1);
    return fac?.id || null;
  }

  async getPlanSubjects(planId: string): Promise<PlanSubjectRef[]> {
    const rows = await db
      .select({
        id: subjects.id,
        codeInPlan: subjects.codeInPlan,
        name: subjects.name,
        shortName: subjects.shortName,
        level: subjects.level,
        kind: subjects.kind,
      })
      .from(subjects)
      .where(eq(subjects.planId, planId));
    return rows;
  }

  async getSubjectByIdOrCode(
    planId: string,
    idOrCode: string | number
  ): Promise<PlanSubjectRef | null> {
    if (typeof idOrCode === 'number' || /^\d+$/.test(String(idOrCode))) {
      const numCode = Number(idOrCode);
      const [row] = await db
        .select({
          id: subjects.id,
          codeInPlan: subjects.codeInPlan,
          name: subjects.name,
          shortName: subjects.shortName,
          level: subjects.level,
          kind: subjects.kind,
        })
        .from(subjects)
        .where(and(eq(subjects.planId, planId), eq(subjects.codeInPlan, numCode)))
        .limit(1);
      return row || null;
    }

    const [row] = await db
      .select({
        id: subjects.id,
        codeInPlan: subjects.codeInPlan,
        name: subjects.name,
        shortName: subjects.shortName,
        level: subjects.level,
        kind: subjects.kind,
      })
      .from(subjects)
      .where(eq(subjects.id, String(idOrCode)))
      .limit(1);
    return row || null;
  }

  async getSubjectsByIds(subjectIds: string[]): Promise<Map<string, PlanSubjectRef>> {
    const map = new Map<string, PlanSubjectRef>();
    if (subjectIds.length === 0) return map;
    const rows = await db
      .select({
        id: subjects.id,
        codeInPlan: subjects.codeInPlan,
        name: subjects.name,
        shortName: subjects.shortName,
        level: subjects.level,
        kind: subjects.kind,
      })
      .from(subjects)
      .where(inArray(subjects.id, subjectIds));
    for (const r of rows) map.set(r.id, r);
    return map;
  }

  async listFacultyProfessors(facultyId: string): Promise<ProfessorEntity[]> {
    try {
      return await db
        .select()
        .from(professors)
        .where(eq(professors.facultyId, facultyId));
    } catch (err) {
      if (isMissingMigrationError(err)) return [];
      throw err;
    }
  }

  async listFacultyAliases(facultyId: string): Promise<ProfessorAliasEntity[]> {
    try {
      return await db
        .select({
          id: professorAliases.id,
          professorId: professorAliases.professorId,
          facultyId: professorAliases.facultyId,
          aliasRaw: professorAliases.aliasRaw,
          aliasNormalized: professorAliases.aliasNormalized,
        })
        .from(professorAliases)
        .where(eq(professorAliases.facultyId, facultyId));
    } catch (err) {
      if (isMissingMigrationError(err)) return [];
      throw err;
    }
  }

  async getProfessorById(
    professorId: string
  ): Promise<{ professor: ProfessorEntity; aliases: ProfessorAliasEntity[] } | null> {
    try {
      const [prof] = await db
        .select()
        .from(professors)
        .where(eq(professors.id, professorId))
        .limit(1);
      if (!prof) return null;

      const aliases = await db
        .select({
          id: professorAliases.id,
          professorId: professorAliases.professorId,
          facultyId: professorAliases.facultyId,
          aliasRaw: professorAliases.aliasRaw,
          aliasNormalized: professorAliases.aliasNormalized,
        })
        .from(professorAliases)
        .where(eq(professorAliases.professorId, professorId));

      return { professor: prof, aliases };
    } catch (err) {
      if (isMissingMigrationError(err)) return null;
      throw err;
    }
  }

  async getTeachingPairsForPlan(planId: string, facultyId: string): Promise<TeachingPair[]> {
    try {
      const planSubs = await this.getPlanSubjects(planId);
      const subMap = new Map(planSubs.map((s) => [s.id, s]));
      if (subMap.size === 0) return [];

      const terms = await db
        .select()
        .from(scheduleTerms)
        .where(eq(scheduleTerms.facultyId, facultyId));
      const termMap = new Map(terms.map((t) => [t.id, t]));

      const pairMap = new Map<string, TeachingPair>();

      const upsertPair = (
        professorId: string | null,
        subjectId: string,
        opts: { isCurrent?: boolean; isHistorical?: boolean; termLabel?: string }
      ) => {
        if (!professorId) return;
        const sub = subMap.get(subjectId);
        if (!sub) return;
        const key = `${professorId}::${subjectId}`;
        const existing = pairMap.get(key);
        if (existing) {
          if (opts.isCurrent) existing.isCurrentTerm = true;
          if (opts.isHistorical) existing.isHistoricalLink = true;
          if (opts.termLabel && !existing.termLabels.includes(opts.termLabel)) {
            existing.termLabels.push(opts.termLabel);
          }
        } else {
          pairMap.set(key, {
            professorId,
            subjectId,
            subjectCode: sub.codeInPlan,
            subjectName: sub.name,
            subjectShortName: sub.shortName,
            subjectLevel: sub.level,
            isCurrentTerm: Boolean(opts.isCurrent),
            isHistoricalLink: Boolean(opts.isHistorical),
            termLabels: opts.termLabel ? [opts.termLabel] : [],
          });
        }
      };

      // 1. Comisiones en TODOS los períodos cargados
      const commRows = await db
        .select({
          professorId: commissionProfessors.professorId,
          subjectId: commissions.subjectId,
          scheduleTermId: commissions.scheduleTermId,
        })
        .from(commissionProfessors)
        .innerJoin(commissions, eq(commissionProfessors.commissionId, commissions.id));

      for (const r of commRows) {
        const term = termMap.get(r.scheduleTermId);
        if (!term) continue;
        upsertPair(r.professorId, r.subjectId, {
          isCurrent: term.isCurrent,
          termLabel: `${term.academicYear} ${term.term}`,
        });
      }

      // 2. Ofertas de electivas en TODOS los períodos cargados
      const elecRows = await db
        .select({
          professorId: electiveOfferingProfessors.professorId,
          subjectId: electiveOfferings.subjectId,
          scheduleTermId: electiveOfferings.scheduleTermId,
        })
        .from(electiveOfferingProfessors)
        .innerJoin(
          electiveOfferings,
          eq(electiveOfferingProfessors.electiveOfferingId, electiveOfferings.id)
        );

      for (const r of elecRows) {
        const term = termMap.get(r.scheduleTermId);
        if (!term) continue;
        upsertPair(r.professorId, r.subjectId, {
          isCurrent: term.isCurrent,
          termLabel: `${term.academicYear} ${term.term}`,
        });
      }

      // 3. Vínculos históricos manuales creados por administradores
      const histRows = await db
        .select({
          professorId: professorSubjectLinks.professorId,
          subjectId: professorSubjectLinks.subjectId,
        })
        .from(professorSubjectLinks);

      for (const r of histRows) {
        upsertPair(r.professorId, r.subjectId, {
          isHistorical: true,
        });
      }

      return Array.from(pairMap.values());
    } catch (err) {
      if (isMissingMigrationError(err)) return [];
      throw err;
    }
  }

  async doesProfessorTeachSubject(professorId: string, subjectUuid: string): Promise<boolean> {
    const [inComm] = await db
      .select({ id: commissionProfessors.id })
      .from(commissionProfessors)
      .innerJoin(commissions, eq(commissionProfessors.commissionId, commissions.id))
      .where(
        and(
          eq(commissionProfessors.professorId, professorId),
          eq(commissions.subjectId, subjectUuid)
        )
      )
      .limit(1);
    if (inComm) return true;

    const [inElec] = await db
      .select({ id: electiveOfferingProfessors.id })
      .from(electiveOfferingProfessors)
      .innerJoin(
        electiveOfferings,
        eq(electiveOfferingProfessors.electiveOfferingId, electiveOfferings.id)
      )
      .where(
        and(
          eq(electiveOfferingProfessors.professorId, professorId),
          eq(electiveOfferings.subjectId, subjectUuid)
        )
      )
      .limit(1);
    if (inElec) return true;

    const [inHist] = await db
      .select({ id: professorSubjectLinks.id })
      .from(professorSubjectLinks)
      .where(
        and(
          eq(professorSubjectLinks.professorId, professorId),
          eq(professorSubjectLinks.subjectId, subjectUuid)
        )
      )
      .limit(1);
    return Boolean(inHist);
  }

  async getUserSubjectProgressMap(
    userId: string
  ): Promise<Map<string, { status: string; grade: number | null }>> {
    const rows = await db
      .select({
        subjectId: subjectProgress.subjectId,
        status: subjectProgress.status,
        grade: subjectProgress.grade,
      })
      .from(subjectProgress)
      .where(eq(subjectProgress.userId, userId));

    const map = new Map<string, { status: string; grade: number | null }>();
    for (const r of rows) {
      map.set(r.subjectId, {
        status: r.status,
        grade: r.grade !== null ? Number(r.grade) : null,
      });
    }
    return map;
  }

  async getGlobalPublishedSummary(
    facultyId?: string
  ): Promise<{ totalReviews: number; globalMean: number | null }> {
    try {
      if (facultyId) {
        const [row] = await db
          .select({
            cnt: count(),
            avgVal: sql<string | null>`AVG(${professorReviews.overall})`,
          })
          .from(professorReviews)
          .innerJoin(professors, eq(professorReviews.professorId, professors.id))
          .where(
            and(eq(professorReviews.status, 'published'), eq(professors.facultyId, facultyId))
          );
        const cnt = Number(row?.cnt || 0);
        return {
          totalReviews: cnt,
          globalMean: cnt > 0 && row?.avgVal ? Number(row.avgVal) : null,
        };
      }

      const [row] = await db
        .select({
          cnt: count(),
          avgVal: sql<string | null>`AVG(${professorReviews.overall})`,
        })
        .from(professorReviews)
        .where(eq(professorReviews.status, 'published'));
      const cnt = Number(row?.cnt || 0);
      return {
        totalReviews: cnt,
        globalMean: cnt > 0 && row?.avgVal ? Number(row.avgVal) : null,
      };
    } catch (err) {
      if (isMissingMigrationError(err)) return { totalReviews: 0, globalMean: null };
      throw err;
    }
  }

  async getProfessorStatsMap(professorIds: string[]): Promise<Map<string, ComputedAggregate>> {
    const map = new Map<string, ComputedAggregate>();
    if (professorIds.length === 0) return map;
    try {
      const rows = await db
        .select()
        .from(professorStats)
        .where(inArray(professorStats.professorId, professorIds));
      for (const r of rows) {
        map.set(r.professorId, mapDbStatsRow(r));
      }
      return map;
    } catch (err) {
      if (isMissingMigrationError(err)) return map;
      throw err;
    }
  }

  async getProfessorSubjectStatsMap(professorId: string): Promise<Map<string, ComputedAggregate>> {
    const map = new Map<string, ComputedAggregate>();
    try {
      const rows = await db
        .select()
        .from(professorSubjectStats)
        .where(eq(professorSubjectStats.professorId, professorId));
      for (const r of rows) {
        map.set(r.subjectId, mapDbStatsRow(r));
      }
      return map;
    } catch (err) {
      if (isMissingMigrationError(err)) return map;
      throw err;
    }
  }

  async listPublishedReviews(params: {
    professorId: string;
    subjectUuid?: string;
    sort: 'recent' | 'helpful';
    page: number;
    pageSize: number;
    viewerUserId?: string;
  }) {
    const conditions = [
      eq(professorReviews.professorId, params.professorId),
      eq(professorReviews.status, 'published'),
    ];
    if (params.subjectUuid) {
      conditions.push(eq(professorReviews.subjectId, params.subjectUuid));
    }
    const whereClause = and(...conditions);

    const [totalRow] = await db
      .select({ value: count() })
      .from(professorReviews)
      .where(whereClause);
    const total = Number(totalRow?.value || 0);

    const orderBy =
      params.sort === 'helpful'
        ? [desc(professorReviews.helpfulCount), desc(professorReviews.createdAt)]
        : [desc(professorReviews.createdAt)];

    const offset = Math.max(0, (params.page - 1) * params.pageSize);
    const rows = await db
      .select()
      .from(professorReviews)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.pageSize)
      .offset(offset);

    const items = rows.map(mapDbReviewRow);
    const reviewIds = items.map((i) => i.id);

    const viewerHelpfulIds = new Set<string>();
    const viewerReportedIds = new Set<string>();

    if (params.viewerUserId && reviewIds.length > 0) {
      const votes = await db
        .select({ reviewId: reviewHelpfulVotes.reviewId })
        .from(reviewHelpfulVotes)
        .where(
          and(
            eq(reviewHelpfulVotes.userId, params.viewerUserId),
            inArray(reviewHelpfulVotes.reviewId, reviewIds)
          )
        );
      votes.forEach((v) => viewerHelpfulIds.add(v.reviewId));

      const reports = await db
        .select({ reviewId: reviewReports.reviewId })
        .from(reviewReports)
        .where(
          and(
            eq(reviewReports.reporterUserId, params.viewerUserId),
            inArray(reviewReports.reviewId, reviewIds)
          )
        );
      reports.forEach((rp) => viewerReportedIds.add(rp.reviewId));
    }

    return { items, total, viewerHelpfulIds, viewerReportedIds };
  }

  async listRecentPublishedReviewsBatch(
    professorIds: string[],
    limitPerProfessor: number
  ): Promise<Map<string, StoredReview[]>> {
    const map = new Map<string, StoredReview[]>();
    if (professorIds.length === 0) return map;
    try {
      const rows = await db
        .select()
        .from(professorReviews)
        .where(
          and(
            inArray(professorReviews.professorId, professorIds),
            eq(professorReviews.status, 'published')
          )
        )
        .orderBy(desc(professorReviews.createdAt));

      for (const r of rows) {
        const list = map.get(r.professorId) || [];
        if (list.length < limitPerProfessor) {
          list.push(mapDbReviewRow(r));
          map.set(r.professorId, list);
        }
      }
      return map;
    } catch (err) {
      if (isMissingMigrationError(err)) return map;
      throw err;
    }
  }

  async listUserOwnReviews(userId: string): Promise<StoredReview[]> {
    try {
      const rows = await db
        .select()
        .from(professorReviews)
        .where(eq(professorReviews.userId, userId))
        .orderBy(desc(professorReviews.createdAt));
      return rows.map(mapDbReviewRow).filter((r) => r.status !== 'removed');
    } catch (err) {
      if (isMissingMigrationError(err)) return [];
      throw err;
    }
  }

  async getReviewById(reviewId: string): Promise<StoredReview | null> {
    const [row] = await db
      .select()
      .from(professorReviews)
      .where(eq(professorReviews.id, reviewId))
      .limit(1);
    return row ? mapDbReviewRow(row) : null;
  }

  async findUserReview(
    userId: string,
    professorId: string,
    subjectUuid: string
  ): Promise<StoredReview | null> {
    const [row] = await db
      .select()
      .from(professorReviews)
      .where(
        and(
          eq(professorReviews.userId, userId),
          eq(professorReviews.professorId, professorId),
          eq(professorReviews.subjectId, subjectUuid)
        )
      )
      .limit(1);
    return row ? mapDbReviewRow(row) : null;
  }

  async countUserNewReviewsSince(userId: string, since: Date): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(professorReviews)
      .where(and(eq(professorReviews.userId, userId), gte(professorReviews.createdAt, since)));
    return Number(row?.value || 0);
  }

  async createReview(input: {
    userId: string;
    professorId: string;
    subjectId: string;
    academicYear: number | null;
    term: '1C' | '2C' | 'A' | null;
    overall: number;
    clarity: number | null;
    treatment: number | null;
    availability: number | null;
    difficulty: number | null;
    wouldRecommend: boolean | null;
    comment: string | null;
  }): Promise<StoredReview> {
    const attendedDeclared = await this.hasUserDeclaredAttendance(
      input.userId,
      input.professorId,
      input.subjectId
    );
    const [inserted] = await db
      .insert(professorReviews)
      .values({
        userId: input.userId,
        professorId: input.professorId,
        subjectId: input.subjectId,
        academicYear: input.academicYear,
        term: input.term,
        overall: input.overall,
        clarity: input.clarity,
        treatment: input.treatment,
        availability: input.availability,
        difficulty: input.difficulty,
        wouldRecommend: input.wouldRecommend,
        comment: input.comment,
        status: 'published',
        attendedDeclared,
      })
      .returning();

    await this.recalculateProfessorStats(input.professorId);
    return mapDbReviewRow(inserted);
  }

  async updateReview(
    reviewId: string,
    input: {
      academicYear: number | null;
      term: '1C' | '2C' | 'A' | null;
      overall: number;
      clarity: number | null;
      treatment: number | null;
      availability: number | null;
      difficulty: number | null;
      wouldRecommend: boolean | null;
      comment: string | null;
    }
  ): Promise<StoredReview> {
    const [existingRow] = await db
      .select()
      .from(professorReviews)
      .where(eq(professorReviews.id, reviewId))
      .limit(1);
    const attendedDeclared = existingRow
      ? await this.hasUserDeclaredAttendance(
          existingRow.userId,
          existingRow.professorId,
          existingRow.subjectId
        )
      : false;

    const [updated] = await db
      .update(professorReviews)
      .set({
        academicYear: input.academicYear,
        term: input.term,
        overall: input.overall,
        clarity: input.clarity,
        treatment: input.treatment,
        availability: input.availability,
        difficulty: input.difficulty,
        wouldRecommend: input.wouldRecommend,
        comment: input.comment,
        attendedDeclared,
        updatedAt: new Date(),
      })
      .where(eq(professorReviews.id, reviewId))
      .returning();

    await this.recalculateProfessorStats(updated.professorId);
    return mapDbReviewRow(updated);
  }

  async deleteReview(reviewId: string): Promise<void> {
    const [deleted] = await db
      .delete(professorReviews)
      .where(eq(professorReviews.id, reviewId))
      .returning({ professorId: professorReviews.professorId });
    if (deleted) {
      await this.recalculateProfessorStats(deleted.professorId);
    }
  }

  async toggleHelpfulVote(
    reviewId: string,
    userId: string
  ): Promise<{ voted: boolean; helpfulCount: number }> {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(reviewHelpfulVotes)
        .where(
          and(eq(reviewHelpfulVotes.reviewId, reviewId), eq(reviewHelpfulVotes.userId, userId))
        )
        .limit(1);

      if (existing) {
        await tx
          .delete(reviewHelpfulVotes)
          .where(
            and(eq(reviewHelpfulVotes.reviewId, reviewId), eq(reviewHelpfulVotes.userId, userId))
          );
      } else {
        await tx.insert(reviewHelpfulVotes).values({ reviewId, userId });
      }

      const [cntRow] = await tx
        .select({ value: count() })
        .from(reviewHelpfulVotes)
        .where(eq(reviewHelpfulVotes.reviewId, reviewId));
      const helpfulCount = Number(cntRow?.value || 0);

      await tx
        .update(professorReviews)
        .set({ helpfulCount })
        .where(eq(professorReviews.id, reviewId));

      return { voted: !existing, helpfulCount };
    });
  }

  async createReport(params: {
    reviewId: string;
    reporterUserId: string;
    reason: ReportReason;
    note: string | null;
    autoHideThreshold: number;
  }) {
    const [existing] = await db
      .select({ id: reviewReports.id })
      .from(reviewReports)
      .where(
        and(
          eq(reviewReports.reviewId, params.reviewId),
          eq(reviewReports.reporterUserId, params.reporterUserId)
        )
      )
      .limit(1);

    if (existing) {
      const [openCnt] = await db
        .select({ value: count() })
        .from(reviewReports)
        .where(
          and(eq(reviewReports.reviewId, params.reviewId), eq(reviewReports.status, 'open'))
        );
      return {
        duplicate: true,
        openReportsCount: Number(openCnt?.value || 0),
        autoHidden: false,
      };
    }

    const [created] = await db
      .insert(reviewReports)
      .values({
        reviewId: params.reviewId,
        reporterUserId: params.reporterUserId,
        reason: params.reason,
        note: params.note,
        status: 'open',
      })
      .returning({ id: reviewReports.id });

    const [openCnt] = await db
      .select({ value: count() })
      .from(reviewReports)
      .where(and(eq(reviewReports.reviewId, params.reviewId), eq(reviewReports.status, 'open')));
    const openReportsCount = Number(openCnt?.value || 0);

    let autoHidden = false;
    if (openReportsCount >= params.autoHideThreshold) {
      const [review] = await db
        .select()
        .from(professorReviews)
        .where(eq(professorReviews.id, params.reviewId))
        .limit(1);
      if (review && review.status === 'published') {
        await db
          .update(professorReviews)
          .set({ status: 'hidden', updatedAt: new Date() })
          .where(eq(professorReviews.id, params.reviewId));
        autoHidden = true;
        await this.recalculateProfessorStats(review.professorId);
      }
    }

    return {
      duplicate: false,
      reportId: created.id,
      openReportsCount,
      autoHidden,
    };
  }

  async createOrResolveProfessor(params: {
    facultyId: string;
    displayName: string;
  }): Promise<ProfessorEntity> {
    const parsed = parseProfessorName(params.displayName);
    const [byAlias] = await db
      .select({ professorId: professorAliases.professorId })
      .from(professorAliases)
      .where(
        and(
          eq(professorAliases.facultyId, params.facultyId),
          eq(professorAliases.aliasNormalized, parsed.normalizedKey)
        )
      )
      .limit(1);

    if (byAlias) {
      const [existing] = await db
        .select()
        .from(professors)
        .where(eq(professors.id, byAlias.professorId))
        .limit(1);
      if (existing) return existing;
    }

    const [byKey] = await db
      .select()
      .from(professors)
      .where(
        and(
          eq(professors.facultyId, params.facultyId),
          eq(professors.normalizedKey, parsed.normalizedKey)
        )
      )
      .limit(1);

    if (byKey) return byKey;

    const [created] = await db
      .insert(professors)
      .values({
        facultyId: params.facultyId,
        displayName: parsed.cleanDisplay,
        normalizedKey: parsed.normalizedKey,
      })
      .returning();

    await db
      .insert(professorAliases)
      .values({
        professorId: created.id,
        facultyId: params.facultyId,
        aliasRaw: parsed.cleanDisplay,
        aliasNormalized: parsed.normalizedKey,
      })
      .onConflictDoNothing();

    await db
      .insert(professorStats)
      .values({ professorId: created.id, reviewCount: 0 })
      .onConflictDoNothing();

    return created;
  }

  async renameProfessor(professorId: string, displayName: string): Promise<ProfessorEntity | null> {
    const cleaned = cleanDisplayName(displayName);
    const [updated] = await db
      .update(professors)
      .set({ displayName: cleaned, updatedAt: new Date() })
      .where(eq(professors.id, professorId))
      .returning();
    return updated || null;
  }

  async linkHistoricalSubject(params: {
    professorId: string;
    subjectId: string;
    adminUserId: string | null;
    note: string | null;
  }): Promise<{ created: boolean; linkId: string }> {
    const [existing] = await db
      .select({ id: professorSubjectLinks.id })
      .from(professorSubjectLinks)
      .where(
        and(
          eq(professorSubjectLinks.professorId, params.professorId),
          eq(professorSubjectLinks.subjectId, params.subjectId)
        )
      )
      .limit(1);

    if (existing) {
      return { created: false, linkId: existing.id };
    }

    const [inserted] = await db
      .insert(professorSubjectLinks)
      .values({
        professorId: params.professorId,
        subjectId: params.subjectId,
        source: 'historical',
        notes: params.note,
        createdBy: params.adminUserId,
      })
      .returning({ id: professorSubjectLinks.id });

    return { created: true, linkId: inserted.id };
  }

  async mergeProfessors(sourceProfessorId: string, targetProfessorId: string) {
    return await db.transaction(async (tx) => {
      const [source] = await tx
        .select()
        .from(professors)
        .where(eq(professors.id, sourceProfessorId))
        .limit(1);
      const [target] = await tx
        .select()
        .from(professors)
        .where(eq(professors.id, targetProfessorId))
        .limit(1);

      if (!source || !target) {
        const err = new Error('Uno de los profesores especificados no existe');
        (err as any).status = 404;
        throw err;
      }

      if (source.facultyId !== target.facultyId) {
        const err = new Error('Solo se pueden fusionar profesores de la misma facultad');
        (err as any).status = 400;
        throw err;
      }

      // 1. Mover comisiones
      const movedCommRows = await tx
        .update(commissionProfessors)
        .set({ professorId: target.id, updatedAt: new Date() })
        .where(eq(commissionProfessors.professorId, source.id))
        .returning({ id: commissionProfessors.id });

      // 2. Mover ofertas de electivas
      const movedElecRows = await tx
        .update(electiveOfferingProfessors)
        .set({ professorId: target.id, updatedAt: new Date() })
        .where(eq(electiveOfferingProfessors.professorId, source.id))
        .returning({ id: electiveOfferingProfessors.id });

      // 3. Mover vínculos históricos manuales sin colisionar
      const sourceHistLinks = await tx
        .select()
        .from(professorSubjectLinks)
        .where(eq(professorSubjectLinks.professorId, source.id));

      for (const link of sourceHistLinks) {
        await tx
          .insert(professorSubjectLinks)
          .values({
            professorId: target.id,
            subjectId: link.subjectId,
            source: link.source,
            notes: link.notes,
            createdBy: link.createdBy,
          })
          .onConflictDoNothing();
      }

      // 4. Mover alias existentes + registrar el display_name/normalized_key de source como alias de target
      await tx
        .update(professorAliases)
        .set({ professorId: target.id })
        .where(eq(professorAliases.professorId, source.id));

      await tx
        .insert(professorAliases)
        .values({
          professorId: target.id,
          facultyId: target.facultyId,
          aliasRaw: source.displayName,
          aliasNormalized: source.normalizedKey,
        })
        .onConflictDoNothing();

      // 4B. Mover enrollment_professors sin duplicados (PK compuesta enrollment_id, professor_id)
      const sourceEnrollProfs = await tx
        .select()
        .from(enrollmentProfessors)
        .where(eq(enrollmentProfessors.professorId, source.id));

      for (const ep of sourceEnrollProfs) {
        await tx
          .insert(enrollmentProfessors)
          .values({
            enrollmentId: ep.enrollmentId,
            professorId: target.id,
          })
          .onConflictDoNothing();
      }
      await tx
        .delete(enrollmentProfessors)
        .where(eq(enrollmentProfessors.professorId, source.id));

      // 4C. Mover review_recommendation_dismissals sin duplicados (PK compuesta user_id, professor_id, subject_id)
      const sourceDismissals = await tx
        .select()
        .from(reviewRecommendationDismissals)
        .where(eq(reviewRecommendationDismissals.professorId, source.id));

      for (const dm of sourceDismissals) {
        await tx
          .insert(reviewRecommendationDismissals)
          .values({
            userId: dm.userId,
            professorId: target.id,
            subjectId: dm.subjectId,
            createdAt: dm.createdAt,
          })
          .onConflictDoNothing();
      }
      await tx
        .delete(reviewRecommendationDismissals)
        .where(eq(reviewRecommendationDismissals.professorId, source.id));

      // 5. Mover reseñas cuidando unicidad (user_id, professor_id, subject_id)
      const sourceReviews = await tx
        .select()
        .from(professorReviews)
        .where(eq(professorReviews.professorId, source.id));
      const targetReviews = await tx
        .select()
        .from(professorReviews)
        .where(eq(professorReviews.professorId, target.id));

      const targetKeySet = new Set(targetReviews.map((r) => `${r.userId}::${r.subjectId}`));
      let movedReviews = 0;
      let deduplicatedReviews = 0;

      for (const sr of sourceReviews) {
        const key = `${sr.userId}::${sr.subjectId}`;
        if (targetKeySet.has(key)) {
          await tx.delete(professorReviews).where(eq(professorReviews.id, sr.id));
          deduplicatedReviews++;
        } else {
          await tx
            .update(professorReviews)
            .set({ professorId: target.id, updatedAt: new Date() })
            .where(eq(professorReviews.id, sr.id));
          targetKeySet.add(key);
          movedReviews++;
        }
      }

      // 6. Eliminar profesor origen
      await tx.delete(professors).where(eq(professors.id, source.id));

      // 7. Mejorar display_name si conviene o mantener el elegido por el admin (mantenemos el del target elegido)
      const [freshTarget] = await tx
        .select()
        .from(professors)
        .where(eq(professors.id, target.id))
        .limit(1);

      return {
        targetProfessor: freshTarget,
        movedCommissions: movedCommRows.length,
        movedElectives: movedElecRows.length,
        movedEnrollments: sourceEnrollProfs.length,
        movedDismissals: sourceDismissals.length,
        movedReviews,
        deduplicatedReviews,
      };
    }).then(async (res) => {
      await this.recalculateAttendedDeclaredForProfessor(res.targetProfessor.id);
      await this.recalculateProfessorStats(res.targetProfessor.id);
      return res;
    });
  }

  async listModerationQueue(): Promise<{
    openReports: AdminModerationReportItem[];
    hiddenReviews: AdminHiddenReviewItem[];
  }> {
    const reportsRows = await db
      .select({
        report: reviewReports,
        review: professorReviews,
        profName: professors.displayName,
        subCode: subjects.codeInPlan,
        subName: subjects.name,
      })
      .from(reviewReports)
      .innerJoin(professorReviews, eq(reviewReports.reviewId, professorReviews.id))
      .innerJoin(professors, eq(professorReviews.professorId, professors.id))
      .innerJoin(subjects, eq(professorReviews.subjectId, subjects.id))
      .where(eq(reviewReports.status, 'open'))
      .orderBy(desc(reviewReports.createdAt));

    const openCountByReview = new Map<string, number>();
    for (const r of reportsRows) {
      openCountByReview.set(r.review.id, (openCountByReview.get(r.review.id) || 0) + 1);
    }

    const openReports: AdminModerationReportItem[] = reportsRows.map((r) => ({
      reportId: r.report.id,
      reviewId: r.review.id,
      reason: r.report.reason as ReportReason,
      note: r.report.note,
      reportStatus: r.report.status as ReportStatus,
      reportedMonthYear: formatYearMonth(r.report.createdAt),
      openReportsOnReview: openCountByReview.get(r.review.id) || 1,
      review: {
        id: r.review.id,
        professorId: r.review.professorId,
        professorName: r.profName,
        subjectId: r.review.subjectId,
        subjectCode: r.subCode,
        subjectName: r.subName,
        overall: r.review.overall,
        comment: r.review.comment,
        status: r.review.status as ReviewStatus,
        publishedMonthYear: formatYearMonth(r.review.createdAt),
      },
    }));

    const hiddenRows = await db
      .select({
        review: professorReviews,
        profName: professors.displayName,
        subCode: subjects.codeInPlan,
        subName: subjects.name,
      })
      .from(professorReviews)
      .innerJoin(professors, eq(professorReviews.professorId, professors.id))
      .innerJoin(subjects, eq(professorReviews.subjectId, subjects.id))
      .where(eq(professorReviews.status, 'hidden'))
      .orderBy(desc(professorReviews.updatedAt));

    const hiddenReviews: AdminHiddenReviewItem[] = hiddenRows.map((h) => ({
      id: h.review.id,
      professorId: h.review.professorId,
      professorName: h.profName,
      subjectId: h.review.subjectId,
      subjectCode: h.subCode,
      subjectName: h.subName,
      overall: h.review.overall,
      comment: h.review.comment,
      status: h.review.status as ReviewStatus,
      openReportsCount: openCountByReview.get(h.review.id) || 0,
      publishedMonthYear: formatYearMonth(h.review.createdAt),
    }));

    return { openReports, hiddenReviews };
  }

  async setReviewStatus(reviewId: string, status: ReviewStatus): Promise<StoredReview | null> {
    const [updated] = await db
      .update(professorReviews)
      .set({ status, updatedAt: new Date() })
      .where(eq(professorReviews.id, reviewId))
      .returning();

    if (!updated) return null;

    if (status === 'hidden' || status === 'removed') {
      await db
        .update(reviewReports)
        .set({ status: 'actioned' })
        .where(and(eq(reviewReports.reviewId, reviewId), eq(reviewReports.status, 'open')));
    } else if (status === 'published') {
      // Al restaurar explícitamente una reseña, cerrar reportes abiertos previos como descartados
      await db
        .update(reviewReports)
        .set({ status: 'dismissed' })
        .where(and(eq(reviewReports.reviewId, reviewId), eq(reviewReports.status, 'open')));
    }

    await this.recalculateProfessorStats(updated.professorId);
    return mapDbReviewRow(updated);
  }

  async resolveReport(
    reportId: string,
    status: 'dismissed' | 'actioned',
    reviewStatus?: ReviewStatus
  ): Promise<boolean> {
    const [rep] = await db
      .update(reviewReports)
      .set({ status })
      .where(eq(reviewReports.id, reportId))
      .returning();
    if (!rep) return false;

    if (reviewStatus) {
      await this.setReviewStatus(rep.reviewId, reviewStatus);
    }
    return true;
  }

  async getAdminStats(facultyId?: string) {
    const profCond = facultyId ? eq(professors.facultyId, facultyId) : undefined;
    const [profCnt] = await db.select({ value: count() }).from(professors).where(profCond);
    const [profWithRevCnt] = await db
      .select({ value: count() })
      .from(professorStats)
      .where(gte(professorStats.reviewCount, 1));

    const allReviews = await db
      .select({ status: professorReviews.status, cnt: count() })
      .from(professorReviews)
      .groupBy(professorReviews.status);

    let publishedReviews = 0;
    let hiddenReviews = 0;
    let removedReviews = 0;
    for (const r of allReviews) {
      if (r.status === 'published') publishedReviews = Number(r.cnt);
      if (r.status === 'hidden') hiddenReviews = Number(r.cnt);
      if (r.status === 'removed') removedReviews = Number(r.cnt);
    }

    const [openRepCnt] = await db
      .select({ value: count() })
      .from(reviewReports)
      .where(eq(reviewReports.status, 'open'));

    const globalSummary = await this.getGlobalPublishedSummary(facultyId);

    return {
      totalProfessors: Number(profCnt?.value || 0),
      professorsWithReviews: Number(profWithRevCnt?.value || 0),
      publishedReviews,
      hiddenReviews,
      removedReviews,
      openReports: Number(openRepCnt?.value || 0),
      globalMean: globalSummary.globalMean,
    };
  }

  async getAffectedProfessorIdsByUser(userId: string): Promise<string[]> {
    try {
      const rows = await db
        .select({ professorId: professorReviews.professorId })
        .from(professorReviews)
        .where(eq(professorReviews.userId, userId));
      return Array.from(new Set(rows.map((r) => r.professorId)));
    } catch (err) {
      if (isMissingMigrationError(err)) return [];
      throw err;
    }
  }

  async recalculateProfessorStats(professorId: string): Promise<void> {
    const rows = await db
      .select()
      .from(professorReviews)
      .where(
        and(
          eq(professorReviews.professorId, professorId),
          eq(professorReviews.status, 'published')
        )
      );

    const mapped = rows.map(mapDbReviewRow);
    const agg = computeAggregatesFromReviews(mapped);
    const bayesian =
      agg.reviewCount > 0 && agg.avgOverall !== null
        ? String(
            Math.round(((agg.reviewCount * agg.avgOverall + 5 * 3.5) / (agg.reviewCount + 5)) * 1000) /
              1000
          )
        : null;

    await db
      .insert(professorStats)
      .values({
        professorId,
        reviewCount: agg.reviewCount,
        avgOverall: agg.avgOverall !== null ? String(agg.avgOverall) : null,
        bayesianScore: bayesian,
        avgClarity: agg.avgClarity !== null ? String(agg.avgClarity) : null,
        avgTreatment: agg.avgTreatment !== null ? String(agg.avgTreatment) : null,
        avgAvailability: agg.avgAvailability !== null ? String(agg.avgAvailability) : null,
        avgDifficulty: agg.avgDifficulty !== null ? String(agg.avgDifficulty) : null,
        recommendRate: agg.recommendPercent !== null ? String(agg.recommendPercent) : null,
        stars1: agg.distribution[1],
        stars2: agg.distribution[2],
        stars3: agg.distribution[3],
        stars4: agg.distribution[4],
        stars5: agg.distribution[5],
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: professorStats.professorId,
        set: {
          reviewCount: agg.reviewCount,
          avgOverall: agg.avgOverall !== null ? String(agg.avgOverall) : null,
          bayesianScore: bayesian,
          avgClarity: agg.avgClarity !== null ? String(agg.avgClarity) : null,
          avgTreatment: agg.avgTreatment !== null ? String(agg.avgTreatment) : null,
          avgAvailability: agg.avgAvailability !== null ? String(agg.avgAvailability) : null,
          avgDifficulty: agg.avgDifficulty !== null ? String(agg.avgDifficulty) : null,
          recommendRate: agg.recommendPercent !== null ? String(agg.recommendPercent) : null,
          stars1: agg.distribution[1],
          stars2: agg.distribution[2],
          stars3: agg.distribution[3],
          stars4: agg.distribution[4],
          stars5: agg.distribution[5],
          updatedAt: new Date(),
        },
      });

    // Recalcular desglose por materia
    await db
      .delete(professorSubjectStats)
      .where(eq(professorSubjectStats.professorId, professorId));

    const bySubject = new Map<string, StoredReview[]>();
    for (const r of mapped) {
      const list = bySubject.get(r.subjectId) || [];
      list.push(r);
      bySubject.set(r.subjectId, list);
    }

    for (const [subjectId, subReviews] of bySubject.entries()) {
      const subAgg = computeAggregatesFromReviews(subReviews);
      const subBayesian =
        subAgg.reviewCount > 0 && subAgg.avgOverall !== null
          ? String(
              Math.round(
                ((subAgg.reviewCount * subAgg.avgOverall + 5 * 3.5) / (subAgg.reviewCount + 5)) *
                  1000
              ) / 1000
            )
          : null;
      await db.insert(professorSubjectStats).values({
        professorId,
        subjectId,
        reviewCount: subAgg.reviewCount,
        avgOverall: subAgg.avgOverall !== null ? String(subAgg.avgOverall) : null,
        bayesianScore: subBayesian,
        avgClarity: subAgg.avgClarity !== null ? String(subAgg.avgClarity) : null,
        avgTreatment: subAgg.avgTreatment !== null ? String(subAgg.avgTreatment) : null,
        avgAvailability: subAgg.avgAvailability !== null ? String(subAgg.avgAvailability) : null,
        avgDifficulty: subAgg.avgDifficulty !== null ? String(subAgg.avgDifficulty) : null,
        recommendRate: subAgg.recommendPercent !== null ? String(subAgg.recommendPercent) : null,
        stars1: subAgg.distribution[1],
        stars2: subAgg.distribution[2],
        stars3: subAgg.distribution[3],
        stars4: subAgg.distribution[4],
        stars5: subAgg.distribution[5],
        updatedAt: new Date(),
      });
    }
  }

  // ==========================================================================
  // CURSADAS (ENROLLMENTS), ATTENDED_DECLARED Y RECOMENDACIONES
  // ==========================================================================

  private isValidUuid(val: string | null | undefined): boolean {
    if (!val) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  async hasUserDeclaredAttendance(
    userId: string,
    professorId: string,
    subjectUuid: string
  ): Promise<boolean> {
    try {
      const [row] = await db
        .select({ enrollmentId: enrollmentProfessors.enrollmentId })
        .from(enrollmentProfessors)
        .innerJoin(subjectEnrollments, eq(enrollmentProfessors.enrollmentId, subjectEnrollments.id))
        .where(
          and(
            eq(subjectEnrollments.userId, userId),
            eq(subjectEnrollments.subjectId, subjectUuid),
            eq(enrollmentProfessors.professorId, professorId)
          )
        )
        .limit(1);
      return Boolean(row);
    } catch (err) {
      if (isMissingMigrationError(err)) return false;
      throw err;
    }
  }

  async recalculateAttendedDeclaredForUserSubject(
    userId: string,
    subjectUuid: string
  ): Promise<void> {
    try {
      const reviews = await db
        .select({
          id: professorReviews.id,
          professorId: professorReviews.professorId,
          attendedDeclared: professorReviews.attendedDeclared,
        })
        .from(professorReviews)
        .where(
          and(
            eq(professorReviews.userId, userId),
            eq(professorReviews.subjectId, subjectUuid)
          )
        );
      if (reviews.length === 0) return;

      const declaredRows = await db
        .select({ professorId: enrollmentProfessors.professorId })
        .from(enrollmentProfessors)
        .innerJoin(subjectEnrollments, eq(enrollmentProfessors.enrollmentId, subjectEnrollments.id))
        .where(
          and(
            eq(subjectEnrollments.userId, userId),
            eq(subjectEnrollments.subjectId, subjectUuid)
          )
        );

      const declaredSet = new Set(declaredRows.map((r) => r.professorId));
      for (const rev of reviews) {
        const nextVal = declaredSet.has(rev.professorId);
        if (Boolean(rev.attendedDeclared) !== nextVal) {
          await db
            .update(professorReviews)
            .set({ attendedDeclared: nextVal })
            .where(eq(professorReviews.id, rev.id));
        }
      }
    } catch (err) {
      if (isMissingMigrationError(err)) return;
      throw err;
    }
  }

  async recalculateAttendedDeclaredForProfessor(professorId: string): Promise<void> {
    try {
      const reviews = await db
        .select({
          id: professorReviews.id,
          userId: professorReviews.userId,
          subjectId: professorReviews.subjectId,
          attendedDeclared: professorReviews.attendedDeclared,
        })
        .from(professorReviews)
        .where(eq(professorReviews.professorId, professorId));
      if (reviews.length === 0) return;

      const declaredPairs = await db
        .select({
          userId: subjectEnrollments.userId,
          subjectId: subjectEnrollments.subjectId,
        })
        .from(enrollmentProfessors)
        .innerJoin(subjectEnrollments, eq(enrollmentProfessors.enrollmentId, subjectEnrollments.id))
        .where(eq(enrollmentProfessors.professorId, professorId));

      const declaredKeySet = new Set(declaredPairs.map((p) => `${p.userId}::${p.subjectId}`));
      for (const rev of reviews) {
        const nextVal = declaredKeySet.has(`${rev.userId}::${rev.subjectId}`);
        if (Boolean(rev.attendedDeclared) !== nextVal) {
          await db
            .update(professorReviews)
            .set({ attendedDeclared: nextVal })
            .where(eq(professorReviews.id, rev.id));
        }
      }
    } catch (err) {
      if (isMissingMigrationError(err)) return;
      throw err;
    }
  }

  async getSubjectEnrollmentOptions(
    planId: string,
    facultyId: string,
    subjectUuid: string
  ): Promise<{
    commissions: SubjectCommissionOption[];
    professors: SubjectProfessorOption[];
  }> {
    const commRows = await db
      .select({
        id: commissions.id,
        code: commissions.code,
        turno: commissions.turno,
        termOffer: commissions.termOffer,
        scheduleTermId: commissions.scheduleTermId,
        academicYear: scheduleTerms.academicYear,
        term: scheduleTerms.term,
        periodLabel: scheduleTerms.label,
        isCurrent: scheduleTerms.isCurrent,
      })
      .from(commissions)
      .innerJoin(scheduleTerms, eq(commissions.scheduleTermId, scheduleTerms.id))
      .where(eq(commissions.subjectId, subjectUuid));

    const commIds = commRows.map((c) => c.id);
    const slotsByComm = new Map<string, CommissionSlotBrief[]>();
    const profsByComm = new Map<string, Array<{ professorId: string; displayName: string }>>();

    if (commIds.length > 0) {
      const slotRows = await db
        .select()
        .from(commissionSlots)
        .where(inArray(commissionSlots.commissionId, commIds));
      for (const sr of slotRows) {
        const list = slotsByComm.get(sr.commissionId) || [];
        list.push({
          day: sr.day,
          dayLabel: DAY_LABELS[sr.day] || String(sr.day),
          startTime: sr.startTime,
          endTime: sr.endTime,
          room: sr.room ?? null,
          mode: sr.mode ?? null,
        });
        slotsByComm.set(sr.commissionId, list);
      }

      const cpRows = await db
        .select({
          commissionId: commissionProfessors.commissionId,
          professorId: professors.id,
          displayName: professors.displayName,
        })
        .from(commissionProfessors)
        .innerJoin(professors, eq(commissionProfessors.professorId, professors.id))
        .where(inArray(commissionProfessors.commissionId, commIds));

      for (const cp of cpRows) {
        const list = profsByComm.get(cp.commissionId) || [];
        if (!list.some((x) => x.professorId === cp.professorId)) {
          list.push({ professorId: cp.professorId, displayName: cp.displayName });
        }
        profsByComm.set(cp.commissionId, list);
      }
    }

    const commissionOptions: SubjectCommissionOption[] = commRows
      .map((c) => ({
        id: c.id,
        code: c.code,
        turno: c.turno,
        termOffer: (c.termOffer as '1C' | '2C' | 'A') || (c.term as '1C' | '2C'),
        scheduleTermId: c.scheduleTermId,
        academicYear: c.academicYear,
        term: c.term as '1C' | '2C',
        periodLabel: c.periodLabel || `${c.academicYear} · ${c.term}`,
        isCurrent: c.isCurrent,
        slots: (slotsByComm.get(c.id) || []).sort(
          (a, b) => a.day - b.day || a.startTime.localeCompare(b.startTime)
        ),
        professors: (profsByComm.get(c.id) || []).sort((a, b) =>
          a.displayName.localeCompare(b.displayName, 'es')
        ),
      }))
      .sort(
        (a, b) =>
          Number(b.isCurrent) - Number(a.isCurrent) ||
          b.academicYear - a.academicYear ||
          a.term.localeCompare(b.term) ||
          a.code.localeCompare(b.code, 'es')
      );

    const [teachingPairs, allProfs] = await Promise.all([
      this.getTeachingPairsForPlan(planId, facultyId),
      this.listFacultyProfessors(facultyId),
    ]);
    const profMap = new Map(allProfs.map((p) => [p.id, p]));

    const professorOptions: SubjectProfessorOption[] = teachingPairs
      .filter((tp) => tp.subjectId === subjectUuid && profMap.has(tp.professorId))
      .map((tp) => ({
        professorId: tp.professorId,
        displayName: profMap.get(tp.professorId)!.displayName,
        isCurrentTerm: tp.isCurrentTerm,
        isHistoricalLink: tp.isHistoricalLink,
        termLabels: tp.termLabels,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));

    return {
      commissions: commissionOptions,
      professors: professorOptions,
    };
  }

  async getCommissionForEnrollment(commissionId: string): Promise<CommissionEnrollmentMeta | null> {
    if (!this.isValidUuid(commissionId)) return null;
    const [row] = await db
      .select({
        id: commissions.id,
        subjectId: commissions.subjectId,
        code: commissions.code,
        turno: commissions.turno,
        termOffer: commissions.termOffer,
        academicYear: scheduleTerms.academicYear,
        scheduleTerm: scheduleTerms.term,
        isCurrent: scheduleTerms.isCurrent,
      })
      .from(commissions)
      .innerJoin(scheduleTerms, eq(commissions.scheduleTermId, scheduleTerms.id))
      .where(eq(commissions.id, commissionId))
      .limit(1);

    if (!row) return null;

    const cpRows = await db
      .select({ professorId: commissionProfessors.professorId })
      .from(commissionProfessors)
      .where(eq(commissionProfessors.commissionId, row.id));

    const professorIds = Array.from(
      new Set(cpRows.map((r) => r.professorId).filter((pid): pid is string => Boolean(pid)))
    );

    return {
      id: row.id,
      subjectId: row.subjectId,
      code: row.code,
      turno: row.turno,
      termOffer: row.termOffer as '1C' | '2C' | 'A',
      academicYear: row.academicYear,
      scheduleTerm: row.scheduleTerm as '1C' | '2C',
      isCurrent: row.isCurrent,
      professorIds,
    };
  }

  async findSubjectCommissionByCode(params: {
    subjectUuid: string;
    code: string;
    academicYear?: number | null;
    term?: string | null;
  }): Promise<CommissionEnrollmentMeta | null> {
    const cleanCode = params.code.trim().toUpperCase();
    if (!cleanCode) return null;

    const rows = await db
      .select({
        id: commissions.id,
        subjectId: commissions.subjectId,
        code: commissions.code,
        turno: commissions.turno,
        termOffer: commissions.termOffer,
        academicYear: scheduleTerms.academicYear,
        scheduleTerm: scheduleTerms.term,
        isCurrent: scheduleTerms.isCurrent,
      })
      .from(commissions)
      .innerJoin(scheduleTerms, eq(commissions.scheduleTermId, scheduleTerms.id))
      .where(eq(commissions.subjectId, params.subjectUuid));

    const matching = rows.filter((r) => r.code.trim().toUpperCase() === cleanCode);
    if (matching.length === 0) return null;

    matching.sort((a, b) => {
      const aExactPeriod =
        (params.academicYear ? a.academicYear === params.academicYear : false) &&
        (params.term ? a.scheduleTerm === params.term || a.termOffer === params.term : true);
      const bExactPeriod =
        (params.academicYear ? b.academicYear === params.academicYear : false) &&
        (params.term ? b.scheduleTerm === params.term || b.termOffer === params.term : true);
      if (aExactPeriod !== bExactPeriod) return Number(bExactPeriod) - Number(aExactPeriod);
      if (a.isCurrent !== b.isCurrent) return Number(b.isCurrent) - Number(a.isCurrent);
      return b.academicYear - a.academicYear;
    });

    const chosen = matching[0];
    const cpRows = await db
      .select({ professorId: commissionProfessors.professorId })
      .from(commissionProfessors)
      .where(eq(commissionProfessors.commissionId, chosen.id));

    const professorIds = Array.from(
      new Set(cpRows.map((r) => r.professorId).filter((pid): pid is string => Boolean(pid)))
    );

    return {
      id: chosen.id,
      subjectId: chosen.subjectId,
      code: chosen.code,
      turno: chosen.turno,
      termOffer: chosen.termOffer as '1C' | '2C' | 'A',
      academicYear: chosen.academicYear,
      scheduleTerm: chosen.scheduleTerm as '1C' | '2C',
      isCurrent: chosen.isCurrent,
      professorIds,
    };
  }

  private async hydrateEnrollmentRows(
    rows: Array<typeof subjectEnrollments.$inferSelect>
  ): Promise<StoredEnrollment[]> {
    if (rows.length === 0) return [];

    const enrollIds = rows.map((r) => r.id);
    const subjectIds = Array.from(new Set(rows.map((r) => r.subjectId)));
    const commIds = Array.from(
      new Set(rows.map((r) => r.commissionId).filter((id): id is string => Boolean(id)))
    );

    const [subMap, commRows, epRows] = await Promise.all([
      this.getSubjectsByIds(subjectIds),
      commIds.length > 0
        ? db
            .select({ id: commissions.id, code: commissions.code, turno: commissions.turno })
            .from(commissions)
            .where(inArray(commissions.id, commIds))
        : Promise.resolve([]),
      db
        .select({
          enrollmentId: enrollmentProfessors.enrollmentId,
          professorId: professors.id,
          displayName: professors.displayName,
        })
        .from(enrollmentProfessors)
        .innerJoin(professors, eq(enrollmentProfessors.professorId, professors.id))
        .where(inArray(enrollmentProfessors.enrollmentId, enrollIds)),
    ]);

    const commMap = new Map(commRows.map((c) => [c.id, c]));
    const profsByEnroll = new Map<string, Array<{ professorId: string; displayName: string }>>();
    for (const ep of epRows) {
      const list = profsByEnroll.get(ep.enrollmentId) || [];
      list.push({ professorId: ep.professorId, displayName: ep.displayName });
      profsByEnroll.set(ep.enrollmentId, list);
    }

    return rows.map((r) => {
      const sub = subMap.get(r.subjectId);
      const comm = r.commissionId ? commMap.get(r.commissionId) : undefined;
      const profs = (profsByEnroll.get(r.id) || []).sort((a, b) =>
        a.displayName.localeCompare(b.displayName, 'es')
      );
      return {
        id: r.id,
        userId: r.userId,
        subjectId: r.subjectId,
        subjectCode: sub?.codeInPlan || 0,
        subjectName: sub?.name || 'Materia',
        subjectShortName: sub?.shortName || 'Materia',
        subjectLevel: sub?.level || 1,
        commissionId: r.commissionId ?? null,
        commissionCode: comm?.code ?? null,
        turno: comm?.turno ?? null,
        academicYear: r.academicYear ?? null,
        term: (r.term as EnrollmentTerm | null) ?? null,
        source: (r.source as EnrollmentSource) || 'manual',
        professors: profs,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });
  }

  async listUserEnrollments(userId: string, planId?: string | null): Promise<StoredEnrollment[]> {
    try {
      const rows = await db
        .select()
        .from(subjectEnrollments)
        .where(eq(subjectEnrollments.userId, userId))
        .orderBy(desc(subjectEnrollments.updatedAt));

      let hydrated = await this.hydrateEnrollmentRows(rows);
      if (planId) {
        const planSubs = await this.getPlanSubjects(planId);
        if (planSubs.length > 0) {
          const validIds = new Set(planSubs.map((s) => s.id));
          hydrated = hydrated.filter((e) => validIds.has(e.subjectId));
        }
      }
      return hydrated;
    } catch (err) {
      if (isMissingMigrationError(err)) return [];
      throw err;
    }
  }

  async getEnrollmentById(enrollmentId: string): Promise<StoredEnrollment | null> {
    if (!this.isValidUuid(enrollmentId)) return null;
    try {
      const [row] = await db
        .select()
        .from(subjectEnrollments)
        .where(eq(subjectEnrollments.id, enrollmentId))
        .limit(1);
      if (!row) return null;
      const [hydrated] = await this.hydrateEnrollmentRows([row]);
      return hydrated || null;
    } catch (err) {
      if (isMissingMigrationError(err)) return null;
      throw err;
    }
  }

  async saveUserEnrollment(params: {
    enrollmentId?: string | null;
    userId: string;
    subjectId: string;
    commissionId: string | null;
    academicYear: number | null;
    term: EnrollmentTerm | null;
    source: EnrollmentSource;
    professorIds: string[];
  }): Promise<StoredEnrollment> {
    const uniqueProfIds = Array.from(new Set(params.professorIds));

    const targetId = await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(subjectEnrollments)
        .where(
          and(
            eq(subjectEnrollments.userId, params.userId),
            eq(subjectEnrollments.subjectId, params.subjectId)
          )
        );

      const existingIds = existingRows.map((r) => r.id);
      const profCountMap = new Map<string, number>();
      if (existingIds.length > 0) {
        const epRows = await tx
          .select()
          .from(enrollmentProfessors)
          .where(inArray(enrollmentProfessors.enrollmentId, existingIds));
        for (const ep of epRows) {
          profCountMap.set(ep.enrollmentId, (profCountMap.get(ep.enrollmentId) || 0) + 1);
        }
      }

      const isEmptyPlaceholder = (r: typeof subjectEnrollments.$inferSelect) =>
        r.academicYear === null &&
        r.term === null &&
        r.commissionId === null &&
        (profCountMap.get(r.id) || 0) === 0;

      let chosenId: string | null = null;
      let skipProfReplace = false;

      if (params.enrollmentId) {
        const target = existingRows.find((r) => r.id === params.enrollmentId);
        if (!target) {
          const err = new Error('Cursada no encontrada');
          (err as any).status = 404;
          throw err;
        }
        if (params.academicYear !== null && params.term !== null) {
          const conflict = existingRows.find(
            (r) =>
              r.id !== params.enrollmentId &&
              r.academicYear === params.academicYear &&
              r.term === params.term
          );
          if (conflict) {
            const err = new Error(
              'Ya tenés otra cursada registrada para esta materia en ese mismo año y cuatrimestre.'
            );
            (err as any).status = 409;
            (err as any).code = 'DUPLICATE_ENROLLMENT_PERIOD';
            throw err;
          }
        }
        await tx
          .update(subjectEnrollments)
          .set({
            commissionId: params.commissionId,
            academicYear: params.academicYear,
            term: params.term,
            source: params.source,
            updatedAt: new Date(),
          })
          .where(eq(subjectEnrollments.id, target.id));
        chosenId = target.id;
      } else if (params.academicYear !== null && params.term !== null) {
        const samePeriod = existingRows.find(
          (r) => r.academicYear === params.academicYear && r.term === params.term
        );
        const placeholder = existingRows.find(isEmptyPlaceholder);
        const toUpdate = samePeriod || placeholder;
        if (toUpdate) {
          await tx
            .update(subjectEnrollments)
            .set({
              commissionId: params.commissionId,
              academicYear: params.academicYear,
              term: params.term,
              source: params.source,
              updatedAt: new Date(),
            })
            .where(eq(subjectEnrollments.id, toUpdate.id));
          chosenId = toUpdate.id;
        } else {
          const [inserted] = await tx
            .insert(subjectEnrollments)
            .values({
              userId: params.userId,
              subjectId: params.subjectId,
              commissionId: params.commissionId,
              academicYear: params.academicYear,
              term: params.term,
              source: params.source,
            })
            .returning({ id: subjectEnrollments.id });
          chosenId = inserted.id;
        }
      } else if (params.commissionId === null && uniqueProfIds.length === 0) {
        // Caso "No lo sé" sin período ni docentes: no pisar cursadas reales previas
        const placeholder = existingRows.find(isEmptyPlaceholder);
        if (placeholder) {
          await tx
            .update(subjectEnrollments)
            .set({ updatedAt: new Date() })
            .where(eq(subjectEnrollments.id, placeholder.id));
          chosenId = placeholder.id;
          skipProfReplace = true;
        } else if (existingRows.length > 0) {
          chosenId = existingRows[0].id;
          skipProfReplace = true;
        } else {
          const [inserted] = await tx
            .insert(subjectEnrollments)
            .values({
              userId: params.userId,
              subjectId: params.subjectId,
              commissionId: null,
              academicYear: null,
              term: null,
              source: params.source,
            })
            .returning({ id: subjectEnrollments.id });
          chosenId = inserted.id;
        }
      } else {
        const placeholder = existingRows.find(isEmptyPlaceholder);
        if (placeholder) {
          await tx
            .update(subjectEnrollments)
            .set({
              commissionId: params.commissionId,
              academicYear: params.academicYear,
              term: params.term,
              source: params.source,
              updatedAt: new Date(),
            })
            .where(eq(subjectEnrollments.id, placeholder.id));
          chosenId = placeholder.id;
        } else {
          const [inserted] = await tx
            .insert(subjectEnrollments)
            .values({
              userId: params.userId,
              subjectId: params.subjectId,
              commissionId: params.commissionId,
              academicYear: params.academicYear,
              term: params.term,
              source: params.source,
            })
            .returning({ id: subjectEnrollments.id });
          chosenId = inserted.id;
        }
      }

      if (!skipProfReplace && chosenId) {
        await tx
          .delete(enrollmentProfessors)
          .where(eq(enrollmentProfessors.enrollmentId, chosenId));
        if (uniqueProfIds.length > 0) {
          await tx.insert(enrollmentProfessors).values(
            uniqueProfIds.map((pid) => ({
              enrollmentId: chosenId!,
              professorId: pid,
            }))
          );
        }
      }

      return chosenId!;
    });

    await this.recalculateAttendedDeclaredForUserSubject(params.userId, params.subjectId);
    const saved = await this.getEnrollmentById(targetId);
    return saved!;
  }

  async deleteUserEnrollment(
    userId: string,
    enrollmentId: string
  ): Promise<{ deleted: boolean; subjectId?: string }> {
    if (!this.isValidUuid(enrollmentId)) return { deleted: false };
    const [existing] = await db
      .select()
      .from(subjectEnrollments)
      .where(and(eq(subjectEnrollments.id, enrollmentId), eq(subjectEnrollments.userId, userId)))
      .limit(1);

    if (!existing) {
      return { deleted: false };
    }

    await db
      .delete(subjectEnrollments)
      .where(and(eq(subjectEnrollments.id, enrollmentId), eq(subjectEnrollments.userId, userId)));

    await this.recalculateAttendedDeclaredForUserSubject(userId, existing.subjectId);
    return { deleted: true, subjectId: existing.subjectId };
  }

  async listUserDismissedRecommendations(userId: string): Promise<Set<string>> {
    try {
      const rows = await db
        .select({
          professorId: reviewRecommendationDismissals.professorId,
          subjectId: reviewRecommendationDismissals.subjectId,
        })
        .from(reviewRecommendationDismissals)
        .where(eq(reviewRecommendationDismissals.userId, userId));
      return new Set(rows.map((r) => `${r.professorId}::${r.subjectId}`));
    } catch (err) {
      if (isMissingMigrationError(err)) return new Set();
      throw err;
    }
  }

  async dismissRecommendation(
    userId: string,
    professorId: string,
    subjectUuid: string
  ): Promise<void> {
    await db
      .insert(reviewRecommendationDismissals)
      .values({
        userId,
        professorId,
        subjectId: subjectUuid,
      })
      .onConflictDoNothing();
  }

  async getUserSeenRecommendationKeys(userId: string): Promise<Set<string>> {
    try {
      const [row] = await db
        .select({ extraSettings: userSettings.extraSettings })
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);
      const raw = (row?.extraSettings as Record<string, unknown> | null)?.seenRecommendationKeys;
      if (Array.isArray(raw)) {
        return new Set(raw.filter((x): x is string => typeof x === 'string'));
      }
      return new Set();
    } catch {
      return new Set();
    }
  }

  async markRecommendationsSeen(userId: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const [existing] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    const prevExtra =
      existing?.extraSettings && typeof existing.extraSettings === 'object'
        ? (existing.extraSettings as Record<string, unknown>)
        : {};
    const prevList = Array.isArray(prevExtra.seenRecommendationKeys)
      ? prevExtra.seenRecommendationKeys.filter((x): x is string => typeof x === 'string')
      : [];
    const merged = Array.from(new Set([...prevList, ...keys])).slice(-500);
    const nextExtra = {
      ...prevExtra,
      seenRecommendationKeys: merged,
    };

    if (existing) {
      await db
        .update(userSettings)
        .set({ extraSettings: nextExtra, updatedAt: new Date() })
        .where(eq(userSettings.userId, userId));
    } else {
      await db.insert(userSettings).values({
        userId,
        extraSettings: nextExtra,
      });
    }
  }
}

// ============================================================================
// 2. IMPLEMENTACIÓN EN MEMORIA (AISLADA SIN TOCAR NEON PARA TESTS HTTP)
// ============================================================================

export class InMemoryReviewsStore implements ReviewsStore {
  public defaultFacultyId: string = crypto.randomUUID();
  public defaultPlanId: string = crypto.randomUUID();
  public subjectsMap = new Map<string, PlanSubjectRef & { planId: string }>();
  public professorsMap = new Map<string, ProfessorEntity>();
  public aliasesList: ProfessorAliasEntity[] = [];
  public commissionTeachings: Array<{
    professorId: string;
    subjectId: string;
    termLabel: string;
    isCurrent: boolean;
  }> = [];
  public electiveTeachings: Array<{
    professorId: string;
    subjectId: string;
    termLabel: string;
    isCurrent: boolean;
  }> = [];
  public historicalLinks: Array<{
    id: string;
    professorId: string;
    subjectId: string;
    note: string | null;
    adminUserId: string | null;
  }> = [];
  public userProgress = new Map<string, Map<string, { status: string; grade: number | null }>>();
  public reviewsMap = new Map<string, StoredReview>();
  public helpfulVotes = new Set<string>(); // `${reviewId}::${userId}`
  public reportsList: Array<{
    id: string;
    reviewId: string;
    reporterUserId: string;
    reason: ReportReason;
    note: string | null;
    status: ReportStatus;
    createdAt: Date;
  }> = [];
  public statsMap = new Map<string, ComputedAggregate>();
  public subjectStatsMap = new Map<string, Map<string, ComputedAggregate>>();
  public commissionsMap = new Map<
    string,
    {
      id: string;
      subjectId: string;
      code: string;
      turno: string;
      termOffer: '1C' | '2C' | 'A';
      scheduleTermId: string;
      academicYear: number;
      term: '1C' | '2C';
      periodLabel: string;
      isCurrent: boolean;
      slots: CommissionSlotBrief[];
      professorIds: string[];
    }
  >();
  public enrollmentsMap = new Map<
    string,
    {
      id: string;
      userId: string;
      subjectId: string;
      commissionId: string | null;
      academicYear: number | null;
      term: EnrollmentTerm | null;
      source: EnrollmentSource;
      professorIds: string[];
      createdAt: Date;
      updatedAt: Date;
    }
  >();
  public dismissedRecommendations = new Map<string, Set<string>>();
  public seenRecommendationKeys = new Map<string, Set<string>>();

  seedCommission(input: {
    id?: string;
    subjectId: string;
    code: string;
    turno?: string;
    termOffer?: '1C' | '2C' | 'A';
    academicYear?: number;
    term?: '1C' | '2C';
    isCurrent?: boolean;
    professorIds: string[];
    slots?: Array<{
      day: number;
      startTime: string;
      endTime: string;
      room?: string | null;
      mode?: string | null;
    }>;
  }) {
    const id = input.id || crypto.randomUUID();
    const academicYear = input.academicYear ?? 2026;
    const term = input.term ?? '1C';
    const isCurrent = input.isCurrent ?? true;
    const termOffer = input.termOffer ?? term;
    const comm = {
      id,
      subjectId: input.subjectId,
      code: input.code,
      turno: input.turno ?? 'M',
      termOffer,
      scheduleTermId: `${academicYear}-${term}`,
      academicYear,
      term,
      periodLabel: `${academicYear} · ${term}`,
      isCurrent,
      slots: (input.slots || []).map((s) => ({
        day: s.day,
        dayLabel: DAY_LABELS[s.day] || String(s.day),
        startTime: s.startTime,
        endTime: s.endTime,
        room: s.room ?? null,
        mode: s.mode ?? null,
      })),
      professorIds: Array.from(new Set(input.professorIds)),
    };
    this.commissionsMap.set(id, comm);
    for (const pid of comm.professorIds) {
      this.commissionTeachings.push({
        professorId: pid,
        subjectId: input.subjectId,
        termLabel: `${academicYear} ${term}`,
        isCurrent,
      });
    }
    return comm;
  }

  seedSubject(input: {
    codeInPlan: number;
    name: string;
    shortName?: string;
    level?: number;
    kind?: string;
    id?: string;
  }): PlanSubjectRef {
    const id = input.id || crypto.randomUUID();
    const sub = {
      id,
      planId: this.defaultPlanId,
      codeInPlan: input.codeInPlan,
      name: input.name,
      shortName: input.shortName || input.name,
      level: input.level || 1,
      kind: input.kind || 'obligatoria',
    };
    this.subjectsMap.set(id, sub);
    return sub;
  }

  seedUserProgress(userId: string, subjectId: string, status: string, grade: number | null = null) {
    const map = this.userProgress.get(userId) || new Map();
    map.set(subjectId, { status, grade });
    this.userProgress.set(userId, map);
  }

  seedCommissionTeaching(params: {
    professorId: string;
    subjectId: string;
    termLabel: string;
    isCurrent: boolean;
  }) {
    this.commissionTeachings.push(params);
  }

  async resolvePlanContext(
    _userId: string,
    requestedPlanId?: string | null
  ): Promise<PlanContext | null> {
    const planId =
      requestedPlanId && requestedPlanId !== 'current' && requestedPlanId !== 'default'
        ? requestedPlanId
        : this.defaultPlanId;
    return { planId, facultyId: this.defaultFacultyId };
  }

  async getDefaultFacultyId(): Promise<string | null> {
    return this.defaultFacultyId;
  }

  async getPlanSubjects(planId: string): Promise<PlanSubjectRef[]> {
    return Array.from(this.subjectsMap.values()).filter((s) => s.planId === planId);
  }

  async getSubjectByIdOrCode(
    planId: string,
    idOrCode: string | number
  ): Promise<PlanSubjectRef | null> {
    if (typeof idOrCode === 'number' || /^\d+$/.test(String(idOrCode))) {
      const code = Number(idOrCode);
      for (const s of this.subjectsMap.values()) {
        if (s.planId === planId && s.codeInPlan === code) return s;
      }
      return null;
    }
    return this.subjectsMap.get(String(idOrCode)) || null;
  }

  async getSubjectsByIds(subjectIds: string[]): Promise<Map<string, PlanSubjectRef>> {
    const map = new Map<string, PlanSubjectRef>();
    for (const id of subjectIds) {
      const sub = this.subjectsMap.get(id);
      if (sub) map.set(id, sub);
    }
    return map;
  }

  async listFacultyProfessors(facultyId: string): Promise<ProfessorEntity[]> {
    return Array.from(this.professorsMap.values()).filter((p) => p.facultyId === facultyId);
  }

  async listFacultyAliases(facultyId: string): Promise<ProfessorAliasEntity[]> {
    return this.aliasesList.filter((a) => a.facultyId === facultyId);
  }

  async getProfessorById(
    professorId: string
  ): Promise<{ professor: ProfessorEntity; aliases: ProfessorAliasEntity[] } | null> {
    const professor = this.professorsMap.get(professorId);
    if (!professor) return null;
    const aliases = this.aliasesList.filter((a) => a.professorId === professorId);
    return { professor, aliases };
  }

  async getTeachingPairsForPlan(planId: string, _facultyId: string): Promise<TeachingPair[]> {
    const pairMap = new Map<string, TeachingPair>();

    const upsert = (
      professorId: string,
      subjectId: string,
      opts: { isCurrent?: boolean; isHistorical?: boolean; termLabel?: string }
    ) => {
      const sub = this.subjectsMap.get(subjectId);
      if (!sub || sub.planId !== planId) return;
      if (!this.professorsMap.has(professorId)) return;
      const key = `${professorId}::${subjectId}`;
      const existing = pairMap.get(key);
      if (existing) {
        if (opts.isCurrent) existing.isCurrentTerm = true;
        if (opts.isHistorical) existing.isHistoricalLink = true;
        if (opts.termLabel && !existing.termLabels.includes(opts.termLabel)) {
          existing.termLabels.push(opts.termLabel);
        }
      } else {
        pairMap.set(key, {
          professorId,
          subjectId,
          subjectCode: sub.codeInPlan,
          subjectName: sub.name,
          subjectShortName: sub.shortName,
          subjectLevel: sub.level,
          isCurrentTerm: Boolean(opts.isCurrent),
          isHistoricalLink: Boolean(opts.isHistorical),
          termLabels: opts.termLabel ? [opts.termLabel] : [],
        });
      }
    };

    for (const c of this.commissionTeachings) {
      upsert(c.professorId, c.subjectId, { isCurrent: c.isCurrent, termLabel: c.termLabel });
    }
    for (const e of this.electiveTeachings) {
      upsert(e.professorId, e.subjectId, { isCurrent: e.isCurrent, termLabel: e.termLabel });
    }
    for (const h of this.historicalLinks) {
      upsert(h.professorId, h.subjectId, { isHistorical: true });
    }

    return Array.from(pairMap.values());
  }

  async doesProfessorTeachSubject(professorId: string, subjectUuid: string): Promise<boolean> {
    if (
      this.commissionTeachings.some(
        (c) => c.professorId === professorId && c.subjectId === subjectUuid
      )
    ) {
      return true;
    }
    if (
      this.electiveTeachings.some(
        (e) => e.professorId === professorId && e.subjectId === subjectUuid
      )
    ) {
      return true;
    }
    if (
      this.historicalLinks.some(
        (h) => h.professorId === professorId && h.subjectId === subjectUuid
      )
    ) {
      return true;
    }
    return false;
  }

  async getUserSubjectProgressMap(
    userId: string
  ): Promise<Map<string, { status: string; grade: number | null }>> {
    return this.userProgress.get(userId) || new Map();
  }

  async getGlobalPublishedSummary(
    facultyId?: string
  ): Promise<{ totalReviews: number; globalMean: number | null }> {
    const published = Array.from(this.reviewsMap.values()).filter((r) => {
      if (r.status !== 'published') return false;
      if (facultyId) {
        const prof = this.professorsMap.get(r.professorId);
        return prof?.facultyId === facultyId;
      }
      return true;
    });
    if (published.length === 0) return { totalReviews: 0, globalMean: null };
    const sum = published.reduce((acc, r) => acc + r.overall, 0);
    return { totalReviews: published.length, globalMean: sum / published.length };
  }

  async getProfessorStatsMap(professorIds: string[]): Promise<Map<string, ComputedAggregate>> {
    const map = new Map<string, ComputedAggregate>();
    for (const id of professorIds) {
      map.set(id, this.statsMap.get(id) || emptyAggregate());
    }
    return map;
  }

  async getProfessorSubjectStatsMap(professorId: string): Promise<Map<string, ComputedAggregate>> {
    return this.subjectStatsMap.get(professorId) || new Map();
  }

  async listPublishedReviews(params: {
    professorId: string;
    subjectUuid?: string;
    sort: 'recent' | 'helpful';
    page: number;
    pageSize: number;
    viewerUserId?: string;
  }) {
    let list = Array.from(this.reviewsMap.values()).filter(
      (r) =>
        r.professorId === params.professorId &&
        r.status === 'published' &&
        (!params.subjectUuid || r.subjectId === params.subjectUuid)
    );

    list.sort((a, b) => {
      if (params.sort === 'helpful' && b.helpfulCount !== a.helpfulCount) {
        return b.helpfulCount - a.helpfulCount;
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    const total = list.length;
    const offset = Math.max(0, (params.page - 1) * params.pageSize);
    const items = list.slice(offset, offset + params.pageSize);

    const viewerHelpfulIds = new Set<string>();
    const viewerReportedIds = new Set<string>();
    if (params.viewerUserId) {
      for (const item of items) {
        if (this.helpfulVotes.has(`${item.id}::${params.viewerUserId}`)) {
          viewerHelpfulIds.add(item.id);
        }
        if (
          this.reportsList.some(
            (rp) => rp.reviewId === item.id && rp.reporterUserId === params.viewerUserId
          )
        ) {
          viewerReportedIds.add(item.id);
        }
      }
    }

    return { items, total, viewerHelpfulIds, viewerReportedIds };
  }

  async listRecentPublishedReviewsBatch(
    professorIds: string[],
    limitPerProfessor: number
  ): Promise<Map<string, StoredReview[]>> {
    const idSet = new Set(professorIds);
    const published = Array.from(this.reviewsMap.values())
      .filter((r) => idSet.has(r.professorId) && r.status === 'published')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const map = new Map<string, StoredReview[]>();
    for (const r of published) {
      const list = map.get(r.professorId) || [];
      if (list.length < limitPerProfessor) {
        list.push(r);
        map.set(r.professorId, list);
      }
    }
    return map;
  }

  async listUserOwnReviews(userId: string): Promise<StoredReview[]> {
    return Array.from(this.reviewsMap.values())
      .filter((r) => r.userId === userId && r.status !== 'removed')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getReviewById(reviewId: string): Promise<StoredReview | null> {
    return this.reviewsMap.get(reviewId) || null;
  }

  async findUserReview(
    userId: string,
    professorId: string,
    subjectUuid: string
  ): Promise<StoredReview | null> {
    for (const r of this.reviewsMap.values()) {
      if (r.userId === userId && r.professorId === professorId && r.subjectId === subjectUuid) {
        return r;
      }
    }
    return null;
  }

  async countUserNewReviewsSince(userId: string, since: Date): Promise<number> {
    let cnt = 0;
    for (const r of this.reviewsMap.values()) {
      if (r.userId === userId && r.createdAt.getTime() >= since.getTime()) {
        cnt++;
      }
    }
    return cnt;
  }

  async createReview(input: {
    userId: string;
    professorId: string;
    subjectId: string;
    academicYear: number | null;
    term: '1C' | '2C' | 'A' | null;
    overall: number;
    clarity: number | null;
    treatment: number | null;
    availability: number | null;
    difficulty: number | null;
    wouldRecommend: boolean | null;
    comment: string | null;
  }): Promise<StoredReview> {
    const now = new Date();
    const attendedDeclared = await this.hasUserDeclaredAttendance(
      input.userId,
      input.professorId,
      input.subjectId
    );
    const record: StoredReview = {
      id: crypto.randomUUID(),
      userId: input.userId,
      professorId: input.professorId,
      subjectId: input.subjectId,
      academicYear: input.academicYear,
      term: input.term,
      overall: input.overall,
      clarity: input.clarity,
      treatment: input.treatment,
      availability: input.availability,
      difficulty: input.difficulty,
      wouldRecommend: input.wouldRecommend,
      comment: input.comment,
      status: 'published',
      helpfulCount: 0,
      attendedDeclared,
      createdAt: now,
      updatedAt: now,
    };
    this.reviewsMap.set(record.id, record);
    await this.recalculateProfessorStats(record.professorId);
    return record;
  }

  async updateReview(
    reviewId: string,
    input: {
      academicYear: number | null;
      term: '1C' | '2C' | 'A' | null;
      overall: number;
      clarity: number | null;
      treatment: number | null;
      availability: number | null;
      difficulty: number | null;
      wouldRecommend: boolean | null;
      comment: string | null;
    }
  ): Promise<StoredReview> {
    const existing = this.reviewsMap.get(reviewId)!;
    const attendedDeclared = await this.hasUserDeclaredAttendance(
      existing.userId,
      existing.professorId,
      existing.subjectId
    );
    const updated: StoredReview = {
      ...existing,
      academicYear: input.academicYear,
      term: input.term,
      overall: input.overall,
      clarity: input.clarity,
      treatment: input.treatment,
      availability: input.availability,
      difficulty: input.difficulty,
      wouldRecommend: input.wouldRecommend,
      comment: input.comment,
      attendedDeclared,
      updatedAt: new Date(),
    };
    this.reviewsMap.set(reviewId, updated);
    await this.recalculateProfessorStats(updated.professorId);
    return updated;
  }

  async deleteReview(reviewId: string): Promise<void> {
    const existing = this.reviewsMap.get(reviewId);
    if (!existing) return;
    this.reviewsMap.delete(reviewId);
    this.reportsList = this.reportsList.filter((rp) => rp.reviewId !== reviewId);
    await this.recalculateProfessorStats(existing.professorId);
  }

  async toggleHelpfulVote(
    reviewId: string,
    userId: string
  ): Promise<{ voted: boolean; helpfulCount: number }> {
    const key = `${reviewId}::${userId}`;
    let voted: boolean;
    if (this.helpfulVotes.has(key)) {
      this.helpfulVotes.delete(key);
      voted = false;
    } else {
      this.helpfulVotes.add(key);
      voted = true;
    }

    let helpfulCount = 0;
    for (const k of this.helpfulVotes) {
      if (k.startsWith(`${reviewId}::`)) helpfulCount++;
    }
    const rev = this.reviewsMap.get(reviewId);
    if (rev) {
      rev.helpfulCount = helpfulCount;
    }
    return { voted, helpfulCount };
  }

  async createReport(params: {
    reviewId: string;
    reporterUserId: string;
    reason: ReportReason;
    note: string | null;
    autoHideThreshold: number;
  }) {
    const dup = this.reportsList.find(
      (rp) => rp.reviewId === params.reviewId && rp.reporterUserId === params.reporterUserId
    );
    if (dup) {
      const openReportsCount = this.reportsList.filter(
        (rp) => rp.reviewId === params.reviewId && rp.status === 'open'
      ).length;
      return { duplicate: true, openReportsCount, autoHidden: false };
    }

    const reportId = crypto.randomUUID();
    this.reportsList.push({
      id: reportId,
      reviewId: params.reviewId,
      reporterUserId: params.reporterUserId,
      reason: params.reason,
      note: params.note,
      status: 'open',
      createdAt: new Date(),
    });

    const openReportsCount = this.reportsList.filter(
      (rp) => rp.reviewId === params.reviewId && rp.status === 'open'
    ).length;

    let autoHidden = false;
    if (openReportsCount >= params.autoHideThreshold) {
      const rev = this.reviewsMap.get(params.reviewId);
      if (rev && rev.status === 'published') {
        rev.status = 'hidden';
        rev.updatedAt = new Date();
        autoHidden = true;
        await this.recalculateProfessorStats(rev.professorId);
      }
    }

    return { duplicate: false, reportId, openReportsCount, autoHidden };
  }

  async createOrResolveProfessor(params: {
    facultyId: string;
    displayName: string;
  }): Promise<ProfessorEntity> {
    const parsed = parseProfessorName(params.displayName);
    const aliasHit = this.aliasesList.find(
      (a) => a.facultyId === params.facultyId && a.aliasNormalized === parsed.normalizedKey
    );
    if (aliasHit) {
      const found = this.professorsMap.get(aliasHit.professorId);
      if (found) {
        const best = pickBestDisplayName([found.displayName, parsed.cleanDisplay]);
        if (best && best !== found.displayName) {
          found.displayName = best;
        }
        return found;
      }
    }

    for (const p of this.professorsMap.values()) {
      if (p.facultyId === params.facultyId && p.normalizedKey === parsed.normalizedKey) {
        return p;
      }
    }

    const now = new Date();
    const created: ProfessorEntity = {
      id: crypto.randomUUID(),
      facultyId: params.facultyId,
      displayName: parsed.cleanDisplay,
      normalizedKey: parsed.normalizedKey,
      createdAt: now,
      updatedAt: now,
    };
    this.professorsMap.set(created.id, created);
    this.aliasesList.push({
      id: crypto.randomUUID(),
      professorId: created.id,
      facultyId: params.facultyId,
      aliasRaw: parsed.raw,
      aliasNormalized: parsed.normalizedKey,
    });
    this.statsMap.set(created.id, emptyAggregate());
    return created;
  }

  async renameProfessor(professorId: string, displayName: string): Promise<ProfessorEntity | null> {
    const p = this.professorsMap.get(professorId);
    if (!p) return null;
    p.displayName = cleanDisplayName(displayName);
    p.updatedAt = new Date();
    return p;
  }

  async linkHistoricalSubject(params: {
    professorId: string;
    subjectId: string;
    adminUserId: string | null;
    note: string | null;
  }): Promise<{ created: boolean; linkId: string }> {
    const existing = this.historicalLinks.find(
      (h) => h.professorId === params.professorId && h.subjectId === params.subjectId
    );
    if (existing) return { created: false, linkId: existing.id };
    const id = crypto.randomUUID();
    this.historicalLinks.push({
      id,
      professorId: params.professorId,
      subjectId: params.subjectId,
      note: params.note,
      adminUserId: params.adminUserId,
    });
    return { created: true, linkId: id };
  }

  async mergeProfessors(sourceProfessorId: string, targetProfessorId: string) {
    const source = this.professorsMap.get(sourceProfessorId);
    const target = this.professorsMap.get(targetProfessorId);
    if (!source || !target) {
      const err = new Error('Uno de los profesores especificados no existe');
      (err as any).status = 404;
      throw err;
    }

    let movedCommissions = 0;
    for (const c of this.commissionTeachings) {
      if (c.professorId === source.id) {
        c.professorId = target.id;
        movedCommissions++;
      }
    }
    for (const comm of this.commissionsMap.values()) {
      if (comm.professorIds.includes(source.id)) {
        comm.professorIds = Array.from(
          new Set(comm.professorIds.map((pid) => (pid === source.id ? target.id : pid)))
        );
      }
    }

    let movedElectives = 0;
    for (const e of this.electiveTeachings) {
      if (e.professorId === source.id) {
        e.professorId = target.id;
        movedElectives++;
      }
    }

    for (const h of this.historicalLinks) {
      if (h.professorId === source.id) {
        const dup = this.historicalLinks.some(
          (x) => x.professorId === target.id && x.subjectId === h.subjectId
        );
        if (!dup) h.professorId = target.id;
      }
    }
    this.historicalLinks = this.historicalLinks.filter((h) => h.professorId !== source.id);

    for (const a of this.aliasesList) {
      if (a.professorId === source.id) {
        a.professorId = target.id;
      }
    }
    if (
      !this.aliasesList.some(
        (a) => a.facultyId === target.facultyId && a.aliasNormalized === source.normalizedKey
      )
    ) {
      this.aliasesList.push({
        id: crypto.randomUUID(),
        professorId: target.id,
        facultyId: target.facultyId,
        aliasRaw: source.displayName,
        aliasNormalized: source.normalizedKey,
      });
    }

    // Reasignar enrollment_professors sin duplicados
    let movedEnrollments = 0;
    for (const enr of this.enrollmentsMap.values()) {
      if (enr.professorIds.includes(source.id)) {
        movedEnrollments++;
        enr.professorIds = Array.from(
          new Set(enr.professorIds.map((pid) => (pid === source.id ? target.id : pid)))
        );
      }
    }

    // Reasignar review_recommendation_dismissals sin duplicados
    let movedDismissals = 0;
    for (const set of this.dismissedRecommendations.values()) {
      for (const entry of Array.from(set)) {
        const [pid, sid] = entry.split('::');
        if (pid === source.id) {
          set.delete(entry);
          set.add(`${target.id}::${sid}`);
          movedDismissals++;
        }
      }
    }

    const targetKeys = new Set<string>();
    for (const r of this.reviewsMap.values()) {
      if (r.professorId === target.id) {
        targetKeys.add(`${r.userId}::${r.subjectId}`);
      }
    }

    let movedReviews = 0;
    let deduplicatedReviews = 0;
    for (const [revId, r] of Array.from(this.reviewsMap.entries())) {
      if (r.professorId === source.id) {
        const k = `${r.userId}::${r.subjectId}`;
        if (targetKeys.has(k)) {
          this.reviewsMap.delete(revId);
          deduplicatedReviews++;
        } else {
          r.professorId = target.id;
          r.updatedAt = new Date();
          targetKeys.add(k);
          movedReviews++;
        }
      }
    }

    this.professorsMap.delete(source.id);
    this.statsMap.delete(source.id);
    this.subjectStatsMap.delete(source.id);

    await this.recalculateAttendedDeclaredForProfessor(target.id);
    await this.recalculateProfessorStats(target.id);

    return {
      targetProfessor: target,
      movedCommissions,
      movedElectives,
      movedEnrollments,
      movedDismissals,
      movedReviews,
      deduplicatedReviews,
    };
  }

  async listModerationQueue() {
    const openReportsRaw = this.reportsList
      .filter((rp) => rp.status === 'open')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const openCountByReview = new Map<string, number>();
    for (const rp of openReportsRaw) {
      openCountByReview.set(rp.reviewId, (openCountByReview.get(rp.reviewId) || 0) + 1);
    }

    const openReports: AdminModerationReportItem[] = [];
    for (const rp of openReportsRaw) {
      const rev = this.reviewsMap.get(rp.reviewId);
      if (!rev) continue;
      const prof = this.professorsMap.get(rev.professorId);
      const sub = this.subjectsMap.get(rev.subjectId);
      if (!prof || !sub) continue;

      openReports.push({
        reportId: rp.id,
        reviewId: rev.id,
        reason: rp.reason,
        note: rp.note,
        reportStatus: rp.status,
        reportedMonthYear: formatYearMonth(rp.createdAt),
        openReportsOnReview: openCountByReview.get(rev.id) || 1,
        review: {
          id: rev.id,
          professorId: prof.id,
          professorName: prof.displayName,
          subjectId: sub.id,
          subjectCode: sub.codeInPlan,
          subjectName: sub.name,
          overall: rev.overall,
          comment: rev.comment,
          status: rev.status,
          publishedMonthYear: formatYearMonth(rev.createdAt),
        },
      });
    }

    const hiddenReviews: AdminHiddenReviewItem[] = [];
    for (const rev of this.reviewsMap.values()) {
      if (rev.status !== 'hidden') continue;
      const prof = this.professorsMap.get(rev.professorId);
      const sub = this.subjectsMap.get(rev.subjectId);
      if (!prof || !sub) continue;

      hiddenReviews.push({
        id: rev.id,
        professorId: prof.id,
        professorName: prof.displayName,
        subjectId: sub.id,
        subjectCode: sub.codeInPlan,
        subjectName: sub.name,
        overall: rev.overall,
        comment: rev.comment,
        status: rev.status,
        openReportsCount: openCountByReview.get(rev.id) || 0,
        publishedMonthYear: formatYearMonth(rev.createdAt),
      });
    }

    return { openReports, hiddenReviews };
  }

  async setReviewStatus(reviewId: string, status: ReviewStatus): Promise<StoredReview | null> {
    const rev = this.reviewsMap.get(reviewId);
    if (!rev) return null;
    rev.status = status;
    rev.updatedAt = new Date();

    if (status === 'hidden' || status === 'removed') {
      for (const rp of this.reportsList) {
        if (rp.reviewId === reviewId && rp.status === 'open') rp.status = 'actioned';
      }
    } else if (status === 'published') {
      for (const rp of this.reportsList) {
        if (rp.reviewId === reviewId && rp.status === 'open') rp.status = 'dismissed';
      }
    }

    await this.recalculateProfessorStats(rev.professorId);
    return rev;
  }

  async resolveReport(
    reportId: string,
    status: 'dismissed' | 'actioned',
    reviewStatus?: ReviewStatus
  ): Promise<boolean> {
    const rp = this.reportsList.find((x) => x.id === reportId);
    if (!rp) return false;
    rp.status = status;
    if (reviewStatus) {
      await this.setReviewStatus(rp.reviewId, reviewStatus);
    }
    return true;
  }

  async getAdminStats(facultyId?: string) {
    const profs = Array.from(this.professorsMap.values()).filter(
      (p) => !facultyId || p.facultyId === facultyId
    );
    let professorsWithReviews = 0;
    for (const p of profs) {
      if ((this.statsMap.get(p.id)?.reviewCount || 0) > 0) professorsWithReviews++;
    }

    let publishedReviews = 0;
    let hiddenReviews = 0;
    let removedReviews = 0;
    for (const r of this.reviewsMap.values()) {
      if (r.status === 'published') publishedReviews++;
      if (r.status === 'hidden') hiddenReviews++;
      if (r.status === 'removed') removedReviews++;
    }

    const openReports = this.reportsList.filter((rp) => rp.status === 'open').length;
    const globalSummary = await this.getGlobalPublishedSummary(facultyId);

    return {
      totalProfessors: profs.length,
      professorsWithReviews,
      publishedReviews,
      hiddenReviews,
      removedReviews,
      openReports,
      globalMean: globalSummary.globalMean,
    };
  }

  async getAffectedProfessorIdsByUser(userId: string): Promise<string[]> {
    const set = new Set<string>();
    for (const r of this.reviewsMap.values()) {
      if (r.userId === userId) set.add(r.professorId);
    }
    return Array.from(set);
  }

  async recalculateProfessorStats(professorId: string): Promise<void> {
    const profReviews = Array.from(this.reviewsMap.values()).filter(
      (r) => r.professorId === professorId && r.status === 'published'
    );
    this.statsMap.set(professorId, computeAggregatesFromReviews(profReviews));

    const bySub = new Map<string, StoredReview[]>();
    for (const r of profReviews) {
      const list = bySub.get(r.subjectId) || [];
      list.push(r);
      bySub.set(r.subjectId, list);
    }

    const subMap = new Map<string, ComputedAggregate>();
    for (const [subId, list] of bySub.entries()) {
      subMap.set(subId, computeAggregatesFromReviews(list));
    }
    this.subjectStatsMap.set(professorId, subMap);
  }

  // ==========================================================================
  // CURSADAS (ENROLLMENTS), ATTENDED_DECLARED Y RECOMENDACIONES EN MEMORIA
  // ==========================================================================

  async hasUserDeclaredAttendance(
    userId: string,
    professorId: string,
    subjectUuid: string
  ): Promise<boolean> {
    for (const enr of this.enrollmentsMap.values()) {
      if (
        enr.userId === userId &&
        enr.subjectId === subjectUuid &&
        enr.professorIds.includes(professorId)
      ) {
        return true;
      }
    }
    return false;
  }

  async recalculateAttendedDeclaredForUserSubject(
    userId: string,
    subjectUuid: string
  ): Promise<void> {
    const declaredSet = new Set<string>();
    for (const enr of this.enrollmentsMap.values()) {
      if (enr.userId === userId && enr.subjectId === subjectUuid) {
        for (const pid of enr.professorIds) declaredSet.add(pid);
      }
    }
    for (const rev of this.reviewsMap.values()) {
      if (rev.userId === userId && rev.subjectId === subjectUuid) {
        rev.attendedDeclared = declaredSet.has(rev.professorId);
      }
    }
  }

  async recalculateAttendedDeclaredForProfessor(professorId: string): Promise<void> {
    const declaredPairs = new Set<string>();
    for (const enr of this.enrollmentsMap.values()) {
      if (enr.professorIds.includes(professorId)) {
        declaredPairs.add(`${enr.userId}::${enr.subjectId}`);
      }
    }
    for (const rev of this.reviewsMap.values()) {
      if (rev.professorId === professorId) {
        rev.attendedDeclared = declaredPairs.has(`${rev.userId}::${rev.subjectId}`);
      }
    }
  }

  async getSubjectEnrollmentOptions(
    planId: string,
    facultyId: string,
    subjectUuid: string
  ): Promise<{
    commissions: SubjectCommissionOption[];
    professors: SubjectProfessorOption[];
  }> {
    const commissionOptions: SubjectCommissionOption[] = Array.from(this.commissionsMap.values())
      .filter((c) => c.subjectId === subjectUuid)
      .map((c) => ({
        id: c.id,
        code: c.code,
        turno: c.turno,
        termOffer: c.termOffer,
        scheduleTermId: c.scheduleTermId,
        academicYear: c.academicYear,
        term: c.term,
        periodLabel: c.periodLabel,
        isCurrent: c.isCurrent,
        slots: [...c.slots].sort(
          (a, b) => a.day - b.day || a.startTime.localeCompare(b.startTime)
        ),
        professors: c.professorIds
          .map((pid) => {
            const p = this.professorsMap.get(pid);
            return p ? { professorId: p.id, displayName: p.displayName } : null;
          })
          .filter((x): x is { professorId: string; displayName: string } => Boolean(x))
          .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es')),
      }))
      .sort(
        (a, b) =>
          Number(b.isCurrent) - Number(a.isCurrent) ||
          b.academicYear - a.academicYear ||
          a.term.localeCompare(b.term) ||
          a.code.localeCompare(b.code, 'es')
      );

    const teachingPairs = await this.getTeachingPairsForPlan(planId, facultyId);
    const professorOptions: SubjectProfessorOption[] = teachingPairs
      .filter((tp) => tp.subjectId === subjectUuid && this.professorsMap.has(tp.professorId))
      .map((tp) => ({
        professorId: tp.professorId,
        displayName: this.professorsMap.get(tp.professorId)!.displayName,
        isCurrentTerm: tp.isCurrentTerm,
        isHistoricalLink: tp.isHistoricalLink,
        termLabels: tp.termLabels,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));

    return {
      commissions: commissionOptions,
      professors: professorOptions,
    };
  }

  async getCommissionForEnrollment(commissionId: string): Promise<CommissionEnrollmentMeta | null> {
    const c = this.commissionsMap.get(commissionId);
    if (!c) return null;
    return {
      id: c.id,
      subjectId: c.subjectId,
      code: c.code,
      turno: c.turno,
      termOffer: c.termOffer,
      academicYear: c.academicYear,
      scheduleTerm: c.term,
      isCurrent: c.isCurrent,
      professorIds: [...c.professorIds],
    };
  }

  async findSubjectCommissionByCode(params: {
    subjectUuid: string;
    code: string;
    academicYear?: number | null;
    term?: string | null;
  }): Promise<CommissionEnrollmentMeta | null> {
    const cleanCode = params.code.trim().toUpperCase();
    const matching = Array.from(this.commissionsMap.values()).filter(
      (c) => c.subjectId === params.subjectUuid && c.code.trim().toUpperCase() === cleanCode
    );
    if (matching.length === 0) return null;

    matching.sort((a, b) => {
      const aExact =
        (params.academicYear ? a.academicYear === params.academicYear : false) &&
        (params.term ? a.term === params.term || a.termOffer === params.term : true);
      const bExact =
        (params.academicYear ? b.academicYear === params.academicYear : false) &&
        (params.term ? b.term === params.term || b.termOffer === params.term : true);
      if (aExact !== bExact) return Number(bExact) - Number(aExact);
      if (a.isCurrent !== b.isCurrent) return Number(b.isCurrent) - Number(a.isCurrent);
      return b.academicYear - a.academicYear;
    });

    const chosen = matching[0];
    return {
      id: chosen.id,
      subjectId: chosen.subjectId,
      code: chosen.code,
      turno: chosen.turno,
      termOffer: chosen.termOffer,
      academicYear: chosen.academicYear,
      scheduleTerm: chosen.term,
      isCurrent: chosen.isCurrent,
      professorIds: [...chosen.professorIds],
    };
  }

  private hydrateInMemoryEnrollment(raw: {
    id: string;
    userId: string;
    subjectId: string;
    commissionId: string | null;
    academicYear: number | null;
    term: EnrollmentTerm | null;
    source: EnrollmentSource;
    professorIds: string[];
    createdAt: Date;
    updatedAt: Date;
  }): StoredEnrollment {
    const sub = this.subjectsMap.get(raw.subjectId);
    const comm = raw.commissionId ? this.commissionsMap.get(raw.commissionId) : undefined;
    const profs = raw.professorIds
      .map((pid) => {
        const p = this.professorsMap.get(pid);
        return p ? { professorId: p.id, displayName: p.displayName } : null;
      })
      .filter((x): x is { professorId: string; displayName: string } => Boolean(x))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));

    return {
      id: raw.id,
      userId: raw.userId,
      subjectId: raw.subjectId,
      subjectCode: sub?.codeInPlan || 0,
      subjectName: sub?.name || 'Materia',
      subjectShortName: sub?.shortName || 'Materia',
      subjectLevel: sub?.level || 1,
      commissionId: raw.commissionId,
      commissionCode: comm?.code ?? null,
      turno: comm?.turno ?? null,
      academicYear: raw.academicYear,
      term: raw.term,
      source: raw.source,
      professors: profs,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  async listUserEnrollments(userId: string, planId?: string | null): Promise<StoredEnrollment[]> {
    const list = Array.from(this.enrollmentsMap.values())
      .filter((e) => {
        if (e.userId !== userId) return false;
        if (planId) {
          const sub = this.subjectsMap.get(e.subjectId);
          if (sub && sub.planId !== planId) return false;
        }
        return true;
      })
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return list.map((e) => this.hydrateInMemoryEnrollment(e));
  }

  async getEnrollmentById(enrollmentId: string): Promise<StoredEnrollment | null> {
    const raw = this.enrollmentsMap.get(enrollmentId);
    return raw ? this.hydrateInMemoryEnrollment(raw) : null;
  }

  async saveUserEnrollment(params: {
    enrollmentId?: string | null;
    userId: string;
    subjectId: string;
    commissionId: string | null;
    academicYear: number | null;
    term: EnrollmentTerm | null;
    source: EnrollmentSource;
    professorIds: string[];
  }): Promise<StoredEnrollment> {
    const uniqueProfIds = Array.from(new Set(params.professorIds));
    const existingRows = Array.from(this.enrollmentsMap.values()).filter(
      (r) => r.userId === params.userId && r.subjectId === params.subjectId
    );
    const isEmptyPlaceholder = (r: (typeof existingRows)[number]) =>
      r.academicYear === null &&
      r.term === null &&
      r.commissionId === null &&
      r.professorIds.length === 0;

    const now = new Date();
    let targetId: string;

    if (params.enrollmentId) {
      const target = existingRows.find((r) => r.id === params.enrollmentId);
      if (!target) {
        const err = new Error('Cursada no encontrada');
        (err as any).status = 404;
        throw err;
      }
      if (params.academicYear !== null && params.term !== null) {
        const conflict = existingRows.find(
          (r) =>
            r.id !== params.enrollmentId &&
            r.academicYear === params.academicYear &&
            r.term === params.term
        );
        if (conflict) {
          const err = new Error(
            'Ya tenés otra cursada registrada para esta materia en ese mismo año y cuatrimestre.'
          );
          (err as any).status = 409;
          (err as any).code = 'DUPLICATE_ENROLLMENT_PERIOD';
          throw err;
        }
      }
      target.commissionId = params.commissionId;
      target.academicYear = params.academicYear;
      target.term = params.term;
      target.source = params.source;
      target.professorIds = uniqueProfIds;
      target.updatedAt = now;
      targetId = target.id;
    } else if (params.academicYear !== null && params.term !== null) {
      const samePeriod = existingRows.find(
        (r) => r.academicYear === params.academicYear && r.term === params.term
      );
      if (samePeriod) {
        const err = new Error(
          'Ya tenés otra cursada registrada para esta materia en ese mismo año y cuatrimestre.'
        );
        (err as any).status = 409;
        (err as any).code = 'DUPLICATE_ENROLLMENT_PERIOD';
        throw err;
      }
      const placeholder = existingRows.find(isEmptyPlaceholder);
      if (placeholder) {
        placeholder.commissionId = params.commissionId;
        placeholder.academicYear = params.academicYear;
        placeholder.term = params.term;
        placeholder.source = params.source;
        placeholder.professorIds = uniqueProfIds;
        placeholder.updatedAt = now;
        targetId = placeholder.id;
      } else {
        targetId = crypto.randomUUID();
        this.enrollmentsMap.set(targetId, {
          id: targetId,
          userId: params.userId,
          subjectId: params.subjectId,
          commissionId: params.commissionId,
          academicYear: params.academicYear,
          term: params.term,
          source: params.source,
          professorIds: uniqueProfIds,
          createdAt: now,
          updatedAt: now,
        });
      }
    } else if (params.commissionId === null && uniqueProfIds.length === 0) {
      const placeholder = existingRows.find(isEmptyPlaceholder);
      if (placeholder) {
        placeholder.updatedAt = now;
        targetId = placeholder.id;
      } else if (existingRows.length > 0) {
        targetId = existingRows[0].id;
      } else {
        targetId = crypto.randomUUID();
        this.enrollmentsMap.set(targetId, {
          id: targetId,
          userId: params.userId,
          subjectId: params.subjectId,
          commissionId: null,
          academicYear: null,
          term: null,
          source: params.source,
          professorIds: [],
          createdAt: now,
          updatedAt: now,
        });
      }
    } else {
      const placeholder = existingRows.find(isEmptyPlaceholder);
      if (placeholder) {
        placeholder.commissionId = params.commissionId;
        placeholder.academicYear = params.academicYear;
        placeholder.term = params.term;
        placeholder.source = params.source;
        placeholder.professorIds = uniqueProfIds;
        placeholder.updatedAt = now;
        targetId = placeholder.id;
      } else {
        targetId = crypto.randomUUID();
        this.enrollmentsMap.set(targetId, {
          id: targetId,
          userId: params.userId,
          subjectId: params.subjectId,
          commissionId: params.commissionId,
          academicYear: params.academicYear,
          term: params.term,
          source: params.source,
          professorIds: uniqueProfIds,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    await this.recalculateAttendedDeclaredForUserSubject(params.userId, params.subjectId);
    return this.hydrateInMemoryEnrollment(this.enrollmentsMap.get(targetId)!);
  }

  async deleteUserEnrollment(
    userId: string,
    enrollmentId: string
  ): Promise<{ deleted: boolean; subjectId?: string }> {
    const existing = this.enrollmentsMap.get(enrollmentId);
    if (!existing || existing.userId !== userId) {
      return { deleted: false };
    }
    this.enrollmentsMap.delete(enrollmentId);
    await this.recalculateAttendedDeclaredForUserSubject(userId, existing.subjectId);
    return { deleted: true, subjectId: existing.subjectId };
  }

  async listUserDismissedRecommendations(userId: string): Promise<Set<string>> {
    return new Set(this.dismissedRecommendations.get(userId) || []);
  }

  async dismissRecommendation(
    userId: string,
    professorId: string,
    subjectUuid: string
  ): Promise<void> {
    const set = this.dismissedRecommendations.get(userId) || new Set<string>();
    set.add(`${professorId}::${subjectUuid}`);
    this.dismissedRecommendations.set(userId, set);
  }

  async getUserSeenRecommendationKeys(userId: string): Promise<Set<string>> {
    return new Set(this.seenRecommendationKeys.get(userId) || []);
  }

  async markRecommendationsSeen(userId: string, keys: string[]): Promise<void> {
    const set = this.seenRecommendationKeys.get(userId) || new Set<string>();
    for (const k of keys) set.add(k);
    this.seenRecommendationKeys.set(userId, set);
  }
}

export const defaultReviewsStore: ReviewsStore = new DrizzleReviewsStore();
