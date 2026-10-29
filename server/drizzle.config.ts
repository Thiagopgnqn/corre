import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';

dotenv.config();

// drizzle-kit requiere conexión directa sin pooler para migraciones e introspección DDL
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    'ADVERTENCIA: Ni DIRECT_URL ni DATABASE_URL están definidas en las variables de entorno para drizzle-kit.'
  );
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: connectionString || '',
  },
  verbose: true,
  strict: true,
});

