import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluatePlanProgress,
  checkAnalistaTitle,
  isPPSEligible,
} from '../src/utils/correlativas';
import { calculateCriticalPath } from '../src/utils/criticalPath';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY_STATE,
  STORAGE_KEY_BASKET,
  STORAGE_KEY_SETTINGS,
  getPlanStorageKey,
  migrateLegacyLocalStorageToPlan,
  loadUserState,
  saveUserState,
  exportCareerToJson,
} from '../src/utils/storage';
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

  it('performs idempotent copy-not-delete legacy localStorage migration and isolates plans', () => {
    const mockStorage = createMockStorage({
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

    // Case B: cache with outdated schema number
    mockStorage.setItem(
      getCatalogCacheKey('plan-schema-test'),
      JSON.stringify({
        schema: CATALOG_CACHE_SCHEMA - 1,
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

    const invalidVariants: Array<{ label: string; payload: unknown }> = [
      {
        label: 'sin career',
        payload: { ...validCatalog, career: undefined },
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
});
