// Configurar entorno aislado en memoria ANTES de importar módulos del servidor
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test_jwt_secret_super_seguro_de_al_menos_32_caracteres_2026';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://offline:offline@localhost:5432/offline_test';

import http from 'http';
import { Readable } from 'stream';
import jwt from 'jsonwebtoken';
import { CloudflareR2Service, MemoryMockR2Service } from '../src/services/r2.service.js';
import { validateFileStream, sanitizeLibraryText } from '../src/modules/library/library.validator.js';
import {
  InMemoryLibraryService,
  setLibraryServiceForTesting,
} from '../src/modules/library/library.service.js';
import { LIBRARY_CONFIG } from '../src/config/library.config.js';
import { setLiveUserResolverForTesting } from '../src/middlewares/auth.middleware.js';
import { createApp } from '../src/app.js';

async function main() {
  console.log('======================================================================');
  console.log(' 🧪 TESTS DE BIBLIOTECA DE MATERIAL DE ESTUDIO, R2, SEGURIDAD Y PRIVACIDAD');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.error(`  ❌ ${name}${detail ? ` -> ${detail}` : ''}`);
      failed++;
    }
  }

  // ---------------------------------------------------------------------------
  // 1. CLIENTE R2: COMPATIBILIDAD Y PARÁMETROS DE CHECKSUM (Requisito 3)
  // ---------------------------------------------------------------------------
  console.log('📌 1. Cliente Cloudflare R2 y Parámetros en URL Firmada');

  const cfR2 = new CloudflareR2Service('dummy-account', 'dummy-key', 'dummy-secret', 'dummy-bucket');
  const signedPutUrl = await cfR2.getPresignedUploadUrl({
    key: 'library/test-presigned.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
  });

  assert(
    !signedPutUrl.includes('x-amz-checksum-crc32'),
    'URL firmada de subida PUT NO contiene x-amz-checksum-crc32'
  );
  assert(
    !signedPutUrl.includes('x-amz-sdk-checksum-algorithm'),
    'URL firmada de subida PUT NO contiene x-amz-sdk-checksum-algorithm'
  );
  assert(
    signedPutUrl.includes('content-length'),
    'URL firmada de subida incluye ContentLength en cabeceras firmadas'
  );

  // ---------------------------------------------------------------------------
  // 2. VALIDACIÓN EN STREAMING: MAGIC NUMBERS Y DETECCIÓN DE SCRIPTS (Ajuste 3 y 10)
  // ---------------------------------------------------------------------------
  console.log('📌 2. Validación de Firmas Binarias (Magic Numbers) y Escaneo Streaming Anti-Malware');

  // 2.1 PDF válido con cabecera %PDF-
  const validPdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF');
  const validPdfRes = await validateFileStream(
    Readable.from(validPdfBytes),
    'application/pdf',
    validPdfBytes.length
  );
  assert(validPdfRes.isValid === true, 'PDF genuino con cabecera %PDF- es aceptado');
  assert(validPdfRes.sha256.length === 64, 'Calcula hash SHA-256 hexadecimal de 64 caracteres');

  // 2.2 Falso PDF (archivo EXE renombrado a .pdf)
  const fakePdfExe = Buffer.from('MZ\x90\x00\x03\x00\x00\x00Contenido binario ejecutable');
  const fakePdfRes = await validateFileStream(
    Readable.from(fakePdfExe),
    'application/pdf',
    fakePdfExe.length
  );
  assert(fakePdfRes.isValid === false, 'Rechaza archivo ejecutable EXE renombrado a .pdf (magic number inválido)');

  // 2.3 Imagen JPEG válida (\xFF\xD8\xFF)
  const validJpgBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const validJpgRes = await validateFileStream(
    Readable.from(validJpgBytes),
    'image/jpeg',
    validJpgBytes.length
  );
  assert(validJpgRes.isValid === true, 'Imagen JPEG con firma binaria válida es aceptada');

  // 2.4 Imagen PNG válida (\x89PNG\r\n\x1a\n)
  const validPngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const validPngRes = await validateFileStream(
    Readable.from(validPngBytes),
    'image/png',
    validPngBytes.length
  );
  assert(validPngRes.isValid === true, 'Imagen PNG con firma binaria válida es aceptada');

  // 2.5 Detección de PDF malicioso con /JavaScript
  const maliciousPdfJs = Buffer.from('%PDF-1.4\n<< /Type /Action /S /JavaScript /JS (app.alert("hack")) >>\n%%EOF');
  const malJsRes = await validateFileStream(
    Readable.from(maliciousPdfJs),
    'application/pdf',
    maliciousPdfJs.length
  );
  assert(malJsRes.isValid === false, 'PDF con directiva /JavaScript es detectado y rechazado');
  assert(malJsRes.hasDangerousPdfMarks === true, 'Marca hasDangerousPdfMarks = true');

  // 2.6 Detección de PDF malicioso con /Launch
  const maliciousPdfLaunch = Buffer.from('%PDF-1.4\n<< /Type /Action /S /Launch /F (cmd.exe) >>\n%%EOF');
  const malLaunchRes = await validateFileStream(
    Readable.from(maliciousPdfLaunch),
    'application/pdf',
    maliciousPdfLaunch.length
  );
  assert(malLaunchRes.isValid === false, 'PDF con directiva /Launch es detectado y rechazado');

  // 2.7 Detección de palabra clave partida entre dos chunks (tailBuffer remanente)
  const chunk1 = Buffer.from('%PDF-1.4 Objeto con script dividido: /Java');
  const chunk2 = Buffer.from('Script incrustado y peligroso %%EOF');
  const streamSplit = new Readable({
    read() {
      this.push(chunk1);
      this.push(chunk2);
      this.push(null);
    },
  });
  const splitRes = await validateFileStream(
    streamSplit,
    'application/pdf',
    chunk1.length + chunk2.length
  );
  assert(
    splitRes.isValid === false && splitRes.hasDangerousPdfMarks === true,
    'Detección infalible de script partido en el límite de 64 bytes entre dos chunks sucesivos (tailBuffer)'
  );

  // ---------------------------------------------------------------------------
  // 3. ENTORNO HTTP Y CONFIGURACIÓN EN MEMORIA
  // ---------------------------------------------------------------------------
  console.log('📌 3. Configuración de API y Middleware de Biblioteca');

  const mockR2 = new MemoryMockR2Service();
  const libraryStore = new InMemoryLibraryService(mockR2);
  setLibraryServiceForTesting(libraryStore);

  // Sembrar materias de prueba
  libraryStore.seedSubject({ id: 'sub-sintaxis', name: 'Sintaxis y Semántica de los Lenguajes', codeInPlan: 204, level: 2 });
  libraryStore.seedSubject({ id: 'sub-paradigmas', name: 'Paradigmas de Programación', codeInPlan: 205, level: 2 });
  libraryStore.seedProfessor({ id: 'prof-garcia', displayName: 'García, Alfredo' });

  // Sembrar usuarios con UUIDs válidos
  const student1Id = '11111111-1111-4111-8111-111111111111';
  const student2Id = '22222222-2222-4222-8222-222222222222';
  const unverifiedId = '33333333-3333-4333-8333-333333333333';
  const adminId = '99999999-9999-4999-8999-999999999999';
  const student3Id = '44444444-4444-4444-8444-444444444444';

  libraryStore.seedUser({ id: student1Id, email: 'alumno1@frc.utn.edu.ar', role: 'user', emailVerified: true, termsAccepted: true });
  libraryStore.seedUser({ id: student2Id, email: 'alumno2@frc.utn.edu.ar', role: 'user', emailVerified: true, termsAccepted: false });
  libraryStore.seedUser({ id: unverifiedId, email: 'no-verificado@frc.utn.edu.ar', role: 'user', emailVerified: false, termsAccepted: true });
  libraryStore.seedUser({ id: adminId, email: 'admin-lib@stack.com', role: 'admin', emailVerified: true, termsAccepted: true });
  libraryStore.seedUser({ id: student3Id, email: 'alumno3@frc.utn.edu.ar', role: 'user', emailVerified: true, termsAccepted: true });

  setLiveUserResolverForTesting(async (id: string) => {
    const u = libraryStore.users.get(id);
    if (!u) return null;
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      status: u.status,
      emailVerified: Boolean(u.emailVerifiedAt),
    };
  });

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  function signToken(payload: { id: string; email: string; role: 'user' | 'admin'; emailVerified?: boolean }) {
    return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '1h' });
  }

  function signReauthToken(userId: string, adminEmail: string) {
    return jwt.sign(
      { purpose: 'admin-reauth', userId, adminEmail, iat: Math.floor(Date.now() / 1000) },
      process.env.JWT_SECRET!,
      { expiresIn: '10m' }
    );
  }

  async function api(method: string, path: string, token?: string, body?: any, reauthToken?: string) {
    return new Promise<{ status: number; data: any; headers: any }>((resolve, reject) => {
      const payloadStr = body ? JSON.stringify(body) : undefined;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (reauthToken) headers['Cookie'] = `admin_reauth_token=${reauthToken}`;
      if (payloadStr) headers['Content-Length'] = Buffer.byteLength(payloadStr).toString();

      const req = http.request(
        { hostname: '127.0.0.1', port, path, method, headers },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            let data: any = null;
            try { data = JSON.parse(raw); } catch { data = raw; }
            resolve({ status: res.statusCode || 500, data, headers: res.headers });
          });
        }
      );
      req.on('error', reject);
      if (payloadStr) req.write(payloadStr);
      req.end();
    });
  }

  const student1Token = signToken({ id: student1Id, email: 'alumno1@frc.utn.edu.ar', role: 'user', emailVerified: true });
  const student2Token = signToken({ id: student2Id, email: 'alumno2@frc.utn.edu.ar', role: 'user', emailVerified: true });
  const unverifiedToken = signToken({ id: unverifiedId, email: 'no-verificado@frc.utn.edu.ar', role: 'user', emailVerified: false });
  const adminToken = signToken({ id: adminId, email: 'admin-lib@stack.com', role: 'admin', emailVerified: true });
  const adminReauth = signReauthToken(adminId, 'admin-lib@stack.com');

  // ---------------------------------------------------------------------------
  // 4. AUTENTICACIÓN, CORREO VERIFICADO Y TÉRMINOS Y CONDICIONES
  // ---------------------------------------------------------------------------
  console.log('📌 4. Guardias de Seguridad: Email Verificado y Aceptación de Términos');

  // Acceso sin login -> 401
  const noAuthRes = await api('GET', '/api/library/terms-status');
  assert(noAuthRes.status === 401, 'Acceso sin autenticación devuelve 401 Unauthorized');

  // Usuario con email no verificado -> 403
  const unverifiedRes = await api('GET', '/api/library/terms-status', unverifiedToken);
  assert(unverifiedRes.status === 403, 'Usuario sin email verificado recibe 403 Forbidden en la biblioteca');

  // Alumno 2 consulta estado de términos (no aceptados aún)
  const termsStatusRes = await api('GET', '/api/library/terms-status', student2Token);
  assert(termsStatusRes.status === 200 && termsStatusRes.data.data.accepted === false, 'Alumno sin aceptar términos reporta accepted: false');

  // Intentar subir material sin aceptar términos -> 403 TERMS_REQUIRED
  const uploadNoTerms = await api('POST', '/api/library/uploads/init', student2Token, {
    subjectId: 'sub-sintaxis',
    kind: 'parcial',
    title: '1er Parcial 2024',
    originalFilename: 'parcial.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
  });
  assert(
    uploadNoTerms.status === 403 && uploadNoTerms.data.code === 'TERMS_REQUIRED',
    'Bloqueo garantizado: subida rechazada con código TERMS_REQUIRED si no se aceptaron los términos'
  );

  // Aceptar términos
  const acceptRes = await api('POST', '/api/library/accept-terms', student2Token, { version: 'v1.0' });
  assert(acceptRes.status === 200 && acceptRes.data.success === true, 'Alumno acepta términos y condiciones exitosamente');

  // ---------------------------------------------------------------------------
  // 5. RECHAZO DE FORMATOS Y TAMAÑOS (Requisito 1 y Ajuste 10)
  // ---------------------------------------------------------------------------
  console.log('📌 5. Restricciones de Formato y Límites de Tamaño Diferenciados');

  // Formato no permitido: .zip
  const zipUpload = await api('POST', '/api/library/uploads/init', student1Token, {
    subjectId: 'sub-sintaxis',
    kind: 'tp',
    title: 'TP Sintaxis en ZIP',
    originalFilename: 'tp.zip',
    mimeType: 'application/zip',
    sizeBytes: 2048,
  });
  assert(zipUpload.status === 400, 'Rechaza extensiones no permitidas (.zip)');

  // Formato no permitido: .docx
  const docxUpload = await api('POST', '/api/library/uploads/init', student1Token, {
    subjectId: 'sub-sintaxis',
    kind: 'resumen',
    title: 'Resumen en Word',
    originalFilename: 'resumen.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: 2048,
  });
  assert(docxUpload.status === 400, 'Rechaza archivos de Office (.docx)');

  // PDF que supera 25 MB (26 MB)
  const hugePdf = await api('POST', '/api/library/uploads/init', student1Token, {
    subjectId: 'sub-sintaxis',
    kind: 'parcial',
    title: 'Parcial Gigante',
    originalFilename: 'parcial.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 26 * 1024 * 1024,
  });
  assert(hugePdf.status === 400, 'Rechaza PDF mayor a 25 MB (26 MB)');

  // Imagen que supera 10 MB (11 MB)
  const hugeImage = await api('POST', '/api/library/uploads/init', student1Token, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Pizarrón Gigante',
    originalFilename: 'foto.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 11 * 1024 * 1024,
  });
  assert(hugeImage.status === 400, 'Rechaza Imagen mayor a 10 MB (11 MB)');

  // PDF válido dentro del límite
  const validPdfBuffer = Buffer.from('%PDF-1.4 Contenido del parcial resuelto 2024 %%EOF');
  const validPdfInit = await api('POST', '/api/library/uploads/init', student1Token, {
    subjectId: 'sub-sintaxis',
    kind: 'parcial',
    title: '1er Parcial Turno Noche',
    academicYear: 2024,
    term: '1C',
    examInstance: '1er Parcial',
    hasSolution: true,
    originalFilename: 'parcial-resuelto.pdf',
    mimeType: 'application/pdf',
    sizeBytes: validPdfBuffer.length,
  });
  assert(validPdfInit.status === 201, 'Acepta PDF válido dentro del límite de 25 MB');
  assert(validPdfInit.data.data.uploadUrl && validPdfInit.data.data.fileId, 'Genera URL prefirmada PUT y fileId');

  // ---------------------------------------------------------------------------
  // 6. FLUJO COMPLETO DE SUBIDA, VALIDACIÓN EN R2 Y MODERACIÓN (Requisito 5)
  // ---------------------------------------------------------------------------
  console.log('📌 6. Flujo de Subida Directa PUT a R2 y Finalización en POST /api/library/uploads/:id/complete');

  const file1Id = validPdfInit.data.data.fileId;
  const storageKey1 = validPdfInit.data.data.storageKey;

  // Simular que el navegador subió directamente el archivo a R2
  await mockR2.putObjectDirect(storageKey1, validPdfBuffer, 'application/pdf');

  // Finalizar subida usando la ruta POST /api/library/uploads/:id/complete
  const completeRes = await api('POST', `/api/library/uploads/${file1Id}/complete`, student1Token);
  assert(completeRes.status === 200, 'POST /api/library/uploads/:id/complete responde 200 OK');
  assert(completeRes.data.data.file.status === 'pending', 'El archivo pasa exitosamente a estado pending para moderación');
  assert(completeRes.data.data.file.sha256 !== null, 'El campo sha256 ahora contiene el hash validado');

  // ---------------------------------------------------------------------------
  // 7. PRIVACIDAD ESTRICTA: ANÓNIMO Y AISLAMIENTO DE PENDIENTES
  // ---------------------------------------------------------------------------
  console.log('📌 7. Privacidad Estricta del Alumno y Aislamiento en el Catálogo Público');

  // El alumno 2 lista archivos de la materia: NO debe ver el archivo pendiente del alumno 1
  const publicListBeforeApprove = await api('GET', '/api/library/subjects/sub-sintaxis/files', student2Token);
  assert(publicListBeforeApprove.data.data.items.length === 0, 'Archivos en estado pending son invisibles para otros alumnos');

  // El autor sí lo ve en "Mis aportes"
  const myUploadsRes = await api('GET', '/api/library/my-uploads', student1Token);
  assert(myUploadsRes.data.data.uploads.some((u: any) => u.id === file1Id && u.status === 'pending'), 'El autor ve su aporte en revisión en Mis Aportes');

  // Admin aprueba el material
  const approveRes = await api('PATCH', `/api/admin/library/files/${file1Id}/approve`, adminToken);
  assert(approveRes.status === 200 && approveRes.data.data.status === 'approved', 'Administrador aprueba el material');

  // Ahora el alumno 2 consulta el catálogo: ya es visible
  const publicListAfterApprove = await api('GET', '/api/library/subjects/sub-sintaxis/files', student2Token);
  assert(publicListAfterApprove.data.data.items.length === 1, 'Material aprobado es visible en el catálogo de alumnos');
  const publicItem = publicListAfterApprove.data.data.items[0];
  assert(publicItem.uploaderDisplay === 'Subido por un estudiante', 'Anonimato garantizado: uploaderDisplay es "Subido por un estudiante"');
  assert(!('uploaderUserId' in publicItem) && !('uploaderEmail' in publicItem), 'La API pública NUNCA expone uploaderUserId ni email');

  // ---------------------------------------------------------------------------
  // 8. DESCARGA PROTEGIDA, RATE LIMITING Y VOTO ÚTIL (Ajuste 6)
  // ---------------------------------------------------------------------------
  console.log('📌 8. Descarga Forzada (attachment), Conteo Único y Límite Horario (60/hora)');

  // Primera descarga por alumno 2
  const dlRes1 = await api('GET', `/api/library/files/${file1Id}/download`, student2Token);
  assert(dlRes1.status === 200, 'Genera URL prefirmada GET de descarga para usuario verificado');

  // El archivo ahora tiene downloadCount = 1
  const detailRes1 = await api('GET', `/api/library/files/${file1Id}`, student2Token);
  assert(detailRes1.data.data.downloadCount === 1, 'Primera descarga incrementa downloadCount a 1');

  // Segunda descarga por el mismo alumno: NO debe duplicar el contador único
  await api('GET', `/api/library/files/${file1Id}/download`, student2Token);
  const detailRes2 = await api('GET', `/api/library/files/${file1Id}`, student2Token);
  assert(detailRes2.data.data.downloadCount === 1, 'Descargas repetidas del mismo alumno NO incrementan downloadCount (conteo único)');

  // Límite horario de descargas (60/h)
  for (let i = 0; i < 58; i++) {
    libraryStore.downloadLogs.push({
      id: crypto.randomUUID(),
      fileId: file1Id,
      userId: student2Id,
      downloadedAt: new Date(),
    });
  }
  const dlRateLimited = await api('GET', `/api/library/files/${file1Id}/download`, student2Token);
  assert(
    dlRateLimited.status === 429 && dlRateLimited.data.code === 'LIMIT_HOURLY_DOWNLOADS',
    'Bloqueo anti-scraping: supera 60 descargas/hora y recibe 429 LIMIT_HOURLY_DOWNLOADS'
  );

  // Voto "Me sirvió" (toggle)
  const voteRes1 = await api('POST', `/api/library/files/${file1Id}/helpful`, student1Token);
  assert(voteRes1.data.data.voted === true && voteRes1.data.data.helpfulCount === 1, 'Voto útil incrementa helpfulCount a 1');

  const voteRes2 = await api('POST', `/api/library/files/${file1Id}/helpful`, student1Token);
  assert(voteRes2.data.data.voted === false && voteRes2.data.data.helpfulCount === 0, 'Segundo clic remueve el voto útil (toggle decrementa a 0)');

  // ---------------------------------------------------------------------------
  // 9. DEDUPLICACIÓN SHA-256 Y CONDICIÓN DE CARRERA (Requisito 1)
  // ---------------------------------------------------------------------------
  console.log('📌 9. Deduplicación por SHA-256 y Prueba de Concurrencia en /complete');

  // Subir un segundo archivo con contenido idéntico
  const duplicateInit = await api('POST', '/api/library/uploads/init', student1Token, {
    subjectId: 'sub-sintaxis',
    kind: 'parcial',
    title: 'Parcial duplicado',
    originalFilename: 'duplicado.pdf',
    mimeType: 'application/pdf',
    sizeBytes: validPdfBuffer.length,
  });
  const file2Id = duplicateInit.data.data.fileId;
  const storageKey2 = duplicateInit.data.data.storageKey;
  await mockR2.putObjectDirect(storageKey2, validPdfBuffer, 'application/pdf');

  // Finalizar: debe detectar duplicado por SHA-256 idéntico
  const duplicateComplete = await api('POST', `/api/library/uploads/${file2Id}/complete`, student1Token);
  assert(
    duplicateComplete.status === 409 && duplicateComplete.data.code === 'DUPLICATE_FILE',
    'Pre-chequeo detecta archivo idéntico por SHA-256 y responde 409 DUPLICATE_FILE'
  );
  assert(!mockR2.hasObjectDirect(storageKey2), 'El archivo duplicado es borrado de inmediato de R2');

  // Test de Condición de Carrera: Simulación de dos peticiones concurrentes donde el índice de base de datos colisiona
  const raceBuffer = Buffer.from('%PDF-1.4 Concurrencia %%EOF');
  const raceInit = await api('POST', '/api/library/uploads/init', student1Token, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Carrera concurrente',
    originalFilename: 'carrera.pdf',
    mimeType: 'application/pdf',
    sizeBytes: raceBuffer.length,
  });
  const fileRaceId = raceInit.data.data.fileId;
  const storageKeyRace = raceInit.data.data.storageKey;
  await mockR2.putObjectDirect(storageKeyRace, raceBuffer, 'application/pdf');

  // Forzar simulación de colisión única simultánea en la base de datos
  libraryStore.simulateSha256CollisionOnComplete = true;
  const raceCompleteRes = await api('POST', `/api/library/uploads/${fileRaceId}/complete`, student1Token);
  libraryStore.simulateSha256CollisionOnComplete = false;

  assert(
    raceCompleteRes.status === 409 && raceCompleteRes.data.code === 'DUPLICATE_FILE',
    'Condición de carrera: captura colisión de índice único uq_lib_files_sha256_active y responde 409'
  );
  assert(!mockR2.hasObjectDirect(storageKeyRace), 'Objeto borrado de R2 tras colisión concurrente');

  // ---------------------------------------------------------------------------
  // 10. REPORTE Y AUTO-OCULTAMIENTO PREVENTIVO
  // ---------------------------------------------------------------------------
  console.log('📌 10. Reportes de la Comunidad y Umbral de Auto-Ocultamiento');

  // Reporte 1 de derechos de autor
  await api('POST', `/api/library/files/${file1Id}/report`, student1Token, {
    reason: 'derechos_de_autor',
    note: 'Pertenece a una editorial',
  });
  let fileCheck = libraryStore.files.get(file1Id);
  assert(fileCheck.status === 'approved', '1 reporte de derechos de autor mantiene el archivo publicado');

  // Reporte 2 de derechos de autor (alcanza umbral de 2)
  const rep2Res = await api('POST', `/api/library/files/${file1Id}/report`, student2Token, {
    reason: 'derechos_de_autor',
  });
  fileCheck = libraryStore.files.get(file1Id);
  assert(
    rep2Res.data.data.autoHidden === true && fileCheck.status === 'hidden',
    'Alcanza umbral (>= 2 derechos de autor) y pasa preventivamente a estado hidden'
  );

  // ---------------------------------------------------------------------------
  // 11. ACCIONES DE ADMINISTRACIÓN CON REAUTENTICACIÓN Y AUDITORÍA (Ajuste 5 y Requisito 4)
  // ---------------------------------------------------------------------------
  console.log('📌 11. Panel de Administración: Identidad del Autor, Suspensión y Prueba de R2');

  // 11.1 Consultar autor sin reauth -> 403 REAUTH_REQUIRED
  const viewNoReauth = await api('GET', `/api/admin/library/files/${file1Id}/uploader`, adminToken);
  assert(viewNoReauth.status === 403 && viewNoReauth.data.code === 'REAUTH_REQUIRED', 'Consultar identidad del autor exige reautenticación reciente');

  // 11.2 Consultar autor con reauth -> Exitoso y auditado
  const viewWithReauth = await api('GET', `/api/admin/library/files/${file1Id}/uploader`, adminToken, undefined, adminReauth);
  assert(viewWithReauth.status === 200 && viewWithReauth.data.data.uploader.email === 'alumno1@frc.utn.edu.ar', 'Admin consulta identidad del autor con reauth');

  // 11.3 Suspender autor desde el archivo
  const suspendRes = await api(
    'POST',
    `/api/admin/library/files/${file1Id}/suspend-author`,
    adminToken,
    { reason: 'Violación reiterada de copyright' },
    adminReauth
  );
  assert(suspendRes.status === 200, 'Admin suspende cuenta del autor con reauth');
  const suspendedUser = libraryStore.users.get(student1Id);
  assert(suspendedUser?.status === 'suspended', 'Estado del usuario pasa a suspended en base de datos');

  // 11.4 Probar conexión con R2 (Requisito 4)
  const testStorageNoReauth = await api('POST', '/api/admin/library/test-storage', adminToken);
  assert(testStorageNoReauth.status === 403, 'POST /api/admin/library/test-storage exige reautenticación');

  const testStorageRes = await api('POST', '/api/admin/library/test-storage', adminToken, {}, adminReauth);
  assert(testStorageRes.status === 200 && testStorageRes.data.data.success === true, 'POST /api/admin/library/test-storage prueba subida, lectura y borrado con éxito');
  assert(testStorageRes.data.data.steps.upload.ok && testStorageRes.data.data.steps.read.ok && testStorageRes.data.data.steps.delete.ok, 'Informe claro con los 3 pasos de prueba completados');

  // ---------------------------------------------------------------------------
  // 12. TAREA DE LIMPIEZA PERIÓDICA Y PURGA DE LOGS (Requisito 2 y 3)
  // ---------------------------------------------------------------------------
  console.log('📌 12. Tarea de Limpieza: Subidas Huérfanas, Reintentos y Purga de Logs (> 7 días)');

  // Simular subida abandonada de hace 30 horas en estado 'uploading'
  const oldDate = new Date(Date.now() - 30 * 60 * 60 * 1000);
  const abandonedKey = 'library/abandoned.pdf';
  await mockR2.putObjectDirect(abandonedKey, Buffer.from('abandoned'), 'application/pdf');
  libraryStore.files.set('file-abandoned', {
    id: 'file-abandoned',
    uploaderUserId: student2Id,
    subjectId: 'sub-sintaxis',
    kind: 'parcial',
    title: 'Subida abandonada',
    storageKey: abandonedKey,
    sizeBytes: 10,
    status: 'uploading',
    createdAt: oldDate,
    updatedAt: oldDate,
  });

  // Simular log de descarga viejo de hace 10 días
  const oldDownloadDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  libraryStore.downloadLogs.push({
    id: crypto.randomUUID(),
    fileId: file1Id,
    userId: student2Id,
    downloadedAt: oldDownloadDate,
  });
  const logsCountBefore = libraryStore.downloadLogs.length;

  const cleanupRes = await libraryStore.cleanupAbandonedUploads();
  assert(cleanupRes.cleanedCount >= 1, 'Limpia subidas huérfanas en estado uploading de más de 24 horas');
  assert(!mockR2.hasObjectDirect(abandonedKey), 'Borra el objeto correspondiente de R2');
  assert(!libraryStore.files.has('file-abandoned'), 'Elimina el registro de la base de datos');
  assert(cleanupRes.purgedLogsCount >= 1, 'Purga logs de descarga con antigüedad superior a 7 días');

  // ---------------------------------------------------------------------------
  // 13. BORRADO DE CUENTA CON CASILLA "ELIMINAR MIS ARCHIVOS" (Ajuste 1)
  // ---------------------------------------------------------------------------
  console.log('📌 13. Borrado de Cuenta: deleteFiles: true vs deleteFiles: false');

  // Crear archivo para alumno 2
  const fileKeepKey = 'library/keep-community.pdf';
  await mockR2.putObjectDirect(fileKeepKey, Buffer.from('%PDF-1.4 Material Comunitario %%EOF'), 'application/pdf');
  libraryStore.files.set('file-community', {
    id: 'file-community',
    uploaderUserId: student2Id,
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Apunte que queda para la comunidad',
    storageKey: fileKeepKey,
    sizeBytes: 50,
    status: 'approved',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Alumno 2 se da de baja con deleteFiles = false (preservar para la comunidad)
  await libraryStore.handleAccountDeletion(student2Id, false);
  const preservedFile = libraryStore.files.get('file-community');
  assert(preservedFile !== undefined, 'Archivo se preserva en el catálogo si deleteFiles: false');
  assert(preservedFile.uploaderUserId === null, 'La autoría se desvincula fijando uploaderUserId = null');
  assert(mockR2.hasObjectDirect(fileKeepKey), 'El objeto en R2 permanece activo');

  // Alumno 3 se da de baja con deleteFiles = true
  const fileDeleteKey = 'library/to-delete.pdf';
  await mockR2.putObjectDirect(fileDeleteKey, Buffer.from('%PDF-1.4 Borrar todo %%EOF'), 'application/pdf');
  libraryStore.files.set('file-delete-user', {
    id: 'file-delete-user',
    uploaderUserId: student3Id,
    subjectId: 'sub-sintaxis',
    kind: 'resumen',
    title: 'Resumen a borrar',
    storageKey: fileDeleteKey,
    sizeBytes: 40,
    status: 'approved',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await libraryStore.handleAccountDeletion(student3Id, true);
  assert(!libraryStore.files.has('file-delete-user'), 'Archivo eliminado de la base si deleteFiles: true');
  assert(!mockR2.hasObjectDirect(fileDeleteKey), 'Objeto eliminado físicamente de R2 si deleteFiles: true');

  server.close();

  console.log('\n======================================================================');
  console.log(` 📊 RESULTADO TESTS BIBLIOTECA: ${passed} pasaron, ${failed} fallaron`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Error fatal ejecutando tests de biblioteca:', err);
  process.exit(1);
});
