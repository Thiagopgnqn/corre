import { ApiError } from './client';
import {
  CATALOG_CACHE_SCHEMA,
  isValidPlanCatalogShape,
  loadPlanCatalogSmart,
  type CachedPlanCatalog,
  type CatalogVersionResponse,
  type Institution,
  type LoadPlanCatalogOptions,
  type LoadPlanCatalogResult,
  type PlanDetailResponse,
} from './catalog.api';
import type { ActivePlanCatalog } from '../types/career';

export const PUBLIC_CATALOG_CACHE_KEY_PREFIX = 'mi_carrera_public_catalog_cache_v1:';
export const PUBLIC_SELECTED_PLAN_ID_KEY = 'mi_carrera_public_selected_plan_id_v1';

export interface PublicReviewDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

export interface PublicProfessorSubjectSummary {
  subjectId: string;
  subjectCode: number;
  name: string;
  shortName: string;
  level: number;
  isCurrentTerm: boolean;
  isHistoricalLink: boolean;
}

export interface PublicProfessorListItem {
  id: string;
  displayName: string;
  normalizedKey: string;
  reviewCount: number;
  hasReliableAverage: boolean;
  ratingStatus: string;
  averageOverall: number | null;
  bayesianScore: number | null;
  averageClarity: number | null;
  averageTreatment: number | null;
  averageAvailability: number | null;
  averageDifficulty: number | null;
  recommendPercent: number | null;
  recommendCount: number;
  recommendTotal: number;
  distribution: PublicReviewDistribution;
  subjects: PublicProfessorSubjectSummary[];
}

export interface PublicProfessorSubjectDetail extends PublicProfessorSubjectSummary {
  termLabels: string[];
  reviewCount: number;
  hasReliableAverage: boolean;
  ratingStatus: string;
  averageOverall: number | null;
  bayesianScore: number | null;
  averageClarity: number | null;
  averageTreatment: number | null;
  averageAvailability: number | null;
  averageDifficulty: number | null;
  recommendPercent: number | null;
  recommendCount: number;
  recommendTotal: number;
  distribution: PublicReviewDistribution;
}

export interface PublicProfessorDetail {
  id: string;
  displayName: string;
  normalizedKey: string;
  reviewCount: number;
  hasReliableAverage: boolean;
  ratingStatus: string;
  averageOverall: number | null;
  bayesianScore: number | null;
  averageClarity: number | null;
  averageTreatment: number | null;
  averageAvailability: number | null;
  averageDifficulty: number | null;
  recommendPercent: number | null;
  recommendCount: number;
  recommendTotal: number;
  distribution: PublicReviewDistribution;
  subjects: PublicProfessorSubjectDetail[];
}

export interface PublicThresholds {
  minReviewsForReliableAverage: number;
  showProvisionalAverageBelowThreshold: boolean;
  minReviewsToShowAttendedPeriod: number;
  bayesianPriorGlobalMean: number;
  bayesianPriorWeight: number;
  maxNewReviewsPerDay: number;
  autoHideOpenReportsThreshold: number;
  allowedSubjectStatuses: string[];
}

/**
 * Exact 15-key public review DTO returned by `GET /api/public/professors/:id/reviews`.
 */
export interface PublicReviewItem {
  id: string;
  overall: number;
  clarity: number | null;
  treatment: number | null;
  availability: number | null;
  difficulty: number | null;
  wouldRecommend: boolean | null;
  comment: string | null;
  subjectId: string;
  subjectCode: number;
  subjectName: string;
  academicYear: number | null;
  term: string | null;
  createdAt: string;
  helpfulCount: number;
}

export interface PublicLibrarySubject {
  id: string;
  name: string;
  codeInPlan: number;
  level: number;
  kind: string;
  approvedFilesCount: number;
}

/**
 * Exact 17-key public library file DTO returned by `GET /api/public/library/files`.
 */
export interface PublicLibraryFileItem {
  id: string;
  subjectId: string;
  subjectCode: number;
  subjectName: string;
  kind: string;
  academicYear: number | null;
  term: string | null;
  examInstance: string | null;
  hasSolution: boolean;
  title: string;
  description: string | null;
  professorNames: string[];
  mimeType: string;
  sizeBytes: number;
  downloadCount: number;
  helpfulCount: number;
  createdAt: string;
}

/**
 * Cliente HTTP estrictamente público para `/api/public/*`:
 * - Solo método GET
 * - `credentials: 'omit'`
 * - Sin `X-Requested-With` ni `Authorization`
 * - Sin interceptor de refresh ante 401
 */
export async function publicFetch<T = unknown>(
  endpoint: string,
  options: { signal?: AbortSignal; headers?: Record<string, string>; method?: string } = {}
): Promise<T> {
  if (options.method && options.method.toUpperCase() !== 'GET') {
    throw new ApiError('Solo se permiten peticiones GET en rutas públicas', 405, 'METHOD_NOT_ALLOWED');
  }

  const url = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (!url.startsWith('/api/public/')) {
    throw new ApiError(
      'publicFetch únicamente puede consultar endpoints bajo /api/public/*',
      400,
      'INVALID_PUBLIC_ENDPOINT'
    );
  }

  const cleanHeaders: Record<string, string> = {
    Accept: 'application/json',
  };
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      const lower = key.toLowerCase();
      if (lower === 'x-requested-with' || lower === 'authorization' || lower === 'cookie') {
        continue;
      }
      cleanHeaders[key] = value;
    }
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: cleanHeaders,
      credentials: 'omit',
      signal: options.signal,
    });

    if (response.status === 204) {
      return {} as T;
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const errorMessage =
        data?.error || data?.message || `Error del servidor público (${response.status})`;
      throw new ApiError(errorMessage, response.status, data?.code, data?.details);
    }

    return data as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      (error as Error)?.message || 'Error de conexión con el servidor público',
      0,
      'NETWORK_ERROR'
    );
  }
}

export function getPublicCatalogCacheKey(planId: string): string {
  return `${PUBLIC_CATALOG_CACHE_KEY_PREFIX}${planId}`;
}

function getDefaultStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function readPublicSelectedPlanId(
  storage: Pick<Storage, 'getItem'> | undefined = getDefaultStorage()
): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PUBLIC_SELECTED_PLAN_ID_KEY);
    if (!raw || !raw.trim() || raw === 'current') return null;
    return raw.trim();
  } catch {
    return null;
  }
}

export function writePublicSelectedPlanId(
  planId: string,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    const trimmed = planId.trim();
    if (!trimmed || trimmed === 'current') {
      storage.removeItem?.(PUBLIC_SELECTED_PLAN_ID_KEY);
      return;
    }
    storage.setItem(PUBLIC_SELECTED_PLAN_ID_KEY, trimmed);
  } catch {
    // Ignorar errores de cuota o modo privado
  }
}

export function clearPublicSelectedPlanId(
  storage: Pick<Storage, 'removeItem'> | undefined = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    storage.removeItem(PUBLIC_SELECTED_PLAN_ID_KEY);
  } catch {
    // Ignorar errores de almacenamiento
  }
}

export function readPublicCachedCatalog(
  planId: string,
  storage: Pick<Storage, 'getItem'> | undefined = getDefaultStorage()
): CachedPlanCatalog | null {
  if (!storage) return null;
  try {
    const resolvedPlanId =
      planId === 'current' ? readPublicSelectedPlanId(storage) : planId;
    if (!resolvedPlanId) return null;

    const raw = storage.getItem(getPublicCatalogCacheKey(resolvedPlanId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CachedPlanCatalog;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.schema !== CATALOG_CACHE_SCHEMA ||
      !isValidPlanCatalogShape(parsed.catalog)
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

export function writePublicCachedCatalog(
  requestedPlanId: string,
  version: string,
  catalog: ActivePlanCatalog,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = getDefaultStorage()
): void {
  if (!storage || !isValidPlanCatalogShape(catalog)) return;
  try {
    const entry: CachedPlanCatalog = {
      schema: CATALOG_CACHE_SCHEMA,
      planId: catalog.plan.id,
      version,
      cachedAt: new Date().toISOString(),
      catalog,
    };
    storage.setItem(getPublicCatalogCacheKey(catalog.plan.id), JSON.stringify(entry));
    if (requestedPlanId === 'current') {
      writePublicSelectedPlanId(catalog.plan.id, storage);
    }
  } catch {
    // Ignorar errores de cuota o modo privado
  }
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export const publicApi = {
  async getVersion(requestOptions?: { signal?: AbortSignal }): Promise<CatalogVersionResponse> {
    return publicFetch<CatalogVersionResponse>('/api/public/catalog/version', requestOptions);
  },

  async getCareers(requestOptions?: {
    signal?: AbortSignal;
  }): Promise<{ success: boolean; data: Institution[] }> {
    return publicFetch<{ success: boolean; data: Institution[] }>(
      '/api/public/catalog/careers',
      requestOptions
    );
  },

  async getPlan(
    planId: string = 'current',
    requestOptions?: { signal?: AbortSignal }
  ): Promise<PlanDetailResponse> {
    const target = planId.trim() || 'current';
    return publicFetch<PlanDetailResponse>(
      `/api/public/catalog/plans/${encodeURIComponent(target)}`,
      requestOptions
    );
  },

  async listProfessors(params?: {
    planId?: string;
    search?: string;
    subjectId?: string;
    minRating?: number;
    withReviewsOnly?: boolean;
    sort?: 'rating' | 'reviews' | 'name';
  }): Promise<{
    success: boolean;
    data: { professors: PublicProfessorListItem[]; thresholds: PublicThresholds };
  }> {
    const query = new URLSearchParams();
    if (params?.planId) query.set('planId', params.planId);
    if (params?.search) query.set('search', params.search);
    if (params?.subjectId) query.set('subjectId', params.subjectId);
    if (typeof params?.minRating === 'number' && Number.isFinite(params.minRating)) {
      query.set('minRating', String(params.minRating));
    }
    if (params?.withReviewsOnly) query.set('withReviews', 'true');
    if (params?.sort) query.set('sort', params.sort);
    const qs = query.toString();
    return publicFetch(
      `/api/public/professors${qs ? `?${qs}` : ''}`
    );
  },

  async getProfessorDetail(
    professorId: string,
    planId?: string
  ): Promise<{
    success: boolean;
    data: { professor: PublicProfessorDetail; thresholds: PublicThresholds };
  }> {
    const query = new URLSearchParams();
    if (planId) query.set('planId', planId);
    const qs = query.toString();
    return publicFetch(
      `/api/public/professors/${encodeURIComponent(professorId)}${qs ? `?${qs}` : ''}`
    );
  },

  async getProfessorReviews(
    professorId: string,
    params?: {
      planId?: string;
      subjectId?: string;
      sort?: 'recent' | 'helpful';
      page?: number;
      pageSize?: number;
    }
  ): Promise<{
    success: boolean;
    data: {
      items: PublicReviewItem[];
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  }> {
    const query = new URLSearchParams();
    if (params?.planId) query.set('planId', params.planId);
    if (params?.subjectId) query.set('subjectId', params.subjectId);
    if (params?.sort) query.set('sort', params.sort);
    if (typeof params?.page === 'number') {
      query.set('page', String(clampInt(params.page, 1, 1, 10000)));
    }
    if (typeof params?.pageSize === 'number') {
      query.set('pageSize', String(clampInt(params.pageSize, 10, 1, 10)));
    }
    const qs = query.toString();
    return publicFetch(
      `/api/public/professors/${encodeURIComponent(professorId)}/reviews${qs ? `?${qs}` : ''}`
    );
  },

  async listLibrarySubjects(
    planId?: string
  ): Promise<{ success: boolean; data: PublicLibrarySubject[] }> {
    const query = new URLSearchParams();
    if (planId) query.set('planId', planId);
    const qs = query.toString();
    return publicFetch(`/api/public/library/subjects${qs ? `?${qs}` : ''}`);
  },

  async listLibraryFiles(params?: {
    planId?: string;
    subjectId?: string;
    kind?: string;
    year?: number;
    term?: string;
    professorId?: string;
    hasSolution?: boolean;
    search?: string;
    sort?: 'recent' | 'downloads' | 'helpful';
    page?: number;
    pageSize?: number;
  }): Promise<{
    success: boolean;
    data: {
      items: PublicLibraryFileItem[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
  }> {
    const query = new URLSearchParams();
    if (params?.planId) query.set('planId', params.planId);
    if (params?.subjectId) query.set('subjectId', params.subjectId);
    if (params?.kind) query.set('kind', params.kind);
    if (typeof params?.year === 'number' && Number.isFinite(params.year)) {
      query.set('year', String(params.year));
    }
    if (params?.term) query.set('term', params.term);
    if (params?.professorId) query.set('professorId', params.professorId);
    if (typeof params?.hasSolution === 'boolean') {
      query.set('hasSolution', String(params.hasSolution));
    }
    if (params?.search) query.set('search', params.search);
    if (params?.sort) query.set('sort', params.sort);
    if (typeof params?.page === 'number') {
      query.set('page', String(clampInt(params.page, 1, 1, 10000)));
    }
    if (typeof params?.pageSize === 'number') {
      query.set('pageSize', String(clampInt(params.pageSize, 20, 1, 30)));
    }
    const qs = query.toString();
    return publicFetch(`/api/public/library/files${qs ? `?${qs}` : ''}`);
  },
};

export async function loadPublicPlanCatalogSmart(
  options: Omit<LoadPlanCatalogOptions, 'getVersion' | 'getPlan' | 'readCache' | 'writeCache'> & {
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  } = {}
): Promise<LoadPlanCatalogResult> {
  return loadPlanCatalogSmart({
    ...options,
    getVersion: (reqOpts) => publicApi.getVersion({ signal: reqOpts?.signal }),
    getPlan: (id, reqOpts) => publicApi.getPlan(id, { signal: reqOpts?.signal }),
    readCache: (id, s) => readPublicCachedCatalog(id, s ?? options.storage),
    writeCache: (requestedId, version, catalog, s) =>
      writePublicCachedCatalog(
        requestedId,
        version,
        catalog,
        (s as Pick<Storage, 'setItem' | 'removeItem'> | undefined) ?? options.storage
      ),
  });
}
