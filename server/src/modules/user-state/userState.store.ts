import crypto from 'crypto';
import { and, asc, eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  careers,
  electiveAssignments,
  finalExamAttempts,
  scheduleProposals,
  scheduleSelections,
  scheduleTerms,
  studyPlans,
  subjectProgress,
  subjects,
  userBasket,
  users,
  userSettings,
} from '../../db/schema.js';
import { invalidateUserStatusCache } from '../../middlewares/auth.middleware.js';
import { findDefaultPublishedPlan, isValidUuid } from '../catalog/catalog.helpers.js';
import {
  SUBJECT_STATUS_RANK,
  getSubjectStatusRank,
} from '../enrollments/enrollmentStatus.helpers.js';
import { getActiveLibraryService, getLibraryService } from '../library/library.service.js';
import { defaultReviewsStore } from '../reviews/reviews.store.js';
import {
  DEFAULT_PLAN_SETTINGS,
  mergePlanScheduleSelections,
  mergePlanSettings,
  PlanSettingsValues,
  resolvePlanMaxLevel,
  StoredScheduleSelectionLike,
  StoredUserSettingsLike,
} from './userState.helpers.js';

export interface ActivePlanContext {
  userId: string;
  planId: string | null;
  planName: string | null;
  facultyId: string | null;
  totalLevels: number | null;
}

export interface PlanSubjectInfo {
  id: string;
  codeInPlan: number;
  kind: string;
  level: number;
}

export interface SubjectProgressEntry {
  id: string;
  userId: string;
  subjectId: string;
  status: string;
  grade: string | null;
  updatedAt: Date;
}

export interface ElectiveAssignmentEntry {
  id: string;
  userId: string;
  subjectId: string;
  year: number;
}

export interface BasketEntry {
  id: string;
  userId: string;
  subjectId: string;
}

export interface ScheduleTermEntry {
  id: string;
  facultyId: string;
  academicYear: number;
  term: string;
  isCurrent: boolean;
}

export interface ScheduleProposalEntry {
  id: string;
  userId: string;
  planId: string | null;
  scheduleTermId: string;
  name: string;
  selections: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExamAttemptEntry {
  id: string;
  subjectId: string;
  subjectCode: number;
  examDate: string;
  grade: string;
  notes: string | null;
  createdAt: Date;
}

export interface ImportPlanBundleInput {
  userId: string;
  planId: string;
  facultyId: string | null;
  planSubjectIds: string[];
  codeToUuid: Map<number, string>;
  maxLevel?: number;
  settingsIncoming?: Partial<PlanSettingsValues> & { extraSettings?: unknown };
  userState?: Record<string, unknown>;
  assignedElectives?: Record<string, unknown>;
  basket?: unknown[];
  scheduleSelections?: Record<string, unknown>;
  scheduleDrafts?: Array<{ name?: string; selections?: Record<string, unknown> }>;
}

export interface UserStateStore {
  resolveUserActivePlan(
    userId: string,
    fallbackPlanId?: string | null
  ): Promise<ActivePlanContext | null>;
  getPlanSubjects(planId: string): Promise<PlanSubjectInfo[]>;
  findPlanSubject(planId: string, subjectIdOrCode: string): Promise<PlanSubjectInfo | null>;
  getUserSettings(userId: string, planId?: string | null): Promise<StoredUserSettingsLike | null>;
  upsertUserSettings(
    userId: string,
    values: PlanSettingsValues & { planId: string | null; extraSettings: Record<string, any> }
  ): Promise<void>;
  listSubjectProgress(userId: string, planSubjectIds: string[]): Promise<SubjectProgressEntry[]>;
  upsertSubjectProgress(
    userId: string,
    subjectId: string,
    status: string,
    grade: string | null
  ): Promise<void>;
  listElectiveAssignments(
    userId: string,
    planSubjectIds: string[]
  ): Promise<ElectiveAssignmentEntry[]>;
  replacePlanElectiveAssignments(
    userId: string,
    scopedSubjectIds: string[],
    assignments: Array<{ subjectId: string; year: number }>
  ): Promise<void>;
  listUserBasket(userId: string, planSubjectIds: string[]): Promise<BasketEntry[]>;
  replacePlanBasket(
    userId: string,
    scopedSubjectIds: string[],
    subjectIds: string[]
  ): Promise<void>;
  getCurrentScheduleTerm(facultyId: string | null): Promise<ScheduleTermEntry | null>;
  getScheduleTermForFaculty(termId: string, facultyId: string | null): Promise<ScheduleTermEntry | null>;
  getScheduleSelection(
    userId: string,
    scheduleTermId: string,
    planId?: string | null
  ): Promise<StoredScheduleSelectionLike | null>;
  upsertScheduleSelection(
    userId: string,
    scheduleTermId: string,
    payload: {
      planId: string | null;
      selections: Record<string, string>;
      selectionsByPlan: Record<string, Record<string, string>>;
    }
  ): Promise<void>;
  listScheduleProposals(userId: string, planId: string | null): Promise<ScheduleProposalEntry[]>;
  saveScheduleProposal(params: {
    id?: string;
    userId: string;
    planId: string;
    scheduleTermId: string;
    name: string;
    selections: Record<string, unknown>;
  }): Promise<
    | { notFound: true }
    | { notFound: false; created: boolean; proposal: ScheduleProposalEntry }
  >;
  deleteScheduleProposal(userId: string, planId: string, proposalId: string): Promise<boolean>;
  listExamAttempts(userId: string, planId: string | null): Promise<ExamAttemptEntry[]>;
  createExamAttempt(params: {
    userId: string;
    subjectId: string;
    subjectCode: number;
    examDate: string;
    grade: string;
    notes: string | null;
  }): Promise<ExamAttemptEntry>;
  deleteExamAttempt(userId: string, planId: string, attemptId: string): Promise<boolean>;
  importPlanBundle(input: ImportPlanBundleInput): Promise<{
    progressCount: number;
    electivesCount: number;
    basketCount: number;
    proposalsCount: number;
  }>;
  deleteAccount(userId: string, deleteFiles: boolean): Promise<void>;
}

function normalizeStringSelections(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim() !== '') {
      out[k] = v;
    } else if (typeof v === 'number' && !Number.isNaN(v)) {
      out[k] = String(v);
    }
  }
  return out;
}

function parseTotalLevelsFromConfig(config: unknown): number | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const raw = (config as Record<string, unknown>).totalLevels;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  return null;
}

function pickUserSettingsRowForPlan(
  rows: Array<typeof userSettings.$inferSelect>,
  planId?: string | null
): StoredUserSettingsLike | null {
  if (rows.length === 0) return null;
  const notifyAll = rows.every((r) => r.notifyLibraryEmail !== false);
  const asObj = (v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};

  const matched =
    (planId ? rows.find((r) => r.planId === planId) : undefined) ||
    (planId
      ? rows.find((r) => {
          const perPlan = asObj(asObj(r.extraSettings).perPlan);
          return perPlan[planId] && typeof perPlan[planId] === 'object';
        })
      : undefined);

  if (matched) {
    return { ...matched, notifyLibraryEmail: notifyAll };
  }
  if (rows.length === 1) {
    return { ...rows[0], notifyLibraryEmail: notifyAll };
  }
  return {
    ...DEFAULT_PLAN_SETTINGS,
    planId: planId ?? null,
    notifyLibraryEmail: notifyAll,
    extraSettings: {},
  };
}

function pickScheduleSelectionRowForPlan(
  rows: Array<typeof scheduleSelections.$inferSelect>,
  planId?: string | null
): (typeof scheduleSelections.$inferSelect) | null {
  if (rows.length === 0) return null;
  const matched =
    (planId ? rows.find((r) => r.planId === planId) : undefined) ||
    (planId
      ? rows.find(
          (r) =>
            r.selectionsByPlan &&
            typeof r.selectionsByPlan === 'object' &&
            Object.prototype.hasOwnProperty.call(r.selectionsByPlan, planId)
        )
      : undefined);

  if (matched) return matched;
  if (rows.length === 1) return rows[0];
  return null;
}

export type DbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function upsertSubjectProgressWithDb(
  executor: DbExecutor,
  userId: string,
  subjectId: string,
  status: string,
  grade: string | null
): Promise<void> {
  if (status === 'pendiente' && grade === null) {
    await executor
      .delete(subjectProgress)
      .where(and(eq(subjectProgress.userId, userId), eq(subjectProgress.subjectId, subjectId)));
    return;
  }

  const [existing] = await executor
    .select({ id: subjectProgress.id })
    .from(subjectProgress)
    .where(and(eq(subjectProgress.userId, userId), eq(subjectProgress.subjectId, subjectId)))
    .limit(1);

  if (existing) {
    await executor
      .update(subjectProgress)
      .set({ status, grade, updatedAt: new Date() })
      .where(eq(subjectProgress.id, existing.id));
  } else {
    await executor.insert(subjectProgress).values({ userId, subjectId, status, grade });
  }
}

/**
 * Construye dinámicamente el `CASE` de rango SQL a partir de `SUBJECT_STATUS_RANK`
 * sin números hardcodeados a mano, para garantizar paridad exacta con el helper puro.
 */
export function buildSubjectStatusRankSqlCase(statusColumnOrExpr: SQL | AnyColumn): SQL {
  const nullRank = getSubjectStatusRank(null) ?? 0;
  const whenClauses: SQL[] = [
    sql`WHEN ${statusColumnOrExpr} IS NULL THEN CAST(${nullRank} AS integer)`,
    ...Object.entries(SUBJECT_STATUS_RANK).map(
      ([statusKey, rankValue]) =>
        sql`WHEN ${statusColumnOrExpr} = ${statusKey} THEN CAST(${rankValue} AS integer)`
    ),
  ];
  return sql`CASE ${sql.join(whenClauses, sql` `)} ELSE NULL END`;
}

/**
 * Genera la consulta atómica `INSERT ... ON CONFLICT (user_id, subject_id) DO UPDATE`
 * que solo promueve el estado si `rank(nuevo) > rank(existente)`, conserva `grade`
 * existente intacta y actualiza `updated_at` únicamente cuando cambia el estado.
 */
export function buildUpgradeSubjectProgressQuery(
  executor: DbExecutor,
  userId: string,
  subjectId: string,
  targetStatus: string,
  now: Date = new Date()
) {
  const existingRankSql = buildSubjectStatusRankSqlCase(subjectProgress.status);
  const excludedRankSql = buildSubjectStatusRankSqlCase(sql`excluded.status`);
  const shouldReplaceSql = sql`(${excludedRankSql}) > (${existingRankSql})`;

  return executor
    .insert(subjectProgress)
    .values({
      userId,
      subjectId,
      status: targetStatus,
      grade: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [subjectProgress.userId, subjectProgress.subjectId],
      set: {
        status: sql`CASE WHEN ${shouldReplaceSql} THEN excluded.status ELSE ${subjectProgress.status} END`,
        updatedAt: sql`CASE WHEN ${shouldReplaceSql} THEN excluded.updated_at ELSE ${subjectProgress.updatedAt} END`,
      },
    })
    .returning({
      status: subjectProgress.status,
    });
}

export async function upgradeSubjectProgressWithDb(
  executor: DbExecutor,
  userId: string,
  subjectId: string,
  targetStatus: string
): Promise<string> {
  const [row] = await buildUpgradeSubjectProgressQuery(
    executor,
    userId,
    subjectId,
    targetStatus
  );
  return row?.status ?? targetStatus;
}

export class DrizzleUserStateStore implements UserStateStore {
  async resolveUserActivePlan(
    userId: string,
    _fallbackPlanId?: string | null
  ): Promise<ActivePlanContext | null> {
    if (!isValidUuid(userId)) return null;

    const [user] = await db
      .select({ id: users.id, selectedPlanId: users.selectedPlanId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return null;

    let planId = user.selectedPlanId;
    let planName: string | null = null;
    let facultyId: string | null = null;
    let totalLevels: number | null = null;

    if (planId && isValidUuid(planId)) {
      const [row] = await db
        .select({
          planId: studyPlans.id,
          planName: studyPlans.name,
          planConfig: studyPlans.config,
          facultyId: careers.facultyId,
        })
        .from(studyPlans)
        .innerJoin(careers, eq(studyPlans.careerId, careers.id))
        .where(eq(studyPlans.id, planId))
        .limit(1);
      if (row) {
        planName = row.planName;
        facultyId = row.facultyId;
        totalLevels = parseTotalLevelsFromConfig(row.planConfig);
      } else {
        planId = null;
      }
    }

    if (!planId) {
      const defaultPublished = await findDefaultPublishedPlan();
      if (defaultPublished) {
        planId = defaultPublished.plan.id;
        planName = defaultPublished.plan.name;
        facultyId = defaultPublished.career.facultyId;
        totalLevels = parseTotalLevelsFromConfig(defaultPublished.plan.config);
        await db.update(users).set({ selectedPlanId: planId }).where(eq(users.id, userId));
        invalidateUserStatusCache(userId);
      }
    }

    return {
      userId,
      planId,
      planName,
      facultyId,
      totalLevels,
    };
  }

  async getPlanSubjects(planId: string): Promise<PlanSubjectInfo[]> {
    if (!isValidUuid(planId)) return [];
    return await db
      .select({
        id: subjects.id,
        codeInPlan: subjects.codeInPlan,
        kind: subjects.kind,
        level: subjects.level,
      })
      .from(subjects)
      .where(eq(subjects.planId, planId));
  }

  async findPlanSubject(planId: string, subjectIdOrCode: string): Promise<PlanSubjectInfo | null> {
    if (!isValidUuid(planId)) return null;
    const raw = String(subjectIdOrCode).trim();
    if (!raw) return null;

    if (/^\d+$/.test(raw)) {
      const [row] = await db
        .select({
          id: subjects.id,
          codeInPlan: subjects.codeInPlan,
          kind: subjects.kind,
          level: subjects.level,
        })
        .from(subjects)
        .where(and(eq(subjects.planId, planId), eq(subjects.codeInPlan, parseInt(raw, 10))))
        .limit(1);
      return row || null;
    }

    if (!isValidUuid(raw)) return null;
    const [row] = await db
      .select({
        id: subjects.id,
        codeInPlan: subjects.codeInPlan,
        kind: subjects.kind,
        level: subjects.level,
      })
      .from(subjects)
      .where(and(eq(subjects.planId, planId), eq(subjects.id, raw)))
      .limit(1);
    return row || null;
  }

  async getUserSettings(
    userId: string,
    planId?: string | null
  ): Promise<StoredUserSettingsLike | null> {
    const rows = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
    return pickUserSettingsRowForPlan(rows, planId);
  }

  private async upsertUserSettingsWithDb(
    executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
    userId: string,
    values: PlanSettingsValues & { planId: string | null; extraSettings: Record<string, any> }
  ): Promise<void> {
    const rows = await executor.select().from(userSettings).where(eq(userSettings.userId, userId));
    let effectivePlanId =
      values.planId && isValidUuid(values.planId)
        ? values.planId
        : rows.find((r) => r.planId && isValidUuid(r.planId))?.planId || null;

    if (!effectivePlanId) {
      effectivePlanId = (await this.resolveUserActivePlan(userId))?.planId || null;
    }

    if (!effectivePlanId) {
      // Sin ningún plan existente en BD: actualizar fila previa si existe sin escribir NULL en plan_id
      if (rows.length > 0) {
        const updateNoPlan = {
          includePromotionsInGPA: values.includePromotionsInGPA,
          minPassingGrade: values.minPassingGrade,
          includeAnalistaTrack: values.includeAnalistaTrack,
          allowBlockedElectivesPlanning: values.allowBlockedElectivesPlanning,
          includeElectivesInProgress: values.includeElectivesInProgress,
          soundEnabled: values.soundEnabled,
          tutorialCompleted: values.tutorialCompleted,
          notifyLibraryEmail: values.notifyLibraryEmail,
          extraSettings: values.extraSettings,
          updatedAt: new Date(),
        };
        await executor
          .update(userSettings)
          .set(updateNoPlan)
          .where(eq(userSettings.userId, userId));
      }
      return;
    }

    const basePayload = {
      planId: effectivePlanId,
      includePromotionsInGPA: values.includePromotionsInGPA,
      minPassingGrade: values.minPassingGrade,
      includeAnalistaTrack: values.includeAnalistaTrack,
      allowBlockedElectivesPlanning: values.allowBlockedElectivesPlanning,
      includeElectivesInProgress: values.includeElectivesInProgress,
      soundEnabled: values.soundEnabled,
      tutorialCompleted: values.tutorialCompleted,
      notifyLibraryEmail: values.notifyLibraryEmail,
      extraSettings: values.extraSettings,
      updatedAt: new Date(),
    };

    if (rows.length === 0) {
      await executor.insert(userSettings).values({ userId, ...basePayload });
      return;
    }

    if (rows.length === 1) {
      // Mantiene compatibilidad estricta con esquema 0014 (PK user_id) y con 0015 (1 fila -> actualiza in-place con planId)
      await executor.update(userSettings).set(basePayload).where(eq(userSettings.userId, userId));
      return;
    }

    // Múltiples filas por usuario solo existen bajo esquema 0015 (PK compuesta): actualizar fila objetivo y sincronizar preferencia global
    const hasTargetRow = rows.some((r) => r.planId === effectivePlanId);
    if (hasTargetRow) {
      await executor
        .update(userSettings)
        .set(basePayload)
        .where(and(eq(userSettings.userId, userId), eq(userSettings.planId, effectivePlanId)));
    } else {
      await executor.insert(userSettings).values({ userId, ...basePayload });
    }

    await executor
      .update(userSettings)
      .set({ notifyLibraryEmail: values.notifyLibraryEmail, updatedAt: new Date() })
      .where(eq(userSettings.userId, userId));
  }

  async upsertUserSettings(
    userId: string,
    values: PlanSettingsValues & { planId: string | null; extraSettings: Record<string, any> }
  ): Promise<void> {
    await this.upsertUserSettingsWithDb(db, userId, values);
  }

  async listSubjectProgress(
    userId: string,
    planSubjectIds: string[]
  ): Promise<SubjectProgressEntry[]> {
    if (planSubjectIds.length === 0) return [];
    return await db
      .select()
      .from(subjectProgress)
      .where(and(eq(subjectProgress.userId, userId), inArray(subjectProgress.subjectId, planSubjectIds)));
  }

  async upsertSubjectProgress(
    userId: string,
    subjectId: string,
    status: string,
    grade: string | null
  ): Promise<void> {
    await upsertSubjectProgressWithDb(db, userId, subjectId, status, grade);
  }

  async listElectiveAssignments(
    userId: string,
    planSubjectIds: string[]
  ): Promise<ElectiveAssignmentEntry[]> {
    if (planSubjectIds.length === 0) return [];
    return await db
      .select({
        id: electiveAssignments.id,
        userId: electiveAssignments.userId,
        subjectId: electiveAssignments.subjectId,
        year: electiveAssignments.year,
      })
      .from(electiveAssignments)
      .where(
        and(
          eq(electiveAssignments.userId, userId),
          inArray(electiveAssignments.subjectId, planSubjectIds)
        )
      );
  }

  async replacePlanElectiveAssignments(
    userId: string,
    scopedSubjectIds: string[],
    assignments: Array<{ subjectId: string; year: number }>
  ): Promise<void> {
    await db.transaction(async (tx) => {
      if (scopedSubjectIds.length > 0) {
        await tx
          .delete(electiveAssignments)
          .where(
            and(
              eq(electiveAssignments.userId, userId),
              inArray(electiveAssignments.subjectId, scopedSubjectIds)
            )
          );
      }

      for (const item of assignments) {
        await tx.insert(electiveAssignments).values({
          userId,
          subjectId: item.subjectId,
          year: item.year,
        });
      }
    });
  }

  async listUserBasket(userId: string, planSubjectIds: string[]): Promise<BasketEntry[]> {
    if (planSubjectIds.length === 0) return [];
    return await db
      .select({
        id: userBasket.id,
        userId: userBasket.userId,
        subjectId: userBasket.subjectId,
      })
      .from(userBasket)
      .where(and(eq(userBasket.userId, userId), inArray(userBasket.subjectId, planSubjectIds)));
  }

  async replacePlanBasket(
    userId: string,
    scopedSubjectIds: string[],
    subjectIds: string[]
  ): Promise<void> {
    await db.transaction(async (tx) => {
      if (scopedSubjectIds.length > 0) {
        await tx
          .delete(userBasket)
          .where(and(eq(userBasket.userId, userId), inArray(userBasket.subjectId, scopedSubjectIds)));
      }

      for (const subjectId of subjectIds) {
        await tx.insert(userBasket).values({ userId, subjectId });
      }
    });
  }

  async getCurrentScheduleTerm(facultyId: string | null): Promise<ScheduleTermEntry | null> {
    if (!facultyId || !isValidUuid(facultyId)) return null;
    const [term] = await db
      .select()
      .from(scheduleTerms)
      .where(and(eq(scheduleTerms.isCurrent, true), eq(scheduleTerms.facultyId, facultyId)))
      .limit(1);
    return term || null;
  }

  async getScheduleTermForFaculty(
    termId: string,
    facultyId: string | null
  ): Promise<ScheduleTermEntry | null> {
    if (!facultyId || !isValidUuid(termId) || !isValidUuid(facultyId)) return null;
    const [term] = await db
      .select()
      .from(scheduleTerms)
      .where(and(eq(scheduleTerms.id, termId), eq(scheduleTerms.facultyId, facultyId)))
      .limit(1);
    return term || null;
  }

  async getScheduleSelection(
    userId: string,
    scheduleTermId: string,
    planId?: string | null
  ): Promise<StoredScheduleSelectionLike | null> {
    const rows = await db
      .select()
      .from(scheduleSelections)
      .where(
        and(
          eq(scheduleSelections.userId, userId),
          eq(scheduleSelections.scheduleTermId, scheduleTermId)
        )
      );
    return pickScheduleSelectionRowForPlan(rows, planId);
  }

  private async upsertScheduleSelectionWithDb(
    executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
    userId: string,
    scheduleTermId: string,
    payload: {
      planId: string | null;
      selections: Record<string, string>;
      selectionsByPlan: Record<string, Record<string, string>>;
    }
  ): Promise<void> {
    const rows = await executor
      .select()
      .from(scheduleSelections)
      .where(
        and(
          eq(scheduleSelections.userId, userId),
          eq(scheduleSelections.scheduleTermId, scheduleTermId)
        )
      );

    let effectivePlanId =
      payload.planId && isValidUuid(payload.planId)
        ? payload.planId
        : rows.find((r) => r.planId && isValidUuid(r.planId))?.planId || null;

    if (!effectivePlanId) {
      effectivePlanId = (await this.resolveUserActivePlan(userId))?.planId || null;
    }

    if (!effectivePlanId) {
      if (rows.length > 0) {
        await executor
          .update(scheduleSelections)
          .set({
            selections: payload.selections,
            selectionsByPlan: payload.selectionsByPlan,
            updatedAt: new Date(),
          })
          .where(eq(scheduleSelections.id, rows[0].id));
      }
      return;
    }

    if (rows.length === 0) {
      await executor.insert(scheduleSelections).values({
        userId,
        planId: effectivePlanId,
        scheduleTermId,
        selections: payload.selections,
        selectionsByPlan: payload.selectionsByPlan,
      });
      return;
    }

    if (rows.length === 1) {
      await executor
        .update(scheduleSelections)
        .set({
          planId: effectivePlanId,
          selections: payload.selections,
          selectionsByPlan: payload.selectionsByPlan,
          updatedAt: new Date(),
        })
        .where(eq(scheduleSelections.id, rows[0].id));
      return;
    }

    const match = rows.find((r) => r.planId === effectivePlanId);
    if (match) {
      await executor
        .update(scheduleSelections)
        .set({
          selections: payload.selections,
          selectionsByPlan: payload.selectionsByPlan,
          updatedAt: new Date(),
        })
        .where(eq(scheduleSelections.id, match.id));
    } else {
      await executor.insert(scheduleSelections).values({
        userId,
        planId: effectivePlanId,
        scheduleTermId,
        selections: payload.selections,
        selectionsByPlan: payload.selectionsByPlan,
      });
    }
  }

  async upsertScheduleSelection(
    userId: string,
    scheduleTermId: string,
    payload: {
      planId: string | null;
      selections: Record<string, string>;
      selectionsByPlan: Record<string, Record<string, string>>;
    }
  ): Promise<void> {
    await this.upsertScheduleSelectionWithDb(db, userId, scheduleTermId, payload);
  }

  async listScheduleProposals(
    userId: string,
    planId: string | null
  ): Promise<ScheduleProposalEntry[]> {
    if (!planId || !isValidUuid(planId)) return [];
    return await db
      .select()
      .from(scheduleProposals)
      .where(and(eq(scheduleProposals.userId, userId), eq(scheduleProposals.planId, planId)));
  }

  async saveScheduleProposal(params: {
    id?: string;
    userId: string;
    planId: string;
    scheduleTermId: string;
    name: string;
    selections: Record<string, unknown>;
  }): Promise<
    | { notFound: true }
    | { notFound: false; created: boolean; proposal: ScheduleProposalEntry }
  > {
    const normalizedSelections = normalizeStringSelections(params.selections);

    if (params.id) {
      if (!isValidUuid(params.id)) return { notFound: true };
      const [existing] = await db
        .select()
        .from(scheduleProposals)
        .where(
          and(
            eq(scheduleProposals.id, params.id),
            eq(scheduleProposals.userId, params.userId),
            eq(scheduleProposals.planId, params.planId)
          )
        )
        .limit(1);

      if (!existing) {
        return { notFound: true };
      }

      const [updated] = await db
        .update(scheduleProposals)
        .set({
          name: params.name.trim(),
          selections: normalizedSelections,
          updatedAt: new Date(),
        })
        .where(eq(scheduleProposals.id, existing.id))
        .returning();

      return { notFound: false, created: false, proposal: updated };
    }

    const [created] = await db
      .insert(scheduleProposals)
      .values({
        userId: params.userId,
        planId: params.planId,
        scheduleTermId: params.scheduleTermId,
        name: params.name.trim(),
        selections: normalizedSelections,
      })
      .returning();

    return { notFound: false, created: true, proposal: created };
  }

  async deleteScheduleProposal(
    userId: string,
    planId: string,
    proposalId: string
  ): Promise<boolean> {
    if (!isValidUuid(planId) || !isValidUuid(proposalId)) return false;
    const deleted = await db
      .delete(scheduleProposals)
      .where(
        and(
          eq(scheduleProposals.id, proposalId),
          eq(scheduleProposals.userId, userId),
          eq(scheduleProposals.planId, planId)
        )
      )
      .returning({ id: scheduleProposals.id });
    return deleted.length > 0;
  }

  async listExamAttempts(userId: string, planId: string | null): Promise<ExamAttemptEntry[]> {
    if (!planId || !isValidUuid(planId)) return [];
    const rows = await db
      .select({
        id: finalExamAttempts.id,
        subjectId: finalExamAttempts.subjectId,
        subjectCode: subjects.codeInPlan,
        examDate: finalExamAttempts.examDate,
        grade: finalExamAttempts.grade,
        notes: finalExamAttempts.notes,
        createdAt: finalExamAttempts.createdAt,
      })
      .from(finalExamAttempts)
      .innerJoin(subjects, eq(finalExamAttempts.subjectId, subjects.id))
      .where(and(eq(finalExamAttempts.userId, userId), eq(subjects.planId, planId)))
      .orderBy(asc(finalExamAttempts.examDate));

    return rows.map((r) => ({
      ...r,
      examDate: String(r.examDate),
    }));
  }

  async createExamAttempt(params: {
    userId: string;
    subjectId: string;
    subjectCode: number;
    examDate: string;
    grade: string;
    notes: string | null;
  }): Promise<ExamAttemptEntry> {
    const [inserted] = await db
      .insert(finalExamAttempts)
      .values({
        userId: params.userId,
        subjectId: params.subjectId,
        examDate: params.examDate,
        grade: params.grade,
        notes: params.notes,
      })
      .returning();

    return {
      id: inserted.id,
      subjectId: inserted.subjectId,
      subjectCode: params.subjectCode,
      examDate: String(inserted.examDate),
      grade: String(inserted.grade),
      notes: inserted.notes,
      createdAt: inserted.createdAt,
    };
  }

  async deleteExamAttempt(userId: string, planId: string, attemptId: string): Promise<boolean> {
    if (!isValidUuid(planId) || !isValidUuid(attemptId)) return false;

    const [ownedInPlan] = await db
      .select({ id: finalExamAttempts.id })
      .from(finalExamAttempts)
      .innerJoin(subjects, eq(finalExamAttempts.subjectId, subjects.id))
      .where(
        and(
          eq(finalExamAttempts.id, attemptId),
          eq(finalExamAttempts.userId, userId),
          eq(subjects.planId, planId)
        )
      )
      .limit(1);

    if (!ownedInPlan) return false;

    const [deleted] = await db
      .delete(finalExamAttempts)
      .where(and(eq(finalExamAttempts.id, attemptId), eq(finalExamAttempts.userId, userId)))
      .returning({ id: finalExamAttempts.id });

    return Boolean(deleted);
  }

  async importPlanBundle(input: ImportPlanBundleInput): Promise<{
    progressCount: number;
    electivesCount: number;
    basketCount: number;
    proposalsCount: number;
  }> {
    const currentTerm = await this.getCurrentScheduleTerm(input.facultyId);

    return await db.transaction(async (tx) => {
      let progressCount = 0;
      let electivesCount = 0;
      let basketCount = 0;
      let proposalsCount = 0;

      if (input.settingsIncoming) {
        const existingRows = await tx
          .select()
          .from(userSettings)
          .where(eq(userSettings.userId, input.userId));

        const existingSet = pickUserSettingsRowForPlan(existingRows, input.planId);
        const merged = mergePlanSettings(existingSet, input.planId, input.settingsIncoming);
        await this.upsertUserSettingsWithDb(tx, input.userId, merged);
      }

      const userState = input.userState || {};
      for (const [codeStr, entry] of Object.entries(userState)) {
        const codeNum = parseInt(codeStr, 10);
        const subUuid = input.codeToUuid.get(codeNum);
        if (!subUuid || !entry || typeof entry !== 'object') continue;

        const rawStatus = (entry as any).status;
        const normalizedStatus =
          rawStatus === 'disponible' || rawStatus === 'bloqueada' ? 'pendiente' : rawStatus;
        const gradeVal =
          (entry as any).grade !== undefined && (entry as any).grade !== null
            ? String((entry as any).grade)
            : null;

        if (normalizedStatus === 'pendiente' && gradeVal === null) continue;

        const [existing] = await tx
          .select({ id: subjectProgress.id })
          .from(subjectProgress)
          .where(
            and(eq(subjectProgress.userId, input.userId), eq(subjectProgress.subjectId, subUuid))
          )
          .limit(1);

        if (existing) {
          await tx
            .update(subjectProgress)
            .set({ status: normalizedStatus, grade: gradeVal, updatedAt: new Date() })
            .where(eq(subjectProgress.id, existing.id));
        } else {
          await tx.insert(subjectProgress).values({
            userId: input.userId,
            subjectId: subUuid,
            status: normalizedStatus,
            grade: gradeVal,
          });
        }
        progressCount++;
      }

      if (input.assignedElectives && typeof input.assignedElectives === 'object') {
        if (input.planSubjectIds.length > 0) {
          await tx
            .delete(electiveAssignments)
            .where(
              and(
                eq(electiveAssignments.userId, input.userId),
                inArray(electiveAssignments.subjectId, input.planSubjectIds)
              )
            );
        }
        const seen = new Set<string>();

        const maxLevel = resolvePlanMaxLevel(input.maxLevel);
        for (let year = 1; year <= maxLevel; year++) {
          const list = Array.isArray((input.assignedElectives as any)[year])
            ? (input.assignedElectives as any)[year]
            : [];
          for (const item of list) {
            const subUuid = input.codeToUuid.get(Number(item));
            if (subUuid && !seen.has(subUuid)) {
              seen.add(subUuid);
              await tx.insert(electiveAssignments).values({
                userId: input.userId,
                subjectId: subUuid,
                year,
              });
              electivesCount++;
            }
          }
        }
      }

      if (Array.isArray(input.basket)) {
        if (input.planSubjectIds.length > 0) {
          await tx
            .delete(userBasket)
            .where(
              and(
                eq(userBasket.userId, input.userId),
                inArray(userBasket.subjectId, input.planSubjectIds)
              )
            );
        }
        const seen = new Set<string>();
        for (const item of input.basket) {
          const subUuid = input.codeToUuid.get(Number(item));
          if (subUuid && !seen.has(subUuid)) {
            seen.add(subUuid);
            await tx.insert(userBasket).values({
              userId: input.userId,
              subjectId: subUuid,
            });
            basketCount++;
          }
        }
      }

      if (currentTerm && input.scheduleSelections && typeof input.scheduleSelections === 'object') {
        const existingSelRows = await tx
          .select()
          .from(scheduleSelections)
          .where(
            and(
              eq(scheduleSelections.userId, input.userId),
              eq(scheduleSelections.scheduleTermId, currentTerm.id)
            )
          );

        const existingSel = pickScheduleSelectionRowForPlan(existingSelRows, input.planId);
        const mergedSel = mergePlanScheduleSelections(
          existingSel,
          input.planId,
          input.scheduleSelections
        );

        await this.upsertScheduleSelectionWithDb(tx, input.userId, currentTerm.id, mergedSel);
      }

      if (currentTerm && Array.isArray(input.scheduleDrafts)) {
        for (const d of input.scheduleDrafts) {
          if (d?.name && d?.selections) {
            await tx.insert(scheduleProposals).values({
              userId: input.userId,
              planId: input.planId,
              scheduleTermId: currentTerm.id,
              name: d.name,
              selections: normalizeStringSelections(d.selections),
            });
            proposalsCount++;
          }
        }
      }

      return { progressCount, electivesCount, basketCount, proposalsCount };
    });
  }

  async deleteAccount(userId: string, deleteFiles: boolean): Promise<void> {
    const libraryService = getLibraryService();
    await libraryService.handleAccountDeletion(userId, deleteFiles);

    const affectedProfessorIds = await defaultReviewsStore.getAffectedProfessorIdsByUser(userId);
    await db.delete(users).where(eq(users.id, userId));

    for (const profId of affectedProfessorIds) {
      await defaultReviewsStore.recalculateProfessorStats(profId).catch(() => undefined);
    }
  }
}

export interface InMemoryUserStatePlan {
  id: string;
  name: string;
  facultyId: string;
  totalLevels?: number;
  status?: 'draft' | 'published' | 'archived';
  isActive?: boolean;
  careerStatus?: 'draft' | 'published' | 'archived';
  careerCode?: string;
  year?: number;
}

export class InMemoryUserStateStore implements UserStateStore {
  public usersPlan = new Map<string, string | null>();
  public plans = new Map<string, InMemoryUserStatePlan>();
  public subjects = new Map<string, PlanSubjectInfo & { planId: string }>();
  public settings = new Map<string, StoredUserSettingsLike & { updatedAt: Date }>();
  public progress = new Map<string, SubjectProgressEntry>(); // `${userId}::${subjectId}`
  public electives = new Map<string, ElectiveAssignmentEntry>(); // `${userId}::${subjectId}`
  public basket = new Map<string, BasketEntry>(); // `${userId}::${subjectId}`
  public terms = new Map<string, ScheduleTermEntry>();
  public selections = new Map<string, StoredScheduleSelectionLike & { updatedAt: Date }>(); // `${userId}::${termId}`
  public proposals = new Map<string, ScheduleProposalEntry>();
  public examAttempts = new Map<string, ExamAttemptEntry & { userId: string }>();
  public deletedUsers = new Set<string>();

  seedPlan(plan: InMemoryUserStatePlan) {
    this.plans.set(plan.id, plan);
  }

  seedUser(userId: string, selectedPlanId: string | null) {
    this.usersPlan.set(userId, selectedPlanId);
  }

  seedSubject(input: { id?: string; planId: string; codeInPlan: number; kind?: string; level?: number }) {
    const id = input.id || crypto.randomUUID();
    const sub = {
      id,
      planId: input.planId,
      codeInPlan: input.codeInPlan,
      kind: input.kind || 'obligatoria',
      level: input.level ?? 1,
    };
    this.subjects.set(id, sub);
    return sub;
  }

  seedTerm(input: { id?: string; facultyId: string; academicYear: number; term: string; isCurrent: boolean }) {
    const id = input.id || crypto.randomUUID();
    const t: ScheduleTermEntry = {
      id,
      facultyId: input.facultyId,
      academicYear: input.academicYear,
      term: input.term,
      isCurrent: input.isCurrent,
    };
    this.terms.set(id, t);
    return t;
  }

  private findDefaultPublishedPlan(): InMemoryUserStatePlan | undefined {
    const candidates = Array.from(this.plans.values()).filter(
      (p) =>
        (p.status ?? 'published') === 'published' &&
        (p.isActive ?? true) === true &&
        (p.careerStatus ?? 'published') === 'published'
    );
    if (candidates.length === 0) return undefined;
    return candidates.find((p) => p.careerCode === 'ISI' && p.year === 2023) || candidates[0];
  }

  async resolveUserActivePlan(
    userId: string,
    fallbackPlanId?: string | null
  ): Promise<ActivePlanContext | null> {
    if (!this.usersPlan.has(userId) && !fallbackPlanId) return null;
    let planId = this.usersPlan.get(userId) ?? fallbackPlanId ?? null;
    let plan = planId ? this.plans.get(planId) : undefined;

    if (planId && !plan) {
      planId = null;
    }

    if (!planId) {
      const defaultPublished = this.findDefaultPublishedPlan();
      if (defaultPublished) {
        plan = defaultPublished;
        planId = defaultPublished.id;
        if (this.usersPlan.has(userId)) {
          this.usersPlan.set(userId, planId);
        }
      }
    }

    return {
      userId,
      planId: plan ? plan.id : planId,
      planName: plan ? plan.name : null,
      facultyId: plan ? plan.facultyId : null,
      totalLevels: plan?.totalLevels ?? null,
    };
  }

  async getPlanSubjects(planId: string): Promise<PlanSubjectInfo[]> {
    return Array.from(this.subjects.values()).filter((s) => s.planId === planId);
  }

  async findPlanSubject(planId: string, subjectIdOrCode: string): Promise<PlanSubjectInfo | null> {
    const raw = String(subjectIdOrCode).trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) {
      const code = parseInt(raw, 10);
      for (const s of this.subjects.values()) {
        if (s.planId === planId && s.codeInPlan === code) return s;
      }
      return null;
    }
    const sub = this.subjects.get(raw);
    return sub && sub.planId === planId ? sub : null;
  }

  async getUserSettings(
    userId: string,
    _planId?: string | null
  ): Promise<StoredUserSettingsLike | null> {
    return this.settings.get(userId) || null;
  }

  async upsertUserSettings(
    userId: string,
    values: PlanSettingsValues & { planId: string | null; extraSettings: Record<string, any> }
  ): Promise<void> {
    this.settings.set(userId, { ...values, updatedAt: new Date() });
  }

  async listSubjectProgress(
    userId: string,
    planSubjectIds: string[]
  ): Promise<SubjectProgressEntry[]> {
    const idSet = new Set(planSubjectIds);
    return Array.from(this.progress.values()).filter(
      (p) => p.userId === userId && idSet.has(p.subjectId)
    );
  }

  async upsertSubjectProgress(
    userId: string,
    subjectId: string,
    status: string,
    grade: string | null
  ): Promise<void> {
    const key = `${userId}::${subjectId}`;
    if (status === 'pendiente' && grade === null) {
      this.progress.delete(key);
      return;
    }
    const existing = this.progress.get(key);
    this.progress.set(key, {
      id: existing?.id || crypto.randomUUID(),
      userId,
      subjectId,
      status,
      grade,
      updatedAt: new Date(),
    });
  }

  async listElectiveAssignments(
    userId: string,
    planSubjectIds: string[]
  ): Promise<ElectiveAssignmentEntry[]> {
    const idSet = new Set(planSubjectIds);
    return Array.from(this.electives.values()).filter(
      (e) => e.userId === userId && idSet.has(e.subjectId)
    );
  }

  async replacePlanElectiveAssignments(
    userId: string,
    scopedSubjectIds: string[],
    assignments: Array<{ subjectId: string; year: number }>
  ): Promise<void> {
    const scopedSet = new Set(scopedSubjectIds);
    for (const [k, v] of this.electives.entries()) {
      if (v.userId === userId && scopedSet.has(v.subjectId)) {
        this.electives.delete(k);
      }
    }
    for (const item of assignments) {
      this.electives.set(`${userId}::${item.subjectId}`, {
        id: crypto.randomUUID(),
        userId,
        subjectId: item.subjectId,
        year: item.year,
      });
    }
  }

  async listUserBasket(userId: string, planSubjectIds: string[]): Promise<BasketEntry[]> {
    const idSet = new Set(planSubjectIds);
    return Array.from(this.basket.values()).filter(
      (b) => b.userId === userId && idSet.has(b.subjectId)
    );
  }

  async replacePlanBasket(
    userId: string,
    scopedSubjectIds: string[],
    subjectIds: string[]
  ): Promise<void> {
    const scopedSet = new Set(scopedSubjectIds);
    for (const [k, v] of this.basket.entries()) {
      if (v.userId === userId && scopedSet.has(v.subjectId)) {
        this.basket.delete(k);
      }
    }
    for (const subjectId of subjectIds) {
      this.basket.set(`${userId}::${subjectId}`, {
        id: crypto.randomUUID(),
        userId,
        subjectId,
      });
    }
  }

  async getCurrentScheduleTerm(facultyId: string | null): Promise<ScheduleTermEntry | null> {
    if (!facultyId) return null;
    for (const t of this.terms.values()) {
      if (t.facultyId === facultyId && t.isCurrent) return t;
    }
    return null;
  }

  async getScheduleTermForFaculty(
    termId: string,
    facultyId: string | null
  ): Promise<ScheduleTermEntry | null> {
    if (!facultyId) return null;
    const t = this.terms.get(termId);
    return t && t.facultyId === facultyId ? t : null;
  }

  async getScheduleSelection(
    userId: string,
    scheduleTermId: string,
    _planId?: string | null
  ): Promise<StoredScheduleSelectionLike | null> {
    return this.selections.get(`${userId}::${scheduleTermId}`) || null;
  }

  async upsertScheduleSelection(
    userId: string,
    scheduleTermId: string,
    payload: {
      planId: string | null;
      selections: Record<string, string>;
      selectionsByPlan: Record<string, Record<string, string>>;
    }
  ): Promise<void> {
    this.selections.set(`${userId}::${scheduleTermId}`, {
      planId: payload.planId,
      selections: payload.selections,
      selectionsByPlan: payload.selectionsByPlan,
      updatedAt: new Date(),
    });
  }

  async listScheduleProposals(
    userId: string,
    planId: string | null
  ): Promise<ScheduleProposalEntry[]> {
    if (!planId) return [];
    return Array.from(this.proposals.values()).filter(
      (p) => p.userId === userId && p.planId === planId
    );
  }

  async saveScheduleProposal(params: {
    id?: string;
    userId: string;
    planId: string;
    scheduleTermId: string;
    name: string;
    selections: Record<string, unknown>;
  }): Promise<
    | { notFound: true }
    | { notFound: false; created: boolean; proposal: ScheduleProposalEntry }
  > {
    const normalizedSelections = normalizeStringSelections(params.selections);
    if (params.id) {
      const existing = this.proposals.get(params.id);
      if (!existing || existing.userId !== params.userId || existing.planId !== params.planId) {
        return { notFound: true };
      }
      const updated: ScheduleProposalEntry = {
        ...existing,
        name: params.name.trim(),
        selections: normalizedSelections,
        updatedAt: new Date(),
      };
      this.proposals.set(existing.id, updated);
      return { notFound: false, created: false, proposal: updated };
    }

    const now = new Date();
    const created: ScheduleProposalEntry = {
      id: crypto.randomUUID(),
      userId: params.userId,
      planId: params.planId,
      scheduleTermId: params.scheduleTermId,
      name: params.name.trim(),
      selections: normalizedSelections,
      createdAt: now,
      updatedAt: now,
    };
    this.proposals.set(created.id, created);
    return { notFound: false, created: true, proposal: created };
  }

  async deleteScheduleProposal(
    userId: string,
    planId: string,
    proposalId: string
  ): Promise<boolean> {
    const existing = this.proposals.get(proposalId);
    if (!existing || existing.userId !== userId || existing.planId !== planId) {
      return false;
    }
    this.proposals.delete(proposalId);
    return true;
  }

  async listExamAttempts(userId: string, planId: string | null): Promise<ExamAttemptEntry[]> {
    if (!planId) return [];
    return Array.from(this.examAttempts.values())
      .filter((a) => {
        if (a.userId !== userId) return false;
        const sub = this.subjects.get(a.subjectId);
        return Boolean(sub && sub.planId === planId);
      })
      .sort((a, b) => a.examDate.localeCompare(b.examDate));
  }

  async createExamAttempt(params: {
    userId: string;
    subjectId: string;
    subjectCode: number;
    examDate: string;
    grade: string;
    notes: string | null;
  }): Promise<ExamAttemptEntry> {
    const created: ExamAttemptEntry & { userId: string } = {
      id: crypto.randomUUID(),
      userId: params.userId,
      subjectId: params.subjectId,
      subjectCode: params.subjectCode,
      examDate: params.examDate,
      grade: params.grade,
      notes: params.notes,
      createdAt: new Date(),
    };
    this.examAttempts.set(created.id, created);
    return created;
  }

  async deleteExamAttempt(userId: string, planId: string, attemptId: string): Promise<boolean> {
    const existing = this.examAttempts.get(attemptId);
    if (!existing || existing.userId !== userId) return false;
    const sub = this.subjects.get(existing.subjectId);
    if (!sub || sub.planId !== planId) return false;
    this.examAttempts.delete(attemptId);
    return true;
  }

  async importPlanBundle(input: ImportPlanBundleInput): Promise<{
    progressCount: number;
    electivesCount: number;
    basketCount: number;
    proposalsCount: number;
  }> {
    let progressCount = 0;
    let electivesCount = 0;
    let basketCount = 0;
    let proposalsCount = 0;

    if (input.settingsIncoming) {
      const existing = await this.getUserSettings(input.userId);
      const merged = mergePlanSettings(existing, input.planId, input.settingsIncoming);
      await this.upsertUserSettings(input.userId, merged);
    }

    const userState = input.userState || {};
    for (const [codeStr, entry] of Object.entries(userState)) {
      const codeNum = parseInt(codeStr, 10);
      const subUuid = input.codeToUuid.get(codeNum);
      if (!subUuid || !entry || typeof entry !== 'object') continue;
      const rawStatus = (entry as any).status;
      const normalizedStatus =
        rawStatus === 'disponible' || rawStatus === 'bloqueada' ? 'pendiente' : rawStatus;
      const gradeVal =
        (entry as any).grade !== undefined && (entry as any).grade !== null
          ? String((entry as any).grade)
          : null;
      if (normalizedStatus === 'pendiente' && gradeVal === null) continue;
      await this.upsertSubjectProgress(input.userId, subUuid, normalizedStatus, gradeVal);
      progressCount++;
    }

    if (input.assignedElectives && typeof input.assignedElectives === 'object') {
      const seen = new Set<string>();
      const nextAssignments: Array<{ subjectId: string; year: number }> = [];
      const maxLevel = resolvePlanMaxLevel(input.maxLevel);
      for (let year = 1; year <= maxLevel; year++) {
        const list = Array.isArray((input.assignedElectives as any)[year])
          ? (input.assignedElectives as any)[year]
          : [];
        for (const item of list) {
          const subUuid = input.codeToUuid.get(Number(item));
          if (subUuid && !seen.has(subUuid)) {
            seen.add(subUuid);
            nextAssignments.push({ subjectId: subUuid, year });
            electivesCount++;
          }
        }
      }
      await this.replacePlanElectiveAssignments(input.userId, input.planSubjectIds, nextAssignments);
    }

    if (Array.isArray(input.basket)) {
      const seen = new Set<string>();
      const nextIds: string[] = [];
      for (const item of input.basket) {
        const subUuid = input.codeToUuid.get(Number(item));
        if (subUuid && !seen.has(subUuid)) {
          seen.add(subUuid);
          nextIds.push(subUuid);
          basketCount++;
        }
      }
      await this.replacePlanBasket(input.userId, input.planSubjectIds, nextIds);
    }

    const currentTerm = await this.getCurrentScheduleTerm(input.facultyId);
    if (currentTerm && input.scheduleSelections && typeof input.scheduleSelections === 'object') {
      const existingSel = await this.getScheduleSelection(input.userId, currentTerm.id);
      const mergedSel = mergePlanScheduleSelections(
        existingSel,
        input.planId,
        input.scheduleSelections
      );
      await this.upsertScheduleSelection(input.userId, currentTerm.id, mergedSel);
    }

    if (currentTerm && Array.isArray(input.scheduleDrafts)) {
      for (const d of input.scheduleDrafts) {
        if (d?.name && d?.selections) {
          await this.saveScheduleProposal({
            userId: input.userId,
            planId: input.planId,
            scheduleTermId: currentTerm.id,
            name: d.name,
            selections: d.selections,
          });
          proposalsCount++;
        }
      }
    }

    return { progressCount, electivesCount, basketCount, proposalsCount };
  }

  async deleteAccount(userId: string, deleteFiles: boolean): Promise<void> {
    const activeLib = getActiveLibraryService();
    if (activeLib) {
      await activeLib.handleAccountDeletion(userId, deleteFiles);
    }
    this.deletedUsers.add(userId);
    this.usersPlan.delete(userId);
    this.settings.delete(userId);
  }
}

export const defaultUserStateStore: UserStateStore = new DrizzleUserStateStore();
