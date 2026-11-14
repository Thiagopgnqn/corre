import crypto from 'crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  acronyms,
  careers,
  faculties,
  institutions,
  planSpecialRules,
  studyPlans,
  subjectPrerequisites,
  subjects,
} from '../../db/schema.js';
import { getCatalogVersion } from '../admin/admin.service.js';
import {
  findDefaultPublishedPlan,
  findPublishedPlanById,
  isValidUuid,
  type PublishedPlanWithCareer,
} from './catalog.helpers.js';
import type { CatalogRuleInput, CatalogSubjectInput } from './planConfig.helpers.js';

export interface CatalogTreeInstitutionRow {
  id: string;
  name: string;
  code: string;
}

export interface CatalogTreeFacultyRow {
  id: string;
  institutionId: string;
  name: string;
  code: string;
}

export interface CatalogTreeCareerRow {
  id: string;
  facultyId: string;
  name: string;
  code: string;
  status: string;
}

export interface CatalogTreePlanRow {
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

export interface PlanArtifactsBundle {
  subjects: CatalogSubjectInput[];
  prerequisites: Array<{ subjectId: string; requiresSubjectId: string; type: string }>;
  rules: CatalogRuleInput[];
  acronyms: Array<{ acronym: string; subjectId: string }>;
}

export interface CatalogStore {
  getPublishedTreeSources(): Promise<{
    institutions: CatalogTreeInstitutionRow[];
    faculties: CatalogTreeFacultyRow[];
    careers: CatalogTreeCareerRow[];
    plans: CatalogTreePlanRow[];
  }>;
  resolvePublishedPlan(planId: string): Promise<PublishedPlanWithCareer | null>;
  getPlanArtifacts(planUuid: string): Promise<PlanArtifactsBundle>;
  getCatalogVersion(): Promise<string>;
}

export class DrizzleCatalogStore implements CatalogStore {
  async getPublishedTreeSources() {
    const [allInstitutions, allFaculties, publishedCareers, activePlans] = await Promise.all([
      db.select().from(institutions),
      db.select().from(faculties),
      db.select().from(careers).where(eq(careers.status, 'published')),
      db
        .select()
        .from(studyPlans)
        .where(and(eq(studyPlans.isActive, true), eq(studyPlans.status, 'published'))),
    ]);

    return {
      institutions: allInstitutions,
      faculties: allFaculties,
      careers: publishedCareers,
      plans: activePlans,
    };
  }

  async resolvePublishedPlan(planId: string): Promise<PublishedPlanWithCareer | null> {
    if (planId === 'current' || planId === 'default') {
      return findDefaultPublishedPlan();
    }
    return findPublishedPlanById(planId);
  }

  async getPlanArtifacts(planUuid: string): Promise<PlanArtifactsBundle> {
    const planSubjects = await db
      .select()
      .from(subjects)
      .where(eq(subjects.planId, planUuid))
      .orderBy(asc(subjects.level), asc(subjects.codeInPlan));

    const subIds = planSubjects.map((s) => s.id);
    const prerequisites =
      subIds.length > 0
        ? await db
            .select({
              subjectId: subjectPrerequisites.subjectId,
              requiresSubjectId: subjectPrerequisites.requiresSubjectId,
              type: subjectPrerequisites.type,
            })
            .from(subjectPrerequisites)
            .where(inArray(subjectPrerequisites.subjectId, subIds))
        : [];

    const [rules, acronymList] = await Promise.all([
      db.select().from(planSpecialRules).where(eq(planSpecialRules.planId, planUuid)),
      db.select().from(acronyms).where(eq(acronyms.planId, planUuid)),
    ]);

    return {
      subjects: planSubjects,
      prerequisites,
      rules,
      acronyms: acronymList,
    };
  }

  async getCatalogVersion(): Promise<string> {
    return getCatalogVersion();
  }
}

export class InMemoryCatalogStore implements CatalogStore {
  institutions: CatalogTreeInstitutionRow[] = [];
  faculties: CatalogTreeFacultyRow[] = [];
  careers: CatalogTreeCareerRow[] = [];
  plans: CatalogTreePlanRow[] = [];
  subjectsByPlan = new Map<string, CatalogSubjectInput[]>();
  prereqsByPlan = new Map<string, Array<{ subjectId: string; requiresSubjectId: string; type: string }>>();
  rulesByPlan = new Map<string, CatalogRuleInput[]>();
  acronymsByPlan = new Map<string, Array<{ acronym: string; subjectId: string }>>();
  catalogVersion = 'v1-test';

  seedPlanFromCatalogJson(
    catalog: {
      institution: { name: string; code: string };
      faculty: { name: string; code: string };
      career: { name: string; code: string };
      studyPlan: {
        name: string;
        year: number;
        isActive?: boolean;
        config: Record<string, unknown>;
      };
      specialRules?: Array<{
        subjectCode: number;
        ruleType: string;
        params?: Record<string, unknown>;
        description: string;
      }>;
      acronyms?: Array<{ acronym: string; subjectCode: number }>;
      subjects: Array<{
        codeInPlan: number;
        name: string;
        shortName: string;
        level: number;
        modality: string;
        contraCuatrimestral: boolean;
        weeklyHours: number;
        kind: string;
        credits?: number | null;
        isOptionalTrack?: boolean;
        trackKey?: string | null;
        isIntegrator?: boolean;
        regularPrereqs?: number[];
        approvedPrereqs?: number[];
      }>;
    },
    options?: {
      careerStatus?: 'draft' | 'published' | 'archived';
      planStatus?: 'draft' | 'published' | 'archived';
      isActive?: boolean;
      createdAt?: Date;
    }
  ): { institutionId: string; facultyId: string; careerId: string; planId: string } {
    let inst = this.institutions.find((i) => i.code === catalog.institution.code);
    if (!inst) {
      inst = { id: crypto.randomUUID(), name: catalog.institution.name, code: catalog.institution.code };
      this.institutions.push(inst);
    }

    let fac = this.faculties.find(
      (f) => f.institutionId === inst!.id && f.code === catalog.faculty.code
    );
    if (!fac) {
      fac = {
        id: crypto.randomUUID(),
        institutionId: inst.id,
        name: catalog.faculty.name,
        code: catalog.faculty.code,
      };
      this.faculties.push(fac);
    }

    const careerStatus = options?.careerStatus ?? 'published';
    let car = this.careers.find((c) => c.facultyId === fac!.id && c.code === catalog.career.code);
    if (!car) {
      car = {
        id: crypto.randomUUID(),
        facultyId: fac.id,
        name: catalog.career.name,
        code: catalog.career.code,
        status: careerStatus,
      };
      this.careers.push(car);
    } else if (options?.careerStatus) {
      car.status = options.careerStatus;
    }

    const planId = crypto.randomUUID();
    const now = options?.createdAt ?? new Date();
    const plan: CatalogTreePlanRow = {
      id: planId,
      careerId: car.id,
      name: catalog.studyPlan.name,
      year: catalog.studyPlan.year,
      isActive: options?.isActive ?? catalog.studyPlan.isActive ?? true,
      status: options?.planStatus ?? 'published',
      config: { ...catalog.studyPlan.config },
      createdAt: now,
      updatedAt: now,
    };
    this.plans.push(plan);

    const codeToUuid = new Map<number, string>();
    const planSubjects: CatalogSubjectInput[] = catalog.subjects.map((s) => {
      const uuid = crypto.randomUUID();
      codeToUuid.set(s.codeInPlan, uuid);
      return {
        id: uuid,
        codeInPlan: s.codeInPlan,
        name: s.name,
        shortName: s.shortName,
        level: s.level,
        modality: s.modality,
        contraCuatrimestral: Boolean(s.contraCuatrimestral),
        weeklyHours: s.weeklyHours,
        kind: s.kind,
        credits: s.credits ?? null,
        isOptionalTrack: Boolean(s.isOptionalTrack),
        trackKey: s.trackKey ?? null,
        isIntegrator: Boolean(s.isIntegrator),
      };
    });

    const prereqs: Array<{ subjectId: string; requiresSubjectId: string; type: string }> = [];
    for (const s of catalog.subjects) {
      const subjectId = codeToUuid.get(s.codeInPlan)!;
      for (const reqCode of s.regularPrereqs || []) {
        const reqUuid = codeToUuid.get(reqCode);
        if (reqUuid) prereqs.push({ subjectId, requiresSubjectId: reqUuid, type: 'regular' });
      }
      for (const reqCode of s.approvedPrereqs || []) {
        const reqUuid = codeToUuid.get(reqCode);
        if (reqUuid) prereqs.push({ subjectId, requiresSubjectId: reqUuid, type: 'aprobada' });
      }
    }

    const rules: CatalogRuleInput[] = (catalog.specialRules || [])
      .map((r): CatalogRuleInput | null => {
        const subjectId = codeToUuid.get(r.subjectCode);
        if (!subjectId) return null;
        return {
          id: crypto.randomUUID(),
          subjectId,
          ruleType: r.ruleType,
          params: r.params || {},
          description: r.description,
        };
      })
      .filter((r): r is CatalogRuleInput => r !== null);

    const acronymList = (catalog.acronyms || [])
      .map((a) => {
        const subjectId = codeToUuid.get(a.subjectCode);
        if (!subjectId) return null;
        return { acronym: a.acronym, subjectId };
      })
      .filter((a): a is { acronym: string; subjectId: string } => a !== null);

    this.subjectsByPlan.set(planId, planSubjects);
    this.prereqsByPlan.set(planId, prereqs);
    this.rulesByPlan.set(planId, rules);
    this.acronymsByPlan.set(planId, acronymList);

    return { institutionId: inst.id, facultyId: fac.id, careerId: car.id, planId };
  }

  async getPublishedTreeSources() {
    return {
      institutions: [...this.institutions],
      faculties: [...this.faculties],
      careers: this.careers.filter((c) => c.status === 'published'),
      plans: this.plans.filter((p) => p.isActive && p.status === 'published'),
    };
  }

  async resolvePublishedPlan(planId: string): Promise<PublishedPlanWithCareer | null> {
    const withOrgMeta = (row: { plan: CatalogTreePlanRow; career: CatalogTreeCareerRow }) => {
      const faculty = this.faculties.find((f) => f.id === row.career.facultyId);
      const institution = faculty
        ? this.institutions.find((i) => i.id === faculty.institutionId)
        : undefined;
      return {
        plan: row.plan,
        career: row.career,
        faculty,
        institution,
      } as unknown as PublishedPlanWithCareer;
    };

    if (planId === 'current' || planId === 'default') {
      const candidates = this.plans
        .map((plan) => ({
          plan,
          career: this.careers.find((c) => c.id === plan.careerId),
        }))
        .filter(
          (row): row is { plan: CatalogTreePlanRow; career: CatalogTreeCareerRow } =>
            Boolean(row.career) &&
            row.plan.status === 'published' &&
            row.plan.isActive === true &&
            row.career!.status === 'published'
        )
        .sort((a, b) => new Date(a.plan.createdAt).getTime() - new Date(b.plan.createdAt).getTime());

      if (candidates.length === 0) return null;
      const canonicalIsi = candidates.find(
        (r) => r.career.code === 'ISI' && r.plan.year === 2023
      );
      const picked = canonicalIsi || candidates[0];
      return withOrgMeta(picked);
    }

    if (!isValidUuid(planId)) return null;
    const plan = this.plans.find(
      (p) => p.id === planId.trim() && p.status === 'published' && p.isActive === true
    );
    if (!plan) return null;
    const career = this.careers.find((c) => c.id === plan.careerId && c.status === 'published');
    if (!career) return null;

    return withOrgMeta({ plan, career });
  }

  async getPlanArtifacts(planUuid: string): Promise<PlanArtifactsBundle> {
    const rawSubjects = this.subjectsByPlan.get(planUuid) || [];
    const sortedSubjects = [...rawSubjects].sort((a, b) =>
      a.level !== b.level ? a.level - b.level : a.codeInPlan - b.codeInPlan
    );

    return {
      subjects: sortedSubjects,
      prerequisites: [...(this.prereqsByPlan.get(planUuid) || [])],
      rules: [...(this.rulesByPlan.get(planUuid) || [])],
      acronyms: [...(this.acronymsByPlan.get(planUuid) || [])],
    };
  }

  async getCatalogVersion(): Promise<string> {
    return this.catalogVersion;
  }
}

export const defaultCatalogStore = new DrizzleCatalogStore();
let activeCatalogStore: CatalogStore = defaultCatalogStore;

export function getCatalogStore(): CatalogStore {
  return activeCatalogStore;
}

export function setCatalogStoreForTesting(store: CatalogStore | null): void {
  activeCatalogStore = store || defaultCatalogStore;
}
