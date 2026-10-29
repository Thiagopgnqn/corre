import { Request, Response } from 'express';
import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  institutions,
  faculties,
  careers,
  studyPlans,
  subjects,
  subjectPrerequisites,
  planSpecialRules,
  acronyms,
  scheduleTerms,
  courseGroups,
  commissions,
  commissionProfessors,
  commissionSlots,
  reservedElectiveSlots,
  electiveOfferings,
  users,
} from '../../db/schema.js';

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
    const allInstitutions = await db.select().from(institutions);
    const allFaculties = await db.select().from(faculties);
    const allCareers = await db.select().from(careers);
    const activePlans = await db.select().from(studyPlans).where(eq(studyPlans.isActive, true));

    const tree = allInstitutions.map((inst) => ({
      id: inst.id,
      name: inst.name,
      code: inst.code,
      faculties: allFaculties
        .filter((f) => f.institutionId === inst.id)
        .map((fac) => ({
          id: fac.id,
          name: fac.name,
          code: fac.code,
          careers: allCareers
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
                  config: p.config,
                })),
            })),
        })),
    }));

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
    let plan;
    if (planId === 'current' || planId === 'default') {
      [plan] = await db.select().from(studyPlans).where(eq(studyPlans.isActive, true)).limit(1);
    } else {
      [plan] = await db.select().from(studyPlans).where(eq(studyPlans.id, planId)).limit(1);
    }

    if (!plan) {
      res.status(404).json({ success: false, error: 'Plan de estudio no encontrado' });
      return;
    }

    // Obtener materias
    const planSubjects = await db
      .select()
      .from(subjects)
      .where(eq(subjects.planId, plan.id));

    // Mapa subjectId (UUID) -> codeInPlan
    const uuidToCode = new Map<string, number>();
    planSubjects.forEach((s) => uuidToCode.set(s.id, s.codeInPlan));

    // Obtener todas las correlativas del plan
    const subIds = planSubjects.map((s) => s.id);
    let allPrereqs: Array<{ subjectId: string; requiresSubjectId: string; type: string }> = [];
    if (subIds.length > 0) {
      allPrereqs = await db.select().from(subjectPrerequisites);
    }

    // Agrupar correlativas por subject
    const regularMap = new Map<number, number[]>();
    const approvedMap = new Map<number, number[]>();

    allPrereqs.forEach((p) => {
      const subjectCode = uuidToCode.get(p.subjectId);
      const reqCode = uuidToCode.get(p.requiresSubjectId);
      if (subjectCode && reqCode) {
        if (p.type === 'regular') {
          const list = regularMap.get(subjectCode) || [];
          list.push(reqCode);
          regularMap.set(subjectCode, list);
        } else {
          const list = approvedMap.get(subjectCode) || [];
          list.push(reqCode);
          approvedMap.set(subjectCode, list);
        }
      }
    });

    // Obtener reglas especiales y siglas
    const rules = await db.select().from(planSpecialRules).where(eq(planSpecialRules.planId, plan.id));
    const acronymList = await db.select().from(acronyms).where(eq(acronyms.planId, plan.id));

    const acronymsMap: Record<string, number> = {};
    acronymList.forEach((a) => {
      const c = uuidToCode.get(a.subjectId);
      if (c) acronymsMap[a.acronym] = c;
    });

    // Armar subjects formateados
    const formattedSubjects = planSubjects.map((s) => ({
      id: s.codeInPlan,
      uuid: s.id,
      code: s.shortName,
      name: s.name,
      level: s.level,
      modality: s.modality,
      contraCuatrimestral: s.contraCuatrimestral,
      weeklyHours: Number(s.weeklyHours),
      isElective: s.kind === 'electiva',
      credits: s.credits ?? undefined,
      isOptionalTrack: s.isOptionalTrack,
      trackKey: s.trackKey ?? undefined,
      regularPrereqs: regularMap.get(s.codeInPlan) || [],
      approvedPrereqs: approvedMap.get(s.codeInPlan) || [],
    }));

    const responseData = {
      plan: {
        id: plan.id,
        name: plan.name,
        year: plan.year,
        config: plan.config,
        updatedAt: plan.updatedAt,
      },
      subjects: formattedSubjects,
      rules: rules.map((r) => ({
        id: r.id,
        subjectCode: uuidToCode.get(r.subjectId),
        ruleType: r.ruleType,
        params: r.params,
        description: r.description,
      })),
      acronyms: acronymsMap,
    };

    // Soporte para ETag y caché HTTP
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(responseData))
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
    // 1. Obtener el plan de estudio
    let plan;
    if (!planId || planId === 'current' || planId === 'default') {
      [plan] = await db.select().from(studyPlans).where(eq(studyPlans.isActive, true)).limit(1);
    } else {
      [plan] = await db.select().from(studyPlans).where(eq(studyPlans.id, String(planId))).limit(1);
    }

    if (!plan) {
      res.status(404).json({ success: false, error: 'Plan de estudio no encontrado' });
      return;
    }

    // 2. Obtener la carrera y facultad correspondiente
    const [career] = await db.select().from(careers).where(eq(careers.id, plan.careerId)).limit(1);
    if (!career) {
      res.status(404).json({ success: false, error: 'Carrera no encontrada' });
      return;
    }

    // 3. Obtener el término de horarios
    const academicYear = year ? parseInt(String(year), 10) : 2026;
    const termStr = term && String(term).toUpperCase() === '2C' ? '2C' : '1C';

    let [termRecord] = await db
      .select()
      .from(scheduleTerms)
      .where(
        and(
          eq(scheduleTerms.facultyId, career.facultyId),
          eq(scheduleTerms.academicYear, academicYear),
          eq(scheduleTerms.term, termStr)
        )
      )
      .limit(1);

    // Si no encuentra exacto, tomar el término marcado como isCurrent
    if (!termRecord) {
      [termRecord] = await db
        .select()
        .from(scheduleTerms)
        .where(eq(scheduleTerms.isCurrent, true))
        .limit(1);
    }

    if (!termRecord) {
      // Devolver estructura vacía pero válida
      res.json({
        success: true,
        data: {
          schedule: [],
          reservedElectiveSlots: [],
          electiveOfferings: [],
          term: { academicYear, term: termStr },
        },
      });
      return;
    }

    // 4. Mapeo de materias del plan
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

    // 5. Cargar course groups
    const cGroups = await db
      .select()
      .from(courseGroups)
      .where(eq(courseGroups.scheduleTermId, termRecord.id));
    const courseGroupMap = new Map<string, string>(); // id -> code
    cGroups.forEach((cg) => courseGroupMap.set(cg.id, cg.code));

    // 6. Cargar comisiones del término
    const commList = await db
      .select()
      .from(commissions)
      .where(eq(commissions.scheduleTermId, termRecord.id));

    const commIds = commList.map((c) => c.id);

    // 7. Cargar profesores y slots
    const allProfs = commIds.length > 0
      ? await db.select().from(commissionProfessors)
      : [];
    const allSlots = commIds.length > 0
      ? await db.select().from(commissionSlots)
      : [];

    const profMap = new Map<string, string[]>();
    allProfs.forEach((p) => {
      const list = profMap.get(p.commissionId) || [];
      list.push(p.professorName);
      profMap.set(p.commissionId, list);
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

    // 9. Cargar franjas reservadas de electivas
    const resSlots = await db
      .select()
      .from(reservedElectiveSlots)
      .where(eq(reservedElectiveSlots.scheduleTermId, termRecord.id));

    // Agrupar franjas reservadas por courseGroup + label
    const groupedReservedMap = new Map<string, any>();
    resSlots.forEach((rs) => {
      const cCode = courseGroupMap.get(rs.courseGroupId) || '3K1';
      const key = `${cCode}-${rs.label}`;
      const existing = groupedReservedMap.get(key) || {
        courseCode: cCode,
        term: termStr,
        turno: 'mañana',
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

    // 10. Cargar electivas con docentes
    const offList = await db
      .select()
      .from(electiveOfferings)
      .where(eq(electiveOfferings.scheduleTermId, termRecord.id));

    const canonicalOfferings = offList.map((off) => ({
      courseCode: courseGroupMap.get(off.courseGroupId) || '',
      subjectCode: uuidToCode.get(off.subjectId) || 0,
      subjectName: uuidToName.get(off.subjectId) || '',
      professors: off.professors || [],
    }));

    res.json({
      success: true,
      data: {
        schedule: canonicalSchedule,
        reservedElectiveSlots: Array.from(groupedReservedMap.values()),
        electiveOfferings: canonicalOfferings,
        term: {
          id: termRecord.id,
          label: termRecord.label,
          academicYear: termRecord.academicYear,
          term: termRecord.term,
        },
      },
    });
  } catch (error) {
    console.error('Error in getSchedule:', error);
    res.status(500).json({ success: false, error: 'Error al obtener la oferta horaria' });
  }
}

export async function updateSelectedPlan(req: Request, res: Response): Promise<void> {
  const { planId } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ success: false, error: 'No autenticado' });
    return;
  }

  if (!planId) {
    res.status(400).json({ success: false, error: 'planId es requerido' });
    return;
  }

  try {
    const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.id, planId)).limit(1);
    if (!plan) {
      res.status(404).json({ success: false, error: 'Plan de estudio no encontrado' });
      return;
    }

    await db
      .update(users)
      .set({ selectedPlanId: plan.id, updatedAt: new Date() })
      .where(eq(users.id, userId));

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
