/**
 * Script de purga de objetos de Cloudflare R2 para archivos en estado 'rejected'
 *
 * MODO SIMULACIÓN POR DEFECTO (Dry Run):
 *   npx tsx server/scripts/purge-rejected-objects.ts
 *   (Solo analiza la base de datos, calcula la cantidad de archivos rechazados,
 *    el tamaño total en MB y lista una muestra sin modificar nada).
 *
 * MODO EJECUCIÓN (Requiere flag explícito --apply):
 *   npx tsx server/scripts/purge-rejected-objects.ts --apply
 *   (Encola los objetos en library_orphan_deletions para su eliminación física
 *    en Cloudflare R2 sin borrar la metadata del archivo en library_files).
 *
 * Seguridad:
 * - Lee DATABASE_URL exclusivamente de variables de entorno.
 * - Nunca imprime credenciales ni URLs completas.
 */

import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql, count } from 'drizzle-orm';
import { libraryFiles, libraryOrphanDeletions } from '../src/db/schema.js';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ ERROR: Variable de entorno DATABASE_URL no definida.');
    process.exit(1);
  }

  let dbHost = 'desconocido';
  let dbName = 'desconocido';
  try {
    const u = new URL(databaseUrl);
    dbHost = u.host;
    dbName = u.pathname.replace(/^\//, '');
  } catch {
    // Si no parsea como URL estándar
  }

  const isApply = process.argv.includes('--apply') || process.argv.includes('--execute');

  console.log('======================================================================');
  console.log(' 🧹 PURGA DE OBJETOS RECHAZADOS EN CLOUDFLARE R2');
  console.log('======================================================================');
  console.log(`📍 Base de datos: Host: ${dbHost} | Base: ${dbName}`);
  console.log(`⚙️  Modo de ejecución: ${isApply ? '⚠️ REAL (--apply activado)' : '🔍 SIMULACIÓN (dry-run por defecto)'}\n`);

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 5,
  });

  const db = drizzle(pool);

  try {
    // 1. Contar y sumar archivos rechazados
    const [stats] = await db
      .select({
        count: count(),
        totalBytes: sql<number>`COALESCE(SUM(${libraryFiles.sizeBytes}), 0)`,
      })
      .from(libraryFiles)
      .where(eq(libraryFiles.status, 'rejected'));

    const rejectedCount = Number(stats?.count || 0);
    const totalBytes = Number(stats?.totalBytes || 0);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);

    console.log(`📊 Total de archivos en estado 'rejected' encontrados: ${rejectedCount}`);
    console.log(`📦 Espacio ocupado en R2 por estos archivos: ${totalMB} MB (${totalBytes} bytes)`);

    if (rejectedCount === 0) {
      console.log('\n✨ No hay archivos rechazados pendientes de purga en la base de datos.');
      return;
    }

    // 2. Obtener muestra de archivos rechazados
    const sample = await db
      .select({
        id: libraryFiles.id,
        title: libraryFiles.title,
        storageKey: libraryFiles.storageKey,
        sizeBytes: libraryFiles.sizeBytes,
        reviewedAt: libraryFiles.reviewedAt,
      })
      .from(libraryFiles)
      .where(eq(libraryFiles.status, 'rejected'))
      .limit(10);

    console.log('\n🔍 Muestra de archivos a purgar (primeros 10):');
    sample.forEach((f, idx) => {
      console.log(`  ${idx + 1}. [${f.id}] "${f.title}" (${(f.sizeBytes / 1024).toFixed(1)} KB) -> ${f.storageKey}`);
    });
    if (rejectedCount > 10) {
      console.log(`  ... y ${rejectedCount - 10} archivos más.`);
    }

    if (!isApply) {
      console.log('\n----------------------------------------------------------------------');
      console.log('ℹ️  MODO SIMULACIÓN ACTIVO: No se encoló ni eliminó ningún objeto.');
      console.log('Para ejecutar la purga y encolar la eliminación en R2, ejecutá:');
      console.log('   npx tsx server/scripts/purge-rejected-objects.ts --apply');
      console.log('----------------------------------------------------------------------\n');
      return;
    }

    // 3. Modo --apply: Encolar en library_orphan_deletions todos los storageKey
    console.log('\n⏳ Encolando storageKeys en library_orphan_deletions...');
    const allRejected = await db
      .select({ storageKey: libraryFiles.storageKey })
      .from(libraryFiles)
      .where(eq(libraryFiles.status, 'rejected'));

    let enqueuedCount = 0;
    for (const r of allRejected) {
      if (r.storageKey) {
        await db
          .insert(libraryOrphanDeletions)
          .values({ storageKey: r.storageKey, attempts: 0 });
        enqueuedCount++;
      }
    }

    console.log(`✅ ÉXITO: ${enqueuedCount} objetos rechazados encolados en library_orphan_deletions para purga en R2.`);
  } catch (err: any) {
    console.error('❌ Error durante la ejecución del script:', err?.message || err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();

