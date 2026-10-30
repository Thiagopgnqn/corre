import { useState, useEffect, useCallback } from 'react';
import { professorsApi } from '../api/professors.api';
import type { ProfessorBatchRating, RatingsBatchData } from '../types/professor';
import { normalizeProfessorLookupKey } from '../utils/professorRatingsLogic';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos en memoria

let cachedRatings: RatingsBatchData | null = null;
let cachedAt = 0;
let inFlightPromise: Promise<RatingsBatchData | null> | null = null;
const subscribers = new Set<(next: RatingsBatchData | null) => void>();

function notifySubscribers(next: RatingsBatchData | null) {
  subscribers.forEach((cb) => cb(next));
}

export function invalidateProfessorRatingsCache() {
  cachedRatings = null;
  cachedAt = 0;
}

async function fetchRatingsWithCache(force = false): Promise<RatingsBatchData | null> {
  const now = Date.now();
  if (!force && cachedRatings && now - cachedAt < CACHE_TTL_MS) {
    return cachedRatings;
  }

  if (!force && inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = professorsApi
    .getRatingsBatch()
    .then((res) => {
      const next = res.success && res.data ? res.data : null;
      cachedRatings = next;
      cachedAt = Date.now();
      notifySubscribers(next);
      return next;
    })
    .catch(() => cachedRatings)
    .finally(() => {
      inFlightPromise = null;
    });

  return inFlightPromise;
}

/**
 * Hook con caché compartida en memoria para consultar valoraciones de profesores
 * en una sola petición por lote (sin N+1), tanto por UUID como por nombre normalizado.
 */
export function useProfessorRatings(enabled = true) {
  const [data, setData] = useState<RatingsBatchData | null>(() => cachedRatings);
  const [isLoading, setIsLoading] = useState<boolean>(() => Boolean(enabled && !cachedRatings));

  useEffect(() => {
    const handleUpdate = (next: RatingsBatchData | null) => {
      setData(next);
    };
    subscribers.add(handleUpdate);
    return () => {
      subscribers.delete(handleUpdate);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    if (!cachedRatings || Date.now() - cachedAt >= CACHE_TTL_MS) {
      setIsLoading(true);
    }
    fetchRatingsWithCache(false).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [enabled]);

  const reloadRatings = useCallback(async () => {
    setIsLoading(true);
    invalidateProfessorRatingsCache();
    try {
      await fetchRatingsWithCache(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getRatingForProfessor = useCallback(
    (ref: { id?: string | null; name: string }): ProfessorBatchRating | null => {
      if (!data) return null;
      if (ref.id && data.byId[ref.id]) {
        return data.byId[ref.id];
      }
      const norm = normalizeProfessorLookupKey(ref.name);
      if (norm) {
        const mappedId = data.byNormalizedName[norm];
        if (mappedId && data.byId[mappedId]) {
          return data.byId[mappedId];
        }
      }
      return null;
    },
    [data]
  );

  return {
    ratingsData: data,
    isLoading,
    getRatingForProfessor,
    reloadRatings,
  };
}

