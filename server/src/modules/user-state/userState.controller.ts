import { Request, Response } from 'express';
import {
  EnrollmentsService,
  serializeEnrollment,
} from '../enrollments/enrollments.service.js';
import { defaultReviewsStore, ReviewsStore } from '../reviews/reviews.store.js';
import {
  extractPlanScheduleSelections,
  extractPlanSettings,
  mergePlanScheduleSelections,
  mergePlanSettings,
} from './userState.helpers.js';
import { defaultUserStateStore, UserStateStore } from './userState.store.js';

export function createUserStateHandlers(
  store: UserStateStore = defaultUserStateStore,
  reviewsStore: ReviewsStore = defaultReviewsStore
) {
  const enrollmentsService = new EnrollmentsService(reviewsStore);

  async function getUserState(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'No autenticado' });
      return;
    }

    try {
      const active = await store.resolveUserActivePlan(userId, req.user?.selectedPlanId);
      if (!active) {
        res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        return;
      }

      const planId = active.planId;
      const planSubs = planId ? await store.getPlanSubjects(planId) : [];
      const planSubjectIds = planSubs.map((s) => s.id);
      const uuidToCode = new Map<string, number>();
      planSubs.forEach((s) => {
        uuidToCode.set(s.id, s.codeInPlan);
      });

      const settingsRow = await store.getUserSettings(userId);
      const settings = extractPlanSettings(settingsRow, planId);

      const progressRows = await store.listSubjectProgress(userId, planSubjectIds);
      const progressByCode: Record<number, { status: string; grade?: number }> = {};
      const progressByUuid: Record<string, { status: string; grade?: number }> = {};

      progressRows.forEach((p) => {
        const code = uuidToCode.get(p.subjectId);
        if (code === undefined) return;
        const entry = {
          status: p.status,
          grade: p.grade ? Number(p.grade) : undefined,
        };
        progressByCode[code] = entry;
        progressByUuid[p.subjectId] = entry;
      });

      const electivesRows = await store.listElectiveAssignments(userId, planSubjectIds);
      const assignedElectives: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
      electivesRows.forEach((e) => {
        const code = uuidToCode.get(e.subjectId);
        if (code !== undefined && e.year >= 1 && e.year <= 5) {
          if (!assignedElectives[e.year]) assignedElectives[e.year] = [];
          assignedElectives[e.year].push(code);
        }
      });

      const basketRows = await store.listUserBasket(userId, planSubjectIds);
      const basketCodes: number[] = [];
      basketRows.forEach((b) => {
        const code = uuidToCode.get(b.subjectId);
        if (code !== undefined) {
          basketCodes.push(code);
        }
      });

      const currentTerm = await store.getCurrentScheduleTerm(active.facultyId);
      let scheduleSelectionMap: Record<string, string> = {};
      if (currentTerm) {
        const sel = await store.getScheduleSelection(userId, currentTerm.id);
        scheduleSelectionMap = extractPlanScheduleSelections(sel, planId);
      }

      const proposals = await store.listScheduleProposals(userId, planId);
      const formattedProposals = proposals.map((p) => ({
        id: p.id,
        name: p.name,
        scheduleTermId: p.scheduleTermId,
        selections: p.selections,
        createdAt: p.createdAt.getTime(),
        updatedAt: p.updatedAt.getTime(),
      }));

      const storedEnrollments = await reviewsStore.listUserEnrollments(userId, planId);
      const formattedEnrollments = storedEnrollments.map(serializeEnrollment);

      const examAttemptsRows = await store.listExamAttempts(userId, planId);
      const formattedExamAttempts = examAttemptsRows.map((r) => ({
        id: r.id,
        subjectId: r.subjectId,
        subjectCode: r.subjectCode,
        date: String(r.examDate),
        grade: Number(r.grade),
        isPassed: Number(r.grade) >= (settings.minPassingGrade || 4),
        notes: r.notes || undefined,
        createdAt: r.createdAt.toISOString(),
      }));

      const hasSavedData =
        progressRows.length > 0 ||
        electivesRows.length > 0 ||
        basketRows.length > 0 ||
        proposals.length > 0 ||
        formattedEnrollments.length > 0 ||
        formattedExamAttempts.length > 0 ||
        settings.tutorialCompleted;

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
          enrollments: formattedEnrollments,
          examAttempts: formattedExamAttempts,
        },
      });
    } catch (error) {
      console.error('Error fetching user state:', error);
      res.status(500).json({ success: false, error: 'Error al obtener estado del usuario' });
    }
  }

  async function updateProgress(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    const subjectId = String(req.params.subjectId);
    const { status, grade } = req.body;

    if (!userId) {
      res.status(401).json({ success: false, error: 'No autenticado' });
      return;
    }

    const validStatuses = [
      'pendiente',
      'cursando',
      'regularizada',
      'aprobada',
      'promocionada',
      'bloqueada',
      'disponible',
      'libre',
    ];
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({ success: false, error: 'Estado de materia inválido' });
      return;
    }

    try {
      const active = await store.resolveUserActivePlan(userId, req.user?.selectedPlanId);
      if (!active || !active.planId) {
        res.status(400).json({ success: false, error: 'El usuario no tiene un plan seleccionado' });
        return;
      }

      const subjectRecord = await store.findPlanSubject(active.planId, subjectId);
      if (!subjectRecord) {
        res.status(404).json({ success: false, error: 'Materia no encontrada en el plan activo' });
        return;
      }

      const gradeVal = grade !== undefined && grade !== null && grade !== '' ? String(grade) : null;
      const normalizedStatus = status === 'disponible' || status === 'bloqueada' ? 'pendiente' : status;

      await store.upsertSubjectProgress(userId, subjectRecord.id, normalizedStatus, gradeVal);

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

  async function updateElectives(req: Request, res: Response): Promise<void> {
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
      const active = await store.resolveUserActivePlan(userId, req.user?.selectedPlanId);
      if (!active || !active.planId) {
        res.status(400).json({ success: false, error: 'Usuario sin plan activo' });
        return;
      }

      const planSubs = await store.getPlanSubjects(active.planId);
      const validElectives = planSubs.filter((s) => s.kind === 'electiva');
      const codeToUuid = new Map<number, string>();
      const uuidSet = new Set<string>();
      validElectives.forEach((e) => {
        codeToUuid.set(e.codeInPlan, e.id);
        uuidSet.add(e.id);
      });

      const seenElectives = new Set<string>();
      const nextAssignments: Array<{ subjectId: string; year: number }> = [];

      for (let year = 1; year <= 5; year++) {
        const list = Array.isArray(rawAssignments[year]) ? rawAssignments[year] : [];
        for (const item of list) {
          let subjectUuid: string | undefined;

          if (typeof item === 'number' || (typeof item === 'string' && /^\d+$/.test(item.trim()))) {
            subjectUuid = codeToUuid.get(Number(item));
          } else if (typeof item === 'string' && uuidSet.has(item)) {
            subjectUuid = item;
          }

          if (subjectUuid && !seenElectives.has(subjectUuid)) {
            seenElectives.add(subjectUuid);
            nextAssignments.push({ subjectId: subjectUuid, year });
          }
        }
      }

      await store.replacePlanElectiveAssignments(
        userId,
        planSubs.map((s) => s.id),
        nextAssignments
      );

      res.json({
        success: true,
        message: 'Electivas actualizadas correctamente',
      });
    } catch (error) {
      console.error('Error updating electives:', error);
      res.status(500).json({ success: false, error: 'Error al actualizar electivas asignadas' });
    }
  }

  async function updateBasket(req: Request, res: Response): Promise<void> {
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
      const active = await store.resolveUserActivePlan(userId, req.user?.selectedPlanId);
      if (!active || !active.planId) {
        res.status(400).json({ success: false, error: 'Usuario sin plan activo' });
        return;
      }

      const planSubs = await store.getPlanSubjects(active.planId);
      const codeToUuid = new Map<number, string>();
      const uuidSet = new Set<string>();
      planSubs.forEach((s) => {
        codeToUuid.set(s.codeInPlan, s.id);
        uuidSet.add(s.id);
      });

      const seen = new Set<string>();
      const nextIds: string[] = [];
      for (const item of basket) {
        let subjectUuid: string | undefined;
        if (typeof item === 'number' || (typeof item === 'string' && /^\d+$/.test(item.trim()))) {
          subjectUuid = codeToUuid.get(Number(item));
        } else if (typeof item === 'string' && uuidSet.has(item)) {
          subjectUuid = item;
        }

        if (subjectUuid && !seen.has(subjectUuid)) {
          seen.add(subjectUuid);
          nextIds.push(subjectUuid);
        }
      }

      await store.replacePlanBasket(
        userId,
        planSubs.map((s) => s.id),
        nextIds
      );

      res.json({
        success: true,
        message: 'Canasta actualizada correctamente',
      });
    } catch (error) {
      console.error('Error updating basket:', error);
      res.status(500).json({ success: false, error: 'Error al actualizar canasta' });
    }
  }

  async function updateSettings(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'No autenticado' });
      return;
    }

    try {
      const active = await store.resolveUserActivePlan(userId, req.user?.selectedPlanId);
      const planId = active?.planId ?? null;
      const existing = await store.getUserSettings(userId);
      const merged = mergePlanSettings(existing, planId, req.body || {});

      await store.upsertUserSettings(userId, merged);

      res.json({
        success: true,
        data: {
          includePromotionsInGPA: merged.includePromotionsInGPA,
          minPassingGrade: merged.minPassingGrade,
          includeAnalistaTrack: merged.includeAnalistaTrack,
          allowBlockedElectivesPlanning: merged.allowBlockedElectivesPlanning,
          includeElectivesInProgress: merged.includeElectivesInProgress,
          soundEnabled: merged.soundEnabled,
          tutorialCompleted: merged.tutorialCompleted,
          notifyLibraryEmail: merged.notifyLibraryEmail,
          extraSettings: merged.extraSettings,
        },
      });
    } catch (error) {
      console.error('Error updating settings:', error);
      res.status(500).json({ success: false, error: 'Error al actualizar configuraciones' });
    }
  }

  async function getScheduleProposals(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'No autenticado' });
      return;
    }

    try {
      const active = await store.resolveUserActivePlan(userId, req.user?.selectedPlanId);
      const proposals = await store.listScheduleProposals(userId, active?.planId ?? null);
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

  async function saveScheduleProposal(req: Request, res: Response): Promise<void> {
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
      const active = await store.resolveUserActivePlan(userId, req.user?.selectedPlanId);
      if (!active || !active.planId) {
        res.status(400).json({ success: false, error: 'Usuario sin plan activo' });
        return;
      }

      let termId: string | undefined;
      if (scheduleTermId) {
        const term = await store.getScheduleTermForFaculty(
          String(scheduleTermId),
          active.facultyId
        );
        if (!term) {
          res.status(404).json({ success: false, error: 'Período lectivo no encontrado' });
          return;
        }
        termId = term.id;
      } else {
        const currTerm = await store.getCurrentScheduleTerm(active.facultyId);
        termId = currTerm?.id;
      }

      if (!termId) {
        res.status(400).json({ success: false, error: 'No se encontró un período lectivo válido' });
        return;
      }

      const result = await store.saveScheduleProposal({
        id: id ? String(id) : undefined,
        userId,
        planId: active.planId,
        scheduleTermId: termId,
        name: String(name),
        selections,
      });

      if (result.notFound) {
        res.status(404).json({ success: false, error: 'Propuesta no encontrada' });
        return;
      }

      res.status(result.created ? 201 : 200).json({ success: true, data: result.proposal });
    } catch (error) {
      console.error('Error saving schedule proposal:', error);
      res.status(500).json({ success: false, error: 'Error al guardar propuesta' });
    }
  }

  async function deleteScheduleProposal(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    const id = String(req.params.id);

    if (!userId) {
      res.status(401).json({ success: false, error: 'No autenticado' });
      return;
    }

    try {
      const active = await store.resolveUserActivePlan(userId, req.user?.selectedPlanId);
      if (!active || !active.planId) {
        res.status(404).json({ success: false, error: 'Propuesta no encontrada' });
        return;
      }

      const deleted = await store.deleteScheduleProposal(userId, active.planId, id);
      if (!deleted) {
        res.status(404).json({ success: false, error: 'Propuesta no encontrada' });
        return;
      }

      res.json({ success: true, message: 'Propuesta eliminada' });
    } catch (error) {
      console.error('Error deleting schedule proposal:', error);
      res.status(500).json({ success: false, error: 'Error al eliminar propuesta' });
    }
  }

  async function saveScheduleSelections(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    const { scheduleTermId, selections } = req.body;

    if (!userId) {
      res.status(401).json({ success: false, error: 'No autenticado' });
      return;
    }

    try {
      const active = await store.resolveUserActivePlan(userId, req.user?.selectedPlanId);
      if (!active || !active.planId) {
        res.status(400).json({ success: false, error: 'Usuario sin plan activo' });
        return;
      }

      let termId: string | undefined;
      if (scheduleTermId) {
        const term = await store.getScheduleTermForFaculty(
          String(scheduleTermId),
          active.facultyId
        );
        if (!term) {
          res.status(404).json({ success: false, error: 'Período lectivo no encontrado' });
          return;
        }
        termId = term.id;
      } else {
        const currTerm = await store.getCurrentScheduleTerm(active.facultyId);
        termId = currTerm?.id;
      }

      if (!termId) {
        res.status(400).json({ success: false, error: 'No se encontró un período lectivo' });
        return;
      }

      const existing = await store.getScheduleSelection(userId, termId);
      const merged = mergePlanScheduleSelections(existing, active.planId, selections || {});
      await store.upsertScheduleSelection(userId, termId, merged);

      res.json({ success: true, message: 'Selecciones de horarios guardadas' });
    } catch (error) {
      console.error('Error saving schedule selections:', error);
      res.status(500).json({ success: false, error: 'Error al guardar selecciones de horario' });
    }
  }

  async function importData(req: Request, res: Response): Promise<void> {
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
      const active = await store.resolveUserActivePlan(userId, req.user?.selectedPlanId);
      if (!active || !active.planId) {
        res.status(400).json({ success: false, error: 'Usuario sin plan activo' });
        return;
      }

      const planSubs = await store.getPlanSubjects(active.planId);
      const codeToUuid = new Map<number, string>();
      planSubs.forEach((s) => codeToUuid.set(s.codeInPlan, s.id));

      const counts = await store.importPlanBundle({
        userId,
        planId: active.planId,
        facultyId: active.facultyId,
        planSubjectIds: planSubs.map((s) => s.id),
        codeToUuid,
        settingsIncoming:
          payload.settings && typeof payload.settings === 'object' ? payload.settings : undefined,
        userState: payload.userState,
        assignedElectives: payload.assignedElectives,
        basket: payload.basket,
        scheduleSelections: payload.scheduleSelections,
        scheduleDrafts: payload.scheduleDrafts,
      });

      let enrollmentsCount = 0;
      if (Array.isArray(payload.enrollments)) {
        for (const item of payload.enrollments) {
          if (!item || typeof item !== 'object') continue;
          const subjectRef = item.subjectCode ?? item.subjectId;
          if (subjectRef === undefined || subjectRef === null) continue;
          try {
            const profNames = Array.isArray(item.professors)
              ? item.professors
                  .map((p: any) => (typeof p === 'string' ? p : p?.displayName))
                  .filter((x: any): x is string => typeof x === 'string' && x.trim().length > 0)
              : Array.isArray(item.professorNames)
              ? item.professorNames
              : undefined;
            const profIds = Array.isArray(item.professorIds) ? item.professorIds : undefined;
            await enrollmentsService.upsertEnrollment({
              userId,
              planId: active.planId,
              subjectIdOrCode: subjectRef,
              commissionCode: typeof item.commissionCode === 'string' ? item.commissionCode : null,
              academicYear: typeof item.academicYear === 'number' ? item.academicYear : null,
              term:
                item.term === '1C' || item.term === '2C' || item.term === 'A' ? item.term : null,
              source: item.source === 'schedule_builder' ? 'schedule_builder' : 'manual',
              professorIds: profIds,
              professorNames: profNames,
            });
            enrollmentsCount++;
          } catch {
            // Ignorar cursadas individuales que no coincidan con el catálogo del plan activo
          }
        }
      }

      res.json({
        success: true,
        data: { ...counts, enrollmentsCount },
      });
    } catch (error) {
      console.error('Error importing data:', error);
      res.status(500).json({ success: false, error: 'Error al importar los datos' });
    }
  }

  async function exportData(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'No autenticado' });
      return;
    }

    try {
      const active = await store.resolveUserActivePlan(userId, req.user?.selectedPlanId);
      if (!active || !active.planId) {
        res.status(400).json({ success: false, error: 'Usuario sin plan activo' });
        return;
      }

      const planSubs = await store.getPlanSubjects(active.planId);
      const planSubjectIds = planSubs.map((s) => s.id);
      const uuidToCode = new Map<string, number>();
      planSubs.forEach((s) => uuidToCode.set(s.id, s.codeInPlan));

      const settingsRow = await store.getUserSettings(userId);
      const activeSettings = extractPlanSettings(settingsRow, active.planId);
      const progressRows = await store.listSubjectProgress(userId, planSubjectIds);
      const electivesRows = await store.listElectiveAssignments(userId, planSubjectIds);
      const basketRows = await store.listUserBasket(userId, planSubjectIds);
      const proposals = await store.listScheduleProposals(userId, active.planId);

      const currentTerm = await store.getCurrentScheduleTerm(active.facultyId);
      let selections: Record<string, string> = {};
      if (currentTerm) {
        const sel = await store.getScheduleSelection(userId, currentTerm.id);
        selections = extractPlanScheduleSelections(sel, active.planId);
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

      const storedEnrollments = await reviewsStore.listUserEnrollments(userId, active.planId);

      const exportPayload = {
        version: '2.2',
        exportDate: new Date().toISOString(),
        plan: active.planName || 'Plan activo',
        userState,
        settings: settingsRow
          ? {
              includePromotionsInGPA: activeSettings.includePromotionsInGPA,
              minPassingGrade: activeSettings.minPassingGrade,
              includeAnalistaTrack: activeSettings.includeAnalistaTrack,
              allowBlockedElectivesPlanning: activeSettings.allowBlockedElectivesPlanning,
              includeElectivesInProgress: activeSettings.includeElectivesInProgress,
              soundEnabled: activeSettings.soundEnabled,
              tutorialCompleted: activeSettings.tutorialCompleted,
            }
          : {},
        basket,
        assignedElectives,
        enrollments: storedEnrollments.map(serializeEnrollment),
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

  async function deleteAccount(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'No autenticado' });
      return;
    }

    try {
      const deleteFiles = req.body?.deleteFiles !== false;
      await store.deleteAccount(userId, deleteFiles);

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

  async function saveExamAttempt(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'No autenticado' });
      return;
    }
    const { subjectIdOrCode, date: examDate, grade, notes } = req.body;
    if (!subjectIdOrCode || !examDate || grade === undefined || grade === null) {
      res.status(400).json({
        success: false,
        error: 'Datos de examen incompletos (materia, fecha y nota requeridos)',
      });
      return;
    }
    const numGrade = Number(grade);
    if (isNaN(numGrade) || numGrade < 1 || numGrade > 10) {
      res.status(400).json({ success: false, error: 'La calificación debe estar entre 1 y 10' });
      return;
    }

    try {
      const active = await store.resolveUserActivePlan(userId, req.user?.selectedPlanId);
      if (!active || !active.planId) {
        res.status(400).json({ success: false, error: 'Usuario sin plan activo' });
        return;
      }

      const sub = await store.findPlanSubject(active.planId, String(subjectIdOrCode));
      if (!sub) {
        res.status(404).json({ success: false, error: 'Materia no encontrada' });
        return;
      }

      const inserted = await store.createExamAttempt({
        userId,
        subjectId: sub.id,
        subjectCode: sub.codeInPlan,
        examDate: String(examDate),
        grade: String(numGrade),
        notes: typeof notes === 'string' ? notes.trim() : null,
      });

      res.json({
        success: true,
        data: {
          id: inserted.id,
          subjectId: sub.id,
          subjectCode: sub.codeInPlan,
          date: inserted.examDate,
          grade: numGrade,
          notes: inserted.notes || undefined,
          createdAt: inserted.createdAt.toISOString(),
        },
      });
    } catch (error) {
      console.error('Error saving exam attempt:', error);
      res.status(500).json({ success: false, error: 'Error al registrar examen final' });
    }
  }

  async function deleteExamAttempt(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'No autenticado' });
      return;
    }
    const id = String(req.params.id);
    try {
      const active = await store.resolveUserActivePlan(userId, req.user?.selectedPlanId);
      if (!active || !active.planId) {
        res.status(404).json({ success: false, error: 'Examen no encontrado' });
        return;
      }

      const deleted = await store.deleteExamAttempt(userId, active.planId, id);
      if (!deleted) {
        res.status(404).json({ success: false, error: 'Examen no encontrado' });
        return;
      }
      res.json({ success: true, data: { id } });
    } catch (error) {
      console.error('Error deleting exam attempt:', error);
      res.status(500).json({ success: false, error: 'Error al eliminar examen final' });
    }
  }

  return {
    getUserState,
    updateProgress,
    updateElectives,
    updateBasket,
    updateSettings,
    getScheduleProposals,
    saveScheduleProposal,
    deleteScheduleProposal,
    saveScheduleSelections,
    importData,
    exportData,
    deleteAccount,
    saveExamAttempt,
    deleteExamAttempt,
  };
}

const defaultHandlers = createUserStateHandlers();

export const {
  getUserState,
  updateProgress,
  updateElectives,
  updateBasket,
  updateSettings,
  getScheduleProposals,
  saveScheduleProposal,
  deleteScheduleProposal,
  saveScheduleSelections,
  importData,
  exportData,
  deleteAccount,
  saveExamAttempt,
  deleteExamAttempt,
} = defaultHandlers;
