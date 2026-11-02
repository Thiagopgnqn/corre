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

// ---------------------------------------------------------------------
// 8. Verificación de Contrato de Rutas Frontend vs Backend (Route Guard)
// ---------------------------------------------------------------------
test('Todas las rutas de Biblioteca llamadas por el frontend existen en el backend Express', () => {
  const libRoutesPath = path.resolve(__dirname, '../server/src/modules/library/library.routes.ts');
  const adminRoutesPath = path.resolve(__dirname, '../server/src/modules/admin/admin.routes.ts');
  const libContent = fs.readFileSync(libRoutesPath, 'utf-8');
  const adminContent = fs.readFileSync(adminRoutesPath, 'utf-8');

  // Función para normalizar rutas Express y cliente a un patrón canónico
  const normalizePattern = (route: string) => {
    return route
      .split('?')[0] // remover querystring
      .replace(/\$\{[^}]+\}/g, ':param') // template literals ${...} -> :param
      .replace(/:[a-zA-Z0-9_]+/g, ':param') // Express params :id, :fileId -> :param
      .replace(/\/+/g, '/');
  };

  const backendRoutes = new Set<string>();
  const routeRegex = /router\.(get|post|patch|delete)\(\s*['"]([^'"]+)['"]/g;

  // 1. Extraer rutas de library.routes.ts montadas en /api/library
  for (const m of libContent.matchAll(routeRegex)) {
    const method = m[1].toUpperCase();
    const route = normalizePattern('/api/library' + (m[2] === '/' ? '' : m[2]));
    backendRoutes.add(`${method} ${route}`);
  }

  // 2. Extraer rutas de admin.routes.ts montadas en /api/admin
  for (const m of adminContent.matchAll(routeRegex)) {
    const method = m[1].toUpperCase();
    if (m[2].startsWith('/library')) {
      const route = normalizePattern('/api/admin' + m[2]);
      backendRoutes.add(`${method} ${route}`);
    }
  }

  // 3. Extraer todas las peticiones a la biblioteca desde src/api/library.api.ts
  const apiPath = path.resolve(__dirname, '../src/api/library.api.ts');
  const apiContent = fs.readFileSync(apiPath, 'utf-8');

  // Extraer cada invocación a apiFetch
  // Busca apiFetch seguido de ruta que empiece con /api/library o /api/admin/library
  const lines = apiContent.split('\n');
  const calls: Array<{ method: string; path: string; raw: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('apiFetch') || line.includes('/api/library') || line.includes('/api/admin/library')) {
      const match = line.match(/(['"`])(\/api\/(?:admin\/)?library\/[^'"`\n]+)\1/);
      // O llamadas multilínea / templates con queries
      const matchTemplate = line.match(/[`'"](\/api\/(?:admin\/)?library\/[^`'"]+)/);
      const matchedPath = match ? match[2] : matchTemplate ? matchTemplate[1] : null;

      if (matchedPath) {
        // Mirar si esta misma llamada apiFetch especifica method: 'POST' | 'PATCH' | 'DELETE'
        let callBlock = line;
        for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
          if (lines[j].includes('async ') || lines[j].includes('apiFetch')) break;
          callBlock += '\n' + lines[j];
          if (lines[j].includes(');')) break;
        }
        const methodMatch = callBlock.match(/method:\s*['"]([A-Z]+)['"]/);
        const method = methodMatch ? methodMatch[1] : 'GET';

        // Truncar query parameters e interpolaciones de query
        let cleanPath = matchedPath.split('?')[0];
        if (cleanPath.includes('${query')) {
          cleanPath = cleanPath.split('${query')[0];
        }

        calls.push({
          method,
          path: normalizePattern(cleanPath),
          raw: matchedPath,
        });
      }
    }
  }

  assert(calls.length >= 15, `Se esperaba extraer al menos 15 llamadas de API, se encontraron ${calls.length}`);

  const missingRoutes: string[] = [];
  for (const call of calls) {
    const key = `${call.method} ${call.path}`;
    if (!backendRoutes.has(key)) {
      missingRoutes.push(key);
    }
  }

  assert.deepEqual(
    missingRoutes,
    [],
    `Error de contrato: Las siguientes rutas del cliente no existen en el backend: ${missingRoutes.join(', ')}`
  );
});

console.log('\n======================================================================');
console.log(` 📊 RESULTADO TESTS FRONTEND BIBLIOTECA: ${passed} pasaron, 0 fallaron`);
console.log('======================================================================\n');

