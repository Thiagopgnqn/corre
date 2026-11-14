import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  assertJournalStrictlyIncreasing,
  readLocalMigrationEntries,
  verifyMigrationState,
  type AppliedMigrationRow,
} from './migrationGuard.js';

if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Client } = pg;

export async function runMigrations(options?: { migrationsFolder?: string }): Promise<void> {
  const migrationsFolder = options?.migrationsFolder ?? path.resolve(__dirname, '../../drizzle');
  const localEntries = readLocalMigrationEntries(migrationsFolder);
  assertJournalStrictlyIncreasing(localEntries);

  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    console.warn('⚠️ DIRECT_URL ni DATABASE_URL están configuradas. Omitiendo migraciones.');
    return;
  }

  console.log('🔄 Ejecutando migraciones de base de datos con DIRECT_URL...');

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const db = drizzle(client);

    console.log(`📁 Directorio de migraciones: ${migrationsFolder}`);

    await migrate(db, { migrationsFolder });

    const { rows } = await client.query<AppliedMigrationRow>(
      'SELECT id, hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at ASC'
    );
    verifyMigrationState(localEntries, rows, (msg) => console.warn(msg));

    console.log('✅ Migraciones aplicadas y verificadas exitosamente en Neon.');
  } catch (error) {
    console.error('❌ Error al ejecutar o verificar las migraciones:', error);
    throw error;
  } finally {
    await client.end();
  }
}

const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (currentFile === entryFile) {
  runMigrations().catch((err) => {
    console.error('❌ db:migrate abortado:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

