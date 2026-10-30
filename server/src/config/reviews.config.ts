/**
 * Configuración centralizada del sistema de Reseñas de Profesores.
 * Ajustar estos parámetros modifica las reglas de negocio, privacidad y ranking en todo el backend.
 */

/**
 * Estados de avance académico permitidos en `subject_progress` para habilitar a un
 * usuario a dejar una reseña sobre un profesor en una materia.
 * ("pendiente" y "cursando" no habilitan reseñar).
 */
export const ALLOWED_REVIEW_SUBJECT_STATUSES = [
  'regularizada',
  'aprobada',
  'promocionada',
] as const;

export type AllowedReviewSubjectStatus = (typeof ALLOWED_REVIEW_SUBJECT_STATUSES)[number];

/**
 * Umbral mínimo de reseñas publicadas para mostrar el promedio numérico como dato firme/confiable.
 * Con menos de este valor se marca estado `'pocas_resenas'` (o `'sin_resenas'` si es 0).
 */
export const MIN_REVIEWS_FOR_RELIABLE_AVERAGE = 3;

/**
 * Controla si en el directorio y detalle se expone el promedio numérico provisorio cuando
 * un docente tiene entre 1 y `MIN_REVIEWS_FOR_RELIABLE_AVERAGE - 1` reseñas (`ratingStatus = 'pocas_resenas'`).
 * - `true`: `averageOverall` incluye el promedio provisorio (se muestra en tarjetas con estrellas
 *   atenuadas y la etiqueta `"Provisorio"`), mientras `hasReliableAverage` sigue siendo `false`.
 * - `false`: `averageOverall` se devuelve como `null` hasta alcanzar el umbral firme de 3 reseñas.
 */
export const SHOW_PROVISIONAL_AVERAGE_BELOW_THRESHOLD = true;

/**
 * Umbral mínimo de reseñas publicadas de un profesor para exponer el período de cursada
 * (`academicYear` y `term`) en las reseñas públicas.
 * Si el profesor tiene menos de 5 reseñas, el período de cursada se omite (null) para proteger el anonimato.
 */
export const MIN_REVIEWS_TO_SHOW_ATTENDED_PERIOD = 5;

/**
 * Parámetros del Promedio Bayesiano utilizado para ordenar rankings ("Mejor valorados"):
 *   score = (v * R + m * C) / (v + m)
 * donde:
 * - v = cantidad de reseñas publicadas del profesor
 * - R = promedio simple (`overall`) del profesor
 * - m = BAYESIAN_PRIOR_WEIGHT (peso equivalente en cantidad de reseñas asignado al prior)
 * - C = BAYESIAN_PRIOR_GLOBAL_MEAN (promedio global esperado / prior neutral en escala 1..5)
 *
 * Ejemplo con m = 5 y C = 3.5:
 * - Profesor con 1 reseña de 5.0  -> (1*5.0 + 5*3.5) / 6  = 3.750
 * - Profesor con 40 reseñas de 4.8 -> (40*4.8 + 5*3.5) / 45 = 4.656
 */
export const BAYESIAN_PRIOR_GLOBAL_MEAN = 3.5;
export const BAYESIAN_PRIOR_WEIGHT = 5;
export const BAYESIAN_FALLBACK_GLOBAL_MEAN = BAYESIAN_PRIOR_GLOBAL_MEAN;

/**
 * Tope máximo de reseñas nuevas que un mismo usuario puede publicar en una ventana móvil de 24 horas.
 */
export const MAX_NEW_REVIEWS_PER_USER_PER_DAY = 10;

/**
 * Cantidad de reportes abiertos (`status = 'open'`) a partir de la cual una reseña
 * pasa automáticamente a estado `'hidden'` hasta que un administrador la revise.
 */
export const AUTO_HIDE_OPEN_REPORTS_THRESHOLD = 3;

/**
 * Longitud máxima permitida para el comentario de texto opcional de una reseña.
 */
export const MAX_REVIEW_COMMENT_LENGTH = 600;

/**
 * Longitud máxima permitida para la nota adicional al reportar una reseña.
 */
export const MAX_REPORT_NOTE_LENGTH = 300;

