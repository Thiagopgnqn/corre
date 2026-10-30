import { MAX_REVIEW_COMMENT_LENGTH } from '../../config/reviews.config.js';

export type ContentRejectionCode =
  | 'TOO_LONG'
  | 'PERSONAL_DATA_EMAIL'
  | 'PERSONAL_DATA_PHONE'
  | 'PERSONAL_DATA_LINK'
  | 'OFFENSIVE_LANGUAGE';

export type ContentValidationResult =
  | { valid: true; sanitized: string | null }
  | { valid: false; code: ContentRejectionCode; reason: string };

/**
 * Limpia etiquetas HTML, caracteres de control invisibles y espacios redundantes.
 */
export function sanitizePlainText(raw?: string | null): string | null {
  if (raw === undefined || raw === null) return null;
  const withoutTags = raw
    // Eliminar etiquetas HTML / scripts
    .replace(/<[^>]*>/g, ' ')
    // Eliminar caracteres de control salvo saltos de línea comunes
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    // Normalizar saltos de línea múltiples
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    // Colapsar espacios horizontales excesivos
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return withoutTags.length > 0 ? withoutTags : null;
}

function normalizeForLookup(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const EMAIL_REGEX = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/;

const URL_REGEX =
  /(?:https?:\/\/|www\.)\S+|\b[a-zA-Z0-9-]{2,}\.(?:com|ar|net|org|edu|gov|io|app|me|gg|ly|xyz|info)(?:\/\S*)?\b/i;

/**
 * Detecta secuencias telefónicas (ej. +54 9 351 123-4567, 3514567890, 15-412-3456)
 * exigiendo al menos 7 dígitos en el bloque candidato para no bloquear años ("2026") o notas.
 */
function containsPhoneNumber(text: string): boolean {
  const candidates = text.match(/(?:\+?\d[\d\s().-]{6,}\d)/g);
  if (!candidates) return false;
  for (const cand of candidates) {
    const digitsCount = (cand.match(/\d/g) || []).length;
    if (digitsCount >= 7) {
      return true;
    }
  }
  return false;
}

/**
 * Lista de insultos evidentes y ataques personales directos en español (evaluados como palabras completas).
 */
const BLOCKED_SINGLE_WORDS = new Set([
  'pelotudo',
  'pelotuda',
  'pelotudos',
  'pelotudas',
  'boludo',
  'boluda',
  'boludos',
  'boludas',
  'idiota',
  'idiotas',
  'imbecil',
  'imbeciles',
  'estupido',
  'estupida',
  'estupidos',
  'estupidas',
  'tarado',
  'tarada',
  'tarados',
  'taradas',
  'forro',
  'forra',
  'forros',
  'forras',
  'mierda',
  'mierdas',
  'hdp',
  'garca',
  'garcas',
  'ladron',
  'ladrona',
  'corrupto',
  'corrupta',
  'acosador',
  'acosadora',
  'mogolico',
  'mogolica',
  'retrasado',
  'retrasada',
  'puto',
  'puta',
  'putos',
  'putas',
  'sorete',
  'soretes',
  'basura',
  'inservible',
]);

const BLOCKED_PHRASES = [
  'hijo de puta',
  'hija de puta',
  'la concha de',
  'vete a la mierda',
  'andate a la mierda',
  'enfermo mental',
  'enferma mental',
  'inutil de mierda',
  'mal nacido',
  'malparido',
];

function containsOffensiveLanguage(text: string): boolean {
  const normalized = normalizeForLookup(text)
    // Detectar ofuscaciones triviales con números/símbolos frecuentes en insultos
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/[@]/g, 'a');

  const cleanWordsSpace = normalized.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

  for (const phrase of BLOCKED_PHRASES) {
    if (cleanWordsSpace.includes(phrase)) {
      return true;
    }
  }

  const tokens = cleanWordsSpace.split(' ').filter(Boolean);
  for (const token of tokens) {
    if (BLOCKED_SINGLE_WORDS.has(token)) {
      return true;
    }
  }

  return false;
}

/**
 * Sanitiza y valida el comentario de una reseña contra HTML, exceso de longitud,
 * datos personales (emails, teléfonos, enlaces) e insultos evidentes.
 */
export function validateAndSanitizeReviewComment(raw?: string | null): ContentValidationResult {
  const sanitized = sanitizePlainText(raw);
  if (!sanitized) {
    return { valid: true, sanitized: null };
  }

  if (sanitized.length > MAX_REVIEW_COMMENT_LENGTH) {
    return {
      valid: false,
      code: 'TOO_LONG',
      reason: `El comentario no puede superar los ${MAX_REVIEW_COMMENT_LENGTH} caracteres.`,
    };
  }

  if (EMAIL_REGEX.test(sanitized)) {
    return {
      valid: false,
      code: 'PERSONAL_DATA_EMAIL',
      reason:
        'Se rechazó el comentario porque contiene una dirección de correo electrónico. No está permitido publicar datos personales.',
    };
  }

  if (URL_REGEX.test(sanitized)) {
    return {
      valid: false,
      code: 'PERSONAL_DATA_LINK',
      reason:
        'Se rechazó el comentario porque contiene un enlace o sitio web. Por seguridad y privacidad no se permiten links externos.',
    };
  }

  if (containsPhoneNumber(sanitized)) {
    return {
      valid: false,
      code: 'PERSONAL_DATA_PHONE',
      reason:
        'Se rechazó el comentario porque parece incluir un número de teléfono. No está permitido publicar datos personales ni de contacto.',
    };
  }

  if (containsOffensiveLanguage(sanitized)) {
    return {
      valid: false,
      code: 'OFFENSIVE_LANGUAGE',
      reason:
        'Se rechazó el comentario porque contiene insultos o ataques personales. Por favor opiná con respeto sobre aspectos académicos (claridad, trato, exigencia).',
    };
  }

  return { valid: true, sanitized };
}

