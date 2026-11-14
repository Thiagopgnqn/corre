import { apiFetch, ApiError } from './client';
import type {
  ActivePlanCatalog,
  PlanConfig,
  PlanIntermediateDegree,
} from '../types/career';
import type { SubjectSchedule, ReservedElectiveSlot, ProfessorRef } from '../types/schedule';

export interface Institution {
  id: string;
  name: string;
  code: string;
  faculties: Array<{
    id: string;
    name: string;
    code: string;
    careers: Array<{
      id: string;
      name: string;
      code: string;
      plans: Array<{
        id: string;
        name: string;
        year: number;
        config:
          | PlanConfig
          | {
              requiredElectiveCredits: number;
              defaultMinPassingGrade: number;
              electiveSlotsEquivalent?: number;
              totalLevels?: number;
              levelLabel?: string;
              shortTag?: string;
              ppsRequirement?: { referenceSubjectCode: number } | null;
              intermediateDegrees?: PlanIntermediateDegree[];
              [key: string]: unknown;
            };
      }>;
    }>;
  }>;
}

export interface PlanDetailResponse {
  success: boolean;
  data: ActivePlanCatalog;
}

export interface CatalogVersionResponse {
  success: boolean;
  version: string;
}

export interface ScheduleResponse {
  success: boolean;
  data: {
    schedule: SubjectSchedule[];
    reservedElectiveSlots: ReservedElectiveSlot[];
    electiveOfferings: Array<{
      courseCode: string;
      subjectCode: number;
      subjectName: string;
      professors: string[];
      professorRefs?: ProfessorRef[];
    }>;
    term: {
      id?: string;
      label?: string;
      academicYear?: number;
      term?: string;
    };
  };
}

export const CATALOG_CACHE_KEY_PREFIX = 'mi_carrera_catalog_cache_v1:';
export const CATALOG_CURRENT_POINTER_KEY = 'mi_carrera_catalog_current_plan_id_v1';
export const CATALOG_CACHE_SCHEMA = 2;

export interface CachedPlanCatalog {
  schema: number;
  planId: string;
  version: string;
  cachedAt: string;
  catalog: ActivePlanCatalog;
}

export function getCatalogCacheKey(planId: string): string {
  return `${CATALOG_CACHE_KEY_PREFIX}${planId}`;
}

export function readCachedCatalog(
  planId: string,
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage !== 'undefined'
    ? localStorage
    : undefined
): CachedPlanCatalog | null {
  if (!storage) return null;
  try {
    const resolvedPlanId =
      planId === 'current' ? storage.getItem(CATALOG_CURRENT_POINTER_KEY) : planId;
    if (!resolvedPlanId) return null;

    const raw = storage.getItem(getCatalogCacheKey(resolvedPlanId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CachedPlanCatalog;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.schema !== CATALOG_CACHE_SCHEMA ||
      !parsed.catalog?.plan?.id
    ) {
      return null;
    }

    if (planId !== 'current' && parsed.catalog.plan.id !== planId) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedCatalog(
  requestedPlanId: string,
  version: string,
  catalog: ActivePlanCatalog,
  storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage !== 'undefined'
    ? localStorage
    : undefined
): void {
  if (!storage || !catalog?.plan?.id) return;
  try {
    const entry: CachedPlanCatalog = {
      schema: CATALOG_CACHE_SCHEMA,
      planId: catalog.plan.id,
      version,
      cachedAt: new Date().toISOString(),
      catalog,
    };
    storage.setItem(getCatalogCacheKey(catalog.plan.id), JSON.stringify(entry));
    if (requestedPlanId === 'current') {
      storage.setItem(CATALOG_CURRENT_POINTER_KEY, catalog.plan.id);
    }
  } catch {
    // Ignorar errores de almacenamiento (cuota excedida o modo privado)
  }
}

function isRetryableCatalogError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status >= 500 || err.status === 408 || err.status === 429;
  }
  if (err && typeof err === 'object') {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') {
      return status >= 500 || status === 408 || status === 429;
    }
    const name = (err as { name?: unknown }).name;
    if (name === 'AbortError' || name === 'TypeError') {
      return true;
    }
  }
  return true;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export interface LoadPlanCatalogOptions {
  planId?: string;
  forceRefresh?: boolean;
  getVersion?: (options?: RequestInit) => Promise<CatalogVersionResponse>;
  getPlan?: (planId: string, options?: RequestInit) => Promise<PlanDetailResponse>;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  onImmediateCache?: (catalog: ActivePlanCatalog) => void;
  onWakingChange?: (isWaking: boolean) => void;
  wakingDelayMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  attemptTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface LoadPlanCatalogResult {
  catalog: ActivePlanCatalog;
  version: string;
  fromCache: boolean;
  staleOffline: boolean;
}

/**
 * Loads the active plan catalog using per-plan localStorage cache validated against `/api/catalog/version`,
 * with Render cold-start wake-up notification, timeout, and exponential backoff retries.
 * Never falls back across plans or to static career data on missing cache.
 */
export async function loadPlanCatalogSmart(
  options: LoadPlanCatalogOptions = {}
): Promise<LoadPlanCatalogResult> {
  const requestedPlanId = options.planId || 'current';
  const getVersionFn = options.getVersion ?? ((reqOpts?: RequestInit) => catalogApi.getVersion(reqOpts));
  const getPlanFn = options.getPlan ?? ((id: string, reqOpts?: RequestInit) => catalogApi.getPlan(id, reqOpts));
  const sleepFn = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? 3;
  const baseBackoffMs = options.baseBackoffMs ?? 1000;
  const wakingDelayMs = options.wakingDelayMs ?? 2500;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 15000;

  const cached = options.forceRefresh ? null : readCachedCatalog(requestedPlanId, options.storage);
  if (cached) {
    options.onImmediateCache?.(cached.catalog);
  }

  let wakingReported = false;
  const notifyWaking = (waking: boolean) => {
    if (waking && wakingReported) return;
    if (waking) wakingReported = true;
    options.onWakingChange?.(waking);
  };

  let wakingTimer: ReturnType<typeof setTimeout> | null = null;
  if (!cached && wakingDelayMs > 0) {
    wakingTimer = setTimeout(() => notifyWaking(true), wakingDelayMs);
  }

  const runWithRetry = async <T>(fn: (reqOpts?: RequestInit) => Promise<T>): Promise<T> => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (controller && attemptTimeoutMs > 0) {
        timeoutHandle = setTimeout(() => controller.abort(), attemptTimeoutMs);
      }

      try {
        const res = await fn(controller ? { signal: controller.signal } : undefined);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        return res;
      } catch (err) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        lastError = err;
        if (!isRetryableCatalogError(err) || attempt >= maxRetries) {
          throw err;
        }
        notifyWaking(true);
        const waitMs = baseBackoffMs * Math.pow(2, attempt);
        if (waitMs > 0) {
          await sleepFn(waitMs);
        }
      }
    }
    throw lastError;
  };

  try {
    if (cached) {
      try {
        const versionRes = await runWithRetry((reqOpts) => getVersionFn(reqOpts));
        const remoteVersion = versionRes?.version;
        if (remoteVersion && remoteVersion === cached.version) {
          return {
            catalog: cached.catalog,
            version: cached.version,
            fromCache: true,
            staleOffline: false,
          };
        }

        const planRes = await runWithRetry((reqOpts) => getPlanFn(requestedPlanId, reqOpts));
        if (!planRes?.success || !planRes.data) {
          throw new Error('Respuesta inválida del catálogo');
        }
        const effectiveVersion =
          remoteVersion || String(planRes.data.plan.updatedAt ?? cached.version);
        writeCachedCatalog(requestedPlanId, effectiveVersion, planRes.data, options.storage);
        return {
          catalog: planRes.data,
          version: effectiveVersion,
          fromCache: false,
          staleOffline: false,
        };
      } catch {
        // Red caída o backend en cold start: se mantiene el caché exclusivo de ESTE planId
        return {
          catalog: cached.catalog,
          version: cached.version,
          fromCache: true,
          staleOffline: true,
        };
      }
    }

    const planRes = await runWithRetry((reqOpts) => getPlanFn(requestedPlanId, reqOpts));
    if (!planRes?.success || !planRes.data) {
      throw new Error('No se pudo cargar el plan de estudio');
    }

    const versionRes = await getVersionFn().catch(() => null);
    const effectiveVersion =
      versionRes?.version || String(planRes.data.plan.updatedAt ?? '1');
    writeCachedCatalog(requestedPlanId, effectiveVersion, planRes.data, options.storage);

    return {
      catalog: planRes.data,
      version: effectiveVersion,
      fromCache: false,
      staleOffline: false,
    };
  } finally {
    if (wakingTimer) clearTimeout(wakingTimer);
    if (wakingReported) {
      options.onWakingChange?.(false);
    }
  }
}

export const catalogApi = {
  async getVersion(requestOptions?: RequestInit): Promise<CatalogVersionResponse> {
    return apiFetch<CatalogVersionResponse>('/api/catalog/version', requestOptions);
  },

  async getCareers(): Promise<{ success: boolean; data: Institution[] }> {
    return apiFetch<{ success: boolean; data: Institution[] }>('/api/catalog/careers');
  },

  async getPlan(planId: string = 'current', requestOptions?: RequestInit): Promise<PlanDetailResponse> {
    return apiFetch<PlanDetailResponse>(`/api/catalog/plans/${planId}`, requestOptions);
  },

  async getSchedule(params?: { planId?: string; year?: number; term?: '1C' | '2C' }): Promise<ScheduleResponse> {
    const query = new URLSearchParams();
    if (params?.planId) query.set('planId', params.planId);
    if (params?.year) query.set('year', String(params.year));
    if (params?.term) query.set('term', params.term);
    const qs = query.toString();
    return apiFetch<ScheduleResponse>(`/api/catalog/schedule${qs ? `?${qs}` : ''}`);
  },

  async updateSelectedPlan(planId: string): Promise<{ success: boolean; data: { selectedPlanId: string; planName: string } }> {
    return apiFetch<{ success: boolean; data: { selectedPlanId: string; planName: string } }>('/api/me/plan', {
      method: 'PUT',
      body: JSON.stringify({ planId }),
    });
  },
};
