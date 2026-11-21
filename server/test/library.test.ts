// Configurar entorno aislado en memoria ANTES de evaluar cualquier módulo del servidor
import './setupTestEnv.js';

import http from 'http';
import crypto from 'crypto';
import zlib from 'zlib';
import { Readable } from 'stream';
import jwt from 'jsonwebtoken';
import { CloudflareR2Service, MemoryMockR2Service } from '../src/services/r2.service.js';
import { validateFileStream, sanitizeLibraryText } from '../src/modules/library/library.validator.js';
import { PdfSecurityScanner, PDF_SCANNER_LIMITS } from '../src/modules/library/pdfSecurityScanner.js';
import {
  InMemoryLibraryService,
  setLibraryServiceForTesting,
  resetInitUploadRateLimits,
} from '../src/modules/library/library.service.js';
import {
  LIBRARY_CONFIG,
  setAdminNotifyCooldownOverride,
} from '../src/config/library.config.js';
import {
  mockSentNotifications,
  clearMockSentNotifications,
  setMockAdminRecipients,
  escapeHtml,
  sanitizeSubject,
  buildAdminBatchSummaryEmail,
  buildUploaderGroupedApprovedEmail,
  buildUploaderGroupedRejectedEmail,
  processPendingAdminNotifications,
  processPendingUploaderNotifications,
  resetMailerTimers,
} from '../src/modules/library/library.mailer.js';
import { defaultMailer } from '../src/modules/mailer/mailer.service.js';
import { Semaphore, validationSemaphore } from '../src/utils/semaphore.js';
import { setLiveUserResolverForTesting } from '../src/middlewares/auth.middleware.js';
import {
  InMemoryCatalogStore,
  setCatalogStoreForTesting,
} from '../src/modules/catalog/catalog.store.js';
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

  // 2.7 Detección de objeto PDF peligroso real partido entre dos chunks
  const chunk1 = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /OpenAction << /S /Java');
  const chunk2 = Buffer.from('Script /JS (app.alert(1)) >> >>\nendobj\n%%EOF');
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
    'Detección de PDF peligroso real con directiva partida entre dos chunks sucesivos'
  );

  // 2.8 Cambio de política intencional: "/JavaScript" suelto en texto plano o string literal ahora es PERMITIDO
  const plainJsTextPdf = Buffer.from(
    '%PDF-1.4\n% Comentario con /JavaScript /Launch\n1 0 obj\n<< /Type /Catalog /Title (/JavaScript /JS /Launch /OpenAction) >>\nendobj\n/JavaScript suelto en texto plano fuera de diccionarios\n%%EOF'
  );
  const plainJsTextRes = await validateFileStream(
    Readable.from(plainJsTextPdf),
    'application/pdf',
    plainJsTextPdf.length
  );
  assert(
    plainJsTextRes.isValid === true,
    'Cambio de política: "/JavaScript" suelto en texto plano, comentario o string literal es PERMITIDO'
  );

  // 2.9 Marca dentro de texto visible (content stream) es PERMITIDO
  const contentStreamText = 'BT /F1 12 Tf 72 720 Td (/JavaScript /JS /Launch /OpenAction /AA) Tj ET';
  const visibleTextPdf = Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length ${contentStreamText.length} >>\nstream\n${contentStreamText}\nendstream\nendobj\n%%EOF`
  );
  const visibleTextRes = await validateFileStream(
    Readable.from(visibleTextPdf),
    'application/pdf',
    visibleTextPdf.length
  );
  assert(
    visibleTextRes.isValid === true,
    'PDF con marcas solo dentro de texto visible (content stream) es PERMITIDO'
  );

  // 2.10 PDF con formulario (/AcroForm) y campo calculado (/FT y /Widget con /AA /C, /F, /K, /V) es PERMITIDO
  const formPdf = Buffer.from(
    '%PDF-1.4\n' +
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R 5 0 R] >> >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /Annots [4 0 R 5 0 R 8 0 R] >>\nendobj\n' +
      '4 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Tx /T (Subtotal) /P 3 0 R /AA << /K << /S /JavaScript /JS (AFNumber_Keystroke(2,0,0,0,"",true)) >> /F << /S /JavaScript /JS (AFNumber_Format(2,0,0,0,"",true)) >> /V << /S /JavaScript /JS (AFRange_Validate(true,0,false,0)) >> >> >>\nendobj\n' +
      '5 0 obj\n<< /FT /Tx /T (Total) /Kids [6 0 R] /AA << /C 7 0 R >> >>\nendobj\n' +
      '6 0 obj\n<< /Type /Annot /Subtype /Widget /Parent 5 0 R /P 3 0 R >>\nendobj\n' +
      '7 0 obj\n<< /Type /Action /S /JavaScript /JS (AFSimple_Calculate("SUM",["Subtotal"])) >>\nendobj\n' +
      '8 0 obj\n<< /Type /Annot /Subtype /Link /A << /S /URI /URI (https://frc.utn.edu.ar) >> >>\nendobj\n' +
      '%%EOF'
  );
  const formPdfRes = await validateFileStream(
    Readable.from(formPdf),
    'application/pdf',
    formPdf.length
  );
  assert(
    formPdfRes.isValid === true,
    'PDF con formulario (/AcroForm), campo calculado (/AA /C /F /K /V) y link /URI normal es PERMITIDO'
  );

  // 2.11 PDF con /OpenAction de navegación (GoTo y destino [página /Fit]) es PERMITIDO
  const navFitPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction [3 0 R /Fit] >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n%%EOF'
  );
  const navFitRes = await validateFileStream(
    Readable.from(navFitPdf),
    'application/pdf',
    navFitPdf.length
  );
  assert(navFitRes.isValid === true, 'PDF con /OpenAction [3 0 R /Fit] de navegación es PERMITIDO');

  const navGoToPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n4 0 obj\n<< /Type /Action /S /GoTo /D [3 0 R /XYZ 0 792 null] >>\nendobj\n%%EOF'
  );
  const navGoToRes = await validateFileStream(
    Readable.from(navGoToPdf),
    'application/pdf',
    navGoToPdf.length
  );
  assert(navGoToRes.isValid === true, 'PDF con /OpenAction /S /GoTo indirecto es PERMITIDO');

  // Helper para comprobar que los mensajes de rechazo nunca filtran marcas técnicas
  const TECHNICAL_MARKS_FORBIDDEN_IN_USER_MSG = [
    '/JavaScript',
    '/JS',
    '/Launch',
    '/OpenAction',
    '/AA',
    '/EmbeddedFile',
    '/ObjStm',
    '/Encrypt',
    '/SubmitForm',
    '/ImportData',
    '/GoToR',
    '/GoToE',
  ];
  function assertUserMsgIsCleanAndHelpful(res: Awaited<ReturnType<typeof validateFileStream>>, label: string) {
    const err = res.error || '';
    const leaksMark = TECHNICAL_MARKS_FORBIDDEN_IN_USER_MSG.some((m) => err.includes(m));
    assert(
      !leaksMark && /exportar|imprimilo a PDF/i.test(err),
      `${label}: mensaje al usuario no expone marcas técnicas y sugiere re-exportar o imprimir a PDF`
    );
  }

  // 2.12 PDF con JavaScript en /OpenAction (directo e indirecto) -> RECHAZADO
  const openActionJsDirect = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\nendobj\n%%EOF'
  );
  const oaJsDirectRes = await validateFileStream(
    Readable.from(openActionJsDirect),
    'application/pdf',
    openActionJsDirect.length
  );
  assert(
    oaJsDirectRes.isValid === false && oaJsDirectRes.hasDangerousPdfMarks === true,
    'PDF con JavaScript directo en /OpenAction es RECHAZADO'
  );
  assertUserMsgIsCleanAndHelpful(oaJsDirectRes, '/OpenAction JS directo');

  const openActionJsIndirect = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /OpenAction 7 0 R >>\nendobj\n7 0 obj\n<< /S /JavaScript /JS (app.alert(1)) >>\nendobj\n%%EOF'
  );
  const oaJsIndirectRes = await validateFileStream(
    Readable.from(openActionJsIndirect),
    'application/pdf',
    openActionJsIndirect.length
  );
  assert(
    oaJsIndirectRes.isValid === false && oaJsIndirectRes.hasDangerousPdfMarks === true,
    'PDF con JavaScript en /OpenAction por referencia indirecta (7 0 R) es RECHAZADO'
  );

  // /OpenAction con /URI también rechazado
  const openActionUri = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /OpenAction << /S /URI /URI (https://evil.example) >> >>\nendobj\n%%EOF'
  );
  const oaUriRes = await validateFileStream(
    Readable.from(openActionUri),
    'application/pdf',
    openActionUri.length
  );
  assert(
    oaUriRes.isValid === false && oaUriRes.hasDangerousPdfMarks === true,
    'PDF con /OpenAction apuntando a /URI es RECHAZADO'
  );

  // 2.13 /AA con JS en /Page, /Catalog, trigger /PO de Widget, objeto genérico y botón /A con JS -> RECHAZADOS
  const aaPagePdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Page /AA << /O << /S /JavaScript /JS (app.alert(1)) >> >> >>\nendobj\n%%EOF'
  );
  const aaPageRes = await validateFileStream(Readable.from(aaPagePdf), 'application/pdf', aaPagePdf.length);
  assert(aaPageRes.isValid === false && aaPageRes.hasDangerousPdfMarks === true, 'PDF con /AA /O en /Page es RECHAZADO');

  const aaPageCalcSpoofPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Page /FT /Tx /AA << /C << /S /JavaScript /JS (app.alert(1)) >> >> >>\nendobj\n%%EOF'
  );
  const aaPageSpoofRes = await validateFileStream(
    Readable.from(aaPageCalcSpoofPdf),
    'application/pdf',
    aaPageCalcSpoofPdf.length
  );
  assert(
    aaPageSpoofRes.isValid === false && aaPageSpoofRes.hasDangerousPdfMarks === true,
    'PDF con /Page spoofeando /FT /Tx y /AA /C sigue siendo RECHAZADO'
  );

  const aaCatalogPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /AA << /WC << /S /JavaScript /JS (app.alert(1)) >> >> >>\nendobj\n%%EOF'
  );
  const aaCatalogRes = await validateFileStream(Readable.from(aaCatalogPdf), 'application/pdf', aaCatalogPdf.length);
  assert(aaCatalogRes.isValid === false && aaCatalogRes.hasDangerousPdfMarks === true, 'PDF con /AA en /Catalog es RECHAZADO');

  const aaWidgetHoverPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Tx /AA << /PO << /S /JavaScript /JS (app.alert(1)) >> >> >>\nendobj\n%%EOF'
  );
  const aaWidgetHoverRes = await validateFileStream(
    Readable.from(aaWidgetHoverPdf),
    'application/pdf',
    aaWidgetHoverPdf.length
  );
  assert(
    aaWidgetHoverRes.isValid === false && aaWidgetHoverRes.hasDangerousPdfMarks === true,
    'PDF con /AA trigger /PO (apertura) en /Widget es RECHAZADO'
  );

  const aaGenericPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Foo /Bar /AA << /C << /S /JavaScript /JS (app.alert(1)) >> >> >>\nendobj\n%%EOF'
  );
  const aaGenericRes = await validateFileStream(Readable.from(aaGenericPdf), 'application/pdf', aaGenericPdf.length);
  assert(aaGenericRes.isValid === false && aaGenericRes.hasDangerousPdfMarks === true, 'PDF con /AA en objeto genérico sin /FT ni /Widget es RECHAZADO');

  const btnActionJsPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Btn /A << /S /JavaScript /JS (app.alert(1)) >> >>\nendobj\n%%EOF'
  );
  const btnActionJsRes = await validateFileStream(
    Readable.from(btnActionJsPdf),
    'application/pdf',
    btnActionJsPdf.length
  );
  assert(
    btnActionJsRes.isValid === false && btnActionJsRes.hasDangerousPdfMarks === true,
    'Botón /Widget /FT /Btn con acción /A de JavaScript es RECHAZADO'
  );

  // 2.14 Capacidades peligrosas siempre bloqueadas: /Names /JavaScript, /SubmitForm, /ImportData, /GoToR, /GoToE, /EmbeddedFile
  const dangerousVectors: Array<[string, string]> = [
    ['/Names /JavaScript', '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Names << /JavaScript 2 0 R >> >>\nendobj\n%%EOF'],
    ['/SubmitForm', '%PDF-1.4\n1 0 obj\n<< /Type /Action /S /SubmitForm /F (https://evil.example) >>\nendobj\n%%EOF'],
    ['/ImportData', '%PDF-1.4\n1 0 obj\n<< /Type /Action /S /ImportData /F (data.fdf) >>\nendobj\n%%EOF'],
    ['/GoToR', '%PDF-1.4\n1 0 obj\n<< /Type /Action /S /GoToR /F (\\\\\\\\attacker\\\\share\\\\x.pdf) >>\nendobj\n%%EOF'],
    ['/GoToE', '%PDF-1.4\n1 0 obj\n<< /Type /Action /S /GoToE /T << /R /C /N (payload) >> >>\nendobj\n%%EOF'],
    ['/EmbeddedFile', '%PDF-1.4\n1 0 obj\n<< /Type /Filespec /F (evil.exe) /EF << /F 2 0 R >> >>\nendobj\n%%EOF'],
  ];
  for (const [label, raw] of dangerousVectors) {
    const buf = Buffer.from(raw);
    const res = await validateFileStream(Readable.from(buf), 'application/pdf', buf.length);
    assert(res.isValid === false && res.hasDangerousPdfMarks === true, `Vector peligroso ${label} es RECHAZADO`);
  }

  // 2.15 /ObjStm comprimido con zlib: válido permitido, malicioso rechazado, /Encrypt + /ObjStm rechazado como protegido
  const safeObjStmHdr = '1 0 ';
  const safeObjStmInner = Buffer.from(safeObjStmHdr + '<< /Type /Catalog /OpenAction [3 0 R /Fit] >>');
  const safeObjStmComp = zlib.deflateSync(safeObjStmInner);
  const safeObjStmPdf = Buffer.concat([
    Buffer.from(`%PDF-1.5\n10 0 obj\n<< /Type /ObjStm /N 1 /First ${safeObjStmHdr.length} /Filter /FlateDecode /Length ${safeObjStmComp.length} >>\nstream\n`),
    safeObjStmComp,
    Buffer.from('\nendstream\nendobj\n%%EOF'),
  ]);
  const safeObjStmRes = await validateFileStream(
    Readable.from(safeObjStmPdf),
    'application/pdf',
    safeObjStmPdf.length
  );
  assert(safeObjStmRes.isValid === true, 'PDF con /ObjStm comprimido y contenido legítimo es PERMITIDO');

  const malObjStmPart1 = '<< /Type /Catalog /OpenAction 2 0 R >> ';
  const malObjStmHdr = `1 0 2 ${malObjStmPart1.length} `;
  const malObjStmInner = Buffer.from(malObjStmHdr + malObjStmPart1 + '<< /S /JavaScript /JS (app.alert(1)) >>');
  const malObjStmComp = zlib.deflateSync(malObjStmInner);
  const malObjStmPdf = Buffer.concat([
    Buffer.from(`%PDF-1.5\n10 0 obj\n<< /Type /ObjStm /N 2 /First ${malObjStmHdr.length} /Filter /FlateDecode /Length ${malObjStmComp.length} >>\nstream\n`),
    malObjStmComp,
    Buffer.from('\nendstream\nendobj\n%%EOF'),
  ]);
  const malObjStmRes = await validateFileStream(
    Readable.from(malObjStmPdf),
    'application/pdf',
    malObjStmPdf.length
  );
  assert(
    malObjStmRes.isValid === false && malObjStmRes.hasDangerousPdfMarks === true,
    'PDF con /OpenAction JS oculto dentro de /ObjStm comprimido es RECHAZADO'
  );

  const encryptedObjStmPdf = Buffer.concat([
    Buffer.from(`%PDF-1.5\n10 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${safeObjStmComp.length} >>\nstream\n`),
    safeObjStmComp,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Encrypt 99 0 R >>\n%%EOF'),
  ]);
  const encryptedObjStmRes = await validateFileStream(
    Readable.from(encryptedObjStmPdf),
    'application/pdf',
    encryptedObjStmPdf.length
  );
  assert(
    encryptedObjStmRes.isValid === false &&
      /PDF protegido/i.test(encryptedObjStmRes.error || '') &&
      /exportarlo|imprimilo a PDF/i.test(encryptedObjStmRes.error || ''),
    'PDF con /Encrypt y /ObjStm falla cerrado con mensaje claro de PDF protegido'
  );
  assertUserMsgIsCleanAndHelpful(encryptedObjStmRes, '/Encrypt + /ObjStm');

  const corruptObjStmPdf = Buffer.from(
    '%PDF-1.5\n10 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length 12 >>\nstream\nnot-zlib-data\nendstream\nendobj\n%%EOF'
  );
  const corruptObjStmRes = await validateFileStream(
    Readable.from(corruptObjStmPdf),
    'application/pdf',
    corruptObjStmPdf.length
  );
  assert(
    corruptObjStmRes.isValid === false && corruptObjStmRes.hasDangerousPdfMarks === false,
    'Adverso: /ObjStm corrupto no inspeccionable falla cerrado (RECHAZADO)'
  );
  assertUserMsgIsCleanAndHelpful(corruptObjStmRes, '/ObjStm corrupto');

  // 2.16 Tests adversos (truncado, ciclos, anidamiento profundo, escapes hex, endstream partido, 25 MB random, no-throw)
  const truncatedPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /OpenAction << /S /GoTo');
  const truncatedRes = await validateFileStream(
    Readable.from(truncatedPdf),
    'application/pdf',
    truncatedPdf.length
  );
  assert(truncatedRes.isValid === false, 'Adverso: PDF truncado es RECHAZADO (fail-closed)');
  assertUserMsgIsCleanAndHelpful(truncatedRes, 'PDF truncado');

  const circularPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /OpenAction 2 0 R >>\nendobj\n2 0 obj\n3 0 R\nendobj\n3 0 obj\n2 0 R\nendobj\n%%EOF'
  );
  const circularRes = await validateFileStream(
    Readable.from(circularPdf),
    'application/pdf',
    circularPdf.length
  );
  assert(circularRes.isValid === false, 'Adverso: referencias circulares en /OpenAction son RECHAZADAS sin ciclo infinito');

  const deepNestCount = PDF_SCANNER_LIMITS.MAX_NESTING_DEPTH + 5;
  const deepNestPdf = Buffer.from(
    `%PDF-1.4\n1 0 obj\n${'<< /A '.repeat(deepNestCount)}1${' >>'.repeat(deepNestCount)}\nendobj\n%%EOF`
  );
  const deepNestRes = await validateFileStream(
    Readable.from(deepNestPdf),
    'application/pdf',
    deepNestPdf.length
  );
  assert(deepNestRes.isValid === false, 'Adverso: anidamiento superior a MAX_NESTING_DEPTH es RECHAZADO');

  const hexEscapedLaunchPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Action /S /L#61unch /F (cmd.exe) >>\nendobj\n%%EOF'
  );
  const hexLaunchRes = await validateFileStream(
    Readable.from(hexEscapedLaunchPdf),
    'application/pdf',
    hexEscapedLaunchPdf.length
  );
  assert(
    hexLaunchRes.isValid === false && hexLaunchRes.hasDangerousPdfMarks === true,
    'Adverso: nombre con escape hex (/L#61unch) es decodificado y RECHAZADO'
  );

  const hexEscapedJsPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /OpenAction << /S /J#61vaScript /J#53 (app.alert(1)) >> >>\nendobj\n%%EOF'
  );
  const hexJsRes = await validateFileStream(
    Readable.from(hexEscapedJsPdf),
    'application/pdf',
    hexEscapedJsPdf.length
  );
  assert(
    hexJsRes.isValid === false && hexJsRes.hasDangerousPdfMarks === true,
    'Adverso: nombre con escape hex (/J#61vaScript /J#53) en /OpenAction es RECHAZADO'
  );

  // Marca y endstream partidos entre chunks dentro de objeto real
  const splitEndstreamChunk1 = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Length 20 >>\nstream\nhello /JS world ends'
  );
  const splitEndstreamChunk2 = Buffer.from(
    'tream\nendobj\n2 0 obj\n<< /Type /Catalog /OpenAction << /S /La'
  );
  const splitEndstreamChunk3 = Buffer.from('unch /F (calc) >> >>\nendobj\n%%EOF');
  const splitObjStream = Readable.from([splitEndstreamChunk1, splitEndstreamChunk2, splitEndstreamChunk3]);
  const splitObjRes = await validateFileStream(
    splitObjStream,
    'application/pdf',
    splitEndstreamChunk1.length + splitEndstreamChunk2.length + splitEndstreamChunk3.length
  );
  assert(
    splitObjRes.isValid === false && splitObjRes.hasDangerousPdfMarks === true,
    'Adverso: endstream partido y /Launch partido entre chunks dentro de objetos reales son detectados'
  );

  // PDF de 25 MB de bytes aleatorios sin estructura peligrosa (con /JS casual incluido) -> PERMITIDO y rápido
  const randomPayloadSize = 25 * 1024 * 1024 - 512;
  const randomPayload = crypto.randomBytes(randomPayloadSize);
  Buffer.from('/JS /JavaScript /OpenAction /Launch ').copy(randomPayload, Math.floor(randomPayloadSize / 2));
  const pdf25Header = Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Length ${randomPayloadSize} >>\nstream\n`
  );
  const pdf25Footer = Buffer.from('\nendstream\nendobj\n%%EOF');
  const total25Bytes = pdf25Header.length + randomPayload.length + pdf25Footer.length;
  async function* generate25MbChunks() {
    yield pdf25Header;
    const step = 64 * 1024;
    for (let offset = 0; offset < randomPayload.length; offset += step) {
      yield randomPayload.subarray(offset, Math.min(offset + step, randomPayload.length));
    }
    yield pdf25Footer;
  }
  const t25Start = Date.now();
  const res25Mb = await validateFileStream(
    Readable.from(generate25MbChunks()),
    'application/pdf',
    total25Bytes
  );
  const t25ElapsedMs = Date.now() - t25Start;
  assert(
    res25Mb.isValid === true && t25ElapsedMs < LIBRARY_CONFIG.STREAMING_TIMEOUT_MS,
    `Adverso: PDF de 25 MB con bytes aleatorios y /JS casual es PERMITIDO sin colgarse (${t25ElapsedMs} ms)`
  );

  // Contrato no-throw: PdfSecurityScanner nunca lanza hacia afuera
  let threwOutside = false;
  let noThrowScanResult: any = null;
  try {
    const rawScanner = new PdfSecurityScanner();
    rawScanner.feed(null as any);
    rawScanner.feed({ invalid: true } as any);
    noThrowScanResult = rawScanner.finish();
  } catch {
    threwOutside = true;
  }
  assert(
    !threwOutside && noThrowScanResult?.isSafe === false,
    'Adverso: PdfSecurityScanner nunca lanza excepciones hacia afuera y falla cerrado'
  );

  // ---------------------------------------------------------------------------
  // 3. ENTORNO HTTP Y CONFIGURACIÓN EN MEMORIA
  // ---------------------------------------------------------------------------
  console.log('📌 3. Configuración de API y Middleware de Biblioteca');

  const mockR2 = new MemoryMockR2Service();
  const libraryStore = new InMemoryLibraryService(mockR2);
  setLibraryServiceForTesting(libraryStore);
  const catalogStore = new InMemoryCatalogStore();
  setCatalogStoreForTesting(catalogStore);

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
  setMockAdminRecipients(['admin-lib@stack.com']);

  setLiveUserResolverForTesting(async (id: string) => {
    const u = libraryStore.users.get(id);
    if (!u) return null;
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      status: u.status,
      emailVerified: Boolean(u.emailVerifiedAt),
      selectedPlanId: (u as any).selectedPlanId,
    };
  });

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  function signToken(payload: {
    id: string;
    email: string;
    role: 'user' | 'admin';
    emailVerified?: boolean;
    selectedPlanId?: string | null;
  }) {
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

  // ---------------------------------------------------------------------------
  // 14. SISTEMA DE NOTIFICACIONES POR CORREO ELECTRÓNICO (BIBLIOTECA)
  // ---------------------------------------------------------------------------
  console.log('📌 14. Avisos por Mail: Subida, Aprobación, Rechazo, Exclusiones y Seguridad');
  // En sección 14 se evalúan envíos individuales inmediatos (cooldown 0 explícito en tests)
  setAdminNotifyCooldownOverride(0);

  // 14.1 Seguridad y sanitizado
  const xssStr = '<script>alert("hack")</script>&"\'';
  const escaped = escapeHtml(xssStr);
  assert(
    !escaped.includes('<script>') && escaped.includes('&lt;script&gt;') && escaped.includes('&amp;'),
    'escapeHtml neutraliza scripts y caracteres especiales HTML'
  );

  const dirtySubject = "Nuevo material\r\nBcc: victim@test.com\nTest";
  const cleanSub = sanitizeSubject(dirtySubject);
  assert(
    !cleanSub.includes('\r') && !cleanSub.includes('\n'),
    'sanitizeSubject elimina saltos de línea contra Header Injection'
  );

  // 14.2 (a) Aviso al admin al completar subida
  clearMockSentNotifications();
  const notifPdfBuf1 = Buffer.from('%PDF-1.4 %%EOF notif-pdf-buffer-1-' + Date.now() + '-a');
  const notifPdfBuf2 = Buffer.from('%PDF-1.4 %%EOF notif-pdf-buffer-2-' + Date.now() + '-b');
  const notifPdfBuf3 = Buffer.from('%PDF-1.4 %%EOF notif-pdf-buffer-3-' + Date.now() + '-c');
  const notifPdfBuf4 = Buffer.from('%PDF-1.4 %%EOF notif-pdf-buffer-4-' + Date.now() + '-d');
  const notifPdfBuf5 = Buffer.from('%PDF-1.4 %%EOF notif-pdf-buffer-5-' + Date.now() + '-e');

  const notifStudentId = '77777777-7777-4777-8777-777777777777';
  libraryStore.seedUser({
    id: notifStudentId,
    email: 'notif.alumno@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
    termsAccepted: true,
  });
  const notifStudentToken = signToken({
    id: notifStudentId,
    email: 'notif.alumno@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
  });

  const initRes = await api(
    'POST',
    '/api/library/uploads/init',
    notifStudentToken,
    {
      subjectId: 'sub-sintaxis',
      kind: 'parcial',
      academicYear: 2026,
      term: '1C',
      title: 'Parcial 1 Sintaxis & Semántica "Turno Mañana"',
      originalFilename: 'parcial1.pdf',
      mimeType: 'application/pdf',
      sizeBytes: notifPdfBuf1.length,
      acceptTerms: true,
    }
  );
  assert(initRes.status === 201, 'Init subida devuelve 201', JSON.stringify(initRes.data));
  const notifFileId = initRes.data?.data?.fileId;
  const notifStorageKey = initRes.data?.data?.storageKey;
  await mockR2.putObjectDirect(notifStorageKey, notifPdfBuf1, 'application/pdf');

  // Mientras está en uploading, NO debe enviarse mail
  assert(
    mockSentNotifications.length === 0,
    'No se envían avisos mientras el archivo está en estado uploading'
  );

  // Completar subida -> pasa a pending
  const notifCompleteRes = await api('POST', `/api/library/uploads/${notifFileId}/complete`, notifStudentToken);
  assert(notifCompleteRes.status === 200, 'Complete subida devuelve 200', JSON.stringify(notifCompleteRes.data));

  // Pequeña espera para resolución asíncrona no bloqueante
  await new Promise((r) => setTimeout(r, 60));

  const adminNotif = mockSentNotifications.find((n) => n.type === 'admin_pending');
  assert(adminNotif !== undefined, '(a) Al pasar a pending se envía correo al administrador');
  assert(
    Boolean(adminNotif?.to.includes('admin-lib@stack.com')),
    'El destinatario es la dirección de administración configurada'
  );
  assert(
    !adminNotif?.html.includes('notif.alumno@frc.utn.edu.ar') && !adminNotif?.text.includes('notif.alumno@frc.utn.edu.ar'),
    'Regla de privacidad estricta: El correo de aviso al admin NO incluye el email del autor'
  );
  assert(
    !adminNotif?.html.includes(notifStudentId) && !adminNotif?.text.includes(notifStudentId),
    'Regla de privacidad estricta: El correo de aviso al admin NO incluye el ID del autor'
  );
  assert(
    Boolean(adminNotif?.html.includes('Sintaxis y Sem')),
    'El correo al admin incluye el nombre de la materia'
  );
  assert(
    Boolean(adminNotif?.html.includes('&amp;') && adminNotif?.html.includes('&quot;Turno Mañana&quot;')),
    'El título en el correo al admin está correctamente escapado contra HTML injection'
  );

  // 14.3 (b) Aprobación de archivo -> Notificación al usuario que aportó
  clearMockSentNotifications();
  const notifApproveRes = await api('PATCH', `/api/admin/library/files/${notifFileId}/approve`, adminToken);
  assert(notifApproveRes.status === 200, 'Admin aprueba archivo con éxito (200)');

  await new Promise((r) => setTimeout(r, 60));

  const uploaderApprovedNotif = mockSentNotifications.find((n) => n.type === 'uploader_approved');
  assert(uploaderApprovedNotif !== undefined, '(b) Aprobación envía correo al usuario que aportó el material');
  assert(
    Boolean(uploaderApprovedNotif?.to.includes('notif.alumno@frc.utn.edu.ar')),
    'El destinatario de la aprobación es el autor del archivo'
  );
  assert(
    Boolean(uploaderApprovedNotif?.subject.includes('Tu aporte fue aprobado en Stack')),
    'Asunto de aprobación correcto'
  );
  assert(
    Boolean(uploaderApprovedNotif?.text.includes('Sintaxis y Sem') && uploaderApprovedNotif?.text.includes('Muchas gracias')),
    'El correo de aprobación contiene título, materia y agradecimiento'
  );

  // Segundo approve idempotente: NO debe re-enviar aviso
  clearMockSentNotifications();
  await api('PATCH', `/api/admin/library/files/${notifFileId}/approve`, adminToken);
  await new Promise((r) => setTimeout(r, 60));
  assert(
    mockSentNotifications.length === 0,
    'Aprobaciones subsecuentes no reenvían notificación al uploader (uploaderNotifiedAt)'
  );

  // 14.4 (c) Rechazo de archivo con motivo -> Notificación al usuario
  clearMockSentNotifications();
  const initRes2 = await api(
    'POST',
    '/api/library/uploads/init',
    notifStudentToken,
    {
      subjectId: 'sub-paradigmas',
      kind: 'apunte',
      title: 'Apunte con observaciones',
      originalFilename: 'apunte2.pdf',
      mimeType: 'application/pdf',
      sizeBytes: notifPdfBuf2.length,
      acceptTerms: true,
    }
  );
  const rejectFileId = initRes2.data.data.fileId;
  const rejectStorageKey = initRes2.data.data.storageKey;
  await mockR2.putObjectDirect(rejectStorageKey, notifPdfBuf2, 'application/pdf');
  await api('POST', `/api/library/uploads/${rejectFileId}/complete`, notifStudentToken);
  clearMockSentNotifications();

  const notifRejectRes = await api(
    'PATCH',
    `/api/admin/library/files/${rejectFileId}/reject`,
    adminToken,
    { reason: 'El apunte está incompleto & contiene ejercicios de otra materia ("Guía 2").' }
  );
  assert(notifRejectRes.status === 200, 'Admin rechaza archivo con motivo (200)');

  await new Promise((r) => setTimeout(r, 60));

  const uploaderRejectedNotif = mockSentNotifications.find((n) => n.type === 'uploader_rejected');
  assert(uploaderRejectedNotif !== undefined, '(c) Rechazo envía correo al autor con el motivo');
  assert(
    Boolean(uploaderRejectedNotif?.to.includes('notif.alumno@frc.utn.edu.ar')),
    'Destinatario del rechazo es el autor'
  );
  assert(
    Boolean(uploaderRejectedNotif?.html.includes('&amp;') && uploaderRejectedNotif?.html.includes('&quot;Guía 2&quot;')),
    'El motivo del rechazo está debidamente escapado en el HTML'
  );
  assert(
    Boolean(uploaderRejectedNotif?.text.includes('El apunte está incompleto')),
    'El texto del correo incluye el motivo para corregir y volver a subir'
  );

  // 14.5 Exclusiones
  // Exclusión 1: Preferencia del usuario desactivada (notifyLibraryEmail = false)
  const notifUser = libraryStore.users.get(notifStudentId)!;
  notifUser.notifyLibraryEmail = false;

  const initRes3 = await api(
    'POST',
    '/api/library/uploads/init',
    notifStudentToken,
    {
      subjectId: 'sub-sintaxis',
      kind: 'guia',
      title: 'Guía sin avisos de mail',
      originalFilename: 'guia.pdf',
      mimeType: 'application/pdf',
      sizeBytes: notifPdfBuf3.length,
      acceptTerms: true,
    }
  );
  const file3Id = initRes3.data.data.fileId;
  await mockR2.putObjectDirect(initRes3.data.data.storageKey, notifPdfBuf3, 'application/pdf');
  await api('POST', `/api/library/uploads/${file3Id}/complete`, notifStudentToken);

  clearMockSentNotifications();
  await api('PATCH', `/api/admin/library/files/${file3Id}/approve`, adminToken);
  await new Promise((r) => setTimeout(r, 60));
  assert(
    mockSentNotifications.length === 0,
    'Exclusión: No se envía email si el usuario desactivó notifyLibraryEmail'
  );

  notifUser.notifyLibraryEmail = true; // restaurar

  // Exclusión 2: Usuario suspendido
  const initRes4 = await api(
    'POST',
    '/api/library/uploads/init',
    notifStudentToken,
    {
      subjectId: 'sub-sintaxis',
      kind: 'tp',
      title: 'TP usuario suspendido',
      originalFilename: 'tp.pdf',
      mimeType: 'application/pdf',
      sizeBytes: notifPdfBuf4.length,
      acceptTerms: true,
    }
  );
  const file4Id = initRes4.data.data.fileId;
  await mockR2.putObjectDirect(initRes4.data.data.storageKey, notifPdfBuf4, 'application/pdf');
  await api('POST', `/api/library/uploads/${file4Id}/complete`, notifStudentToken);

  // Ahora suspender al usuario
  notifUser.status = 'suspended';
  clearMockSentNotifications();
  await api('PATCH', `/api/admin/library/files/${file4Id}/approve`, adminToken);
  await new Promise((r) => setTimeout(r, 60));
  assert(
    mockSentNotifications.length === 0,
    'Exclusión: No se envía email a usuarios en estado suspendido'
  );
  notifUser.status = 'active'; // restaurar

  // 14.6 Endpoint de Reenvío de Aviso a Administradores
  const initRes5 = await api(
    'POST',
    '/api/library/uploads/init',
    notifStudentToken,
    {
      subjectId: 'sub-sintaxis',
      kind: 'parcial',
      title: 'Parcial para reenvío de aviso',
      originalFilename: 'parcial_resend.pdf',
      mimeType: 'application/pdf',
      sizeBytes: notifPdfBuf5.length,
      acceptTerms: true,
    }
  );
  const file5Id = initRes5.data.data.fileId;
  await mockR2.putObjectDirect(initRes5.data.data.storageKey, notifPdfBuf5, 'application/pdf');
  await api('POST', `/api/library/uploads/${file5Id}/complete`, notifStudentToken);
  await new Promise((r) => setTimeout(r, 60));

  clearMockSentNotifications();

  // Llamar al endpoint de reenvío
  const resendRes = await api(
    'POST',
    `/api/admin/library/files/${file5Id}/resend-admin-notification`,
    adminToken
  );
  assert(resendRes.status === 200, 'POST /api/admin/library/files/:id/resend-admin-notification responde 200');
  assert(resendRes.data.success === true, 'Reenvío retorna success: true');

  await new Promise((r) => setTimeout(r, 60));
  const resentNotif = mockSentNotifications.find((n) => n.type === 'admin_pending' && n.fileId === file5Id);
  assert(resentNotif !== undefined, 'El aviso fue reenviado exitosamente a los administradores');

  // Intentar reenviar para archivo no pendiente (aprobarlo primero)
  await api('PATCH', `/api/admin/library/files/${file5Id}/approve`, adminToken);
  const invalidResend = await api(
    'POST',
    `/api/admin/library/files/${file5Id}/resend-admin-notification`,
    adminToken
  );
  assert(invalidResend.status === 400, 'Reenviar aviso sobre archivo no pendiente responde 400 Bad Request');
  setAdminNotifyCooldownOverride(null);

  // ---------------------------------------------------------------------------
  // 15. SUBIDA MÚLTIPLE, SIN TOPE DIARIO, CUPO DE 30 PENDIENTES Y CONCURRENCIA
  // ---------------------------------------------------------------------------
  console.log('\n📌 15. Subida Múltiple, Eliminación del Tope Diario y Cupo de Pendientes (Fase 1)');

  // 15.1 Eliminación del límite diario (más de 5 subidas en un mismo día)
  const multiUserId = '88888888-8888-4888-8888-888888888888';
  libraryStore.seedUser({
    id: multiUserId,
    email: 'multi.upload@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
    termsAccepted: true,
  });
  const multiUserToken = signToken({
    id: multiUserId,
    email: 'multi.upload@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
  });

  const dailyFilesCreated: string[] = [];
  let dailyUploadsSuccessCount = 0;
  for (let i = 1; i <= 7; i++) {
    const pdfBuf = Buffer.from(`%PDF-1.4 %%EOF content-${i}-${Date.now()}`);
    const res = await api('POST', '/api/library/uploads/init', multiUserToken, {
      subjectId: 'sub-sintaxis',
      kind: 'parcial',
      academicYear: 2026,
      term: '1C',
      title: `Parcial Nro ${i} del mismo día`,
      originalFilename: `parcial_dia_${i}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: pdfBuf.length,
      acceptTerms: true,
    });
    if (res.status === 201) {
      dailyUploadsSuccessCount++;
      dailyFilesCreated.push(res.data.data.fileId);
      await mockR2.putObjectDirect(res.data.data.storageKey, pdfBuf, 'application/pdf');
      await api('POST', `/api/library/uploads/${res.data.data.fileId}/complete`, multiUserToken);
    }
  }
  assert(
    dailyUploadsSuccessCount === 7,
    'Eliminación del límite diario: Se pueden subir 7 archivos (> 5) en un mismo día sin recibir 429'
  );

  // 15.2 Tope de 30 archivos pendientes simultáneos
  // El usuario ya tiene 7 archivos en estado 'pending'. Agregamos 23 más para llegar a 30.
  let pendingCreatedCount = 7;
  for (let i = 8; i <= 30; i++) {
    const pdfBuf = Buffer.from(`%PDF-1.4 %%EOF content-${i}-${Date.now()}`);
    const res = await api('POST', '/api/library/uploads/init', multiUserToken, {
      subjectId: 'sub-sintaxis',
      kind: 'resumen',
      title: `Resumen de prueba ${i}`,
      originalFilename: `resumen_${i}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: pdfBuf.length,
      acceptTerms: true,
    });
    if (res.status === 201) {
      pendingCreatedCount++;
      dailyFilesCreated.push(res.data.data.fileId);
      await mockR2.putObjectDirect(res.data.data.storageKey, pdfBuf, 'application/pdf');
      await api('POST', `/api/library/uploads/${res.data.data.fileId}/complete`, multiUserToken);
    }
  }
  assert(pendingCreatedCount === 30, 'Usuario alcanza exactamente 30 archivos pendientes de revisión');

  // Intento 31 debe ser bloqueado con 429 LIMIT_PENDING_UPLOADS
  const res31 = await api('POST', '/api/library/uploads/init', multiUserToken, {
    subjectId: 'sub-sintaxis',
    kind: 'resumen',
    title: 'Resumen intento 31 bloqueado',
    originalFilename: 'resumen_31.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  assert(
    res31.status === 429 && res31.data.code === 'LIMIT_PENDING_UPLOADS',
    'Tope de pendientes (30): Intento 31 es rechazado con 429 LIMIT_PENDING_UPLOADS'
  );
  assert(
    Boolean(res31.data.error?.includes('30')),
    'Mensaje de error indica el máximo permitido de 30 pendientes'
  );

  // 15.3 Liberación de cupo de pendientes al moderar (aprobar o rechazar)
  const fileToApprove = dailyFilesCreated[0];
  const fileToReject = dailyFilesCreated[1];
  await api('PATCH', `/api/admin/library/files/${fileToApprove}/approve`, adminToken);
  await api('PATCH', `/api/admin/library/files/${fileToReject}/reject`, adminToken, {
    reason: 'Prueba de liberación de cupo',
  });

  // Ahora quedan 28 pendientes. Se pueden subir exactamente 2 archivos más.
  const resRecharge1 = await api('POST', '/api/library/uploads/init', multiUserToken, {
    subjectId: 'sub-sintaxis',
    kind: 'tp',
    title: 'TP liberado 1',
    originalFilename: 'tp_liberado_1.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  assert(resRecharge1.status === 201, 'Liberación de cupo: Permite subir nuevamente al aprobar');

  const resRecharge2 = await api('POST', '/api/library/uploads/init', multiUserToken, {
    subjectId: 'sub-sintaxis',
    kind: 'tp',
    title: 'TP liberado 2',
    originalFilename: 'tp_liberado_2.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  assert(resRecharge2.status === 201, 'Liberación de cupo: Permite subir nuevamente al rechazar');

  const resRecharge3Blocked = await api('POST', '/api/library/uploads/init', multiUserToken, {
    subjectId: 'sub-sintaxis',
    kind: 'tp',
    title: 'TP liberado 3 bloqueado',
    originalFilename: 'tp_liberado_3.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  assert(
    resRecharge3Blocked.status === 429 && resRecharge3Blocked.data.code === 'LIMIT_PENDING_UPLOADS',
    'Liberación de cupo: Se vuelve a bloquear al alcanzar 30 pendientes nuevamente'
  );

  // 15.4 Concurrencia real con Promise.all (35 inits simultáneos para cupo de 30)
  const concurrentUserId = '77777777-1111-4777-8777-111111111111';
  libraryStore.seedUser({
    id: concurrentUserId,
    email: 'concurrent.upload@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
    termsAccepted: true,
  });
  const concurrentUserToken = signToken({
    id: concurrentUserId,
    email: 'concurrent.upload@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
  });

  const concurrentPromises = Array.from({ length: 35 }, (_, idx) =>
    api('POST', '/api/library/uploads/init', concurrentUserToken, {
      subjectId: 'sub-sintaxis',
      kind: 'apunte',
      title: `Apunte concurrente ${idx + 1}`,
      originalFilename: `apunte_conc_${idx + 1}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      acceptTerms: true,
    })
  );
  const concurrentResults = await Promise.all(concurrentPromises);
  const count201 = concurrentResults.filter((r) => r.status === 201).length;
  const count429 = concurrentResults.filter(
    (r) => r.status === 429 && r.data.code === 'LIMIT_PENDING_UPLOADS'
  ).length;
  assert(
    count201 === 30 && count429 === 5,
    `Concurrencia con Promise.all (35 simultáneos): Exactamente 30 exitosos (201) y 5 bloqueados (429) [obt: ${count201} y ${count429}]`
  );

  // 15.5 Concurrencia en cuota de almacenamiento
  const quotaUserId = '66666666-2222-4666-8666-222222222222';
  libraryStore.seedUser({
    id: quotaUserId,
    email: 'quota.user@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
    termsAccepted: true,
  });
  const quotaUserToken = signToken({
    id: quotaUserId,
    email: 'quota.user@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
  });

  // Consumir cuota hasta que queden exactamente 5 MB (LIBRARY_CONFIG.MAX_USER_QUOTA_BYTES - 5MB)
  const fiveMb = 5 * 1024 * 1024;
  const initialLargeSize = LIBRARY_CONFIG.MAX_USER_QUOTA_BYTES - fiveMb;
  // Creamos directamente un registro previo en memory store para simular cuota existente
  libraryStore.files.set('large-file-quota', {
    id: 'large-file-quota',
    uploaderUserId: quotaUserId,
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Archivo pesado base',
    originalFilename: 'heavy.pdf',
    storageKey: 'library/heavy.pdf',
    mimeType: 'application/pdf',
    sizeBytes: initialLargeSize,
    sha256: 'sha256-heavy-sample',
    status: 'approved',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Lanzar 5 subidas concurrentes de 2 MB cada una (2 MB * 2 = 4 MB <= 5 MB; la 3ra excede)
  const twoMb = 2 * 1024 * 1024;
  const quotaPromises = Array.from({ length: 5 }, (_, idx) =>
    api('POST', '/api/library/uploads/init', quotaUserToken, {
      subjectId: 'sub-sintaxis',
      kind: 'apunte',
      title: `Apunte cuota ${idx + 1}`,
      originalFilename: `cuota_${idx + 1}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: twoMb,
      acceptTerms: true,
    })
  );
  const quotaResults = await Promise.all(quotaPromises);
  const quota201 = quotaResults.filter((r) => r.status === 201).length;
  const quota429 = quotaResults.filter((r) => r.status === 429 && (r.data.code === 'LIMIT_STORAGE_QUOTA' || r.data.code === 'LIMIT_USER_QUOTA')).length;
  assert(
    quota201 === 2 && quota429 === 3,
    `Concurrencia de cuota con Promise.all: Exactamente 2 aprobados y 3 rechazados por cuota [obt: ${quota201} y ${quota429}]`
  );

  // 15.6 Carrera de duplicados SHA-256 en /complete
  const dupUserId = '55555555-3333-4555-8555-333333333333';
  libraryStore.seedUser({
    id: dupUserId,
    email: 'dup.user@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
    termsAccepted: true,
  });
  const dupUserToken = signToken({
    id: dupUserId,
    email: 'dup.user@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
  });

  const identicalBuf = Buffer.from('%PDF-1.4 %%EOF identical-content-for-both-' + Date.now());
  const dupInitA = await api('POST', '/api/library/uploads/init', dupUserToken, {
    subjectId: 'sub-sintaxis',
    kind: 'guia',
    title: 'Guía de ejercicios A',
    originalFilename: 'guia_a.pdf',
    mimeType: 'application/pdf',
    sizeBytes: identicalBuf.length,
    acceptTerms: true,
  });
  const dupInitB = await api('POST', '/api/library/uploads/init', dupUserToken, {
    subjectId: 'sub-sintaxis',
    kind: 'guia',
    title: 'Guía de ejercicios B',
    originalFilename: 'guia_b.pdf',
    mimeType: 'application/pdf',
    sizeBytes: identicalBuf.length,
    acceptTerms: true,
  });
  await mockR2.putObjectDirect(dupInitA.data.data.storageKey, identicalBuf, 'application/pdf');
  await mockR2.putObjectDirect(dupInitB.data.data.storageKey, identicalBuf, 'application/pdf');

  const dupCompleteResults = await Promise.all([
    api('POST', `/api/library/uploads/${dupInitA.data.data.fileId}/complete`, dupUserToken),
    api('POST', `/api/library/uploads/${dupInitB.data.data.fileId}/complete`, dupUserToken),
  ]);
  const dupStatus200 = dupCompleteResults.filter((r) => r.status === 200).length;
  const dupStatus409 = dupCompleteResults.filter(
    (r) => r.status === 409 && r.data.code === 'DUPLICATE_FILE'
  ).length;
  assert(
    dupStatus200 === 1 && dupStatus409 === 1,
    'Carrera de duplicados SHA-256 en /complete: Uno pasa exitosamente (200) y el otro recibe 409 DUPLICATE_FILE'
  );

  // 15.7 Validación estricta de academicYear y term
  const yearTermUserId = '11112222-3333-4444-8555-666677778888';
  libraryStore.seedUser({
    id: yearTermUserId,
    email: 'year.term@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
    termsAccepted: true,
  });
  const yearTermToken = signToken({
    id: yearTermUserId,
    email: 'year.term@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
  });

  const validYearTermRes = await api('POST', '/api/library/uploads/init', yearTermToken, {
    subjectId: 'sub-sintaxis',
    kind: 'parcial',
    academicYear: 2024,
    term: '2C',
    title: 'Examen con año y término válidos',
    originalFilename: 'valido.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  assert(validYearTermRes.status === 201, 'Validación de academicYear y term: Acepta año 2024 y término 2C');

  const annualTermRes = await api('POST', '/api/library/uploads/init', yearTermToken, {
    subjectId: 'sub-sintaxis',
    kind: 'final',
    academicYear: 2022,
    term: 'A',
    title: 'Examen anual válido',
    originalFilename: 'anual.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  assert(annualTermRes.status === 201, 'Validación de academicYear y term: Acepta término anual "A"');

  const invalidYearOldRes = await api('POST', '/api/library/uploads/init', yearTermToken, {
    subjectId: 'sub-sintaxis',
    kind: 'parcial',
    academicYear: 1999,
    term: '1C',
    title: 'Año anterior a 2000 rechazado',
    originalFilename: 'invalido_year.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  assert(invalidYearOldRes.status === 400, 'Validación: Rechaza año anterior a 2000 con 400 Bad Request');

  const invalidYearFutureRes = await api('POST', '/api/library/uploads/init', yearTermToken, {
    subjectId: 'sub-sintaxis',
    kind: 'parcial',
    academicYear: 2099,
    term: '1C',
    title: 'Año futuro rechazado',
    originalFilename: 'invalido_future.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  assert(invalidYearFutureRes.status === 400, 'Validación: Rechaza año futuro con 400 Bad Request');

  const invalidTermRes = await api('POST', '/api/library/uploads/init', yearTermToken, {
    subjectId: 'sub-sintaxis',
    kind: 'parcial',
    academicYear: 2024,
    term: '3C',
    title: 'Término inválido 3C rechazado',
    originalFilename: 'invalido_term.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  assert(invalidTermRes.status === 400, "Validación: Rechaza término distinto de '1C', '2C', 'A' con 400 Bad Request");

  // 15.8 Idempotencia en /complete
  const idempFileId = dupCompleteResults.find((r) => r.status === 200)!.data.data.file.id;
  const idempCall1 = await api('POST', `/api/library/uploads/${idempFileId}/complete`, dupUserToken);
  assert(
    idempCall1.status === 200 && idempCall1.data.success === true,
    'Idempotencia: Segunda llamada a /complete sobre archivo en estado pending retorna 200 OK'
  );

  // 15.9 Semáforo de concurrencia y 503 LIBRARY_BUSY
  const testSemaphore = new Semaphore(1, 50);
  const releaseFirst = await testSemaphore.acquire();
  let caughtBusyError: any = null;
  try {
    await testSemaphore.acquire();
  } catch (err: any) {
    caughtBusyError = err;
  }
  releaseFirst();
  assert(
    caughtBusyError?.status === 503 && caughtBusyError?.code === 'LIBRARY_BUSY',
    'Semáforo de concurrencia: En saturación o timeout responde 503 con código LIBRARY_BUSY'
  );
  assert(
    caughtBusyError?.retryAfter === 2,
    'Semáforo de concurrencia: Retorna retryAfter: 2 para que el cliente espere antes de reintentar'
  );
  // Reintento tras liberar debe funcionar inmediatamente
  const releaseSecond = await testSemaphore.acquire();
  assert(typeof releaseSecond === 'function', 'Semáforo de concurrencia: Al liberarse permite procesar el siguiente');
  releaseSecond();

  // 15.10 Expiración proactiva de archivos en estado uploading
  const expireUserId = '44444444-5555-4444-8444-555555555555';
  libraryStore.seedUser({
    id: expireUserId,
    email: 'expire.user@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
    termsAccepted: true,
  });
  const expireUserToken = signToken({
    id: expireUserId,
    email: 'expire.user@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
  });

  const staleInit = await api('POST', '/api/library/uploads/init', expireUserToken, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Apunte que quedará abandonado',
    originalFilename: 'stale.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  const staleFileId = staleInit.data.data.fileId;
  const staleRecord = libraryStore.files.get(staleFileId);
  // Simular que pasaron 35 minutos desde su creación
  staleRecord.createdAt = new Date(Date.now() - 35 * 60 * 1000);

  // Al llamar a initUpload para un nuevo archivo, el registro stale debe ser purgado
  await api('POST', '/api/library/uploads/init', expireUserToken, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Nuevo apunte tras expiración',
    originalFilename: 'new_after_stale.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  assert(
    !libraryStore.files.has(staleFileId),
    'Expiración proactiva: Archivo en uploading de más de 30 minutos fue eliminado al iniciar nueva subida'
  );

  // 15.11 Rate limiting en /uploads/init
  resetInitUploadRateLimits();
  const originalLimit = LIBRARY_CONFIG.UPLOAD_INIT_RATE_LIMIT_MAX;
  (LIBRARY_CONFIG as any).UPLOAD_INIT_RATE_LIMIT_MAX = 2; // bajamos temporalmente a 2 para testear
  resetInitUploadRateLimits();
  const rlRes1 = await api('POST', '/api/library/uploads/init', expireUserToken, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'RL 1',
    originalFilename: 'rl1.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  const rlRes2 = await api('POST', '/api/library/uploads/init', expireUserToken, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'RL 2',
    originalFilename: 'rl2.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  const rlRes3 = await api('POST', '/api/library/uploads/init', expireUserToken, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'RL 3 bloqueado',
    originalFilename: 'rl3.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  assert(rlRes1.status === 201 && rlRes2.status === 201, 'Rate limiting: Peticiones dentro del cupo son aceptadas (201)');
  assert(
    rlRes3.status === 429 && rlRes3.data.code === 'LIMIT_RATE_EXCEEDED',
    'Rate limiting: Al superar el máximo por ventana responde 429 LIMIT_RATE_EXCEEDED'
  );
  assert(
    Boolean(rlRes3.headers['retry-after']),
    'Rate limiting: Respuesta 429 incluye cabecera HTTP Retry-After'
  );
  (LIBRARY_CONFIG as any).UPLOAD_INIT_RATE_LIMIT_MAX = originalLimit; // restaurar
  resetInitUploadRateLimits();

  // 15.12 Plantillas de email en lote (Admin y Alumno)
  const batchAdminEmail = buildAdminBatchSummaryEmail([
    {
      id: 'f1',
      title: 'Parcial 1 Resuelto',
      subjectName: 'Sintaxis',
      kind: 'parcial',
      academicYear: 2024,
      term: '1C',
      sizeBytes: 2048,
      mimeType: 'application/pdf',
      createdAt: new Date(),
    },
    {
      id: 'f2',
      title: 'Resumen Unidad 2',
      subjectName: 'Paradigmas',
      kind: 'resumen',
      academicYear: 2025,
      term: '2C',
      sizeBytes: 4096,
      mimeType: 'application/pdf',
      createdAt: new Date(),
    },
  ]);
  assert(
    batchAdminEmail.subject.includes('2 nuevos materiales para revisar'),
    'Plantilla lote admin: Asunto consolida conteo de materiales pendientes'
  );
  assert(
    batchAdminEmail.text.includes('Parcial 1 Resuelto') && batchAdminEmail.text.includes('Resumen Unidad 2'),
    'Plantilla lote admin: Texto incluye títulos de todos los archivos del lote'
  );

  const batchUploaderApproved = buildUploaderGroupedApprovedEmail([
    { title: 'Parcial 1', subjectName: 'Sintaxis' },
    { title: 'Guía Práctica 3', subjectName: 'Paradigmas' },
  ]);
  assert(
    batchUploaderApproved.subject.includes('Tus 2 aportes fueron aprobados en Stack'),
    'Plantilla lote uploader (aprobados): Asunto consolida cantidad de archivos aprobados'
  );

  const batchUploaderRejected = buildUploaderGroupedRejectedEmail([
    { title: 'Foto Borrosa', subjectName: 'Sintaxis', rejectionReason: 'No es legible' },
    { title: 'Apunte Incompleto', subjectName: 'Paradigmas', rejectionReason: 'Faltan páginas 3 y 4' },
  ]);
  assert(
    batchUploaderRejected.subject.includes('Observaciones sobre tus 2 aportes en Stack'),
    'Plantilla lote uploader (rechazados): Asunto consolida cantidad de rechazos'
  );
  assert(
    batchUploaderRejected.text.includes('No es legible') && batchUploaderRejected.text.includes('Faltan páginas 3 y 4'),
    'Plantilla lote uploader (rechazados): Texto detalla motivos individuales de rechazo'
  );

  // 15.13 listMyUploads excluye uploading y expone pendingCount y maxPending en quota
  const listUserId = '12121212-7777-4212-8212-777777777777';
  libraryStore.seedUser({
    id: listUserId,
    email: 'list.user@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
    termsAccepted: true,
  });
  const listUserToken = signToken({
    id: listUserId,
    email: 'list.user@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
  });

  const listBuf = Buffer.from('%PDF-1.4 %%EOF list-pdf');
  const uploadForList = await api('POST', '/api/library/uploads/init', listUserToken, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Apunte para listar',
    originalFilename: 'listar.pdf',
    mimeType: 'application/pdf',
    sizeBytes: listBuf.length,
    acceptTerms: true,
  });
  // Consultar Mis Aportes mientras está en 'uploading'
  const listResWhileUploading = await api('GET', '/api/library/my-uploads', listUserToken);
  assert(
    listResWhileUploading.data.data.uploads.length === 0,
    'listMyUploads: Archivo en estado uploading NO aparece en la lista de aportes del usuario'
  );
  assert(
    listResWhileUploading.data.data.quota.pendingCount === 1,
    'listMyUploads: quota.pendingCount cuenta archivos activos en uploading'
  );
  assert(
    listResWhileUploading.data.data.quota.maxPending === 30,
    'listMyUploads: quota.maxPending refleja el límite configurado de 30'
  );

  // Completar subida -> pasa a pending
  await mockR2.putObjectDirect(uploadForList.data.data.storageKey, listBuf, 'application/pdf');
  await api('POST', `/api/library/uploads/${uploadForList.data.data.fileId}/complete`, listUserToken);

  const listResAfterComplete = await api('GET', '/api/library/my-uploads', listUserToken);
  assert(
    listResAfterComplete.data.data.uploads.length === 1,
    'listMyUploads: Tras completeUpload el archivo en estado pending aparece en la lista'
  );
  assert(
    listResAfterComplete.data.data.quota.pendingCount === 1,
    'listMyUploads: quota.pendingCount se mantiene en 1 tras pasar a pending'
  );

  // ---------------------------------------------------------------------------
  // 15.14 Mails: Comportamiento Real de Lotes, Esperas y Resiliencia
  // ---------------------------------------------------------------------------
  setAdminNotifyCooldownOverride(120); // Ventana de cooldown real de producción (120 s)
  // Limpiar cola previa de notificaciones pendientes para aislar las pruebas de lote
  for (const f of libraryStore.files.values()) {
    if (!f.adminNotifiedAt) f.adminNotifiedAt = new Date();
  }
  clearMockSentNotifications();
  const batchUserAId = '91919191-1111-4111-8111-111111111111';
  libraryStore.seedUser({
    id: batchUserAId,
    email: 'batch.usera@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
    termsAccepted: true,
  });
  const batchUserAToken = signToken({
    id: batchUserAId,
    email: 'batch.usera@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
  });

  const fileIdsBatchA: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const fileBuf = Buffer.from(`%PDF-1.4 %%EOF batch-mini-pdf-${i}-${Date.now()}-${Math.random()}`);
    const initRes = await api('POST', '/api/library/uploads/init', batchUserAToken, {
      subjectId: 'sub-sintaxis',
      kind: 'parcial',
      title: `Parcial Lote A ${i}`,
      originalFilename: `parcial_lote_a_${i}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: fileBuf.length,
      acceptTerms: true,
    });
    fileIdsBatchA.push(initRes.data.data.fileId);
    await mockR2.putObjectDirect(initRes.data.data.storageKey, fileBuf, 'application/pdf');
  }

  clearMockSentNotifications();
  // Completar los 3 archivos seguidos dentro de la ventana de espera
  for (const fId of fileIdsBatchA) {
    await api('POST', `/api/library/uploads/${fId}/complete`, batchUserAToken);
  }

  // Al vencer la ventana (forzado con force: true), se procesa el lote
  await processPendingAdminNotifications({ force: true });

  const adminPendingEmails = mockSentNotifications.filter(
    (n) => n.type === 'admin_summary' || n.type === 'admin_pending'
  );
  assert(
    adminPendingEmails.length === 1,
    'Mails real (a): Lote de 3 archivos completados produce UN solo mail al admin',
    `obt: ${adminPendingEmails.length}`
  );
  assert(
    adminPendingEmails[0]?.text.includes('Parcial Lote A 1') &&
      adminPendingEmails[0]?.text.includes('Parcial Lote A 2') &&
      adminPendingEmails[0]?.text.includes('Parcial Lote A 3'),
    'Mails real (a): El correo consolidado incluye los 3 archivos'
  );
  const allNotifiedInDb = fileIdsBatchA.every((id) => libraryStore.files.get(id)?.adminNotifiedAt !== null);
  assert(allNotifiedInDb, 'Mails real (a): Marca adminNotifiedAt en todos los archivos del lote');

  // (b) Ventana de espera (cooldown): dentro de la ventana NO envía inmediatamente
  setAdminNotifyCooldownOverride(120); // 120 segundos
  clearMockSentNotifications();
  const coolBuf = Buffer.from(`%PDF-1.4 %%EOF cooldown-pdf-${Date.now()}-${Math.random()}`);
  const initCool = await api('POST', '/api/library/uploads/init', batchUserAToken, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Apunte con Cooldown',
    originalFilename: 'cooldown.pdf',
    mimeType: 'application/pdf',
    sizeBytes: coolBuf.length,
    acceptTerms: true,
  });
  await mockR2.putObjectDirect(initCool.data.data.storageKey, coolBuf, 'application/pdf');
  await api('POST', `/api/library/uploads/${initCool.data.data.fileId}/complete`, batchUserAToken);

  assert(
    mockSentNotifications.length === 0,
    'Mails real (b): Dentro de la ventana de espera (120 s) NO dispara mail inmediato'
  );
  // Al vencer la ventana (simulada con force: true tras el cooldown), se procesa el envío
  await processPendingAdminNotifications({ force: true });
  assert(
    mockSentNotifications.length === 1 && mockSentNotifications[0].text.includes('Apunte con Cooldown'),
    'Mails real (b): Al vencer la ventana de espera se despacha el correo al admin'
  );
  setAdminNotifyCooldownOverride(null); // Restaurar a default

  // (c) Filas pendientes de antes (simulación de reinicio del servidor)
  clearMockSentNotifications();
  const fPendingOld1 = '11111111-9999-4111-8111-999999999991';
  const fPendingOld2 = '11111111-9999-4111-8111-999999999992';
  libraryStore.files.set(fPendingOld1, {
    id: fPendingOld1,
    uploaderUserId: batchUserAId,
    subjectId: 'sub-sintaxis',
    kind: 'parcial',
    academicYear: 2024,
    term: '1C',
    examInstance: null,
    hasSolution: false,
    title: 'Archivo Previo Reinicio 1',
    description: null,
    originalFilename: 'previo1.pdf',
    storageKey: `library/${fPendingOld1}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    sha256: 'prev1',
    status: 'pending',
    adminNotifiedAt: null,
    uploaderNotifiedAt: null,
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    downloadCount: 0,
    helpfulCount: 0,
    createdAt: new Date(Date.now() - 10 * 60 * 1000),
    updatedAt: new Date(Date.now() - 10 * 60 * 1000),
  });
  libraryStore.files.set(fPendingOld2, {
    id: fPendingOld2,
    uploaderUserId: batchUserAId,
    subjectId: 'sub-sintaxis',
    kind: 'parcial',
    academicYear: 2024,
    term: '1C',
    examInstance: null,
    hasSolution: false,
    title: 'Archivo Previo Reinicio 2',
    description: null,
    originalFilename: 'previo2.pdf',
    storageKey: `library/${fPendingOld2}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    sha256: 'prev2',
    status: 'pending',
    adminNotifiedAt: null,
    uploaderNotifiedAt: null,
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    downloadCount: 0,
    helpfulCount: 0,
    createdAt: new Date(Date.now() - 10 * 60 * 1000),
    updatedAt: new Date(Date.now() - 10 * 60 * 1000),
  });

  // Chequeo de arranque (el mismo que ejecuta app.ts al iniciar)
  await processPendingAdminNotifications({ force: true });
  assert(
    mockSentNotifications.length === 1 &&
      mockSentNotifications[0].text.includes('Archivo Previo Reinicio 1') &&
      mockSentNotifications[0].text.includes('Archivo Previo Reinicio 2'),
    'Mails real (c): Filas pendientes previas al reinicio son retomadas en el chequeo de arranque'
  );

  // (d) Tolerancia a fallos: si falla el proveedor de mail, las filas quedan SIN marcar y se reintentan
  clearMockSentNotifications();
  defaultMailer.setAdapterForTesting({
    sendEmail: async () => ({ success: false, error: 'Resend API 500 Outage' }),
    sendVerificationCode: async () => ({ success: true, provider: 'mock' }),
  });

  const failBuf = Buffer.from(`%PDF-1.4 %%EOF fail-pdf-${Date.now()}-${Math.random()}`);
  const initFail = await api('POST', '/api/library/uploads/init', batchUserAToken, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Archivo con Falla de Mail',
    originalFilename: 'fail_mail.pdf',
    mimeType: 'application/pdf',
    sizeBytes: failBuf.length,
    acceptTerms: true,
  });
  await mockR2.putObjectDirect(initFail.data.data.storageKey, failBuf, 'application/pdf');
  const completeFailRes = await api(
    'POST',
    `/api/library/uploads/${initFail.data.data.fileId}/complete`,
    batchUserAToken
  );
  assert(
    completeFailRes.status === 200,
    'Mails real (d): Falla de red en envío de mail NO rompe la subida del archivo (200 OK)'
  );
  // Ejecutar el envío con el adaptador que falla
  await processPendingAdminNotifications({ force: true });
  const fileFailInDb = libraryStore.files.get(initFail.data.data.fileId);
  assert(
    fileFailInDb?.status === 'pending' && fileFailInDb.adminNotifiedAt === null,
    'Mails real (d): El archivo queda en pending sin marcar adminNotifiedAt tras fallo de mail'
  );

  // Restaurar mailer y reintentar
  defaultMailer.setAdapterForTesting(null);
  await processPendingAdminNotifications({ force: true });
  assert(
    fileFailInDb?.adminNotifiedAt !== null,
    'Mails real (d): En el siguiente ciclo el archivo pendiente se reintenta y se marca notificado'
  );

  // (e) Mails al estudiante: aprobar o rechazar varios archivos del mismo estudiante en lote
  clearMockSentNotifications();
  const fApprove1 = '22222222-1111-4222-8222-111111111111';
  const fApprove2 = '22222222-2222-4222-8222-222222222222';
  libraryStore.files.set(fApprove1, {
    id: fApprove1,
    uploaderUserId: batchUserAId,
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Apunte Aprobado 1',
    storageKey: `library/${fApprove1}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    status: 'pending',
    uploaderNotifiedAt: null,
    adminNotifiedAt: new Date(),
    downloadCount: 0,
    helpfulCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);
  libraryStore.files.set(fApprove2, {
    id: fApprove2,
    uploaderUserId: batchUserAId,
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Apunte Aprobado 2',
    storageKey: `library/${fApprove2}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    status: 'pending',
    uploaderNotifiedAt: null,
    adminNotifiedAt: new Date(),
    downloadCount: 0,
    helpfulCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  // Aprobar ambos archivos
  await api('PATCH', `/api/admin/library/files/${fApprove1}/approve`, adminToken);
  await api('PATCH', `/api/admin/library/files/${fApprove2}/approve`, adminToken);
  await processPendingUploaderNotifications({ force: true });

  const uploaderApprovedEmails = mockSentNotifications.filter(
    (n) => n.type === 'uploader_approved' && n.to.includes('batch.usera@frc.utn.edu.ar')
  );
  assert(
    uploaderApprovedEmails.length === 1,
    'Mails real (e): Aprobar varios archivos del estudiante produce UN solo mail consolidado'
  );
  assert(
    uploaderApprovedEmails[0].text.includes('Apunte Aprobado 1') &&
      uploaderApprovedEmails[0].text.includes('Apunte Aprobado 2'),
    'Mails real (e): El mail de aprobación lista todos los archivos aprobados'
  );

  // Rechazar varios archivos del estudiante en lote
  clearMockSentNotifications();
  const fReject1 = '33333333-1111-4333-8333-111111111111';
  const fReject2 = '33333333-2222-4333-8333-222222222222';
  libraryStore.files.set(fReject1, {
    id: fReject1,
    uploaderUserId: batchUserAId,
    subjectId: 'sub-sintaxis',
    kind: 'parcial',
    title: 'Foto Parcial Borrosa',
    storageKey: `library/${fReject1}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    status: 'pending',
    uploaderNotifiedAt: null,
    adminNotifiedAt: new Date(),
    downloadCount: 0,
    helpfulCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);
  libraryStore.files.set(fReject2, {
    id: fReject2,
    uploaderUserId: batchUserAId,
    subjectId: 'sub-sintaxis',
    kind: 'parcial',
    title: 'Parcial Hoja Incompleta',
    storageKey: `library/${fReject2}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    status: 'pending',
    uploaderNotifiedAt: null,
    adminNotifiedAt: new Date(),
    downloadCount: 0,
    helpfulCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  await api('PATCH', `/api/admin/library/files/${fReject1}/reject`, adminToken, {
    reason: 'La imagen está fuera de foco y no se lee el enunciado.',
  });
  await api('PATCH', `/api/admin/library/files/${fReject2}/reject`, adminToken, {
    reason: 'Falta la segunda hoja con el ejercicio práctico.',
  });
  await processPendingUploaderNotifications({ force: true });

  const uploaderRejectedEmails = mockSentNotifications.filter(
    (n) => n.type === 'uploader_rejected' && n.to.includes('batch.usera@frc.utn.edu.ar')
  );
  assert(
    uploaderRejectedEmails.length === 1,
    'Mails real (e): Rechazar varios archivos del estudiante produce UN solo mail consolidado'
  );
  assert(
    uploaderRejectedEmails[0].text.includes('fuera de foco') &&
      uploaderRejectedEmails[0].text.includes('Falta la segunda hoja'),
    'Mails real (e): El mail de rechazo detalla los motivos individuales de cada archivo'
  );

  // (f) Respeto de notifyLibraryEmail y exclusión de usuarios suspendidos; anonimato en mail admin
  clearMockSentNotifications();
  const suspendedUserId = '44444444-9999-4444-8444-999999999999';
  libraryStore.seedUser({
    id: suspendedUserId,
    email: 'suspendido@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
    termsAccepted: true,
    status: 'suspended',
  });
  const fSuspended = '44444444-1111-4444-8444-111111111111';
  libraryStore.files.set(fSuspended, {
    id: fSuspended,
    uploaderUserId: suspendedUserId,
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Apunte Usuario Suspendido',
    storageKey: `library/${fSuspended}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    status: 'pending',
    uploaderNotifiedAt: null,
    adminNotifiedAt: new Date(),
    downloadCount: 0,
    helpfulCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  await api('PATCH', `/api/admin/library/files/${fSuspended}/approve`, adminToken);
  await processPendingUploaderNotifications({ force: true });

  const emailsToSuspended = mockSentNotifications.filter((n) =>
    n.to.includes('suspendido@frc.utn.edu.ar')
  );
  assert(
    emailsToSuspended.length === 0,
    'Mails real (f): Usuario suspendido NO recibe emails de aprobación ni de rechazo'
  );

  // Verificación de privacidad: El mail al admin no contiene email ni id del autor
  const adminNotification = mockSentNotifications.find(
    (n) => n.type === 'admin_pending' || n.type === 'admin_summary'
  );
  if (adminNotification) {
    assert(
      !adminNotification.text.includes(batchUserAId) &&
        !adminNotification.text.includes('batch.usera@frc.utn.edu.ar'),
      'Mails real (f): El mail al admin NO contiene el uploaderUserId ni el email del autor'
    );
  } else {
    const batchTpl = buildAdminBatchSummaryEmail([
      {
        id: 'f-anon',
        title: 'Prueba Anonimato',
        subjectName: 'Sintaxis',
        kind: 'parcial',
        sizeBytes: 1024,
        mimeType: 'application/pdf',
        createdAt: new Date(),
      },
    ]);
    assert(
      !batchTpl.text.includes(batchUserAId) && !batchTpl.text.includes('batch.usera@frc.utn.edu.ar'),
      'Mails real (f): Plantilla al admin NO contiene uploaderUserId ni email de autor'
    );
  }
  setAdminNotifyCooldownOverride(null); // Restaurar cooldown a default

  // ---------------------------------------------------------------------------
  // 15.15 Archivos Rechazados, Encolado de Huérfanos en R2 y Freno Anti-Spam
  // ---------------------------------------------------------------------------
  // (a) Encolado en orphanDeletions al rechazar
  const rejFileId = fReject1;
  const rejFileRecord = libraryStore.files.get(rejFileId);
  const orphanEntry = Array.from(libraryStore.orphanDeletions.values()).find(
    (o) => o.storageKey === rejFileRecord?.storageKey
  );
  assert(
    Boolean(orphanEntry),
    'Archivos rechazados (3a): Al rechazar, el storageKey queda encolado en orphanDeletions para borrado de R2'
  );

  // (b) Imposibilidad de previsualizar o descargar archivo rechazado (410 Gone)
  const prevRejectedRes = await api('GET', `/api/admin/library/files/${rejFileId}/preview-url`, adminToken);
  assert(
    prevRejectedRes.status === 410 && prevRejectedRes.data.code === 'FILE_CONTENT_PURGED',
    'Archivos rechazados (3a): getPreviewUrl sobre archivo rechazado devuelve 410 FILE_CONTENT_PURGED'
  );

  const dlRejectedRes = await api('GET', `/api/library/files/${rejFileId}/download`, batchUserAToken);
  assert(
    dlRejectedRes.status === 410 && dlRejectedRes.data.code === 'FILE_NOT_AVAILABLE',
    'Archivos rechazados (3a): getDownloadUrl sobre archivo rechazado devuelve 410 FILE_NOT_AVAILABLE'
  );

  // (c) Freno anti-spam: 20 o más rechazos en los últimos 7 días bloquea nuevas subidas
  const spammerId = '55555555-8888-4555-8555-888888888888';
  libraryStore.seedUser({
    id: spammerId,
    email: 'spammer@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
    termsAccepted: true,
  });
  const spammerToken = signToken({
    id: spammerId,
    email: 'spammer@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
  });

  // Sembrar 20 archivos rechazados hace 2 días para spammerId
  for (let i = 1; i <= 20; i++) {
    const sId = `spam-rej-${i}`;
    libraryStore.files.set(sId, {
      id: sId,
      uploaderUserId: spammerId,
      subjectId: 'sub-sintaxis',
      kind: 'parcial',
      title: `Parcial Rechazado Basura ${i}`,
      storageKey: `library/${sId}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      status: 'rejected',
      rejectionReason: 'Contenido spam repetitivo.',
      reviewedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // Hace 2 días
      downloadCount: 0,
      helpfulCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
  }

  const spammerInitRes = await api('POST', '/api/library/uploads/init', spammerToken, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Nuevo intento spam',
    originalFilename: 'spam.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  assert(
    spammerInitRes.status === 429 && spammerInitRes.data.code === 'TOO_MANY_REJECTIONS',
    'Anti-spam (3c): Bloquea con 429 TOO_MANY_REJECTIONS al alcanzar 20 rechazos en 7 días'
  );
  assert(
    spammerInitRes.data.error.includes('acumula 20 archivos rechazados') &&
      spammerInitRes.data.error.includes('hora(s)'),
    'Anti-spam (3c): Mensaje de error indica cantidad de rechazos y en cuántas horas se levanta'
  );

  // Valor 0 desactiva la regla
  const origThreshold = LIBRARY_CONFIG.MAX_REJECTIONS_THRESHOLD;
  (LIBRARY_CONFIG as any).MAX_REJECTIONS_THRESHOLD = 0;
  const spammerDisabledRes = await api('POST', '/api/library/uploads/init', spammerToken, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Intento con regla desactivada',
    originalFilename: 'desactivado.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  assert(
    spammerDisabledRes.status === 201,
    'Anti-spam (3c): Umbral en 0 desactiva la regla anti-spam y permite subir'
  );
  (LIBRARY_CONFIG as any).MAX_REJECTIONS_THRESHOLD = origThreshold; // Restaurar

  // ---------------------------------------------------------------------------
  // 15.16 Casos Borde en /complete: Expiración, No Dueño e Idempotencia
  // ---------------------------------------------------------------------------
  // (a) Fila inexistente o expirada
  const nonExistentFileId = '00000000-0000-4000-8000-000000000000';
  const completeExpiredRes = await api(
    'POST',
    `/api/library/uploads/${nonExistentFileId}/complete`,
    batchUserAToken
  );
  assert(
    completeExpiredRes.status === 404 && completeExpiredRes.data.code === 'UPLOAD_NOT_FOUND_OR_EXPIRED',
    '/complete (4a): Fila inexistente o expirada devuelve 404 UPLOAD_NOT_FOUND_OR_EXPIRED'
  );

  // (b) Usuario que no es el dueño
  const completeNotOwnerRes = await api(
    'POST',
    `/api/library/uploads/${fReject1}/complete`,
    spammerToken
  );
  assert(
    completeNotOwnerRes.status === 404 && completeNotOwnerRes.data.code === 'UPLOAD_NOT_FOUND_OR_EXPIRED',
    '/complete (4c): Usuario no dueño recibe 404 UPLOAD_NOT_FOUND_OR_EXPIRED sin filtrar datos'
  );

  // (c) Idempotencia con estados de ciclo de vida
  // approved -> 200 OK
  const completeApprovedRes = await api(
    'POST',
    `/api/library/uploads/${fApprove1}/complete`,
    batchUserAToken
  );
  assert(
    completeApprovedRes.status === 200 && completeApprovedRes.data.success === true,
    '/complete (4b): Archivo ya en approved responde 200 OK idéntico al pending'
  );

  // rejected -> 400 UPLOAD_ALREADY_REJECTED
  const completeRejectedRes = await api(
    'POST',
    `/api/library/uploads/${fReject1}/complete`,
    batchUserAToken
  );
  assert(
    completeRejectedRes.status === 400 && completeRejectedRes.data.code === 'UPLOAD_ALREADY_REJECTED',
    '/complete (4b): Archivo en rejected responde 400 UPLOAD_ALREADY_REJECTED con motivo'
  );

  // removed / hidden -> 400 UPLOAD_NOT_ACTIVE
  const fRemoved = '66666666-1111-4666-8666-111111111111';
  libraryStore.files.set(fRemoved, {
    id: fRemoved,
    uploaderUserId: batchUserAId,
    subjectId: 'sub-sintaxis',
    kind: 'parcial',
    title: 'Archivo Removido',
    storageKey: `library/${fRemoved}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    status: 'removed',
    rejectionReason: 'Dado de baja por infracción',
    reviewedAt: new Date(),
    downloadCount: 0,
    helpfulCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  const completeRemovedRes = await api(
    'POST',
    `/api/library/uploads/${fRemoved}/complete`,
    batchUserAToken
  );
  assert(
    completeRemovedRes.status === 400 && completeRemovedRes.data.code === 'UPLOAD_NOT_ACTIVE',
    '/complete (4b): Archivo en removed responde 400 UPLOAD_NOT_ACTIVE'
  );

  // ---------------------------------------------------------------------------
  // 21. USUARIO CON selectedPlanId = null RESUELVE PLAN PUBLICADO (NO DRAFT)
  // ---------------------------------------------------------------------------
  console.log('\n📌 21. Resolución fallback de biblioteca para selectedPlanId = null sin elegir draft');

  const instLibId = '77777777-1111-4777-8777-111111111111';
  const facLibId = '77777777-2222-4777-8777-111111111111';
  const careerDraftLibId = '77777777-3333-4777-8777-111111111111';
  const careerPubLibId = '77777777-4444-4777-8777-111111111111';
  const careerOtherLibId = '77777777-5555-4777-8777-111111111111';
  const planDraftLibId = '88888888-1111-4888-8888-111111111111';
  const planPubLibId = '88888888-2222-4888-8888-111111111111';
  const planOtherLibId = '88888888-3333-4888-8888-111111111111';

  catalogStore.institutions.push({ id: instLibId, name: 'UTN', code: 'UTN' });
  catalogStore.faculties.push({ id: facLibId, institutionId: instLibId, name: 'FRC', code: 'FRC' });
  catalogStore.careers.push(
    { id: careerDraftLibId, facultyId: facLibId, name: 'Carrera Borrador', code: 'BORR', status: 'published' },
    { id: careerPubLibId, facultyId: facLibId, name: 'Ingeniería en Sistemas', code: 'ISI', status: 'published' },
    { id: careerOtherLibId, facultyId: facLibId, name: 'Ingeniería Industrial', code: 'IND', status: 'published' }
  );
  // Plan draft sembrado PRIMERO e isActive: true
  catalogStore.plans.push(
    {
      id: planDraftLibId,
      careerId: careerDraftLibId,
      name: 'Plan Borrador',
      year: 2026,
      status: 'draft',
      isActive: true,
      config: {},
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    },
    {
      id: planPubLibId,
      careerId: careerPubLibId,
      name: 'Plan 2023',
      year: 2023,
      status: 'published',
      isActive: true,
      config: {},
      createdAt: new Date('2024-02-01T00:00:00Z'),
      updatedAt: new Date('2024-02-01T00:00:00Z'),
    },
    {
      id: planOtherLibId,
      careerId: careerOtherLibId,
      name: 'Plan 2024',
      year: 2024,
      status: 'published',
      isActive: true,
      config: {},
      createdAt: new Date('2024-03-01T00:00:00Z'),
      updatedAt: new Date('2024-03-01T00:00:00Z'),
    }
  );

  const subDraftLibId = 'aaaaaaaa-1111-4aaa-8aaa-111111111111';
  const subPubLibId = 'aaaaaaaa-2222-4aaa-8aaa-111111111111';
  const subOtherLibId = 'aaaaaaaa-3333-4aaa-8aaa-111111111111';
  libraryStore.seedSubject({
    id: subDraftLibId,
    name: 'Materia Draft Exclusiva',
    codeInPlan: 901,
    level: 1,
    planId: planDraftLibId,
    sharedSubjectId: 'bbbbbbbb-1111-4bbb-8bbb-111111111111',
  });
  libraryStore.seedSubject({
    id: subPubLibId,
    name: 'Materia Publicada ISI',
    codeInPlan: 902,
    level: 1,
    planId: planPubLibId,
    sharedSubjectId: 'bbbbbbbb-2222-4bbb-8bbb-111111111111',
  });
  libraryStore.seedSubject({
    id: subOtherLibId,
    name: 'Materia Otra Carrera',
    codeInPlan: 903,
    level: 1,
    planId: planOtherLibId,
    sharedSubjectId: 'bbbbbbbb-3333-4bbb-8bbb-111111111111',
  });

  const fDraftLib = 'cccccccc-1111-4ccc-8ccc-111111111111';
  const fPubLib = 'cccccccc-2222-4ccc-8ccc-111111111111';
  const fOtherLib = 'cccccccc-3333-4ccc-8ccc-111111111111';
  for (const [fid, sid, pid, title] of [
    [fDraftLib, subDraftLibId, planDraftLibId, 'Apunte Draft'],
    [fPubLib, subPubLibId, planPubLibId, 'Apunte Publicado ISI'],
    [fOtherLib, subOtherLibId, planOtherLibId, 'Apunte Otra Carrera'],
  ] as const) {
    libraryStore.files.set(fid, {
      id: fid,
      uploaderUserId: student1Id,
      subjectId: sid,
      sharedSubjectId: null,
      sourcePlanId: pid,
      kind: 'apunte',
      title,
      description: null,
      academicYear: 2026,
      term: '1C',
      examInstance: null,
      professorText: null,
      hasSolution: false,
      originalFilename: `${fid}.pdf`,
      storageKey: `library/${fid}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      status: 'approved',
      rejectionReason: null,
      downloadCount: 0,
      helpfulCount: 0,
      reportsCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
  }

  const nullLibUserId = '55555555-5555-4555-8555-555555555555';
  libraryStore.seedUser({
    id: nullLibUserId,
    email: 'sin.plan.lib@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
    termsAccepted: true,
  });
  (libraryStore.users.get(nullLibUserId) as any).selectedPlanId = null;
  const nullLibToken = signToken({
    id: nullLibUserId,
    email: 'sin.plan.lib@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
    selectedPlanId: null,
  });

  const libSubsRes = await api('GET', '/api/library/subjects', nullLibToken);
  const libSubIds = (libSubsRes.data?.data || []).map((s: any) => s.id);
  const libFilesRes = await api('GET', '/api/library/files', nullLibToken);
  const libFileIds = (libFilesRes.data?.data?.items || []).map((f: any) => f.id);
  assert(
    libSubsRes.status === 200 &&
      libSubIds.length === 1 &&
      libSubIds[0] === subPubLibId &&
      libFilesRes.status === 200 &&
      libFileIds.length === 1 &&
      libFileIds[0] === fPubLib,
    'Library (/subjects y /files) para usuario con selectedPlanId = null acota al plan publicado por defecto y excluye planes draft/ajenos',
    `subIds=${JSON.stringify(libSubIds)}, fileIds=${JSON.stringify(libFileIds)}`
  );

  const draftDetailBlocked = await api('GET', `/api/library/files/${fDraftLib}`, nullLibToken);
  const draftSubFilesBlocked = await api(
    'GET',
    `/api/library/subjects/${subDraftLibId}/files`,
    nullLibToken
  );
  const draftDownloadBlocked = await api(
    'GET',
    `/api/library/files/${fDraftLib}/download`,
    nullLibToken
  );
  const draftHelpfulBlocked = await api(
    'POST',
    `/api/library/files/${fDraftLib}/helpful`,
    nullLibToken
  );
  const draftReportBlocked = await api(
    'POST',
    `/api/library/files/${fDraftLib}/report`,
    nullLibToken,
    { reason: 'spam' }
  );
  const draftUploadBlocked = await api(
    'POST',
    '/api/library/uploads/init',
    nullLibToken,
    {
      subjectId: subDraftLibId,
      kind: 'apunte',
      title: 'No debería poder subir a draft',
      originalFilename: 'x.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 512,
      acceptTerms: true,
    }
  );
  const pubDetailAllowed = await api('GET', `/api/library/files/${fPubLib}`, nullLibToken);
  const adminGlobalDetail = await api('GET', `/api/library/files/${fDraftLib}`, adminToken);
  assert(
    draftDetailBlocked.status === 404 &&
      draftSubFilesBlocked.status === 404 &&
      draftDownloadBlocked.status === 404 &&
      draftHelpfulBlocked.status === 404 &&
      draftReportBlocked.status === 404 &&
      draftUploadBlocked.status === 404 &&
      pubDetailAllowed.status === 200 &&
      adminGlobalDetail.status === 200,
    'selectedPlanId = null bloquea acceso al plan draft en detalle/listado/descarga/voto/reporte/upload (404), habilita el plan publicado (200) y conserva alcance global de admin (200)',
    `statuses=${draftDetailBlocked.status}/${draftSubFilesBlocked.status}/${draftDownloadBlocked.status}/${draftHelpfulBlocked.status}/${draftReportBlocked.status}/${draftUploadBlocked.status}/${pubDetailAllowed.status}/${adminGlobalDetail.status}`
  );

  // ---------------------------------------------------------------------------
  // 22. RECHAZOS AUTOMÁTICOS EN /complete: CÓDIGOS, LIMPIEZA R2, SIN MAIL/MIS APORTES Y ANTI-SPAM
  // ---------------------------------------------------------------------------
  console.log('\n📌 22. Rechazos automáticos en /complete: código 400, huérfanos R2, Mis Aportes y TOO_MANY_REJECTIONS');

  setCatalogStoreForTesting(new InMemoryCatalogStore());
  resetInitUploadRateLimits();
  clearMockSentNotifications();

  const autoRejectUserId = 'aaaa1111-2222-4333-8444-555566667777';
  libraryStore.seedUser({
    id: autoRejectUserId,
    email: 'autoreject@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
    termsAccepted: true,
  });
  const autoRejectToken = signToken({
    id: autoRejectUserId,
    email: 'autoreject@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
  });

  // 22.1 Archivo JS disfrazado de PDF -> 400 INVALID_FILE_CONTENT
  const fakeJsBuf = Buffer.from('console.log("no soy un pdf");');
  const fakeInitRes = await api('POST', '/api/library/uploads/init', autoRejectToken, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'JS disfrazado de PDF',
    originalFilename: 'disfrazado.pdf',
    mimeType: 'application/pdf',
    sizeBytes: fakeJsBuf.length,
    acceptTerms: true,
  });
  assert(fakeInitRes.status === 201, 'Init para archivo disfrazado devuelve 201');
  const fakeFileId = fakeInitRes.data.data.fileId;
  const fakeStorageKey = fakeInitRes.data.data.storageKey;
  await mockR2.putObjectDirect(fakeStorageKey, fakeJsBuf, 'application/pdf');

  const fakeCompleteRes = await api('POST', `/api/library/uploads/${fakeFileId}/complete`, autoRejectToken);
  assert(
    fakeCompleteRes.status === 400 && fakeCompleteRes.data.code === 'INVALID_FILE_CONTENT',
    'JS disfrazado de PDF recibe 400 INVALID_FILE_CONTENT en /complete'
  );
  assert(!mockR2.hasObjectDirect(fakeStorageKey), 'El archivo inválido es borrado de inmediato de R2');

  const fakeDbRow = libraryStore.files.get(fakeFileId);
  assert(
    fakeDbRow?.status === 'rejected' &&
      !fakeDbRow?.reviewedAt &&
      Boolean(fakeDbRow?.uploaderNotifiedAt),
    'La fila se conserva con status rejected, reviewedAt null y uploaderNotifiedAt seteado'
  );

  // 22.2 PDF con /JavaScript -> 400 DANGEROUS_PDF_CONTENT
  const jsPdfBuf = Buffer.from('%PDF-1.4\n<< /S /JavaScript /JS (app.alert(1)) >>\n%%EOF');
  const jsPdfInitRes = await api('POST', '/api/library/uploads/init', autoRejectToken, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'PDF con JavaScript embebido',
    originalFilename: 'script_pdf.pdf',
    mimeType: 'application/pdf',
    sizeBytes: jsPdfBuf.length,
    acceptTerms: true,
  });
  const jsPdfFileId = jsPdfInitRes.data.data.fileId;
  const jsPdfStorageKey = jsPdfInitRes.data.data.storageKey;
  await mockR2.putObjectDirect(jsPdfStorageKey, jsPdfBuf, 'application/pdf');

  const jsPdfCompleteRes = await api('POST', `/api/library/uploads/${jsPdfFileId}/complete`, autoRejectToken);
  assert(
    jsPdfCompleteRes.status === 400 && jsPdfCompleteRes.data.code === 'DANGEROUS_PDF_CONTENT',
    'PDF con /JavaScript recibe 400 DANGEROUS_PDF_CONTENT en /complete'
  );
  assert(!mockR2.hasObjectDirect(jsPdfStorageKey), 'El PDF peligroso es borrado de R2');

  // 22.3 (a) No genera mail de moderación ni aparece en Mis Aportes ni en hasStatusUpdates
  await processPendingUploaderNotifications({ force: true });
  const autoRejectEmails = mockSentNotifications.filter((n) =>
    n.to.includes('autoreject@frc.utn.edu.ar')
  );
  assert(
    autoRejectEmails.length === 0,
    'Rechazo automático en /complete NO genera mail de rechazo de moderación'
  );

  const autoRejectMyUploads = await api('GET', '/api/library/my-uploads', autoRejectToken);
  assert(
    autoRejectMyUploads.status === 200 &&
      autoRejectMyUploads.data.data.uploads.length === 0 &&
      autoRejectMyUploads.data.data.hasStatusUpdates === false &&
      autoRejectMyUploads.data.data.quota.pendingCount === 0 &&
      autoRejectMyUploads.data.data.quota.usedBytes === 0,
    'Rechazos automáticos de /complete NO aparecen en Mis Aportes, no activan novedades ni consumen cupo/cuota'
  );

  // 22.4 Si r2.deleteObject falla (retorna false) al rechazar en /complete, encola en orphanDeletions
  const orphanTestInit = await api('POST', '/api/library/uploads/init', autoRejectToken, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Falla borrado R2 en complete',
    originalFilename: 'orphan_complete.pdf',
    mimeType: 'application/pdf',
    sizeBytes: fakeJsBuf.length,
    acceptTerms: true,
  });
  const orphanTestFileId = orphanTestInit.data.data.fileId;
  const orphanTestKey = orphanTestInit.data.data.storageKey;
  await mockR2.putObjectDirect(orphanTestKey, fakeJsBuf, 'application/pdf');

  const origDeleteObject = mockR2.deleteObject.bind(mockR2);
  (mockR2 as any).deleteObject = async () => false;
  const orphanCompleteRes = await api(
    'POST',
    `/api/library/uploads/${orphanTestFileId}/complete`,
    autoRejectToken
  );
  delete (mockR2 as any).deleteObject;
  await origDeleteObject(orphanTestKey);

  assert(orphanCompleteRes.status === 400, 'Rechazo en /complete sigue respondiendo 400 cuando falla deleteObject');
  const queuedOrphan = Array.from(libraryStore.orphanDeletions.values()).find(
    (o) => o.storageKey === orphanTestKey
  );
  assert(
    Boolean(queuedOrphan),
    'Si r2.deleteObject retorna false en /complete, el objeto queda encolado en orphanDeletions'
  );

  // 22.5 (b) Comportamiento de TOO_MANY_REJECTIONS:
  // Los rechazos automáticos de /complete tienen reviewedAt = null, por lo que NO cuentan para TOO_MANY_REJECTIONS.
  // Ya hubo 3 rechazos automáticos para autoRejectUserId; agregamos 17 más (total 20) y verificamos que NO bloquea.
  for (let i = 4; i <= 20; i++) {
    const badBuf = Buffer.from(`not-a-pdf-${i}`);
    const badInit = await api('POST', '/api/library/uploads/init', autoRejectToken, {
      subjectId: 'sub-sintaxis',
      kind: 'apunte',
      title: `Rechazo auto ${i}`,
      originalFilename: `bad_${i}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: badBuf.length,
      acceptTerms: true,
    });
    await mockR2.putObjectDirect(badInit.data.data.storageKey, badBuf, 'application/pdf');
    await api('POST', `/api/library/uploads/${badInit.data.data.fileId}/complete`, autoRejectToken);
  }

  const after20AutoRejectsInit = await api('POST', '/api/library/uploads/init', autoRejectToken, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Subida 21 tras rechazos automáticos',
    originalFilename: 'valid_after_auto.pdf',
    mimeType: 'application/pdf',
    sizeBytes: validPdfBuffer.length,
    acceptTerms: true,
  });
  assert(
    after20AutoRejectsInit.status === 201,
    'TOO_MANY_REJECTIONS: 20 rechazos automáticos en /complete (reviewedAt null) NO bloquean nuevas subidas'
  );

  // En contraste, 20 rechazos de moderación (reviewedAt seteado vía admin /reject) SÍ activan 429 TOO_MANY_REJECTIONS
  const modAdminId = '99999999-2222-4999-8999-999999999999';
  libraryStore.seedUser({
    id: modAdminId,
    email: 'admin-mod-lib@stack.com',
    role: 'admin',
    emailVerified: true,
    termsAccepted: true,
  });
  const modAdminToken = signToken({
    id: modAdminId,
    email: 'admin-mod-lib@stack.com',
    role: 'admin',
    emailVerified: true,
  });

  const modRejUserId = 'bbbb1111-2222-4333-8444-555566667777';
  libraryStore.seedUser({
    id: modRejUserId,
    email: 'modreject@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
    termsAccepted: true,
  });
  const modRejToken = signToken({
    id: modRejUserId,
    email: 'modreject@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
  });
  let modReject200Count = 0;
  for (let i = 1; i <= 20; i++) {
    const okPdf = Buffer.from(`%PDF-1.4 %%EOF mod-rej-${i}-${Date.now()}`);
    const initMod = await api('POST', '/api/library/uploads/init', modRejToken, {
      subjectId: 'sub-sintaxis',
      kind: 'apunte',
      title: `Aporte moderado ${i}`,
      originalFilename: `mod_${i}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: okPdf.length,
      acceptTerms: true,
    });
    await mockR2.putObjectDirect(initMod.data.data.storageKey, okPdf, 'application/pdf');
    await api('POST', `/api/library/uploads/${initMod.data.data.fileId}/complete`, modRejToken);
    const rejRes = await api(
      'PATCH',
      `/api/admin/library/files/${initMod.data.data.fileId}/reject`,
      modAdminToken,
      { reason: 'Material repetido de otra materia' }
    );
    if (rejRes.status === 200) modReject200Count++;
  }
  assert(
    modReject200Count === 20,
    `Los 20 rechazos de moderación respondieron 200 OK [obt: ${modReject200Count}]`
  );

  const modMyUploadsRes = await api('GET', '/api/library/my-uploads?peek=1', modRejToken);
  assert(
    modMyUploadsRes.status === 200 &&
      modMyUploadsRes.data.data.uploads.length === 20 &&
      modMyUploadsRes.data.data.hasStatusUpdates === true,
    'Los rechazos de moderación reales (con reviewedAt) SÍ siguen apareciendo en Mis Aportes y activan hasStatusUpdates'
  );

  const after20ModRejectsInit = await api('POST', '/api/library/uploads/init', modRejToken, {
    subjectId: 'sub-sintaxis',
    kind: 'apunte',
    title: 'Intento 21 tras 20 rechazos de moderación',
    originalFilename: 'blocked_after_mod.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    acceptTerms: true,
  });
  assert(
    after20ModRejectsInit.status === 429 && after20ModRejectsInit.data.code === 'TOO_MANY_REJECTIONS',
    'TOO_MANY_REJECTIONS: 20 rechazos de moderación reales SÍ bloquean con 429 TOO_MANY_REJECTIONS'
  );

  setCatalogStoreForTesting(null);
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
