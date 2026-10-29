import { Request, Response } from 'express';
import { eq, count } from 'drizzle-orm';
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
} from '../../db/schema.js';

// Canonical Day mapping (1 = LUN .. 6 = SAB)
const DAY_MAP: Record<string, number> = {
  LUN: 1,
  MAR: 2,
  MIE: 3,
  JUE: 4,
  VIE: 5,
  SAB: 6,
};

function normalizeTurno(t?: string): 'M' | 'T' | 'N' {
  if (!t) return 'M';
  const norm = t.toLowerCase().trim();
  if (norm.startsWith('m') || norm === 'mañana') return 'M';
  if (norm.startsWith('t') || norm === 'tarde') return 'T';
  if (norm.startsWith('n') || norm === 'noche') return 'N';
  return 'M';
}

export async function getAdminPlans(req: Request, res: Response): Promise<void> {
  try {
    const allInstitutions = await db.select().from(institutions);
    const allFaculties = await db.select().from(faculties);
    const allCareers = await db.select().from(careers);
    const allPlans = await db.select().from(studyPlans);

    const planStats = await Promise.all(
      allPlans.map(async (plan) => {
        const [subCount] = await db
          .select({ value: count() })
          .from(subjects)
          .where(eq(subjects.planId, plan.id));

        const [rulesCount] = await db
          .select({ value: count() })
          .from(planSpecialRules)
          .where(eq(planSpecialRules.planId, plan.id));

        return {
          ...plan,
          subjectCount: subCount?.value || 0,
          rulesCount: rulesCount?.value || 0,
        };
      })
    );

    res.json({
      success: true,
      data: {
        institutions: allInstitutions,
        faculties: allFaculties,
        careers: allCareers,
        plans: planStats,
      },
    });
  } catch (error) {
    console.error('Error fetching admin plans:', error);
    res.status(500).json({ success: false, error: 'Error al obtener planes de estudio' });
  }
}

export async function createCareer(req: Request, res: Response): Promise<void> {
  const { facultyId, name, code } = req.body;

  if (!facultyId || !name || !code) {
    res.status(400).json({
      success: false,
      error: 'facultyId, name y code son requeridos',
    });
    return;
  }

  try {
    const [faculty] = await db.select().from(faculties).where(eq(faculties.id, facultyId)).limit(1);
    if (!faculty) {
      res.status(404).json({ success: false, error: 'Facultad no encontrada' });
      return;
    }

    const [createdCareer] = await db
      .insert(careers)
      .values({
        facultyId,
        name: name.trim(),
        code: code.trim().toUpperCase(),
      })
      .returning();

    res.status(201).json({
      success: true,
      data: createdCareer,
    });
  } catch (error) {
    console.error('Error creating career:', error);
    res.status(500).json({ success: false, error: 'Error al crear la carrera' });
  }
}

export async function createPlan(req: Request, res: Response): Promise<void> {
  const { careerId, name, year, config, subjects: subjectList, rules, acronyms: acronymList } = req.body;

  if (!careerId || !name || !year || !Array.isArray(subjectList)) {
    res.status(400).json({
      success: false,
      error: 'careerId, name, year y lista de subjects son requeridos',
    });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Crear el plan
      const [newPlan] = await tx
        .insert(studyPlans)
        .values({
          careerId,
          name: name.trim(),
          year: parseInt(year, 10),
          isActive: true,
          config: config || { requiredElectiveCredits: 20, defaultMinPassingGrade: 4 },
        })
        .returning();

      // 2. Insertar materias
      const codeToIdMap = new Map<number, string>();

      for (const sub of subjectList) {
        const [insertedSub] = await tx
          .insert(subjects)
          .values({
            planId: newPlan.id,
            codeInPlan: sub.codeInPlan ?? sub.id,
            name: sub.name,
            shortName: sub.shortName || sub.name,
            level: sub.level || 1,
            modality: sub.modality || 'A',
            contraCuatrimestral: Boolean(sub.contraCuatrimestral),
            weeklyHours: sub.weeklyHours ? String(sub.weeklyHours) : '4.0',
            kind: sub.kind || (sub.isElective ? 'electiva' : 'obligatoria'),
            credits: sub.credits || null,
            isOptionalTrack: Boolean(sub.isOptionalTrack),
            trackKey: sub.trackKey || null,
          })
          .returning();

        codeToIdMap.set(sub.codeInPlan ?? sub.id, insertedSub.id);
      }

      // 3. Insertar correlativas
      let prereqCount = 0;
      for (const sub of subjectList) {
        const subjectUuid = codeToIdMap.get(sub.codeInPlan ?? sub.id);
        if (!subjectUuid) continue;

        for (const reqCode of sub.regularPrereqs || []) {
          const reqUuid = codeToIdMap.get(reqCode);
          if (reqUuid) {
            await tx.insert(subjectPrerequisites).values({
              subjectId: subjectUuid,
              requiresSubjectId: reqUuid,
              type: 'regular',
            });
            prereqCount++;
          }
        }

        for (const reqCode of sub.approvedPrereqs || []) {
          const reqUuid = codeToIdMap.get(reqCode);
          if (reqUuid) {
            await tx.insert(subjectPrerequisites).values({
              subjectId: subjectUuid,
              requiresSubjectId: reqUuid,
              type: 'aprobada',
            });
            prereqCount++;
          }
        }
      }

      // 4. Insertar reglas especiales
      if (Array.isArray(rules)) {
        for (const r of rules) {
          const subjectUuid = codeToIdMap.get(r.subjectCode);
          if (subjectUuid) {
            await tx.insert(planSpecialRules).values({
              planId: newPlan.id,
              subjectId: subjectUuid,
              ruleType: r.ruleType,
              params: r.params || {},
              description: r.description || '',
            });
          }
        }
      }

      // 5. Insertar siglas
      if (Array.isArray(acronymList)) {
        for (const a of acronymList) {
          const subjectUuid = codeToIdMap.get(a.subjectCode);
          if (subjectUuid) {
            await tx.insert(acronyms).values({
              planId: newPlan.id,
              acronym: a.acronym.trim().toUpperCase(),
              subjectId: subjectUuid,
            });
          }
        }
      }

      return {
        plan: newPlan,
        subjectsCount: subjectList.length,
        prereqsCount: prereqCount,
      };
    });

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error creating plan:', error);
    res.status(500).json({ success: false, error: 'Error al crear el plan de estudios' });
  }
}

export async function createSchedule(req: Request, res: Response): Promise<void> {
  const { facultyId, academicYear, term, label, schedule, reservedElectiveSlots: reservedSlots, electiveOfferingsSeed } = req.body;

  if (!facultyId || !academicYear || !term || !Array.isArray(schedule)) {
    res.status(400).json({
      success: false,
      error: 'facultyId, academicYear, term y schedule son requeridos',
    });
    return;
  }

  const termStr = term.toUpperCase() === '2C' ? '2C' : '1C';
  const yearInt = parseInt(academicYear, 10);

  try {
    const [faculty] = await db.select().from(faculties).where(eq(faculties.id, facultyId)).limit(1);
    if (!faculty) {
      res.status(404).json({ success: false, error: 'Facultad no encontrada' });
      return;
    }

    const [activePlan] = await db.select().from(studyPlans).where(eq(studyPlans.isActive, true)).limit(1);
    if (!activePlan) {
      res.status(404).json({ success: false, error: 'No hay plan activo disponible' });
      return;
    }

    const planSubs = await db
      .select({ id: subjects.id, codeInPlan: subjects.codeInPlan })
      .from(subjects)
      .where(eq(subjects.planId, activePlan.id));
    const codeToUuid = new Map<number, string>();
    planSubs.forEach((s) => codeToUuid.set(s.codeInPlan, s.id));

    const result = await db.transaction(async (tx) => {
      // 1. Obtener o crear scheduleTerm
      let [termRec] = await tx
        .select()
        .from(scheduleTerms)
        .where(eq(scheduleTerms.facultyId, faculty.id))
        .limit(1);

      if (!termRec) {
        [termRec] = await tx
          .insert(scheduleTerms)
          .values({
            facultyId: faculty.id,
            academicYear: yearInt,
            term: termStr,
            label: label || `${termStr === '1C' ? '1°' : '2°'} Cuatrimestre ${yearInt}`,
            isCurrent: true,
          })
          .returning();
      }

      // 2. Limpiar ofertas anteriores de este término
      await tx.delete(commissions).where(eq(commissions.scheduleTermId, termRec.id));
      await tx.delete(reservedElectiveSlots).where(eq(reservedElectiveSlots.scheduleTermId, termRec.id));
      await tx.delete(electiveOfferings).where(eq(electiveOfferings.scheduleTermId, termRec.id));
      await tx.delete(courseGroups).where(eq(courseGroups.scheduleTermId, termRec.id));

      // 3. Crear course groups
      const courseCodesSet = new Set<string>();
      schedule.forEach((item: any) => {
        item.commissions?.forEach((c: any) => {
          if (c.courseCode) courseCodesSet.add(c.courseCode.toUpperCase());
        });
      });
      (reservedSlots || []).forEach((r: any) => {
        if (r.courseCode) courseCodesSet.add(r.courseCode.toUpperCase());
      });

      const courseGroupMap = new Map<string, string>();
      for (const cCode of courseCodesSet) {
        const matchYear = cCode.match(/^(\d)/);
        const yearLevel = matchYear ? parseInt(matchYear[1], 10) : 1;
        const [cg] = await tx
          .insert(courseGroups)
          .values({
            scheduleTermId: termRec.id,
            code: cCode,
            turno: 'M',
            yearLevel,
          })
          .returning();
        courseGroupMap.set(cCode, cg.id);
      }

      // 4. Insertar comisiones
      let commCount = 0;
      let slotCount = 0;

      for (const item of schedule) {
        if (item.term !== 'A' && item.term !== termStr) continue;

        const subCode = typeof item.subjectId === 'string' ? parseInt(item.subjectId, 10) : item.subjectId;
        const subjectUuid = codeToUuid.get(subCode);
        if (!subjectUuid) continue;

        for (const comm of item.commissions || []) {
          const cCodeUpper = comm.courseCode?.toUpperCase();
          const courseGroupId = cCodeUpper ? courseGroupMap.get(cCodeUpper) : null;
          const turnoVal = normalizeTurno(comm.turno);

          const [insertedComm] = await tx
            .insert(commissions)
            .values({
              subjectId: subjectUuid,
              scheduleTermId: termRec.id,
              courseGroupId,
              code: comm.code,
              turno: turnoVal,
              termOffer: item.term,
            })
            .returning();
          commCount++;

          for (const prof of comm.professors || []) {
            if (prof.trim()) {
              await tx.insert(commissionProfessors).values({
                commissionId: insertedComm.id,
                professorName: prof.trim(),
              });
            }
          }

          for (const s of comm.slots || []) {
            const dayNum = DAY_MAP[s.day.toUpperCase()] || 1;
            await tx.insert(commissionSlots).values({
              commissionId: insertedComm.id,
              day: dayNum,
              startTime: s.start,
              endTime: s.end,
              room: s.room || null,
              mode: s.mode || 'Presencial',
            });
            slotCount++;
          }
        }
      }

      // 5. Reserved slots
      let reservedCount = 0;
      for (const resSlot of reservedSlots || []) {
        if (resSlot.term !== 'A' && resSlot.term !== termStr) continue;
        const courseGroupId = courseGroupMap.get(resSlot.courseCode?.toUpperCase());
        if (!courseGroupId) continue;

        for (const s of resSlot.slots || []) {
          const dayNum = DAY_MAP[s.day.toUpperCase()] || 1;
          await tx.insert(reservedElectiveSlots).values({
            courseGroupId,
            scheduleTermId: termRec.id,
            label: resSlot.label,
            day: dayNum,
            startTime: s.start,
            endTime: s.end,
          });
          reservedCount++;
        }
      }

      // 6. Elective offerings
      let electiveOfferingCount = 0;
      for (const off of electiveOfferingsSeed || []) {
        const courseGroupId = courseGroupMap.get(off.courseCode?.toUpperCase());
        const subjectUuid = codeToUuid.get(off.subjectCode);
        if (courseGroupId && subjectUuid) {
          await tx.insert(electiveOfferings).values({
            courseGroupId,
            scheduleTermId: termRec.id,
            subjectId: subjectUuid,
            professors: off.professors || [],
          });
          electiveOfferingCount++;
        }
      }

      return {
        term: termRec,
        commissionsCount: commCount,
        slotsCount: slotCount,
        reservedSlotsCount: reservedCount,
        electiveOfferingsCount: electiveOfferingCount,
      };
    });

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error creating schedule:', error);
    res.status(500).json({ success: false, error: 'Error al guardar oferta horaria' });
  }
}

