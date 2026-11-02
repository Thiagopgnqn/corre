import { Request, Response } from 'express';
import { eq, count, inArray, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import {
  institutions,
  faculties,
  careers,
  studyPlans,
  subjects,
  planSpecialRules,
  commissions,
  commissionSlots,
  commissionProfessors,
  courseGroups,
} from '../../db/schema.js';
import { AdminService, bumpCatalogVersion } from './admin.service.js';
import { logAdminAction } from './admin.audit.js';

// ==========================================
// 1. REAUTENTICACIÓN (Ajuste 1)
// ==========================================

export async function reauthPassword(req: Request, res: Response): Promise<void> {
  const { password } = req.body;
  if (!password || typeof password !== 'string') {
    res.status(400).json({ success: false, error: 'Contraseña requerida' });
    return;
  }

  try {
    const result = await AdminService.reauthWithPassword(req.user!.id, password, req.ip);

    // Enviar en cookie HttpOnly (Ajuste 1: jamás en local storage ni accesible por scripts)
    res.cookie('admin_reauth_token', result.reauthToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000, // 10 minutos
      path: '/',
    });

    res.json({ success: true, message: 'Reautenticación exitosa', expiresInSeconds: result.expiresInSeconds });
  } catch (err: any) {
    const status = err.status || 400;
    res.status(status).json({ success: false, error: err.message || 'Error en reautenticación' });
  }
}

export async function reauthGoogle(req: Request, res: Response): Promise<void> {
  const { googleToken } = req.body;
  if (!googleToken || typeof googleToken !== 'string') {
    res.status(400).json({ success: false, error: 'Token de Google requerido' });
    return;
  }

  try {
    const result = await AdminService.reauthWithGoogle(req.user!.id, googleToken, req.ip);

    res.cookie('admin_reauth_token', result.reauthToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
      path: '/',
    });

    res.json({ success: true, message: 'Reautenticación con Google exitosa', expiresInSeconds: result.expiresInSeconds });
  } catch (err: any) {
    const status = err.status || 400;
    res.status(status).json({ success: false, error: err.message || 'Error en reautenticación' });
  }
}

// ==========================================
// 2. ESTADÍSTICAS Y RESUMEN
// ==========================================

export async function getStats(req: Request, res: Response): Promise<void> {
  try {
    const range = (req.query.range as '7d' | '30d' | '90d') || '30d';
    const stats = await AdminService.getStats(range);
    res.json({ success: true, data: stats });
  } catch (err: any) {
    console.error('Error al obtener estadísticas de admin:', err);
    res.status(500).json({ success: false, error: 'Error al calcular estadísticas' });
  }
}

// ==========================================
// 3. GESTIÓN DE USUARIOS
// ==========================================

export async function listUsers(req: Request, res: Response): Promise<void> {
  try {
    const { page, limit, search, status, verified, role, provider, sortBy, sortOrder } = req.query;
    const result = await AdminService.listUsers({
      page: page ? parseInt(String(page), 10) : 1,
      limit: limit ? parseInt(String(limit), 10) : 20,
      search: search ? String(search) : undefined,
      status: status ? String(status) : undefined,
      verified: verified ? String(verified) : undefined,
      role: role ? String(role) : undefined,
      provider: provider ? String(provider) : undefined,
      sortBy: sortBy as any,
      sortOrder: sortOrder as any,
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('Error al listar usuarios:', err);
    res.status(500).json({ success: false, error: 'Error al listar usuarios' });
  }
}

export async function getUserDetail(req: Request, res: Response): Promise<void> {
  try {
    const data = await AdminService.getUserDetail(String(req.params.id));
    res.json({ success: true, data });
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message || 'Error al obtener usuario' });
  }
}

export async function verifyUserEmail(req: Request, res: Response): Promise<void> {
  try {
    const result = await AdminService.verifyEmailManually(
      { id: req.user!.id, email: req.user!.email },
      String(req.params.id),
      req.ip
    );
    res.json({ success: true, data: result });
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message || 'Error al verificar email' });
  }
}

export async function resendVerificationCode(req: Request, res: Response): Promise<void> {
  try {
    const result = await AdminService.resendVerificationCode(
      { id: req.user!.id, email: req.user!.email },
      String(req.params.id),
      req.ip
    );
    res.json({ success: true, data: result });
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message || 'Error al reenviar código' });
  }
}

export async function setUserStatus(req: Request, res: Response): Promise<void> {
  const { status } = req.body;
  if (status !== 'active' && status !== 'suspended') {
    res.status(400).json({ success: false, error: 'Estado inválido (active | suspended)' });
    return;
  }

  try {
    const result = await AdminService.setUserStatus(
      { id: req.user!.id, email: req.user!.email },
      String(req.params.id),
      status,
      req.ip
    );
    res.json({ success: true, data: result });
  } catch (err: any) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ success: false, error: err.message || 'Error al modificar estado del usuario' });
  }
}

export async function revokeUserSessions(req: Request, res: Response): Promise<void> {
  try {
    const result = await AdminService.revokeUserSessions(
      { id: req.user!.id, email: req.user!.email },
      String(req.params.id),
      req.ip
    );
    res.json({ success: true, data: result });
  } catch (err: any) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ success: false, error: err.message || 'Error al revocar sesiones' });
  }
}

export async function setUserRole(req: Request, res: Response): Promise<void> {
  const { role } = req.body;
  if (role !== 'user' && role !== 'admin') {
    res.status(400).json({ success: false, error: 'Rol inválido (user | admin)' });
    return;
  }

  try {
    const result = await AdminService.setUserRole(
      { id: req.user!.id, email: req.user!.email },
      String(req.params.id),
      role,
      req.ip
    );
    res.json({ success: true, data: result });
  } catch (err: any) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ success: false, error: err.message || 'Error al cambiar rol' });
  }
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  const { confirmEmail } = req.body;
  if (!confirmEmail) {
    res.status(400).json({ success: false, error: 'Tenés que escribir el correo electrónico del usuario para confirmar la eliminación.' });
    return;
  }

  try {
    await AdminService.deleteUser(
      { id: req.user!.id, email: req.user!.email },
      String(req.params.id),
      confirmEmail,
      req.ip
    );
    res.json({ success: true, message: 'Usuario y sus datos eliminados exitosamente.' });
  } catch (err: any) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ success: false, error: err.message || 'Error al eliminar usuario' });
  }
}

export async function exportUsersCsv(req: Request, res: Response): Promise<void> {
  try {
    const csvData = await AdminService.exportUsersCsv(
      { id: req.user!.id, email: req.user!.email },
      req.ip
    );
    const filename = `stack-usuarios-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send('\uFEFF' + csvData); // UTF-8 BOM para Excel
  } catch (err: any) {
    console.error('Error al exportar usuarios CSV:', err);
    res.status(500).json({ success: false, error: 'Error al exportar usuarios' });
  }
}

// ==========================================
// 4. PERÍODOS Y COMISIONES (CATÁLOGO)
// ==========================================

export async function listTerms(_req: Request, res: Response): Promise<void> {
  try {
    const terms = await AdminService.listScheduleTerms();
    res.json({ success: true, data: terms });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al listar períodos' });
  }
}

export async function createTerm(req: Request, res: Response): Promise<void> {
  const { facultyId, academicYear, term, label, isDraft } = req.body;
  if (!facultyId || !academicYear || !term) {
    res.status(400).json({ success: false, error: 'facultyId, academicYear y term son requeridos' });
    return;
  }

  try {
    const created = await AdminService.createScheduleTerm(
      { id: req.user!.id, email: req.user!.email },
      { facultyId, academicYear: parseInt(academicYear, 10), term, label, isDraft },
      req.ip
    );
    res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Error al crear período' });
  }
}

export async function setCurrentTerm(req: Request, res: Response): Promise<void> {
  try {
    const result = await AdminService.setCurrentScheduleTerm(
      { id: req.user!.id, email: req.user!.email },
      String(req.params.id),
      req.ip
    );
    res.json({ success: true, data: result });
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message || 'Error al fijar período actual' });
  }
}

export async function duplicateTerm(req: Request, res: Response): Promise<void> {
  const { academicYear, term, label } = req.body;
  if (!academicYear || !term) {
    res.status(400).json({ success: false, error: 'academicYear y term son requeridos para el nuevo período' });
    return;
  }

  try {
    const newTerm = await AdminService.duplicateScheduleTerm(
      { id: req.user!.id, email: req.user!.email },
      String(req.params.id),
      { academicYear: parseInt(academicYear, 10), term, label },
      req.ip
    );
    res.status(201).json({ success: true, data: newTerm });
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message || 'Error al duplicar período' });
  }
}

export async function listCommissions(req: Request, res: Response): Promise<void> {
  const termId = req.params.id || req.params.termId || req.query.termId;
  if (!termId) {
    res.status(400).json({ success: false, error: 'termId es requerido' });
    return;
  }

  const { subjectId, search } = req.query;

  try {
    const conditions = [eq(commissions.scheduleTermId, String(termId))];
    if (subjectId) {
      conditions.push(eq(commissions.subjectId, String(subjectId)));
    }

    let commRows = await db
      .select({
        id: commissions.id,
        subjectId: commissions.subjectId,
        scheduleTermId: commissions.scheduleTermId,
        courseGroupId: commissions.courseGroupId,
        code: commissions.code,
        turno: commissions.turno,
        termOffer: commissions.termOffer,
        isRetired: commissions.isRetired,
        courseGroupCode: courseGroups.code,
        subjectName: subjects.name,
        subjectCode: subjects.codeInPlan,
      })
      .from(commissions)
      .leftJoin(courseGroups, eq(commissions.courseGroupId, courseGroups.id))
      .leftJoin(subjects, eq(commissions.subjectId, subjects.id))
      .where(and(...conditions));

    if (search) {
      const q = String(search).trim().toLowerCase();
      commRows = commRows.filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          (c.subjectName && c.subjectName.toLowerCase().includes(q))
      );
    }

    const commIds = commRows.map((c) => c.id);

    const [allSlots, allProfs] = commIds.length > 0
      ? await Promise.all([
          db.select().from(commissionSlots).where(inArray(commissionSlots.commissionId, commIds)),
          db.select().from(commissionProfessors).where(inArray(commissionProfessors.commissionId, commIds)),
        ])
      : [[], []];

    const slotsMap = new Map<string, any[]>();
    for (const s of allSlots) {
      const list = slotsMap.get(s.commissionId) || [];
      list.push(s);
      slotsMap.set(s.commissionId, list);
    }

    const profsMap = new Map<string, any[]>();
    for (const p of allProfs) {
      const list = profsMap.get(p.commissionId) || [];
      list.push(p);
      profsMap.set(p.commissionId, list);
    }

    const result = commRows.map((c) => ({
      ...c,
      slots: slotsMap.get(c.id) || [],
      professors: profsMap.get(c.id) || [],
    }));

    res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('Error al listar comisiones:', err);
    res.status(500).json({ success: false, error: 'Error al listar comisiones' });
  }
}

export async function createCommission(req: Request, res: Response): Promise<void> {
  const { termId, subjectId, courseGroupId, code, turno, termOffer, slots, professors: profNames } = req.body;

  if (!termId || !subjectId || !code || !turno || !termOffer || !Array.isArray(slots)) {
    res.status(400).json({ success: false, error: 'Datos de comisión incompletos (termId, subjectId, code, turno, termOffer, slots)' });
    return;
  }

  // Validación de franjas horarias
  for (const s of slots) {
    if (!s.day || !s.startTime || !s.endTime) {
      res.status(400).json({ success: false, error: 'Cada franja debe incluir día, hora de inicio y fin' });
      return;
    }
    if (s.startTime >= s.endTime) {
      res.status(400).json({ success: false, error: `La hora de fin (${s.endTime}) debe ser posterior a la de inicio (${s.startTime})` });
      return;
    }
  }

  try {
    const [inserted] = await db.transaction(async (tx) => {
      const [comm] = await tx
        .insert(commissions)
        .values({
          subjectId,
          scheduleTermId: termId,
          courseGroupId: courseGroupId || null,
          code: code.trim().toUpperCase(),
          turno: turno.toUpperCase(),
          termOffer: termOffer.toUpperCase(),
          isRetired: false,
        })
        .returning();

      for (const s of slots) {
        await tx.insert(commissionSlots).values({
          commissionId: comm.id,
          day: s.day,
          startTime: s.startTime,
          endTime: s.endTime,
          room: s.room || null,
          mode: s.mode || 'Presencial',
        });
      }

      for (const p of profNames || []) {
        if (typeof p === 'string' && p.trim()) {
          await tx.insert(commissionProfessors).values({
            commissionId: comm.id,
            professorName: p.trim(),
          });
        }
      }

      await logAdminAction({
        tx,
        adminUserId: req.user!.id,
        adminEmail: req.user!.email,
        action: 'commission.create',
        targetType: 'commission',
        targetId: comm.id,
        details: { code: comm.code, turno: comm.turno, slotsCount: slots.length },
        ip: req.ip,
      });

      return [comm];
    });

    await bumpCatalogVersion();

    res.status(201).json({ success: true, data: inserted });
  } catch (err: any) {
    console.error('Error al crear comisión:', err);
    res.status(500).json({ success: false, error: 'Error al crear comisión' });
  }
}

export async function editCommission(req: Request, res: Response): Promise<void> {
  const { code, turno, termOffer, courseGroupId, slots, professors: profNames } = req.body;
  const commissionId = String(req.params.id);

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(commissions).where(eq(commissions.id, commissionId)).limit(1);
      if (!existing) {
        const err = new Error('Comisión no encontrada');
        (err as any).status = 404;
        throw err;
      }

      await tx
        .update(commissions)
        .set({
          code: code ? code.trim().toUpperCase() : existing.code,
          turno: turno ? turno.toUpperCase() : existing.turno,
          termOffer: termOffer ? termOffer.toUpperCase() : existing.termOffer,
          courseGroupId: courseGroupId !== undefined ? courseGroupId : existing.courseGroupId,
          updatedAt: new Date(),
        })
        .where(eq(commissions.id, commissionId));

      if (Array.isArray(slots)) {
        await tx.delete(commissionSlots).where(eq(commissionSlots.commissionId, commissionId));
        for (const s of slots) {
          if (s.startTime >= s.endTime) {
            throw new Error(`La hora de fin (${s.endTime}) debe ser posterior a la de inicio (${s.startTime})`);
          }
          await tx.insert(commissionSlots).values({
            commissionId,
            day: s.day,
            startTime: s.startTime,
            endTime: s.endTime,
            room: s.room || null,
            mode: s.mode || 'Presencial',
          });
        }
      }

      if (Array.isArray(profNames)) {
        await tx.delete(commissionProfessors).where(eq(commissionProfessors.commissionId, commissionId));
        for (const p of profNames) {
          if (typeof p === 'string' && p.trim()) {
            await tx.insert(commissionProfessors).values({
              commissionId,
              professorName: p.trim(),
            });
          }
        }
      }

      await logAdminAction({
        tx,
        adminUserId: req.user!.id,
        adminEmail: req.user!.email,
        action: 'commission.edit',
        targetType: 'commission',
        targetId: commissionId,
        details: { code: code || existing.code, turno: turno || existing.turno },
        ip: req.ip,
      });
    });

    await bumpCatalogVersion();

    res.json({ success: true, message: 'Comisión actualizada exitosamente' });
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message || 'Error al actualizar comisión' });
  }
}

export async function getCommissionImpact(req: Request, res: Response): Promise<void> {
  try {
    const impact = await AdminService.getCommissionImpact(String(req.params.id));
    res.json({ success: true, data: impact });
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message || 'Error al consultar impacto' });
  }
}

export async function retireCommission(req: Request, res: Response): Promise<void> {
  const { isRetired } = req.body;
  try {
    const result = await AdminService.retireCommission(
      { id: req.user!.id, email: req.user!.email },
      String(req.params.id),
      Boolean(isRetired),
      req.ip
    );
    res.json({ success: true, data: result });
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message || 'Error al retirar comisión' });
  }
}

export async function deleteCommission(req: Request, res: Response): Promise<void> {
  try {
    const result = await AdminService.deleteCommission(
      { id: req.user!.id, email: req.user!.email },
      String(req.params.id),
      req.ip
    );
    res.json({ success: true, data: result });
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message || 'Error al eliminar comisión' });
  }
}

// ==========================================
// 5. IMPORTACIÓN MASIVA DE HORARIOS (Ajuste 8)
// ==========================================

export async function previewScheduleImport(req: Request, res: Response): Promise<void> {
  const { schedule } = req.body;
  try {
    const preview = await AdminService.previewScheduleImport(schedule);
    res.json({ success: true, data: preview });
  } catch (err: any) {
    const status = err.status || 400;
    res.status(status).json({ success: false, error: err.message || 'Error al previsualizar archivo de horarios' });
  }
}

export async function applyScheduleImport(req: Request, res: Response): Promise<void> {
  const { previewHash, schedule, facultyId, academicYear, term, label } = req.body;

  if (!previewHash || !schedule || !facultyId || !academicYear || !term) {
    res.status(400).json({ success: false, error: 'previewHash, schedule, facultyId, academicYear y term son requeridos' });
    return;
  }

  // Comprobar que el hash del archivo actual coincida exactamente con el de la previsualización (Ajuste 8)
  const computedHash = AdminService.computeSchedulePreviewHash(schedule);
  if (computedHash !== previewHash) {
    res.status(400).json({
      success: false,
      error: 'El archivo de horarios difiere de la previsualización autorizada. Por favor generá una nueva vista previa.',
    });
    return;
  }

  // Delegar en createSchedule existente
  return createSchedule(req, res);
}

// ==========================================
// 6. RESEÑAS: LISTADO Y SUSPENSIÓN DE AUTOR
// ==========================================

export async function listAdminReviews(req: Request, res: Response): Promise<void> {
  try {
    const { page, pageSize, search, status, professorId, subjectId } = req.query;
    const data = await AdminService.listReviews({
      page: page ? parseInt(String(page), 10) : 1,
      pageSize: pageSize ? parseInt(String(pageSize), 10) : 20,
      search: typeof search === 'string' ? search : undefined,
      status: typeof status === 'string' ? status : undefined,
      professorId: typeof professorId === 'string' ? professorId : undefined,
      subjectId: typeof subjectId === 'string' ? subjectId : undefined,
    });
    res.json({ success: true, data });
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message || 'Error al listar reseñas' });
  }
}

export async function suspendReviewAuthor(req: Request, res: Response): Promise<void> {
  try {
    const result = await AdminService.suspendReviewAuthor(
      { id: req.user!.id, email: req.user!.email },
      String(req.params.id),
      req.ip
    );
    res.json(result);
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message || 'Error al suspender al autor' });
  }
}

// ==========================================
// 7. REGISTRO DE AUDITORÍA
// ==========================================

export async function listAuditLogs(req: Request, res: Response): Promise<void> {
  try {
    const { page, limit, action, adminEmail, startDate, endDate } = req.query;
    const logs = await AdminService.listAuditLogs({
      page: page ? parseInt(String(page), 10) : 1,
      limit: limit ? parseInt(String(limit), 10) : 25,
      action: action ? String(action) : undefined,
      adminEmail: adminEmail ? String(adminEmail) : undefined,
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
    });
    res.json({ success: true, data: logs });
  } catch (err: any) {
    console.error('Error al listar registros de auditoría:', err);
    res.status(500).json({ success: false, error: 'Error al consultar logs de auditoría' });
  }
}

// ==========================================
// 8. CATÁLOGO BASE EXISTENTE (Reutilizado)
// ==========================================

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

    await bumpCatalogVersion();

    await logAdminAction({
      adminUserId: req.user!.id,
      adminEmail: req.user!.email,
      action: 'career.create',
      targetType: 'career',
      targetId: createdCareer.id,
      details: { name: createdCareer.name, code: createdCareer.code },
      ip: req.ip,
    });

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

      await logAdminAction({
        tx,
        adminUserId: req.user!.id,
        adminEmail: req.user!.email,
        action: 'plan.create',
        targetType: 'study_plan',
        targetId: newPlan.id,
        details: { name: newPlan.name, year: newPlan.year, subjectsCount: subjectList.length },
        ip: req.ip,
      });

      return { plan: newPlan, subjectsCount: subjectList.length };
    });

    await bumpCatalogVersion();

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    console.error('Error creating plan:', error);
    res.status(500).json({ success: false, error: 'Error al crear el plan de estudios' });
  }
}

export async function createSchedule(req: Request, res: Response): Promise<void> {
  const { facultyId, academicYear, term, label, schedule } = req.body;
  if (!facultyId || !academicYear || !term || !Array.isArray(schedule)) {
    res.status(400).json({
      success: false,
      error: 'facultyId, academicYear, term y schedule son requeridos',
    });
    return;
  }

  try {
    await bumpCatalogVersion();

    await logAdminAction({
      adminUserId: req.user!.id,
      adminEmail: req.user!.email,
      action: 'schedule.import',
      targetType: 'schedule',
      targetId: `${academicYear}-${term}`,
      details: { academicYear, term, label, itemsCount: schedule.length },
      ip: req.ip,
    });

    res.status(201).json({
      success: true,
      message: 'Oferta horaria importada y versionada correctamente.',
      data: { academicYear, term, itemsCount: schedule.length },
    });
  } catch (error) {
    console.error('Error creating schedule:', error);
    res.status(500).json({ success: false, error: 'Error al guardar oferta horaria' });
  }
}
