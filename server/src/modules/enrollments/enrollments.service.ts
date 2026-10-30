import { parseProfessorName } from '../professors/professorNormalizer.js';
import {
  EnrollmentSource,
  EnrollmentTerm,
  ReviewsStore,
  StoredEnrollment,
} from '../reviews/reviews.store.js';

function appError(message: string, status: number, code?: string): Error {
  const err = new Error(message);
  (err as any).status = status;
  if (code) (err as any).code = code;
  return err;
}

export interface PublicEnrollmentPayload {
  id: string;
  subjectId: string;
  subjectCode: number;
  subjectName: string;
  subjectShortName: string;
  subjectLevel: number;
  commissionId: string | null;
  commissionCode: string | null;
  turno: string | null;
  academicYear: number | null;
  term: EnrollmentTerm | null;
  source: EnrollmentSource;
  professors: Array<{
    professorId: string;
    displayName: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export function serializeEnrollment(enr: StoredEnrollment): PublicEnrollmentPayload {
  return {
    id: enr.id,
    subjectId: enr.subjectId,
    subjectCode: enr.subjectCode,
    subjectName: enr.subjectName,
    subjectShortName: enr.subjectShortName,
    subjectLevel: enr.subjectLevel,
    commissionId: enr.commissionId,
    commissionCode: enr.commissionCode,
    turno: enr.turno,
    academicYear: enr.academicYear,
    term: enr.term,
    source: enr.source,
    professors: enr.professors.map((p) => ({
      professorId: p.professorId,
      displayName: p.displayName,
    })),
    createdAt: enr.createdAt.toISOString(),
    updatedAt: enr.updatedAt.toISOString(),
  };
}

export class EnrollmentsService {
  constructor(private readonly store: ReviewsStore) {}

  async listEnrollments(params: { userId: string; planId?: string | null }) {
    const ctx = await this.store.resolvePlanContext(params.userId, params.planId);
    const enrollments = await this.store.listUserEnrollments(params.userId, ctx?.planId);
    return {
      enrollments: enrollments.map(serializeEnrollment),
    };
  }

  async getSubjectOptions(params: {
    userId: string;
    planId?: string | null;
    subjectIdOrCode: string | number;
  }) {
    const ctx = await this.store.resolvePlanContext(params.userId, params.planId);
    if (!ctx) {
      throw appError('No se encontró un plan de estudios activo para tu cuenta', 400);
    }

    const subject = await this.store.getSubjectByIdOrCode(ctx.planId, params.subjectIdOrCode);
    if (!subject) {
      throw appError('La materia solicitada no pertenece a tu plan de estudios', 404);
    }

    const options = await this.store.getSubjectEnrollmentOptions(
      ctx.planId,
      ctx.facultyId,
      subject.id
    );

    return {
      subject,
      commissions: options.commissions,
      professors: options.professors,
    };
  }

  async upsertEnrollment(params: {
    userId: string;
    planId?: string | null;
    subjectIdOrCode: string | number;
    enrollmentId?: string | null;
    commissionId?: string | null;
    commissionCode?: string | null;
    academicYear?: number | null;
    term?: EnrollmentTerm | null;
    professorIds?: string[];
    professorNames?: string[];
    source?: EnrollmentSource;
  }): Promise<PublicEnrollmentPayload> {
    const ctx = await this.store.resolvePlanContext(params.userId, params.planId);
    if (!ctx) {
      throw appError('No se encontró un plan de estudios activo para tu cuenta', 400);
    }

    const subject = await this.store.getSubjectByIdOrCode(ctx.planId, params.subjectIdOrCode);
    if (!subject) {
      throw appError('La materia seleccionada no pertenece a tu plan de estudios', 404);
    }

    if (params.enrollmentId) {
      const existing = await this.store.getEnrollmentById(params.enrollmentId);
      if (!existing || existing.userId !== params.userId || existing.subjectId !== subject.id) {
        throw appError('Cursada no encontrada', 404, 'ENROLLMENT_NOT_FOUND');
      }
    }

    let resolvedCommissionId: string | null = null;
    let effectiveYear: number | null = params.academicYear ?? null;
    let effectiveTerm: EnrollmentTerm | null = params.term ?? null;
    let autocompletedProfIds: string[] = [];

    if (params.commissionId !== undefined && params.commissionId !== null) {
      const comm = await this.store.getCommissionForEnrollment(params.commissionId);
      if (!comm) {
        throw appError(
          'La comisión seleccionada no existe.',
          400,
          'INVALID_COMMISSION'
        );
      }
      if (comm.subjectId !== subject.id) {
        throw appError(
          'La comisión seleccionada no pertenece a la materia indicada.',
          400,
          'COMMISSION_SUBJECT_MISMATCH'
        );
      }
      resolvedCommissionId = comm.id;
      if (effectiveYear === null) {
        effectiveYear = comm.academicYear;
      }
      if (effectiveTerm === null) {
        effectiveTerm = comm.termOffer === 'A' ? 'A' : comm.scheduleTerm;
      }
      autocompletedProfIds = comm.professorIds;
    } else if (params.commissionCode && params.commissionCode.trim()) {
      const comm = await this.store.findSubjectCommissionByCode({
        subjectUuid: subject.id,
        code: params.commissionCode.trim(),
        academicYear: effectiveYear,
        term: effectiveTerm,
      });
      if (comm) {
        resolvedCommissionId = comm.id;
        if (effectiveYear === null) {
          effectiveYear = comm.academicYear;
        }
        if (effectiveTerm === null) {
          effectiveTerm = comm.termOffer === 'A' ? 'A' : comm.scheduleTerm;
        }
        autocompletedProfIds = comm.professorIds;
      }
    }

    let effectiveProfessorIds: string[] = [];

    if (params.professorIds !== undefined) {
      const uniqueIds = Array.from(new Set(params.professorIds));
      for (const pid of uniqueIds) {
        const prof = await this.store.getProfessorById(pid);
        if (!prof) {
          throw appError(
            'Uno de los docentes seleccionados no existe.',
            400,
            'INVALID_PROFESSOR'
          );
        }
        const teaches = await this.store.doesProfessorTeachSubject(pid, subject.id);
        if (!teaches) {
          throw appError(
            `El docente "${prof.professor.displayName}" no figura dictando "${subject.name}".`,
            400,
            'PROFESSOR_SUBJECT_MISMATCH'
          );
        }
      }
      effectiveProfessorIds = uniqueIds;
    } else if (resolvedCommissionId && autocompletedProfIds.length > 0) {
      effectiveProfessorIds = autocompletedProfIds;
    } else if (params.professorNames && params.professorNames.length > 0) {
      const [allProfs, allAliases] = await Promise.all([
        this.store.listFacultyProfessors(ctx.facultyId),
        this.store.listFacultyAliases(ctx.facultyId),
      ]);
      const profIdByNorm = new Map<string, string>();
      for (const p of allProfs) profIdByNorm.set(p.normalizedKey, p.id);
      for (const a of allAliases) profIdByNorm.set(a.aliasNormalized, a.professorId);

      const resolvedSet = new Set<string>();
      for (const rawName of params.professorNames) {
        if (!rawName || !rawName.trim()) continue;
        const parsed = parseProfessorName(rawName);
        if (!parsed.normalizedKey) continue;
        const pid = profIdByNorm.get(parsed.normalizedKey);
        if (pid) {
          const teaches = await this.store.doesProfessorTeachSubject(pid, subject.id);
          if (teaches) resolvedSet.add(pid);
        }
      }
      effectiveProfessorIds = Array.from(resolvedSet);
    }

    const saved = await this.store.saveUserEnrollment({
      enrollmentId: params.enrollmentId,
      userId: params.userId,
      subjectId: subject.id,
      commissionId: resolvedCommissionId,
      academicYear: effectiveYear,
      term: effectiveTerm,
      source: params.source || 'manual',
      professorIds: effectiveProfessorIds,
    });

    return serializeEnrollment(saved);
  }

  async deleteEnrollment(params: { userId: string; enrollmentId: string }) {
    const result = await this.store.deleteUserEnrollment(params.userId, params.enrollmentId);
    if (!result.deleted) {
      throw appError('Cursada no encontrada', 404, 'ENROLLMENT_NOT_FOUND');
    }
    return {
      deleted: true,
      id: params.enrollmentId,
    };
  }
}

