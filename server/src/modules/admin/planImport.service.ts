import crypto from 'crypto';
import { z } from 'zod';
import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  acronyms,
  careers,
  commissions,
  electiveAssignments,
  electiveOfferings,
  faculties,
  finalExamAttempts,
  institutions,
  libraryFiles,
  planSpecialRules,
  professorReviews,
  professorSubjectLinks,
  professorSubjectStats,
  reviewRecommendationDismissals,
  scheduleProposals,
  scheduleSelections,
  sharedSubjects,
  studyPlans,
  subjectEnrollments,
  subjectPrerequisites,
  subjectProgress,
  subjects,
  userBasket,
  userSettings,
  users,
} from '../../db/schema.js';
import { isValidUuid } from '../catalog/catalog.helpers.js';
import {
  formatPlanCatalogPayload,
  type CatalogRuleInput,
  type CatalogSubjectInput,
} from '../catalog/planConfig.helpers.js';
import { logAdminAction } from './admin.audit.js';
import {
  PLAN_IMPORT_MAX_BYTES,
  normalizeSharedSubjectName,
} from './planImport.rules.js';
import {
  parsePlanWorkbookBuffer,
  withPlanImportLock,
} from './planImport.parser.js';
import type {
  ParsedPlanWorkbookData,
  ParsePlanWorkbookResult,
  PlanImportIssue,
} from './planImport.types.js';

export class PlanImportServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'PlanImportServiceError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const SharedSubjectDecisionSchema = z.object({
  subjectCode: z.number().int().positive(),
  action: z.enum(['link_existing', 'create_new']),
  sharedSubjectId: z.string().uuid().optional(),
});

export const PlanImportRequestSchema = z
  .object({
    facultyId: z.string().uuid(),
    targetMode: z.enum([
      'new_career_and_plan',
      'existing_career_new_plan',
      'existing_draft_plan',
    ]),
    careerId: z.string().uuid().optional(),
    careerName: z.string().trim().min(2).max(120).optional(),
    careerCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{2,20}$/, 'careerCode debe tener 2 a 20 caracteres alfanuméricos')
      .optional(),
    planId: z.string().uuid().optional(),
    fileName: z.string().trim().min(1).max(200),
    fileBase64: z.string().trim().min(1).max(Math.ceil((PLAN_IMPORT_MAX_BYTES / 3) * 4) + 1024),
    sharedSubjectDecisions: z.array(SharedSubjectDecisionSchema).max(500).optional(),
    previewHash: z.string().trim().regex(/^[a-f0-9]{64}$/i).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.targetMode === 'new_career_and_plan') {
      if (!val.careerName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['careerName'],
          message: 'careerName es obligatorio para targetMode = new_career_and_plan',
        });
      }
      if (!val.careerCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['careerCode'],
          message: 'careerCode es obligatorio para targetMode = new_career_and_plan',
        });
      }
    } else if (val.targetMode === 'existing_career_new_plan') {
      if (!val.careerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['careerId'],
          message: 'careerId es obligatorio para targetMode = existing_career_new_plan',
        });
      }
    } else if (val.targetMode === 'existing_draft_plan') {
      if (!val.planId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['planId'],
          message: 'planId es obligatorio para targetMode = existing_draft_plan',
        });
      }
    }

    const decisions = val.sharedSubjectDecisions || [];
    const seen = new Set<number>();
    for (const d of decisions) {
      if (seen.has(d.subjectCode)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sharedSubjectDecisions'],
          message: `Decisión duplicada para materia código ${d.subjectCode}`,
        });
      }
      seen.add(d.subjectCode);
      if (d.action === 'link_existing' && !d.sharedSubjectId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sharedSubjectDecisions'],
          message: `sharedSubjectId obligatorio cuando action = link_existing (código ${d.subjectCode})`,
        });
      }
    }
  });

export type PlanImportRequestInput = z.infer<typeof PlanImportRequestSchema>;
export type SharedSubjectDecisionInput = z.infer<typeof SharedSubjectDecisionSchema>;

export interface PlanImportFacultyContext {
  institution: { id: string; name: string; code: string };
  faculty: { id: string; institutionId: string; name: string; code: string };
}

export interface PlanImportCareerRecord {
  id: string;
  facultyId: string;
  name: string;
  code: string;
  status: string;
}

export interface PlanImportPlanRecord {
  id: string;
  careerId: string;
  name: string;
  year: number;
  isActive: boolean;
  status: string;
  config: Record<string, unknown>;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface SharedSubjectRecord {
  id: string;
  facultyId: string;
  stableCode: string;
  normalizedName: string;
  displayName: string;
}

export interface PlanImportSubjectRecord extends CatalogSubjectInput {
  planId: string;
  sharedSubjectId: string | null;
}

export interface SharedSubjectCandidateDTO {
  sharedSubjectId: string;
  stableCode: string;
  displayName: string;
  normalizedName: string;
  linkedPlanLabels: string[];
}

export interface AdminPlanAuditSummaryEntry {
  adminUserId: string | null;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
  ip: string | null;
}

export interface ReferenceBlockersSummary {
  planLevelReferences: Record<string, number>;
  subjectLevelReferences: Map<string, number>;
  totalBlockers: number;
}

export interface PlanImportTxContext {
  getFacultyContext(facultyId: string): Promise<PlanImportFacultyContext | null>;
  findCareerById(careerId: string): Promise<PlanImportCareerRecord | null>;
  findCareerByFacultyAndCode(facultyId: string, code: string): Promise<PlanImportCareerRecord | null>;
  createCareer(data: {
    facultyId: string;
    name: string;
    code: string;
    status: 'draft';
  }): Promise<PlanImportCareerRecord>;
  findPlanById(planId: string): Promise<PlanImportPlanRecord | null>;
  findPlanByCareerYearName(
    careerId: string,
    year: number,
    name: string
  ): Promise<PlanImportPlanRecord | null>;
  createStudyPlan(data: {
    careerId: string;
    name: string;
    year: number;
    status: 'draft';
    isActive: boolean;
    config: Record<string, unknown>;
  }): Promise<PlanImportPlanRecord>;
  updateStudyPlan(
    planId: string,
    data: { name: string; year: number; config: Record<string, unknown> }
  ): Promise<PlanImportPlanRecord>;
  listSubjectsByPlan(planId: string): Promise<PlanImportSubjectRecord[]>;
  findSharedSubjectById(sharedSubjectId: string): Promise<SharedSubjectRecord | null>;
  findSharedSubjectByFacultyAndStableCode(
    facultyId: string,
    stableCode: string
  ): Promise<SharedSubjectRecord | null>;
  createSharedSubject(data: {
    facultyId: string;
    stableCode: string;
    normalizedName: string;
    displayName: string;
  }): Promise<SharedSubjectRecord>;
  updateSharedSubjectIfExclusive(
    id: string,
    currentPlanId: string,
    data: { normalizedName: string; displayName: string }
  ): Promise<void>;
  insertSubject(data: {
    planId: string;
    sharedSubjectId: string;
    codeInPlan: number;
    displayCode: string;
    name: string;
    shortName: string;
    level: number;
    modality: string;
    contraCuatrimestral: boolean;
    weeklyHours: string;
    kind: string;
    credits: number | null;
    isOptionalTrack: boolean;
    trackKey: string | null;
    isIntegrator: boolean;
  }): Promise<PlanImportSubjectRecord>;
  updateSubject(
    id: string,
    data: {
      sharedSubjectId: string;
      displayCode: string;
      name: string;
      shortName: string;
      level: number;
      modality: string;
      contraCuatrimestral: boolean;
      weeklyHours: string;
      kind: string;
      credits: number | null;
      isOptionalTrack: boolean;
      trackKey: string | null;
      isIntegrator: boolean;
    }
  ): Promise<PlanImportSubjectRecord>;
  deleteSubjectsByIds(subjectIds: string[]): Promise<void>;
  replacePlanPrerequisites(
    planId: string,
    planSubjectIds: string[],
    rows: Array<{ subjectId: string; requiresSubjectId: string; type: string }>
  ): Promise<void>;
  replacePlanSpecialRules(
    planId: string,
    rows: Array<{
      subjectId: string;
      ruleType: string;
      params: Record<string, unknown>;
      description: string;
    }>
  ): Promise<void>;
  replacePlanAcronyms(
    planId: string,
    rows: Array<{ acronym: string; subjectId: string }>
  ): Promise<void>;
  checkPlanAndSubjectReferences(
    planId: string,
    subjectIds: string[]
  ): Promise<ReferenceBlockersSummary>;
  deleteDraftPlanCascade(planId: string, candidateOrphanSharedIds: string[]): Promise<void>;
  recordAudit(entry: AdminPlanAuditSummaryEntry): Promise<void>;
}

export interface PlanImportStore {
  getFacultyContext(facultyId: string): Promise<PlanImportFacultyContext | null>;
  findCareerById(careerId: string): Promise<PlanImportCareerRecord | null>;
  findCareerByFacultyAndCode(facultyId: string, code: string): Promise<PlanImportCareerRecord | null>;
  findPlanById(planId: string): Promise<PlanImportPlanRecord | null>;
  findPlanByCareerYearName(
    careerId: string,
    year: number,
    name: string
  ): Promise<PlanImportPlanRecord | null>;
  listSubjectsByPlan(planId: string): Promise<PlanImportSubjectRecord[]>;
  listDraftCrossPlanSharedLinks(
    planId: string
  ): Promise<Map<number, SharedSubjectCandidateDTO>>;
  findSharedSubjectSuggestions(
    facultyId: string,
    normalizedNames: string[]
  ): Promise<Map<string, SharedSubjectCandidateDTO[]>>;
  findSharedSubjectById(sharedSubjectId: string): Promise<SharedSubjectRecord | null>;
  checkPlanAndSubjectReferences(
    planId: string,
    subjectIds: string[]
  ): Promise<ReferenceBlockersSummary>;
  listEnrichedAdminPlans(): Promise<{
    institutions: Array<{ id: string; name: string; code: string }>;
    faculties: Array<{ id: string; institutionId: string; name: string; code: string }>;
    careers: PlanImportCareerRecord[];
    plans: Array<
      PlanImportPlanRecord & {
        subjectCount: number;
        rulesCount: number;
        acronymsCount: number;
        activeUsersCount: number;
        sharedSubjectsCount: number;
        careerName: string;
        careerCode: string;
        careerStatus: string;
        facultyId: string;
        facultyName: string;
        institutionName: string;
      }
    >;
  }>;
  getPlanDetailArtifacts(planId: string): Promise<{
    plan: PlanImportPlanRecord;
    career: PlanImportCareerRecord;
    faculty: { id: string; institutionId: string; name: string; code: string };
    institution: { id: string; name: string; code: string };
    subjects: PlanImportSubjectRecord[];
    prerequisites: Array<{ subjectId: string; requiresSubjectId: string; type: string }>;
    rules: CatalogRuleInput[];
    acronyms: Array<{ acronym: string; subjectId: string }>;
    sharedSubjectsById: Map<string, SharedSubjectRecord & { linkedPlansCount: number }>;
    activeUsersCount: number;
  } | null>;
  runInTransaction<T>(fn: (tx: PlanImportTxContext) => Promise<T>): Promise<T>;
}

async function countByCondition(table: any, cond: any): Promise<number> {
  const [row] = await db.select({ value: count() }).from(table).where(cond);
  return Number(row?.value ?? 0);
}

class DrizzlePlanImportTxContext implements PlanImportTxContext {
  constructor(private readonly tx: any) {}

  async getFacultyContext(facultyId: string): Promise<PlanImportFacultyContext | null> {
    const [fac] = await this.tx
      .select()
      .from(faculties)
      .where(eq(faculties.id, facultyId))
      .limit(1);
    if (!fac) return null;
    const [inst] = await this.tx
      .select()
      .from(institutions)
      .where(eq(institutions.id, fac.institutionId))
      .limit(1);
    if (!inst) return null;
    return { institution: inst, faculty: fac };
  }

  async findCareerById(careerId: string): Promise<PlanImportCareerRecord | null> {
    const [row] = await this.tx.select().from(careers).where(eq(careers.id, careerId)).limit(1);
    return row ?? null;
  }

  async findCareerByFacultyAndCode(
    facultyId: string,
    code: string
  ): Promise<PlanImportCareerRecord | null> {
    const [row] = await this.tx
      .select()
      .from(careers)
      .where(and(eq(careers.facultyId, facultyId), eq(careers.code, code.toUpperCase())))
      .limit(1);
    return row ?? null;
  }

  async createCareer(data: {
    facultyId: string;
    name: string;
    code: string;
    status: 'draft';
  }): Promise<PlanImportCareerRecord> {
    const [created] = await this.tx
      .insert(careers)
      .values({
        facultyId: data.facultyId,
        name: data.name,
        code: data.code.toUpperCase(),
        status: data.status,
      })
      .returning();
    return created;
  }

  async findPlanById(planId: string): Promise<PlanImportPlanRecord | null> {
    const [row] = await this.tx
      .select()
      .from(studyPlans)
      .where(eq(studyPlans.id, planId))
      .limit(1);
    return row ?? null;
  }

  async findPlanByCareerYearName(
    careerId: string,
    year: number,
    name: string
  ): Promise<PlanImportPlanRecord | null> {
    const [row] = await this.tx
      .select()
      .from(studyPlans)
      .where(
        and(
          eq(studyPlans.careerId, careerId),
          eq(studyPlans.year, year),
          eq(studyPlans.name, name)
        )
      )
      .limit(1);
    return row ?? null;
  }

  async createStudyPlan(data: {
    careerId: string;
    name: string;
    year: number;
    status: 'draft';
    isActive: boolean;
    config: Record<string, unknown>;
  }): Promise<PlanImportPlanRecord> {
    const [created] = await this.tx
      .insert(studyPlans)
      .values({
        careerId: data.careerId,
        name: data.name,
        year: data.year,
        status: data.status,
        isActive: data.isActive,
        config: data.config as any,
      })
      .returning();
    return created;
  }

  async updateStudyPlan(
    planId: string,
    data: { name: string; year: number; config: Record<string, unknown> }
  ): Promise<PlanImportPlanRecord> {
    const [updated] = await this.tx
      .update(studyPlans)
      .set({
        name: data.name,
        year: data.year,
        config: data.config as any,
        updatedAt: new Date(),
      })
      .where(eq(studyPlans.id, planId))
      .returning();
    return updated;
  }

  async listSubjectsByPlan(planId: string): Promise<PlanImportSubjectRecord[]> {
    return this.tx.select().from(subjects).where(eq(subjects.planId, planId));
  }

  async findSharedSubjectById(sharedSubjectId: string): Promise<SharedSubjectRecord | null> {
    const [row] = await this.tx
      .select()
      .from(sharedSubjects)
      .where(eq(sharedSubjects.id, sharedSubjectId))
      .limit(1);
    return row ?? null;
  }

  async findSharedSubjectByFacultyAndStableCode(
    facultyId: string,
    stableCode: string
  ): Promise<SharedSubjectRecord | null> {
    const [row] = await this.tx
      .select()
      .from(sharedSubjects)
      .where(and(eq(sharedSubjects.facultyId, facultyId), eq(sharedSubjects.stableCode, stableCode)))
      .limit(1);
    return row ?? null;
  }

  async createSharedSubject(data: {
    facultyId: string;
    stableCode: string;
    normalizedName: string;
    displayName: string;
  }): Promise<SharedSubjectRecord> {
    const [created] = await this.tx.insert(sharedSubjects).values(data).returning();
    return created;
  }

  async updateSharedSubjectIfExclusive(
    id: string,
    currentPlanId: string,
    data: { normalizedName: string; displayName: string }
  ): Promise<void> {
    const otherPlanRows = await this.tx
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.sharedSubjectId, id), ne(subjects.planId, currentPlanId)))
      .limit(1);
    if (otherPlanRows.length > 0) return;

    await this.tx
      .update(sharedSubjects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sharedSubjects.id, id));
  }

  async insertSubject(data: {
    planId: string;
    sharedSubjectId: string;
    codeInPlan: number;
    displayCode: string;
    name: string;
    shortName: string;
    level: number;
    modality: string;
    contraCuatrimestral: boolean;
    weeklyHours: string;
    kind: string;
    credits: number | null;
    isOptionalTrack: boolean;
    trackKey: string | null;
    isIntegrator: boolean;
  }): Promise<PlanImportSubjectRecord> {
    const [created] = await this.tx.insert(subjects).values(data).returning();
    return created;
  }

  async updateSubject(
    id: string,
    data: {
      sharedSubjectId: string;
      displayCode: string;
      name: string;
      shortName: string;
      level: number;
      modality: string;
      contraCuatrimestral: boolean;
      weeklyHours: string;
      kind: string;
      credits: number | null;
      isOptionalTrack: boolean;
      trackKey: string | null;
      isIntegrator: boolean;
    }
  ): Promise<PlanImportSubjectRecord> {
    const [updated] = await this.tx
      .update(subjects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(subjects.id, id))
      .returning();
    return updated;
  }

  async deleteSubjectsByIds(subjectIds: string[]): Promise<void> {
    if (subjectIds.length === 0) return;
    await this.tx.delete(subjects).where(inArray(subjects.id, subjectIds));
  }

  async replacePlanPrerequisites(
    _planId: string,
    planSubjectIds: string[],
    rows: Array<{ subjectId: string; requiresSubjectId: string; type: string }>
  ): Promise<void> {
    if (planSubjectIds.length > 0) {
      await this.tx
        .delete(subjectPrerequisites)
        .where(inArray(subjectPrerequisites.subjectId, planSubjectIds));
    }
    if (rows.length > 0) {
      await this.tx.insert(subjectPrerequisites).values(rows);
    }
  }

  async replacePlanSpecialRules(
    planId: string,
    rows: Array<{
      subjectId: string;
      ruleType: string;
      params: Record<string, unknown>;
      description: string;
    }>
  ): Promise<void> {
    await this.tx.delete(planSpecialRules).where(eq(planSpecialRules.planId, planId));
    if (rows.length > 0) {
      await this.tx
        .insert(planSpecialRules)
        .values(rows.map((r) => ({ planId, ...r })));
    }
  }

  async replacePlanAcronyms(
    planId: string,
    rows: Array<{ acronym: string; subjectId: string }>
  ): Promise<void> {
    await this.tx.delete(acronyms).where(eq(acronyms.planId, planId));
    if (rows.length > 0) {
      await this.tx.insert(acronyms).values(rows.map((a) => ({ planId, ...a })));
    }
  }

  async checkPlanAndSubjectReferences(
    planId: string,
    subjectIds: string[]
  ): Promise<ReferenceBlockersSummary> {
    const txCount = async (table: any, cond: any): Promise<number> => {
      const [row] = await this.tx.select({ value: count() }).from(table).where(cond);
      return Number(row?.value ?? 0);
    };

    const planLevelReferences: Record<string, number> = {
      users: await txCount(users, eq(users.selectedPlanId, planId)),
      userSettings: await txCount(userSettings, eq(userSettings.planId, planId)),
      scheduleSelections: await txCount(scheduleSelections, eq(scheduleSelections.planId, planId)),
      scheduleProposals: await txCount(scheduleProposals, eq(scheduleProposals.planId, planId)),
      libraryFilesBySourcePlan: await txCount(libraryFiles, eq(libraryFiles.sourcePlanId, planId)),
    };

    const subjectLevelReferences = new Map<string, number>();
    let subjectTotal = 0;

    if (subjectIds.length > 0) {
      const refTables: Array<{ table: any; col: any }> = [
        { table: libraryFiles, col: libraryFiles.subjectId },
        { table: libraryFiles, col: libraryFiles.sourceSubjectId },
        { table: subjectProgress, col: subjectProgress.subjectId },
        { table: electiveAssignments, col: electiveAssignments.subjectId },
        { table: userBasket, col: userBasket.subjectId },
        { table: commissions, col: commissions.subjectId },
        { table: electiveOfferings, col: electiveOfferings.subjectId },
        { table: professorSubjectLinks, col: professorSubjectLinks.subjectId },
        { table: professorReviews, col: professorReviews.subjectId },
        { table: professorSubjectStats, col: professorSubjectStats.subjectId },
        { table: subjectEnrollments, col: subjectEnrollments.subjectId },
        { table: finalExamAttempts, col: finalExamAttempts.subjectId },
        { table: reviewRecommendationDismissals, col: reviewRecommendationDismissals.subjectId },
      ];

      for (const { table, col } of refTables) {
        const matched: Array<{ sid: string }> = await this.tx
          .select({ sid: col })
          .from(table)
          .where(inArray(col, subjectIds));
        for (const r of matched) {
          if (!r.sid) continue;
          subjectLevelReferences.set(r.sid, (subjectLevelReferences.get(r.sid) ?? 0) + 1);
          subjectTotal += 1;
        }
      }
    }

    const planTotal = Object.values(planLevelReferences).reduce((acc, n) => acc + n, 0);
    return {
      planLevelReferences,
      subjectLevelReferences,
      totalBlockers: planTotal + subjectTotal,
    };
  }

  async deleteDraftPlanCascade(planId: string, candidateOrphanSharedIds: string[]): Promise<void> {
    await this.tx.delete(studyPlans).where(eq(studyPlans.id, planId));

    for (const sharedId of candidateOrphanSharedIds) {
      const [subRef] = await this.tx
        .select({ value: count() })
        .from(subjects)
        .where(eq(subjects.sharedSubjectId, sharedId));
      const [libRef] = await this.tx
        .select({ value: count() })
        .from(libraryFiles)
        .where(eq(libraryFiles.sharedSubjectId, sharedId));
      if (Number(subRef?.value ?? 0) === 0 && Number(libRef?.value ?? 0) === 0) {
        await this.tx.delete(sharedSubjects).where(eq(sharedSubjects.id, sharedId));
      }
    }
  }

  async recordAudit(entry: AdminPlanAuditSummaryEntry): Promise<void> {
    await logAdminAction({
      tx: this.tx,
      adminUserId: entry.adminUserId,
      adminEmail: entry.adminEmail,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      details: entry.details,
      ip: entry.ip,
    });
  }
}

export class DrizzlePlanImportStore implements PlanImportStore {
  async getFacultyContext(facultyId: string): Promise<PlanImportFacultyContext | null> {
    return new DrizzlePlanImportTxContext(db).getFacultyContext(facultyId);
  }

  async findCareerById(careerId: string): Promise<PlanImportCareerRecord | null> {
    return new DrizzlePlanImportTxContext(db).findCareerById(careerId);
  }

  async findCareerByFacultyAndCode(
    facultyId: string,
    code: string
  ): Promise<PlanImportCareerRecord | null> {
    return new DrizzlePlanImportTxContext(db).findCareerByFacultyAndCode(facultyId, code);
  }

  async findPlanById(planId: string): Promise<PlanImportPlanRecord | null> {
    return new DrizzlePlanImportTxContext(db).findPlanById(planId);
  }

  async findPlanByCareerYearName(
    careerId: string,
    year: number,
    name: string
  ): Promise<PlanImportPlanRecord | null> {
    return new DrizzlePlanImportTxContext(db).findPlanByCareerYearName(careerId, year, name);
  }

  async listSubjectsByPlan(planId: string): Promise<PlanImportSubjectRecord[]> {
    return new DrizzlePlanImportTxContext(db).listSubjectsByPlan(planId);
  }

  async listDraftCrossPlanSharedLinks(
    planId: string
  ): Promise<Map<number, SharedSubjectCandidateDTO>> {
    const result = new Map<number, SharedSubjectCandidateDTO>();
    const planSubs = await db
      .select({
        codeInPlan: subjects.codeInPlan,
        sharedSubjectId: subjects.sharedSubjectId,
      })
      .from(subjects)
      .where(eq(subjects.planId, planId));

    const sharedIds = Array.from(
      new Set(planSubs.map((s) => s.sharedSubjectId).filter((id): id is string => Boolean(id)))
    );
    if (sharedIds.length === 0) return result;

    const [sharedRows, linkedRows] = await Promise.all([
      db.select().from(sharedSubjects).where(inArray(sharedSubjects.id, sharedIds)),
      db
        .select({
          sharedSubjectId: subjects.sharedSubjectId,
          planId: subjects.planId,
          careerCode: careers.code,
          planName: studyPlans.name,
        })
        .from(subjects)
        .innerJoin(studyPlans, eq(studyPlans.id, subjects.planId))
        .innerJoin(careers, eq(careers.id, studyPlans.careerId))
        .where(inArray(subjects.sharedSubjectId, sharedIds)),
    ]);

    const sharedById = new Map(sharedRows.map((sh) => [sh.id, sh]));
    const labelsByShared = new Map<string, string[]>();
    const hasOtherPlan = new Set<string>();

    for (const r of linkedRows) {
      if (!r.sharedSubjectId) continue;
      if (r.planId !== planId) {
        hasOtherPlan.add(r.sharedSubjectId);
      }
      const label = `${r.careerCode} · ${r.planName}`;
      const list = labelsByShared.get(r.sharedSubjectId) || [];
      if (!list.includes(label)) list.push(label);
      labelsByShared.set(r.sharedSubjectId, list);
    }

    for (const ps of planSubs) {
      if (!ps.sharedSubjectId || !hasOtherPlan.has(ps.sharedSubjectId)) continue;
      const sh = sharedById.get(ps.sharedSubjectId);
      if (!sh) continue;
      result.set(ps.codeInPlan, {
        sharedSubjectId: sh.id,
        stableCode: sh.stableCode,
        displayName: sh.displayName,
        normalizedName: sh.normalizedName,
        linkedPlanLabels: labelsByShared.get(sh.id) || [],
      });
    }

    return result;
  }

  async findSharedSubjectSuggestions(
    facultyId: string,
    normalizedNames: string[]
  ): Promise<Map<string, SharedSubjectCandidateDTO[]>> {
    const result = new Map<string, SharedSubjectCandidateDTO[]>();
    const uniqueNorms = Array.from(new Set(normalizedNames.filter(Boolean)));
    if (uniqueNorms.length === 0) return result;

    const matchedShared = await db
      .select()
      .from(sharedSubjects)
      .where(
        and(
          eq(sharedSubjects.facultyId, facultyId),
          inArray(sharedSubjects.normalizedName, uniqueNorms)
        )
      );

    if (matchedShared.length === 0) return result;

    const sharedIds = matchedShared.map((s) => s.id);
    const linkedRows = await db
      .select({
        sharedSubjectId: subjects.sharedSubjectId,
        careerCode: careers.code,
        planName: studyPlans.name,
      })
      .from(subjects)
      .innerJoin(studyPlans, eq(studyPlans.id, subjects.planId))
      .innerJoin(careers, eq(careers.id, studyPlans.careerId))
      .where(inArray(subjects.sharedSubjectId, sharedIds));

    const plansByShared = new Map<string, string[]>();
    for (const r of linkedRows) {
      if (!r.sharedSubjectId) continue;
      const label = `${r.careerCode} · ${r.planName}`;
      const list = plansByShared.get(r.sharedSubjectId) || [];
      if (!list.includes(label)) list.push(label);
      plansByShared.set(r.sharedSubjectId, list);
    }

    for (const sh of matchedShared) {
      const list = result.get(sh.normalizedName) || [];
      list.push({
        sharedSubjectId: sh.id,
        stableCode: sh.stableCode,
        displayName: sh.displayName,
        normalizedName: sh.normalizedName,
        linkedPlanLabels: plansByShared.get(sh.id) || [],
      });
      result.set(sh.normalizedName, list);
    }

    return result;
  }

  async findSharedSubjectById(sharedSubjectId: string): Promise<SharedSubjectRecord | null> {
    return new DrizzlePlanImportTxContext(db).findSharedSubjectById(sharedSubjectId);
  }

  async checkPlanAndSubjectReferences(
    planId: string,
    subjectIds: string[]
  ): Promise<ReferenceBlockersSummary> {
    return new DrizzlePlanImportTxContext(db).checkPlanAndSubjectReferences(planId, subjectIds);
  }

  async listEnrichedAdminPlans() {
    const [allInstitutions, allFaculties, allCareers, allPlans] = await Promise.all([
      db.select().from(institutions),
      db.select().from(faculties),
      db.select().from(careers),
      db.select().from(studyPlans),
    ]);

    const instById = new Map(allInstitutions.map((i) => [i.id, i]));
    const facById = new Map(allFaculties.map((f) => [f.id, f]));
    const carById = new Map(allCareers.map((c) => [c.id, c]));

    const planStats = await Promise.all(
      allPlans.map(async (plan) => {
        const [planSubs, rulesCount, acronymsCount, activeUsersCount] = await Promise.all([
          db
            .select({ sharedSubjectId: subjects.sharedSubjectId })
            .from(subjects)
            .where(eq(subjects.planId, plan.id)),
          countByCondition(planSpecialRules, eq(planSpecialRules.planId, plan.id)),
          countByCondition(acronyms, eq(acronyms.planId, plan.id)),
          countByCondition(users, eq(users.selectedPlanId, plan.id)),
        ]);

        const career = carById.get(plan.careerId);
        const faculty = career ? facById.get(career.facultyId) : undefined;
        const institution = faculty ? instById.get(faculty.institutionId) : undefined;
        const distinctShared = new Set(
          planSubs.map((s) => s.sharedSubjectId).filter((id): id is string => Boolean(id))
        );

        return {
          ...plan,
          subjectCount: planSubs.length,
          rulesCount,
          acronymsCount,
          activeUsersCount,
          sharedSubjectsCount: distinctShared.size,
          careerName: career?.name || '',
          careerCode: career?.code || '',
          careerStatus: career?.status || 'draft',
          facultyId: faculty?.id || '',
          facultyName: faculty?.name || '',
          institutionName: institution?.name || '',
        };
      })
    );

    return {
      institutions: allInstitutions,
      faculties: allFaculties,
      careers: allCareers,
      plans: planStats,
    };
  }

  async getPlanDetailArtifacts(planId: string) {
    const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.id, planId)).limit(1);
    if (!plan) return null;
    const [career] = await db.select().from(careers).where(eq(careers.id, plan.careerId)).limit(1);
    if (!career) return null;
    const [faculty] = await db
      .select()
      .from(faculties)
      .where(eq(faculties.id, career.facultyId))
      .limit(1);
    if (!faculty) return null;
    const [institution] = await db
      .select()
      .from(institutions)
      .where(eq(institutions.id, faculty.institutionId))
      .limit(1);
    if (!institution) return null;

    const planSubjects = await db.select().from(subjects).where(eq(subjects.planId, planId));
    const subIds = planSubjects.map((s) => s.id);
    const [prereqList, rulesList, acronymList, activeUsersCount] = await Promise.all([
      subIds.length > 0
        ? db
            .select({
              subjectId: subjectPrerequisites.subjectId,
              requiresSubjectId: subjectPrerequisites.requiresSubjectId,
              type: subjectPrerequisites.type,
            })
            .from(subjectPrerequisites)
            .where(inArray(subjectPrerequisites.subjectId, subIds))
        : Promise.resolve([]),
      db.select().from(planSpecialRules).where(eq(planSpecialRules.planId, planId)),
      db.select().from(acronyms).where(eq(acronyms.planId, planId)),
      countByCondition(users, eq(users.selectedPlanId, planId)),
    ]);

    const sharedIds = Array.from(
      new Set(
        planSubjects.map((s) => s.sharedSubjectId).filter((id): id is string => Boolean(id))
      )
    );
    const sharedSubjectsById = new Map<string, SharedSubjectRecord & { linkedPlansCount: number }>();

    if (sharedIds.length > 0) {
      const [sharedRows, sharedSubjectsLinks] = await Promise.all([
        db.select().from(sharedSubjects).where(inArray(sharedSubjects.id, sharedIds)),
        db
          .select({ sharedSubjectId: subjects.sharedSubjectId, planId: subjects.planId })
          .from(subjects)
          .where(inArray(subjects.sharedSubjectId, sharedIds)),
      ]);
      const planSetByShared = new Map<string, Set<string>>();
      for (const link of sharedSubjectsLinks) {
        if (!link.sharedSubjectId) continue;
        const set = planSetByShared.get(link.sharedSubjectId) || new Set<string>();
        set.add(link.planId);
        planSetByShared.set(link.sharedSubjectId, set);
      }
      for (const sh of sharedRows) {
        sharedSubjectsById.set(sh.id, {
          ...sh,
          linkedPlansCount: planSetByShared.get(sh.id)?.size ?? 0,
        });
      }
    }

    return {
      plan,
      career,
      faculty,
      institution,
      subjects: planSubjects,
      prerequisites: prereqList,
      rules: rulesList,
      acronyms: acronymList,
      sharedSubjectsById,
      activeUsersCount,
    };
  }

  async runInTransaction<T>(fn: (tx: PlanImportTxContext) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => fn(new DrizzlePlanImportTxContext(tx)));
  }
}

export class InMemoryPlanImportStore implements PlanImportStore {
  institutions: Array<{ id: string; name: string; code: string }> = [];
  faculties: Array<{ id: string; institutionId: string; name: string; code: string }> = [];
  careers: PlanImportCareerRecord[] = [];
  plans: PlanImportPlanRecord[] = [];
  sharedSubjects: SharedSubjectRecord[] = [];
  subjects: PlanImportSubjectRecord[] = [];
  prerequisites: Array<{ subjectId: string; requiresSubjectId: string; type: string }> = [];
  rules: Array<CatalogRuleInput & { planId: string }> = [];
  acronyms: Array<{ planId: string; acronym: string; subjectId: string }> = [];
  usersSelectedPlanIds: string[] = [];
  libraryFileRefs: Array<{
    subjectId: string;
    sourceSubjectId?: string | null;
    sourcePlanId?: string | null;
    sharedSubjectId?: string | null;
  }> = [];
  subjectProgressSubjectIds: string[] = [];
  auditLogs: AdminPlanAuditSummaryEntry[] = [];
  shouldThrowOnOperation?: string;

  async getFacultyContext(facultyId: string): Promise<PlanImportFacultyContext | null> {
    const fac = this.faculties.find((f) => f.id === facultyId);
    if (!fac) return null;
    const inst = this.institutions.find((i) => i.id === fac.institutionId);
    if (!inst) return null;
    return { institution: inst, faculty: fac };
  }

  async findCareerById(careerId: string): Promise<PlanImportCareerRecord | null> {
    return this.careers.find((c) => c.id === careerId) ?? null;
  }

  async findCareerByFacultyAndCode(
    facultyId: string,
    code: string
  ): Promise<PlanImportCareerRecord | null> {
    return (
      this.careers.find((c) => c.facultyId === facultyId && c.code === code.toUpperCase()) ?? null
    );
  }

  async findPlanById(planId: string): Promise<PlanImportPlanRecord | null> {
    return this.plans.find((p) => p.id === planId) ?? null;
  }

  async findPlanByCareerYearName(
    careerId: string,
    year: number,
    name: string
  ): Promise<PlanImportPlanRecord | null> {
    return this.plans.find((p) => p.careerId === careerId && p.year === year && p.name === name) ?? null;
  }

  async listSubjectsByPlan(planId: string): Promise<PlanImportSubjectRecord[]> {
    return this.subjects.filter((s) => s.planId === planId);
  }

  async listDraftCrossPlanSharedLinks(
    planId: string
  ): Promise<Map<number, SharedSubjectCandidateDTO>> {
    const result = new Map<number, SharedSubjectCandidateDTO>();
    const planSubs = this.subjects.filter((s) => s.planId === planId && s.sharedSubjectId);
    for (const ps of planSubs) {
      if (!ps.sharedSubjectId) continue;
      const sh = this.sharedSubjects.find((item) => item.id === ps.sharedSubjectId);
      if (!sh) continue;
      const allLinks = this.subjects.filter((s) => s.sharedSubjectId === sh.id);
      if (!allLinks.some((s) => s.planId !== planId)) continue;
      const linkedPlanLabels = Array.from(
        new Set(
          allLinks.map((s) => {
            const plan = this.plans.find((p) => p.id === s.planId);
            const career = plan ? this.careers.find((c) => c.id === plan.careerId) : undefined;
            return `${career?.code || 'CAR'} · ${plan?.name || 'Plan'}`;
          })
        )
      );
      result.set(ps.codeInPlan, {
        sharedSubjectId: sh.id,
        stableCode: sh.stableCode,
        displayName: sh.displayName,
        normalizedName: sh.normalizedName,
        linkedPlanLabels,
      });
    }
    return result;
  }

  async findSharedSubjectSuggestions(
    facultyId: string,
    normalizedNames: string[]
  ): Promise<Map<string, SharedSubjectCandidateDTO[]>> {
    const normSet = new Set(normalizedNames);
    const map = new Map<string, SharedSubjectCandidateDTO[]>();
    for (const sh of this.sharedSubjects) {
      if (sh.facultyId !== facultyId || !normSet.has(sh.normalizedName)) continue;
      const linkedSubjects = this.subjects.filter((s) => s.sharedSubjectId === sh.id);
      const linkedPlanLabels = linkedSubjects.map((s) => {
        const plan = this.plans.find((p) => p.id === s.planId);
        const career = plan ? this.careers.find((c) => c.id === plan.careerId) : undefined;
        return `${career?.code || 'CAR'} · ${plan?.name || 'Plan'}`;
      });
      const list = map.get(sh.normalizedName) || [];
      list.push({
        sharedSubjectId: sh.id,
        stableCode: sh.stableCode,
        displayName: sh.displayName,
        normalizedName: sh.normalizedName,
        linkedPlanLabels: Array.from(new Set(linkedPlanLabels)),
      });
      map.set(sh.normalizedName, list);
    }
    return map;
  }

  async findSharedSubjectById(sharedSubjectId: string): Promise<SharedSubjectRecord | null> {
    return this.sharedSubjects.find((s) => s.id === sharedSubjectId) ?? null;
  }

  async checkPlanAndSubjectReferences(
    planId: string,
    subjectIds: string[]
  ): Promise<ReferenceBlockersSummary> {
    const planLevelReferences: Record<string, number> = {
      users: this.usersSelectedPlanIds.filter((pid) => pid === planId).length,
      libraryFilesBySourcePlan: this.libraryFileRefs.filter((f) => f.sourcePlanId === planId).length,
    };
    const subSet = new Set(subjectIds);
    const subjectLevelReferences = new Map<string, number>();
    let subTotal = 0;

    for (const f of this.libraryFileRefs) {
      for (const sid of [f.subjectId, f.sourceSubjectId]) {
        if (sid && subSet.has(sid)) {
          subjectLevelReferences.set(sid, (subjectLevelReferences.get(sid) ?? 0) + 1);
          subTotal += 1;
        }
      }
    }
    for (const sid of this.subjectProgressSubjectIds) {
      if (subSet.has(sid)) {
        subjectLevelReferences.set(sid, (subjectLevelReferences.get(sid) ?? 0) + 1);
        subTotal += 1;
      }
    }

    const planTotal = Object.values(planLevelReferences).reduce((a, b) => a + b, 0);
    return {
      planLevelReferences,
      subjectLevelReferences,
      totalBlockers: planTotal + subTotal,
    };
  }

  async listEnrichedAdminPlans() {
    const instById = new Map(this.institutions.map((i) => [i.id, i]));
    const facById = new Map(this.faculties.map((f) => [f.id, f]));
    const carById = new Map(this.careers.map((c) => [c.id, c]));

    return {
      institutions: [...this.institutions],
      faculties: [...this.faculties],
      careers: [...this.careers],
      plans: this.plans.map((plan) => {
        const planSubs = this.subjects.filter((s) => s.planId === plan.id);
        const rulesCount = this.rules.filter((r) => r.planId === plan.id).length;
        const acronymsCount = this.acronyms.filter((a) => a.planId === plan.id).length;
        const activeUsersCount = this.usersSelectedPlanIds.filter((pid) => pid === plan.id).length;
        const distinctShared = new Set(planSubs.map((s) => s.sharedSubjectId).filter(Boolean));
        const career = carById.get(plan.careerId);
        const faculty = career ? facById.get(career.facultyId) : undefined;
        const institution = faculty ? instById.get(faculty.institutionId) : undefined;
        return {
          ...plan,
          subjectCount: planSubs.length,
          rulesCount,
          acronymsCount,
          activeUsersCount,
          sharedSubjectsCount: distinctShared.size,
          careerName: career?.name || '',
          careerCode: career?.code || '',
          careerStatus: career?.status || 'draft',
          facultyId: faculty?.id || '',
          facultyName: faculty?.name || '',
          institutionName: institution?.name || '',
        };
      }),
    };
  }

  async getPlanDetailArtifacts(planId: string) {
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan) return null;
    const career = this.careers.find((c) => c.id === plan.careerId);
    if (!career) return null;
    const faculty = this.faculties.find((f) => f.id === career.facultyId);
    if (!faculty) return null;
    const institution = this.institutions.find((i) => i.id === faculty.institutionId);
    if (!institution) return null;

    const planSubs = this.subjects.filter((s) => s.planId === planId);
    const subSet = new Set(planSubs.map((s) => s.id));
    const prereqList = this.prerequisites.filter((p) => subSet.has(p.subjectId));
    const rulesList = this.rules.filter((r) => r.planId === planId);
    const acronymList = this.acronyms
      .filter((a) => a.planId === planId)
      .map(({ acronym, subjectId }) => ({ acronym, subjectId }));
    const activeUsersCount = this.usersSelectedPlanIds.filter((pid) => pid === plan.id).length;

    const sharedSubjectsById = new Map<string, SharedSubjectRecord & { linkedPlansCount: number }>();
    for (const sub of planSubs) {
      if (!sub.sharedSubjectId || sharedSubjectsById.has(sub.sharedSubjectId)) continue;
      const sh = this.sharedSubjects.find((x) => x.id === sub.sharedSubjectId);
      if (!sh) continue;
      const planCount = new Set(
        this.subjects.filter((x) => x.sharedSubjectId === sh.id).map((x) => x.planId)
      ).size;
      sharedSubjectsById.set(sh.id, { ...sh, linkedPlansCount: planCount });
    }

    return {
      plan,
      career,
      faculty,
      institution,
      subjects: planSubs,
      prerequisites: prereqList,
      rules: rulesList,
      acronyms: acronymList,
      sharedSubjectsById,
      activeUsersCount,
    };
  }

  async runInTransaction<T>(fn: (tx: PlanImportTxContext) => Promise<T>): Promise<T> {
    // Snapshot state for true atomic rollback on thrown error
    const snapshot = {
      careers: structuredClone(this.careers),
      plans: structuredClone(this.plans),
      sharedSubjects: structuredClone(this.sharedSubjects),
      subjects: structuredClone(this.subjects),
      prerequisites: structuredClone(this.prerequisites),
      rules: structuredClone(this.rules),
      acronyms: structuredClone(this.acronyms),
      auditLogs: structuredClone(this.auditLogs),
    };

    const store = this;
    const tx: PlanImportTxContext = {
      getFacultyContext: (id) => store.getFacultyContext(id),
      findCareerById: (id) => store.findCareerById(id),
      findCareerByFacultyAndCode: (fid, c) => store.findCareerByFacultyAndCode(fid, c),
      async createCareer(data) {
        const rec: PlanImportCareerRecord = {
          id: crypto.randomUUID(),
          facultyId: data.facultyId,
          name: data.name,
          code: data.code.toUpperCase(),
          status: data.status,
        };
        store.careers.push(rec);
        return rec;
      },
      findPlanById: (id) => store.findPlanById(id),
      findPlanByCareerYearName: (cid, y, n) => store.findPlanByCareerYearName(cid, y, n),
      async createStudyPlan(data) {
        const now = new Date().toISOString();
        const rec: PlanImportPlanRecord = {
          id: crypto.randomUUID(),
          careerId: data.careerId,
          name: data.name,
          year: data.year,
          status: data.status,
          isActive: data.isActive,
          config: data.config,
          createdAt: now,
          updatedAt: now,
        };
        store.plans.push(rec);
        return rec;
      },
      async updateStudyPlan(planId, data) {
        const idx = store.plans.findIndex((p) => p.id === planId);
        if (idx < 0) throw new Error('Plan no encontrado');
        store.plans[idx] = {
          ...store.plans[idx],
          name: data.name,
          year: data.year,
          config: data.config,
          updatedAt: new Date().toISOString(),
        };
        return store.plans[idx];
      },
      listSubjectsByPlan: (pid) => store.listSubjectsByPlan(pid),
      findSharedSubjectById: (id) => store.findSharedSubjectById(id),
      async findSharedSubjectByFacultyAndStableCode(facultyId, stableCode) {
        return (
          store.sharedSubjects.find(
            (s) => s.facultyId === facultyId && s.stableCode === stableCode
          ) ?? null
        );
      },
      async createSharedSubject(data) {
        const rec: SharedSubjectRecord = { id: crypto.randomUUID(), ...data };
        store.sharedSubjects.push(rec);
        return rec;
      },
      async updateSharedSubjectIfExclusive(id, currentPlanId, data) {
        const usedByOtherPlan = store.subjects.some(
          (s) => s.sharedSubjectId === id && s.planId !== currentPlanId
        );
        if (usedByOtherPlan) return;
        const idx = store.sharedSubjects.findIndex((s) => s.id === id);
        if (idx >= 0) {
          store.sharedSubjects[idx] = { ...store.sharedSubjects[idx], ...data };
        }
      },
      async insertSubject(data) {
        const rec: PlanImportSubjectRecord = {
          id: crypto.randomUUID(),
          planId: data.planId,
          sharedSubjectId: data.sharedSubjectId,
          codeInPlan: data.codeInPlan,
          displayCode: data.displayCode,
          name: data.name,
          shortName: data.shortName,
          level: data.level,
          modality: data.modality,
          contraCuatrimestral: data.contraCuatrimestral,
          weeklyHours: data.weeklyHours,
          kind: data.kind,
          credits: data.credits,
          isOptionalTrack: data.isOptionalTrack,
          trackKey: data.trackKey,
          isIntegrator: data.isIntegrator,
        };
        store.subjects.push(rec);
        return rec;
      },
      async updateSubject(id, data) {
        const idx = store.subjects.findIndex((s) => s.id === id);
        if (idx < 0) throw new Error('Materia no encontrada');
        store.subjects[idx] = { ...store.subjects[idx], ...data };
        return store.subjects[idx];
      },
      async deleteSubjectsByIds(ids) {
        const idSet = new Set(ids);
        store.subjects = store.subjects.filter((s) => !idSet.has(s.id));
      },
      async replacePlanPrerequisites(_planId, planSubjectIds, rows) {
        if (store.shouldThrowOnOperation === 'replacePlanPrerequisites') {
          throw new Error('Falla simulada durante replacePlanPrerequisites');
        }
        const idSet = new Set(planSubjectIds);
        store.prerequisites = store.prerequisites.filter((p) => !idSet.has(p.subjectId));
        store.prerequisites.push(...rows);
      },
      async replacePlanSpecialRules(planId, rows) {
        if (store.shouldThrowOnOperation === 'replacePlanSpecialRules') {
          throw new Error('Falla simulada durante replacePlanSpecialRules');
        }
        store.rules = store.rules.filter((r) => r.planId !== planId);
        store.rules.push(...rows.map((r, idx) => ({ id: `rule-${idx}-${planId}`, planId, ...r })));
      },
      async replacePlanAcronyms(planId, rows) {
        store.acronyms = store.acronyms.filter((a) => a.planId !== planId);
        store.acronyms.push(...rows.map((a) => ({ planId, ...a })));
      },
      checkPlanAndSubjectReferences: (pid, sids) => store.checkPlanAndSubjectReferences(pid, sids),
      async deleteDraftPlanCascade(planId, candidateOrphanSharedIds) {
        const removedSubIds = new Set(
          store.subjects.filter((s) => s.planId === planId).map((s) => s.id)
        );
        store.plans = store.plans.filter((p) => p.id !== planId);
        store.subjects = store.subjects.filter((s) => s.planId !== planId);
        store.prerequisites = store.prerequisites.filter((p) => !removedSubIds.has(p.subjectId));
        store.rules = store.rules.filter((r) => r.planId !== planId);
        store.acronyms = store.acronyms.filter((a) => a.planId !== planId);
        for (const sid of candidateOrphanSharedIds) {
          const usedInSubs = store.subjects.some((s) => s.sharedSubjectId === sid);
          const usedInLib = store.libraryFileRefs.some((f) => f.sharedSubjectId === sid);
          if (!usedInSubs && !usedInLib) {
            store.sharedSubjects = store.sharedSubjects.filter((sh) => sh.id !== sid);
          }
        }
      },
      async recordAudit(entry) {
        store.auditLogs.push(entry);
      },
    };

    try {
      return await fn(tx);
    } catch (err) {
      store.careers = snapshot.careers;
      store.plans = snapshot.plans;
      store.sharedSubjects = snapshot.sharedSubjects;
      store.subjects = snapshot.subjects;
      store.prerequisites = snapshot.prerequisites;
      store.rules = snapshot.rules;
      store.acronyms = snapshot.acronyms;
      store.auditLogs = snapshot.auditLogs;
      throw err;
    }
  }
}

const defaultPlanImportStore = new DrizzlePlanImportStore();
let activePlanImportStore: PlanImportStore = defaultPlanImportStore;

export function getPlanImportStore(): PlanImportStore {
  return activePlanImportStore;
}

export function setPlanImportStoreForTesting(store: PlanImportStore | null): void {
  activePlanImportStore = store || defaultPlanImportStore;
}

export function decodeBase64Workbook(fileBase64: string): Buffer {
  const clean = fileBase64.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
  if (!clean || clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]+=*$/.test(clean)) {
    throw new PlanImportServiceError(
      400,
      'INVALID_FILE_BASE64',
      'El archivo codificado en Base64 es inválido.'
    );
  }
  const buffer = Buffer.from(clean, 'base64');
  if (buffer.length > PLAN_IMPORT_MAX_BYTES) {
    throw new PlanImportServiceError(
      413,
      'FILE_TOO_LARGE',
      `El archivo supera el tamaño máximo permitido de ${Math.round(PLAN_IMPORT_MAX_BYTES / (1024 * 1024))} MB.`
    );
  }
  return buffer;
}

/**
 * Deterministic SHA-256 preview signature binding:
 * - raw `.xlsx` bytes (`fileSha256`)
 * - target faculty / mode / career / plan selection
 * - canonicalized sorted admin decisions on `shared_subjects`
 */
export function computePlanImportPreviewHash(params: {
  fileBuffer: Buffer;
  facultyId: string;
  targetMode: PlanImportRequestInput['targetMode'];
  careerId?: string;
  careerName?: string;
  careerCode?: string;
  planId?: string;
  sharedSubjectDecisions: SharedSubjectDecisionInput[];
}): string {
  const fileSha256 = crypto.createHash('sha256').update(params.fileBuffer).digest('hex');
  const sortedDecisions = [...params.sharedSubjectDecisions]
    .map((d) => ({
      subjectCode: d.subjectCode,
      action: d.action,
      sharedSubjectId: d.action === 'link_existing' ? d.sharedSubjectId ?? null : null,
    }))
    .sort((a, b) => a.subjectCode - b.subjectCode);

  const canonical = JSON.stringify({
    fileSha256,
    facultyId: params.facultyId,
    targetMode: params.targetMode,
    careerId: params.careerId ?? null,
    careerName: params.careerName ?? null,
    careerCode: params.careerCode?.toUpperCase() ?? null,
    planId: params.planId ?? null,
    sharedSubjectDecisions: sortedDecisions,
  });

  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function buildPlanConfigObject(
  parsed: ParsedPlanWorkbookData,
  careerCode: string
): Record<string, unknown> {
  return {
    requiredElectiveCredits: parsed.plan.requiredElectiveCredits,
    defaultMinPassingGrade: parsed.plan.defaultMinPassingGrade,
    electiveSlotsEquivalent: parsed.plan.electiveSlotsEquivalent,
    totalLevels: parsed.plan.totalLevels,
    levelLabel: parsed.plan.levelLabel,
    shortTag: parsed.plan.shortTag || `${careerCode} · ${parsed.plan.name}`,
    ...(parsed.plan.finalDegreeTitle ? { finalDegreeTitle: parsed.plan.finalDegreeTitle } : {}),
    ppsRequirement: parsed.plan.ppsRequirement,
    intermediateDegrees: parsed.plan.intermediateDegrees,
  };
}

interface ResolvedTargetContext {
  facultyCtx: PlanImportFacultyContext;
  existingCareer: PlanImportCareerRecord | null;
  existingPlan: PlanImportPlanRecord | null;
  resolvedCareerCode: string;
}

async function resolveTargetContext(
  store: Pick<
    PlanImportStore,
    'getFacultyContext' | 'findCareerById' | 'findCareerByFacultyAndCode' | 'findPlanById' | 'findPlanByCareerYearName'
  >,
  input: PlanImportRequestInput,
  parsedPlanMeta: ParsedPlanWorkbookData['plan'] | null
): Promise<ResolvedTargetContext> {
  const facultyCtx = await store.getFacultyContext(input.facultyId);
  if (!facultyCtx) {
    throw new PlanImportServiceError(404, 'FACULTY_NOT_FOUND', 'Facultad no encontrada.');
  }

  if (input.targetMode === 'new_career_and_plan') {
    const code = input.careerCode!.toUpperCase();
    const conflict = await store.findCareerByFacultyAndCode(input.facultyId, code);
    if (conflict) {
      throw new PlanImportServiceError(
        409,
        'CAREER_CODE_ALREADY_EXISTS',
        `Ya existe una carrera con código "${code}" en la facultad seleccionada ("${conflict.name}").`
      );
    }
    return {
      facultyCtx,
      existingCareer: null,
      existingPlan: null,
      resolvedCareerCode: code,
    };
  }

  if (input.targetMode === 'existing_career_new_plan') {
    const career = await store.findCareerById(input.careerId!);
    if (!career || career.facultyId !== input.facultyId) {
      throw new PlanImportServiceError(
        404,
        'CAREER_NOT_FOUND',
        'Carrera no encontrada dentro de la facultad seleccionada.'
      );
    }
    if (parsedPlanMeta) {
      const duplicatePlan = await store.findPlanByCareerYearName(
        career.id,
        parsedPlanMeta.year,
        parsedPlanMeta.name
      );
      if (duplicatePlan) {
        throw new PlanImportServiceError(
          409,
          'PLAN_ALREADY_EXISTS',
          `La carrera "${career.name}" ya posee el plan "${parsedPlanMeta.name}" (${parsedPlanMeta.year}). Usá modo de actualización sobre borrador si corresponde.`
        );
      }
    }
    return {
      facultyCtx,
      existingCareer: career,
      existingPlan: null,
      resolvedCareerCode: career.code,
    };
  }

  // existing_draft_plan
  const plan = await store.findPlanById(input.planId!);
  if (!plan) {
    throw new PlanImportServiceError(404, 'PLAN_NOT_FOUND', 'Plan de estudio no encontrado.');
  }
  const career = await store.findCareerById(plan.careerId);
  if (!career || career.facultyId !== input.facultyId) {
    throw new PlanImportServiceError(
      400,
      'PLAN_FACULTY_MISMATCH',
      'El plan seleccionado no pertenece a la facultad indicada.'
    );
  }
  if (plan.status !== 'draft') {
    throw new PlanImportServiceError(
      409,
      'PLAN_NOT_DRAFT',
      `El plan "${plan.name}" está en estado "${plan.status}". Solo se pueden re-importar planes en estado "draft".`
    );
  }
  return {
    facultyCtx,
    existingCareer: career,
    existingPlan: plan,
    resolvedCareerCode: career.code,
  };
}

async function validateSharedDecisions(
  store: Pick<PlanImportStore, 'findSharedSubjectById'>,
  facultyId: string,
  decisions: SharedSubjectDecisionInput[],
  parsedData: ParsedPlanWorkbookData,
  errors: PlanImportIssue[]
): Promise<Map<number, SharedSubjectDecisionInput>> {
  const byCode = new Map<number, SharedSubjectDecisionInput>();
  const validCodes = new Set(parsedData.subjects.map((s) => s.codeInPlan));
  const usedSharedIds = new Map<string, number>();

  for (const decision of decisions) {
    if (!validCodes.has(decision.subjectCode)) {
      errors.push({
        sheet: 'Materias',
        row: 0,
        field: 'sharedSubjectDecisions',
        message: `La decisión de materia compartida referencia el código ${decision.subjectCode}, que no existe en el Excel.`,
      });
      continue;
    }

    if (decision.action === 'link_existing' && decision.sharedSubjectId) {
      const sh = await store.findSharedSubjectById(decision.sharedSubjectId);
      if (!sh || sh.facultyId !== facultyId) {
        errors.push({
          sheet: 'Materias',
          row: 0,
          field: 'sharedSubjectDecisions',
          message: `La materia compartida seleccionada (${decision.sharedSubjectId}) no existe dentro de la facultad actual.`,
        });
        continue;
      }
      const prevCode = usedSharedIds.get(sh.id);
      if (prevCode !== undefined && prevCode !== decision.subjectCode) {
        errors.push({
          sheet: 'Materias',
          row: 0,
          field: 'sharedSubjectDecisions',
          message: `No se puede vincular el mismo shared_subject (${sh.displayName}) a dos materias distintas del mismo plan (${prevCode} y ${decision.subjectCode}).`,
        });
        continue;
      }
      usedSharedIds.set(sh.id, decision.subjectCode);
    }

    byCode.set(decision.subjectCode, decision);
  }

  return byCode;
}

export async function previewPlanImport(
  input: PlanImportRequestInput,
  parseTestHooks?: { timeoutMs?: number; artificialWorkerDelayMs?: number }
) {
  const fileBuffer = decodeBase64Workbook(input.fileBase64);
  const decisions = input.sharedSubjectDecisions || [];
  const store = getPlanImportStore();

  return withPlanImportLock(async () => {
    const parseResult: ParsePlanWorkbookResult = await parsePlanWorkbookBuffer({
      fileName: input.fileName,
      buffer: fileBuffer,
      lockAlreadyHeld: true,
      ...(parseTestHooks || {}),
    });

    const targetCtx = await resolveTargetContext(
      store,
      input,
      parseResult.data?.plan || null
    );

    const fileSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const previewHash = computePlanImportPreviewHash({
      fileBuffer,
      facultyId: input.facultyId,
      targetMode: input.targetMode,
      careerId: input.careerId,
      careerName: input.careerName,
      careerCode: input.careerCode,
      planId: input.planId,
      sharedSubjectDecisions: decisions,
    });

    if (!parseResult.valid || !parseResult.data) {
      return {
        valid: false,
        previewHash,
        fileSha256,
        errors: parseResult.errors,
        warnings: parseResult.warnings,
        stats: parseResult.stats,
        targetSummary: {
          facultyId: targetCtx.facultyCtx.faculty.id,
          facultyName: targetCtx.facultyCtx.faculty.name,
          institutionName: targetCtx.facultyCtx.institution.name,
          targetMode: input.targetMode,
          careerCode: targetCtx.resolvedCareerCode,
          careerName: targetCtx.existingCareer?.name || input.careerName || '',
          careerId: targetCtx.existingCareer?.id || null,
          planId: targetCtx.existingPlan?.id || null,
          planStatus: targetCtx.existingPlan?.status || 'draft',
        },
        sharedSubjectSuggestions: [],
        draftDiff: null,
        normalizedPlan: null,
      };
    }

    const errors = [...parseResult.errors];
    const warnings = [...parseResult.warnings];
    const parsedData = parseResult.data;

    const decisionByCode = await validateSharedDecisions(
      store,
      input.facultyId,
      decisions,
      parsedData,
      errors
    );

    // Suggestions lookup inside same faculty ONLY (never auto-linked on new imports;
    // existing cross-plan links in a draft are surfaced as pre-selected unless overridden)
    const normalizedNames = parsedData.subjects.map((s) => normalizeSharedSubjectName(s.name));
    const [candidatesByNorm, existingDraftLinks] = await Promise.all([
      store.findSharedSubjectSuggestions(input.facultyId, normalizedNames),
      targetCtx.existingPlan
        ? store.listDraftCrossPlanSharedLinks(targetCtx.existingPlan.id)
        : Promise.resolve(new Map<number, SharedSubjectCandidateDTO>()),
    ]);

    const sharedSubjectSuggestions = parsedData.subjects.map((sub) => {
      const normName = normalizeSharedSubjectName(sub.name);
      const baseCandidates = candidatesByNorm.get(normName) || [];
      const preservedLink = existingDraftLinks.get(sub.codeInPlan) ?? null;
      const candidates =
        preservedLink &&
        !baseCandidates.some((c) => c.sharedSubjectId === preservedLink.sharedSubjectId)
          ? [preservedLink, ...baseCandidates]
          : [...baseCandidates];
      const explicitDecision =
        decisionByCode.get(sub.codeInPlan) ??
        (preservedLink
          ? {
              subjectCode: sub.codeInPlan,
              action: 'link_existing' as const,
              sharedSubjectId: preservedLink.sharedSubjectId,
            }
          : null);
      return {
        subjectCode: sub.codeInPlan,
        displayCode: sub.displayCode,
        subjectName: sub.name,
        normalizedName: normName,
        candidates,
        selectedDecision: explicitDecision,
      };
    });

    // Draft diff when re-uploading on an existing draft plan
    let draftDiff: {
      toCreateCodes: number[];
      toUpdateCodes: number[];
      toRemoveCodes: number[];
      blockedRemovalCodes: number[];
    } | null = null;

    if (targetCtx.existingPlan) {
      const existingSubs = await store.listSubjectsByPlan(targetCtx.existingPlan.id);
      const existingByCode = new Map(existingSubs.map((s) => [s.codeInPlan, s]));
      const incomingCodes = new Set(parsedData.subjects.map((s) => s.codeInPlan));

      const toCreateCodes = parsedData.subjects
        .filter((s) => !existingByCode.has(s.codeInPlan))
        .map((s) => s.codeInPlan);
      const toUpdateCodes = parsedData.subjects
        .filter((s) => existingByCode.has(s.codeInPlan))
        .map((s) => s.codeInPlan);
      const toRemoveSubs = existingSubs.filter((s) => !incomingCodes.has(s.codeInPlan));
      const toRemoveCodes = toRemoveSubs.map((s) => s.codeInPlan);
      let blockedRemovalCodes: number[] = [];

      if (toRemoveSubs.length > 0) {
        const refs = await store.checkPlanAndSubjectReferences(
          targetCtx.existingPlan.id,
          toRemoveSubs.map((s) => s.id)
        );
        blockedRemovalCodes = toRemoveSubs
          .filter((s) => (refs.subjectLevelReferences.get(s.id) ?? 0) > 0)
          .map((s) => s.codeInPlan);

        if (blockedRemovalCodes.length > 0) {
          errors.push({
            sheet: 'Materias',
            row: 0,
            message: `No se pueden eliminar las materias ${blockedRemovalCodes.join(', ')} porque ya tienen referencias activas (Biblioteca, cursadas, reseñas u horarios).`,
          });
        }
      }

      draftDiff = {
        toCreateCodes,
        toUpdateCodes,
        toRemoveCodes,
        blockedRemovalCodes,
      };
    }

    const previewPayload = formatPlanCatalogPayload({
      plan: {
        id: targetCtx.existingPlan?.id || '00000000-0000-0000-0000-000000000000',
        name: parsedData.plan.name,
        year: parsedData.plan.year,
        config: buildPlanConfigObject(parsedData, targetCtx.resolvedCareerCode),
        updatedAt: new Date().toISOString(),
      },
      career: {
        id: targetCtx.existingCareer?.id || '00000000-0000-0000-0000-000000000000',
        name: targetCtx.existingCareer?.name || input.careerName || '',
        code: targetCtx.resolvedCareerCode,
        facultyId: targetCtx.facultyCtx.faculty.id,
      },
      faculty: {
        id: targetCtx.facultyCtx.faculty.id,
        name: targetCtx.facultyCtx.faculty.name,
        code: targetCtx.facultyCtx.faculty.code,
      },
      institution: {
        id: targetCtx.facultyCtx.institution.id,
        name: targetCtx.facultyCtx.institution.name,
        code: targetCtx.facultyCtx.institution.code,
      },
      subjects: parsedData.subjects.map((s) => ({
        id: `preview-${s.codeInPlan}`,
        codeInPlan: s.codeInPlan,
        displayCode: s.displayCode,
        name: s.name,
        shortName: s.shortName,
        level: s.level,
        modality: s.modality,
        contraCuatrimestral: s.contraCuatrimestral,
        weeklyHours: s.weeklyHours,
        kind: s.kind,
        credits: s.credits,
        isOptionalTrack: s.isOptionalTrack,
        trackKey: s.trackKey,
        isIntegrator: s.isIntegrator,
      })),
      prerequisites: parsedData.prerequisites.map((p) => ({
        subjectId: `preview-${p.subjectCode}`,
        requiresSubjectId: `preview-${p.requiresSubjectCode}`,
        type: p.type,
      })),
      rules: parsedData.specialRules.map((r, i) => ({
        id: `preview-rule-${i}`,
        subjectId: `preview-${r.subjectCode}`,
        ruleType: r.ruleType,
        params: r.params,
        description: r.description,
      })),
      acronyms: parsedData.acronyms.map((a) => ({
        acronym: a.acronym,
        subjectId: `preview-${a.subjectCode}`,
      })),
    });

    return {
      valid: errors.length === 0,
      previewHash,
      fileSha256,
      errors,
      warnings,
      stats: parseResult.stats,
      targetSummary: {
        facultyId: targetCtx.facultyCtx.faculty.id,
        facultyName: targetCtx.facultyCtx.faculty.name,
        institutionName: targetCtx.facultyCtx.institution.name,
        targetMode: input.targetMode,
        careerCode: targetCtx.resolvedCareerCode,
        careerName: targetCtx.existingCareer?.name || input.careerName || '',
        careerId: targetCtx.existingCareer?.id || null,
        planId: targetCtx.existingPlan?.id || null,
        planStatus: targetCtx.existingPlan?.status || 'draft',
      },
      sharedSubjectSuggestions,
      draftDiff,
      normalizedPlan: previewPayload,
    };
  });
}

export async function confirmPlanImport(params: {
  input: PlanImportRequestInput;
  adminUserId: string;
  adminEmail: string;
  ip: string | null;
}) {
  const { input, adminUserId, adminEmail, ip } = params;
  if (!input.previewHash) {
    throw new PlanImportServiceError(
      400,
      'PREVIEW_HASH_REQUIRED',
      'previewHash es obligatorio para confirmar la importación del plan.'
    );
  }

  const fileBuffer = decodeBase64Workbook(input.fileBase64);
  const decisions = input.sharedSubjectDecisions || [];
  const store = getPlanImportStore();

  return withPlanImportLock(async () => {
    const expectedHash = computePlanImportPreviewHash({
      fileBuffer,
      facultyId: input.facultyId,
      targetMode: input.targetMode,
      careerId: input.careerId,
      careerName: input.careerName,
      careerCode: input.careerCode,
      planId: input.planId,
      sharedSubjectDecisions: decisions,
    });

    if (expectedHash.toLowerCase() !== input.previewHash!.toLowerCase()) {
      throw new PlanImportServiceError(
        409,
        'PREVIEW_HASH_MISMATCH',
        'El archivo .xlsx o las decisiones cambiaron respecto a la vista previa. Generá un nuevo preview antes de confirmar.'
      );
    }

    const parseResult = await parsePlanWorkbookBuffer({
      fileName: input.fileName,
      buffer: fileBuffer,
      lockAlreadyHeld: true,
    });

    if (!parseResult.valid || !parseResult.data) {
      throw new PlanImportServiceError(
        422,
        'PLAN_VALIDATION_FAILED',
        'El archivo contiene errores de validación y no puede importarse.',
        { errors: parseResult.errors }
      );
    }

    const parsedData = parseResult.data;
    const fileSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    return store.runInTransaction(async (tx) => {
      const targetCtx = await resolveTargetContext(tx, input, parsedData.plan);

      const validationErrors: PlanImportIssue[] = [];
      const decisionByCode = await validateSharedDecisions(
        tx,
        input.facultyId,
        decisions,
        parsedData,
        validationErrors
      );
      if (validationErrors.length > 0) {
        throw new PlanImportServiceError(
          400,
          'INVALID_SHARED_SUBJECT_DECISIONS',
          validationErrors[0].message,
          { errors: validationErrors }
        );
      }

      const career =
        targetCtx.existingCareer ||
        (await tx.createCareer({
          facultyId: input.facultyId,
          name: input.careerName!,
          code: input.careerCode!,
          status: 'draft',
        }));

      const planConfig = buildPlanConfigObject(parsedData, career.code);
      const plan = targetCtx.existingPlan
        ? await tx.updateStudyPlan(targetCtx.existingPlan.id, {
            name: parsedData.plan.name,
            year: parsedData.plan.year,
            config: planConfig,
          })
        : await tx.createStudyPlan({
            careerId: career.id,
            name: parsedData.plan.name,
            year: parsedData.plan.year,
            status: 'draft',
            isActive: true,
            config: planConfig,
          });

      const existingSubjects = targetCtx.existingPlan ? await tx.listSubjectsByPlan(plan.id) : [];
      const existingByCode = new Map(existingSubjects.map((s) => [s.codeInPlan, s]));
      const incomingCodeSet = new Set(parsedData.subjects.map((s) => s.codeInPlan));

      const toRemoveSubs = existingSubjects.filter((s) => !incomingCodeSet.has(s.codeInPlan));
      if (toRemoveSubs.length > 0) {
        const refs = await tx.checkPlanAndSubjectReferences(
          plan.id,
          toRemoveSubs.map((s) => s.id)
        );
        const blocked = toRemoveSubs.filter((s) => (refs.subjectLevelReferences.get(s.id) ?? 0) > 0);
        if (blocked.length > 0) {
          throw new PlanImportServiceError(
            409,
            'DRAFT_SUBJECT_REMOVAL_BLOCKED',
            `No se pueden eliminar materias existentes con referencias activas: ${blocked.map((b) => b.codeInPlan).join(', ')}.`
          );
        }
        await tx.deleteSubjectsByIds(toRemoveSubs.map((s) => s.id));
      }

      let linkedExistingCount = 0;
      let createdSharedCount = 0;
      const codeToSubjectId = new Map<number, string>();

      for (const sub of parsedData.subjects) {
        const existingSub = existingByCode.get(sub.codeInPlan);
        const decision = decisionByCode.get(sub.codeInPlan);
        const normName = normalizeSharedSubjectName(sub.name);

        let sharedSubjectId: string;
        if (decision?.action === 'link_existing' && decision.sharedSubjectId) {
          sharedSubjectId = decision.sharedSubjectId;
          linkedExistingCount += 1;
        } else if (
          existingSub?.sharedSubjectId &&
          decision?.action !== 'create_new'
        ) {
          sharedSubjectId = existingSub.sharedSubjectId;
          await tx.updateSharedSubjectIfExclusive(sharedSubjectId, plan.id, {
            normalizedName: normName,
            displayName: sub.name,
          });
        } else {
          const baseStableCode = `${career.code.toUpperCase()}-${plan.year}-${sub.codeInPlan}`;
          let candidateStableCode = baseStableCode;
          const collision = await tx.findSharedSubjectByFacultyAndStableCode(
            input.facultyId,
            candidateStableCode
          );
          if (collision) {
            if (existingSub?.sharedSubjectId === collision.id && decision?.action !== 'create_new') {
              sharedSubjectId = collision.id;
            } else {
              candidateStableCode = `${baseStableCode}-${crypto.randomBytes(3).toString('hex')}`;
              const created = await tx.createSharedSubject({
                facultyId: input.facultyId,
                stableCode: candidateStableCode,
                normalizedName: normName,
                displayName: sub.name,
              });
              sharedSubjectId = created.id;
              createdSharedCount += 1;
            }
          } else {
            const created = await tx.createSharedSubject({
              facultyId: input.facultyId,
              stableCode: candidateStableCode,
              normalizedName: normName,
              displayName: sub.name,
            });
            sharedSubjectId = created.id;
            createdSharedCount += 1;
          }
        }

        const subPayload = {
          sharedSubjectId,
          displayCode: sub.displayCode,
          name: sub.name,
          shortName: sub.shortName,
          level: sub.level,
          modality: sub.modality,
          contraCuatrimestral: sub.contraCuatrimestral,
          weeklyHours: String(sub.weeklyHours),
          kind: sub.kind,
          credits: sub.credits,
          isOptionalTrack: sub.isOptionalTrack,
          trackKey: sub.trackKey,
          isIntegrator: sub.isIntegrator,
        };

        const persisted = existingSub
          ? await tx.updateSubject(existingSub.id, subPayload)
          : await tx.insertSubject({
              planId: plan.id,
              codeInPlan: sub.codeInPlan,
              ...subPayload,
            });

        codeToSubjectId.set(sub.codeInPlan, persisted.id);
      }

      const allFinalSubjectIds = Array.from(codeToSubjectId.values());

      await tx.replacePlanPrerequisites(
        plan.id,
        allFinalSubjectIds,
        parsedData.prerequisites.map((p) => ({
          subjectId: codeToSubjectId.get(p.subjectCode)!,
          requiresSubjectId: codeToSubjectId.get(p.requiresSubjectCode)!,
          type: p.type,
        }))
      );

      await tx.replacePlanSpecialRules(
        plan.id,
        parsedData.specialRules.map((r) => ({
          subjectId: codeToSubjectId.get(r.subjectCode)!,
          ruleType: r.ruleType,
          params: r.params,
          description: r.description,
        }))
      );

      await tx.replacePlanAcronyms(
        plan.id,
        parsedData.acronyms.map((a) => ({
          acronym: a.acronym,
          subjectId: codeToSubjectId.get(a.subjectCode)!,
        }))
      );

      await tx.recordAudit({
        adminUserId,
        adminEmail,
        action: targetCtx.existingPlan ? 'plan.import.update_draft' : 'plan.import.create_draft',
        targetType: 'study_plan',
        targetId: plan.id,
        details: {
          previewHash: expectedHash,
          fileSha256,
          fileName: input.fileName,
          targetMode: input.targetMode,
          facultyId: input.facultyId,
          careerId: career.id,
          careerCode: career.code,
          planId: plan.id,
          planName: plan.name,
          planYear: plan.year,
          planStatus: plan.status,
          subjectsCount: parsedData.subjects.length,
          prerequisitesCount: parsedData.prerequisites.length,
          specialRulesCount: parsedData.specialRules.length,
          acronymsCount: parsedData.acronyms.length,
          linkedExistingCount,
          createdSharedCount,
        },
        ip,
      });

      return {
        planId: plan.id,
        careerId: career.id,
        careerCode: career.code,
        status: plan.status,
        previewHash: expectedHash,
        fileSha256,
        counts: {
          subjects: parsedData.subjects.length,
          prerequisites: parsedData.prerequisites.length,
          specialRules: parsedData.specialRules.length,
          acronyms: parsedData.acronyms.length,
          linkedExistingShared: linkedExistingCount,
          createdNewShared: createdSharedCount,
        },
      };
    });
  });
}

export async function listAdminPlansOverview() {
  return getPlanImportStore().listEnrichedAdminPlans();
}

export async function getAdminPlanDetail(planId: string) {
  if (!isValidUuid(planId)) {
    throw new PlanImportServiceError(404, 'PLAN_NOT_FOUND', 'Plan de estudio no encontrado.');
  }
  const bundle = await getPlanImportStore().getPlanDetailArtifacts(planId);
  if (!bundle) {
    throw new PlanImportServiceError(404, 'PLAN_NOT_FOUND', 'Plan de estudio no encontrado.');
  }

  const catalogPayload = formatPlanCatalogPayload({
    plan: bundle.plan,
    career: bundle.career,
    faculty: bundle.faculty,
    institution: bundle.institution,
    subjects: bundle.subjects,
    prerequisites: bundle.prerequisites,
    rules: bundle.rules,
    acronyms: bundle.acronyms,
  });

  const sharedSubjectBindings = bundle.subjects.map((sub) => {
    const sh = sub.sharedSubjectId ? bundle.sharedSubjectsById.get(sub.sharedSubjectId) : undefined;
    return {
      subjectId: sub.id,
      codeInPlan: sub.codeInPlan,
      displayCode: sub.displayCode ?? null,
      sharedSubjectId: sub.sharedSubjectId,
      stableCode: sh?.stableCode ?? null,
      sharedDisplayName: sh?.displayName ?? null,
      linkedPlansCount: sh?.linkedPlansCount ?? 0,
    };
  });

  return {
    ...catalogPayload,
    adminMeta: {
      planStatus: bundle.plan.status,
      isActive: bundle.plan.isActive,
      careerStatus: bundle.career.status,
      facultyId: bundle.faculty.id,
      facultyName: bundle.faculty.name,
      institutionName: bundle.institution.name,
      activeUsersCount: bundle.activeUsersCount,
      createdAt: bundle.plan.createdAt,
      updatedAt: bundle.plan.updatedAt,
      sharedSubjectBindings,
    },
  };
}

export async function deleteAdminDraftPlan(params: {
  planId: string;
  adminUserId: string;
  adminEmail: string;
  ip: string | null;
}) {
  const { planId, adminUserId, adminEmail, ip } = params;
  if (!isValidUuid(planId)) {
    throw new PlanImportServiceError(404, 'PLAN_NOT_FOUND', 'Plan de estudio no encontrado.');
  }

  const store = getPlanImportStore();
  return store.runInTransaction(async (tx) => {
    const plan = await tx.findPlanById(planId);
    if (!plan) {
      throw new PlanImportServiceError(404, 'PLAN_NOT_FOUND', 'Plan de estudio no encontrado.');
    }
    if (plan.status !== 'draft') {
      throw new PlanImportServiceError(
        409,
        'ONLY_DRAFT_PLAN_DELETABLE',
        `Solo se pueden eliminar planes en estado "draft". Este plan se encuentra en estado "${plan.status}".`
      );
    }

    const planSubs = await tx.listSubjectsByPlan(planId);
    const subjectIds = planSubs.map((s) => s.id);
    const refs = await tx.checkPlanAndSubjectReferences(planId, subjectIds);

    if (refs.totalBlockers > 0) {
      throw new PlanImportServiceError(
        409,
        'PLAN_DELETE_HAS_REFERENCES',
        'No se puede eliminar el borrador porque existen usuarios o registros asociados (Biblioteca, progreso, cursadas, reseñas u horarios).',
        {
          totalBlockers: refs.totalBlockers,
          planLevelReferences: refs.planLevelReferences,
          referencedSubjectIds: Array.from(refs.subjectLevelReferences.keys()),
        }
      );
    }

    const candidateOrphanSharedIds = Array.from(
      new Set(planSubs.map((s) => s.sharedSubjectId).filter((id): id is string => Boolean(id)))
    );

    await tx.deleteDraftPlanCascade(planId, candidateOrphanSharedIds);

    await tx.recordAudit({
      adminUserId,
      adminEmail,
      action: 'plan.delete.draft',
      targetType: 'study_plan',
      targetId: planId,
      details: {
        planId,
        planName: plan.name,
        planYear: plan.year,
        deletedSubjectsCount: planSubs.length,
      },
      ip,
    });

    return {
      deletedPlanId: planId,
      planName: plan.name,
      deletedSubjectsCount: planSubs.length,
    };
  });
}
