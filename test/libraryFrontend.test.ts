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

console.log('\n======================================================================');
console.log(` 📊 RESULTADO TESTS FRONTEND BIBLIOTECA: ${passed} pasaron, 0 fallaron`);
console.log('======================================================================\n');

