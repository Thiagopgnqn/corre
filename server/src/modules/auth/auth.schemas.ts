import { z } from 'zod';

export const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('El formato de correo electrónico es inválido')
    .max(255, 'El email no puede superar los 255 caracteres'),
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(128, 'La contraseña no puede superar los 128 caracteres'),
  selectedPlanId: z.string().uuid('ID de plan inválido').optional(),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('El formato de correo electrónico es inválido'),
  password: z.string().min(1, 'La contraseña es requerida'),
});

export const googleLoginSchema = z.object({
  credential: z.string().min(1, 'El ID token de Google es requerido'),
  selectedPlanId: z.string().uuid('ID de plan inválido').optional(),
});

export const verifyEmailSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'El código de verificación debe contener exactamente 6 dígitos numéricos'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

