import type { Subject, SubjectStatus, UserCareerState, UserSubjectState } from '../types/career';
import type {
  EnrollmentTerm,
  PendingReviewPromptItem,
  SubjectCommissionOption,
  SubjectEnrollment,
  UpsertEnrollmentInput,
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

export type UpgradableSubjectStatus = 'regularizada' | 'promocionada';

export interface EnrollmentSubjectStatusResolution {
  shouldUpdate: boolean;
  nextStatus: UpgradableSubjectStatus | string | null;
}

export const SUBJECT_STATUS_RANK: Readonly<Record<string, number>> = {
  pendiente: 0,
  disponible: 0,
  bloqueada: 0,
  libre: 0,
  cursando: 1,
  regularizada: 2,
  aprobada: 3,
  promocionada: 4,
};

export function getSubjectStatusRank(status?: string | null): number | null {
  if (status === null || status === undefined) {
    return 0;
  }
  if (typeof status !== 'string') {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(SUBJECT_STATUS_RANK, status)
    ? SUBJECT_STATUS_RANK[status]
    : null;
}

/**
 * Determina si el estado académico de una materia debe actualizarse a partir del
 * resultado de una cursada (`enrollmentStatus`).
 *
 * Reglas de negocio:
 * 1. Si el resultado de la cursada es `'promocionada'`, propone `'promocionada'`.
 *    Si es `'regularizada'`, propone `'regularizada'`.
 * 2. Nunca baja de estado:
 *    null/undefined/pendiente/disponible/bloqueada/libre (0) < cursando (1) < regularizada (2) < aprobada (3) < promocionada (4).
 *    Si la materia ya tiene un estado de rango igual o mayor, no se modifica (`shouldUpdate: false`).
 * 3. Si la cursada está en `'cursando'`, `'libre'`, `null`, `undefined` o un valor desconocido,
 *    no cambia el estado de la materia (`shouldUpdate: false`).
 * 4. Si `currentStatus` es un estado desconocido (string fuera de la jerarquía conocida),
 *    no cambia nada (`shouldUpdate: false`).
 */
export function resolveSubjectStatusFromEnrollment(
  currentStatus?: string | null,
  enrollmentStatus?: string | null
): EnrollmentSubjectStatusResolution {
  const preservedStatus = currentStatus ?? null;

  if (enrollmentStatus !== 'regularizada' && enrollmentStatus !== 'promocionada') {
    return {
      shouldUpdate: false,
      nextStatus: preservedStatus,
    };
  }

  const currentRank = getSubjectStatusRank(currentStatus);
  if (currentRank === null) {
    return {
      shouldUpdate: false,
      nextStatus: preservedStatus,
    };
  }

  const targetStatus: UpgradableSubjectStatus = enrollmentStatus;
  const targetRank = SUBJECT_STATUS_RANK[targetStatus];

  if (targetRank > currentRank) {
    return {
      shouldUpdate: true,
      nextStatus: targetStatus,
    };
  }

  return {
    shouldUpdate: false,
    nextStatus: preservedStatus,
  };
}

const VALID_SUBJECT_STATUSES: ReadonlySet<string> = new Set<SubjectStatus>([
  'bloqueada',
  'disponible',
  'cursando',
  'regularizada',
  'aprobada',
  'promocionada',
  'libre',
]);

/**
 * Aplica de forma monotónica el `subjectStatus` devuelto por el servidor tras guardar una cursada
 * sobre la entrada local `userState[subjectCode]`.
 *
 * - Si `serverSubjectStatus` es `undefined`, `null` o desconocido -> `null` (sin cambio).
 * - Si el estado local actual es desconocido -> `null` (sin cambio).
 * - Solo devuelve una nueva entrada si `rank(serverSubjectStatus) > rank(estado local actual)`.
 * - Nunca baja de estado y conserva `grade` local si existía.
 */
export function applyServerSubjectStatus(
  currentEntry: UserSubjectState | null | undefined,
  serverSubjectStatus?: string | null,
  nowIso?: string
): UserSubjectState | null {
  if (
    serverSubjectStatus === null ||
    serverSubjectStatus === undefined ||
    typeof serverSubjectStatus !== 'string' ||
    serverSubjectStatus.trim() === ''
  ) {
    return null;
  }

  if (!VALID_SUBJECT_STATUSES.has(serverSubjectStatus)) {
    return null;
  }

  const targetRank = getSubjectStatusRank(serverSubjectStatus);
  if (targetRank === null) {
    return null;
  }

  const currentRank = getSubjectStatusRank(currentEntry?.status);
  if (currentRank === null) {
    return null;
  }

  if (targetRank <= currentRank) {
    return null;
  }

  const nextEntry: UserSubjectState = {
    ...(currentEntry ?? {}),
    status: serverSubjectStatus as SubjectStatus,
    updatedAt: nowIso ?? new Date().toISOString(),
  };

  if (currentEntry?.grade !== undefined) {
    nextEntry.grade = currentEntry.grade;
  } else {
    delete nextEntry.grade;
  }

  return nextEntry;
}

/**
 * Indica si está permitido abrir o guardar una cursada en el contexto actual.
 * En modo simulación queda bloqueado para evitar tocar el estado real o el servidor.
 */
export function canSaveEnrollmentInSimulation(isSimulationMode?: boolean | null): boolean {
  return !isSimulationMode;
}

export function mergeSavedEnrollmentList(
  prevEnrollments: SubjectEnrollment[],
  saved: SubjectEnrollment
): SubjectEnrollment[] {
  const filtered = prevEnrollments.filter((e) => e.id !== saved.id);
  return [saved, ...filtered];
}

export function mergeSavedEnrollmentUserState(
  prevUserState: UserCareerState,
  subjectCode: number,
  serverSubjectStatus?: string | null,
  nowIso?: string
): UserCareerState {
  const updatedEntry = applyServerSubjectStatus(
    prevUserState[subjectCode],
    serverSubjectStatus,
    nowIso
  );
  if (!updatedEntry) return prevUserState;
  return {
    ...prevUserState,
    [subjectCode]: updatedEntry,
  };
}

/**
 * Orquestación compartida por `CareerContext.saveSubjectEnrollment` y los tests frontend:
 * corta antes de llamar al servidor o tocar estado si está activo el modo simulación,
 * y al guardar aplica monotónicamente `saved.subjectStatus` sobre `userState[subjectCode]`.
 */
export async function executeSaveSubjectEnrollment(params: {
  isSimulationMode?: boolean | null;
  subjectCode: number;
  input: UpsertEnrollmentInput;
  upsertEnrollment: (
    subjectCode: number,
    input: UpsertEnrollmentInput
  ) => Promise<{ data: SubjectEnrollment }>;
  applyEnrollmentsUpdate: (
    updater: (prev: SubjectEnrollment[]) => SubjectEnrollment[]
  ) => void;
  applyUserStateUpdate: (
    updater: (prev: UserCareerState) => UserCareerState
  ) => void;
  nowIso?: string;
}): Promise<SubjectEnrollment> {
  if (!canSaveEnrollmentInSimulation(params.isSimulationMode)) {
    throw new Error('No disponible en modo simulación');
  }
  const res = await params.upsertEnrollment(params.subjectCode, params.input);
  const saved = res.data;
  params.applyEnrollmentsUpdate((prev) => mergeSavedEnrollmentList(prev, saved));
  params.applyUserStateUpdate((prev) =>
    mergeSavedEnrollmentUserState(prev, params.subjectCode, saved.subjectStatus, params.nowIso)
  );
  return saved;
}

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

