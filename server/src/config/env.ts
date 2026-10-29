import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL (conexión pooled de Neon) es requerida'),
  DIRECT_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  REFRESH_SECRET: z.string().min(16, 'REFRESH_SECRET debe tener al menos 16 caracteres'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
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
    };

