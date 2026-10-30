import { z } from 'zod';

const subjectIdentifierSchema = z.union([
  z.string().uuid('Identificador de materia inválido'),
  z.number().int().positive('Código de materia inválido'),
  z
    .string()
    .regex(/^\d+$/, 'Identificador de materia inválido')
    .transform((v) => parseInt(v, 10)),
]);

export const upsertEnrollmentBodySchema = z.object({
  enrollmentId: z.string().uuid('enrollmentId inválido').nullable().optional(),
  commissionId: z.string().trim().min(1, 'commissionId inválido').nullable().optional(),
  commissionCode: z.string().trim().max(30).nullable().optional(),
  academicYear: z
    .number()
    .int('El año académico debe ser entero')
    .min(1990, 'El año académico debe ser mayor o igual a 1990')
    .max(2100, 'Año académico inválido')
    .nullable()
    .optional(),
  term: z
    .enum(['1C', '2C', 'A'], {
      errorMap: () => ({ message: 'El período debe ser 1C, 2C o A' }),
    })
    .nullable()
    .optional(),
  professorIds: z
    .array(z.string().uuid('Identificador de profesor inválido'))
    .max(15, 'No se pueden asociar más de 15 docentes a una misma cursada')
    .optional(),
  professorNames: z.array(z.string().trim().max(150)).max(15).optional(),
  source: z.enum(['manual', 'schedule_builder']).optional(),
});

export const dismissRecommendationBodySchema = z.object({
  professorId: z.string().uuid('Identificador de profesor inválido'),
  subjectId: subjectIdentifierSchema,
});

export const markRecommendationsSeenBodySchema = z.object({
  keys: z.array(z.string().max(120)).max(500).optional(),
});

