import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluatePlanProgress,
  evaluateSpecialRule,
  canRenderProyectoFinal,
  canRenderSeminario,
  canRenderSpecialRuleSubject,
  checkAnalistaTitle,
  getActiveCoreSubjects,
  getSubjectStatus,
  isPPSEligible,
} from '../src/utils/correlativas';
import { formatPlanCatalogPayload } from '../server/src/modules/catalog/planConfig.helpers';
import { calculateCriticalPath } from '../src/utils/criticalPath';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY_STATE,
  STORAGE_KEY_BASKET,
  STORAGE_KEY_SETTINGS,
  STORAGE_KEY_LEGACY_PLAN_ID,
  getPlanStorageKey,
  hasUnmigratedLegacyLocalStorage,
  migrateLegacyLocalStorageToPlan,
  loadUserState,
  saveUserState,
  exportCareerToJson,
} from '../src/utils/storage';
import {
  type CareerHydrationState,
  applyCatalogSnapshot,
  beginServerReload,
  canPersistScopedStorage,
  canSyncServerState,
  completeServerStateHydration,
  createCareerHydrationState,
  executeServerReloadCycle,
  resetHydrationOnLogout,
} from '../src/utils/careerHydrationGuard';
import {
  CATALOG_CACHE_SCHEMA,
  CatalogShapeError,
  getCatalogCacheKey,
  isValidPlanCatalogShape,
  readCachedCatalog,
  writeCachedCatalog,
  loadPlanCatalogSmart,
} from '../src/api/catalog.api';
import { getScheduleUnavailableMessage } from '../src/utils/scheduleAvailability';
import { CORE_SUBJECTS } from './fixtures/plan2023';
import { ELECTIVES } from './fixtures/electives';
import type { ActivePlanCatalog, UserCareerState } from '../src/types/career';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..');

function createMockStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function withMockLocalStorage<T>(storage: Storage, fn: () => T): T {
  const globalRecord = globalThis as unknown as { localStorage?: Storage };
  const hadOwn = Object.prototype.hasOwnProperty.call(globalRecord, 'localStorage');
  const previous = globalRecord.localStorage;
  globalRecord.localStorage = storage;
  try {
    return fn();
  } finally {
    if (hadOwn) {
      globalRecord.localStorage = previous;
    } else {
      delete globalRecord.localStorage;
    }
  }
}

function buildFictitious3LevelPlan(options?: {
  planId?: string;
  electiveSlotsEquivalent?: number;
  requiredElectiveCredits?: number;
}): ActivePlanCatalog {
  const planId = options?.planId ?? 'plan-ici-3y';
  return {
    plan: {
      id: planId,
      name: 'Tecnicatura Demo 3 Años',
      year: 2026,
      updatedAt: '2026-06-01T00:00:00.000Z',
      config: {
        requiredElectiveCredits: options?.requiredElectiveCredits ?? 10,
        electiveSlotsEquivalent: options?.electiveSlotsEquivalent ?? 0,
        defaultMinPassingGrade: 4,
        totalLevels: 3,
        levelLabel: 'Año',
        shortTag: 'TD · Plan 2026',
        ppsRequirement: null,
        intermediateDegrees: [],
      },
    },
    career: {
      id: 'career-td',
      name: 'Tecnicatura Demo',
      code: 'TD',
      facultyId: 'fac-demo',
    },
    subjects: [
      {
        id: 1,
        name: 'Intro A',
        shortName: 'IA',
        level: 1,
        modality: 'cuatrimestral',
        weeklyHours: 4,
        regularPrereqs: [],
        approvedPrereqs: [],
        isElective: false,
      },
      {
        id: 2,
        name: 'Intro B',
        shortName: 'IB',
        level: 2,
        modality: 'cuatrimestral',
        weeklyHours: 4,
        regularPrereqs: [1],
        approvedPrereqs: [],
        isElective: false,
      },
      {
        id: 3,
        name: 'Integradora Final',
        shortName: 'IF',
        level: 3,
        modality: 'anual',
        weeklyHours: 6,
        regularPrereqs: [2],
        approvedPrereqs: [1],
        isElective: false,
      },
      {
        id: 201,
        name: 'Optativa Libre 1',
        shortName: 'OP1',
        level: 2,
        modality: 'cuatrimestral',
        weeklyHours: 3,
        regularPrereqs: [],
        approvedPrereqs: [1],
        isElective: true,
        credits: 6,
      },
      {
        id: 202,
        name: 'Optativa Libre 2',
        shortName: 'OP2',
        level: 3,
        modality: 'cuatrimestral',
        weeklyHours: 3,
        regularPrereqs: [2],
        approvedPrereqs: [],
        isElective: true,
        credits: 4,
      },
      {
        id: 203,
        name: 'Optativa Libre 3',
        shortName: 'OP3',
        level: 3,
        modality: 'cuatrimestral',
        weeklyHours: 3,
        regularPrereqs: [],
        approvedPrereqs: [2],
        isElective: true,
        credits: 4,
      },
    ],
    rules: [],
    acronyms: {
      IA: 1,
      IB: 2,
      IF: 3,
      OP1: 201,
      OP2: 202,
      OP3: 203,
    },
  };
}

describe('Multicarrera Frontend Engine, Storage & Catalog Cache', () => {
  it('evaluates a fictitious 3-level plan without PPS, special rules or intermediate degrees', () => {
    const plan = buildFictitious3LevelPlan({
      requiredElectiveCredits: 10,
      electiveSlotsEquivalent: 0,
    });
    const userState: UserCareerState = {
      1: { status: 'aprobada', grade: 9 },
      2: { status: 'regularizada' },
      201: { status: 'aprobada', grade: 8 },
    };

    const evaluated = evaluatePlanProgress({
      plan,
      userState,
      settings: { ...DEFAULT_SETTINGS, includeAnalistaTrack: true, includeElectivesInProgress: true },
      examAttempts: [],
    });

    assert.equal(evaluated.progress.totalSubjects, 3);
    assert.equal(evaluated.progress.approvedCount, 1);
    assert.equal(evaluated.progress.regularizedCount, 1);
    assert.equal(evaluated.progress.totalElectiveCreditsApproved, 6);
    assert.equal(evaluated.progress.totalElectiveCreditsRequired, 10);
    assert.equal(evaluated.progress.missingElectiveCreditsForDegree, 4);
    assert.equal(evaluated.progress.isAnalistaEligible, false);
    assert.equal(evaluated.progress.isPPSEligible, false);
    assert.equal(evaluated.progress.isDegreeEligible, false);
    assert.deepStrictEqual(evaluated.pps, { eligible: false, missingRegular: [], missingApproved: [] });
    assert.deepStrictEqual(isPPSEligible(userState, plan), {
      eligible: false,
      missingRegular: [],
      missingApproved: [],
    });
    assert.equal(checkAnalistaTitle(userState, plan, 6).eligible, false);
    assert.deepStrictEqual(evaluated.availableCoreIds, [3]);
    assert.deepStrictEqual(evaluated.availableElectiveIds, [202]);
    assert.equal(evaluated.electiveStatuses[203], 'bloqueada');

    const pctSum =
      evaluated.progress.percentageApproved +
      evaluated.progress.percentageRegularized +
      evaluated.progress.percentageTaking +
      evaluated.progress.percentagePending;
    assert.equal(pctSum, 100);

    const cp = calculateCriticalPath(userState, plan, false);
    assert.deepStrictEqual(
      cp.chain.map((s) => s.id),
      [2, 3]
    );
    assert.equal(cp.length, 2);

    // Parameterized plan with electiveSlotsEquivalent = 2 achieves 100% and degree eligibility without PPS or Analista
    const planWithSlots = buildFictitious3LevelPlan({
      requiredElectiveCredits: 10,
      electiveSlotsEquivalent: 2,
    });
    const gradState: UserCareerState = {
      1: { status: 'aprobada', grade: 9 },
      2: { status: 'promocionada', grade: 9 },
      3: { status: 'aprobada', grade: 10 },
      201: { status: 'aprobada', grade: 8 },
      202: { status: 'aprobada', grade: 9 },
    };
    const evaluatedGrad = evaluatePlanProgress({
      plan: planWithSlots,
      userState: gradState,
      settings: { ...DEFAULT_SETTINGS, includeAnalistaTrack: true, includeElectivesInProgress: true },
      examAttempts: [],
    });
    assert.equal(evaluatedGrad.progress.totalEquivalentSlots, 5);
    assert.equal(evaluatedGrad.progress.approvedEquivalentSlots, 5);
    assert.equal(evaluatedGrad.progress.percentageApproved, 100);
    assert.equal(evaluatedGrad.progress.isDegreeEligible, true);
    assert.equal(evaluatedGrad.progress.isPPSEligible, false);
    assert.equal(evaluatedGrad.progress.isAnalistaEligible, false);

    // Design guarantee (Point 5): electives with weeklyHours > 0 never enter careerPercentageByHours / totalWeeklyHours / approvedWeeklyHours
    const planWithOnlyCore1Approved = evaluatePlanProgress({
      plan: buildFictitious3LevelPlan({ requiredElectiveCredits: 10, electiveSlotsEquivalent: 2 }),
      userState: {
        1: { status: 'aprobada', grade: 9 }, // weeklyHours: 4
        201: { status: 'aprobada', grade: 9 }, // elective weeklyHours: 3
        202: { status: 'promocionada', grade: 8 }, // elective weeklyHours: 3
      },
      settings: { ...DEFAULT_SETTINGS, includeElectivesInProgress: true },
      examAttempts: [],
    });
    assert.equal(planWithOnlyCore1Approved.progress.totalWeeklyHours, 14); // 4 + 4 + 6 (excludes 3 + 3 + 3 of electives)
    assert.equal(planWithOnlyCore1Approved.progress.approvedWeeklyHours, 4); // excludes approved electives 201 & 202
    assert.equal(planWithOnlyCore1Approved.progress.careerPercentageByHours, Math.round((4 / 14) * 100));
  });

  it('gates the StatsDashboard PPS milestone card behind planConfig?.ppsRequirement', () => {
    const statsPath = path.resolve(rootDir, 'src/components/stats/StatsDashboard.tsx');
    const source = fs.readFileSync(statsPath, 'utf8');
    assert.match(
      source,
      /if\s*\(\s*planConfig\?\.ppsRequirement\s*\)\s*\{\s*list\.push\(\s*\{\s*id:\s*'pps'/,
      'StatsDashboard must only include PPS milestone when planConfig?.ppsRequirement is present'
    );
  });

  it('usuario con plan distinto de Sistemas y claves legadas no recibe migración automática ciega y delega al modal', () => {
    const legacySystemsState = { 1: { status: 'aprobada', grade: 9 }, 6: { status: 'cursando' } };
    const mockStorage = createMockStorage({
      [STORAGE_KEY_STATE]: JSON.stringify(legacySystemsState),
      [STORAGE_KEY_BASKET]: JSON.stringify([2, 6]),
      [STORAGE_KEY_SETTINGS]: JSON.stringify({ minPassingGrade: 6 }),
    });

    // Sin STORAGE_KEY_LEGACY_PLAN_ID no se sabe a qué plan pertenecen las claves legadas: NO migrar automáticamente
    const blockedAuto = migrateLegacyLocalStorageToPlan('plan-quimica-2023', mockStorage);
    assert.equal(blockedAuto.migrated, false);
    assert.deepStrictEqual(blockedAuto.copiedKeys, []);
    assert.equal(hasUnmigratedLegacyLocalStorage(mockStorage), true);
    assert.equal(
      mockStorage.getItem(getPlanStorageKey(STORAGE_KEY_STATE, 'plan-quimica-2023')),
      null
    );

    withMockLocalStorage(mockStorage, () => {
      assert.deepStrictEqual(loadUserState('plan-quimica-2023'), {});
    });

    // Incluso si tiene marcado explícitamente que era de Sistemas, otro plan tampoco lo auto-importa
    mockStorage.setItem(STORAGE_KEY_LEGACY_PLAN_ID, 'plan-isi-2023');
    const mismatchedPlanAuto = migrateLegacyLocalStorageToPlan('plan-quimica-2023', mockStorage);
    assert.equal(mismatchedPlanAuto.migrated, false);
    assert.deepStrictEqual(mismatchedPlanAuto.copiedKeys, []);
    assert.equal(hasUnmigratedLegacyLocalStorage(mockStorage), true);

    withMockLocalStorage(mockStorage, () => {
      assert.deepStrictEqual(loadUserState('plan-quimica-2023'), {});
    });

    // Cuando el usuario confirma explícitamente desde el modal (force: true) sí copia al plan destino
    const forcedResult = migrateLegacyLocalStorageToPlan('plan-isi-2023', mockStorage, { force: true });
    assert.equal(forcedResult.migrated, true);
    assert.equal(hasUnmigratedLegacyLocalStorage(mockStorage), false);
    assert.equal(
      mockStorage.getItem(getPlanStorageKey(STORAGE_KEY_STATE, 'plan-isi-2023')),
      JSON.stringify(legacySystemsState)
    );
  });

  it('performs idempotent copy-not-delete legacy localStorage migration when plan matches and isolates plans', () => {
    const mockStorage = createMockStorage({
      [STORAGE_KEY_LEGACY_PLAN_ID]: 'plan-isi-2023',
      [STORAGE_KEY_STATE]: JSON.stringify({ 1: { status: 'aprobada', grade: 9 } }),
      [STORAGE_KEY_BASKET]: JSON.stringify([2, 6]),
      [STORAGE_KEY_SETTINGS]: JSON.stringify({ minPassingGrade: 6 }),
    });

    const firstPass = migrateLegacyLocalStorageToPlan('plan-isi-2023', mockStorage);
    assert.equal(firstPass.migrated, true);
    assert.ok(firstPass.copiedKeys.includes(STORAGE_KEY_STATE));
    assert.ok(firstPass.copiedKeys.includes(STORAGE_KEY_BASKET));
    assert.ok(firstPass.copiedKeys.includes(STORAGE_KEY_SETTINGS));

    // Legacy keys are never deleted
    assert.ok(mockStorage.getItem(STORAGE_KEY_STATE) !== null);
    assert.ok(mockStorage.getItem(STORAGE_KEY_BASKET) !== null);
    assert.ok(mockStorage.getItem(STORAGE_KEY_SETTINGS) !== null);

    // Scoped keys receive copies
    assert.equal(
      mockStorage.getItem(getPlanStorageKey(STORAGE_KEY_STATE, 'plan-isi-2023')),
      JSON.stringify({ 1: { status: 'aprobada', grade: 9 } })
    );

    // Idempotent second run copies nothing (even when switching to another plan later)
    const secondPass = migrateLegacyLocalStorageToPlan('plan-isi-2023', mockStorage);
    assert.equal(secondPass.migrated, false);
    assert.deepStrictEqual(secondPass.copiedKeys, []);

    const otherPlanPass = migrateLegacyLocalStorageToPlan('plan-other', mockStorage);
    assert.equal(otherPlanPass.migrated, false);
    assert.deepStrictEqual(otherPlanPass.copiedKeys, []);

    withMockLocalStorage(mockStorage, () => {
      saveUserState({ 1: { status: 'aprobada', grade: 10 } }, 'plan-a');
      saveUserState({ 10: { status: 'cursando' } }, 'plan-b');

      assert.deepStrictEqual(loadUserState('plan-a'), { 1: { status: 'aprobada', grade: 10 } });
      assert.deepStrictEqual(loadUserState('plan-b'), { 10: { status: 'cursando' } });

      const exported = JSON.parse(
        exportCareerToJson(
          { 1: { status: 'aprobada', grade: 10 } },
          DEFAULT_SETTINGS,
          [],
          { 1: [] },
          { planId: 'plan-b', planTag: 'ICI · Plan 2024' }
        )
      );
      assert.equal(exported.plan, 'ICI · Plan 2024');
      assert.equal(exported.planId, 'plan-b');
      assert.notEqual(exported.plan, 'Plan 2023 ISI UTN');
    });
  });

  it('validates per-plan catalog cache, refreshes stale versions, handles 503 wake-up retries and never falls back across plans', async () => {
    const planA = buildFictitious3LevelPlan({ planId: 'plan-a' });
    const planB = buildFictitious3LevelPlan({ planId: 'plan-b' });
    const mockStorage = createMockStorage();

    // 1) Initial load writes cache
    let planFetchesA = 0;
    const initialA = await loadPlanCatalogSmart({
      planId: 'plan-a',
      storage: mockStorage,
      getVersion: async () => ({ success: true, version: 'v1' }),
      getPlan: async (id) => {
        planFetchesA++;
        assert.equal(id, 'plan-a');
        return { success: true, data: planA };
      },
    });
    assert.equal(initialA.fromCache, false);
    assert.equal(initialA.version, 'v1');
    assert.equal(planFetchesA, 1);
    assert.ok(readCachedCatalog('plan-a', mockStorage));

    // 2) Cache hit on matching version skips getPlan
    const hitA = await loadPlanCatalogSmart({
      planId: 'plan-a',
      storage: mockStorage,
      getVersion: async () => ({ success: true, version: 'v1' }),
      getPlan: async () => {
        throw new Error('getPlan must not be called when cache version matches');
      },
    });
    assert.equal(hitA.fromCache, true);
    assert.equal(hitA.staleOffline, false);
    assert.equal(hitA.catalog.plan.id, 'plan-a');

    // 3) Stale version refreshes getPlan and updates cache
    const updatedPlanA: ActivePlanCatalog = {
      ...planA,
      plan: { ...planA.plan, name: 'Plan A v2' },
    };
    const refreshedA = await loadPlanCatalogSmart({
      planId: 'plan-a',
      storage: mockStorage,
      getVersion: async () => ({ success: true, version: 'v2' }),
      getPlan: async () => ({ success: true, data: updatedPlanA }),
    });
    assert.equal(refreshedA.fromCache, false);
    assert.equal(refreshedA.version, 'v2');
    assert.equal(refreshedA.catalog.plan.name, 'Plan A v2');
    const cachedAfterUpdate = JSON.parse(
      mockStorage.getItem(getCatalogCacheKey('plan-a'))!
    );
    assert.equal(cachedAfterUpdate.version, 'v2');
    assert.equal(cachedAfterUpdate.schema, CATALOG_CACHE_SCHEMA);

    // 4) Transient 503 triggers onWakingChange(true) -> retries -> succeeds -> onWakingChange(false)
    let attemptsB = 0;
    const wakingEvents: boolean[] = [];
    const loadedB = await loadPlanCatalogSmart({
      planId: 'plan-b',
      storage: mockStorage,
      wakingDelayMs: 5000,
      maxRetries: 3,
      baseBackoffMs: 1,
      sleep: async () => {},
      onWakingChange: (waking) => wakingEvents.push(waking),
      getVersion: async () => ({ success: true, version: 'v1-b' }),
      getPlan: async () => {
        attemptsB++;
        if (attemptsB < 3) {
          const err = new Error('Service Unavailable') as Error & { status?: number };
          err.status = 503;
          throw err;
        }
        return { success: true, data: planB };
      },
    });
    assert.equal(attemptsB, 3);
    assert.equal(loadedB.catalog.plan.id, 'plan-b');
    assert.deepStrictEqual(wakingEvents, [true, false]);

    // 5) Missing cache for plan-c must throw when network fails, never falling back to plan-a or Sistemas
    await assert.rejects(
      () =>
        loadPlanCatalogSmart({
          planId: 'plan-c',
          storage: mockStorage,
          maxRetries: 1,
          baseBackoffMs: 1,
          sleep: async () => {},
          getPlan: async () => {
            const err = new Error('Backend down') as Error & { status?: number };
            err.status = 503;
            throw err;
          },
        }),
      /Backend down/
    );
  });

  it('ignores outdated or schema-less catalog caches when CATALOG_CACHE_SCHEMA does not match', async () => {
    const planLegacy = buildFictitious3LevelPlan({ planId: 'plan-schema-test' });
    const freshCatalog: ActivePlanCatalog = {
      ...planLegacy,
      plan: { ...planLegacy.plan, name: 'Plan Fresh Schema' },
    };
    const mockStorage = createMockStorage();

    // Case A: old cache without schema property
    mockStorage.setItem(
      getCatalogCacheKey('plan-schema-test'),
      JSON.stringify({
        planId: 'plan-schema-test',
        version: 'v1',
        cachedAt: '2026-01-01T00:00:00.000Z',
        catalog: planLegacy,
      })
    );
    assert.equal(readCachedCatalog('plan-schema-test', mockStorage), null);

    assert.equal(CATALOG_CACHE_SCHEMA, 6);

    // Case B: cache with outdated schema number (specifically schema: 5)
    mockStorage.setItem(
      getCatalogCacheKey('plan-schema-test'),
      JSON.stringify({
        schema: 5,
        planId: 'plan-schema-test',
        version: 'v1',
        cachedAt: '2026-01-01T00:00:00.000Z',
        catalog: planLegacy,
      })
    );
    assert.equal(readCachedCatalog('plan-schema-test', mockStorage), null);

    let remotePlanCalls = 0;
    const loaded = await loadPlanCatalogSmart({
      planId: 'plan-schema-test',
      storage: mockStorage,
      getVersion: async () => ({ success: true, version: 'v1' }),
      getPlan: async () => {
        remotePlanCalls++;
        return { success: true, data: freshCatalog };
      },
      onImmediateCache: () => {
        throw new Error('onImmediateCache must not be called for outdated cache schema');
      },
    });

    assert.equal(remotePlanCalls, 1);
    assert.equal(loaded.fromCache, false);
    assert.equal(loaded.catalog.plan.name, 'Plan Fresh Schema');

    // Re-stored entry now includes current CATALOG_CACHE_SCHEMA and passes readCachedCatalog
    const reStoredRaw = JSON.parse(
      mockStorage.getItem(getCatalogCacheKey('plan-schema-test'))!
    );
    assert.equal(reStoredRaw.schema, CATALOG_CACHE_SCHEMA);
    assert.equal(readCachedCatalog('plan-schema-test', mockStorage)?.schema, CATALOG_CACHE_SCHEMA);

    // Explicitly verify writeCachedCatalog stamps schema
    const directStorage = createMockStorage();
    writeCachedCatalog('current', 'v9', freshCatalog, directStorage);
    const written = readCachedCatalog('current', directStorage);
    assert.ok(written);
    assert.equal(written.schema, CATALOG_CACHE_SCHEMA);
    assert.equal(written.catalog.plan.id, 'plan-schema-test');
  });

  it('rejects malformed or incomplete catalog payloads as outdated server without caching them', async () => {
    const validCatalog = buildFictitious3LevelPlan({ planId: 'plan-shape-test' });
    assert.equal(isValidPlanCatalogShape(validCatalog), true);
    assert.equal(
      isValidPlanCatalogShape({
        ...validCatalog,
        career: {
          ...validCatalog.career,
          facultyName: 'Facultad Regional Córdoba',
          institutionName: 'Universidad Tecnológica Nacional',
          facultyCode: 'FRC',
          institutionCode: 'UTN',
        },
        plan: {
          ...validCatalog.plan,
          config: {
            ...validCatalog.plan.config,
            finalDegreeTitle: 'Técnico/a Demo',
            ppsRequirement: { referenceSubjectCode: 3, label: 'Habilitación PPS' },
          },
        },
        subjects: validCatalog.subjects.map((s, idx) =>
          idx === 0 ? { ...s, isIntegrator: true, specialRule: 'Regla especial de prueba.' } : s
        ),
      }),
      true
    );

    const invalidVariants: Array<{ label: string; payload: unknown }> = [
      {
        label: 'sin career',
        payload: { ...validCatalog, career: undefined },
      },
      {
        label: 'con career.facultyName vacío',
        payload: { ...validCatalog, career: { ...validCatalog.career, facultyName: '' } },
      },
      {
        label: 'con career.institutionName no string',
        payload: { ...validCatalog, career: { ...validCatalog.career, institutionName: 123 } },
      },
      {
        label: 'con plan.config.finalDegreeTitle vacío',
        payload: {
          ...validCatalog,
          plan: {
            ...validCatalog.plan,
            config: { ...validCatalog.plan.config, finalDegreeTitle: '  ' },
          },
        },
      },
      {
        label: 'con plan.config.ppsRequirement.label vacío',
        payload: {
          ...validCatalog,
          plan: {
            ...validCatalog.plan,
            config: {
              ...validCatalog.plan.config,
              ppsRequirement: { referenceSubjectCode: 3, label: '' },
            },
          },
        },
      },
      {
        label: 'con plan.config.ppsRequirement.description vacío',
        payload: {
          ...validCatalog,
          plan: {
            ...validCatalog.plan,
            config: {
              ...validCatalog.plan.config,
              ppsRequirement: { referenceSubjectCode: 3, description: '   ' },
            },
          },
        },
      },
      {
        label: 'con plan.config.intermediateDegrees[0].shortLabel vacío',
        payload: {
          ...validCatalog,
          plan: {
            ...validCatalog.plan,
            config: {
              ...validCatalog.plan.config,
              intermediateDegrees: [{ key: 'inter', name: 'Intermedio', shortLabel: '' }],
            },
          },
        },
      },
      {
        label: 'con plan.config.intermediateDegrees[0].shortTitle vacío',
        payload: {
          ...validCatalog,
          plan: {
            ...validCatalog.plan,
            config: {
              ...validCatalog.plan.config,
              intermediateDegrees: [{ key: 'inter', name: 'Intermedio', shortTitle: '  ' }],
            },
          },
        },
      },
      {
        label: 'sin plan.config.totalLevels',
        payload: {
          ...validCatalog,
          plan: {
            ...validCatalog.plan,
            config: { ...validCatalog.plan.config, totalLevels: undefined },
          },
        },
      },
      {
        label: 'sin plan.config.levelLabel',
        payload: {
          ...validCatalog,
          plan: {
            ...validCatalog.plan,
            config: { ...validCatalog.plan.config, levelLabel: '' },
          },
        },
      },
      {
        label: 'sin subjects[].shortName',
        payload: {
          ...validCatalog,
          subjects: validCatalog.subjects.map((s, idx) =>
            idx === 0 ? { ...s, shortName: '' } : s
          ),
        },
      },
      {
        label: 'con subjects[].isIntegrator no booleano',
        payload: {
          ...validCatalog,
          subjects: validCatalog.subjects.map((s, idx) =>
            idx === 0 ? { ...s, isIntegrator: 'true' } : s
          ),
        },
      },
      {
        label: 'con subjects[].specialRule vacío',
        payload: {
          ...validCatalog,
          subjects: validCatalog.subjects.map((s, idx) =>
            idx === 0 ? { ...s, specialRule: '   ' } : s
          ),
        },
      },
      {
        label: 'sin rules',
        payload: { ...validCatalog, rules: undefined },
      },
      {
        label: 'sin acronyms',
        payload: { ...validCatalog, acronyms: null },
      },
    ];

    for (const variant of invalidVariants) {
      assert.equal(
        isValidPlanCatalogShape(variant.payload),
        false,
        `isValidPlanCatalogShape debe rechazar payload ${variant.label}`
      );

      const mockStorage = createMockStorage();
      await assert.rejects(
        () =>
          loadPlanCatalogSmart({
            planId: 'plan-shape-test',
            storage: mockStorage,
            maxRetries: 2,
            baseBackoffMs: 1,
            getVersion: async () => ({ success: true, version: 'v1' }),
            getPlan: async () => ({
              success: true,
              data: variant.payload as ActivePlanCatalog,
            }),
          }),
        (err: unknown) =>
          err instanceof CatalogShapeError &&
          /el servidor está desactualizado/i.test(err.message),
        `loadPlanCatalogSmart debe fallar por servidor desactualizado ante ${variant.label}`
      );
      assert.equal(
        mockStorage.getItem(getCatalogCacheKey('plan-shape-test')),
        null,
        `No debe cachear payload inválido (${variant.label})`
      );
    }

    // Even when a valid v1 cache existed, an invalid v2 payload must throw and never overwrite the cache
    const cachedStorage = createMockStorage();
    writeCachedCatalog('plan-shape-test', 'v1', validCatalog, cachedStorage);
    const invalidV2Payload = {
      ...validCatalog,
      subjects: validCatalog.subjects.map((s) => ({ ...s, shortName: undefined })),
    };

    await assert.rejects(
      () =>
        loadPlanCatalogSmart({
          planId: 'plan-shape-test',
          storage: cachedStorage,
          getVersion: async () => ({ success: true, version: 'v2' }),
          getPlan: async () => ({
            success: true,
            data: invalidV2Payload as unknown as ActivePlanCatalog,
          }),
        }),
      /el servidor está desactualizado/i
    );

    const preservedCache = readCachedCatalog('plan-shape-test', cachedStorage);
    assert.ok(preservedCache, 'El caché v1 previo válido no debe corromperse ni borrarse');
    assert.equal(preservedCache.version, 'v1');
  });

  it('rejects an exact master-era /api/catalog/plans/current payload, triggers error+retry state without fallback, and recovers on retry', async () => {
    const mockStorage = createMockStorage();
    // Payload exacto emitido por master:server/src/modules/catalog/catalog.controller.ts (getPlan):
    // sin `career`, sin `plan.config.totalLevels/levelLabel`, con `ppsSubjectCode: 36` y `subjects[].shortName` ausente (`code` = acrónimo).
    const masterBackendPlanPayload = {
      plan: {
        id: 'plan-isi-2023-uuid',
        name: 'Plan 2023',
        year: 2023,
        config: {
          requiredElectiveCredits: 20,
          defaultMinPassingGrade: 4,
          intermediateDegrees: [
            {
              key: 'analista',
              name: 'Analista Universitario en Sistemas',
              specialRuleSubjectCode: 99,
            },
          ],
          ppsSubjectCode: 36,
        },
        updatedAt: '2026-04-01T00:00:00.000Z',
      },
      subjects: [
        {
          id: 1,
          uuid: 'subj-1-uuid',
          code: 'AM1',
          name: 'Análisis Matemático I',
          level: 1,
          modality: 'anual',
          contraCuatrimestral: false,
          weeklyHours: 5,
          isElective: false,
          isOptionalTrack: false,
          regularPrereqs: [],
          approvedPrereqs: [],
        },
        {
          id: 36,
          uuid: 'subj-36-uuid',
          code: 'PFS',
          name: 'Proyecto Final',
          level: 5,
          modality: 'anual',
          contraCuatrimestral: false,
          weeklyHours: 6,
          isElective: false,
          isOptionalTrack: false,
          regularPrereqs: [1],
          approvedPrereqs: [],
        },
      ],
      rules: [
        {
          id: 'rule-pps-uuid',
          subjectCode: 36,
          ruleType: 'all_prior_and_all_level_regular',
          params: { targetLevel: 5 },
          description: 'Regla PPS',
        },
      ],
      acronyms: { AM1: 1, PFS: 36 },
    };

    assert.equal(isValidPlanCatalogShape(masterBackendPlanPayload), false);

    let backendUpgraded = false;
    const upgradedHeadCatalog = buildFictitious3LevelPlan({ planId: 'plan-isi-2023-uuid' });

    let hydration = createCareerHydrationState();
    let catalogStatus: 'loading' | 'ready' | 'error' = 'loading';
    let catalogError: string | null = null;
    let activeCatalog: ActivePlanCatalog | null = null;
    let stateFetchCount = 0;

    const runLoad = () => {
      catalogStatus = 'loading';
      catalogError = null;
      return executeServerReloadCycle<ActivePlanCatalog, { ok: boolean }>({
        getState: () => hydration,
        setState: (next) => {
          hydration = next;
        },
        loadCatalog: () =>
          loadPlanCatalogSmart({
            planId: 'current',
            storage: mockStorage,
            maxRetries: 2,
            baseBackoffMs: 1,
            getVersion: async () => ({ success: true, version: backendUpgraded ? 'v-head' : 'v-master' }),
            getPlan: async () => ({
              success: true,
              data: (backendUpgraded
                ? upgradedHeadCatalog
                : masterBackendPlanPayload) as unknown as ActivePlanCatalog,
            }),
          }),
        applyCatalogToUi: (cat) => {
          activeCatalog = cat;
          catalogStatus = 'ready';
        },
        fetchServerState: async () => {
          stateFetchCount += 1;
          return { success: true, data: { ok: true } };
        },
        applyServerStateToUi: () => {},
        onCatalogError: (err) => {
          activeCatalog = null;
          catalogStatus = 'error';
          catalogError = err instanceof Error ? err.message : 'Error desconocido';
        },
      });
    };

    const firstOutcome = await runLoad();
    assert.equal(firstOutcome.status, 'catalog_error');
    assert.equal(catalogStatus, 'error', 'Debe activar pantalla de error ante payload viejo de master');
    assert.match(catalogError ?? '', /servidor está desactualizado/i);
    assert.equal(activeCatalog, null, 'No debe aplicar catálogo de respaldo estático ante payload viejo');
    assert.equal(stateFetchCount, 0, 'No debe hidratar ni sincronizar estado si falla la forma del catálogo');
    assert.equal(mockStorage.length, 0, 'No debe cachear ni guardar puntero current ante payload de master');

    // Simula que el usuario presiona "Reintentar" luego de actualizarse el backend
    backendUpgraded = true;
    const retryOutcome = await runLoad();
    assert.equal(retryOutcome.status, 'hydrated');
    assert.equal(catalogStatus, 'ready');
    assert.equal(catalogError, null);
    assert.equal(activeCatalog?.plan.id, 'plan-isi-2023-uuid');
    assert.equal(stateFetchCount, 1);
  });

  it('builds explicit schedule unavailable messages for backend errors and empty plans without static fallback', () => {
    const errorFallback = getScheduleUnavailableMessage('backend-error');
    assert.match(errorFallback, /servidor/i);
    assert.match(errorFallback, /intentá/i);

    const errorCustom = getScheduleUnavailableMessage('backend-error', {
      errorDetail: 'Timeout al consultar horarios',
    });
    assert.equal(errorCustom, 'Timeout al consultar horarios');

    const noScheduleMsg = getScheduleUnavailableMessage('no-schedule', {
      planName: 'Plan 2026',
    });
    assert.match(noScheduleMsg, /Plan 2026/);
    assert.match(noScheduleMsg, /horarios/i);

    const noticeSrc = fs.readFileSync(
      path.resolve(rootDir, 'src/components/schedule/ScheduleUnavailableNotice.tsx'),
      'utf8'
    );
    assert.match(noticeSrc, /Reintentar/, 'Notice debe incluir botón Reintentar ante error de servidor');
    assert.match(noticeSrc, /no-schedule/, 'Notice debe soportar estado sin oferta horaria cargada');
  });

  it('contains zero static Sistemas/schedule data modules or ISI career fallbacks inside src/', () => {
    assert.equal(
      fs.existsSync(path.resolve(rootDir, 'src/data/schedule.ts')),
      false,
      'src/data/schedule.ts debe haberse eliminado'
    );
    assert.equal(
      fs.existsSync(path.resolve(rootDir, 'src/data/schedule.json')),
      false,
      'src/data/schedule.json debe haberse eliminado'
    );

    const srcDir = path.resolve(rootDir, 'src');
    const forbiddenModulePattern =
      /from\s+['"][^'"]*(?:data\/plan2023|data\/electives|data\/acronyms|data\/subjectAliases|data\/schedule|test\/fixtures)/;
    const forbiddenIsiGuardPattern = /career\??\.code\s*===\s*['"]ISI['"]|\bisIsi2023\b/;
    const violations: string[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (forbiddenModulePattern.test(content) || forbiddenIsiGuardPattern.test(content)) {
            violations.push(path.relative(rootDir, fullPath));
          }
        }
      }
    }

    walk(srcDir);
    assert.deepStrictEqual(
      violations,
      [],
      `Found forbidden static Sistemas/schedule imports or ISI guards in src/: ${violations.join(', ')}`
    );
  });

  it('ProfessorsDirectory filters by numeric subject.id rather than formatted code strings like E-301', () => {
    const dirSrc = fs.readFileSync(
      path.resolve(rootDir, 'src/components/professors/ProfessorsDirectory.tsx'),
      'utf8'
    );
    const idOptionMatches = dirSrc.match(/<option key=\{sub\.id\} value=\{String\(sub\.id\)\}>/g) || [];
    assert.equal(
      idOptionMatches.length,
      2,
      'ProfessorsDirectory debe enviar String(sub.id) en los dos selectores de materia (desktop y mobile)'
    );
    assert.equal(
      /value=\{String\(sub\.code\)\}/.test(dirSrc),
      false,
      'ProfessorsDirectory no debe enviar sub.code ("E-301", "X-408") al endpoint subjectId del backend'
    );
  });
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Career hydration guard (data-overwrite protection)', () => {
  const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(__dirnameLocal, '..');

  it('(a) blocks all server auto-sync calls until userStateApi.getState completes for the active plan', async () => {
    let hydration = createCareerHydrationState();
    const serverWrites: Array<{ planId: string; op: string }> = [];

    const attemptServerSync = (op: string, targetPlanId: string | null) => {
      if (canSyncServerState(true, hydration, targetPlanId)) {
        serverWrites.push({ planId: targetPlanId ?? 'unknown', op });
      }
    };

    // Unauthenticated or pre-reload mutations never touch server
    assert.equal(canSyncServerState(false, hydration), false);
    assert.equal(canSyncServerState(true, hydration), false);
    attemptServerSync('updateProgress', 'plan-a');
    assert.equal(serverWrites.length, 0);

    const pendingState = createDeferred<{
      success: boolean;
      data: { progress: Record<number, { status: string }> };
    }>();
    const uiApplied: string[] = [];

    const cyclePromise = executeServerReloadCycle({
      getState: () => hydration,
      setState: (next) => {
        hydration = next;
      },
      loadCatalog: async ({ onImmediateCache }) => {
        const cached = { plan: { id: 'plan-a', name: 'Plan A' } };
        onImmediateCache(cached);
        return { catalog: cached };
      },
      applyCatalogToUi: (cat) => {
        uiApplied.push(`catalog:${cat.plan.id}`);
      },
      fetchServerState: () => pendingState.promise,
      applyServerStateToUi: (_data, cat) => {
        uiApplied.push(`server:${cat.plan.id}`);
      },
    });

    // Wait microtasks so loadCatalog resolves and fetchServerState is in-flight
    await new Promise((r) => setTimeout(r, 0));

    // Catalog is already displayed and scoped localStorage is ready, BUT server hydration has not finished yet
    assert.equal(hydration.hydratedStoragePlanId, 'plan-a');
    assert.equal(hydration.hasHydrated, false);
    assert.equal(hydration.hydratedServerPlanId, null);
    assert.equal(canPersistScopedStorage('plan-a', hydration), true);
    assert.equal(canSyncServerState(true, hydration), false);
    assert.equal(canSyncServerState(true, hydration, 'plan-a'), false);

    // Simulated progress/settings/basket/simulation actions while server state is loading send 0 server writes
    attemptServerSync('updateProgress', 'plan-a');
    attemptServerSync('updateSettings', 'plan-a');
    attemptServerSync('updateElectives', 'plan-a');
    attemptServerSync('updateBasket', 'plan-a');
    attemptServerSync('applySimulation', 'plan-a');
    assert.equal(serverWrites.length, 0);

    // Once userStateApi.getState resolves cleanly, server sync unlocks for plan-a
    pendingState.resolve({
      success: true,
      data: { progress: { 1: { status: 'aprobada' } } },
    });
    const outcome = await cyclePromise;
    assert.equal(outcome.status, 'hydrated');
    assert.equal(hydration.hasHydrated, true);
    assert.equal(hydration.hydratedServerPlanId, 'plan-a');
    assert.equal(canSyncServerState(true, hydration, 'plan-a'), true);

    attemptServerSync('updateProgress', 'plan-a');
    assert.deepEqual(serverWrites, [{ planId: 'plan-a', op: 'updateProgress' }]);
    assert.deepEqual(uiApplied, ['catalog:plan-a', 'server:plan-a']);
  });

  it('(b) keeps server sync locked and never syncs empty defaults when catalog load or getState fails', async () => {
    // b1: catalog fetch rejects
    {
      let hydration: CareerHydrationState = completeServerStateHydration(
        beginServerReload(createCareerHydrationState()).state,
        1,
        'plan-a'
      );
      let catalogErrorCalled = false;
      const serverWrites: string[] = [];

      const outcome = await executeServerReloadCycle({
        getState: () => hydration,
        setState: (next) => {
          hydration = next;
        },
        loadCatalog: async () => {
          throw new Error('503 Service Unavailable');
        },
        applyCatalogToUi: () => {
          throw new Error('should not apply catalog on failure');
        },
        fetchServerState: async () => {
          throw new Error('should not fetch userState after catalog failure');
        },
        applyServerStateToUi: () => {
          throw new Error('should not apply state on failure');
        },
        onCatalogError: () => {
          catalogErrorCalled = true;
        },
      });

      assert.equal(outcome.status, 'catalog_error');
      assert.equal(catalogErrorCalled, true);
      assert.equal(hydration.hasHydrated, false);
      assert.equal(hydration.hydratedStoragePlanId, null);
      assert.equal(hydration.hydratedServerPlanId, null);
      assert.equal(canSyncServerState(true, hydration), false);
      assert.equal(canPersistScopedStorage('plan-a', hydration), false);
      if (canSyncServerState(true, hydration)) serverWrites.push('empty-overwrite');
      assert.equal(serverWrites.length, 0);
    }

    // b2: catalog succeeds, fetchServerState throws network/500 error
    {
      let hydration = createCareerHydrationState();
      const serverWrites: string[] = [];

      const outcome = await executeServerReloadCycle({
        getState: () => hydration,
        setState: (next) => {
          hydration = next;
        },
        loadCatalog: async () => ({ catalog: { plan: { id: 'plan-a', name: 'Plan A' } } }),
        applyCatalogToUi: () => {},
        fetchServerState: async () => {
          throw new Error('Failed to fetch user state');
        },
        applyServerStateToUi: () => {
          throw new Error('should not apply state');
        },
      });

      assert.equal(outcome.status, 'state_error');
      assert.equal(hydration.hasHydrated, false);
      assert.equal(hydration.hydratedServerPlanId, null);
      assert.equal(canSyncServerState(true, hydration, 'plan-a'), false);
      if (canSyncServerState(true, hydration, 'plan-a')) serverWrites.push('empty-overwrite');
      assert.equal(serverWrites.length, 0);
    }

    // b3: catalog succeeds, fetchServerState returns { success: false, data: null }
    {
      let hydration = createCareerHydrationState();
      const serverWrites: string[] = [];

      const outcome = await executeServerReloadCycle({
        getState: () => hydration,
        setState: (next) => {
          hydration = next;
        },
        loadCatalog: async () => ({ catalog: { plan: { id: 'plan-a', name: 'Plan A' } } }),
        applyCatalogToUi: () => {},
        fetchServerState: async () => ({ success: false, data: null }),
        applyServerStateToUi: () => {
          throw new Error('should not apply state when unavailable');
        },
      });

      assert.equal(outcome.status, 'state_unavailable');
      assert.equal(hydration.hasHydrated, false);
      assert.equal(hydration.hydratedServerPlanId, null);
      assert.equal(canSyncServerState(true, hydration, 'plan-a'), false);
      if (canSyncServerState(true, hydration, 'plan-a')) serverWrites.push('empty-overwrite');
      assert.equal(serverWrites.length, 0);
    }

    // b4: CareerContext actually wires executeServerReloadCycle, canSyncServerState, canPersistScopedStorage & applySimulation guard
    const contextSrc = fs.readFileSync(
      path.resolve(rootDir, 'src/context/CareerContext.tsx'),
      'utf8'
    );
    assert.ok(contextSrc.includes('executeServerReloadCycle'));
    assert.ok(contextSrc.includes('canPersistScopedStorage(scopedPlanId, hydrationStateRef.current)'));
    assert.ok(contextSrc.includes('resetHydrationOnLogout(hydrationStateRef.current)'));
    assert.match(
      contextSrc,
      /const applySimulation = useCallback[\s\S]*?canSyncServerState\(isAuthenticated,\s*hydrationStateRef\.current/
    );
  });

  it('(c) resets hydration synchronously on Plan A -> Plan B switch and drops late Plan A responses without cross-plan leaks', async () => {
    // 1. Start fully hydrated on Plan A
    let hydration = completeServerStateHydration(
      applyCatalogSnapshot(beginServerReload(createCareerHydrationState()).state, 1, 'plan-a'),
      1,
      'plan-a'
    );
    assert.equal(canSyncServerState(true, hydration, 'plan-a'), true);
    assert.equal(canSyncServerState(true, hydration, 'plan-b'), false);

    // 2. User switches to Plan B while Plan A's background reload & Plan B's slow load race
    const planACatalogDef = createDeferred<{ catalog: { plan: { id: string; name: string } } }>();
    const planBCatalogDef = createDeferred<{ catalog: { plan: { id: string; name: string } } }>();
    const planBStateDef = createDeferred<{
      success: boolean;
      data: { marker: string };
    }>();

    const appliedCatalogs: string[] = [];
    const appliedStates: Array<{ planId: string; marker: string }> = [];
    const serverWrites: Array<{ planId: string; marker: string }> = [];

    // Start reload for Plan A (will lag)
    const planAReload = executeServerReloadCycle({
      getState: () => hydration,
      setState: (next) => {
        hydration = next;
      },
      loadCatalog: () => planACatalogDef.promise,
      applyCatalogToUi: (cat) => appliedCatalogs.push(cat.plan.id),
      fetchServerState: async () => ({ success: true, data: { marker: 'A-stale' } }),
      applyServerStateToUi: (d, cat) => appliedStates.push({ planId: cat.plan.id, marker: d.marker }),
    });

    // Synchronously verify reload start already invalidated previous Plan A hydration
    assert.equal(hydration.hasHydrated, false);
    assert.equal(hydration.hydratedStoragePlanId, null);
    assert.equal(canSyncServerState(true, hydration, 'plan-a'), false);
    assert.equal(canPersistScopedStorage('plan-a', hydration), false);

    // Now switch immediately to Plan B BEFORE Plan A resolves
    const planBReload = executeServerReloadCycle({
      getState: () => hydration,
      setState: (next) => {
        hydration = next;
      },
      loadCatalog: () => planBCatalogDef.promise,
      applyCatalogToUi: (cat) => appliedCatalogs.push(cat.plan.id),
      fetchServerState: () => planBStateDef.promise,
      applyServerStateToUi: (d, cat) => appliedStates.push({ planId: cat.plan.id, marker: d.marker }),
    });

    // While Plan B is loading, NEITHER Plan A nor Plan B may sync or persist storage
    assert.equal(hydration.hasHydrated, false);
    assert.equal(hydration.hydratedStoragePlanId, null);
    assert.equal(hydration.hydratedServerPlanId, null);
    assert.equal(canSyncServerState(true, hydration, 'plan-a'), false);
    assert.equal(canSyncServerState(true, hydration, 'plan-b'), false);
    assert.equal(canPersistScopedStorage('plan-a', hydration), false);
    assert.equal(canPersistScopedStorage('plan-b', hydration), false);

    // Resolve Plan B completely first
    planBCatalogDef.resolve({ catalog: { plan: { id: 'plan-b', name: 'Plan B' } } });
    planBStateDef.resolve({ success: true, data: { marker: 'B-fresh' } });
    const planBOutcome = await planBReload;
    assert.equal(planBOutcome.status, 'hydrated');
    assert.equal(hydration.hydratedServerPlanId, 'plan-b');
    assert.equal(hydration.hydratedStoragePlanId, 'plan-b');

    // Now resolve the stale Plan A promise AFTER Plan B is active & hydrated
    planACatalogDef.resolve({ catalog: { plan: { id: 'plan-a', name: 'Plan A' } } });
    const planAOutcome = await planAReload;
    assert.equal(planAOutcome.status, 'aborted');

    // Plan A must NEVER overwrite Plan B's catalog, UI state, storage scope, or server hydration target
    assert.deepEqual(appliedCatalogs, ['plan-b']);
    assert.deepEqual(appliedStates, [{ planId: 'plan-b', marker: 'B-fresh' }]);
    assert.equal(hydration.hasHydrated, true);
    assert.equal(hydration.hydratedServerPlanId, 'plan-b');
    assert.equal(canSyncServerState(true, hydration, 'plan-a'), false);
    assert.equal(canSyncServerState(true, hydration, 'plan-b'), true);
    assert.equal(canPersistScopedStorage('plan-a', hydration), false);
    assert.equal(canPersistScopedStorage('plan-b', hydration), true);

    if (canSyncServerState(true, hydration, 'plan-a')) {
      serverWrites.push({ planId: 'plan-a', marker: 'leak' });
    }
    if (canSyncServerState(true, hydration, 'plan-b')) {
      serverWrites.push({ planId: 'plan-b', marker: 'B-fresh' });
    }
    assert.deepEqual(serverWrites, [{ planId: 'plan-b', marker: 'B-fresh' }]);

    // Logout while a Plan C reload is in-flight also aborts stale completion
    const planCStateDef = createDeferred<{ success: boolean; data: { marker: string } }>();
    const planCReload = executeServerReloadCycle({
      getState: () => hydration,
      setState: (next) => {
        hydration = next;
      },
      loadCatalog: async () => ({ catalog: { plan: { id: 'plan-c', name: 'Plan C' } } }),
      applyCatalogToUi: () => {},
      fetchServerState: () => planCStateDef.promise,
      applyServerStateToUi: () => {
        throw new Error('must not hydrate after logout');
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    hydration = resetHydrationOnLogout(hydration);
    planCStateDef.resolve({ success: true, data: { marker: 'C-after-logout' } });
    const planCOutcome = await planCReload;
    assert.equal(planCOutcome.status, 'aborted');
    assert.equal(hydration.hasHydrated, false);
    assert.equal(canSyncServerState(false, hydration), false);
  });
});

describe('Ingeniería Ficticia 5-level engine evaluation', () => {
  it('evaluates the 5-level Ingeniería Ficticia plan across user states in real correlativas.ts engine', () => {
    const rawSubjects = [
      { codeInPlan: 1, displayCode: 'IFIC-1', name: 'Dibujo Técnico', shortName: 'Dibujo Téc.', level: 1, modality: 'A', contraCuatrimestral: false, weeklyHours: 4, kind: 'obligatoria', credits: null, isOptionalTrack: false, trackKey: null, isIntegrator: false },
      { codeInPlan: 2, displayCode: 'IFIC-2', name: 'Física General', shortName: 'Física Gral.', level: 1, modality: 'A', contraCuatrimestral: false, weeklyHours: 6, kind: 'obligatoria', credits: null, isOptionalTrack: false, trackKey: null, isIntegrator: false },
      { codeInPlan: 3, displayCode: 'IFIC-3', name: 'Termodinámica Básica', shortName: 'Termodinámica', level: 2, modality: '1C', contraCuatrimestral: false, weeklyHours: 5, kind: 'obligatoria', credits: null, isOptionalTrack: false, trackKey: null, isIntegrator: false },
      { codeInPlan: 4, displayCode: 'IFIC-4', name: 'Taller de Diseño Aplicado', shortName: 'Taller Diseño', level: 2, modality: '2C', contraCuatrimestral: false, weeklyHours: 4, kind: 'obligatoria', credits: null, isOptionalTrack: false, trackKey: null, isIntegrator: true },
      { codeInPlan: 5, displayCode: 'IFIC-5', name: 'Taller Intermedio de Síntesis', shortName: 'Taller Síntesis', level: 3, modality: 'A', contraCuatrimestral: false, weeklyHours: 6, kind: 'obligatoria', credits: null, isOptionalTrack: false, trackKey: null, isIntegrator: true },
      { codeInPlan: 6, displayCode: 'IFIC-6', name: 'Ingeniería de Procesos Ficticios', shortName: 'Ing. Procesos', level: 4, modality: '1C', contraCuatrimestral: false, weeklyHours: 6, kind: 'obligatoria', credits: null, isOptionalTrack: false, trackKey: null, isIntegrator: false },
      { codeInPlan: 7, displayCode: 'IFIC-7', name: 'Práctica Profesional Ficticia', shortName: 'Práctica Fict.', level: 4, modality: '2C', contraCuatrimestral: false, weeklyHours: 4, kind: 'obligatoria', credits: null, isOptionalTrack: false, trackKey: null, isIntegrator: false },
      { codeInPlan: 8, displayCode: 'IFIC-8', name: 'Proyecto Integrador Final', shortName: 'Proyecto Final', level: 5, modality: 'A', contraCuatrimestral: false, weeklyHours: 8, kind: 'obligatoria', credits: null, isOptionalTrack: false, trackKey: null, isIntegrator: true },
      { codeInPlan: 101, displayCode: 'ELEC-101', name: 'Seminario Ficticio Alpha', shortName: 'Seminario Alpha', level: 4, modality: '1C-CC', contraCuatrimestral: true, weeklyHours: 4, kind: 'electiva', credits: 4, isOptionalTrack: false, trackKey: null, isIntegrator: false },
      { codeInPlan: 102, displayCode: 'ELEC-102', name: 'Laboratorio Ficticio Beta', shortName: 'Lab. Beta', level: 5, modality: '2C', contraCuatrimestral: false, weeklyHours: 4, kind: 'electiva', credits: 6, isOptionalTrack: false, trackKey: null, isIntegrator: false },
    ];
    const idFor = (code: number) => `ific-sub-${code}`;
    const prereqPairs: Array<[number, number, 'regular' | 'approved']> = [
      [3, 2, 'regular'],
      [4, 1, 'approved'],
      [5, 3, 'regular'],
      [5, 4, 'regular'],
      [6, 5, 'regular'],
      [7, 3, 'approved'],
      [7, 4, 'approved'],
      [7, 5, 'regular'],
      [8, 5, 'approved'],
      [8, 6, 'regular'],
      [101, 3, 'regular'],
      [102, 6, 'regular'],
    ];

    const fictitiousPlan = formatPlanCatalogPayload({
      plan: {
        id: 'plan-ific-2026',
        name: 'Plan Ingeniería Ficticia 2026',
        year: 2026,
        updatedAt: '2026-01-01T00:00:00.000Z',
        config: {
          levelLabel: 'Año',
          totalLevels: 5,
          requiredElectiveCredits: 6,
          electiveSlotsEquivalent: 2,
          defaultMinPassingGrade: 6,
          finalDegreeTitle: 'Ingeniero/a Ficticio/a',
          shortTag: 'IFIC · Plan 2026',
          ppsRequirement: {
            referenceSubjectCode: 7,
            label: 'Habilitación Práctica Ficticia',
            description: 'Cumplís los requisitos para cursar la práctica supervisada ficticia.',
          },
          intermediateDegrees: [
            {
              key: 'tecnico',
              name: 'Técnico/a Universitario/a Ficticio/a',
              shortLabel: 'Técnico',
              shortTitle: 'Técnico Ficticio',
              requiredElectiveCredits: 4,
              specialRuleSubjectCode: 5,
            },
          ],
        },
      },
      career: {
        id: 'career-ific',
        name: 'Ingeniería Ficticia',
        code: 'IFIC',
        facultyId: 'fac-ficticia',
      },
      subjects: rawSubjects.map((s) => ({ ...s, id: idFor(s.codeInPlan) })),
      prerequisites: prereqPairs.map(([sub, req, type]) => ({
        subjectId: idFor(sub),
        requiresSubjectId: idFor(req),
        type,
      })),
      rules: [
        {
          id: 'rule-intermedio',
          subjectId: idFor(5),
          ruleType: 'approved_range',
          params: { fromCode: 1, toCode: 4 },
          description: 'Obligatorias 1 a 4 aprobadas requeridas.',
        },
        {
          id: 'rule-final',
          subjectId: idFor(8),
          ruleType: 'all_previous_core_approved',
          params: {},
          description: 'Todas las obligatorias previas aprobadas.',
        },
      ],
      acronyms: [
        { acronym: 'DIB', subjectId: idFor(1) },
        { acronym: 'TIS', subjectId: idFor(5) },
        { acronym: 'PPF', subjectId: idFor(7) },
        { acronym: 'PIF', subjectId: idFor(8) },
      ],
    }) as unknown as ActivePlanCatalog;

    const settingsBase = { ...DEFAULT_SETTINGS, includeAnalistaTrack: true, includeElectivesInProgress: true };

    // Estado 0: alumno inicial sin materias
    const eval0 = evaluatePlanProgress({ plan: fictitiousPlan, userState: {}, settings: settingsBase, examAttempts: [] });
    assert.deepEqual(eval0.availableCoreIds, [1, 2]);
    assert.deepEqual(eval0.availableElectiveIds, []);
    assert.equal(eval0.progress.careerPercentageBySubjects, 0);
    assert.equal(eval0.progress.percentageApproved, 0);
    assert.equal(eval0.progress.totalElectiveCreditsApproved, 0);
    assert.equal(eval0.analista.eligible, false);
    assert.deepEqual(eval0.analista.missingCoreIds, [1, 2, 3, 4]);
    assert.equal(eval0.pps.eligible, false);
    assert.equal(eval0.proyectoFinal.canRender, false);

    // Estado 1: 1º año aprobado (sin electivas en progreso -> 2/8 = 25%)
    const state1: UserCareerState = {
      1: { status: 'aprobada', grade: 7 },
      2: { status: 'promocionada', grade: 8 },
    };
    const eval1 = evaluatePlanProgress({
      plan: fictitiousPlan,
      userState: state1,
      settings: { ...settingsBase, includeElectivesInProgress: false },
      examAttempts: [],
    });
    assert.deepEqual(eval1.availableCoreIds, [3, 4]);
    assert.equal(eval1.progress.careerPercentageBySubjects, 25);
    assert.equal(eval1.progress.percentageApproved, 25);
    assert.equal(eval1.progress.percentagePending, 75);

    // Estado 2: obligatorias 1..4 aprobadas -> habilita materia intermedia 5 y electiva 101
    const state2: UserCareerState = {
      ...state1,
      3: { status: 'aprobada', grade: 7 },
      4: { status: 'aprobada', grade: 8 },
    };
    const eval2 = evaluatePlanProgress({ plan: fictitiousPlan, userState: state2, settings: settingsBase, examAttempts: [] });
    assert.deepEqual(eval2.availableCoreIds, [5]);
    assert.deepEqual(eval2.availableElectiveIds, [101]);
    assert.equal(eval2.seminario.canRender, true);
    assert.equal(eval2.progress.careerPercentageBySubjects, 40);
    assert.equal(eval2.progress.percentageApproved, 40); // 4 de (8 + 2 slots equiv)
    assert.equal(eval2.analista.eligible, false);
    assert.equal(eval2.pps.eligible, false);

    // Estado 3a: 5 regularizada + electiva 101 aprobada (4 cred) -> habilita PPS y desbloquea nivel 4 (6, 7),
    // pero título intermedio aún bloqueado por faltar aprobación de materia hito 5
    const state3a: UserCareerState = {
      ...state2,
      5: { status: 'regularizada' },
      101: { status: 'aprobada', grade: 9 },
    };
    const eval3a = evaluatePlanProgress({ plan: fictitiousPlan, userState: state3a, settings: settingsBase, examAttempts: [] });
    assert.equal(eval3a.pps.eligible, true);
    assert.deepEqual(eval3a.availableCoreIds, [6, 7]);
    assert.equal(eval3a.progress.totalElectiveCreditsApproved, 4);
    assert.equal(eval3a.analista.seminarioApproved, false);
    assert.equal(eval3a.analista.eligible, false);

    // Estado 3b: 1..5 aprobadas sin electiva 101 -> título intermedio bloqueado por falta de créditos electivos (0 < 4)
    const state3b: UserCareerState = {
      ...state2,
      5: { status: 'aprobada', grade: 8 },
    };
    const analistaNoElectives = checkAnalistaTitle(state3b, fictitiousPlan, 0);
    assert.equal(analistaNoElectives.seminarioApproved, true);
    assert.deepEqual(analistaNoElectives.missingCoreIds, []);
    assert.equal(analistaNoElectives.eligible, false);

    // Estado 4: 1..6 aprobadas + PPS (7) regular + electivas 101 (4) y 102 (6) aprobadas ->
    // intermedio eligible, PPS eligible, pero Proyecto Integrador Final (8) aún bloqueado por faltar aprobar 7
    const state4: UserCareerState = {
      ...state3b,
      6: { status: 'aprobada', grade: 7 },
      7: { status: 'regularizada' },
      101: { status: 'aprobada', grade: 8 },
      102: { status: 'aprobada', grade: 9 },
    };
    const eval4 = evaluatePlanProgress({ plan: fictitiousPlan, userState: state4, settings: settingsBase, examAttempts: [] });
    assert.equal(eval4.progress.totalElectiveCreditsApproved, 10);
    assert.equal(eval4.progress.missingElectiveCreditsForDegree, 0);
    assert.equal(eval4.progress.percentageApproved, 80); // 6 core + 2 equiv electivas sobre 10
    assert.equal(eval4.analista.eligible, true);
    assert.equal(isPPSEligible(state4, fictitiousPlan).eligible, true);
    assert.equal(eval4.proyectoFinal.canRender, false);
    assert.deepEqual(eval4.proyectoFinal.missingIds, [7]);

    // Estado 5: 1..8 todas aprobadas + electivas completas -> 100% e integradora final / egreso habilitado
    const state5: UserCareerState = {
      ...state4,
      7: { status: 'aprobada', grade: 8 },
      8: { status: 'aprobada', grade: 10 },
    };
    const eval5 = evaluatePlanProgress({ plan: fictitiousPlan, userState: state5, settings: settingsBase, examAttempts: [] });
    const capstoneRule = fictitiousPlan.rules.find((r) => r.subjectCode === 8)!;
    assert.equal(evaluateSpecialRule(capstoneRule, fictitiousPlan.subjects, state5, true).satisfied, true);
    assert.equal(canRenderProyectoFinal(state5, fictitiousPlan, true).canRender, true);
    assert.equal(eval5.proyectoFinal.canRender, true);
    assert.equal(eval5.analista.eligible, true);
    assert.equal(eval5.progress.careerPercentageBySubjects, 100);
    assert.equal(eval5.progress.percentageApproved, 100);
    assert.equal(eval5.progress.isDegreeEligible, true);
  });
});

describe('Migration 0014 displayCode character-by-character parity', () => {
  it('reproduces exact fixture codes for all 60 ISI subjects after 0014 SQL backfill and respects custom displayCode values', () => {
    const sql0014Path = path.resolve(rootDir, 'server/drizzle/0014_subject_display_code.sql');
    const sql0014 = fs.readFileSync(sql0014Path, 'utf8');
    assert.match(sql0014, /c\."code"\s*=\s*'ISI'\s+AND\s+sp\."year"\s*=\s*2023\s+AND\s+s\."kind"\s*=\s*'electiva'/i);
    assert.match(sql0014, /\(408,\s*512,\s*513,\s*514\)/);
    assert.match(sql0014, /s\."display_code"\s+IS\s+NULL/i);

    const catalogJsonPath = path.resolve(rootDir, 'server/seed-data/plan2023-catalog.json');
    const rawCatalog = JSON.parse(fs.readFileSync(catalogJsonPath, 'utf8')) as {
      career: { name: string; code: string };
      studyPlan: { name: string; year: number; config: Record<string, unknown> };
      subjects: Array<{
        codeInPlan: number;
        displayCode?: string | null;
        name: string;
        shortName?: string;
        level: number;
        modality: string;
        contraCuatrimestral?: boolean;
        weeklyHours: number;
        kind: string;
        credits?: number | null;
        isOptionalTrack?: boolean;
        trackKey?: string | null;
        isIntegrator?: boolean;
      }>;
    };

    assert.equal(rawCatalog.subjects.length, 60);

    // Simula el UPDATE de 0014 sobre las 60 materias con display_code inicialmente NULL
    const apply0014SqlRule = (row: {
      careerCode: string;
      year: number;
      kind: string;
      codeInPlan: number;
      displayCode: string | null;
    }): string | null => {
      if (row.displayCode !== null) return row.displayCode;
      if (row.careerCode === 'ISI' && row.year === 2023 && row.kind === 'electiva') {
        return [408, 512, 513, 514].includes(row.codeInPlan)
          ? `X-${row.codeInPlan}`
          : `E-${row.codeInPlan}`;
      }
      return String(row.codeInPlan);
    };

    const post0014Subjects = rawCatalog.subjects.map((s) => ({
      id: `isi-sub-${s.codeInPlan}`,
      codeInPlan: s.codeInPlan,
      displayCode: apply0014SqlRule({
        careerCode: rawCatalog.career.code,
        year: rawCatalog.studyPlan.year,
        kind: s.kind,
        codeInPlan: s.codeInPlan,
        displayCode: null,
      }),
      name: s.name,
      shortName: s.shortName,
      level: s.level,
      modality: s.modality,
      contraCuatrimestral: Boolean(s.contraCuatrimestral),
      weeklyHours: s.weeklyHours,
      kind: s.kind,
      credits: s.credits ?? null,
      isOptionalTrack: Boolean(s.isOptionalTrack),
      trackKey: s.trackKey ?? null,
      isIntegrator: Boolean(s.isIntegrator),
    }));

    const formatted = formatPlanCatalogPayload({
      plan: {
        id: 'plan-isi-2023-0014',
        name: rawCatalog.studyPlan.name,
        year: rawCatalog.studyPlan.year,
        config: rawCatalog.studyPlan.config,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      career: {
        id: 'career-isi-0014',
        name: rawCatalog.career.name,
        code: rawCatalog.career.code,
        facultyId: 'fac-frc',
      },
      subjects: post0014Subjects,
      prerequisites: [],
      rules: [],
      acronyms: [],
    });

    const expectedCodeById = new Map<number, string>();
    for (const core of CORE_SUBJECTS) {
      expectedCodeById.set(core.id, core.code);
    }
    for (const elec of ELECTIVES) {
      expectedCodeById.set(elec.id, elec.code);
    }
    assert.equal(expectedCodeById.size, 60);
    assert.equal(formatted.subjects.length, 60);

    for (const sub of formatted.subjects) {
      const expectedCode = expectedCodeById.get(sub.id);
      assert.notEqual(expectedCode, undefined, `Materia inesperada ${sub.id} en catálogo`);
      assert.strictEqual(
        sub.code,
        expectedCode,
        `Mismatch de código visible para materia ${sub.id}: esperado "${expectedCode}", recibido "${sub.code}"`
      );
    }

    // Incluso si alguna materia ya tenía displayCode distinto (WHERE display_code IS NULL no la pisa),
    // formatPlanCatalogPayload devuelve ese valor personalizado carácter por carácter.
    const customSubjects = post0014Subjects.map((s) => {
      if (s.codeInPlan === 1) {
        return { ...s, displayCode: apply0014SqlRule({ careerCode: 'ISI', year: 2023, kind: s.kind, codeInPlan: 1, displayCode: 'ALT-01' }) };
      }
      if (s.codeInPlan === 301) {
        return { ...s, displayCode: apply0014SqlRule({ careerCode: 'ISI', year: 2023, kind: s.kind, codeInPlan: 301, displayCode: 'CUSTOM-301' }) };
      }
      return s;
    });
    const formattedCustom = formatPlanCatalogPayload({
      plan: {
        id: 'plan-isi-2023-0014-custom',
        name: rawCatalog.studyPlan.name,
        year: rawCatalog.studyPlan.year,
        config: rawCatalog.studyPlan.config,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      career: {
        id: 'career-isi-0014',
        name: rawCatalog.career.name,
        code: rawCatalog.career.code,
        facultyId: 'fac-frc',
      },
      subjects: customSubjects,
      prerequisites: [],
      rules: [],
      acronyms: [],
    });
    const customById = new Map(formattedCustom.subjects.map((s) => [s.id, s.code]));
    assert.strictEqual(customById.get(1), 'ALT-01');
    assert.strictEqual(customById.get(301), 'CUSTOM-301');
  });
});

describe('Paso 2 reducido: título intermedio estilo Industrial y criterio no evaluable', () => {
  it('evaluates Industrial-like intermediate degree (1..25 approved_range + level-4 optional milestone + 0 credits) and rejects empty intermediate criteria', () => {
    const coreSubjects1to25 = Array.from({ length: 25 }, (_, idx) => {
      const id = idx + 1;
      const level = id <= 8 ? 1 : id <= 17 ? 2 : 3;
      return {
        id,
        code: String(id),
        name: `Materia Troncal ${id}`,
        shortName: `Mat ${id}`,
        level,
        modality: 'cuatrimestral' as const,
        weeklyHours: 4,
        regularPrereqs: id > 1 ? [id - 1] : [],
        approvedPrereqs: id > 8 ? [id - 8] : [],
        isElective: false,
        isOptionalTrack: false,
      };
    });

    const industrialLikePlan: ActivePlanCatalog = {
      plan: {
        id: 'plan-ind-mock-2026',
        name: 'Ingeniería Industrial Mock 2026',
        year: 2026,
        updatedAt: '2026-07-01T00:00:00.000Z',
        config: {
          requiredElectiveCredits: 4,
          electiveSlotsEquivalent: 1,
          defaultMinPassingGrade: 6,
          totalLevels: 5,
          levelLabel: 'Año',
          shortTag: 'II · Plan Mock',
          ppsRequirement: {
            referenceSubjectCode: 27,
            label: 'Práctica Profesional Supervisada',
          },
          intermediateDegrees: [
            {
              key: 'tecnico',
              name: 'Técnico Universitario en Gestión Industrial',
              shortLabel: 'Téc. Univ. en Gestión Industrial',
              shortTitle: 'Título Intermedio',
              requiredElectiveCredits: 0,
              specialRuleSubjectCode: 26,
            },
          ],
        },
      },
      career: {
        id: 'career-ind-mock',
        name: 'Ingeniería Industrial Mock',
        code: 'IND',
        facultyId: 'fac-frc',
      },
      subjects: [
        ...coreSubjects1to25,
        {
          id: 26,
          code: '26',
          name: 'Gestión Industrial',
          shortName: 'Gest. Ind.',
          level: 4,
          modality: 'anual',
          weeklyHours: 6,
          regularPrereqs: [25],
          approvedPrereqs: [17],
          isElective: false,
          isOptionalTrack: true,
          trackKey: 'tecnico',
        },
        {
          id: 27,
          code: '27',
          name: 'Investigación Operativa',
          shortName: 'Inv. Op.',
          level: 4,
          modality: 'cuatrimestral',
          weeklyHours: 5,
          regularPrereqs: [25],
          approvedPrereqs: [17],
          isElective: false,
          isOptionalTrack: false,
        },
        {
          id: 28,
          code: '28',
          name: 'Proyecto Final',
          shortName: 'Proy. Final',
          level: 5,
          modality: 'anual',
          weeklyHours: 8,
          regularPrereqs: [27],
          approvedPrereqs: [25],
          isElective: false,
          isOptionalTrack: false,
          isIntegrator: true,
        },
        {
          id: 101,
          code: 'E-101',
          name: 'Logística Aplicada',
          shortName: 'Logística',
          level: 5,
          modality: 'cuatrimestral',
          weeklyHours: 4,
          regularPrereqs: [25],
          approvedPrereqs: [],
          isElective: true,
          credits: 4,
        },
      ],
      rules: [
        {
          subjectCode: 26,
          ruleType: 'approved_range',
          params: { fromCode: 1, toCode: 25 },
          description: 'Tener aprobadas todas las materias obligatorias de 1° a 3° año (códigos 1 a 25)',
        },
      ],
      acronyms: {
        GI: 26,
        IO: 27,
        PF: 28,
      },
    };

    // (a) Un título intermedio SIN criterios evaluables jamás devuelve eligible: true (ni con 0 aprobadas)
    const noCriteriaPlan: ActivePlanCatalog = {
      ...industrialLikePlan,
      plan: {
        ...industrialLikePlan.plan,
        config: {
          ...industrialLikePlan.plan.config,
          intermediateDegrees: [
            {
              key: 'vacio',
              name: 'Título Intermedio Inválido Sin Criterios',
              requiredElectiveCredits: 0,
            },
          ],
        },
      },
      rules: [],
    };
    const emptyTitleEval = checkAnalistaTitle({}, noCriteriaPlan, 0);
    assert.equal(emptyTitleEval.eligible, false);
    assert.equal(emptyTitleEval.seminarioApproved, false);

    // También debe dar eligible: false si declarara un hito sin regla approved_range propia
    const missingRulePlan: ActivePlanCatalog = {
      ...industrialLikePlan,
      rules: [],
    };
    assert.equal(checkAnalistaTitle({ 26: { status: 'aprobada', grade: 8 } }, missingRulePlan, 0).eligible, false);

    // Estado 1: año 3 incompleto (falta la 25) pero hito 26 marcado aprobado -> NO cumple título intermedio
    const year3IncompleteState: UserCareerState = {};
    for (let id = 1; id <= 24; id++) {
      year3IncompleteState[id] = { status: 'aprobada', grade: 8 };
    }
    year3IncompleteState[26] = { status: 'aprobada', grade: 9 };
    const evalState1 = evaluatePlanProgress({
      plan: industrialLikePlan,
      userState: year3IncompleteState,
      settings: { ...DEFAULT_SETTINGS, includeAnalistaTrack: true, includeElectivesInProgress: true },
      examAttempts: [],
    });
    assert.equal(evalState1.analista.eligible, false);
    assert.equal(evalState1.analista.seminarioApproved, true);
    assert.deepEqual(evalState1.analista.missingCoreIds, [25]);
    assert.equal(evalState1.seminario.canRender, false);
    assert.deepEqual(evalState1.seminario.missingIds, [25]);

    // Estado 2: año 3 completo (1..25 aprobadas) pero hito 26 aún pendiente -> hito habilitado, título NO cumplido
    const year3CompleteState: UserCareerState = {};
    for (let id = 1; id <= 25; id++) {
      year3CompleteState[id] = { status: 'aprobada', grade: 8 };
    }
    year3CompleteState[26] = { status: 'regularizada' };
    const evalState2 = evaluatePlanProgress({
      plan: industrialLikePlan,
      userState: year3CompleteState,
      settings: { ...DEFAULT_SETTINGS, includeAnalistaTrack: true, includeElectivesInProgress: true },
      examAttempts: [],
    });
    assert.equal(evalState2.analista.eligible, false);
    assert.deepEqual(evalState2.analista.missingCoreIds, []);
    assert.equal(evalState2.analista.seminarioApproved, false);
    assert.equal(evalState2.seminario.canRender, true);
    assert.deepEqual(evalState2.seminario.missingIds, []);

    // Estado 3: año 3 completo + hito 26 aprobado, aún con 0 créditos de electivas -> título intermedio CUMPLIDO
    const bothFulfilledState: UserCareerState = {
      ...year3CompleteState,
      26: { status: 'aprobada', grade: 9 },
    };
    const evalState3On = evaluatePlanProgress({
      plan: industrialLikePlan,
      userState: bothFulfilledState,
      settings: { ...DEFAULT_SETTINGS, includeAnalistaTrack: true, includeElectivesInProgress: true },
      examAttempts: [],
    });
    assert.equal(evalState3On.analista.eligible, true);
    assert.deepEqual(evalState3On.analista.missingCoreIds, []);
    assert.equal(evalState3On.analista.seminarioApproved, true);
    assert.equal(evalState3On.analista.electiveCredits, 0);

    // Estado 4: interruptor del trayecto opcional APAGADO -> oculta la 26 del mapa, avance y camino crítico
    const coreOnly = industrialLikePlan.subjects.filter((s) => !s.isElective);
    const activeWithSwitchOff = getActiveCoreSubjects(coreOnly, false);
    const activeWithSwitchOn = getActiveCoreSubjects(coreOnly, true);
    assert.equal(activeWithSwitchOff.some((s) => s.id === 26), false);
    assert.equal(activeWithSwitchOff.length, 27);
    assert.equal(activeWithSwitchOn.some((s) => s.id === 26), true);
    assert.equal(activeWithSwitchOn.length, 28);

    const evalState3Off = evaluatePlanProgress({
      plan: industrialLikePlan,
      userState: bothFulfilledState,
      settings: { ...DEFAULT_SETTINGS, includeAnalistaTrack: false, includeElectivesInProgress: true },
      examAttempts: [],
    });
    assert.equal(evalState3Off.progress.totalSubjects, 27);
    assert.equal(evalState3Off.progress.approvedCount, 25);
    assert.equal(evalState3Off.progress.totalEquivalentSlots, 28);
    assert.equal(evalState3On.progress.totalSubjects, 28);
    assert.equal(evalState3On.progress.approvedCount, 26);
    assert.equal(evalState3On.progress.totalEquivalentSlots, 29);

    const cpEmptyOffIds = calculateCriticalPath({}, industrialLikePlan, false).chain.map((s) => s.id);
    assert.equal(cpEmptyOffIds.includes(26), false);
    assert.ok(cpEmptyOffIds.includes(28));

    const only26PendingState: UserCareerState = {
      ...year3CompleteState,
      27: { status: 'aprobada', grade: 8 },
      28: { status: 'aprobada', grade: 9 },
    };
    const cpOnly26OffIds = calculateCriticalPath(only26PendingState, industrialLikePlan, false).chain.map(
      (s) => s.id
    );
    const cpOnly26OnIds = calculateCriticalPath(only26PendingState, industrialLikePlan, true).chain.map(
      (s) => s.id
    );
    assert.deepEqual(cpOnly26OffIds, []);
    assert.deepEqual(cpOnly26OnIds, [26]);

    // Materia obligatoria con correlativas explícitas y SIN regla especial (Proyecto Final 28) funciona sin cambios
    const pfSubject = industrialLikePlan.subjects.find((s) => s.id === 28)!;
    assert.equal(getSubjectStatus(pfSubject, year3CompleteState), 'bloqueada');
    assert.equal(
      getSubjectStatus(pfSubject, { ...year3CompleteState, 27: { status: 'regularizada' } }),
      'disponible'
    );
    assert.equal(canRenderSpecialRuleSubject(28, year3CompleteState, industrialLikePlan, false).canRender, true);
    assert.deepEqual(
      canRenderSpecialRuleSubject(28, year3CompleteState, industrialLikePlan, false).missingIds,
      []
    );
    assert.equal(
      isPPSEligible({ ...year3CompleteState, 17: { status: 'aprobada', grade: 8 } }, industrialLikePlan).eligible,
      true
    );
  });
});
