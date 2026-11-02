import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Client } = pg;

export async function runMigrations(): Promise<void> {
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

    const migrationsFolder = path.resolve(__dirname, '../../drizzle');
    console.log(`📁 Directorio de migraciones: ${migrationsFolder}`);

    await migrate(db, { migrationsFolder });
    console.log('✅ Migraciones aplicadas exitosamente en Neon.');
  } catch (error) {
    console.error('❌ Error al ejecutar las migraciones:', error);
    throw error;
  } finally {
    await client.end();
  }
}

const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (currentFile === entryFile) {
  runMigrations().catch(() => process.exit(1));
}

