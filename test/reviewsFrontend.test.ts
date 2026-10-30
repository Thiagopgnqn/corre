import {
  normalizeProfessorLookupKey,
  formatProfessorBadgeState,
  computeCommissionCombinedRating,
  computeScheduleAverageRating,
  filterAndSortCommissionsByRating,
  getStarAriaLabel,
  handleStarRatingKeyDown,
  type ProfessorRatingResolver,
} from '../src/utils/professorRatingsLogic';
import { generateScheduleCombinations } from '../src/utils/scheduleLogic';
import type { ProfessorBatchRating } from '../src/types/professor';
import type { Commission, SubjectSchedule } from '../src/types/schedule';

function assert(cond: boolean, message: string) {
  if (!cond) {
    throw new Error(`Fallo de aserción: ${message}`);
  }
}

console.log('Ejecutando pruebas de lógica frontend para Reseñas de Profesores y Armador de Horarios...');

// Helper para crear un ProfessorBatchRating sintético
function makeBatchRating(params: {
  id: string;
  displayName: string;
  reviewCount: number;
  averageOverall: number | null;
  hasReliableAverage?: boolean;
  recommendPercent?: number | null;
}): ProfessorBatchRating {
  const hasReliable = params.hasReliableAverage ?? params.reviewCount >= 3;
  const ratingStatus =
    params.reviewCount === 0
      ? 'sin_resenas'
      : hasReliable
      ? 'confiable'
      : 'pocas_resenas';

  return {
    professorId: params.id,
    displayName: params.displayName,
    normalizedKey: normalizeProfessorLookupKey(params.displayName),
    reviewCount: params.reviewCount,
    hasReliableAverage: hasReliable,
    ratingStatus,
    averageOverall: hasReliable ? params.averageOverall : null,
    bayesianScore: hasReliable && params.averageOverall ? params.averageOverall : 0,
    averageClarity: null,
    averageTreatment: null,
    averageAvailability: null,
    averageDifficulty: null,
    recommendPercent: hasReliable ? (params.recommendPercent ?? 90) : null,
    recommendCount: 0,
    recommendTotal: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: params.reviewCount },
    recentReviews: [],
  };
}

// 1. Normalización de búsqueda de nombres en frontend (insensible al orden y tildes)
assert(
  normalizeProfessorLookupKey('Botta, Oscar') === normalizeProfessorLookupKey('Oscar, Botta'),
  '"Botta, Oscar" y "Oscar, Botta" deben producir la misma clave normalizada'
);
assert(
  normalizeProfessorLookupKey('D´Agostino, José Luis') ===
    normalizeProfessorLookupKey("D'Agostino, Jose Luis"),
  'Apóstrofes y tildes deben normalizarse de forma idéntica'
);

// 2. Estados de insignia en el Armador de Horarios ("Sin reseñas", "Pocas reseñas", "★ 4,6 · 23")
const badgeEmpty = formatProfessorBadgeState(null);
assert(badgeEmpty.status === 'sin_resenas', 'Sin datos debe ser sin_resenas');
assert(badgeEmpty.label === 'Sin reseñas', 'Etiqueta sin datos debe ser "Sin reseñas"');

const profZero = makeBatchRating({
  id: 'p-0',
  displayName: 'Álvarez, Marta',
  reviewCount: 0,
  averageOverall: null,
});
assert(
  formatProfessorBadgeState(profZero).label === 'Sin reseñas',
  '0 reseñas debe mostrar "Sin reseñas"'
);

const profFew = makeBatchRating({
  id: 'p-2',
  displayName: 'Gómez, Lucas',
  reviewCount: 2,
  averageOverall: 4.5,
  hasReliableAverage: false,
});
const badgeFew = formatProfessorBadgeState(profFew);
assert(badgeFew.status === 'pocas_resenas', '2 reseñas debe tener estado pocas_resenas');
assert(
  badgeFew.label === 'Pocas reseñas · 2',
  `2 reseñas debe mostrar "Pocas reseñas · 2", obtuvo "${badgeFew.label}"`
);
assert(badgeFew.average === null, 'Con < 3 reseñas no debe exponer promedio numérico confiable');

const profReliable = makeBatchRating({
  id: 'p-23',
  displayName: 'Botta, Oscar Ernesto',
  reviewCount: 23,
  averageOverall: 4.6,
  hasReliableAverage: true,
});
const badgeReliable = formatProfessorBadgeState(profReliable);
assert(badgeReliable.status === 'confiable', '23 reseñas debe ser confiable');
assert(
  badgeReliable.label === '★ 4,6 · 23',
  `Insignia confiable esperada "★ 4,6 · 23", obtuvo "${badgeReliable.label}"`
);

// 3. Valoración combinada de comisión con múltiples docentes y promedio semanal de propuesta
const profReliableB = makeBatchRating({
  id: 'p-10',
  displayName: 'Romoli, Irene Esther',
  reviewCount: 10,
  averageOverall: 4.2,
  hasReliableAverage: true,
});

const ratingsById: Record<string, ProfessorBatchRating> = {
  [profZero.professorId]: profZero,
  [profFew.professorId]: profFew,
  [profReliable.professorId]: profReliable,
  [profReliableB.professorId]: profReliableB,
};

const ratingsByNorm: Record<string, ProfessorBatchRating> = {
  [profZero.normalizedKey]: profZero,
  [profFew.normalizedKey]: profFew,
  [profReliable.normalizedKey]: profReliable,
  [profReliableB.normalizedKey]: profReliableB,
};

const resolver: ProfessorRatingResolver = (ref) => {
  if (ref.id && ratingsById[ref.id]) return ratingsById[ref.id];
  const norm = normalizeProfessorLookupKey(ref.name);
  return ratingsByNorm[norm] || null;
};

const multiProfCommission: Commission = {
  id: '6-1K1',
  code: '1K1',
  turno: 'mañana',
  professors: ['Botta, Oscar Ernesto', 'Romoli, Irene Esther', 'Gómez, Lucas'],
  professorRefs: [
    { id: 'p-23', name: 'Botta, Oscar Ernesto' },
    { id: 'p-10', name: 'Romoli, Irene Esther' },
    { id: 'p-2', name: 'Gómez, Lucas' }, // solo 2 reseñas -> no entra al promedio confiable combinado
  ],
  slots: [{ day: 'LUN', start: '08:00', end: '10:15' }],
};

const combined = computeCommissionCombinedRating(multiProfCommission, resolver);
assert(combined.reliableCount === 2, 'Solo los 2 docentes con >= 3 reseñas entran al promedio combinado');
assert(
  combined.combinedAverage === 4.4,
  `Promedio combinado esperado 4.4 ((4.6 + 4.2)/2), obtuvo ${combined.combinedAverage}`
);
assert(combined.totalReviewCount === 35, 'Total de reseñas acumuladas debe ser 23 + 10 + 2 = 35');

const unratedCommission: Commission = {
  id: '8-1K2',
  code: '1K2',
  turno: 'mañana',
  professors: ['Álvarez, Marta'],
  slots: [{ day: 'MAR', start: '08:00', end: '10:15' }],
};

const singleRatedCommission: Commission = {
  id: '1-1K3',
  code: '1K3',
  turno: 'tarde',
  professors: ['Botta, Oscar Ernesto'],
  slots: [{ day: 'MIE', start: '14:00', end: '16:15' }],
};

const scheduleAvg = computeScheduleAverageRating(
  [multiProfCommission, unratedCommission, singleRatedCommission],
  resolver
);
assert(scheduleAvg.totalCommissionsCount === 3, 'Total de comisiones seleccionadas debe ser 3');
assert(scheduleAvg.ratedCommissionsCount === 2, '2 de las 3 comisiones tienen promedio confiable');
assert(
  scheduleAvg.averageRating === 4.5,
  `Promedio semanal esperado 4.5 ((4.4 + 4.6)/2), obtuvo ${scheduleAvg.averageRating}`
);

// 4. Filtro "Valoración mínima" y ordenamiento "Mejor valoradas primero" en lista de comisiones
const fewReviewsCommission: Commission = {
  id: '9-1K4',
  code: '1K4',
  turno: 'noche',
  professors: ['Gómez, Lucas'],
  slots: [{ day: 'JUE', start: '19:00', end: '21:15' }],
};

const allCandidateCommissions = [
  unratedCommission, // sin reseñas
  multiProfCommission, // promedio 4.4
  fewReviewsCommission, // pocas reseñas (2)
  singleRatedCommission, // promedio 4.6
];

const filteredMin45 = filterAndSortCommissionsByRating(
  allCandidateCommissions,
  { minRating: 4.5, sortByRating: false },
  resolver
);
assert(
  filteredMin45.length === 1 && filteredMin45[0].id === '1-1K3',
  'El filtro minRating=4.5 solo debe dejar la comisión con promedio >= 4.5'
);

const sortedBestFirst = filterAndSortCommissionsByRating(
  allCandidateCommissions,
  { minRating: 0, sortByRating: true },
  resolver
);
assert(
  sortedBestFirst.map((c) => c.id).join(',') === '1-1K3,6-1K1,9-1K4,8-1K2',
  `Orden "Mejor valoradas primero" incorrecto: obtuvo ${sortedBestFirst.map((c) => c.id).join(',')}`
);

// 5. Desempate "Preferir mejores profesores" en generador automático de combinaciones
const schedulesMap = new Map<number, SubjectSchedule>();
schedulesMap.set(1, {
  subjectId: 1,
  term: '1C',
  commissions: [
    {
      id: '1-LOW',
      code: '1K1',
      turno: 'mañana',
      professors: ['Romoli, Irene Esther'], // 4.2
      slots: [{ day: 'LUN', start: '08:00', end: '10:00' }],
    },
    {
      id: '1-HIGH',
      code: '1K2',
      turno: 'mañana',
      professors: ['Botta, Oscar Ernesto'], // 4.6
      slots: [{ day: 'LUN', start: '08:00', end: '10:00' }],
    },
  ],
});

const combosPreferBest = generateScheduleCombinations(
  [1],
  schedulesMap,
  { sortBy: 'fewer-days', preferBestProfessors: true },
  undefined,
  (comm) => computeCommissionCombinedRating(comm, resolver).combinedAverage
);

assert(combosPreferBest.combinations.length === 2, 'Deben generarse 2 combinaciones sin choques');
assert(
  combosPreferBest.combinations[0].selections[1].id === '1-HIGH',
  'Con preferBestProfessors=true, a igual cantidad de días y huecos debe ganar la comisión de mejor docente (4.6 vs 4.2)'
);
assert(
  combosPreferBest.combinations[0].averageRating === 4.6,
  'La combinación ganadora debe informar averageRating = 4.6'
);

// 6. Accesibilidad por teclado y ARIA labels en español para el componente de estrellas
assert(
  getStarAriaLabel(1, 5) === '1 de 5 estrella',
  'Singular ARIA label para 1 estrella debe ser "1 de 5 estrella"'
);
assert(
  getStarAriaLabel(4, 5) === '4 de 5 estrellas',
  'Plural ARIA label para 4 estrellas debe ser "4 de 5 estrellas"'
);
assert(
  handleStarRatingKeyDown('ArrowRight', 3, 1, 5) === 4,
  'ArrowRight desde 3 debe avanzar a 4'
);
assert(
  handleStarRatingKeyDown('ArrowRight', 5, 1, 5) === 5,
  'ArrowRight en el tope 5 debe mantenerse en 5'
);
assert(
  handleStarRatingKeyDown('ArrowLeft', 3, 1, 5) === 2,
  'ArrowLeft desde 3 debe bajar a 2'
);
assert(
  handleStarRatingKeyDown('ArrowLeft', 1, 1, 5) === 1,
  'ArrowLeft en el mínimo 1 debe mantenerse en 1'
);
assert(handleStarRatingKeyDown('Home', 4, 1, 5) === 1, 'Home debe saltar a 1');
assert(handleStarRatingKeyDown('End', 2, 1, 5) === 5, 'End debe saltar a 5');
assert(handleStarRatingKeyDown('5', 0, 1, 5) === 5, 'Tecla "5" debe seleccionar 5 estrellas');
assert(handleStarRatingKeyDown('Tab', 3, 1, 5) === null, 'Tab no debe ser interceptado');

console.log('TODAS LAS PRUEBAS DE RESEÑAS FRONTEND, INSIGNIAS, FILTROS Y ACCESIBILIDAD PASARON CON ÉXITO!');

