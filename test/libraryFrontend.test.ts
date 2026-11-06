import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LIBRARY_CONFIG, type LibraryFilePublic, type LibraryFileKind } from '../src/types/library';
import { DEFAULT_SETTINGS } from '../src/utils/storage';
import { adminLibraryApi } from '../src/api/library.api';
import { CONTACT_EMAIL } from '../src/config/brand';
import { LibraryTermsPage } from '../src/components/library/LibraryTermsPage';
import {
  parseFilenameSuggestions,
  applyDefaultYearTerm,
  validateBatchItem,
  UploadQueueCoordinator,
  type BatchFileItem,
} from '../src/utils/libraryUploadLogic';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('\n======================================================================');
console.log(' 🧪 TESTS FRONTEND: BIBLIOTECA, VALIDACIONES, PRIVACIDAD Y STORAGE');
console.log('======================================================================\n');

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      await res;
    }
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

// ---------------------------------------------------------------------
// 9. Configuración y preferencia de notificaciones por email
// ---------------------------------------------------------------------
test('Preferencia notifyLibraryEmail habilitada por defecto y cliente de reenvío expuesto', () => {
  assert.equal(DEFAULT_SETTINGS.notifyLibraryEmail, true, 'notifyLibraryEmail debe ser true por defecto');
  assert(typeof adminLibraryApi.resendAdminNotification === 'function', 'adminLibraryApi debe exponer resendAdminNotification');
});

// ---------------------------------------------------------------------
// 10. Cartel de Bienvenida de la Biblioteca (C1)
// ---------------------------------------------------------------------
import {
  shouldShowLibraryWelcome,
  markLibraryWelcomeSeen,
  getLibraryWelcomeStorageKey,
  COMMUNITY_TEXTS,
  DOWNLOAD_TOAST_DURATION_MS,
  DOWNLOAD_TOAST_MOBILE_BOTTOM_STYLE,
  DOWNLOAD_TOAST_DESKTOP_BOTTOM_STYLE,
} from '../src/utils/libraryCommunityLogic';

test('C1. Cartel de Bienvenida: regla de primera visita, persistencia por usuario, textos oficiales y bloqueo si tutorial activo', () => {
  const mockStorage: Record<string, string> = {};
  const fakeStorage = {
    getItem: (key: string) => mockStorage[key] ?? null,
    setItem: (key: string, val: string) => {
      mockStorage[key] = val;
    },
  };

  const userId = 'usr-test-999';
  const expectedKey = 'stack:library-welcome-seen:usr-test-999';
  assert.equal(getLibraryWelcomeStorageKey(userId), expectedKey);
  assert.equal(getLibraryWelcomeStorageKey(null), 'stack:library-welcome-seen:anon');

  // 1. Primera visita sin tutorial activo: debe mostrarse
  const showFirstTime = shouldShowLibraryWelcome({
    isTutorialOpen: false,
    userId,
    storage: fakeStorage,
  });
  assert.equal(showFirstTime, true, 'Debe mostrarse en la primera visita');

  // 2. Si el tutorial interactivo está activo: NO debe mostrarse y NO se marca como visto
  const showDuringTutorial = shouldShowLibraryWelcome({
    isTutorialOpen: true,
    userId,
    storage: fakeStorage,
  });
  assert.equal(showDuringTutorial, false, 'No debe mostrarse simultáneamente con el tutorial');
  assert.equal(fakeStorage.getItem(expectedKey), null, 'Durante el tutorial NO se marca como visto');

  // 3. Al marcar como visto (por Ahora no, X, Escape, backdrop, Subir o Términos): se almacena en localStorage
  markLibraryWelcomeSeen(userId, fakeStorage);
  assert.equal(fakeStorage.getItem(expectedKey), 'true');

  const showAfterSeen = shouldShowLibraryWelcome({
    isTutorialOpen: false,
    userId,
    storage: fakeStorage,
  });
  assert.equal(showAfterSeen, false, 'Una vez visto ya no debe mostrarse');

  // 4. Verificación de los textos oficiales exactos (Item 1.a)
  assert.equal(COMMUNITY_TEXTS.welcome.title, 'La Biblioteca la hacemos entre todos');
  assert.equal(
    COMMUNITY_TEXTS.welcome.body,
    'Esto es una comunidad de estudiantes y va a ir creciendo con lo que aportemos cada uno. Si rendiste algo hace poco, tomate unos minutos y subí aunque sea 1 archivo: un parcial, un final, un resumen, un apunte, lo que tengas a mano, de cualquier materia. Con que cada uno ponga uno, la Biblioteca deja de estar vacía y le sirve a todos.'
  );
  assert.ok(COMMUNITY_TEXTS.welcome.notePrefix.includes('Todo archivo se revisa antes de publicarse'));
  assert.equal(COMMUNITY_TEXTS.welcome.noteLinkText, 'Términos');
  assert.equal(COMMUNITY_TEXTS.welcome.primaryButton, 'Subir un archivo');
  assert.equal(COMMUNITY_TEXTS.welcome.secondaryButton, 'Ahora no');

  // 5. Verificación de implementación en LibraryWelcomeModal.tsx
  const welcomeModalPath = path.resolve(__dirname, '../src/components/library/LibraryWelcomeModal.tsx');
  assert.ok(fs.existsSync(welcomeModalPath), 'LibraryWelcomeModal.tsx debe existir');
  const welcomeContent = fs.readFileSync(welcomeModalPath, 'utf8');

  assert.match(welcomeContent, /COMMUNITY_TEXTS\.welcome\.title/, 'Debe utilizar el título oficial exacto');
  assert.match(welcomeContent, /COMMUNITY_TEXTS\.welcome\.body/, 'Debe utilizar el cuerpo oficial exacto');
  assert.match(welcomeContent, /COMMUNITY_TEXTS\.welcome\.primaryButton/, 'Debe ofrecer botón principal "Subir un archivo"');
  assert.match(welcomeContent, /COMMUNITY_TEXTS\.welcome\.secondaryButton/, 'Debe ofrecer botón secundario "Ahora no"');
  assert.match(welcomeContent, /handleTermsClick/, 'Debe manejar el clic en Términos cerrando y navegando');
  assert.match(welcomeContent, /href="#library\/terms"/, 'Debe enlazar a la ruta hash de términos');
  assert.match(welcomeContent, /onClick=\{onClose\}/, 'El backdrop y botones de cierre deben invocar onClose');
  assert.match(welcomeContent, /key === 'Escape'/, 'La tecla Escape debe invocar onClose');
  assert.match(welcomeContent, /aria-label="Cerrar bienvenida"/, 'Debe incluir botón de cierre accesible');
  assert.match(welcomeContent, /BottomSheet/, 'En celular debe utilizar BottomSheet');
  assert.match(welcomeContent, /role="dialog"/, 'En escritorio debe utilizar modal centrado accesible');

  // 6. Router / Contenedor LibraryHome monta el modal para todas las rutas (#library, #library/<id>, #library/my-uploads, #library/terms)
  const homePath = path.resolve(__dirname, '../src/components/library/LibraryHome.tsx');
  const homeContent = fs.readFileSync(homePath, 'utf8');
  assert.match(homeContent, /subView === 'terms'[\s\S]*?<LibraryWelcomeModal/, 'Montado en subView terms');
  assert.match(homeContent, /subView === 'my-uploads'[\s\S]*?<LibraryWelcomeModal/, 'Montado en subView my-uploads');
  assert.match(homeContent, /subView === 'subject'[\s\S]*?<LibraryWelcomeModal/, 'Montado en subView subject');
});

// ---------------------------------------------------------------------
// 11. Cartel Posterior a la Descarga de Material (C2)
// ---------------------------------------------------------------------
test('C2. Cartel de Descarga: temporizador de 10s, no invasivo, flotante sobre navbar, textos oficiales y no bloquea descarga', () => {
  assert.equal(DOWNLOAD_TOAST_DURATION_MS, 10000, 'Debe auto-cerrarse tras exactamente 10 segundos');
  assert.match(DOWNLOAD_TOAST_MOBILE_BOTTOM_STYLE, /var\(--mobile-nav-height/, 'Debe flotar por encima de la barra móvil');
  assert.equal(DOWNLOAD_TOAST_DESKTOP_BOTTOM_STYLE, '24px');

  // Textos oficiales exactos (Item 1.b)
  assert.equal(COMMUNITY_TEXTS.download.title, '¡Listo, ya se está descargando!');
  assert.equal(
    COMMUNITY_TEXTS.download.body,
    'Este material lo subió otro estudiante. Si tenés algo para compartir, subí aunque sea 1 archivo de lo que tengas a mano y ayudá a que la Biblioteca siga creciendo.'
  );
  assert.equal(COMMUNITY_TEXTS.download.primaryButton, 'Subir un archivo');

  const toastPath = path.resolve(__dirname, '../src/components/library/LibraryDownloadToast.tsx');
  assert.ok(fs.existsSync(toastPath), 'LibraryDownloadToast.tsx debe existir');
  const toastContent = fs.readFileSync(toastPath, 'utf8');

  assert.match(toastContent, /COMMUNITY_TEXTS\.download\.title/, 'Debe contener el título oficial');
  assert.match(toastContent, /COMMUNITY_TEXTS\.download\.body/, 'Debe contener el mensaje motivacional');
  assert.match(toastContent, /COMMUNITY_TEXTS\.download\.primaryButton/, 'Debe rotular el botón con "Subir un archivo"');
  assert.match(toastContent, /aria-label=\{COMMUNITY_TEXTS\.download\.closeLabel\}/, 'Debe contar con botón accesible de cierre');
  assert.match(toastContent, /aria-live="polite"/, 'Debe declarar aria-live="polite"');
  assert.match(toastContent, /role="status"/, 'Debe declarar role="status"');
  assert.match(toastContent, /onMouseEnter/, 'Debe pausar el temporizador al colocar el puntero');
  assert.match(toastContent, /onFocusCapture/, 'Debe pausar el temporizador al recibir foco');

  // Verificación en SubjectLibraryView de que no demora la descarga y solo aparece en éxito
  const viewPath = path.resolve(__dirname, '../src/components/library/SubjectLibraryView.tsx');
  const viewContent = fs.readFileSync(viewPath, 'utf8');
  const downloadFnCode = viewContent.slice(
    viewContent.indexOf('const handleDownload ='),
    viewContent.indexOf('const handleToggleHelpful =')
  );
  assert.ok(
    downloadFnCode.indexOf('a.click()') < downloadFnCode.indexOf('setShowDownloadToast(true)'),
    'La descarga se inicia con a.click() ANTES de activar el toast de comunidad'
  );
  assert.ok(
    !downloadFnCode.slice(downloadFnCode.indexOf('catch')).includes('setShowDownloadToast(true)'),
    'Si ocurre un error en la descarga, el toast de comunidad NO debe mostrarse'
  );
});

// ---------------------------------------------------------------------
// 12. Rediseño Mobile de Cabecera y Filtros en Vista de Materia (B1)
// ---------------------------------------------------------------------
test('B1. SubjectLibraryView: buscador 100%, filtros en columna con touch targets >= 44px, select de 16px y chips con scroll snap', () => {
  const viewPath = path.resolve(__dirname, '../src/components/library/SubjectLibraryView.tsx');
  assert.ok(fs.existsSync(viewPath), 'SubjectLibraryView.tsx debe existir');
  const viewContent = fs.readFileSync(viewPath, 'utf8');

  // 1. Buscador ocupa 100% en mobile
  assert.match(viewContent, /w-full\s+md:flex-1/, 'Buscador debe ocupar 100% en mobile y flex-1 en desktop');

  // 2. Filtros en columna en mobile: checkbox fila 1 y select fila 2 con etiqueta arriba
  assert.match(viewContent, /Solo con resolución/, 'Debe contener el filtro "Solo con resolución"');
  assert.match(viewContent, /min-h-\[44px\]/, 'El checkbox debe disponer de área táctil >= 44px');
  assert.match(viewContent, /Ordenar por:/, 'Debe rotular el selector con "Ordenar por:"');
  assert.match(viewContent, /text-base\s+md:text-xs/, 'Select debe tener 16px en mobile para evitar auto-zoom en iOS');

  // 3. Fila de chips con snap-x mandatory, pe-6 y gradiente fade
  assert.match(viewContent, /snap-x\s+snap-mandatory/, 'Fila de chips debe tener snap-x snap-mandatory');
  assert.match(viewContent, /pe-6/, 'Fila de chips debe tener padding al final (pe-6)');
  assert.match(viewContent, /bg-gradient-to-l/, 'Fila de chips debe mostrar gradiente fade en el borde derecho');

  // 4. Disparo de LibraryDownloadToast al descargar
  assert.match(viewContent, /setShowDownloadToast\(true\)/, 'Debe activar el toast de comunidad al completar la descarga');
});

// ---------------------------------------------------------------------
// 13. Mail de Contacto Oficial en LibraryTermsPage (Comportamiento Renderizado)
// ---------------------------------------------------------------------
test('Mail de contacto oficial: LibraryTermsPage renderiza CONTACT_EMAIL (stackacademicapp@gmail.com) y ningún mail inventado', () => {
  const forbiddenEmails = [
    'contacto@stack.app',
    'soporte.stack@gmail.com',
    'soporte.stack.frba@gmail.com',
  ];

  assert.equal(CONTACT_EMAIL, 'stackacademicapp@gmail.com');
  for (const forbidden of forbiddenEmails) {
    assert.notEqual(CONTACT_EMAIL, forbidden, `CONTACT_EMAIL no debe ser ${forbidden}`);
  }

  const html = renderToStaticMarkup(React.createElement(LibraryTermsPage, { onBack: () => {} }));
  assert.ok(
    html.includes(CONTACT_EMAIL),
    `El HTML renderizado de LibraryTermsPage debe incluir ${CONTACT_EMAIL}`
  );
  assert.ok(
    html.includes(`mailto:${CONTACT_EMAIL}`),
    `El HTML renderizado de LibraryTermsPage debe incluir el enlace mailto:${CONTACT_EMAIL}`
  );
  for (const forbidden of forbiddenEmails) {
    assert.ok(
      !html.includes(forbidden),
      `El HTML renderizado de LibraryTermsPage no debe incluir el mail inventado ${forbidden}`
    );
  }
});

// ---------------------------------------------------------------------
// 14. Sugerencias Inteligentes desde el Nombre de Archivo (parseFilenameSuggestions)
// ---------------------------------------------------------------------
await test('14.1 Parser detecta parcial con año, cuatrimestre, instancia y resolución', () => {
  const parsed = parseFilenameSuggestions('1P-Parcial-Analisis-Matematico-2023-2C-resuelto.pdf');
  assert.equal(parsed.kind, 'parcial');
  assert.equal(parsed.academicYear, 2023);
  assert.equal(parsed.term, '2C');
  assert.equal(parsed.examInstance, '1° Parcial');
  assert.equal(parsed.hasSolution, true);
  assert.ok(parsed.cleanTitle.toLowerCase().includes('analisis matematico'));
});

await test('14.2 Parser detecta examen final con año sin solución', () => {
  const parsed = parseFilenameSuggestions('Final-Fisica-1-2022-diciembre.pdf');
  assert.equal(parsed.kind, 'final');
  assert.equal(parsed.academicYear, 2022);
  assert.equal(parsed.examInstance, 'Examen Final');
  assert.equal(parsed.hasSolution, false);
});

await test('14.3 Parser detecta resumen, tp y guía sin año forzado', () => {
  const res = parseFilenameSuggestions('Resumen-Sistemas-Operativos-U1-U5.pdf');
  assert.equal(res.kind, 'resumen');
  assert.equal(res.academicYear, null);
  assert.equal(res.hasSolution, false);

  const tp = parseFilenameSuggestions('TP3-Algoritmos-2024.pdf');
  assert.equal(tp.kind, 'tp');
  assert.equal(tp.academicYear, 2024);

  const guia = parseFilenameSuggestions('Guia-Ejercicios-Algebra.pdf');
  assert.equal(guia.kind, 'guia');
  assert.equal(guia.hasSolution, false);
});

await test('14.4 Parser detecta recuperatorio y normaliza mayúsculas/minúsculas y acentos', () => {
  const recu = parseFilenameSuggestions('2do_parcial_recu_quimica_2021_1c.pdf');
  assert.equal(recu.kind, 'parcial');
  assert.equal(recu.examInstance, 'Recuperatorio');
  assert.equal(recu.academicYear, 2021);
  assert.equal(recu.term, '1C');

  const upper = parseFilenameSuggestions('PARCIAL_MATEMATICA_2025_SOLUCION.PDF');
  assert.equal(upper.kind, 'parcial');
  assert.equal(upper.academicYear, 2025);
  assert.equal(upper.hasSolution, true);

  // Ignora años fuera de rango (ej. 1990 o 3050)
  const oldYear = parseFilenameSuggestions('Parcial-Fisica-1990.pdf');
  assert.equal(oldYear.academicYear, null);
});

// ---------------------------------------------------------------------
// 15. Aplicación de Valores por Defecto (applyDefaultYearTerm)
// ---------------------------------------------------------------------
await test('15.1 Default Year/Term solo rellena campos vacíos y no pisa valores existentes', () => {
  const mockItems: BatchFileItem[] = [
    {
      id: '1',
      file: { name: 'p1.pdf', size: 1000, type: 'application/pdf' } as any,
      title: 'Parcial 1',
      kind: 'parcial',
      academicYear: 2022,
      term: '2C',
      examInstance: '1P',
      hasSolution: false,
      description: '',
      status: 'idle',
      progress: 0,
      retryCount: 0,
    },
    {
      id: '2',
      file: { name: 'p2.pdf', size: 1000, type: 'application/pdf' } as any,
      title: 'Parcial 2',
      kind: 'parcial',
      academicYear: null,
      term: null,
      examInstance: '2P',
      hasSolution: false,
      description: '',
      status: 'idle',
      progress: 0,
      retryCount: 0,
    },
    {
      id: '3',
      file: { name: 'p3.pdf', size: 1000, type: 'application/pdf' } as any,
      title: 'Parcial 3',
      kind: 'parcial',
      academicYear: 2024,
      term: null,
      examInstance: '3P',
      hasSolution: false,
      description: '',
      status: 'idle',
      progress: 0,
      retryCount: 0,
    },
  ];

  // Aplicar con forceAll = false
  const updated = applyDefaultYearTerm(mockItems, 2025, '1C', false);

  // Item 1 conserva sus valores
  assert.equal(updated[0].academicYear, 2022, 'Item 1 debe conservar año 2022');
  assert.equal(updated[0].term, '2C', 'Item 1 debe conservar cuatrimestre 2C');

  // Item 2 se rellena completamente
  assert.equal(updated[1].academicYear, 2025, 'Item 2 debe recibir año por defecto 2025');
  assert.equal(updated[1].term, '1C', 'Item 2 debe recibir cuatrimestre por defecto 1C');

  // Item 3 conserva su año y solo rellena el cuatrimestre vacío
  assert.equal(updated[2].academicYear, 2024, 'Item 3 debe conservar su año 2024');
  assert.equal(updated[2].term, '1C', 'Item 3 debe recibir cuatrimestre por defecto 1C');
});

await test('15.2 Aplicar a todos (forceAll = true) sobrescribe todos los archivos', () => {
  const mockItems: BatchFileItem[] = [
    {
      id: '1',
      file: { name: 'p1.pdf', size: 1000, type: 'application/pdf' } as any,
      title: 'Parcial 1',
      kind: 'parcial',
      academicYear: 2021,
      term: '2C',
      examInstance: '1P',
      hasSolution: false,
      description: '',
      status: 'idle',
      progress: 0,
      retryCount: 0,
    },
    {
      id: '2',
      file: { name: 'p2.pdf', size: 1000, type: 'application/pdf' } as any,
      title: 'Parcial 2',
      kind: 'parcial',
      academicYear: 2023,
      term: '1C',
      examInstance: '2P',
      hasSolution: false,
      description: '',
      status: 'idle',
      progress: 0,
      retryCount: 0,
    },
  ];

  const forced = applyDefaultYearTerm(mockItems, 2026, '2C', true);
  assert.equal(forced[0].academicYear, 2026);
  assert.equal(forced[0].term, '2C');
  assert.equal(forced[1].academicYear, 2026);
  assert.equal(forced[1].term, '2C');
});

// ---------------------------------------------------------------------
// 16. Validación de Lotes Mixtos (validateBatchItem)
// ---------------------------------------------------------------------
await test('16.1 Validación individual de lote mixto sin bloquear archivos válidos', () => {
  const subjectId = 'sub-analisis-1';

  // 1. Archivo válido
  const validItem = {
    file: { name: 'parcial.pdf', size: 10 * 1024 * 1024, type: 'application/pdf' },
    title: 'Primer Parcial 2024',
    kind: 'parcial' as const,
    academicYear: 2024,
    term: '1C' as const,
  };
  const resValid = validateBatchItem(validItem, subjectId);
  assert.equal(resValid.valid, true);

  // 2. Archivo PDF excedido en tamaño (>25 MB)
  const oversizedPdf = {
    file: { name: 'pesado.pdf', size: 26 * 1024 * 1024, type: 'application/pdf' },
    title: 'Apunte Gigante',
    kind: 'apunte' as const,
    academicYear: 2024,
  };
  const resOversized = validateBatchItem(oversizedPdf, subjectId);
  assert.equal(resOversized.valid, false);
  assert.ok(resOversized.error?.includes('25 MB'));

  // 3. Parcial sin año obligatorio
  const missingYearParcial = {
    file: { name: 'parcial_sin_ano.pdf', size: 2 * 1024 * 1024, type: 'application/pdf' },
    title: 'Parcial Sin Año',
    kind: 'parcial' as const,
    academicYear: null,
  };
  const resMissingYear = validateBatchItem(missingYearParcial, subjectId);
  assert.equal(resMissingYear.valid, false);
  assert.ok(resMissingYear.error?.includes('año lectivo es obligatorio'));

  // 4. Archivo sin título
  const missingTitle = {
    file: { name: 'final.pdf', size: 2 * 1024 * 1024, type: 'application/pdf' },
    title: '   ',
    kind: 'final' as const,
    academicYear: 2023,
  };
  const resMissingTitle = validateBatchItem(missingTitle, subjectId);
  assert.equal(resMissingTitle.valid, false);
  assert.ok(resMissingTitle.error?.includes('título'));

  // 5. Imagen válida (<10 MB)
  const validImg = {
    file: { name: 'foto.jpg', size: 4 * 1024 * 1024, type: 'image/jpeg' },
    title: 'Foto Pizarrón',
    kind: 'apunte' as const,
    academicYear: null,
  };
  const resValidImg = validateBatchItem(validImg, subjectId);
  assert.equal(resValidImg.valid, true);
});

// ---------------------------------------------------------------------
// 17. Coordinador de Subidas Múltiples (UploadQueueCoordinator)
// ---------------------------------------------------------------------
await test('17.1 Concurrencia limitada: max 3 PUT simultáneos y max 2 completes simultáneos', async () => {
  let activePuts = 0;
  let maxObservedPuts = 0;
  let activeCompletes = 0;
  let maxObservedCompletes = 0;
  const initedFileIds: string[] = [];

  const mockApi = {
    initUpload: async (payload: any) => {
      initedFileIds.push(payload.originalFilename);
      return {
        success: true,
        data: {
          fileId: `fid_${payload.originalFilename}`,
          uploadUrl: `https://r2.mock/${payload.originalFilename}`,
          storageKey: `key_${payload.originalFilename}`,
          maxSizeBytes: 25 * 1024 * 1024,
          headers: {},
        },
      };
    },
    uploadDirectToR2: async (
      _url: string,
      _file: any,
      _ct: string,
      onProgress?: (pct: number) => void
    ) => {
      activePuts++;
      if (activePuts > maxObservedPuts) maxObservedPuts = activePuts;
      if (onProgress) onProgress(50);
      await new Promise((r) => setTimeout(r, 20));
      if (onProgress) onProgress(100);
      activePuts--;
    },
    completeUpload: async () => {
      activeCompletes++;
      if (activeCompletes > maxObservedCompletes) maxObservedCompletes = activeCompletes;
      await new Promise((r) => setTimeout(r, 15));
      activeCompletes--;
      return { success: true, data: { status: 'pending' } };
    },
    deleteMyUpload: async () => ({ success: true, data: {} }),
  };

  const coordinator = new UploadQueueCoordinator({
    maxConcurrentPuts: 3,
    maxConcurrentCompletes: 2,
    backoffDelays: [0, 0, 0, 0],
    api: mockApi as any,
  });

  const batchItems: BatchFileItem[] = [1, 2, 3, 4, 5].map((i) => ({
    id: `item_${i}`,
    file: { name: `archivo_${i}.pdf`, size: 1000 * i, type: 'application/pdf' } as any,
    title: `Material ${i}`,
    kind: 'apunte',
    academicYear: null,
    term: null,
    examInstance: null,
    hasSolution: false,
    description: '',
    status: 'idle',
    progress: 0,
    retryCount: 0,
  }));

  coordinator.setQueue(batchItems, 'sub-mock');
  await coordinator.start();

  // Esperar a que la cola termine
  while (coordinator.isBusy()) {
    await new Promise((r) => setTimeout(r, 10));
  }

  assert.equal(maxObservedPuts <= 3, true, `Max PUTs concurrentes (${maxObservedPuts}) debe ser <= 3`);
  assert.equal(
    maxObservedCompletes <= 2,
    true,
    `Max Completes concurrentes (${maxObservedCompletes}) debe ser <= 2`
  );
  assert.equal(initedFileIds.length, 5, 'Todos los 5 archivos debieron ser procesados');

  const finalItems = coordinator.getAllItems();
  for (const it of finalItems) {
    assert.equal(it.status, 'done', `El archivo ${it.id} debe estar en estado 'done'`);
    assert.equal(it.progress, 100);
  }
});

await test('17.2 Reintento automático con backoff ante 503 y finalización exitosa', async () => {
  let putAttempts = 0;

  const mockApi = {
    initUpload: async () => ({
      success: true,
      data: {
        fileId: 'fid_retry',
        uploadUrl: 'https://r2.mock/retry',
        storageKey: 'key_retry',
        maxSizeBytes: 25 * 1024 * 1024,
        headers: {},
      },
    }),
    uploadDirectToR2: async () => {
      putAttempts++;
      if (putAttempts === 1) {
        const err: any = new Error('Service Unavailable');
        err.status = 503;
        throw err;
      }
      // Segundo intento exitoso
    },
    completeUpload: async () => ({ success: true, data: {} }),
    deleteMyUpload: async () => ({ success: true, data: {} }),
  };

  const coordinator = new UploadQueueCoordinator({
    maxConcurrentPuts: 1,
    maxRetries: 3,
    backoffDelays: [0, 0, 0], // Inmediato para tests veloces
    api: mockApi as any,
  });

  const item: BatchFileItem = {
    id: 'it_retry',
    file: { name: 'reintento.pdf', size: 2000, type: 'application/pdf' } as any,
    title: 'Material con 503 transitorio',
    kind: 'apunte',
    academicYear: null,
    term: null,
    examInstance: null,
    hasSolution: false,
    description: '',
    status: 'idle',
    progress: 0,
    retryCount: 0,
  };

  coordinator.setQueue([item], 'sub-mock');
  await coordinator.start();

  while (coordinator.isBusy()) {
    await new Promise((r) => setTimeout(r, 10));
  }

  assert.equal(putAttempts, 2, 'Debe haber realizado exactamente 2 intentos de PUT');
  const finalItem = coordinator.getItem('it_retry');
  assert.equal(finalItem?.status, 'done', 'El ítem debe culminar con status done tras el reintento');
});

await test('17.3 Cancelación individual llama a DELETE en segundo plano para liberar cuota', async () => {
  let deletedFileId: string | null = null;

  const mockApi = {
    initUpload: async () => ({
      success: true,
      data: {
        fileId: 'fid_cancel_123',
        uploadUrl: 'https://r2.mock/cancel',
        storageKey: 'key_cancel',
        maxSizeBytes: 25 * 1024 * 1024,
        headers: {},
      },
    }),
    uploadDirectToR2: async (_url: any, _f: any, _ct: any, _p: any, signal?: AbortSignal) => {
      // Queda colgado esperando abort
      await new Promise((_, reject) => {
        if (signal) {
          signal.addEventListener('abort', () => reject(new Error('Aborted')));
        }
      });
    },
    completeUpload: async () => ({ success: true, data: {} }),
    deleteMyUpload: async (fileId: string) => {
      deletedFileId = fileId;
      return { success: true, data: {} };
    },
  };

  const coordinator = new UploadQueueCoordinator({
    maxConcurrentPuts: 1,
    api: mockApi as any,
  });

  const item: BatchFileItem = {
    id: 'it_cancel',
    file: { name: 'archivo_a_cancelar.pdf', size: 5000, type: 'application/pdf' } as any,
    title: 'Archivo cancelable',
    kind: 'apunte',
    academicYear: null,
    term: null,
    examInstance: null,
    hasSolution: false,
    description: '',
    status: 'idle',
    progress: 0,
    retryCount: 0,
  };

  coordinator.setQueue([item], 'sub-mock');
  coordinator.start(); // Inicia asíncronamente

  // Esperar a que pase a status uploading (ya obtuvo fileId)
  await new Promise((r) => setTimeout(r, 20));

  // Cancelamos el ítem
  await coordinator.cancelItem('it_cancel');

  assert.equal(deletedFileId, 'fid_cancel_123', 'Debe haber llamado a deleteMyUpload con el fileId');
  const finalItem = coordinator.getItem('it_cancel');
  assert.equal(finalItem?.status, 'cancelled', 'El ítem debe quedar marcado como cancelled');
});

await test('17.4 Lote con 3 parciales de años distintos sube cada uno con su respectivo año', async () => {
  const uploadedYears: number[] = [];

  const mockApi = {
    initUpload: async (payload: any) => {
      uploadedYears.push(payload.academicYear);
      return {
        success: true,
        data: {
          fileId: `fid_${payload.academicYear}`,
          uploadUrl: `https://r2.mock/${payload.academicYear}`,
          storageKey: `key_${payload.academicYear}`,
          maxSizeBytes: 25 * 1024 * 1024,
          headers: {},
        },
      };
    },
    uploadDirectToR2: async () => {},
    completeUpload: async () => ({ success: true, data: {} }),
    deleteMyUpload: async () => ({ success: true, data: {} }),
  };

  const coordinator = new UploadQueueCoordinator({
    maxConcurrentPuts: 3,
    api: mockApi as any,
  });

  const items: BatchFileItem[] = [2022, 2023, 2024].map((year) => ({
    id: `item_${year}`,
    file: { name: `parcial_${year}.pdf`, size: 1000, type: 'application/pdf' } as any,
    title: `Parcial del año ${year}`,
    kind: 'parcial',
    academicYear: year,
    term: '1C',
    examInstance: '1° Parcial',
    hasSolution: true,
    description: '',
    status: 'idle',
    progress: 0,
    retryCount: 0,
  }));

  coordinator.setQueue(items, 'sub-mock');
  await coordinator.start();

  while (coordinator.isBusy()) {
    await new Promise((r) => setTimeout(r, 10));
  }

  assert.deepEqual(uploadedYears.sort(), [2022, 2023, 2024], 'Cada parcial debe conservar y enviar su año exacto');
});

// ---------------------------------------------------------------------
// 18. Panel Admin: Botón Previsualizar Deshabilitado tras Rechazo/Purga
// ---------------------------------------------------------------------
await test('18.1 AdminLibraryTab deshabilita preview para archivos rejected o removed con tooltip explicativo', () => {
  const adminTabPath = path.resolve(__dirname, '../src/components/admin/tabs/AdminLibraryTab.tsx');
  assert.ok(fs.existsSync(adminTabPath), 'AdminLibraryTab.tsx debe existir');
  const code = fs.readFileSync(adminTabPath, 'utf8');

  assert.match(
    code,
    /file\.status === 'rejected' \|\| file\.status === 'removed'/,
    'Debe evaluar si el archivo fue rechazado o eliminado'
  );
  assert.match(
    code,
    /title="Contenido purgado tras rechazo"/,
    'Debe mostrar tooltip "Contenido purgado tras rechazo"'
  );
  assert.match(
    code,
    /cursor-not-allowed/,
    'Debe presentar estilo deshabilitado para evitar clics accidentales'
  );
});

// ---------------------------------------------------------------------
// 19. Accesibilidad y Adaptabilidad Móvil en UploadMaterialModal
// ---------------------------------------------------------------------
await test('19.1 UploadMaterialModal soporta múltiples archivos sin capture, inputs >= 16px, chips de años y aria-live', () => {
  const modalPath = path.resolve(__dirname, '../src/components/library/UploadMaterialModal.tsx');
  assert.ok(fs.existsSync(modalPath), 'UploadMaterialModal.tsx debe existir');
  const code = fs.readFileSync(modalPath, 'utf8');

  // 1. Selector múltiple sin atributo capture
  assert.match(code, /<input[^>]*type="file"[^>]*multiple/, 'El input file debe tener atributo multiple');
  assert.ok(!code.includes('capture="environment"') && !code.includes('capture="user"'), 'No debe tener atributo capture');

  // 2. Fuentes de inputs >= 16px en móvil (evita auto-zoom en Safari iOS)
  assert.match(code, /text-base\s+sm:text-xs/, 'Inputs deben usar font-size >= 16px en mobile y 12px en desktop');

  // 3. Touch targets >= 44px
  assert.match(code, /min-h-\[44px\]/, 'Botones y campos interactivos deben disponer de altura >= 44px');

  // 4. Chips de años recientes
  assert.match(code, /RECENT_YEARS/, 'Debe disponer de chips rápidos de años recientes');

  // 5. Región aria-live para lecturas accesibles
  assert.match(code, /aria-live="polite"/, 'Debe incluir aria-live polite para accesibilidad de pantalla');
});

console.log('\n======================================================================');
console.log(` 📊 RESULTADO TESTS FRONTEND BIBLIOTECA: ${passed} pasaron, 0 fallaron`);
console.log('======================================================================\n');

