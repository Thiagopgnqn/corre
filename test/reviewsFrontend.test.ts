import { normalizeRatingsBatchResponse } from '../src/hooks/useProfessorRatings.ts';
import {
  normalizeProfessorLookupKey,
  formatProfessorBadgeState,
  computeCommissionCombinedRating,
  computeScheduleAverageRating,
  filterAndSortCommissionsByRating,
  getStarAriaLabel,
  handleStarRatingKeyDown,
  formatProfessorCardStarsState,
  type ProfessorRatingResolver,
} from '../src/utils/professorRatingsLogic';
import {
  evaluateCommissionPromptOnStatusChange,
  getReviewPromptsOnRegularizeTransition,
  getActiveRecommendedReviewPairs,
  getSubjectsMissingDeclaredProfessors,
  resolveSubjectStatusFromEnrollment,
  applyServerSubjectStatus,
  canSaveEnrollmentInSimulation,
  executeSaveSubjectEnrollment,
  mergeSavedEnrollmentUserState,
  getSubjectStatusRank,
  SUBJECT_STATUS_RANK,
} from '../src/utils/enrollmentLogic';
import {
  resolveSubjectStatusFromEnrollment as resolveBackendSubjectStatusFromEnrollment,
  getSubjectStatusRank as getBackendSubjectStatusRank,
  SUBJECT_STATUS_RANK as BACKEND_SUBJECT_STATUS_RANK,
} from '../server/src/modules/enrollments/enrollmentStatus.helpers';
import { checkEligibility, getSubjectStatus } from '../src/utils/correlativas';
import type { SubjectEnrollment, UpsertEnrollmentInput } from '../src/types/enrollment';
import type { Subject, SubjectStatus, UserCareerState, UserSubjectState } from '../src/types/career';
import type { ReviewableResponse } from '../src/types/professor';
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

// 7. Tres estados visuales de la fila de 5 estrellas en las tarjetas de profesores (ProfessorCard)
// Estado A: >= 3 reseñas (confiable) -> 5 estrellas ámbar plenas + promedio + (N reseñas)
const starsReliable = formatProfessorCardStarsState({
  reviewCount: 8,
  hasReliableAverage: true,
  ratingStatus: 'confiable',
  averageOverall: 4.6,
});
assert(starsReliable.status === 'confiable', 'Estado debe ser confiable');
assert(starsReliable.starTone === 'full', 'Tono de estrellas confiable debe ser "full"');
assert(starsReliable.starValue === 4.6, 'Valor de relleno debe ser 4.6');
assert(starsReliable.provisionalBadge === false, 'No debe mostrar insignia provisoria');
assert(starsReliable.countLabel === '(8 reseñas)', 'Debe mostrar "(8 reseñas)"');
assert(starsReliable.averageLabel === '4,6', 'Promedio formateado debe ser "4,6"');
assert(starsReliable.ariaLabel.includes('4,6 de 5'), 'Aria label debe indicar 4,6 de 5');

// Estado B: 1–2 reseñas (pocas_resenas) -> 5 estrellas atenuadas + promedio provisorio + badge Provisorio + (N reseñas)
const starsProvisional = formatProfessorCardStarsState({
  reviewCount: 2,
  hasReliableAverage: false,
  ratingStatus: 'pocas_resenas',
  averageOverall: 4.0,
});
assert(starsProvisional.status === 'pocas_resenas', 'Estado debe ser pocas_resenas');
assert(starsProvisional.starTone === 'muted', 'Tono de estrellas provisorias debe ser "muted"');
assert(starsProvisional.starValue === 4.0, 'Valor de relleno debe ser 4.0');
assert(starsProvisional.provisionalBadge === true, 'Debe mostrar insignia provisoria');
assert(starsProvisional.countLabel === '(2 reseñas)', 'Debe mostrar "(2 reseñas)"');
assert(starsProvisional.averageLabel === '4,0', 'Promedio provisorio formateado debe ser "4,0"');
assert(starsProvisional.ariaLabel.includes('provisoria'), 'Aria label debe incluir la palabra provisoria');

// Estado C: 0 reseñas (sin_resenas) -> 5 estrellas de contorno vacías + texto "Sin reseñas"
const starsZero = formatProfessorCardStarsState({
  reviewCount: 0,
  hasReliableAverage: false,
  ratingStatus: 'sin_resenas',
  averageOverall: null,
});
assert(starsZero.status === 'sin_resenas', 'Estado debe ser sin_resenas');
assert(starsZero.starTone === 'empty', 'Tono de estrellas vacías debe ser "empty"');
assert(starsZero.starValue === 0, 'Valor de relleno debe ser 0');
assert(starsZero.provisionalBadge === false, 'No debe mostrar insignia provisoria');
assert(starsZero.countLabel === 'Sin reseñas', 'Texto debe ser "Sin reseñas"');
assert(starsZero.ariaLabel.includes('Sin valoración'), 'Aria label debe indicar Sin valoración');

// 8. Disparo del modal de comisión "¿Con qué comisión la cursaste?" al cambiar de estado
const dummyEnrollments: SubjectEnrollment[] = [
  {
    id: 'enr-1',
    subjectId: '1',
    subjectCode: 1,
    subjectName: 'Análisis Matemático 1',
    subjectShortName: 'AM1',
    subjectLevel: 1,
    commissionId: 'comm-1',
    commissionCode: '1K1',
    turno: 'mañana',
    academicYear: 2024,
    term: '1C',
    source: 'manual',
    professors: [{ professorId: 'p-1', displayName: 'Botta, Oscar' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// Pasar a 'cursando' sin cursada registrada -> debe solicitar comisión
assert(
  evaluateCommissionPromptOnStatusChange({
    prevStatus: 'disponible',
    nextStatus: 'cursando',
    existingSubjectEnrollments: [],
  }).shouldOpenModal === true,
  'Pasar a cursando sin cursada registrada debe abrir el modal de comisión'
);

// Pasar a 'cursando' cuando YA tiene cursada registrada -> no debe solicitar
assert(
  evaluateCommissionPromptOnStatusChange({
    prevStatus: 'disponible',
    nextStatus: 'cursando',
    existingSubjectEnrollments: dummyEnrollments,
  }).shouldOpenModal === false,
  'Si ya tiene cursada registrada no debe volver a pedir comisión'
);

// Pasar a 'disponible' o 'bloqueada' -> no debe solicitar comisión
assert(
  evaluateCommissionPromptOnStatusChange({
    prevStatus: 'cursando',
    nextStatus: 'disponible',
    existingSubjectEnrollments: [],
  }).shouldOpenModal === false,
  'Resetear a disponible no debe abrir modal de comisión'
);

// En tablero Kanban nunca abre modal bloqueante, solo hint
assert(
  evaluateCommissionPromptOnStatusChange({
    prevStatus: 'disponible',
    nextStatus: 'cursando',
    existingSubjectEnrollments: [],
    source: 'kanban',
  }).shouldOpenModal === false &&
    evaluateCommissionPromptOnStatusChange({
      prevStatus: 'disponible',
      nextStatus: 'cursando',
      existingSubjectEnrollments: [],
      source: 'kanban',
    }).shouldShowKanbanHint === true,
  'En Kanban debe devolver shouldShowKanbanHint: true y shouldOpenModal: false'
);

// 9. Toast de recomendación al regularizar ("Cursaste X con Y: ¿querés dejar una reseña?")
const promptsOnRegularize = getReviewPromptsOnRegularizeTransition({
  prevStatus: 'cursando',
  nextStatus: 'regularizada',
  existingSubjectEnrollments: dummyEnrollments,
});
assert(promptsOnRegularize.length === 1, 'Debe generar 1 prompt para el docente de la cursada');
assert(
  promptsOnRegularize[0].professorName === 'Botta, Oscar',
  'El prompt debe corresponder al docente registrado en la cursada'
);
assert(
  promptsOnRegularize[0].subjectName === 'Análisis Matemático 1',
  'El prompt debe incluir el nombre de la materia'
);

// Transición repetida de regularizada a regularizada -> no debe disparar toast nuevo
const promptsNoChange = getReviewPromptsOnRegularizeTransition({
  prevStatus: 'regularizada',
  nextStatus: 'regularizada',
  existingSubjectEnrollments: dummyEnrollments,
});
assert(promptsNoChange.length === 0, 'Si ya estaba regularizada no debe disparar avisos nuevos');

// 10. Filtrado de pares recomendados activos (tarjetas "Profesores que podés reseñar")
const mockReviewable: ReviewableResponse = {
  eligible: [
    {
      professorId: 'p-1',
      professorName: 'Botta, Oscar',
      subjectId: '1',
      subjectName: 'Análisis Matemático 1',
      recommended: true,
      dismissed: false,
      alreadyReviewed: false,
      academicYear: 2024,
      term: '1C',
    },
    {
      professorId: 'p-2',
      professorName: 'Romoli, Irene',
      subjectId: '1',
      subjectName: 'Análisis Matemático 1',
      recommended: true,
      dismissed: true, // descartado con "Ahora no"
      alreadyReviewed: false,
    },
    {
      professorId: 'p-3',
      professorName: 'Gómez, Lucas',
      subjectId: '2',
      subjectName: 'Álgebra',
      recommended: false, // elegible histórico pero no cursó con él
      dismissed: false,
      alreadyReviewed: false,
    },
  ],
  myReviews: [],
};

const activeRecs = getActiveRecommendedReviewPairs(mockReviewable);
assert(activeRecs.length === 1, 'Solo debe incluir el profesor recomendado no descartado');
assert(activeRecs[0].professorId === 'p-1', 'El docente recomendado debe ser p-1');

// 11. Detección de materias sin comisiones declaradas (banner "Contanos con quién cursaste")
const mockSubjects: Subject[] = [
  {
    id: '1',
    code: 1,
    name: 'Análisis Matemático 1',
    level: 1,
    term: '1C',
    weeklyHours: 5,
    status: 'regularizada',
    correlatives: [],
  },
  {
    id: '2',
    code: 2,
    name: 'Álgebra y Geometría Analítica',
    level: 1,
    term: '1C',
    weeklyHours: 5,
    status: 'cursando',
    correlatives: [],
  },
  {
    id: '3',
    code: 3,
    name: 'Física 1',
    level: 1,
    term: '2C',
    weeklyHours: 5,
    status: 'disponible',
    correlatives: [],
  },
];

const missing = getSubjectsMissingDeclaredProfessors(mockSubjects, dummyEnrollments);
assert(missing.length === 1, 'Solo debe detectar 1 materia cursando/regularizada sin inscripción');
assert(missing[0].subjectId === '2', 'La materia faltante debe ser Álgebra (id 2)');


// ======================================================================
// 🧪 TEST DE REGRESIÓN: NORMALIZACIÓN DE RESPUESTA DE PROFESSOR RATINGS
// ======================================================================

console.log('\n🧪 Ejecutando tests de regresión para useProfessorRatings y normalización de API...');

// Caso 1: Forma REAL de respuesta vacía del backend ({ success: true, data: [] })
const emptyBackendResponse = { success: true, data: [] };
const normalizedEmpty = normalizeRatingsBatchResponse(emptyBackendResponse);

assert(typeof normalizedEmpty === 'object' && normalizedEmpty !== null, 'Respuesta normalizada debe ser un objeto');
assert(typeof normalizedEmpty.byId === 'object' && !Array.isArray(normalizedEmpty.byId), 'byId debe ser un objeto de mapa, no array');
assert(typeof normalizedEmpty.byNormalizedName === 'object' && !Array.isArray(normalizedEmpty.byNormalizedName), 'byNormalizedName debe ser un objeto de mapa, no array');
assert(typeof normalizedEmpty.thresholds === 'object', 'thresholds debe contener los umbrales por defecto');
assert(normalizedEmpty.thresholds.minReviewsForReliableAverage === 3, 'thresholds por defecto debe tener minReviewsForReliableAverage = 3');

// Acceso directo que antes crasheaba la app con TypeError: Cannot read properties of undefined (reading 'esther irene romoli')
const safeAccessEmpty = normalizedEmpty.byNormalizedName['esther irene romoli'];
assert(safeAccessEmpty === undefined, 'Acceder a un docente inexistente en byNormalizedName debe devolver undefined sin lanzar excepción');

// Caso 2: Forma completa con datos reales
const sampleRating = {
  id: 'prof-42',
  displayName: 'Esther Irene Romoli',
  normalizedName: 'esther irene romoli',
  reviewCount: 7,
  averageOverall: 4.8,
  hasReliableAverage: true,
  ratingStatus: 'confiable',
};
const fullBackendResponse = {
  success: true,
  data: {
    byId: { 'prof-42': sampleRating },
    byNormalizedName: { 'esther irene romoli': sampleRating },
    thresholds: {
      minReviewsForReliableAverage: 5,
      bayesianPriorGlobalMean: 3.5,
      bayesianPriorWeight: 3,
      minReviewsToShowAttendedPeriod: 2,
      maxNewReviewsPerDay: 5,
      autoHideOpenReportsThreshold: 3,
      allowedSubjectStatuses: ['regularizada', 'aprobada', 'promocionada'],
    },
  },
};
const normalizedFull = normalizeRatingsBatchResponse(fullBackendResponse);

assert(normalizedFull.byId['prof-42']?.displayName === 'Esther Irene Romoli', 'byId debe mapear correctamente');
assert(normalizedFull.byNormalizedName['esther irene romoli']?.averageOverall === 4.8, 'byNormalizedName debe mapear correctamente');
assert(normalizedFull.thresholds.minReviewsForReliableAverage === 5, 'thresholds personalizados deben respetarse');

// Caso 3: Respuestas defensivas ante errores o nulos
const nullResponse = normalizeRatingsBatchResponse(null);
assert(typeof nullResponse.byId === 'object' && typeof nullResponse.byNormalizedName === 'object', 'Null debe devolver mapas seguros');

const errorResponse = normalizeRatingsBatchResponse({ success: false, data: null });
assert(typeof errorResponse.byId === 'object' && typeof errorResponse.byNormalizedName === 'object', 'Error debe devolver mapas seguros');

console.log('✅ Todos los tests de regresión de useProfessorRatings pasaron con éxito!\n');

// ======================================================================
// 🧪 TEST DE MATRIZ COMPLETA Y PARIDAD: resolveSubjectStatusFromEnrollment
// ======================================================================
console.log('🧪 Ejecutando tests de matriz completa estadoActual x resultadoCursada (frontend + backend)...');

assert(
  JSON.stringify(SUBJECT_STATUS_RANK) === JSON.stringify(BACKEND_SUBJECT_STATUS_RANK),
  'SUBJECT_STATUS_RANK debe ser idéntico entre frontend y backend'
);

assert(
  SUBJECT_STATUS_RANK.pendiente < SUBJECT_STATUS_RANK.cursando &&
    SUBJECT_STATUS_RANK.disponible === SUBJECT_STATUS_RANK.pendiente &&
    SUBJECT_STATUS_RANK.bloqueada === SUBJECT_STATUS_RANK.pendiente &&
    SUBJECT_STATUS_RANK.libre === SUBJECT_STATUS_RANK.pendiente &&
    SUBJECT_STATUS_RANK.cursando < SUBJECT_STATUS_RANK.regularizada &&
    SUBJECT_STATUS_RANK.regularizada < SUBJECT_STATUS_RANK.aprobada &&
    SUBJECT_STATUS_RANK.aprobada < SUBJECT_STATUS_RANK.promocionada,
  'La jerarquía debe cumplir pendiente/disponible/bloqueada/libre (0) < cursando (1) < regularizada (2) < aprobada (3) < promocionada (4)'
);

const currentStatusCases: Array<{
  label: string;
  value: string | null | undefined;
  expectedRank: number | null;
}> = [
  { label: 'null', value: null, expectedRank: 0 },
  { label: 'undefined', value: undefined, expectedRank: 0 },
  { label: 'pendiente', value: 'pendiente', expectedRank: 0 },
  { label: 'disponible', value: 'disponible', expectedRank: 0 },
  { label: 'bloqueada', value: 'bloqueada', expectedRank: 0 },
  { label: 'libre', value: 'libre', expectedRank: 0 },
  { label: 'cursando', value: 'cursando', expectedRank: 1 },
  { label: 'regularizada', value: 'regularizada', expectedRank: 2 },
  { label: 'aprobada', value: 'aprobada', expectedRank: 3 },
  { label: 'promocionada', value: 'promocionada', expectedRank: 4 },
  { label: 'desconocido', value: 'desconocido', expectedRank: null },
  { label: 'string vacío', value: '', expectedRank: null },
];

const enrollmentStatusCases: Array<{
  label: string;
  value: string | null | undefined;
  targetRank: number | null;
}> = [
  { label: 'null', value: null, targetRank: null },
  { label: 'undefined', value: undefined, targetRank: null },
  { label: 'cursando', value: 'cursando', targetRank: null },
  { label: 'libre', value: 'libre', targetRank: null },
  { label: 'regularizada', value: 'regularizada', targetRank: 2 },
  { label: 'promocionada', value: 'promocionada', targetRank: 4 },
  { label: 'aprobada (no aplica en cursada)', value: 'aprobada', targetRank: null },
  { label: 'desconocido', value: 'desconocido', targetRank: null },
  { label: 'string vacío', value: '', targetRank: null },
];

let matrixChecked = 0;
for (const cur of currentStatusCases) {
  const feRank = getSubjectStatusRank(cur.value);
  const beRank = getBackendSubjectStatusRank(cur.value);
  assert(
    feRank === cur.expectedRank && beRank === cur.expectedRank,
    `Rank para estado actual ${cur.label}: esperado ${cur.expectedRank}, obtuvo fe=${feRank}, be=${beRank}`
  );

  for (const enr of enrollmentStatusCases) {
    const feRes = resolveSubjectStatusFromEnrollment(cur.value, enr.value);
    const beRes = resolveBackendSubjectStatusFromEnrollment(cur.value, enr.value);

    const expectedShouldUpdate =
      enr.targetRank !== null &&
      cur.expectedRank !== null &&
      enr.targetRank > cur.expectedRank;
    const expectedNextStatus = expectedShouldUpdate
      ? (enr.value as string)
      : (cur.value ?? null);

    assert(
      feRes.shouldUpdate === expectedShouldUpdate &&
        feRes.nextStatus === expectedNextStatus,
      `Frontend [${cur.label} x ${enr.label}]: esperado {shouldUpdate:${expectedShouldUpdate}, nextStatus:${String(expectedNextStatus)}}, obtuvo ${JSON.stringify(feRes)}`
    );
    assert(
      beRes.shouldUpdate === expectedShouldUpdate &&
        beRes.nextStatus === expectedNextStatus,
      `Backend [${cur.label} x ${enr.label}]: esperado {shouldUpdate:${expectedShouldUpdate}, nextStatus:${String(expectedNextStatus)}}, obtuvo ${JSON.stringify(beRes)}`
    );
    assert(
      feRes.shouldUpdate === beRes.shouldUpdate && feRes.nextStatus === beRes.nextStatus,
      `Paridad frontend/backend [${cur.label} x ${enr.label}]`
    );
    matrixChecked++;
  }
}

assert(
  matrixChecked === 12 * 9 && matrixChecked === 108,
  `La matriz completa debe ejecutar 12 x 9 = 108 combinaciones (obtuvo ${matrixChecked})`
);

// Verificaciones puntuales explícitas de reglas críticas de negocio
assert(
  resolveSubjectStatusFromEnrollment('aprobada', 'regularizada').shouldUpdate === false &&
    resolveSubjectStatusFromEnrollment('aprobada', 'regularizada').nextStatus === 'aprobada',
  'Materia ya aprobada NO debe bajar a regularizada'
);
assert(
  resolveSubjectStatusFromEnrollment('promocionada', 'regularizada').shouldUpdate === false &&
    resolveSubjectStatusFromEnrollment('promocionada', 'regularizada').nextStatus === 'promocionada',
  'Materia ya promocionada NO debe bajar a regularizada'
);
assert(
  resolveSubjectStatusFromEnrollment('aprobada', 'promocionada').shouldUpdate === true &&
    resolveSubjectStatusFromEnrollment('aprobada', 'promocionada').nextStatus === 'promocionada',
  'Materia aprobada pasa a promocionada si se registra cursada promocionada (rank 4 > 3)'
);
assert(
  resolveSubjectStatusFromEnrollment(null, 'libre').shouldUpdate === false &&
    resolveSubjectStatusFromEnrollment('regularizada', 'libre').shouldUpdate === false &&
    resolveSubjectStatusFromEnrollment('disponible', 'cursando').shouldUpdate === false,
  'Cursada libre/cursando/null nunca actualiza el estado de la materia'
);
assert(
  resolveSubjectStatusFromEnrollment('estado_raro', 'promocionada').shouldUpdate === false &&
    resolveSubjectStatusFromEnrollment('estado_raro', 'promocionada').nextStatus === 'estado_raro',
  'Estado actual desconocido no debe modificarse aunque la cursada sea promocionada'
);

console.log(`✅ Matriz completa verificada (${matrixChecked} combinaciones con paridad 100% frontend/backend)!\n`);

// ======================================================================
// 🧪 TESTS COMMIT 3: applyServerSubjectStatus, simulación, correlativas y flujo inverso
// ======================================================================
console.log('🧪 Ejecutando tests de applyServerSubjectStatus, modo simulación, correlativas y flujo inverso...');

const FIXED_ISO = '2026-11-21T18:00:00.000Z';

const localEntryCases: Array<{
  label: string;
  entry: UserSubjectState | undefined;
  rank: number | null;
}> = [
  { label: 'undefined', entry: undefined, rank: 0 },
  { label: 'disponible', entry: { status: 'disponible' }, rank: 0 },
  { label: 'bloqueada', entry: { status: 'bloqueada' }, rank: 0 },
  { label: 'libre', entry: { status: 'libre' }, rank: 0 },
  { label: 'cursando', entry: { status: 'cursando' }, rank: 1 },
  { label: 'regularizada', entry: { status: 'regularizada' }, rank: 2 },
  { label: 'aprobada(9)', entry: { status: 'aprobada', grade: 9 }, rank: 3 },
  { label: 'promocionada(10)', entry: { status: 'promocionada', grade: 10 }, rank: 4 },
  { label: 'desconocido', entry: { status: 'desconocido' as SubjectStatus }, rank: null },
];

const serverStatusCases: Array<{
  label: string;
  value: string | null | undefined;
  targetRank: number | null;
  isValidFrontendStatus: boolean;
}> = [
  { label: 'undefined', value: undefined, targetRank: null, isValidFrontendStatus: false },
  { label: 'null', value: null, targetRank: null, isValidFrontendStatus: false },
  { label: 'vacío', value: '', targetRank: null, isValidFrontendStatus: false },
  { label: 'desconocido', value: 'desconocido', targetRank: null, isValidFrontendStatus: false },
  { label: 'pendiente', value: 'pendiente', targetRank: 0, isValidFrontendStatus: false },
  { label: 'disponible', value: 'disponible', targetRank: 0, isValidFrontendStatus: true },
  { label: 'bloqueada', value: 'bloqueada', targetRank: 0, isValidFrontendStatus: true },
  { label: 'libre', value: 'libre', targetRank: 0, isValidFrontendStatus: true },
  { label: 'cursando', value: 'cursando', targetRank: 1, isValidFrontendStatus: true },
  { label: 'regularizada', value: 'regularizada', targetRank: 2, isValidFrontendStatus: true },
  { label: 'aprobada', value: 'aprobada', targetRank: 3, isValidFrontendStatus: true },
  { label: 'promocionada', value: 'promocionada', targetRank: 4, isValidFrontendStatus: true },
];

let applyServerMatrixChecked = 0;
for (const localCase of localEntryCases) {
  for (const srvCase of serverStatusCases) {
    const result = applyServerSubjectStatus(localCase.entry, srvCase.value, FIXED_ISO);
    const shouldChange =
      srvCase.isValidFrontendStatus &&
      srvCase.targetRank !== null &&
      localCase.rank !== null &&
      srvCase.targetRank > localCase.rank;

    if (!shouldChange) {
      assert(
        result === null,
        `applyServerSubjectStatus [${localCase.label} x ${srvCase.label}] debía devolver null, obtuvo ${JSON.stringify(result)}`
      );
    } else {
      assert(
        result !== null &&
          result.status === srvCase.value &&
          result.grade === localCase.entry?.grade &&
          result.updatedAt === FIXED_ISO,
        `applyServerSubjectStatus [${localCase.label} x ${srvCase.label}] debía actualizar a ${srvCase.value} preservando grade=${String(localCase.entry?.grade)}, obtuvo ${JSON.stringify(result)}`
      );
    }
    applyServerMatrixChecked++;
  }
}

assert(
  applyServerMatrixChecked === 9 * 12 && applyServerMatrixChecked === 108,
  `La tabla de applyServerSubjectStatus debe verificar 9 x 12 = 108 combinaciones (obtuvo ${applyServerMatrixChecked})`
);

// Compatibilidad hacia atrás: payload sin campo subjectStatus (backend anterior) no cambia nada local
const legacyBackendEnrollment: SubjectEnrollment = {
  id: 'enr-legacy',
  subjectId: 'sub-101',
  subjectCode: 101,
  subjectName: 'Materia Genérica I',
  subjectShortName: 'MG1',
  subjectLevel: 1,
  commissionId: null,
  commissionCode: null,
  turno: null,
  academicYear: 2025,
  term: '1C',
  status: 'promocionada',
  source: 'manual',
  professors: [],
  createdAt: FIXED_ISO,
  updatedAt: FIXED_ISO,
};
assert(
  applyServerSubjectStatus({ status: 'cursando' }, legacyBackendEnrollment.subjectStatus, FIXED_ISO) === null,
  'Payload sin campo subjectStatus (backend viejo) no debe alterar el estado local ni fallar'
);

// Conservación explícita de nota local al subir aprobada -> promocionada
const upgradedWithGrade = applyServerSubjectStatus(
  { status: 'aprobada', grade: 9, updatedAt: '2025-01-01T00:00:00.000Z' },
  'promocionada',
  FIXED_ISO
);
assert(
  upgradedWithGrade !== null &&
    upgradedWithGrade.status === 'promocionada' &&
    upgradedWithGrade.grade === 9 &&
    upgradedWithGrade.updatedAt === FIXED_ISO,
  'applyServerSubjectStatus debe conservar la nota local (9) al pasar de aprobada a promocionada'
);

// Regla canSaveEnrollmentInSimulation y corte antes de llamar API / mutar estado en simulación
assert(
  canSaveEnrollmentInSimulation(true) === false &&
    canSaveEnrollmentInSimulation(false) === true &&
    canSaveEnrollmentInSimulation(undefined) === true &&
    canSaveEnrollmentInSimulation(null) === true,
  'canSaveEnrollmentInSimulation debe devolver false en modo simulación y true fuera de él'
);

async function runSimulationAndSaveHarnessTests(): Promise<void> {
  let apiCalls = 0;
  let localUserState: UserCareerState = {
    101: { status: 'disponible' },
  };
  let localEnrollments: SubjectEnrollment[] = [];

  const createMockUpsert =
    (serverReturnedSubjectStatus?: string | null) =>
    async (subjectCode: number, input: UpsertEnrollmentInput) => {
      apiCalls += 1;
      const saved: SubjectEnrollment = {
        id: `enr-${apiCalls}`,
        subjectId: `sub-${subjectCode}`,
        subjectCode,
        subjectName: 'Materia Test',
        subjectShortName: 'MT',
        subjectLevel: 1,
        commissionId: input.commissionId ?? null,
        commissionCode: null,
        turno: null,
        academicYear: input.academicYear ?? 2026,
        term: input.term ?? '1C',
        status: input.status ?? 'cursando',
        ...(serverReturnedSubjectStatus !== undefined
          ? { subjectStatus: serverReturnedSubjectStatus }
          : {}),
        source: input.source ?? 'manual',
        professors: [],
        createdAt: FIXED_ISO,
        updatedAt: FIXED_ISO,
      };
      return { data: saved };
    };

  let simErrorCaught = false;
  try {
    await executeSaveSubjectEnrollment({
      isSimulationMode: true,
      subjectCode: 101,
      input: { academicYear: 2026, term: '1C', status: 'promocionada', professorIds: [] },
      upsertEnrollment: createMockUpsert('promocionada'),
      applyEnrollmentsUpdate: (updater) => {
        localEnrollments = updater(localEnrollments);
      },
      applyUserStateUpdate: (updater) => {
        localUserState = updater(localUserState);
      },
      nowIso: FIXED_ISO,
    });
  } catch (err) {
    simErrorCaught = (err as Error).message === 'No disponible en modo simulación';
  }

  assert(
    simErrorCaught &&
      apiCalls === 0 &&
      localEnrollments.length === 0 &&
      localUserState[101]?.status === 'disponible',
    'En modo simulación, executeSaveSubjectEnrollment (usada por CareerContext) corta antes de llamar al servidor y no muta cursadas ni progreso'
  );

  // Fuera de simulación sí guarda y promociona el estado local sin degradar ni duplicar
  await executeSaveSubjectEnrollment({
    isSimulationMode: false,
    subjectCode: 101,
    input: { academicYear: 2026, term: '1C', status: 'promocionada', professorIds: [] },
    upsertEnrollment: createMockUpsert('promocionada'),
    applyEnrollmentsUpdate: (updater) => {
      localEnrollments = updater(localEnrollments);
    },
    applyUserStateUpdate: (updater) => {
      localUserState = updater(localUserState);
    },
    nowIso: FIXED_ISO,
  });
  assert(
    apiCalls === 1 &&
      localEnrollments.length === 1 &&
      localUserState[101]?.status === 'promocionada',
    'Fuera de simulación, executeSaveSubjectEnrollment guarda la cursada y aplica subjectStatus="promocionada"'
  );

  // Payload de listado GET /api/enrollments sin campo subjectStatus (omitido) no cambia nada en userState
  const listedPayloadWithoutSubjectStatus: SubjectEnrollment[] = [
    {
      id: 'enr-list-1',
      subjectId: 'sub-101',
      subjectCode: 101,
      subjectName: 'Materia Test',
      subjectShortName: 'MT',
      subjectLevel: 1,
      commissionId: null,
      commissionCode: null,
      turno: null,
      academicYear: 2026,
      term: '1C',
      status: 'regularizada',
      source: 'manual',
      professors: [],
      createdAt: FIXED_ISO,
      updatedAt: FIXED_ISO,
    },
    {
      id: 'enr-list-2',
      subjectId: 'sub-102',
      subjectName: 'Materia Pendiente',
      subjectShortName: 'MP',
      subjectLevel: 1,
      subjectCode: 102,
      commissionId: null,
      commissionCode: null,
      turno: null,
      academicYear: 2026,
      term: '1C',
      status: 'promocionada',
      source: 'manual',
      professors: [],
      createdAt: FIXED_ISO,
      updatedAt: FIXED_ISO,
    },
  ];
  const stateBeforeListApply: UserCareerState = {
    101: { status: 'cursando' },
    102: { status: 'aprobada', grade: 8 },
  };
  let stateAfterListApply = stateBeforeListApply;
  for (const listedItem of listedPayloadWithoutSubjectStatus) {
    assert(
      !Object.prototype.hasOwnProperty.call(listedItem, 'subjectStatus') &&
        listedItem.subjectStatus === undefined,
      'Fixture de listado GET /api/enrollments omite subjectStatus'
    );
    stateAfterListApply = mergeSavedEnrollmentUserState(
      stateAfterListApply,
      listedItem.subjectCode,
      listedItem.subjectStatus,
      FIXED_ISO
    );
  }
  assert(
    stateAfterListApply === stateBeforeListApply &&
      stateAfterListApply[101]?.status === 'cursando' &&
      stateAfterListApply[102]?.status === 'aprobada' &&
      stateAfterListApply[102]?.grade === 8,
    'Un payload de listado GET /api/enrollments sin subjectStatus no modifica en absoluto userState'
  );
}

await runSimulationAndSaveHarnessTests();

// Efecto real en motor de correlativas (multi-carrera, sin datos fijos de Sistemas)
const syntheticBaseSub: Subject = {
  id: 101,
  code: '101',
  name: 'Materia Base Genérica',
  level: 1,
  modality: '1C',
  weeklyHours: 4,
  regularPrereqs: [],
  approvedPrereqs: [],
};
const syntheticRegDepSub: Subject = {
  id: 102,
  code: '102',
  name: 'Dependiente por Regularizada',
  level: 2,
  modality: '1C',
  weeklyHours: 4,
  regularPrereqs: [101],
  approvedPrereqs: [],
};
const syntheticAprobDepSub: Subject = {
  id: 103,
  code: '103',
  name: 'Dependiente por Aprobada',
  level: 3,
  modality: '1C',
  weeklyHours: 4,
  regularPrereqs: [],
  approvedPrereqs: [101],
};

let correlativeState: UserCareerState = {};
assert(
  getSubjectStatus(syntheticBaseSub, correlativeState) === 'disponible' &&
    getSubjectStatus(syntheticRegDepSub, correlativeState) === 'bloqueada' &&
    getSubjectStatus(syntheticAprobDepSub, correlativeState) === 'bloqueada',
  'Base arranca disponible y ambas dependientes bloqueadas cuando la materia base no tiene estado'
);

const baseAfterReg = applyServerSubjectStatus(correlativeState[101], 'regularizada', FIXED_ISO);
assert(baseAfterReg !== null && baseAfterReg.status === 'regularizada', 'Regularizar base via cursada actualiza a regularizada');
correlativeState = { ...correlativeState, 101: baseAfterReg! };

assert(
  checkEligibility(syntheticRegDepSub, correlativeState).eligible === true &&
    getSubjectStatus(syntheticRegDepSub, correlativeState) === 'disponible' &&
    checkEligibility(syntheticAprobDepSub, correlativeState).eligible === false &&
    getSubjectStatus(syntheticAprobDepSub, correlativeState) === 'bloqueada',
  'Con cursada regularizada se destraba dependiente regular y sigue bloqueada la dependiente aprobada'
);

const baseAfterPromo = applyServerSubjectStatus(correlativeState[101], 'promocionada', FIXED_ISO);
assert(baseAfterPromo !== null && baseAfterPromo.status === 'promocionada', 'Promocionar base via cursada sube a promocionada');
correlativeState = { ...correlativeState, 101: baseAfterPromo! };

assert(
  checkEligibility(syntheticAprobDepSub, correlativeState).eligible === true &&
    getSubjectStatus(syntheticAprobDepSub, correlativeState) === 'disponible',
  'Con cursada promocionada se cumple approvedPrereqs y la dependiente pasa a disponible'
);

// Flujo inverso: QuickStatusModal -> updateSubjectStatus -> EnrollmentModal -> executeSaveSubjectEnrollment (misma función de CareerContext)
async function runInverseFlowWithSharedExecutorTests(): Promise<void> {
  // Caso A: Usuario marca promocionada con nota 9 -> abre EnrollmentModal -> guarda cursada promocionada
  let stateQuick: UserCareerState = {
    101: { status: 'promocionada', grade: 9, updatedAt: FIXED_ISO },
  };
  let enrollmentsQuick: SubjectEnrollment[] = [];
  let updateSubjectStatusCalls = 0;

  const openPromptQuick = evaluateCommissionPromptOnStatusChange({
    prevStatus: 'disponible',
    nextStatus: 'promocionada',
    existingSubjectEnrollments: enrollmentsQuick,
    isSimulationMode: false,
    source: 'status_change',
  });
  const serverDecisionQuick = resolveSubjectStatusFromEnrollment(
    stateQuick[101].status,
    'promocionada'
  );

  await executeSaveSubjectEnrollment({
    isSimulationMode: false,
    subjectCode: 101,
    input: { academicYear: 2026, term: '1C', status: 'promocionada', professorIds: [] },
    upsertEnrollment: async (_code, input) => ({
      data: {
        ...legacyBackendEnrollment,
        id: 'enr-quick-a',
        status: input.status ?? 'promocionada',
        subjectStatus: serverDecisionQuick.nextStatus,
      },
    }),
    applyEnrollmentsUpdate: (updater) => {
      enrollmentsQuick = updater(enrollmentsQuick);
    },
    applyUserStateUpdate: (updater) => {
      const next = updater(stateQuick);
      if (next !== stateQuick) {
        updateSubjectStatusCalls += 1;
        stateQuick = next;
      }
    },
    nowIso: '2026-11-21T18:05:00.000Z',
  });

  const rePromptAfterSaveQuick = evaluateCommissionPromptOnStatusChange({
    prevStatus: 'promocionada',
    nextStatus: stateQuick[101].status,
    existingSubjectEnrollments: enrollmentsQuick,
    isSimulationMode: false,
    source: 'status_change',
  });
  assert(
    openPromptQuick.shouldOpenModal === true &&
      serverDecisionQuick.shouldUpdate === false &&
      serverDecisionQuick.nextStatus === 'promocionada' &&
      updateSubjectStatusCalls === 0 &&
      stateQuick[101].grade === 9 &&
      rePromptAfterSaveQuick.shouldOpenModal === false,
    'Flujo inverso (mismo estado promocionada + nota 9) vía executeSaveSubjectEnrollment: sin doble escritura, sin pérdida de nota ni bucle de modal'
  );

  // Caso B: Usuario marca cursando en QuickStatusModal -> abre EnrollmentModal -> guarda cursada promocionada
  let stateUpgrade: UserCareerState = {
    101: { status: 'cursando', updatedAt: FIXED_ISO },
  };
  let enrollmentsUpgrade: SubjectEnrollment[] = [];
  const serverDecisionUpgrade = resolveSubjectStatusFromEnrollment(
    stateUpgrade[101].status,
    'promocionada'
  );

  await executeSaveSubjectEnrollment({
    isSimulationMode: false,
    subjectCode: 101,
    input: { academicYear: 2026, term: '1C', status: 'promocionada', professorIds: [] },
    upsertEnrollment: async (_code, input) => ({
      data: {
        ...legacyBackendEnrollment,
        id: 'enr-quick-b',
        status: input.status ?? 'promocionada',
        subjectStatus: serverDecisionUpgrade.nextStatus,
      },
    }),
    applyEnrollmentsUpdate: (updater) => {
      enrollmentsUpgrade = updater(enrollmentsUpgrade);
    },
    applyUserStateUpdate: (updater) => {
      stateUpgrade = updater(stateUpgrade);
    },
    nowIso: '2026-11-21T18:06:00.000Z',
  });
  assert(
    serverDecisionUpgrade.shouldUpdate === true &&
      serverDecisionUpgrade.nextStatus === 'promocionada' &&
      stateUpgrade[101]?.status === 'promocionada' &&
      enrollmentsUpgrade.length === 1,
    'Flujo inverso (cursando -> modal cambia a promocionada) vía executeSaveSubjectEnrollment: aplica actualización local directamente sin pasar por updateSubjectStatus'
  );

  // Caso C: Conserva nota 9 si QuickStatusModal dejó aprobada(9) y EnrollmentModal guarda cursada promocionada
  let stateAprobNota: UserCareerState = {
    101: { status: 'aprobada', grade: 9, updatedAt: FIXED_ISO },
  };
  let enrollmentsAprobNota: SubjectEnrollment[] = [];
  const serverDecisionAprobPromo = resolveSubjectStatusFromEnrollment(
    stateAprobNota[101].status,
    'promocionada'
  );

  await executeSaveSubjectEnrollment({
    isSimulationMode: false,
    subjectCode: 101,
    input: { academicYear: 2026, term: '1C', status: 'promocionada', professorIds: [] },
    upsertEnrollment: async (_code, input) => ({
      data: {
        ...legacyBackendEnrollment,
        id: 'enr-quick-c',
        status: input.status ?? 'promocionada',
        subjectStatus: serverDecisionAprobPromo.nextStatus,
      },
    }),
    applyEnrollmentsUpdate: (updater) => {
      enrollmentsAprobNota = updater(enrollmentsAprobNota);
    },
    applyUserStateUpdate: (updater) => {
      stateAprobNota = updater(stateAprobNota);
    },
    nowIso: '2026-11-21T18:07:00.000Z',
  });
  assert(
    serverDecisionAprobPromo.shouldUpdate === true &&
      serverDecisionAprobPromo.nextStatus === 'promocionada' &&
      stateAprobNota[101]?.status === 'promocionada' &&
      stateAprobNota[101]?.grade === 9 &&
      enrollmentsAprobNota.length === 1,
    'Si pasa de aprobada (nota 9) a promocionada vía executeSaveSubjectEnrollment, conserva la nota 9 intacta'
  );
}

await runInverseFlowWithSharedExecutorTests();

console.log(`✅ Tests de applyServerSubjectStatus (${applyServerMatrixChecked} combinaciones), simulación, correlativas y flujo inverso pasaron!\n`);

console.log('TODAS LAS PRUEBAS DE RESEÑAS FRONTEND, INSIGNIAS, FILTROS Y ACCESIBILIDAD PASARON CON ÉXITO!');

