import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { careers, faculties, institutions, studyPlans } from '../../db/schema.js';

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

export function normalizeSharedSubjectName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface PublishedPlanWithCareer {
  plan: typeof studyPlans.$inferSelect;
  career: typeof careers.$inferSelect;
  faculty?: typeof faculties.$inferSelect;
  institution?: typeof institutions.$inferSelect;
}

export async function findPublishedPlanById(
  planId: string
): Promise<PublishedPlanWithCareer | null> {
  if (!isValidUuid(planId)) return null;

  const [row] = await db
    .select({
      plan: studyPlans,
      career: careers,
      faculty: faculties,
      institution: institutions,
    })
    .from(studyPlans)
    .innerJoin(careers, eq(studyPlans.careerId, careers.id))
    .innerJoin(faculties, eq(careers.facultyId, faculties.id))
    .innerJoin(institutions, eq(faculties.institutionId, institutions.id))
    .where(
      and(
        eq(studyPlans.id, planId.trim()),
        eq(studyPlans.status, 'published'),
        eq(studyPlans.isActive, true),
        eq(careers.status, 'published')
      )
    )
    .limit(1);

  return row || null;
}

export async function findDefaultPublishedPlan(): Promise<PublishedPlanWithCareer | null> {
  const rows = await db
    .select({
      plan: studyPlans,
      career: careers,
      faculty: faculties,
      institution: institutions,
    })
    .from(studyPlans)
    .innerJoin(careers, eq(studyPlans.careerId, careers.id))
    .innerJoin(faculties, eq(careers.facultyId, faculties.id))
    .innerJoin(institutions, eq(faculties.institutionId, institutions.id))
    .where(
      and(
        eq(studyPlans.status, 'published'),
        eq(studyPlans.isActive, true),
        eq(careers.status, 'published')
      )
    )
    .orderBy(asc(studyPlans.createdAt));

  if (rows.length === 0) return null;

  const canonicalIsi = rows.find(
    (r) => r.career.code === 'ISI' && r.plan.year === 2023
  );
  return canonicalIsi || rows[0];
}
