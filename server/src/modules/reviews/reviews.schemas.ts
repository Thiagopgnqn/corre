import { z } from 'zod';
import {
  MAX_REPORT_NOTE_LENGTH,
  MAX_REVIEW_COMMENT_LENGTH,
} from '../../config/reviews.config.js';

const optionalRatingField = z
  .number({ invalid_type_error: 'La valoración debe ser un número entre 1 y 5' })
  .int('La valoración debe ser un número entero')
  .min(1, 'La valoración mínima es 1 estrella')
  .max(5, 'La valoración máxima es 5 estrellas')
  .nullable()
  .optional();

const subjectIdentifierSchema = z.union([
  z.string().uuid('Identificador de materia inválido'),
  z.number().int().positive('Código de materia inválido'),
  z
    .string()
    .regex(/^\d+$/, 'Identificador de materia inválido')
    .transform((v) => parseInt(v, 10)),
]);

export const createReviewBodySchema = z.object({
  professorId: z.string().uuid('Identificador de profesor inválido'),
  subjectId: subjectIdentifierSchema,
  academicYear: z
    .number()
    .int()
    .min(2000, 'El año de cursada debe ser mayor o igual a 2000')
    .max(2100, 'Año de cursada inválido')
    .nullable()
    .optional(),
  term: z
    .enum(['1C', '2C', 'A'], {
      errorMap: () => ({ message: 'El período debe ser 1C, 2C o A' }),
    })
    .nullable()
    .optional(),
  overall: z
    .number({ required_error: 'La puntuación general es obligatoria' })
    .int('La puntuación general debe ser entera')
    .min(1, 'La puntuación mínima es 1 estrella')
    .max(5, 'La puntuación máxima es 5 estrellas'),
  clarity: optionalRatingField,
  treatment: optionalRatingField,
  availability: optionalRatingField,
  difficulty: optionalRatingField,
  wouldRecommend: z.boolean().nullable().optional(),
  comment: z
    .string()
    .max(
      MAX_REVIEW_COMMENT_LENGTH,
      `El comentario no puede superar los ${MAX_REVIEW_COMMENT_LENGTH} caracteres`
    )
    .nullable()
    .optional(),
});

export const updateReviewBodySchema = z.object({
  academicYear: z
    .number()
    .int()
    .min(2000, 'El año de cursada debe ser mayor o igual a 2000')
    .max(2100, 'Año de cursada inválido')
    .nullable()
    .optional(),
  term: z
    .enum(['1C', '2C', 'A'], {
      errorMap: () => ({ message: 'El período debe ser 1C, 2C o A' }),
    })
    .nullable()
    .optional(),
  overall: z
    .number({ required_error: 'La puntuación general es obligatoria' })
    .int('La puntuación general debe ser entera')
    .min(1, 'La puntuación mínima es 1 estrella')
    .max(5, 'La puntuación máxima es 5 estrellas'),
  clarity: optionalRatingField,
  treatment: optionalRatingField,
  availability: optionalRatingField,
  difficulty: optionalRatingField,
  wouldRecommend: z.boolean().nullable().optional(),
  comment: z
    .string()
    .max(
      MAX_REVIEW_COMMENT_LENGTH,
      `El comentario no puede superar los ${MAX_REVIEW_COMMENT_LENGTH} caracteres`
    )
    .nullable()
    .optional(),
});

export const reportReviewBodySchema = z.object({
  reason: z.enum(['ofensiva', 'datos personales', 'falsa o spam', 'otra'], {
    errorMap: () => ({
      message: 'El motivo debe ser "ofensiva", "datos personales", "falsa o spam" u "otra"',
    }),
  }),
  note: z
    .string()
    .max(MAX_REPORT_NOTE_LENGTH, `La nota no puede superar los ${MAX_REPORT_NOTE_LENGTH} caracteres`)
    .nullable()
    .optional(),
});

export const mergeProfessorsBodySchema = z
  .object({
    sourceProfessorId: z.string().uuid('sourceProfessorId debe ser un UUID válido'),
    targetProfessorId: z.string().uuid('targetProfessorId debe ser un UUID válido'),
  })
  .refine((d) => d.sourceProfessorId !== d.targetProfessorId, {
    message: 'No se puede fusionar un profesor consigo mismo',
    path: ['targetProfessorId'],
  });

export const renameProfessorBodySchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(3, 'El nombre para mostrar debe tener al menos 3 caracteres')
    .max(120, 'El nombre para mostrar no puede superar 120 caracteres'),
});

export const linkProfessorSubjectBodySchema = z.object({
  subjectId: subjectIdentifierSchema,
  note: z.string().trim().max(250).nullable().optional(),
});

export const createHistoricalProfessorBodySchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(3, 'El nombre del profesor debe tener al menos 3 caracteres')
    .max(120, 'El nombre del profesor no puede superar 120 caracteres'),
  facultyId: z.string().uuid().optional(),
  subjectId: subjectIdentifierSchema.optional(),
  note: z.string().trim().max(250).nullable().optional(),
});

export const moderateReviewStatusBodySchema = z.object({
  status: z.enum(['published', 'hidden', 'removed'], {
    errorMap: () => ({ message: 'El estado debe ser published, hidden o removed' }),
  }),
});

export const moderateReportBodySchema = z.object({
  status: z.enum(['dismissed', 'actioned'], {
    errorMap: () => ({ message: 'El estado del reporte debe ser dismissed o actioned' }),
  }),
  reviewStatus: z.enum(['published', 'hidden', 'removed']).optional(),
});

