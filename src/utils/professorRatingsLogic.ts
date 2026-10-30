import type { Commission, ProfessorRef } from '../types/schedule';
import type { ProfessorBatchRating, RatingStatus } from '../types/professor';

/**
 * Normaliza un nombre crudo de profesor al mismo formato de clave canónica
 * insensible al orden que usa el backend (`normalized_key`).
 */
export function normalizeProfessorLookupKey(rawName: string): string {
  if (!rawName || typeof rawName !== 'string') return '';
  const cleaned = rawName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/([a-z])['´`’]([a-z])/g, '$1$2')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';
  const tokens = Array.from(new Set(cleaned.split(' ').filter(Boolean))).sort();
  return tokens.join(' ');
}

/**
 * Formatea un puntaje decimal con coma española (ej. 4.6 -> "4,6").
 */
export function formatRatingDecimal(value: number, decimals = 1): string {
  return value.toFixed(decimals).replace('.', ',');
}

export interface ProfessorBadgeState {
  status: RatingStatus;
  label: string;
  shortLabel: string;
  average: number | null;
  count: number;
}

/**
 * Construye el estado e inscripción visual de la insignia de valoración de un profesor:
 * - 0 reseñas: "Sin reseñas"
 * - 1..2 reseñas (< umbral confiable): "Pocas reseñas" + cantidad
 * - >= 3 reseñas: "★ 4,6 · 23"
 */
export function formatProfessorBadgeState(
  rating?: Pick<
    ProfessorBatchRating,
    'reviewCount' | 'hasReliableAverage' | 'ratingStatus' | 'averageOverall'
  > | null
): ProfessorBadgeState {
  if (!rating || rating.reviewCount <= 0 || rating.ratingStatus === 'sin_resenas') {
    return {
      status: 'sin_resenas',
      label: 'Sin reseñas',
      shortLabel: 'Sin reseñas',
      average: null,
      count: 0,
    };
  }

  if (!rating.hasReliableAverage || rating.averageOverall === null) {
    return {
      status: 'pocas_resenas',
      label: `Pocas reseñas · ${rating.reviewCount}`,
      shortLabel: `Pocas reseñas (${rating.reviewCount})`,
      average: null,
      count: rating.reviewCount,
    };
  }

  const formattedAvg = formatRatingDecimal(rating.averageOverall, 1);
  return {
    status: 'confiable',
    label: `★ ${formattedAvg} · ${rating.reviewCount}`,
    shortLabel: `★ ${formattedAvg}`,
    average: rating.averageOverall,
    count: rating.reviewCount,
  };
}

export type ProfessorRatingResolver = (ref: {
  id?: string | null;
  name: string;
}) => ProfessorBatchRating | null;

export interface ResolvedCommissionProfessor {
  id: string | null;
  name: string;
  rating: ProfessorBatchRating | null;
  badge: ProfessorBadgeState;
}

export interface CommissionCombinedRating {
  professors: ResolvedCommissionProfessor[];
  combinedAverage: number | null;
  reliableCount: number;
  totalReviewCount: number;
  hasAnyReviews: boolean;
}

/**
 * Calcula la valoración individual y combinada de una comisión a partir de sus docentes.
 * La valoración combinada se calcula sobre los docentes de la comisión que tienen promedio confiable (>= 3 reseñas).
 */
export function computeCommissionCombinedRating(
  commission: Pick<Commission, 'professors' | 'professorRefs'>,
  resolveRating: ProfessorRatingResolver
): CommissionCombinedRating {
  const refs: ProfessorRef[] =
    commission.professorRefs && commission.professorRefs.length > 0
      ? commission.professorRefs
      : commission.professors.map((name) => ({ id: null, name }));

  const resolved: ResolvedCommissionProfessor[] = refs.map((ref) => {
    const rating = resolveRating(ref);
    return {
      id: rating?.professorId || ref.id || null,
      name: ref.name,
      rating,
      badge: formatProfessorBadgeState(rating),
    };
  });

  let reliableSum = 0;
  let reliableCount = 0;
  let totalReviewCount = 0;

  for (const item of resolved) {
    const count = item.rating?.reviewCount || 0;
    totalReviewCount += count;
    if (
      item.rating &&
      item.rating.hasReliableAverage &&
      item.rating.averageOverall !== null
    ) {
      reliableSum += item.rating.averageOverall;
      reliableCount += 1;
    }
  }

  const combinedAverage =
    reliableCount > 0 ? Math.round((reliableSum / reliableCount) * 100) / 100 : null;

  return {
    professors: resolved,
    combinedAverage,
    reliableCount,
    totalReviewCount,
    hasAnyReviews: totalReviewCount > 0,
  };
}

/**
 * Calcula la valoración promedio de los profesores sobre todas las comisiones
 * seleccionadas en el horario semanal actual.
 */
export function computeScheduleAverageRating(
  commissions: Array<Pick<Commission, 'professors' | 'professorRefs'>>,
  resolveRating: ProfessorRatingResolver
): {
  averageRating: number | null;
  ratedCommissionsCount: number;
  totalCommissionsCount: number;
} {
  let sum = 0;
  let ratedCommissionsCount = 0;

  for (const comm of commissions) {
    const { combinedAverage } = computeCommissionCombinedRating(comm, resolveRating);
    if (combinedAverage !== null) {
      sum += combinedAverage;
      ratedCommissionsCount += 1;
    }
  }

  return {
    averageRating:
      ratedCommissionsCount > 0
        ? Math.round((sum / ratedCommissionsCount) * 100) / 100
        : null,
    ratedCommissionsCount,
    totalCommissionsCount: commissions.length,
  };
}

/**
 * Filtra y ordena comisiones de una materia en el Armador de Horarios según
 * valoración mínima ("minRating") y ordenamiento ("Mejor valoradas primero").
 */
export function filterAndSortCommissionsByRating<T extends Commission>(
  commissions: T[],
  options: {
    minRating: number;
    sortByRating: boolean;
  },
  resolveRating: ProfessorRatingResolver
): T[] {
  const annotated = commissions.map((comm, originalIndex) => ({
    comm,
    originalIndex,
    combined: computeCommissionCombinedRating(comm, resolveRating),
  }));

  const filtered =
    options.minRating > 0
      ? annotated.filter(
          (item) =>
            item.combined.combinedAverage !== null &&
            item.combined.combinedAverage >= options.minRating
        )
      : annotated;

  if (!options.sortByRating) {
    return filtered.map((item) => item.comm);
  }

  const sorted = [...filtered].sort((a, b) => {
    const avgA = a.combined.combinedAverage;
    const avgB = b.combined.combinedAverage;

    // 1. Comisiones con promedio confiable primero, de mayor a menor
    if (avgA !== null && avgB !== null) {
      if (avgB !== avgA) return avgB - avgA;
      if (b.combined.totalReviewCount !== a.combined.totalReviewCount) {
        return b.combined.totalReviewCount - a.combined.totalReviewCount;
      }
      return a.originalIndex - b.originalIndex;
    }
    if (avgA !== null && avgB === null) return -1;
    if (avgA === null && avgB !== null) return 1;

    // 2. Comisiones con pocas reseñas antes que las que no tienen ninguna
    if (b.combined.totalReviewCount !== a.combined.totalReviewCount) {
      return b.combined.totalReviewCount - a.combined.totalReviewCount;
    }

    return a.originalIndex - b.originalIndex;
  });

  return sorted.map((item) => item.comm);
}

/**
 * Etiqueta accesible en español para lectores de pantalla en selector de estrellas.
 */
export function getStarAriaLabel(starValue: number, maxStars = 5): string {
  const noun = starValue === 1 ? 'estrella' : 'estrellas';
  return `${starValue} de ${maxStars} ${noun}`;
}

/**
 * Navegación accesible por teclado para el componente de estrellas (WAI-ARIA RadioGroup):
 * - ArrowRight / ArrowUp: incrementa hasta maxStars
 * - ArrowLeft / ArrowDown: decrementa hasta minStars
 * - Home: minStars
 * - End: maxStars
 * - Teclas numéricas '1'..'5': selecciona ese puntaje directamente
 * Devuelve el nuevo valor o `null` si la tecla no corresponde al control.
 */
export function handleStarRatingKeyDown(
  key: string,
  currentValue: number,
  minStars = 1,
  maxStars = 5
): number | null {
  const safeCurrent = currentValue > 0 ? currentValue : minStars;

  if (key === 'ArrowRight' || key === 'ArrowUp') {
    return currentValue <= 0 ? minStars : Math.min(maxStars, safeCurrent + 1);
  }
  if (key === 'ArrowLeft' || key === 'ArrowDown') {
    return Math.max(minStars, safeCurrent - 1);
  }
  if (key === 'Home') {
    return minStars;
  }
  if (key === 'End') {
    return maxStars;
  }
  if (/^[1-9]$/.test(key)) {
    const num = Number(key);
    if (num >= minStars && num <= maxStars) {
      return num;
    }
  }
  return null;
}

