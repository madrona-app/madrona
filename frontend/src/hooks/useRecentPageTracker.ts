/**
 * useRecentPageTracker - Automatic recent page tracking at the router level.
 *
 * Observes location changes and, when the user navigates to a record page,
 * waits for the record's query to settle, then either adds it to the recent
 * items list (on success) or removes any stale entry (on error/404).
 *
 * Also prunes stale entries (deleted records) from the recent items list
 * by checking the query cache for known-errored queries.
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useWork } from '../contexts/WorkContext';
import type { RecentItem } from '../contexts/WorkContext';
import { parseRecordRoute } from '../lib/recentPageConfig';

/**
 * Given the current recent items and query cache, return IDs of items
 * whose backing query has errored (record was deleted / 404).
 */
function findStaleItems(
  items: RecentItem[],
  queryClient: ReturnType<typeof useQueryClient>,
): Array<{ id: string; type: RecentItem['type'] }> {
  const stale: Array<{ id: string; type: RecentItem['type'] }> = [];
  for (const item of items) {
    const parsed = parseRecordRoute(item.path);
    if (!parsed) continue;
    const state = queryClient.getQueryState(
      [parsed.config.queryKeyPrefix, parsed.orgId, parsed.recordId]
    );
    if (state?.status === 'error') {
      stale.push({ id: item.id, type: item.type });
    }
  }
  return stale;
}

export function useRecentPageTracker() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { recentItems, addRecentItem, removeRecentItem } = useWork();
  const prevPathRef = useRef('');
  const recentItemsRef = useRef(recentItems);
  recentItemsRef.current = recentItems;

  // Prune stale entries whenever the route changes.
  // Uses a ref to avoid re-running when recentItems itself changes (which would loop).
  useEffect(() => {
    const stale = findStaleItems(recentItemsRef.current, queryClient);
    for (const { id, type } of stale) {
      removeRecentItem(id, type);
    }
  }, [location.pathname, queryClient, removeRecentItem]);

  // Track current page
  useEffect(() => {
    // Normalize: strip trailing /edit for comparison
    const canonicalPath = location.pathname.replace(/\/edit$/, '');
    if (canonicalPath === prevPathRef.current) return;
    prevPathRef.current = canonicalPath;

    const parsed = parseRecordRoute(location.pathname);
    if (!parsed) return;

    const { orgId, recordId, config } = parsed;
    const queryKey = [config.queryKeyPrefix, orgId, recordId];

    // Poll for query settlement — the page's own useQuery will drive the fetch,
    // we just wait for it to finish (success or error).
    let attempts = 0;
    const maxAttempts = 10; // 10 × 500ms = 5s max wait

    const checkQuery = () => {
      attempts++;
      const state = queryClient.getQueryState(queryKey);

      // Query errored (404, deleted record, etc.) — remove stale entry
      if (state?.status === 'error') {
        removeRecentItem(recordId, config.type);
        return;
      }

      // Query succeeded — add to recent items
      if (state?.status === 'success') {
        const cached = queryClient.getQueryData<Record<string, unknown>>(queryKey);
        const rawLabel = cached?.[config.labelField];
        const label = (typeof rawLabel === 'string' && rawLabel)
          ? rawLabel
          : `${config.displayName} ${recordId.slice(0, 8)}`;

        const rawSublabel = config.sublabelField
          ? cached?.[config.sublabelField]
          : undefined;
        const sublabel = typeof rawSublabel === 'string' ? rawSublabel : undefined;

        addRecentItem({
          id: recordId,
          type: config.type,
          label,
          sublabel: sublabel || undefined,
          path: canonicalPath,
        });
        return;
      }

      // Still loading — retry if under max attempts
      if (attempts < maxAttempts) {
        timer = setTimeout(checkQuery, 500);
      }
    };

    let timer = setTimeout(checkQuery, 500);

    return () => clearTimeout(timer);
  }, [location.pathname, queryClient, addRecentItem, removeRecentItem]);
}
