import { Request, Response } from 'express';
import crypto from 'crypto';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  subjects,
  scheduleTerms,
  courseGroups,
  commissions,
  commissionProfessors,
  commissionSlots,
  reservedElectiveSlots,
  electiveOfferings,
  electiveOfferingProfessors,
  users,
} from '../../db/schema.js';
import { getCatalogVersion } from '../admin/admin.service.js';
import { invalidateUserStatusCache } from '../../middlewares/auth.middleware.js';
import {
  findDefaultPublishedPlan,
  findPublishedPlanById,
} from './catalog.helpers.js';
import { getCatalogStore } from './catalog.store.js';
import {
  formatPlanCatalogPayload,
  sanitizeSummaryPlanConfig,
} from './planConfig.helpers.js';

const DAY_REVERSE: Record<number, 'LUN' | 'MAR' | 'MIE' | 'JUE' | 'VIE' | 'SAB'> = {
  1: 'LUN',
  2: 'MAR',
  3: 'MIE',
  4: 'JUE',
  5: 'VIE',
  6: 'SAB',
};

const TURNO_REVERSE: Record<string, 'mañana' | 'tarde' | 'noche'> = {
  M: 'mañana',
  T: 'tarde',
  N: 'noche',
};

export async function getCareers(req: Request, res: Response): Promise<void> {
  try {
    const store = getCatalogStore();
    const {
      institutions: allInstitutions,
      faculties: allFaculties,
      careers: publishedCareers,
      plans: activePlans,
    } = await store.getPublishedTreeSources();

    const tree = allInstitutions
      .map((inst) => ({
        id: inst.id,
        name: inst.name,
        code: inst.code,
        faculties: allFaculties
          .filter((f) => f.institutionId === inst.id)
          .map((fac) => ({
            id: fac.id,
            name: fac.name,
            code: fac.code,
            careers: publishedCareers
              .filter((c) => c.facultyId === fac.id)
              .map((car) => ({
                id: car.id,
                name: car.name,
                code: car.code,
                plans: activePlans
                  .filter((p) => p.careerId === car.id)
                  .map((p) => ({
                    id: p.id,
                    name: p.name,
                    year: p.year,
                    config: sanitizeSummaryPlanConfig(p.config, {
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

    res.json({
      success: true,
      data: tree,
    });
  } catch (error) {
    console.error('Error in getCareers:', error);
    res.status(500).json({ success: false, error: 'Error al obtener carreras' });
  }
}

export async function getPlan(req: Request, res: Response): Promise<void> {
  const planId = String(req.params.planId);

  try {
    const store = getCatalogStore();
    const resolved = await store.resolvePublishedPlan(planId);

    if (!resolved) {
      res.status(404).json({ success: false, error: 'Plan de estudio no encontrado' });
      return;
    }

    const { plan, career } = resolved;
    const artifacts = await store.getPlanArtifacts(plan.id);
    const responseData = formatPlanCatalogPayload({
      plan,
      career,
      subjects: artifacts.subjects,
      prerequisites: artifacts.prerequisites,
      rules: artifacts.rules,
      acronyms: artifacts.acronyms,
    });

    // Soporte para ETag y caché HTTP dependiente de catalog_versions (Ajuste 10)
    const catalogVer = await store.getCatalogVersion();
    const hash = crypto
      .createHash('sha256')
      .update(catalogVer + ':' + JSON.stringify(responseData))
      .digest('hex');
    const etag = `"${hash}"`;

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('Error fetching plan:', error);
    res.status(500).json({ success: false, error: 'Error al obtener plan de estudio' });
  }
}

export async function getSchedule(req: Request, res: Response): Promise<void> {
  const { planId, year, term } = req.query;

  try {
    // 1. Obtener el plan de estudio publicado (y su carrera/facultad)
    const rawPlanId = planId ? String(planId) : 'current';
    const resolved =
      rawPlanId === 'current' || rawPlanId === 'default'
        ? await findDefaultPublishedPlan()
        : await findPublishedPlanById(rawPlanId);

    if (!resolved) {
      res.status(404).json({ success: false, error: 'Plan de estudio no encontrado' });
      return;
    }

    const { plan, career } = resolved;

    // 2. Obtener el término de horarios (siempre filtrado por facultyId y no borrador)
    const parsedYear = year ? parseInt(String(year), 10) : NaN;
    const hasExplicitYear = !Number.isNaN(parsedYear) && parsedYear > 0;
    const requestedTermStr =
      term && String(term).toUpperCase() === '2C'
        ? '2C'
        : term && String(term).toUpperCase() === '1C'
        ? '1C'
        : null;

    let termRecord;
    if (hasExplicitYear && requestedTermStr) {
      [termRecord] = await db
        .select()
        .from(scheduleTerms)
        .where(
          and(
            eq(scheduleTerms.facultyId, career.facultyId),
            eq(scheduleTerms.academicYear, parsedYear),
            eq(scheduleTerms.term, requestedTermStr),
            eq(scheduleTerms.isDraft, false)
          )
        )
        .limit(1);
    } else if (hasExplicitYear) {
      [termRecord] = await db
        .select()
        .from(scheduleTerms)
        .where(
          and(
            eq(scheduleTerms.facultyId, career.facultyId),
            eq(scheduleTerms.academicYear, parsedYear),
            eq(scheduleTerms.isDraft, false)
          )
        )
        .orderBy(desc(scheduleTerms.isCurrent))
        .limit(1);
    } else if (requestedTermStr) {
      [termRecord] = await db
        .select()
        .from(scheduleTerms)
        .where(
          and(
            eq(scheduleTerms.facultyId, career.facultyId),
            eq(scheduleTerms.term, requestedTermStr),
            eq(scheduleTerms.isDraft, false)
          )
        )
        .orderBy(desc(scheduleTerms.isCurrent), desc(scheduleTerms.academicYear))
        .limit(1);
    }

    // Fallback seguro: período lectivo activo DE LA MISMA FACULTAD (nunca otra facultad ni borrador)
    if (!termRecord) {
      [termRecord] = await db
        .select()
        .from(scheduleTerms)
        .where(
          and(
            eq(scheduleTerms.facultyId, career.facultyId),
            eq(scheduleTerms.isCurrent, true),
            eq(scheduleTerms.isDraft, false)
          )
        )
        .orderBy(desc(scheduleTerms.academicYear))
        .limit(1);
    }

    const fallbackYear = hasExplicitYear ? parsedYear : new Date().getFullYear();
    const termStr = termRecord?.term || requestedTermStr || '1C';

    if (!termRecord) {
      res.json({
        success: true,
        data: {
          schedule: [],
          reservedElectiveSlots: [],
          electiveOfferings: [],
          term: { academicYear: fallbackYear, term: termStr },
        },
      });
      return;
    }

    // 3. Mapeo de materias del plan
    const planSubs = await db
      .select({ id: subjects.id, codeInPlan: subjects.codeInPlan, name: subjects.name })
      .from(subjects)
      .where(eq(subjects.planId, plan.id));

    const uuidToCode = new Map<string, number>();
    const uuidToName = new Map<string, string>();
    planSubs.forEach((s) => {
      uuidToCode.set(s.id, s.codeInPlan);
      uuidToName.set(s.id, s.name);
    });

    // 4. Cargar course groups
    const cGroups = await db
      .select()
      .from(courseGroups)
      .where(eq(courseGroups.scheduleTermId, termRecord.id));
    const courseGroupMap = new Map<string, string>(); // id -> code
    const courseGroupTurnoMap = new Map<string, string>(); // id -> turno
    cGroups.forEach((cg) => {
      courseGroupMap.set(cg.id, cg.code);
      courseGroupTurnoMap.set(cg.id, cg.turno);
    });

    // 5. Cargar comisiones y ofertas del término separando las del plan activo de otros planes
    const allTermComms = await db
      .select()
      .from(commissions)
      .where(eq(commissions.scheduleTermId, termRecord.id));

    const commList = allTermComms.filter((c) => uuidToCode.has(c.subjectId));
    const commIds = commList.map((c) => c.id);

    const allTermOfferings = await db
      .select()
      .from(electiveOfferings)
      .where(eq(electiveOfferings.scheduleTermId, termRecord.id));

    const offList = allTermOfferings.filter((o) => uuidToCode.has(o.subjectId));
    const offIds = offList.map((o) => o.id);

    const planCourseGroupIds = new Set<string>();
    const foreignCourseGroupIds = new Set<string>();
    for (const c of allTermComms) {
      if (!c.courseGroupId) continue;
      if (uuidToCode.has(c.subjectId)) planCourseGroupIds.add(c.courseGroupId);
      else foreignCourseGroupIds.add(c.courseGroupId);
    }
    for (const o of allTermOfferings) {
      if (!o.courseGroupId) continue;
      if (uuidToCode.has(o.subjectId)) planCourseGroupIds.add(o.courseGroupId);
      else foreignCourseGroupIds.add(o.courseGroupId);
    }

    // 6. Cargar profesores y slots estrictamente acotados a commIds del plan
    let allProfs: Array<{
      commissionId: string;
      professorId: string | null;
      professorName: string;
    }> = [];

    if (commIds.length > 0) {
      try {
        allProfs = await db
          .select({
            commissionId: commissionProfessors.commissionId,
            professorId: commissionProfessors.professorId,
            professorName: commissionProfessors.professorName,
          })
          .from(commissionProfessors)
          .where(inArray(commissionProfessors.commissionId, commIds));
      } catch (err: any) {
        if (err?.code === '42703' || err?.code === '42P01') {
          const legacyRows = await db
            .select({
              commissionId: commissionProfessors.commissionId,
              professorName: commissionProfessors.professorName,
            })
            .from(commissionProfessors)
            .where(inArray(commissionProfessors.commissionId, commIds));
          allProfs = legacyRows.map((r) => ({ ...r, professorId: null }));
        } else {
          throw err;
        }
      }
    }

    const allSlots =
      commIds.length > 0
        ? await db
            .select()
            .from(commissionSlots)
            .where(inArray(commissionSlots.commissionId, commIds))
        : [];

    const profMap = new Map<string, string[]>();
    const profRefMap = new Map<string, Array<{ id: string | null; name: string }>>();
    allProfs.forEach((p) => {
      const list = profMap.get(p.commissionId) || [];
      list.push(p.professorName);
      profMap.set(p.commissionId, list);

      const refList = profRefMap.get(p.commissionId) || [];
      refList.push({ id: p.professorId || null, name: p.professorName });
      profRefMap.set(p.commissionId, refList);
    });

    const slotMap = new Map<string, any[]>();
    allSlots.forEach((s) => {
      const list = slotMap.get(s.commissionId) || [];
      list.push({
        day: DAY_REVERSE[s.day] || 'LUN',
        start: s.startTime,
        end: s.endTime,
        room: s.room || undefined,
        mode: s.mode ? s.mode.toLowerCase() : 'presencial',
      });
      slotMap.set(s.commissionId, list);
    });

    // 8. Agrupar comisiones por materia
    const subjectCommissionsMap = new Map<number, any[]>();

    commList.forEach((c) => {
      const subCode = uuidToCode.get(c.subjectId);
      if (!subCode) return;

      const courseCode = c.courseGroupId ? courseGroupMap.get(c.courseGroupId) || c.code : c.code;
      const formattedComm = {
        id: `${subCode}-${c.code}`,
        code: c.code,
        courseCode,
        turno: TURNO_REVERSE[c.turno] || 'mañana',
        professors: profMap.get(c.id) || [],
        professorRefs: profRefMap.get(c.id) || [],
        slots: slotMap.get(c.id) || [],
      };

      const list = subjectCommissionsMap.get(subCode) || [];
      list.push(formattedComm);
      subjectCommissionsMap.set(subCode, list);
    });

    const canonicalSchedule = Array.from(subjectCommissionsMap.entries()).map(([subCode, comms]) => ({
      subjectId: subCode,
      term: comms[0]?.termOffer || termStr,
      commissions: comms,
    }));

    // 9. Cargar franjas reservadas de electivas acotadas a cursos del plan activo
    const resSlotsRaw = await db
      .select()
      .from(reservedElectiveSlots)
      .where(eq(reservedElectiveSlots.scheduleTermId, termRecord.id));

    const resSlots = resSlotsRaw.filter(
      (rs) =>
        planCourseGroupIds.has(rs.courseGroupId) ||
        !foreignCourseGroupIds.has(rs.courseGroupId)
    );

    // Agrupar franjas reservadas por courseGroup + label
    const groupedReservedMap = new Map<string, any>();
    resSlots.forEach((rs) => {
      const cCode = courseGroupMap.get(rs.courseGroupId) || '';
      const turnoRaw = courseGroupTurnoMap.get(rs.courseGroupId) || 'M';
      const key = `${cCode}-${rs.label}`;
      const existing = groupedReservedMap.get(key) || {
        courseCode: cCode,
        term: termStr,
        turno: TURNO_REVERSE[turnoRaw] || 'mañana',
        label: rs.label,
        slots: [],
      };
      existing.slots.push({
        day: DAY_REVERSE[rs.day] || 'LUN',
        start: rs.startTime,
        end: rs.endTime,
      });
      groupedReservedMap.set(key, existing);
    });

    // 10. Cargar electivas con docentes del plan activo
    const offProfRefMap = new Map<string, Array<{ id: string | null; name: string }>>();
    if (offIds.length > 0) {
      try {
        const offProfRows = await db
          .select({
            electiveOfferingId: electiveOfferingProfessors.electiveOfferingId,
            professorId: electiveOfferingProfessors.professorId,
            professorName: electiveOfferingProfessors.professorName,
          })
          .from(electiveOfferingProfessors)
          .where(inArray(electiveOfferingProfessors.electiveOfferingId, offIds));
        offProfRows.forEach((op) => {
          const list = offProfRefMap.get(op.electiveOfferingId) || [];
          list.push({ id: op.professorId || null, name: op.professorName });
          offProfRefMap.set(op.electiveOfferingId, list);
        });
      } catch (err: any) {
        if (err?.code !== '42703' && err?.code !== '42P01') {
          throw err;
        }
      }
    }

    const canonicalOfferings = offList.map((off) => ({
      courseCode: courseGroupMap.get(off.courseGroupId) || '',
      subjectCode: uuidToCode.get(off.subjectId) || 0,
      subjectName: uuidToName.get(off.subjectId) || '',
      professors: off.professors || [],
      professorRefs:
        offProfRefMap.get(off.id) ||
        (off.professors || []).map((name) => ({ id: null, name })),
    }));

    const responsePayload = {
      schedule: canonicalSchedule,
      reservedElectiveSlots: Array.from(groupedReservedMap.values()),
      electiveOfferings: canonicalOfferings,
      term: {
        id: termRecord.id,
        label: termRecord.label,
        academicYear: termRecord.academicYear,
        term: termRecord.term,
      },
    };

    // Soporte para ETag y caché HTTP dependiente de catalog_versions (Ajuste 10)
    const catalogVer = await getCatalogVersion();
    const hash = crypto
      .createHash('sha256')
      .update(catalogVer + ':' + JSON.stringify(responsePayload))
      .digest('hex');
    const etag = `"${hash}"`;

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=1800, stale-while-revalidate=86400');
    res.json({
      success: true,
      data: responsePayload,
    });
  } catch (error) {
    console.error('Error in getSchedule:', error);
    res.status(500).json({ success: false, error: 'Error al obtener la oferta horaria' });
  }
}

export async function getCatalogVersionHandler(_req: Request, res: Response): Promise<void> {
  const version = await getCatalogStore().getCatalogVersion();
  res.json({ success: true, version });
}

export async function updateSelectedPlan(req: Request, res: Response): Promise<void> {
  const { planId } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ success: false, error: 'No autenticado' });
    return;
  }

  if (!planId || typeof planId !== 'string') {
    res.status(400).json({ success: false, error: 'planId es requerido' });
    return;
  }

  try {
    const resolved = await findPublishedPlanById(planId);
    if (!resolved) {
      res.status(404).json({ success: false, error: 'Plan de estudio no encontrado o no publicado' });
      return;
    }

    const { plan } = resolved;

    await db
      .update(users)
      .set({ selectedPlanId: plan.id, updatedAt: new Date() })
      .where(eq(users.id, userId));

    invalidateUserStatusCache(userId);

    res.json({
      success: true,
      data: {
        selectedPlanId: plan.id,
        planName: plan.name,
      },
    });
  } catch (error) {
    console.error('Error updating selected plan:', error);
    res.status(500).json({ success: false, error: 'Error al actualizar el plan seleccionado' });
  }
}
