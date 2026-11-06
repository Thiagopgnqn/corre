/**
 * Script de verificación de concurrencia real y cupos de la Biblioteca
 * Diseñado para ejecutarse contra una rama de desarrollo/test de Neon Postgres.
 *
 * Modo de uso:
 *   DATABASE_URL="postgres://..." npx tsx server/scripts/check-upload-concurrency.ts
 *
 * Reglas de seguridad estrictas:
 * - Lee la cadena de conexión exclusivamente de la variable de entorno DATABASE_URL.
 * - NUNCA lee ni acepta la URL como argumento por línea de comandos para evitar que quede en el historial de bash.
 * - NUNCA imprime credenciales ni guarda la URL en ningún archivo (solo imprime host y base de datos).
 * - Solicita confirmación explícita escribiendo "SI-ES-RAMA-DE-PRUEBA" antes de ejecutar.
 * - No toca Cloudflare R2 real (utiliza simulador MemoryMockR2Service).
 * - Todo lo que crea lleva el prefijo identificable "test_conc_".
 * - Limpia estrictamente solo los registros creados con ese prefijo en el bloque finally.
 */

// Variables dummy si no están seteadas
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dummy_jwt_secret_for_concurrency_test_32chars';
process.env.REFRESH_SECRET = process.env.REFRESH_SECRET || 'dummy_refresh_secret_for_concurrency_test_32chars';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

import crypto from 'crypto';
import readline from 'readline';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and, sql, count } from 'drizzle-orm';
import { users, subjects, libraryFiles } from '../src/db/schema.js';
import { PgLibraryService } from '../src/modules/library/library.service.js';
import { MemoryMockR2Service } from '../src/services/r2.service.js';
import { LIBRARY_CONFIG } from '../src/config/library.config.js';

const targetDatabaseUrl = process.env.DATABASE_URL;

if (!targetDatabaseUrl || targetDatabaseUrl.includes('offline_test')) {
  console.error('\n❌ ERROR: Se requiere la variable de entorno DATABASE_URL con una conexión válida a Postgres.');
  console.log('\nModo de uso seguro:');
  console.log('  DATABASE_URL="postgres://..." npx tsx server/scripts/check-upload-concurrency.ts\n');
  process.exit(1);
}

let dbHost = 'desconocido';
let dbName = 'desconocido';
try {
  const parsed = new URL(targetDatabaseUrl);
  dbHost = parsed.host;
  dbName = parsed.pathname.replace(/^\//, '');
} catch {
  // En caso de formato no estándar
}

async function askConfirmation(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log(`\n📍 Base de datos destino: Host: [${dbHost}] | Base: [${dbName}]`);
    console.log('⚠️  ADVERTENCIA: Este script ejecutará pruebas de concurrencia y estrés de subida.');
    console.log('   Para confirmar que es una rama de prueba aislada y continuar,');
    rl.question('   escribí exactamente "SI-ES-RAMA-DE-PRUEBA": ', (answer) => {
      rl.close();
      resolve(answer.trim() === 'SI-ES-RAMA-DE-PRUEBA');
    });
  });
}

async function run() {
  console.log('======================================================================');
  console.log(' 🚀 TEST DE CONCURRENCIA REAL Y CUPOS EN NEON POSTGRES (FASE 1.5)');
  console.log('======================================================================');

  const confirmed = await askConfirmation();
  if (!confirmed) {
    console.log('\n🛑 Operación cancelada. No se ejecutó ninguna acción en la base de datos.\n');
    process.exit(0);
  }

  console.log('\n✅ Confirmación recibida. Iniciando pruebas de concurrencia...\n');

  const pool = new pg.Pool({
    connectionString: targetDatabaseUrl,
    ssl: targetDatabaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 40, // Suficientes conexiones para soportar 35 llamadas simultáneas
  });

  const testDb = drizzle(pool);
  const testR2 = new MemoryMockR2Service();
  const service = new PgLibraryService(testR2);

  const TEST_PREFIX = 'test_conc_';
  const testUserId = crypto.randomUUID();
  const testUserEmail = `${TEST_PREFIX}${Date.now()}@frc.utn.edu.ar`;
  const testSubjectId = `${TEST_PREFIX}${crypto.randomUUID().slice(0, 18)}`;

  try {
    // 1. Verificar conexión
    await pool.query('SELECT 1');
    console.log('✅ Conexión establecida con la base de datos');

    // 2. Crear materia aislada de prueba con prefijo identificable
    await testDb
      .insert(subjects)
      .values({
        id: testSubjectId,
        name: 'Materia de Prueba Concurrencia',
        codeInPlan: 9999,
        level: 1,
        kind: 'integradora',
        planId: 'plan-2023',
      })
      .onConflictDoNothing();
    console.log(`📚 Materia de prueba creada: ${testSubjectId}`);

    // 3. Crear usuario de prueba con términos aceptados y email verificado
    await testDb.insert(users).values({
      id: testUserId,
      email: testUserEmail,
      role: 'user',
      status: 'active',
      emailVerifiedAt: new Date(),
      libraryTermsAcceptedAt: new Date(),
      libraryTermsVersion: LIBRARY_CONFIG.CURRENT_TERMS_VERSION,
    });
    console.log(`👤 Usuario de prueba creado: ${testUserEmail} (${testUserId})`);

    // -------------------------------------------------------------------------
    // TEST A: Concurrencia real con Promise.all (35 llamadas simultáneas a initUpload)
    // -------------------------------------------------------------------------
    console.log('\n📌 TEST A: Concurrencia de 35 solicitudes simultáneas con Promise.all()...');
    const promises = Array.from({ length: 35 }, (_, idx) =>
      service
        .initUpload(testUserId, {
          subjectId: testSubjectId,
          kind: 'apunte',
          title: `${TEST_PREFIX}Archivo Concurrente ${idx + 1}`,
          originalFilename: `archivo_conc_${idx + 1}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          acceptTerms: true,
        })
        .then(() => ({ success: true, code: null }))
        .catch((err: any) => ({
          success: false,
          code: err.code || 'ERROR',
          status: err.status || 500,
        }))
    );

    const results = await Promise.all(promises);
    const successCount = results.filter((r) => r.success).length;
    const blockedCount = results.filter((r) => !r.success && r.code === 'LIMIT_PENDING_UPLOADS').length;

    console.log(`  - Solicitudes aceptadas (201): ${successCount} (esperado: 30)`);
    console.log(`  - Solicitudes bloqueadas por cupo (429 LIMIT_PENDING_UPLOADS): ${blockedCount} (esperado: 5)`);

    if (successCount !== 30 || blockedCount !== 5) {
      throw new Error(
        `Fallo de concurrencia: Se esperaban exactamente 30 éxitos y 5 bloqueos, pero se obtuvieron ${successCount} y ${blockedCount}.`
      );
    }
    console.log('✅ TEST A APROBADO: El límite de 30 pendientes fue respetado con precisión atómica bajo carga.');

    // -------------------------------------------------------------------------
    // TEST B: Expiración proactiva de archivos en estado 'uploading'
    // -------------------------------------------------------------------------
    console.log('\n📌 TEST B: Expiración de subidas huérfanas (> 30 min)...');
    // Forzar fecha antigua en 5 filas creadas
    const staleDate = new Date(Date.now() - 35 * 60 * 1000); // 35 min atrás
    await testDb
      .update(libraryFiles)
      .set({ createdAt: staleDate })
      .where(
        and(
          eq(libraryFiles.uploaderUserId, testUserId),
          sql`${libraryFiles.id} IN (
            SELECT id FROM library_files WHERE uploader_user_id = ${testUserId} LIMIT 5
          )`
        )
      );

    // Al lanzar un nuevo initUpload, las 5 filas stale deben ser purgadas antes del chequeo de pendientes
    await service.initUpload(testUserId, {
      subjectId: testSubjectId,
      kind: 'apunte',
      title: `${TEST_PREFIX}Nuevo archivo tras purga`,
      originalFilename: 'nuevo_tras_stale.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      acceptTerms: true,
    });

    // Contar cuántos archivos quedaron en total en la base para este usuario
    const [finalCountRes] = await testDb
      .select({ count: count() })
      .from(libraryFiles)
      .where(eq(libraryFiles.uploaderUserId, testUserId));

    const totalInDb = Number(finalCountRes?.count || 0);
    // Había 30, se purgaron 5 (quedaron 25) y se insertó 1 nuevo -> 26
    console.log(`  - Total de filas en base tras purga e inserción: ${totalInDb} (esperado: 26)`);

    if (totalInDb !== 26) {
      throw new Error(`Fallo en expiración proactiva: Se esperaban 26 filas, se encontraron ${totalInDb}.`);
    }
    console.log('✅ TEST B APROBADO: Las 5 filas en uploading de más de 30 minutos fueron purgadas exitosamente.');

    console.log('\n======================================================================');
    console.log(' 🏆 TODAS LAS PRUEBAS DE CONCURRENCIA EN NEON POSTGRES PASARON CON ÉXITO');
    console.log('======================================================================\n');
  } catch (err: any) {
    console.error('\n❌ ERROR EN LA VERIFICACIÓN DE CONCURRENCIA:', err?.message || err);
    process.exitCode = 1;
  } finally {
    console.log('🧹 Limpiando exclusivamente datos de prueba generados (prefijo test_conc_)...');
    try {
      await testDb.delete(libraryFiles).where(eq(libraryFiles.uploaderUserId, testUserId));
      await testDb.delete(users).where(eq(users.id, testUserId));
      await testDb.delete(subjects).where(eq(subjects.id, testSubjectId));
      console.log('✅ Limpieza completada sin afectar ninguna otra fila.');
    } catch (cleanupErr: any) {
      console.warn('⚠️ Nota limpiando datos de prueba:', cleanupErr?.message || cleanupErr);
    }
    await pool.end();
  }
}

run();
