/**
 * Hook for fetching LOD readiness data
 */

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../lib/apiClient';
import type { LODReadinessResult, UseLODReadinessOptions } from './types';
import { logger } from '../../../lib/logger';

// Re-export types for backward compatibility
export type { LODHint, LODReadinessResult } from './types';

/**
 * Full LOD readiness hook with hints and actions
 */
export function useLODReadiness(
  organizationId: string,
  objectId: string,
  options: UseLODReadinessOptions = {}
): {
  result: LODReadinessResult | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  dismissHint: (hintId: string) => Promise<void>;
  dismissedHints: string[];
} {
  const { fetchOnMount = true, refreshInterval = 0 } = options;

  const [result, setResult] = useState<LODReadinessResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [dismissedHints, setDismissedHints] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!organizationId || !objectId) return;

    setIsLoading(true);
    setError(null);

    try {
      const data = await apiFetch<LODReadinessResult>(
        `/organizations/${organizationId}/collections/objects/${objectId}/lod-readiness`
      );
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch LOD readiness'));
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, objectId]);

  const dismissHint = useCallback(
    async (hintId: string) => {
      try {
        await apiFetch(`/organizations/${organizationId}/lod-readiness/dismissed-hints`, {
          method: 'POST',
          body: JSON.stringify({ hintId, scope: 'object' }),
        });
        setDismissedHints((prev) => [...prev, hintId]);
      } catch (err) {
        logger.error('Failed to dismiss hint:', err);
      }
    },
    [organizationId]
  );

  // Initial fetch
  useEffect(() => {
    if (fetchOnMount) {
      refresh();
    }
  }, [fetchOnMount, refresh]);

  // Auto-refresh
  useEffect(() => {
    if (refreshInterval > 0) {
      const interval = setInterval(refresh, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [refreshInterval, refresh]);

  // Load dismissed hints
  useEffect(() => {
    if (organizationId) {
      apiFetch<{ dismissedHints: string[] }>(
        `/organizations/${organizationId}/lod-readiness/dismissed-hints`
      )
        .then((result) => setDismissedHints(result.dismissedHints || []))
        .catch((e) => logger.warn('LOD readiness dismissed hints fetch failed:', e));
    }
  }, [organizationId]);

  return {
    result,
    isLoading,
    error,
    refresh,
    dismissHint,
    dismissedHints,
  };
}

/**
 * Fetch LOD readiness score only (lightweight)
 */
export function useLODScore(
  organizationId: string,
  objectId: string
): { score: number | null; level: string | null; isLoading: boolean } {
  const [data, setData] = useState<{ score: number; level: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!organizationId || !objectId) return;

    setIsLoading(true);
    apiFetch<{ score: number; level: string }>(
      `/organizations/${organizationId}/collections/objects/${objectId}/lod-readiness/score`
    )
      .then((result) => setData(result))
      .catch(() => setData(null))
      .finally(() => setIsLoading(false));
  }, [organizationId, objectId]);

  return {
    score: data?.score ?? null,
    level: data?.level ?? null,
    isLoading,
  };
}

/**
 * Preview LOD readiness for unsaved data
 */
export function usePreviewLODReadiness() {
  const [result, setResult] = useState<LODReadinessResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const preview = useCallback(async (objectData: Record<string, unknown>) => {
    setIsLoading(true);
    try {
      const data = await apiFetch<LODReadinessResult>('/lod-readiness/preview', {
        method: 'POST',
        body: JSON.stringify(objectData),
      });
      setResult(data);
    } catch (err) {
      logger.error('Failed to preview LOD readiness:', err);
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    result,
    isLoading,
    preview,
  };
}

/**
 * Fetch collection-level LOD readiness summary
 */
export function useCollectionLODReadiness(
  organizationId: string,
  options: { limit?: number } = {}
): {
  averageScore: number | null;
  objectCount: number;
  levelDistribution: Record<string, number>;
  hintsByCategory: Record<string, number>;
  isLoading: boolean;
} {
  const [data, setData] = useState<{
    averageScore: number;
    objectCount: number;
    levelDistribution: Record<string, number>;
    hintsByCategory: Record<string, number>;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!organizationId) return;

    setIsLoading(true);
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));

    apiFetch<{
      averageScore: number;
      objectCount: number;
      levelDistribution: Record<string, number>;
      hintsByCategory: Record<string, number>;
    }>(`/organizations/${organizationId}/collections/lod-readiness?${params}`)
      .then((result) => setData(result))
      .catch(() => setData(null))
      .finally(() => setIsLoading(false));
  }, [organizationId, options.limit]);

  return {
    averageScore: data?.averageScore ?? null,
    objectCount: data?.objectCount ?? 0,
    levelDistribution: data?.levelDistribution ?? {},
    hintsByCategory: data?.hintsByCategory ?? {},
    isLoading,
  };
}
