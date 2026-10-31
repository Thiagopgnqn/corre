import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const baseSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL (conexión pooled de Neon) es requerida'),
  DIRECT_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  REFRESH_SECRET: z.string().min(16, 'REFRESH_SECRET debe tener al menos 16 caracteres'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  EMAIL_PROVIDER: z.enum(['resend', 'brevo']).optional(),
  RESEND_API_KEY: z.string().optional(),
  BREVO_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Mi Carrera <noreply@micarrera.app>'),
  EMAIL_FROM_NAME: z.string().default('Mi Carrera'),
  VERIFICATION_CODE_PEPPER: z
    .string()
    .default('dev_verification_code_pepper_secret_min_16'),
});

const envSchema = baseSchema.superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    if (!data.GOOGLE_CLIENT_ID || data.GOOGLE_CLIENT_ID.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE_CLIENT_ID'],
        message: 'GOOGLE_CLIENT_ID es obligatoria en producción para el inicio de sesión con Google',
      });
    }
    if (!data.VERIFICATION_CODE_PEPPER || data.VERIFICATION_CODE_PEPPER.length < 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VERIFICATION_CODE_PEPPER'],
        message: 'VERIFICATION_CODE_PEPPER es obligatoria en producción y debe tener al menos 16 caracteres',
      });
    }
    if (!data.EMAIL_PROVIDER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_PROVIDER'],
        message: 'EMAIL_PROVIDER es obligatoria en producción ("resend" o "brevo")',
      });
    } else if (data.EMAIL_PROVIDER === 'resend' && (!data.RESEND_API_KEY || data.RESEND_API_KEY.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY es obligatoria en producción cuando EMAIL_PROVIDER es "resend"',
      });
    } else if (data.EMAIL_PROVIDER === 'brevo' && (!data.BREVO_API_KEY || data.BREVO_API_KEY.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BREVO_API_KEY'],
        message: 'BREVO_API_KEY es obligatoria en producción cuando EMAIL_PROVIDER es "brevo"',
      });
    }
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Error de validación en variables de entorno:');
  parsed.error.errors.forEach((err) => {
    console.error(`  - ${err.path.join('.')}: ${err.message}`);
  });
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

export const env = parsed.success
  ? parsed.data
  : {
      DATABASE_URL: process.env.DATABASE_URL || '',
      DIRECT_URL: process.env.DIRECT_URL || process.env.DATABASE_URL || '',
      JWT_SECRET: process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production_min_16_chars',
      REFRESH_SECRET: process.env.REFRESH_SECRET || 'dev_refresh_secret_change_in_production_min_16_chars',
      CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
      PORT: Number(process.env.PORT) || 4000,
      NODE_ENV: (process.env.NODE_ENV as 'development' | 'production' | 'test') || 'development',
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      EMAIL_PROVIDER: process.env.EMAIL_PROVIDER as 'resend' | 'brevo' | undefined,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      BREVO_API_KEY: process.env.BREVO_API_KEY,
      EMAIL_FROM: process.env.EMAIL_FROM || 'Mi Carrera <noreply@micarrera.app>',
      EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || 'Mi Carrera',
      VERIFICATION_CODE_PEPPER:
        process.env.VERIFICATION_CODE_PEPPER || 'dev_verification_code_pepper_secret_min_16',
    };

