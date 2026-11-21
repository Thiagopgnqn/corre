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
