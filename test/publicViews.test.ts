import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ActivePlanCatalog, Subject } from '../src/types/career.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

class MockStorage implements Storage {
  private map = new Map<string, string>();
  public readonly writtenKeys: string[] = [];

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.writtenKeys.push(key);
    this.map.set(key, String(value));
  }

  keys(): string[] {
    return Array.from(this.map.keys());
  }
}

// Registrar localStorage antes de importar módulos que transitivamente cargan CareerContext/audio.ts
const bootstrapStorage = new MockStorage();
if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: bootstrapStorage,
    writable: true,
    configurable: true,
  });
}

const {
  publicApi,
  loadPublicPlanCatalogSmart,
  writePublicSelectedPlanId,
  PUBLIC_CATALOG_CACHE_KEY_PREFIX,
  PUBLIC_SELECTED_PLAN_ID_KEY,
} = await import('../src/api/public.api.ts');
const { apiFetch } = await import('../src/api/client.ts');
const { AUTH_HINT_STORAGE_KEY, runInitialSessionCheck } = await import('../src/utils/authGate.ts');
const { SubjectNodeCard } = await import('../src/components/graph/SubjectNode.tsx');
const { SubjectListView } = await import('../src/components/graph/SubjectListView.tsx');
const {
  PublicReviewCardView,
  formatPublicAttendedPeriod,
  formatPublicReviewMonthYear,
} = await import('../src/components/professors/ProfessorDetailModal.tsx');
const {
  LibraryFileCardView,
  LIBRARY_FILES_PAGE_SIZE,
  mapPublicLibraryFileToCard,
} = await import('../src/components/library/SubjectLibraryView.tsx');
const { LibraryTermsPage } = await import('../src/components/library/LibraryTermsPage.tsx');
const { LoginPromptScreenView } = await import('../src/components/auth/LoginPromptScreen.tsx');
const { LoginPromptModalView } = await import('../src/components/auth/LoginPromptModal.tsx');

interface FetchCallRecord {
  url: string;
  method: string;
  credentials?: RequestCredentials;
  headers: Record<string, string>;
  status: number;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function withInstrumentedFetch(
  storage: Storage,
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
  fn: (calls: FetchCallRecord[]) => Promise<void>
): Promise<void> {
  const prevFetch = globalThis.fetch;
  const prevStorage = globalThis.localStorage;
  const calls: FetchCallRecord[] = [];

  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    writable: true,
    configurable: true,
  });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const rawHeaders = new Headers(init?.headers || {});
    const headers: Record<string, string> = {};
    rawHeaders.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const res = await handler(url, init);
    calls.push({
      url,
      method: (init?.method || 'GET').toUpperCase(),
      credentials: init?.credentials,
      headers,
      status: res.status,
    });
    return res;
  }) as typeof fetch;

  try {
    await fn(calls);
  } finally {
    globalThis.fetch = prevFetch;
    Object.defineProperty(globalThis, 'localStorage', {
      value: prevStorage,
      writable: true,
      configurable: true,
    });
  }
}

function makeSamplePlanCatalog(planId = 'plan-2023'): ActivePlanCatalog {
  return {
    career: {
      id: 'career-isi',
      name: 'Ingeniería en Sistemas',
      code: 'ISI',
      facultyCode: 'FRCU',
      institutionCode: 'UTN',
    },
    plan: {
      id: planId,
      name: 'Plan 2023',
      year: 2023,
      updatedAt: '2026-11-27T00:00:00.000Z',
      config: {
        requiredElectiveCredits: 20,
        defaultMinPassingGrade: 4,
        totalLevels: 5,
        levelLabel: 'Año',
        shortTag: 'Plan 2023',
      },
    },
    subjects: [
      {
        id: 101,
        uuid: 'sub-uuid-101',
        code: '101',
        name: 'Análisis Matemático I',
        shortName: 'AMI',
        level: 1,
        modality: 'A',
        contraCuatrimestral: false,
        weeklyHours: 5,
        isElective: false,
        kind: 'obligatoria',
        isOptionalTrack: false,
        regularPrereqs: [],
        approvedPrereqs: [],
      },
      {
        id: 201,
        uuid: 'sub-uuid-201',
        code: '201',
        name: 'Análisis Matemático II',
        shortName: 'AMII',
        level: 2,
        modality: 'A',
        contraCuatrimestral: false,
        weeklyHours: 5,
        isElective: false,
        kind: 'obligatoria',
        isOptionalTrack: false,
        regularPrereqs: [101],
        approvedPrereqs: [],
      },
    ],
    rules: [],
    acronyms: { AMI: 101, AMII: 201 },
  };
}

// ============================================================================
// (a) y (b) Red estrictamente pública, 0x401 y cero escrituras prohibidas en storage
// ============================================================================
test('(a)(b) Visitante recorre Mapa+Drawer, Profesores+Detalle y Biblioteca+Términos solo con GET /api/public/*, cero 401 y sin claves de usuario', async () => {
  const storage = new MockStorage();
  storage.setItem(AUTH_HINT_STORAGE_KEY, '0');
  storage.writtenKeys.length = 0;

  const catalog = makeSamplePlanCatalog('plan-2023');

  await withInstrumentedFetch(
    storage,
    async (url) => {
      if (url === '/api/public/catalog/version') {
        return jsonResponse({ success: true, version: 'v2023-1' });
      }
      if (url === '/api/public/catalog/plans/current' || url === '/api/public/catalog/plans/plan-2023') {
        return jsonResponse({ success: true, data: catalog });
      }
      if (url.startsWith('/api/public/library/subjects')) {
        return jsonResponse({
          success: true,
          data: [
            {
              id: 'sub-uuid-101',
              name: 'Análisis Matemático I',
              codeInPlan: 101,
              level: 1,
              kind: 'obligatoria',
              approvedFilesCount: 3,
            },
          ],
        });
      }
      if (url.startsWith('/api/public/professors/prof-1/reviews')) {
        return jsonResponse({
          success: true,
          data: { items: [], page: 1, pageSize: 10, total: 0, totalPages: 0 },
        });
      }
      if (url.startsWith('/api/public/professors/prof-1')) {
        return jsonResponse({
          success: true,
          data: {
            professor: {
              id: 'prof-1',
              displayName: 'García, Ana',
              normalizedKey: 'garcia ana',
              reviewCount: 0,
              hasReliableAverage: false,
              ratingStatus: 'sin_resenas',
              averageOverall: null,
              bayesianScore: null,
              averageClarity: null,
              averageTreatment: null,
              averageAvailability: null,
              averageDifficulty: null,
              recommendPercent: null,
              recommendCount: 0,
              recommendTotal: 0,
              distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
              subjects: [],
            },
            thresholds: {
              minReviewsForReliableAverage: 3,
              showProvisionalAverageBelowThreshold: true,
              minReviewsToShowAttendedPeriod: 5,
              bayesianPriorGlobalMean: 3.5,
              bayesianPriorWeight: 3,
              maxNewReviewsPerDay: 5,
              autoHideOpenReportsThreshold: 3,
              allowedSubjectStatuses: ['regularizada', 'aprobada', 'promocionada'],
            },
          },
        });
      }
      if (url.startsWith('/api/public/professors')) {
        return jsonResponse({ success: true, data: { professors: [], thresholds: {} } });
      }
      if (url.startsWith('/api/public/library/files')) {
        return jsonResponse({
          success: true,
          data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
        });
      }
      return jsonResponse({ error: `Ruta no esperada en modo público: ${url}` }, 404);
    },
    async (calls) => {
      // 1. Arranque con hint = '0'
      const sessionOutcome = await runInitialSessionCheck({
        storage,
        fetchMe: () => apiFetch('/api/me'),
      });
      assert.equal(sessionOutcome.status, 'anonymous');
      assert.equal(calls.length, 0);

      // 2. Mapa + SubjectDrawer conteos
      const planRes = await loadPublicPlanCatalogSmart({ planId: 'current', storage });
      writePublicSelectedPlanId(planRes.catalog.plan.id, storage);
      await publicApi.listLibrarySubjects(planRes.catalog.plan.id);

      // 3. Profesores + Detalle
      await publicApi.listProfessors({ planId: planRes.catalog.plan.id, sort: 'rating' });
      await publicApi.getProfessorDetail('prof-1', planRes.catalog.plan.id);
      await publicApi.getProfessorReviews('prof-1', { planId: planRes.catalog.plan.id, pageSize: 10 });

      // 4. Biblioteca + Términos anónimos (SSR sin provider)
      await publicApi.listLibrarySubjects(planRes.catalog.plan.id);
      await publicApi.listLibraryFiles({
        planId: planRes.catalog.plan.id,
        subjectId: 'sub-uuid-101',
        page: 1,
        pageSize: 20,
      });
      const termsHtml = renderToStaticMarkup(
        React.createElement(LibraryTermsPage, {
          onBack: () => {},
          career: catalog.career,
          isAuthenticated: false,
        })
      );
      assert.ok(termsHtml.includes('Volver a la Biblioteca'));
      assert.ok(!termsHtml.includes('Aceptar Términos de la Biblioteca'));

      // Verificación de red (a) y 0x401 (b)
      assert.ok(calls.length >= 7);
      const forbiddenPrefixes = [
        '/api/me',
        '/api/auth/',
        '/api/library/',
        '/api/professors/',
        '/api/state',
        '/api/me/reviewable',
        '/api/catalog/schedule',
      ];
      for (const call of calls) {
        assert.ok(call.url.startsWith('/api/public/'), `URL no pública detectada: ${call.url}`);
        assert.equal(call.method, 'GET');
        assert.equal(call.credentials, 'omit');
        assert.equal(call.headers['x-requested-with'], undefined);
        assert.equal(call.headers['authorization'], undefined);
        assert.notEqual(call.status, 401);
        for (const forbidden of forbiddenPrefixes) {
          assert.ok(!call.url.startsWith(forbidden), `No debía llamar a ${call.url}`);
        }
      }

      // Verificación de claves permitidas en localStorage (b)
      for (const writtenKey of [...storage.writtenKeys, ...storage.keys()]) {
        const isAllowed =
          writtenKey === AUTH_HINT_STORAGE_KEY ||
          writtenKey === PUBLIC_SELECTED_PLAN_ID_KEY ||
          writtenKey.startsWith(PUBLIC_CATALOG_CACHE_KEY_PREFIX);
        assert.ok(isAllowed, `Clave de storage no permitida en modo público: ${writtenKey}`);
        assert.ok(!writtenKey.startsWith('correlativas_'));
        assert.ok(!writtenKey.startsWith('mi_carrera_progress'));
        assert.ok(!writtenKey.startsWith('stack:library-welcome-seen'));
        assert.notEqual(writtenKey, 'ui_mobile_graph_view');
      }
    }
  );

  // Verificación estructural de bifurcaciones limpias sin fugas autenticadas
  const drawerSrc = fs.readFileSync(path.join(rootDir, 'src/components/graph/SubjectDrawer.tsx'), 'utf8');
  const profDirSrc = fs.readFileSync(path.join(rootDir, 'src/components/professors/ProfessorsDirectory.tsx'), 'utf8');
  const profModalSrc = fs.readFileSync(path.join(rootDir, 'src/components/professors/ProfessorDetailModal.tsx'), 'utf8');
  const libHomeSrc = fs.readFileSync(path.join(rootDir, 'src/components/library/LibraryHome.tsx'), 'utf8');
  const libViewSrc = fs.readFileSync(path.join(rootDir, 'src/components/library/SubjectLibraryView.tsx'), 'utf8');
  const graphSrc = fs.readFileSync(path.join(rootDir, 'src/components/graph/CorrelativeGraph.tsx'), 'utf8');

  assert.match(drawerSrc, /if\s*\(isPublicMode\)\s*\{[\s\S]*?publicApi\s*\.listLibrarySubjects/);
  assert.match(profDirSrc, /useProfessorRatings\(isAuthenticated\)/);
  assert.match(profDirSrc, /if\s*\(!isAuthenticated\)\s*return;[\s\S]*?professorsApi\s*\.getReviewable/);
  assert.match(profModalSrc, /if\s*\(isAuthenticated\)\s*\{[\s\S]*?else\s*\{[\s\S]*?publicApi\s*\.getProfessorDetail/);
  assert.match(libHomeSrc, /if\s*\(!isAuthenticated\)\s*\{[\s\S]*?setShowWelcomeModal\(false\)/);
  assert.match(libHomeSrc, /publicApi\s*\.listLibrarySubjects\(activePlanId\)/);
  assert.match(libViewSrc, /publicApi\s*\.listLibraryFiles\(/);
  assert.match(graphSrc, /if\s*\(!isPublicMode\s*&&\s*typeof window !== 'undefined'\)\s*\{\s*localStorage\.setItem\('ui_mobile_graph_view'/);
});

// ============================================================================
// (c) Todas las acciones protegidas abren aviso de inicio de sesión sin tocar red
// ============================================================================
test('(c) Acciones de escritura/descarga en modo anónimo muestran aviso de login con 0 llamadas de red', async () => {
  const sampleSubjects: Subject[] = makeSamplePlanCatalog().subjects;
  const promptCalls: Array<{ label: string; hash?: string }> = [];

  await withInstrumentedFetch(
    new MockStorage(),
    async () => {
      throw new Error('Ninguna acción protegida anónima debe tocar fetch');
    },
    async (calls) => {
      // 1. Nodo del Mapa en modo público (candado sin badges personales)
      const nodeHtml = renderToStaticMarkup(
        React.createElement(SubjectNodeCard, {
          nodeData: {
            subject: sampleSubjects[1],
            status: 'bloqueada',
            isPublicMode: true,
            onOpenStatusModal: () => promptCalls.push({ label: 'guardar tus estados', hash: '#graph' }),
          },
          withHandles: false,
        })
      );
      assert.ok(nodeHtml.includes('Iniciá sesión para guardar tus estados'));
      assert.ok(nodeHtml.includes('1 correl.'));
      assert.ok(!nodeHtml.includes('Bloqueada'));
      assert.ok(!nodeHtml.includes('Disponible'));

      // 2. Vista Lista en modo público
      const listHtml = renderToStaticMarkup(
        React.createElement(SubjectListView, {
          subjects: sampleSubjects,
          activeState: {},
          onSelectSubject: () => {},
          selectedSubjectId: null,
          isPublicMode: true,
          planConfig: makeSamplePlanCatalog().plan.config,
        })
      );
      assert.ok(listHtml.includes('(1 materia)'));
      assert.ok(!listHtml.includes('aprobadas)'));
      assert.ok(!listHtml.includes('%'));
      assert.ok(!listHtml.includes('Falta regularizar'));
      assert.ok(!listHtml.includes('Falta aprobar'));

      // 3. Ruta #library/my-uploads muestra LoginPromptScreenView para library-uploads
      let capturedOpenLogin: { returnToHash?: string; mode?: string } | undefined;
      const myUploadsHtml = renderToStaticMarkup(
        React.createElement(LoginPromptScreenView, {
          view: 'library-uploads',
          onOpenLogin: (opts) => {
            capturedOpenLogin = opts;
          },
          onBackToMap: () => {},
        })
      );
      assert.ok(myUploadsHtml.includes('Iniciá sesión para ver tus aportes en la Biblioteca'));
      assert.ok(myUploadsHtml.includes('Iniciar sesión'));
      assert.equal(capturedOpenLogin, undefined);

      // 4. LoginPromptModalView renderiza acción esperada y dispara onOpenLogin con returnToHash
      const promptModalHtml = renderToStaticMarkup(
        React.createElement(LoginPromptModalView, {
          isOpen: true,
          isMobile: false,
          onClose: () => {},
          actionLabel: 'descargar o aportar material',
          returnToHash: '#library/101',
          onOpenLogin: (opts) => {
            promptCalls.push({ label: 'login', hash: opts?.returnToHash });
          },
        })
      );
      assert.ok(promptModalHtml.includes('Iniciá sesión para descargar o aportar material'));
      assert.ok(promptModalHtml.includes('Seguir explorando sin cuenta'));

      // 5. Verificar en fuente que cada acción de escritura/descarga llama openLoginPrompt
      const drawerSrc = fs.readFileSync(path.join(rootDir, 'src/components/graph/SubjectDrawer.tsx'), 'utf8');
      const searchSrc = fs.readFileSync(path.join(rootDir, 'src/components/common/SearchModal.tsx'), 'utf8');
      const graphSrc = fs.readFileSync(path.join(rootDir, 'src/components/graph/CorrelativeGraph.tsx'), 'utf8');
      const profDirSrc = fs.readFileSync(path.join(rootDir, 'src/components/professors/ProfessorsDirectory.tsx'), 'utf8');
      const profModalSrc = fs.readFileSync(path.join(rootDir, 'src/components/professors/ProfessorDetailModal.tsx'), 'utf8');
      const libHomeSrc = fs.readFileSync(path.join(rootDir, 'src/components/library/LibraryHome.tsx'), 'utf8');
      const libViewSrc = fs.readFileSync(path.join(rootDir, 'src/components/library/SubjectLibraryView.tsx'), 'utf8');

      assert.match(drawerSrc, /Iniciá sesión para guardar tus estados, notas, cursadas y finales/);
      assert.match(searchSrc, /openLoginPrompt\('guardar tus estados'/);
      assert.match(graphSrc, /openLoginPrompt\('guardar tus cursadas'/);
      assert.match(profDirSrc, /openLoginPrompt\('ver tus reseñas publicadas'/);
      assert.match(profDirSrc, /openLoginPrompt\('dejar una reseña'/);
      assert.match(profModalSrc, /openLoginPrompt\('votar reseñas útiles'/);
      assert.match(profModalSrc, /openLoginPrompt\('reportar una reseña'/);
      assert.match(libHomeSrc, /view="library-uploads"/);
      assert.match(libHomeSrc, /handleOpenMyUploads[\s\S]*?openLoginPrompt\('descargar o aportar material'/);
      assert.match(libHomeSrc, /handleOpenUpload[\s\S]*?openLoginPrompt\('descargar o aportar material'/);
      assert.match(libViewSrc, /const handleDownload =[\s\S]*?if\s*\(!isAuthenticated\)\s*\{\s*openAuthPromptForLibrary\(\);\s*return;/);
      assert.match(libViewSrc, /const handleToggleHelpful =[\s\S]*?if\s*\(!isAuthenticated\)\s*\{\s*openAuthPromptForLibrary\(\);\s*return;/);
      assert.match(libViewSrc, /const handleOpenReport =[\s\S]*?if\s*\(!isAuthenticated\)\s*\{\s*openAuthPromptForLibrary\(\);\s*return;/);

      assert.equal(calls.length, 0);
    }
  );
});

// ============================================================================
// (d) Comentarios en texto plano estricto + período condicional + DTO de 17 claves
// ============================================================================
test('(d) Comentarios de reseñas se renderizan en texto plano sin HTML/links/markdown y tarjetas cumplen whitelist pública', () => {
  const payload = '<img src=x onerror=alert(1)> Visitar https://ejemplo.test y **negrita**';

  const reviewNoPeriodHtml = renderToStaticMarkup(
    React.createElement(PublicReviewCardView, {
      subjectName: 'Análisis Matemático I',
      attendedPeriod: formatPublicAttendedPeriod(null, null),
      publishedLabel: formatPublicReviewMonthYear('2026-11'),
      overall: 5,
      clarity: 5,
      treatment: 4,
      availability: 4,
      difficulty: 3,
      wouldRecommend: true,
      comment: payload,
      helpfulCount: 7,
      onHelpfulClick: () => {},
      onReportClick: () => {},
    })
  );

  // Texto plano escapado por React: cero <img, cero <a, cero <strong>, cero onerror= ejecutable
  assert.ok(reviewNoPeriodHtml.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(reviewNoPeriodHtml.includes('https://ejemplo.test'));
  assert.ok(reviewNoPeriodHtml.includes('**negrita**'));
  assert.ok(!reviewNoPeriodHtml.includes('<img'));
  assert.ok(!reviewNoPeriodHtml.includes('<a '));
  assert.ok(!reviewNoPeriodHtml.includes('<strong>Visitar'));
  assert.ok(reviewNoPeriodHtml.includes('Publicado en nov. 2026'));
  assert.ok(reviewNoPeriodHtml.includes('Útil (7)'));
  assert.ok(reviewNoPeriodHtml.includes('Reportar'));
  assert.ok(!reviewNoPeriodHtml.includes('Cursada'), 'Con attendedPeriod null no debe mostrarse nada de período');
  assert.ok(!reviewNoPeriodHtml.includes('Estudiante de'));

  const reviewWithPeriodHtml = renderToStaticMarkup(
    React.createElement(PublicReviewCardView, {
      subjectName: 'Álgebra y Geometría Analítica',
      attendedPeriod: formatPublicAttendedPeriod(2025, '1C'),
      publishedLabel: formatPublicReviewMonthYear('2026-05'),
      overall: 4,
      clarity: 4,
      treatment: null,
      availability: null,
      difficulty: null,
      wouldRecommend: false,
      comment: 'Buena cursada.',
      helpfulCount: 2,
      onHelpfulClick: () => {},
      onReportClick: () => {},
    })
  );
  assert.ok(reviewWithPeriodHtml.includes('Cursada 2025 · 1C'));
  assert.ok(reviewWithPeriodHtml.includes('Publicado en may. 2026'));
  assert.ok(reviewWithPeriodHtml.includes('No recomienda'));

  const profModalSrc = fs.readFileSync(path.join(rootDir, 'src/components/professors/ProfessorDetailModal.tsx'), 'utf8');
  assert.doesNotMatch(profModalSrc, /dangerouslySetInnerHTML/);

  // Tarjeta pública de Biblioteca: muestra metadatos de los 17 campos sin originalFilename ni uploader
  const mappedFile = mapPublicLibraryFileToCard({
    id: 'file-1',
    subjectId: 'sub-uuid-101',
    subjectCode: 101,
    subjectName: 'Análisis Matemático I',
    kind: 'parcial',
    academicYear: 2025,
    term: '1C',
    examInstance: '1er Parcial',
    hasSolution: true,
    title: 'Parcial Resuelto 2025',
    description: 'Incluye ejercicios resueltos paso a paso.',
    professorNames: ['García, Ana'],
    mimeType: 'application/pdf',
    sizeBytes: 2 * 1024 * 1024,
    downloadCount: 14,
    helpfulCount: 5,
    createdAt: '2026-11-27T00:00:00.000Z',
  });
  const fileCardHtml = renderToStaticMarkup(
    React.createElement(LibraryFileCardView, {
      file: mappedFile,
      isPublicMode: true,
      isDownloading: false,
      onDownload: () => {},
      onToggleHelpful: () => {},
      onReport: () => {},
    })
  );
  assert.ok(fileCardHtml.includes('Parcial Resuelto 2025'));
  assert.ok(fileCardHtml.includes('Con resolución'));
  assert.ok(fileCardHtml.includes('García, Ana'));
  assert.ok(fileCardHtml.includes('PDF · 2.00 MB'));
  assert.ok(fileCardHtml.includes('Descargar (14)'));
  assert.ok(!fileCardHtml.includes('Subido por un estudiante'));
});

// ============================================================================
// (e) Paginación en reseñas (<= 10, "Ver más") y archivos (<= 30)
// ============================================================================
test('(e) Paginación acota reseñas públicas a <= 10 con carga incremental y archivos a <= 30', async () => {
  assert.ok(LIBRARY_FILES_PAGE_SIZE <= 30);

  await withInstrumentedFetch(
    new MockStorage(),
    async (url) => {
      if (url.includes('/reviews')) {
        return jsonResponse({
          success: true,
          data: {
            items: Array.from({ length: 10 }, (_, idx) => ({
              id: `rev-${idx}`,
              overall: 5,
              clarity: 5,
              treatment: 5,
              availability: 5,
              difficulty: 3,
              wouldRecommend: true,
              comment: `Opinión ${idx}`,
              subjectId: 'sub-1',
              subjectCode: 101,
              subjectName: 'AMI',
              academicYear: null,
              term: null,
              createdAt: '2026-11',
              helpfulCount: 0,
            })),
            page: 1,
            pageSize: 10,
            total: 12,
            totalPages: 2,
          },
        });
      }
      if (url.includes('/library/files')) {
        return jsonResponse({
          success: true,
          data: { items: [], total: 45, page: 2, pageSize: 30, totalPages: 2 },
        });
      }
      return jsonResponse({}, 404);
    },
    async (calls) => {
      const rPage1 = await publicApi.getProfessorReviews('prof-1', {
        planId: 'plan-2023',
        page: 1,
        pageSize: 50,
      });
      assert.match(calls[0].url, /page=1/);
      assert.match(calls[0].url, /pageSize=10/);
      assert.equal(rPage1.data.items.length, 10);
      assert.equal(rPage1.data.totalPages, 2);

      await publicApi.getProfessorReviews('prof-1', {
        planId: 'plan-2023',
        page: 2,
        pageSize: 10,
      });
      assert.match(calls[1].url, /page=2/);
      assert.match(calls[1].url, /pageSize=10/);

      await publicApi.listLibraryFiles({
        planId: 'plan-2023',
        subjectId: 'sub-uuid-101',
        page: 2,
        pageSize: 99,
      });
      assert.match(calls[2].url, /page=2/);
      assert.match(calls[2].url, /pageSize=30/);
    }
  );
});

// ============================================================================
// (f) Paridad para usuario logueado
// ============================================================================
test('(f) Usuario con sesión mantiene badges personales, estado en lista, autoría anónima y aceptación de términos', () => {
  const catalog = makeSamplePlanCatalog();

  const nodeApprovedHtml = renderToStaticMarkup(
    React.createElement(SubjectNodeCard, {
      nodeData: {
        subject: catalog.subjects[0],
        status: 'aprobada',
        grade: 9,
        isPublicMode: false,
      },
      withHandles: false,
    })
  );
  assert.ok(nodeApprovedHtml.includes('9'));
  assert.ok(!nodeApprovedHtml.includes('Sin correl.'));
  assert.ok(!nodeApprovedHtml.includes('Iniciá sesión para guardar tus estados'));

  const listAuthHtml = renderToStaticMarkup(
    React.createElement(SubjectListView, {
      subjects: catalog.subjects,
      activeState: {},
      onSelectSubject: () => {},
      selectedSubjectId: null,
      isPublicMode: false,
      planConfig: catalog.plan.config,
    })
  );
  assert.ok(listAuthHtml.includes('(0/1 aprobadas)'));
  assert.ok(listAuthHtml.includes('0%'));
  assert.ok(listAuthHtml.includes('Falta regularizar:'));
  assert.ok(listAuthHtml.includes('Análisis Matemático I'));

  const fileAuthHtml = renderToStaticMarkup(
    React.createElement(LibraryFileCardView, {
      file: {
        id: 'file-2',
        subjectId: 'sub-uuid-101',
        kind: 'apunte',
        academicYear: 2025,
        term: '1C',
        examInstance: null,
        hasSolution: false,
        title: 'Apuntes Unidad 1',
        description: null,
        originalFilename: 'unidad1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024 * 1024,
        downloadCount: 3,
        helpfulCount: 1,
        hasVotedHelpful: true,
        professorNames: [],
        createdAt: '2026-11-27T00:00:00.000Z',
      },
      isPublicMode: false,
      isDownloading: false,
      onDownload: () => {},
      onToggleHelpful: () => {},
      onReport: () => {},
    })
  );
  assert.ok(fileAuthHtml.includes('Subido por un estudiante'));

  const termsAuthHtml = renderToStaticMarkup(
    React.createElement(LibraryTermsPage, {
      onBack: () => {},
      career: catalog.career,
      isAuthenticated: true,
    })
  );
  assert.ok(termsAuthHtml.includes('Aceptar Términos de la Biblioteca'));
});
