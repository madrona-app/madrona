/**
 * Tracks whether the current user has seen the Guide onboarding welcome
 * for the active organization.
 *
 * Keyed on `{userId × orgId}` so:
 *   - signing into a new org re-offers the welcome (each org has its own
 *     workflows the user might want help with)
 *   - switching users on a shared workstation doesn't suppress the
 *     welcome for the new user
 *
 * Storage: localStorage, single JSON blob under `madrona.guide.onboarding.seen`.
 * Cheap, no server round-trip, and loss of the flag just means the user
 * sees the welcome again — no harm done.
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'madrona.guide.onboarding.seen';

interface SeenMap {
  [compositeKey: string]: number; // timestamp of dismissal
}

function loadMap(): SeenMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as SeenMap;
    return {};
  } catch {
    return {};
  }
}

function saveMap(map: SeenMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota errors — losing the flag just re-offers the welcome.
  }
}

function compositeKey(userId: string | null | undefined, orgId: string | null | undefined): string | null {
  if (!userId || !orgId) return null;
  return `${userId}::${orgId}`;
}

export interface UseOnboardingSeenResult {
  /** True once the user has dismissed the welcome for this org. */
  seen: boolean;
  /** Mark the welcome as seen — persist and flip the flag. */
  markSeen: () => void;
  /** Forget the dismissal (used by a "Show me again" action, future). */
  reset: () => void;
}

export function useOnboardingSeen(
  userId: string | null | undefined,
  orgId: string | null | undefined,
): UseOnboardingSeenResult {
  const key = compositeKey(userId, orgId);
  const [seen, setSeen] = useState<boolean>(() => {
    if (!key) return true; // Don't nag while auth is still loading.
    const map = loadMap();
    return !!map[key];
  });

  // Re-read when key changes (sign-in, org switch).
  useEffect(() => {
    if (!key) {
      setSeen(true);
      return;
    }
    const map = loadMap();
    setSeen(!!map[key]);
  }, [key]);

  const markSeen = useCallback(() => {
    if (!key) return;
    const map = loadMap();
    map[key] = Date.now();
    saveMap(map);
    setSeen(true);
  }, [key]);

  const reset = useCallback(() => {
    if (!key) return;
    const map = loadMap();
    delete map[key];
    saveMap(map);
    setSeen(false);
  }, [key]);

  return { seen, markSeen, reset };
}
