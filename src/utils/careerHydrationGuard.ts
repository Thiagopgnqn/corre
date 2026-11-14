import type { ActivePlanCatalog } from '../types/career';
import type { ConsolidatedUserState } from '../api/userState.api';

/**
 * Tracks sequence ownership and server/storage hydration readiness across
 * authentication transitions and plan switches.
 */
export interface CareerHydrationState {
  reloadSeq: number;
  hasHydrated: boolean;
  hydratedStoragePlanId: string | null;
  hydratedServerPlanId: string | null;
}

export interface ServerStateEnvelope<TData = ConsolidatedUserState> {
  success: boolean;
  data?: TData | null;
}

export interface ReloadCatalogResult<TCatalog> {
  catalog: TCatalog;
}

export type ServerReloadOutcome<TCatalog, TStateData> =
  | { status: 'aborted' }
  | { status: 'catalog_error'; error: unknown }
  | { status: 'state_error'; seq: number; planId: string; catalog: TCatalog; error: unknown }
  | {
      status: 'state_unavailable';
      seq: number;
      planId: string;
      catalog: TCatalog;
      response: ServerStateEnvelope<TStateData>;
    }
  | { status: 'hydrated'; seq: number; planId: string; catalog: TCatalog; stateData: TStateData };

/** Creates the initial unhydrated state before login or plan selection. */
export function createCareerHydrationState(): CareerHydrationState {
  return {
    reloadSeq: 0,
    hasHydrated: false,
    hydratedStoragePlanId: null,
    hydratedServerPlanId: null,
  };
}

/**
 * Synchronously starts a new reload sequence and clears hydration flags so no
 * auto-sync mutations or old-plan storage writes can leak while the target plan loads.
 */
export function beginServerReload(state: CareerHydrationState): {
  seq: number;
  state: CareerHydrationState;
} {
  const seq = state.reloadSeq + 1;
  return {
    seq,
    state: {
      reloadSeq: seq,
      hasHydrated: false,
      hydratedStoragePlanId: null,
      hydratedServerPlanId: null,
    },
  };
}

/**
 * Records that a plan catalog snapshot was loaded into UI state and unlocks
 * plan-scoped localStorage persistence for that plan, while keeping server sync
 * disabled until remote state finishes hydrating.
 */
export function applyCatalogSnapshot(
  state: CareerHydrationState,
  seq: number,
  planId: string
): CareerHydrationState {
  if (seq !== state.reloadSeq) return state;
  return {
    ...state,
    hydratedStoragePlanId: planId,
    // Catalog availability alone must never grant permission to overwrite server state.
    hydratedServerPlanId: null,
    hasHydrated: false,
  };
}

/** Clears storage and server readiness when loading the active catalog fails for the current sequence. */
export function failCatalogLoad(
  state: CareerHydrationState,
  seq: number
): CareerHydrationState {
  if (seq !== state.reloadSeq) return state;
  return {
    ...state,
    hasHydrated: false,
    hydratedStoragePlanId: null,
    hydratedServerPlanId: null,
  };
}

/** Marks server state hydrated only if the response still belongs to the active reload sequence. */
export function completeServerStateHydration(
  state: CareerHydrationState,
  seq: number,
  planId: string
): CareerHydrationState {
  if (seq !== state.reloadSeq) return state;
  return {
    ...state,
    hydratedStoragePlanId: planId,
    hydratedServerPlanId: planId,
    hasHydrated: true,
  };
}

/** Invalidates pending reloads and clears hydration flags on sign-out. */
export function resetHydrationOnLogout(state: CareerHydrationState): CareerHydrationState {
  return {
    reloadSeq: state.reloadSeq + 1,
    hasHydrated: false,
    hydratedStoragePlanId: null,
    hydratedServerPlanId: null,
  };
}

/**
 * Returns true only when authenticated AND server user state has finished hydrating
 * for the active plan. Optional targetPlanId rejects writes if the active plan changed.
 */
export function canSyncServerState(
  isAuthenticated: boolean,
  state: CareerHydrationState,
  targetPlanId?: string | null
): boolean {
  if (!isAuthenticated || !state.hasHydrated) return false;
  if (targetPlanId !== undefined && targetPlanId !== null) {
    return state.hydratedServerPlanId === targetPlanId;
  }
  return state.hydratedServerPlanId !== null;
}

/** Returns true only when localStorage effects belong to the currently hydrated storage plan. */
export function canPersistScopedStorage(
  scopedPlanId: string | null | undefined,
  state: CareerHydrationState
): boolean {
  return Boolean(scopedPlanId) && state.hydratedStoragePlanId === scopedPlanId;
}

export interface ExecuteServerReloadCycleParams<
  TCatalog extends Pick<ActivePlanCatalog, 'plan'> = ActivePlanCatalog,
  TStateData = ConsolidatedUserState,
> {
  getState: () => CareerHydrationState;
  setState: (next: CareerHydrationState) => void;
  loadCatalog: (callbacks: {
    onImmediateCache: (cachedCatalog: TCatalog) => void;
  }) => Promise<ReloadCatalogResult<TCatalog>>;
  applyCatalogToUi: (catalog: TCatalog) => void;
  refreshCatalogInPlace?: (catalog: TCatalog) => void;
  fetchServerState: (planId: string) => Promise<ServerStateEnvelope<TStateData>>;
  applyServerStateToUi: (stateData: TStateData, catalog: TCatalog) => void;
  onCatalogError?: (error: unknown) => void;
}

/**
 * Coordinates catalog fetch + server user-state hydration while guarding against:
 * (a) auto-syncing before server hydration completes,
 * (b) overwriting remote state with empty defaults when catalog or state requests fail, and
 * (c) cross-plan leaks or stale out-of-order responses when switching plans.
 */
export async function executeServerReloadCycle<
  TCatalog extends Pick<ActivePlanCatalog, 'plan'> = ActivePlanCatalog,
  TStateData = ConsolidatedUserState,
>(
  params: ExecuteServerReloadCycleParams<TCatalog, TStateData>
): Promise<ServerReloadOutcome<TCatalog, TStateData>> {
  const started = beginServerReload(params.getState());
  const seq = started.seq;
  params.setState(started.state);

  const isStale = () => seq !== params.getState().reloadSeq;

  let loadedCatalog: TCatalog;
  let immediateAppliedId: string | null = null;

  try {
    const result = await params.loadCatalog({
      onImmediateCache: (cachedCatalog) => {
        if (isStale()) return;
        immediateAppliedId = cachedCatalog.plan.id;
        params.applyCatalogToUi(cachedCatalog);
        params.setState(applyCatalogSnapshot(params.getState(), seq, cachedCatalog.plan.id));
      },
    });
    if (isStale()) return { status: 'aborted' };

    loadedCatalog = result.catalog;
    if (immediateAppliedId !== loadedCatalog.plan.id) {
      params.applyCatalogToUi(loadedCatalog);
      params.setState(applyCatalogSnapshot(params.getState(), seq, loadedCatalog.plan.id));
    } else if (params.refreshCatalogInPlace) {
      params.refreshCatalogInPlace(loadedCatalog);
    }
  } catch (error) {
    if (isStale()) return { status: 'aborted' };
    params.setState(failCatalogLoad(params.getState(), seq));
    params.onCatalogError?.(error);
    return { status: 'catalog_error', error };
  }

  const planId = loadedCatalog.plan.id;
  let stateRes: ServerStateEnvelope<TStateData>;
  try {
    stateRes = await params.fetchServerState(planId);
  } catch (error) {
    if (isStale()) return { status: 'aborted' };
    return { status: 'state_error', seq, planId, catalog: loadedCatalog, error };
  }

  if (isStale()) return { status: 'aborted' };

  if (!stateRes.success || !stateRes.data) {
    return { status: 'state_unavailable', seq, planId, catalog: loadedCatalog, response: stateRes };
  }

  params.applyServerStateToUi(stateRes.data, loadedCatalog);
  params.setState(completeServerStateHydration(params.getState(), seq, planId));

  return {
    status: 'hydrated',
    seq,
    planId,
    catalog: loadedCatalog,
    stateData: stateRes.data,
  };
}
