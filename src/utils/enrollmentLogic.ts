import type { Subject, SubjectStatus, UserCareerState } from '../types/career';
import type {
  EnrollmentTerm,
  PendingReviewPromptItem,
  SubjectCommissionOption,
  SubjectEnrollment,
} from '../types/enrollment';
import type { ReviewableData, ReviewablePair } from '../types/professor';

export const ENROLLABLE_SUBJECT_STATUSES: readonly SubjectStatus[] = [
  'cursando',
  'regularizada',
  'aprobada',
  'promocionada',
] as const;

export const REVIEWABLE_SUBJECT_STATUSES: readonly SubjectStatus[] = [
  'regularizada',
  'aprobada',
  'promocionada',
] as const;

export type StatusChangeTriggerSource =
  | 'status_change'
  | 'map_context'
  | 'quick_modal'
  | 'drawer'
  | 'kanban'
  | 'onboarding_bulk'
  | 'schedule_builder';

export function isEnrollableStatus(status?: SubjectStatus | string | null): boolean {
  if (!status) return false;
  return (ENROLLABLE_SUBJECT_STATUSES as readonly string[]).includes(status);
}

export function isReviewableStatus(status?: SubjectStatus | string | null): boolean {
  if (!status) return false;
  return (REVIEWABLE_SUBJECT_STATUSES as readonly string[]).includes(status);
}

/**
 * Decide si al cambiar el estado de una materia corresponde abrir el paso opcional
 * "¿Con qué comisión la cursaste?" o mostrar el aviso no bloqueante del tablero Kanban.
 *
 * Reglas:
 * - Nunca bloquea ni pregunta durante modo simulación, carga rápida masiva (`onboarding_bulk`)
 *   ni aplicación desde el armador de horarios (`schedule_builder`, que ya guarda la comisión).
 * - Solo aplica cuando el nuevo estado es `cursando`, `regularizada`, `aprobada` o `promocionada`.
 * - Solo pregunta automáticamente si la materia NO tiene aún ninguna cursada registrada
 *   (pasar de `cursando` a `regularizada`/`aprobada`/`promocionada` conserva la cursada sin volver a preguntar).
 * - En `kanban` nunca abre un modal bloqueante: devuelve `shouldShowKanbanHint: true` al soltar en
 *   `cursando` o `regularizada`.
 */
export function evaluateCommissionPromptOnStatusChange(params: {
  prevStatus?: SubjectStatus | null;
  nextStatus: SubjectStatus;
  existingSubjectEnrollments: SubjectEnrollment[];
  isSimulationMode?: boolean;
  source?: StatusChangeTriggerSource;
}): {
  shouldOpenModal: boolean;
  shouldShowKanbanHint: boolean;
} {
  const source = params.source ?? 'status_change';

  if (
    params.isSimulationMode ||
    source === 'onboarding_bulk' ||
    source === 'schedule_builder'
  ) {
    return { shouldOpenModal: false, shouldShowKanbanHint: false };
  }

  if (!isEnrollableStatus(params.nextStatus)) {
    return { shouldOpenModal: false, shouldShowKanbanHint: false };
  }

  if (params.existingSubjectEnrollments.length > 0) {
    return { shouldOpenModal: false, shouldShowKanbanHint: false };
  }

  if (source === 'kanban') {
    const showHint =
      params.nextStatus === 'cursando' || params.nextStatus === 'regularizada';
    return { shouldOpenModal: false, shouldShowKanbanHint: showHint };
  }

  return { shouldOpenModal: true, shouldShowKanbanHint: false };
}

/**
 * Cuando una materia pasa de `cursando` a `regularizada`, `aprobada` o `promocionada`
 * y tiene cursada registrada con docente(s), devuelve los docentes pendientes de reseñar
 * (y no descartados con "Ahora no") para mostrar el aviso discreto:
 * "Cursaste [materia] con [profesor]: ¿querés dejar una reseña?"
 */
export function getReviewPromptsOnRegularizeTransition(params: {
  prevStatus?: SubjectStatus | null;
  nextStatus: SubjectStatus;
  existingSubjectEnrollments: SubjectEnrollment[];
  reviewedPairKeys?: Set<string>;
  dismissedPairKeys?: Set<string>;
}): PendingReviewPromptItem[] {
  if (params.prevStatus !== 'cursando' || !isReviewableStatus(params.nextStatus)) {
    return [];
  }

  const reviewed = params.reviewedPairKeys ?? new Set<string>();
  const dismissed = params.dismissedPairKeys ?? new Set<string>();
  const seenProfs = new Set<string>();
  const prompts: PendingReviewPromptItem[] = [];

  for (const enr of params.existingSubjectEnrollments) {
    for (const prof of enr.professors) {
      const pairKey = `${prof.professorId}::${enr.subjectId}`;
      if (reviewed.has(pairKey) || dismissed.has(pairKey) || seenProfs.has(prof.professorId)) {
        continue;
      }
      seenProfs.add(prof.professorId);
      prompts.push({
        professorId: prof.professorId,
        professorName: prof.displayName,
        subjectId: enr.subjectId,
        subjectCode: enr.subjectCode,
        subjectName: enr.subjectName,
        academicYear: enr.academicYear,
        term: enr.term,
      });
    }
  }

  return prompts;
}

/**
 * Filtra las tarjetas activas para la sección "Profesores que podés reseñar"
 * arriba del directorio: pares recomendados a partir de las cursadas del usuario,
 * en materias ya regularizadas/aprobadas/promocionadas, no reseñados aún y no descartados.
 */
export function getActiveRecommendedReviewPairs(
  reviewable: Pick<ReviewableData, 'eligible'> | null | undefined
): ReviewablePair[] {
  if (!reviewable) return [];
  return reviewable.eligible.filter(
    (pair) => Boolean(pair.recommended) && !pair.alreadyReviewed && !pair.dismissed
  );
}

export interface MissingEnrollmentSubject {
  subject: Subject;
  subjectId: string;
  subjectCode: number;
  subjectName: string;
  status: SubjectStatus;
}

/**
 * Devuelve las materias que el usuario tiene en estado `cursando`, `regularizada`,
 * `aprobada` o `promocionada` pero todavía sin docentes registrados en ninguna cursada.
 * Alimenta el cartel amable "Contanos con quién cursaste" en la pestaña Profesores.
 */
export function getSubjectsMissingDeclaredProfessors(
  arg1: { subjects: Subject[]; userState?: UserCareerState; enrollments: SubjectEnrollment[] } | Subject[],
  arg2?: SubjectEnrollment[]
): MissingEnrollmentSubject[] {
  let subjects: Subject[];
  let userState: UserCareerState | undefined;
  let enrollments: SubjectEnrollment[];

  if (Array.isArray(arg1)) {
    subjects = arg1;
    enrollments = arg2 || [];
  } else {
    subjects = arg1.subjects;
    userState = arg1.userState;
    enrollments = arg1.enrollments;
  }

  const subjectsWithProfessors = new Set<string | number>();
  for (const enr of enrollments) {
    if (enr.professors && enr.professors.length > 0) {
      if (enr.subjectId) subjectsWithProfessors.add(enr.subjectId);
      if (enr.subjectCode) subjectsWithProfessors.add(enr.subjectCode);
    }
  }

  const missing: MissingEnrollmentSubject[] = [];
  for (const sub of subjects) {
    const st = userState?.[sub.id]?.status ?? (sub as any).status;
    if (st && isEnrollableStatus(st) && !subjectsWithProfessors.has(sub.id) && !subjectsWithProfessors.has(String(sub.id))) {
      missing.push({
        subject: sub,
        subjectId: String(sub.id),
        subjectCode: sub.id,
        subjectName: sub.name,
        status: st,
      });
    }
  }

  return missing;
}

/**
 * Devuelve la lista de IDs de docentes autocompletados al elegir una comisión cargada.
 */
export function getAutocompletedProfessorIdsFromCommission(
  commission: Pick<SubjectCommissionOption, 'professors'> | null | undefined
): string[] {
  if (!commission) return [];
  return Array.from(new Set(commission.professors.map((p) => p.professorId)));
}

/**
 * Formatea año y cuatrimestre/modalidad de una cursada en español legible.
 */
export function formatEnrollmentPeriodLabel(
  academicYear?: number | null,
  term?: EnrollmentTerm | null
): string {
  const termHuman =
    term === '1C'
      ? '1° Cuatr.'
      : term === '2C'
      ? '2° Cuatr.'
      : term === 'A'
      ? 'Anual'
      : null;

  if (academicYear && termHuman) return `${academicYear} · ${termHuman}`;
  if (academicYear) return `Ciclo ${academicYear}`;
  if (termHuman) return termHuman;
  return 'Período sin especificar';
}

