import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiFetch, ApiError } from '../src/api/client.ts';
import {
  publicApi,
  publicFetch,
  PUBLIC_CATALOG_CACHE_KEY_PREFIX,
  PUBLIC_SELECTED_PLAN_ID_KEY,
  loadPublicPlanCatalogSmart,
  readPublicSelectedPlanId,
  writePublicSelectedPlanId,
} from '../src/api/public.api.ts';
import {
  AUTH_HINT_STORAGE_KEY,
  determineAppScreen,
  normalizeReturnToHash,
  readAuthHint,
  resolveReturnToHashAfterAuth,
  runInitialSessionCheck,
  writeAuthHint,
} from '../src/utils/authGate.ts';
import {
  canPersistScopedStorage,
  canSyncServerState,
  createCareerHydrationState,
  executeServerReloadCycle,
  resetHydrationOnLogout,
} from '../src/utils/careerHydrationGuard.ts';
import {
  LoginPromptScreenView,
  type ProtectedPromptView,
} from '../src/components/auth/LoginPromptScreen.tsx';
import { LoginPromptModalView } from '../src/components/auth/LoginPromptModal.tsx';
import type { ActivePlanCatalog } from '../src/types/career.ts';

// CareerContext -> audio.ts lee localStorage al evaluar el módulo en Node
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
    writable: true,
    configurable: true,
  });
}

const { executePlanSelection } = await import('../src/components/common/PlanSelectorModal.tsx');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

class MockStorage {
  private readonly store = new Map<string, string>();
  readonly writes: Array<{ op: 'set' | 'remove'; key: string; value?: string }> = [];

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
    this.writes.push({ op: 'set', key, value: String(value) });
  }

  removeItem(key: string): void {
    this.store.delete(key);
    this.writes.push({ op: 'remove', key });
  }

  keys(): string[] {
    return Array.from(this.store.keys());
  }
}

interface RecordedFetchCall {
  url: string;
  method: string;
  credentials: RequestCredentials | undefined;
  headers: Record<string, string>;
}

function headersToRecord(raw?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  const h = new Headers(raw);
  h.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

async function withGlobals(
  storage: MockStorage,
  fetchHandler: (
    url: string,
    init: RequestInit | undefined,
    callIndex: number
  ) => Promise<Response> | Response,
  fn: (calls: RecordedFetchCall[]) => Promise<void>
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const calls: RecordedFetchCall[] = [];

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call: RecordedFetchCall = {
      url,
      method: (init?.method || 'GET').toUpperCase(),
      credentials: init?.credentials,
      headers: headersToRecord(init?.headers),
    };
    calls.push(call);
    return fetchHandler(url, init, calls.length - 1);
  }) as typeof fetch;

  try {
    await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalStorageDescriptor);
    } else {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeSampleCatalog(planId: string, planName = `Plan ${planId}`): ActivePlanCatalog {
  return {
    career: {
      id: `career-${planId}`,
      name: 'Ingeniería en Sistemas',
      code: 'ISI',
      facultyCode: 'FRCU',
      institutionCode: 'UTN',
    },
    plan: {
      id: planId,
      name: planName,
      year: 2023,
      updatedAt: '2026-11-27T00:00:00.000Z',
      config: {
        requiredElectiveCredits: 20,
        defaultMinPassingGrade: 4,
        totalLevels: 5,
        levelLabel: 'Año',
        shortTag: planName,
      },
    },
    subjects: [
      {
        id: 101,
        uuid: '11111111-1111-4111-8111-111111111101',
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
    ],
    rules: [],
    acronyms: { AMI: 101 },
  };
}

// ============================================================================
// (a) Visitante con stack_auth_hint = '0' hace CERO llamadas a /api/me y /refresh
// ============================================================================
test('(a) Visitante con stack_auth_hint="0" hace 0 llamadas a /api/me y /api/auth/refresh', async () => {
  const storage = new MockStorage();
  storage.setItem(AUTH_HINT_STORAGE_KEY, '0');

  await withGlobals(
    storage,
    async () => {
      throw new Error('fetch no debería invocarse cuando stack_auth_hint === "0"');
    },
    async (calls) => {
      const result = await runInitialSessionCheck({
        storage,
        fetchMe: () => apiFetch('/api/me'),
      });

      assert.equal(result.user, null);
      assert.equal(result.didProbeNetwork, false);
      assert.equal(result.hintAfter, '0');
      assert.equal(calls.length, 0);
      assert.equal(readAuthHint(storage), '0');
    }
  );
});

// ============================================================================
// (b) Marca ausente hace 1 prueba; éxito=>'1', fallo=>'0', y eventos auth
// ============================================================================
test('(b) stack_auth_hint ausente sondea una sola vez y persiste "1" si hay sesión o "0" si falla', async () => {
  // Caso 1: Marca ausente -> /api/me responde usuario válido -> guarda '1'
  {
    const storage = new MockStorage();
    await withGlobals(
      storage,
      async (url) => {
        if (url === '/api/me') {
          return jsonResponse({
            success: true,
            user: { id: 'u1', email: 'test@utn.edu.ar', emailVerified: true },
          });
        }
        return jsonResponse({}, 404);
      },
      async (calls) => {
        assert.equal(readAuthHint(storage), null);
        const result = await runInitialSessionCheck<{ id: string }>({
          storage,
          fetchMe: () => apiFetch('/api/me'),
        });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, '/api/me');
        assert.equal(result.didProbeNetwork, true);
        assert.equal(result.user?.id, 'u1');
        assert.equal(readAuthHint(storage), '1');
      }
    );
  }

  // Caso 2: Marca ausente -> /api/me 401 -> /api/auth/refresh 401 -> guarda '0'
  {
    const storage = new MockStorage();
    await withGlobals(
      storage,
      async () => jsonResponse({ success: false, error: 'No autenticado' }, 401),
      async (calls) => {
        const result = await runInitialSessionCheck({
          storage,
          fetchMe: () => apiFetch('/api/me'),
        });
        assert.equal(result.user, null);
        assert.equal(result.didProbeNetwork, true);
        assert.equal(readAuthHint(storage), '0');
        assert.deepEqual(
          calls.map((c) => c.url),
          ['/api/me', '/api/auth/refresh']
        );
      }
    );
  }

  // Caso 3: AuthContext actualiza stack_auth_hint en login, register, Google, logout y baja
  {
    const authCtxSource = fs.readFileSync(
      path.join(rootDir, 'src/context/AuthContext.tsx'),
      'utf8'
    );
    assert.match(authCtxSource, /const login =[\s\S]*?writeAuthHint\('1'\)/);
    assert.match(authCtxSource, /const loginWithGoogle =[\s\S]*?writeAuthHint\('1'\)/);
    assert.match(authCtxSource, /const register =[\s\S]*?writeAuthHint\('1'\)/);
    assert.match(authCtxSource, /const logout =[\s\S]*?writeAuthHint\('0'\)/);
    assert.match(authCtxSource, /const deleteAccount =[\s\S]*?writeAuthHint\('0'\)/);
    assert.match(authCtxSource, /const cancelRegistration =[\s\S]*?writeAuthHint\('0'\)/);
    writeAuthHint('1');
  }
});

// ============================================================================
// (c) Modo anónimo consulta solo /api/public/*, GET, credentials: 'omit' y sin X-Requested-With
// ============================================================================
test('(c) publicApi y publicFetch usan solo GET hacia /api/public/* con credentials="omit" y sin X-Requested-With', async () => {
  const storage = new MockStorage();
  const samplePlan = makeSampleCatalog('plan-2023');

  await withGlobals(
    storage,
    async (url) => {
      if (url === '/api/public/catalog/version') {
        return jsonResponse({ success: true, version: 'v1' });
      }
      if (url === '/api/public/catalog/careers') {
        return jsonResponse({ success: true, data: [] });
      }
      if (url.startsWith('/api/public/catalog/plans/')) {
        return jsonResponse({ success: true, data: samplePlan });
      }
      if (url.startsWith('/api/public/professors/') && url.includes('/reviews')) {
        return jsonResponse({
          success: true,
          data: { items: [], page: 1, pageSize: 10, total: 0, totalPages: 0 },
        });
      }
      if (url.startsWith('/api/public/professors/')) {
        return jsonResponse({ success: true, data: { professor: { id: 'p1' }, thresholds: {} } });
      }
      if (url.startsWith('/api/public/professors')) {
        return jsonResponse({ success: true, data: { professors: [], thresholds: {} } });
      }
      if (url.startsWith('/api/public/library/subjects')) {
        return jsonResponse({ success: true, data: [] });
      }
      if (url.startsWith('/api/public/library/files')) {
        return jsonResponse({
          success: true,
          data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
        });
      }
      return jsonResponse({}, 404);
    },
    async (calls) => {
      await publicApi.getVersion();
      await publicApi.getCareers();
      await publicApi.getPlan('plan-2023');
      await publicApi.listProfessors({ planId: 'plan-2023', sort: 'rating' });
      await publicApi.getProfessorDetail('prof-1', 'plan-2023');
      await publicApi.getProfessorReviews('prof-1', { planId: 'plan-2023', pageSize: 99 });
      await publicApi.listLibrarySubjects('plan-2023');
      await publicApi.listLibraryFiles({ planId: 'plan-2023', pageSize: 99 });

      // Verificar también que headers peligrosos explícitos son removidos
      await publicFetch('/api/public/catalog/version', {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Authorization: 'Bearer secret-token',
          'X-Custom': 'ok',
        },
      });

      assert.equal(calls.length, 9);
      for (const call of calls) {
        assert.ok(call.url.startsWith('/api/public/'), `URL inesperada: ${call.url}`);
        assert.equal(call.method, 'GET');
        assert.equal(call.credentials, 'omit');
        assert.equal(call.headers['x-requested-with'], undefined);
        assert.equal(call.headers['authorization'], undefined);
      }

      // Clamping de pageSize en cliente (<= 10 en reviews, <= 30 en files)
      assert.match(calls[5].url, /pageSize=10/);
      assert.match(calls[7].url, /pageSize=30/);

      // publicFetch rechaza rutas fuera de /api/public/* y métodos != GET
      await assert.rejects(() => publicFetch('/api/me'), (err: unknown) => err instanceof ApiError);
      await assert.rejects(
        () => publicFetch('/api/public/catalog/version', { method: 'POST' }),
        (err: unknown) => err instanceof ApiError
      );
      assert.equal(calls.length, 9, 'Los rechazos locales no deben disparar fetch');
    }
  );
});

// ============================================================================
// (d) No hay bucle de 401: ni al arrancar con refresh 401 ni en publicFetch 401
// ============================================================================
test('(d) Cero bucle 401 en arranque con hint="1" y en publicFetch ante 401', async () => {
  const storage = new MockStorage();
  storage.setItem(AUTH_HINT_STORAGE_KEY, '1');

  await withGlobals(
    storage,
    async () => jsonResponse({ success: false, error: 'Unauthorized' }, 401),
    async (calls) => {
      // Primer arranque con hint='1': intenta 1 vez /api/me y 1 vez /api/auth/refresh; marca '0'
      const probe1 = await runInitialSessionCheck({
        storage,
        fetchMe: () => apiFetch('/api/me'),
      });
      assert.equal(probe1.user, null);
      assert.equal(probe1.hintAfter, '0');
      assert.deepEqual(
        calls.map((c) => c.url),
        ['/api/me', '/api/auth/refresh']
      );

      // Segundo chequeo ya ve '0' y hace 0 llamadas
      const probe2 = await runInitialSessionCheck({
        storage,
        fetchMe: () => apiFetch('/api/me'),
      });
      assert.equal(probe2.didProbeNetwork, false);
      assert.equal(calls.length, 2);

      // Un 401 en publicFetch nunca dispara /api/auth/refresh
      await assert.rejects(
        () => publicFetch('/api/public/catalog/version'),
        (err: unknown) => err instanceof ApiError && err.status === 401
      );
      assert.deepEqual(
        calls.map((c) => c.url),
        ['/api/me', '/api/auth/refresh', '/api/public/catalog/version']
      );
    }
  );
});

// ============================================================================
// (e) Cero escritura de claves de usuario/progreso y 0 PUT /api/me/plan en anónimo
// ============================================================================
test('(e) Modo anónimo solo escribe claves públicas y nunca llama PUT /api/me/plan', async () => {
  const storage = new MockStorage();
  const planA = makeSampleCatalog('plan-a', 'Plan A');
  const planB = makeSampleCatalog('plan-b', 'Plan B');

  await withGlobals(
    storage,
    async (url) => {
      if (url === '/api/public/catalog/version') {
        return jsonResponse({ success: true, version: 'ver-1' });
      }
      if (url === '/api/public/catalog/plans/current' || url === '/api/public/catalog/plans/plan-a') {
        return jsonResponse({ success: true, data: planA });
      }
      if (url === '/api/public/catalog/plans/plan-b') {
        return jsonResponse({ success: true, data: planB });
      }
      return jsonResponse({ success: false }, 500);
    },
    async (calls) => {
      const loaded1 = await loadPublicPlanCatalogSmart({
        planId: 'current',
        storage,
      });
      writePublicSelectedPlanId(loaded1.catalog.plan.id, storage);
      assert.equal(readPublicSelectedPlanId(storage), 'plan-a');

      // Cambio de plan anónimo mediante executePlanSelection
      let switchedTo: string | null = null;
      let closed = false;
      const outcome = await executePlanSelection({
        planId: 'plan-b',
        currentPlanId: loaded1.catalog.plan.id,
        updateSelectedPlan: async (targetPlanId) => {
          const loaded2 = await loadPublicPlanCatalogSmart({ planId: targetPlanId, storage });
          writePublicSelectedPlanId(loaded2.catalog.plan.id, storage);
          switchedTo = loaded2.catalog.plan.id;
          return { success: true };
        },
        reloadServerState: async () => {},
        onClose: () => {
          closed = true;
        },
      });

      assert.equal(outcome, 'switched');
      assert.equal(switchedTo, 'plan-b');
      assert.equal(closed, true);
      assert.equal(readPublicSelectedPlanId(storage), 'plan-b');

      // Ninguna clave que no sea cache pública o selectedPlan público
      for (const k of storage.keys()) {
        assert.ok(
          k.startsWith(PUBLIC_CATALOG_CACHE_KEY_PREFIX) || k === PUBLIC_SELECTED_PLAN_ID_KEY,
          `Clave de localStorage no permitida en modo anónimo: ${k}`
        );
      }

      // Ninguna petición fuera de /api/public/catalog/*
      assert.ok(calls.every((c) => c.url.startsWith('/api/public/catalog/')));
      assert.equal(
        calls.some((c) => c.url.includes('/api/me/plan') || c.url.includes('/api/state')),
        false
      );

      // En CareerContext, durante modo público hidratación queda bloqueada (cero storage effects de progreso)
      const publicHydration = resetHydrationOnLogout(createCareerHydrationState());
      assert.equal(canPersistScopedStorage('plan-a', publicHydration), false);
      assert.equal(canSyncServerState(false, publicHydration, 'plan-a'), false);
    }
  );
});

// ============================================================================
// (f) Cold-start (>2500ms / 503) dispara estado despertando con el mensaje esperado
// ============================================================================
test('(f) Cold-start activa aviso "El servidor está despertando..." y reintenta ante 503', async () => {
  const storage = new MockStorage();
  const plan = makeSampleCatalog('plan-cold');

  // 1. Timer en runInitialSessionCheck tras > wakingDelayMs
  {
    const wakingStates: boolean[] = [];
    await runInitialSessionCheck({
      storage,
      wakingDelayMs: 15,
      onWakingChange: (w) => wakingStates.push(w),
      fetchMe: async () => {
        await new Promise((r) => setTimeout(r, 45));
        return { success: false, user: null };
      },
    });
    assert.deepEqual(wakingStates, [true, false]);
  }

  // 2. Retry en loadPublicPlanCatalogSmart ante 503 inicial del backend en Render
  {
    const wakingStates: boolean[] = [];
    let planAttempts = 0;
    await withGlobals(
      storage,
      async (url) => {
        if (url === '/api/public/catalog/plans/current') {
          planAttempts += 1;
          if (planAttempts < 3) {
            return jsonResponse({ error: 'Booting' }, 503);
          }
          return jsonResponse({ success: true, data: plan });
        }
        if (url === '/api/public/catalog/version') {
          return jsonResponse({ success: true, version: 'v-cold' });
        }
        return jsonResponse({}, 404);
      },
      async () => {
        const res = await loadPublicPlanCatalogSmart({
          planId: 'current',
          storage,
          wakingDelayMs: 5000,
          baseBackoffMs: 1,
          maxRetries: 3,
          sleep: async () => {},
          onWakingChange: (w) => wakingStates.push(w),
        });
        assert.equal(res.catalog.plan.id, 'plan-cold');
        assert.equal(planAttempts, 3);
        assert.equal(wakingStates[0], true);
        assert.equal(wakingStates[wakingStates.length - 1], false);
      }
    );
  }

  // 3. Mensaje exacto en App.tsx para isWakingServer y isWakingCatalogServer
  const appSource = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
  const wakingMatches = appSource.match(/El servidor está despertando, puede tardar hasta 1 minuto/g) || [];
  assert.equal(wakingMatches.length, 2);
});

// ============================================================================
// (g) Vistas protegidas muestran LoginPromptScreen, shell sigue visible y #admin protegido
// ============================================================================
test('(g) Vistas protegidas muestran "Iniciá sesión para", Navbar/AuthScreen/Admin guard correctos', () => {
  const protectedViews: ProtectedPromptView[] = ['stats', 'schedule', 'kanban', 'planner', 'electives'];

  for (const view of protectedViews) {
    let capturedHash: string | undefined;
    const html = renderToStaticMarkup(
      React.createElement(LoginPromptScreenView, {
        view,
        onOpenLogin: (opts) => {
          capturedHash = opts?.returnToHash;
        },
        onBackToMap: () => {},
      })
    );
    assert.match(html, /Iniciá sesión para /, `Vista ${view} debe mostrar título con "Iniciá sesión para"`);
    assert.ok(html.includes('Iniciar sesión'), `Vista ${view} debe mostrar botón Iniciar sesión`);
    assert.ok(html.includes('Volver al Mapa de Correlativas'));
    assert.equal(capturedHash, undefined);
  }

  // Modal de invitación
  const modalHtml = renderToStaticMarkup(
    React.createElement(LoginPromptModalView, {
      isOpen: true,
      isMobile: false,
      onClose: () => {},
      actionLabel: 'descargar archivos de la Biblioteca',
      returnToHash: '#library',
      onOpenLogin: () => {},
    })
  );
  assert.ok(modalHtml.includes('Iniciá sesión para descargar archivos de la Biblioteca'));
  assert.ok(modalHtml.includes('Seguir explorando sin cuenta'));

  // UserMenu sin usuario muestra "Iniciar sesión" y AuthScreen incluye volver a explorar sin cuenta
  const userMenuSource = fs.readFileSync(
    path.join(rootDir, 'src/components/common/UserMenu.tsx'),
    'utf8'
  );
  assert.match(userMenuSource, /if\s*\(!user\)\s*\{[\s\S]*Iniciar sesión/);

  const authScreenSource = fs.readFileSync(
    path.join(rootDir, 'src/components/auth/AuthScreen.tsx'),
    'utf8'
  );
  assert.ok(authScreenSource.includes('Volver a explorar sin cuenta'));
  assert.ok(authScreenSource.includes('onClick={closeLogin}'));

  // App.tsx mantiene VerifyEmailScreen y #admin guard y renderiza Navbar en shell público
  const appSource = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
  assert.match(appSource, /determineAppScreen\(\{\s*isLoading,\s*isAuthenticated,\s*isEmailVerified,\s*isLoginOpen/);
  assert.match(appSource, /if\s*\(screenState === 'verify-email-screen'\)\s*\{\s*return <VerifyEmailScreen \/>;/);
  assert.match(appSource, /currentView === 'admin' && user\?\.role !== 'admin'[\s\S]*handleSetView\('graph'\)/);
  assert.ok(appSource.includes('<Navbar currentView={currentView} setCurrentView={handleSetView} />'));
});

// ============================================================================
// (h) Preservar returnToHash y restaurarlo tras login o register + verifyEmail
// ============================================================================
test('(h) openLogin guarda returnToHash y vuelve tras login o tras registro + verificación', () => {
  // 1. Login directo con cuenta ya verificada restaura #stats
  const applied: string[] = [];
  const hash1 = normalizeReturnToHash('#stats');
  assert.equal(hash1, '#stats');
  const afterLogin = resolveReturnToHashAfterAuth({
    currentReturnToHash: hash1,
    emailVerified: true,
    applyHash: (h) => applied.push(h),
  });
  assert.equal(afterLogin.shouldCloseLogin, true);
  assert.equal(afterLogin.consumedHash, '#stats');
  assert.equal(afterLogin.remainingReturnToHash, null);
  assert.deepEqual(applied, ['#stats']);

  // 2. Registro -> sin verificar conserva returnToHash; al verificar email restaura #library/sub-1
  const appliedReg: string[] = [];
  const afterRegister = resolveReturnToHashAfterAuth({
    currentReturnToHash: normalizeReturnToHash('library/sub-1'),
    emailVerified: false,
    applyHash: (h) => appliedReg.push(h),
  });
  assert.equal(afterRegister.shouldCloseLogin, true);
  assert.equal(afterRegister.consumedHash, null);
  assert.equal(afterRegister.remainingReturnToHash, '#library/sub-1');
  assert.deepEqual(appliedReg, []);

  const afterVerify = resolveReturnToHashAfterAuth({
    currentReturnToHash: afterRegister.remainingReturnToHash,
    emailVerified: true,
    applyHash: (h) => appliedReg.push(h),
  });
  assert.equal(afterVerify.consumedHash, '#library/sub-1');
  assert.equal(afterVerify.remainingReturnToHash, null);
  assert.deepEqual(appliedReg, ['#library/sub-1']);
});

// ============================================================================
// (i) Usuario con sesión mantiene hidratación, PUT /api/me/plan y usa su selectedPlanId
// ============================================================================
test('(i) Usuario logueado mantiene hidratación, PUT /api/me/plan e ignora plan anónimo al loguearse', async () => {
  const catalog = makeSampleCatalog('plan-user-1', 'Plan Usuario');
  let hydration = createCareerHydrationState();
  let appliedUi = false;

  const outcome = await executeServerReloadCycle({
    getState: () => hydration,
    setState: (next) => {
      hydration = next;
    },
    loadCatalog: async ({ onImmediateCache }) => {
      void onImmediateCache;
      return { catalog };
    },
    applyCatalogToUi: () => {
      appliedUi = true;
    },
    fetchServerState: async () => ({
      success: true,
      data: {
        hasSavedData: true,
        progress: {},
        settings: {
          minPassingGrade: 4,
          averageCalculationMode: 'all',
          includeAnalistaTrack: false,
          notifyLibraryEmail: true,
          tutorialCompleted: true,
        },
        assignedElectives: {},
        basket: [],
        scheduleSelections: {},
      },
    }),
    applyServerStateToUi: () => {},
  });

  assert.equal(outcome.status, 'hydrated');
  assert.equal(appliedUi, true);
  assert.equal(canPersistScopedStorage('plan-user-1', hydration), true);
  assert.equal(canSyncServerState(true, hydration, 'plan-user-1'), true);

  // Cambio de plan autenticado usa updateSelectedPlan (/api/me/plan) y reloadServerState
  let putPlanCalled: string | null = null;
  let reloaded = false;
  const switchRes = await executePlanSelection({
    planId: 'plan-user-2',
    currentPlanId: 'plan-user-1',
    updateSelectedPlan: async (id) => {
      putPlanCalled = id;
      return { success: true };
    },
    reloadServerState: async () => {
      reloaded = true;
    },
    onClose: () => {},
  });
  assert.equal(switchRes, 'switched');
  assert.equal(putPlanCalled, 'plan-user-2');
  assert.equal(reloaded, true);

  // Al iniciar sesión desde modo anónimo en otro plan, reloadServerState usa user.selectedPlanId (no el plan anónimo)
  const careerCtxSource = fs.readFileSync(
    path.join(rootDir, 'src/context/CareerContext.tsx'),
    'utf8'
  );
  assert.match(
    careerCtxSource,
    /const isPlanSwitch =\s*typeof overridePlanId === 'string' \|\| authenticatedCatalogLoadedRef\.current;/
  );
  assert.doesNotMatch(
    careerCtxSource,
    /applyPublicCatalogToState[\s\S]*?migrateLegacyLocalStorageToPlan/
  );
});
