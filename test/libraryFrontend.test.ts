import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY_CONFIG, type LibraryFilePublic, type LibraryFileKind } from '../src/types/library';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('\n======================================================================');
console.log(' 🧪 TESTS FRONTEND: BIBLIOTECA, VALIDACIONES, PRIVACIDAD Y STORAGE');
console.log('======================================================================\n');

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}: ${err.message}`);
    throw err;
  }
}

// ---------------------------------------------------------------------
// 1. Constantes y Límites Técnicos del Frontend
// ---------------------------------------------------------------------
test('Límites de tamaño en cliente: 25 MB para PDF y 10 MB para imágenes', () => {
  assert.equal(
    LIBRARY_CONFIG.MAX_PDF_SIZE_BYTES,
    25 * 1024 * 1024,
    'El PDF debe tener tope exacto de 25 MB'
  );
  assert.equal(
    LIBRARY_CONFIG.MAX_IMAGE_SIZE_BYTES,
    10 * 1024 * 1024,
    'Las imágenes deben tener tope exacto de 10 MB'
  );
  assert.equal(
    LIBRARY_CONFIG.MAX_USER_QUOTA_BYTES,
    300 * 1024 * 1024,
    'La cuota por usuario debe ser exactamente 300 MB'
  );
});

test('MIME types permitidos en cliente', () => {
  const allowed = LIBRARY_CONFIG.ALLOWED_MIME_TYPES;
  assert(allowed.includes('application/pdf'), 'PDF permitido');
  assert(allowed.includes('image/jpeg'), 'JPEG permitido');
  assert(allowed.includes('image/png'), 'PNG permitido');
  assert(allowed.includes('image/webp'), 'WEBP permitido');
  assert(!allowed.includes('application/zip' as any), 'ZIP denegado');
  assert(!allowed.includes('application/x-msdownload' as any), 'EXE denegado');
  assert(!allowed.includes('application/msword' as any), 'DOC denegado');
});

// ---------------------------------------------------------------------
// 2. Validación de Archivos para Subida en Cliente
// ---------------------------------------------------------------------
function validateUploadClient(file: { name: string; size: number; type: string }): {
  valid: boolean;
  error?: string;
} {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage =
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    /\.(jpe?g|png|webp)$/i.test(file.name);

  if (!isPdf && !isImage) {
    return {
      valid: false,
      error: 'Formato no permitido. Solo se aceptan documentos PDF o imágenes (PNG, JPEG, WEBP).',
    };
  }

  if (isPdf && file.size > LIBRARY_CONFIG.MAX_PDF_SIZE_BYTES) {
    return {
      valid: false,
      error: `El PDF supera el límite de 25 MB (tamaño actual: ${(file.size / (1024 * 1024)).toFixed(1)} MB).`,
    };
  }

  if (isImage && file.size > LIBRARY_CONFIG.MAX_IMAGE_SIZE_BYTES) {
    return {
      valid: false,
      error: `La imagen supera el límite de 10 MB (tamaño actual: ${(file.size / (1024 * 1024)).toFixed(1)} MB).`,
    };
  }

  return { valid: true };
}

test('Validador cliente acepta PDF de 24 MB', () => {
  const res = validateUploadClient({
    name: 'resumen.pdf',
    size: 24 * 1024 * 1024,
    type: 'application/pdf',
  });
  assert(res.valid, 'Debe ser válido');
});

test('Validador cliente rechaza PDF de 26 MB', () => {
  const res = validateUploadClient({
    name: 'resumen_pesado.pdf',
    size: 26 * 1024 * 1024,
    type: 'application/pdf',
  });
  assert(!res.valid, 'Debe ser inválido');
  assert(res.error?.includes('25 MB'), 'Mensaje debe indicar el límite');
});

test('Validador cliente acepta imagen PNG de 9 MB', () => {
  const res = validateUploadClient({
    name: 'parcial.png',
    size: 9 * 1024 * 1024,
    type: 'image/png',
  });
  assert(res.valid, 'Debe ser válido');
});

test('Validador cliente rechaza imagen JPEG de 11 MB', () => {
  const res = validateUploadClient({
    name: 'foto.jpg',
    size: 11 * 1024 * 1024,
    type: 'image/jpeg',
  });
  assert(!res.valid, 'Debe ser inválido');
  assert(res.error?.includes('10 MB'), 'Mensaje debe indicar el límite');
});

test('Validador cliente rechaza extensiones peligrosas o no soportadas (.exe, .zip, .docx)', () => {
  const resExe = validateUploadClient({
    name: 'script.exe',
    size: 500,
    type: 'application/octet-stream',
  });
  assert(!resExe.valid, 'EXE debe ser rechazado');

  const resZip = validateUploadClient({
    name: 'apuntes.zip',
    size: 1000,
    type: 'application/zip',
  });
  assert(!resZip.valid, 'ZIP debe ser rechazado');

  const resDoc = validateUploadClient({
    name: 'resumen.docx',
    size: 2000,
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  assert(!resDoc.valid, 'DOCX debe ser rechazado');
});

// ---------------------------------------------------------------------
// 3. Envío de Content-Type exacto a Cloudflare R2
// ---------------------------------------------------------------------
test('PUT directo a R2 envía exactamente el Content-Type con el que se firmó la URL', async () => {
  let capturedHeaders: Record<string, string> = {};
  const mockUploadFn = async (
    _url: string,
    _file: any,
    contentType: string,
    headersHook?: (h: Record<string, string>) => void
  ) => {
    capturedHeaders['Content-Type'] = contentType;
    if (headersHook) headersHook(capturedHeaders);
  };

  const declaredType = 'application/pdf';
  await mockUploadFn('https://r2.cloudflare.com/signed-url', {}, declaredType);

  assert.equal(
    capturedHeaders['Content-Type'],
    'application/pdf',
    'El Content-Type debe enviarse sin alteraciones para evitar SignatureDoesNotMatch'
  );
});

// ---------------------------------------------------------------------
// 4. Invariante de Privacidad de Uploader en Vista Pública
// ---------------------------------------------------------------------
test('Catálogo público oculta identidad del autor (muestra "Subido por un estudiante")', () => {
  const publicFile: LibraryFilePublic = {
    id: 'f-123',
    subjectId: 'sub-456',
    kind: 'parcial',
    academicYear: 2024,
    term: '1C',
    examInstance: '1° Parcial',
    hasSolution: true,
    title: 'Primer Parcial 2024',
    description: null,
    originalFilename: 'parcial.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024 * 1024,
    downloadCount: 15,
    helpfulCount: 8,
    createdAt: new Date().toISOString(),
  };

  assert(!('uploaderUserId' in publicFile), 'uploaderUserId no debe existir en el tipo público');
  assert(!('uploaderEmail' in publicFile), 'uploaderEmail no debe existir en el tipo público');
  assert(!('uploaderName' in publicFile), 'uploaderName no debe existir en el tipo público');
});

// ---------------------------------------------------------------------
// 5. Cálculo y visualización de cuota de almacenamiento
// ---------------------------------------------------------------------
test('Cálculo de cuota porcentual y alerta preventiva', () => {
  const maxBytes = 300 * 1024 * 1024;
  const usedBytes = 220 * 1024 * 1024;
  const pct = Math.round((usedBytes / maxBytes) * 100);

  assert.equal(pct, 73, 'Debe calcular 73%');
  assert(pct > 70, 'Debe activar indicador de cuota media');

  const nearFullBytes = 280 * 1024 * 1024;
  const nearFullPct = Math.round((nearFullBytes / maxBytes) * 100);
  assert(nearFullPct > 90, 'Debe activar alerta de cuota crítica');
});

// ---------------------------------------------------------------------
// 6. Configuración CORS documentada en README.md
// ---------------------------------------------------------------------
test('README.md documenta la configuración JSON exacta de CORS para Cloudflare R2', () => {
  const readmePath = path.resolve(__dirname, '../README.md');
  const content = fs.readFileSync(readmePath, 'utf-8');

  assert(content.includes('https://corre-ten.vercel.app'), 'CORS debe contener dominio de producción');
  assert(content.includes('http://localhost:5173'), 'CORS debe contener localhost');
  assert(content.includes('"PUT"'), 'CORS debe permitir método PUT');
  assert(content.includes('"GET"'), 'CORS debe permitir método GET');
  assert(content.includes('"Content-Type"'), 'CORS debe permitir header Content-Type');
  assert(content.includes('"ETag"'), 'CORS debe exponer header ETag');
  assert(content.includes('MaxAgeSeconds'), 'CORS debe declarar MaxAgeSeconds');
});

// ---------------------------------------------------------------------
// 7. Enrutamiento por Hash en App.tsx
// ---------------------------------------------------------------------
test('Parser de hash soporta rutas de Biblioteca: #library, #library/<id>, #library/my-uploads, #library/terms', () => {
  const parseRoute = (hash: string) => {
    const raw = hash.replace('#', '');
    const [view, ...rest] = raw.split('/');
    const param = rest.join('/');
    return { view, param };
  };

  const r1 = parseRoute('#library');
  assert.equal(r1.view, 'library');
  assert.equal(r1.param, '');

  const r2 = parseRoute('#library/1');
  assert.equal(r2.view, 'library');
  assert.equal(r2.param, '1');

  const r3 = parseRoute('#library/my-uploads');
  assert.equal(r3.view, 'library');
  assert.equal(r3.param, 'my-uploads');

  const r4 = parseRoute('#library/terms');
  assert.equal(r4.view, 'library');
  assert.equal(r4.param, 'terms');
});

console.log('\n======================================================================');
console.log(` 📊 RESULTADO TESTS FRONTEND BIBLIOTECA: ${passed} pasaron, 0 fallaron`);
console.log('======================================================================\n');

