import { Request, Response } from 'express';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  users,
  userSettings,
  subjectProgress,
  electiveAssignments,
  userBasket,
  scheduleSelections,
  scheduleProposals,
  studyPlans,
  subjects,
  scheduleTerms,
} from '../../db/schema.js';

export async function getUserState(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: 'No autenticado' });
    return;
  }

  try {
    // 1. Obtener usuario y su plan
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      res.status(404).json({ success: false, error: 'Usuario no encontrado' });
      return;
    }

    let planId = user.selectedPlanId;
    if (!planId) {
      const [defaultPlan] = await db.select().from(studyPlans).where(eq(studyPlans.isActive, true)).limit(1);
      if (defaultPlan) {
        planId = defaultPlan.id;
        await db.update(users).set({ selectedPlanId: planId }).where(eq(users.id, userId));
      }
    }

    // 2. Mapeo de materias del plan
    let planSubs: Array<{ id: string; codeInPlan: number; kind: string }> = [];
    if (planId) {
      planSubs = await db
        .select({ id: subjects.id, codeInPlan: subjects.codeInPlan, kind: subjects.kind })
        .from(subjects)
        .where(eq(subjects.planId, planId));
    }

    const uuidToCode = new Map<string, number>();
    const codeToUuid = new Map<number, string>();
    planSubs.forEach((s) => {
      uuidToCode.set(s.id, s.codeInPlan);
      codeToUuid.set(s.codeInPlan, s.id);
    });

    // 3. Settings
    const [settingsRow] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    const settings = settingsRow
      ? {
          includePromotionsInGPA: settingsRow.includePromotionsInGPA,
          minPassingGrade: settingsRow.minPassingGrade,
          includeAnalistaTrack: settingsRow.includeAnalistaTrack,
          allowBlockedElectivesPlanning: settingsRow.allowBlockedElectivesPlanning,
          includeElectivesInProgress: settingsRow.includeElectivesInProgress,
          soundEnabled: settingsRow.soundEnabled,
          tutorialCompleted: settingsRow.tutorialCompleted,
        }
      : {
          includePromotionsInGPA: true,
          minPassingGrade: 4,
          includeAnalistaTrack: false,
          allowBlockedElectivesPlanning: false,
          includeElectivesInProgress: true,
          soundEnabled: true,
          tutorialCompleted: false,
        };

    // 4. Progreso
    const progressRows = await db.select().from(subjectProgress).where(eq(subjectProgress.userId, userId));
    const progressByCode: Record<number, { status: string; grade?: number }> = {};
    const progressByUuid: Record<string, { status: string; grade?: number }> = {};

    progressRows.forEach((p) => {
      const code = uuidToCode.get(p.subjectId);
      const entry = {
        status: p.status,
        grade: p.grade ? Number(p.grade) : undefined,
      };
      if (code !== undefined) {
        progressByCode[code] = entry;
      }
      progressByUuid[p.subjectId] = entry;
    });

    // 5. Electivas asignadas
    const electivesRows = await db
      .select()
      .from(electiveAssignments)
      .where(eq(electiveAssignments.userId, userId));

    const assignedElectives: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    electivesRows.forEach((e) => {
      const code = uuidToCode.get(e.subjectId);
      if (code !== undefined && e.year >= 1 && e.year <= 5) {
        if (!assignedElectives[e.year]) assignedElectives[e.year] = [];
        assignedElectives[e.year].push(code);
      }
    });

    // 6. Canasta
    const basketRows = await db.select().from(userBasket).where(eq(userBasket.userId, userId));
    const basketCodes: number[] = [];
    basketRows.forEach((b) => {
      const code = uuidToCode.get(b.subjectId);
      if (code !== undefined) {
        basketCodes.push(code);
      }
    });

    // 7. Horarios y propuestas
    const [currentTerm] = await db.select().from(scheduleTerms).where(eq(scheduleTerms.isCurrent, true)).limit(1);

    let scheduleSelectionMap: Record<number, string> = {};
    if (currentTerm) {
      const [sel] = await db
        .select()
        .from(scheduleSelections)
        .where(
          and(
            eq(scheduleSelections.userId, userId),
            eq(scheduleSelections.scheduleTermId, currentTerm.id)
          )
        )
        .limit(1);

      if (sel && sel.selections) {
        // selections guardado como { [subjectCodeOrUuid]: commissionCode }
        scheduleSelectionMap = sel.selections as any;
      }
    }

    const proposals = await db
      .select()
      .from(scheduleProposals)
      .where(eq(scheduleProposals.userId, userId));

    const formattedProposals = proposals.map((p) => ({
      id: p.id,
      name: p.name,
      scheduleTermId: p.scheduleTermId,
      selections: p.selections,
      createdAt: p.createdAt.getTime(),
      updatedAt: p.updatedAt.getTime(),
    }));

    // Determinar si el usuario tiene datos guardados (para detectar si la cuenta está virgen)
    const hasSavedData =
      progressRows.length > 0 ||
      electivesRows.length > 0 ||
      basketRows.length > 0 ||
      proposals.length > 0 ||
      (settingsRow !== undefined && settingsRow.tutorialCompleted);

    res.json({
      success: true,
      data: {
        selectedPlanId: planId,
        hasSavedData,
        settings,
        progress: progressByCode,
        progressByUuid,
        assignedElectives,
        basket: basketCodes,
        scheduleSelections: scheduleSelectionMap,
        scheduleProposals: formattedProposals,
      },
    });
  } catch (error) {
    console.error('Error fetching user state:', error);
    res.status(500).json({ success: false, error: 'Error al obtener estado del usuario' });
  }
}

export async function updateProgress(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  const subjectId = String(req.params.subjectId);
  const { status, grade } = req.body;

  if (!userId) {
    res.status(401).json({ success: false, error: 'No autenticado' });
    return;
  }

  const validStatuses = ['pendiente', 'cursando', 'regularizada', 'aprobada', 'promocionada', 'bloqueada', 'disponible'];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ success: false, error: 'Estado de materia inválido' });
    return;
  }

  try {
    // 1. Obtener usuario para conocer su plan activo
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !user.selectedPlanId) {
      res.status(400).json({ success: false, error: 'El usuario no tiene un plan seleccionado' });
      return;
    }

    // 2. Buscar materia por UUID o por codeInPlan dentro de su plan
    let subjectRecord;
    const isNum = !isNaN(Number(subjectId));

    if (isNum) {
      [subjectRecord] = await db
        .select()
        .from(subjects)
        .where(
          and(
            eq(subjects.planId, user.selectedPlanId),
            eq(subjects.codeInPlan, parseInt(subjectId, 10))
          )
        )
        .limit(1);
    } else {
      [subjectRecord] = await db
        .select()
        .from(subjects)
        .where(
          and(
            eq(subjects.planId, user.selectedPlanId),
            eq(subjects.id, subjectId)
          )
        )
        .limit(1);
    }

    if (!subjectRecord) {
      res.status(404).json({ success: false, error: 'Materia no encontrada en el plan activo' });
      return;
    }

    // Si status es 'pendiente', 'disponible' o 'bloqueada', se elimina el registro o se marca como 'pendiente'
    const gradeVal = grade !== undefined && grade !== null && grade !== '' ? String(grade) : null;
    const normalizedStatus = (status === 'disponible' || status === 'bloqueada') ? 'pendiente' : status;

    if (normalizedStatus === 'pendiente' && gradeVal === null) {
      await db
        .delete(subjectProgress)
        .where(
          and(
            eq(subjectProgress.userId, userId),
            eq(subjectProgress.subjectId, subjectRecord.id)
          )
        );

      res.json({
        success: true,
        data: {
          subjectId: subjectRecord.codeInPlan,
          uuid: subjectRecord.id,
          status: 'pendiente',
          grade: null,
        },
      });
      return;
    }

    // Upsert progreso
    const [existing] = await db
      .select()
      .from(subjectProgress)
      .where(
        and(
          eq(subjectProgress.userId, userId),
          eq(subjectProgress.subjectId, subjectRecord.id)
        )
      )
      .limit(1);

    if (existing) {
      await db
        .update(subjectProgress)
        .set({
          status: normalizedStatus,
          grade: gradeVal,
          updatedAt: new Date(),
        })
        .where(eq(subjectProgress.id, existing.id));
    } else {
      await db.insert(subjectProgress).values({
        userId,
        subjectId: subjectRecord.id,
        status: normalizedStatus,
        grade: gradeVal,
      });
    }

    res.json({
      success: true,
      data: {
        subjectId: subjectRecord.codeInPlan,
        uuid: subjectRecord.id,
        status: normalizedStatus,
        grade: gradeVal ? Number(gradeVal) : null,
      },
    });
  } catch (error) {
    console.error('Error updating progress:', error);
    res.status(500).json({ success: false, error: 'Error al actualizar progreso de la materia' });
  }
}

export async function updateElectives(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  const { assignedElectives: rawAssignments } = req.body;

  if (!userId) {
    res.status(401).json({ success: false, error: 'No autenticado' });
    return;
  }

  if (!rawAssignments || typeof rawAssignments !== 'object') {
    res.status(400).json({ success: false, error: 'Formato de assignedElectives inválido' });
    return;
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !user.selectedPlanId) {
      res.status(400).json({ success: false, error: 'Usuario sin plan activo' });
      return;
    }

    // Obtener electivas válidas del plan
    const validElectives = await db
      .select({ id: subjects.id, codeInPlan: subjects.codeInPlan, kind: subjects.kind })
      .from(subjects)
      .where(
        and(
          eq(subjects.planId, user.selectedPlanId),
          eq(subjects.kind, 'electiva')
        )
      );

    const codeToUuid = new Map<number, string>();
    const uuidSet = new Set<string>();
    validElectives.forEach((e) => {
      codeToUuid.set(e.codeInPlan, e.id);
      uuidSet.add(e.id);
    });

    await db.transaction(async (tx) => {
      // Eliminar asignaciones anteriores
      await tx.delete(electiveAssignments).where(eq(electiveAssignments.userId, userId));

      const seenElectives = new Set<string>();

      for (let year = 1; year <= 5; year++) {
        const list = Array.isArray(rawAssignments[year]) ? rawAssignments[year] : [];
        for (const item of list) {
          let subjectUuid: string | undefined;

          if (typeof item === 'number' || !isNaN(Number(item))) {
            subjectUuid = codeToUuid.get(Number(item));
          } else if (typeof item === 'string' && uuidSet.has(item)) {
            subjectUuid = item;
          }

          if (subjectUuid && !seenElectives.has(subjectUuid)) {
            seenElectives.add(subjectUuid);
            await tx.insert(electiveAssignments).values({
              userId,
              subjectId: subjectUuid,
              year,
            });
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Electivas actualizadas correctamente',
    });
  } catch (error) {
    console.error('Error updating electives:', error);
    res.status(500).json({ success: false, error: 'Error al actualizar electivas asignadas' });
  }
}

export async function updateBasket(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  const { basket } = req.body;

  if (!userId) {
    res.status(401).json({ success: false, error: 'No autenticado' });
    return;
  }

  if (!Array.isArray(basket)) {
    res.status(400).json({ success: false, error: 'basket debe ser un array de IDs' });
    return;
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !user.selectedPlanId) {
      res.status(400).json({ success: false, error: 'Usuario sin plan activo' });
      return;
    }

    const planSubs = await db
      .select({ id: subjects.id, codeInPlan: subjects.codeInPlan })
      .from(subjects)
      .where(eq(subjects.planId, user.selectedPlanId));

    const codeToUuid = new Map<number, string>();
    const uuidSet = new Set<string>();
    planSubs.forEach((s) => {
      codeToUuid.set(s.codeInPlan, s.id);
      uuidSet.add(s.id);
    });

    await db.transaction(async (tx) => {
      await tx.delete(userBasket).where(eq(userBasket.userId, userId));

      const seen = new Set<string>();
      for (const item of basket) {
        let subjectUuid: string | undefined;
        if (typeof item === 'number' || !isNaN(Number(item))) {
          subjectUuid = codeToUuid.get(Number(item));
        } else if (typeof item === 'string' && uuidSet.has(item)) {
          subjectUuid = item;
        }

        if (subjectUuid && !seen.has(subjectUuid)) {
          seen.add(subjectUuid);
          await tx.insert(userBasket).values({
            userId,
            subjectId: subjectUuid,
          });
        }
      }
    });

    res.json({
      success: true,
      message: 'Canasta actualizada correctamente',
    });
  } catch (error) {
    console.error('Error updating basket:', error);
    res.status(500).json({ success: false, error: 'Error al actualizar canasta' });
  }
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: 'No autenticado' });
    return;
  }

  const {
    includePromotionsInGPA,
    minPassingGrade,
    includeAnalistaTrack,
    allowBlockedElectivesPlanning,
    includeElectivesInProgress,
    soundEnabled,
    tutorialCompleted,
    extraSettings,
  } = req.body;

  try {
    const [existing] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);

    const updatePayload = {
      includePromotionsInGPA: includePromotionsInGPA !== undefined ? Boolean(includePromotionsInGPA) : (existing?.includePromotionsInGPA ?? true),
      minPassingGrade: minPassingGrade !== undefined ? parseInt(minPassingGrade, 10) : (existing?.minPassingGrade ?? 4),
      includeAnalistaTrack: includeAnalistaTrack !== undefined ? Boolean(includeAnalistaTrack) : (existing?.includeAnalistaTrack ?? false),
      allowBlockedElectivesPlanning: allowBlockedElectivesPlanning !== undefined ? Boolean(allowBlockedElectivesPlanning) : (existing?.allowBlockedElectivesPlanning ?? false),
      includeElectivesInProgress: includeElectivesInProgress !== undefined ? Boolean(includeElectivesInProgress) : (existing?.includeElectivesInProgress ?? true),
      soundEnabled: soundEnabled !== undefined ? Boolean(soundEnabled) : (existing?.soundEnabled ?? true),
      tutorialCompleted: tutorialCompleted !== undefined ? Boolean(tutorialCompleted) : (existing?.tutorialCompleted ?? false),
      extraSettings: extraSettings ?? existing?.extraSettings ?? {},
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(userSettings).set(updatePayload).where(eq(userSettings.userId, userId));
    } else {
      await db.insert(userSettings).values({
        userId,
        ...updatePayload,
      });
    }

    res.json({
      success: true,
      data: updatePayload,
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ success: false, error: 'Error al actualizar configuraciones' });
  }
}

export async function getScheduleProposals(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: 'No autenticado' });
    return;
  }

  try {
    const proposals = await db.select().from(scheduleProposals).where(eq(scheduleProposals.userId, userId));
    res.json({
      success: true,
      data: proposals.map((p) => ({
        id: p.id,
        name: p.name,
        scheduleTermId: p.scheduleTermId,
        selections: p.selections,
        createdAt: p.createdAt.getTime(),
        updatedAt: p.updatedAt.getTime(),
      })),
    });
  } catch (error) {
    console.error('Error getting schedule proposals:', error);
    res.status(500).json({ success: false, error: 'Error al obtener propuestas de horario' });
  }
}

export async function saveScheduleProposal(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  const { id, name, scheduleTermId, selections } = req.body;

  if (!userId) {
    res.status(401).json({ success: false, error: 'No autenticado' });
    return;
  }

  if (!name || !selections) {
    res.status(400).json({ success: false, error: 'name y selections son requeridos' });
    return;
  }

  try {
    let termId = scheduleTermId;
    if (!termId) {
      const [currTerm] = await db.select().from(scheduleTerms).where(eq(scheduleTerms.isCurrent, true)).limit(1);
      if (currTerm) termId = currTerm.id;
    }

    if (!termId) {
      res.status(400).json({ success: false, error: 'No se encontró un período lectivo válido' });
      return;
    }

    if (id) {
      const [existing] = await db
        .select()
        .from(scheduleProposals)
        .where(and(eq(scheduleProposals.id, id), eq(scheduleProposals.userId, userId)))
        .limit(1);

      if (existing) {
        const [updated] = await db
          .update(scheduleProposals)
          .set({
            name: name.trim(),
            selections,
            updatedAt: new Date(),
          })
          .where(eq(scheduleProposals.id, id))
          .returning();

        res.json({ success: true, data: updated });
        return;
      }
    }

    const [created] = await db
      .insert(scheduleProposals)
      .values({
        userId,
        scheduleTermId: termId,
        name: name.trim(),
        selections,
      })
      .returning();

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error('Error saving schedule proposal:', error);
    res.status(500).json({ success: false, error: 'Error al guardar propuesta' });
  }
}

export async function deleteScheduleProposal(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  const id = String(req.params.id);

  if (!userId) {
    res.status(401).json({ success: false, error: 'No autenticado' });
    return;
  }

  try {
    await db
      .delete(scheduleProposals)
      .where(and(eq(scheduleProposals.id, id), eq(scheduleProposals.userId, userId)));

    res.json({ success: true, message: 'Propuesta eliminada' });
  } catch (error) {
    console.error('Error deleting schedule proposal:', error);
    res.status(500).json({ success: false, error: 'Error al eliminar propuesta' });
  }
}

export async function saveScheduleSelections(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  const { scheduleTermId, selections } = req.body;

  if (!userId) {
    res.status(401).json({ success: false, error: 'No autenticado' });
    return;
  }

  try {
    let termId = scheduleTermId;
    if (!termId) {
      const [currTerm] = await db.select().from(scheduleTerms).where(eq(scheduleTerms.isCurrent, true)).limit(1);
      if (currTerm) termId = currTerm.id;
    }

    if (!termId) {
      res.status(400).json({ success: false, error: 'No se encontró un período lectivo' });
      return;
    }

    const [existing] = await db
      .select()
      .from(scheduleSelections)
      .where(
        and(
          eq(scheduleSelections.userId, userId),
          eq(scheduleSelections.scheduleTermId, termId)
        )
      )
      .limit(1);

    if (existing) {
      await db
        .update(scheduleSelections)
        .set({
          selections: selections || {},
          updatedAt: new Date(),
        })
        .where(eq(scheduleSelections.id, existing.id));
    } else {
      await db.insert(scheduleSelections).values({
        userId,
        scheduleTermId: termId,
        selections: selections || {},
      });
    }

    res.json({ success: true, message: 'Selecciones de horarios guardadas' });
  } catch (error) {
    console.error('Error saving schedule selections:', error);
    res.status(500).json({ success: false, error: 'Error al guardar selecciones de horario' });
  }
}

export async function importData(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: 'No autenticado' });
    return;
  }

  const payload = req.body;
  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ success: false, error: 'Payload de importación inválido' });
    return;
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !user.selectedPlanId) {
      res.status(400).json({ success: false, error: 'Usuario sin plan activo' });
      return;
    }

    // Mapa de materias del plan
    const planSubs = await db
      .select({ id: subjects.id, codeInPlan: subjects.codeInPlan, kind: subjects.kind })
      .from(subjects)
      .where(eq(subjects.planId, user.selectedPlanId));

    const codeToUuid = new Map<number, string>();
    planSubs.forEach((s) => codeToUuid.set(s.codeInPlan, s.id));

    const [currentTerm] = await db.select().from(scheduleTerms).where(eq(scheduleTerms.isCurrent, true)).limit(1);

    const counts = await db.transaction(async (tx) => {
      let progressCount = 0;
      let electivesCount = 0;
      let basketCount = 0;
      let proposalsCount = 0;

      // 1. Settings
      if (payload.settings && typeof payload.settings === 'object') {
        const s = payload.settings;
        const [existingSet] = await tx.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
        const setValues = {
          includePromotionsInGPA: s.includePromotionsInGPA ?? true,
          minPassingGrade: s.minPassingGrade ?? 4,
          includeAnalistaTrack: Boolean(s.includeAnalistaTrack),
          allowBlockedElectivesPlanning: Boolean(s.allowBlockedElectivesPlanning),
          includeElectivesInProgress: s.includeElectivesInProgress ?? true,
          soundEnabled: s.soundEnabled ?? true,
          tutorialCompleted: Boolean(s.tutorialCompleted),
          updatedAt: new Date(),
        };

        if (existingSet) {
          await tx.update(userSettings).set(setValues).where(eq(userSettings.userId, userId));
        } else {
          await tx.insert(userSettings).values({ userId, ...setValues });
        }
      }

      // 2. Progreso
      const userState = payload.userState || {};
      for (const [codeStr, entry] of Object.entries(userState)) {
        const codeNum = parseInt(codeStr, 10);
        const subUuid = codeToUuid.get(codeNum);
        if (!subUuid || !entry || typeof entry !== 'object') continue;

        const rawStatus = (entry as any).status;
        const normalizedStatus = (rawStatus === 'disponible' || rawStatus === 'bloqueada') ? 'pendiente' : rawStatus;
        const gradeVal = (entry as any).grade !== undefined && (entry as any).grade !== null ? String((entry as any).grade) : null;

        if (normalizedStatus === 'pendiente' && gradeVal === null) continue;

        const [existing] = await tx
          .select()
          .from(subjectProgress)
          .where(and(eq(subjectProgress.userId, userId), eq(subjectProgress.subjectId, subUuid)))
          .limit(1);

        if (existing) {
          await tx
            .update(subjectProgress)
            .set({ status: normalizedStatus, grade: gradeVal, updatedAt: new Date() })
            .where(eq(subjectProgress.id, existing.id));
        } else {
          await tx.insert(subjectProgress).values({
            userId,
            subjectId: subUuid,
            status: normalizedStatus,
            grade: gradeVal,
          });
        }
        progressCount++;
      }

      // 3. Electivas asignadas
      if (payload.assignedElectives && typeof payload.assignedElectives === 'object') {
        await tx.delete(electiveAssignments).where(eq(electiveAssignments.userId, userId));
        const seen = new Set<string>();

        for (let year = 1; year <= 5; year++) {
          const list = Array.isArray(payload.assignedElectives[year]) ? payload.assignedElectives[year] : [];
          for (const item of list) {
            const subUuid = codeToUuid.get(Number(item));
            if (subUuid && !seen.has(subUuid)) {
              seen.add(subUuid);
              await tx.insert(electiveAssignments).values({
                userId,
                subjectId: subUuid,
                year,
              });
              electivesCount++;
            }
          }
        }
      }

      // 4. Canasta
      if (Array.isArray(payload.basket)) {
        await tx.delete(userBasket).where(eq(userBasket.userId, userId));
        const seen = new Set<string>();
        for (const item of payload.basket) {
          const subUuid = codeToUuid.get(Number(item));
          if (subUuid && !seen.has(subUuid)) {
            seen.add(subUuid);
            await tx.insert(userBasket).values({
              userId,
              subjectId: subUuid,
            });
            basketCount++;
          }
        }
      }

      // 5. Horarios y propuestas
      if (currentTerm && payload.scheduleSelections && typeof payload.scheduleSelections === 'object') {
        const [existingSel] = await tx
          .select()
          .from(scheduleSelections)
          .where(and(eq(scheduleSelections.userId, userId), eq(scheduleSelections.scheduleTermId, currentTerm.id)))
          .limit(1);

        if (existingSel) {
          await tx
            .update(scheduleSelections)
            .set({ selections: payload.scheduleSelections, updatedAt: new Date() })
            .where(eq(scheduleSelections.id, existingSel.id));
        } else {
          await tx.insert(scheduleSelections).values({
            userId,
            scheduleTermId: currentTerm.id,
            selections: payload.scheduleSelections,
          });
        }
      }

      if (currentTerm && Array.isArray(payload.scheduleDrafts)) {
        for (const d of payload.scheduleDrafts) {
          if (d.name && d.selections) {
            await tx.insert(scheduleProposals).values({
              userId,
              scheduleTermId: currentTerm.id,
              name: d.name,
              selections: d.selections,
            });
            proposalsCount++;
          }
        }
      }

      return { progressCount, electivesCount, basketCount, proposalsCount };
    });

    res.json({
      success: true,
      data: counts,
    });
  } catch (error) {
    console.error('Error importing data:', error);
    res.status(500).json({ success: false, error: 'Error al importar los datos' });
  }
}

export async function exportData(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: 'No autenticado' });
    return;
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !user.selectedPlanId) {
      res.status(400).json({ success: false, error: 'Usuario sin plan activo' });
      return;
    }

    const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.id, user.selectedPlanId)).limit(1);
    const planSubs = await db
      .select({ id: subjects.id, codeInPlan: subjects.codeInPlan })
      .from(subjects)
      .where(eq(subjects.planId, user.selectedPlanId));

    const uuidToCode = new Map<string, number>();
    planSubs.forEach((s) => uuidToCode.set(s.id, s.codeInPlan));

    const [settingsRow] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    const progressRows = await db.select().from(subjectProgress).where(eq(subjectProgress.userId, userId));
    const electivesRows = await db.select().from(electiveAssignments).where(eq(electiveAssignments.userId, userId));
    const basketRows = await db.select().from(userBasket).where(eq(userBasket.userId, userId));
    const proposals = await db.select().from(scheduleProposals).where(eq(scheduleProposals.userId, userId));

    const [currentTerm] = await db.select().from(scheduleTerms).where(eq(scheduleTerms.isCurrent, true)).limit(1);
    let selections: Record<string, string> = {};
    if (currentTerm) {
      const [sel] = await db
        .select()
        .from(scheduleSelections)
        .where(and(eq(scheduleSelections.userId, userId), eq(scheduleSelections.scheduleTermId, currentTerm.id)))
        .limit(1);
      if (sel) selections = sel.selections as any;
    }

    const userState: Record<number, any> = {};
    progressRows.forEach((p) => {
      const code = uuidToCode.get(p.subjectId);
      if (code !== undefined) {
        userState[code] = {
          status: p.status,
          grade: p.grade ? Number(p.grade) : undefined,
          updatedAt: p.updatedAt.toISOString(),
        };
      }
    });

    const assignedElectives: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    electivesRows.forEach((e) => {
      const code = uuidToCode.get(e.subjectId);
      if (code !== undefined && e.year >= 1 && e.year <= 5) {
        if (!assignedElectives[e.year]) assignedElectives[e.year] = [];
        assignedElectives[e.year].push(code);
      }
    });

    const basket: number[] = [];
    basketRows.forEach((b) => {
      const code = uuidToCode.get(b.subjectId);
      if (code !== undefined) basket.push(code);
    });

    const exportPayload = {
      version: '2.1',
      exportDate: new Date().toISOString(),
      plan: plan?.name || 'Plan 2023 ISI UTN',
      userState,
      settings: settingsRow
        ? {
            includePromotionsInGPA: settingsRow.includePromotionsInGPA,
            minPassingGrade: settingsRow.minPassingGrade,
            includeAnalistaTrack: settingsRow.includeAnalistaTrack,
            allowBlockedElectivesPlanning: settingsRow.allowBlockedElectivesPlanning,
            includeElectivesInProgress: settingsRow.includeElectivesInProgress,
            soundEnabled: settingsRow.soundEnabled,
            tutorialCompleted: settingsRow.tutorialCompleted,
          }
        : {},
      basket,
      assignedElectives,
      scheduleDrafts: proposals.map((p) => ({
        id: p.id,
        name: p.name,
        term: currentTerm?.term || '1C',
        selections: p.selections,
        createdAt: p.createdAt.getTime(),
        updatedAt: p.updatedAt.getTime(),
      })),
      scheduleSelections: selections,
      scheduleTerm: currentTerm?.term || '1C',
    };

    res.json({
      success: true,
      data: exportPayload,
    });
  } catch (error) {
    console.error('Error exporting data:', error);
    res.status(500).json({ success: false, error: 'Error al exportar los datos' });
  }
}

export async function deleteAccount(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: 'No autenticado' });
    return;
  }

  try {
    // ON DELETE CASCADE en PostgreSQL elimina todas las filas asociadas
    await db.delete(users).where(eq(users.id, userId));

    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    res.json({
      success: true,
      message: 'Cuenta y datos asociados eliminados definitivamente',
    });
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ success: false, error: 'Error al eliminar la cuenta' });
  }
}
