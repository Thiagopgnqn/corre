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

async function runMigrations() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('❌ Error: DIRECT_URL ni DATABASE_URL están configuradas.');
    process.exit(1);
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
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();

