/**
 * Layout Persistence Hooks
 *
 * Hooks for persisting record detail layout preferences to localStorage.
 * Uses versioned, scoped keys for safe migration.
 *
 * Key format: madrona:v1:{scope}:{feature}:{identifiers}
 */

import { useState, useCallback, createContext, useContext, type ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { logger } from '../../lib/logger';

// =============================================================================
// STORAGE KEY GENERATORS
// =============================================================================

const STORAGE_VERSION = 'v1';

export const STORAGE_KEYS = {
  /** Accordion state (org + user scoped) */
  accordionState: (orgId: string, userId: string) =>
    `madrona:${STORAGE_VERSION}:org:${orgId}:user:${userId}:record:accordions`,

  /** Recent sections (org + user scoped) */
  recentSections: (orgId: string, userId: string) =>
    `madrona:${STORAGE_VERSION}:org:${orgId}:user:${userId}:record:recentSections`,

  /** Recent sections panel collapsed state (org + user scoped) */
  recentSectionsCollapsed: (orgId: string, userId: string) =>
    `madrona:${STORAGE_VERSION}:org:${orgId}:user:${userId}:ui:recentSectionsCollapsed`,

  /** Section nav collapsed state (user-level) */
  sectionNavCollapsed: (userId: string) =>
    `madrona:${STORAGE_VERSION}:user:${userId}:ui:sectionNavCollapsed`,

  /** Right rail collapsed state (user-level) */
  rightRailCollapsed: (userId: string) =>
    `madrona:${STORAGE_VERSION}:user:${userId}:ui:rightRailCollapsed`,

  /** Custom section order (org + user scoped) */
  sectionOrder: (orgId: string, userId: string) =>
    `madrona:${STORAGE_VERSION}:org:${orgId}:user:${userId}:record:sectionOrder`,

  /** Nav group expanded state (user-level, per page type) */
  navGroupsExpanded: (userId: string, pageType: string) =>
    `madrona:${STORAGE_VERSION}:user:${userId}:ui:navGroups:${pageType}`,
};

// =============================================================================
// GENERIC PERSISTED STATE HOOK
// =============================================================================

function usePersistedState<T>(
  key: string | null,
  defaultValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    if (!key) return defaultValue;
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        return JSON.parse(stored) as T;
      }
    } catch (e) {
      logger.warn(`Failed to parse localStorage key "${key}":`, e);
    }
    return defaultValue;
  });

  const setPersistedState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const nextValue = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
        if (key) {
          try {
            localStorage.setItem(key, JSON.stringify(nextValue));
          } catch (e) {
            logger.warn(`Failed to save localStorage key "${key}":`, e);
          }
        }
        return nextValue;
      });
    },
    [key]
  );

  return [state, setPersistedState];
}

// =============================================================================
// ACCORDION STATE HOOK
// =============================================================================

interface AccordionState {
  expandedSections: string[];
  updatedAt: string;
}

const DEFAULT_EXPANDED_SECTIONS = ['identification', 'physical'];

export function useAccordionState(): [Set<string>, (sectionId: string) => void, () => void] {
  const { user, activeOrganizationId } = useAuth();
  const userId = user?.user_id;
  const orgId = activeOrganizationId;

  const key = userId && orgId
    ? STORAGE_KEYS.accordionState(orgId, userId)
    : null;

  const [state, setState] = usePersistedState<AccordionState>(key, {
    expandedSections: DEFAULT_EXPANDED_SECTIONS,
    updatedAt: new Date().toISOString(),
  });

  const expandedSet = new Set(state.expandedSections);

  const toggleSection = useCallback(
    (sectionId: string) => {
      setState((prev) => {
        const sections = new Set(prev.expandedSections);
        if (sections.has(sectionId)) {
          sections.delete(sectionId);
        } else {
          sections.add(sectionId);
        }
        return {
          expandedSections: Array.from(sections),
          updatedAt: new Date().toISOString(),
        };
      });
    },
    [setState]
  );

  const resetToDefault = useCallback(() => {
    setState({
      expandedSections: DEFAULT_EXPANDED_SECTIONS,
      updatedAt: new Date().toISOString(),
    });
  }, [setState]);

  return [expandedSet, toggleSection, resetToDefault];
}

// =============================================================================
// RECENT SECTIONS HOOK
// =============================================================================

const MAX_RECENT_SECTIONS = 3;

export function useRecentSections(): [string[], (sectionId: string) => void] {
  const { user, activeOrganizationId } = useAuth();
  const userId = user?.user_id;
  const orgId = activeOrganizationId;

  const key = userId && orgId ? STORAGE_KEYS.recentSections(orgId, userId) : null;
  const [recent, setRecent] = usePersistedState<string[]>(key, []);

  const recordVisit = useCallback(
    (sectionId: string) => {
      setRecent((prev) => {
        const filtered = prev.filter((id) => id !== sectionId);
        return [sectionId, ...filtered].slice(0, MAX_RECENT_SECTIONS);
      });
    },
    [setRecent]
  );

  return [recent, recordVisit];
}

// =============================================================================
// SECTION NAV COLLAPSED HOOK
// =============================================================================

export function useSectionNavCollapsed(): [boolean, (value: boolean) => void] {
  const { user } = useAuth();
  const userId = user?.user_id;

  const key = userId ? STORAGE_KEYS.sectionNavCollapsed(userId) : null;
  return usePersistedState<boolean>(key, false);
}

// =============================================================================
// RIGHT RAIL COLLAPSED HOOK
// =============================================================================

export function useRightRailCollapsed(): [boolean, (value: boolean) => void] {
  const { user } = useAuth();
  const userId = user?.user_id;

  const key = userId ? STORAGE_KEYS.rightRailCollapsed(userId) : null;
  return usePersistedState<boolean>(key, false);
}

// =============================================================================
// RECENT SECTIONS COLLAPSED HOOK
// =============================================================================

/**
 * Hook for persisting the RECENT sections panel collapsed state.
 * Defaults to collapsed (true) for new users.
 */
export function useRecentSectionsCollapsed(): [boolean, (value: boolean) => void] {
  const { user, activeOrganizationId } = useAuth();
  const userId = user?.user_id;
  const orgId = activeOrganizationId;

  const key = userId && orgId ? STORAGE_KEYS.recentSectionsCollapsed(orgId, userId) : null;
  // Default to collapsed (true) for new users
  return usePersistedState<boolean>(key, true);
}

// =============================================================================
// NAV GROUPS EXPANDED HOOK
// =============================================================================

/**
 * Hook for persisting which nav groups are expanded/collapsed.
 * Persists per user and page type (e.g., 'collection-object', 'object-entry').
 *
 * @param pageType - Identifier for the page type
 * @param defaultExpanded - Default expanded group IDs (from group config)
 */
export function useNavGroupsExpanded(
  pageType: string,
  defaultExpanded: string[]
): [Set<string>, (groupId: string) => void] {
  const { user } = useAuth();
  const userId = user?.user_id;

  const key = userId ? STORAGE_KEYS.navGroupsExpanded(userId, pageType) : null;
  const [expandedIds, setExpandedIds] = usePersistedState<string[]>(key, defaultExpanded);

  const toggleGroup = useCallback(
    (groupId: string) => {
      setExpandedIds((prev) => {
        const set = new Set(prev);
        if (set.has(groupId)) {
          set.delete(groupId);
        } else {
          set.add(groupId);
        }
        return Array.from(set);
      });
    },
    [setExpandedIds]
  );

  return [new Set(expandedIds), toggleGroup];
}

// =============================================================================
// SECTION ORDER HOOK & CONTEXT
// =============================================================================

interface SectionOrderState {
  /** Custom order of section IDs within each group */
  groupOrder: Record<string, string[]>;
  updatedAt: string;
}

interface SectionOrderContextValue {
  sectionOrder: Record<string, string[]>;
  updateGroupOrder: (groupId: string, sectionIds: string[]) => void;
  resetOrder: () => void;
}

const SectionOrderContext = createContext<SectionOrderContextValue | null>(null);

/**
 * Provider component for section order state.
 * Wrap your layout with this to share section order between nav and content.
 */
export function SectionOrderProvider({ children }: { children: ReactNode }) {
  const { user, activeOrganizationId } = useAuth();
  const userId = user?.user_id;
  const orgId = activeOrganizationId;

  const key = userId && orgId ? STORAGE_KEYS.sectionOrder(orgId, userId) : null;
  const [state, setState] = usePersistedState<SectionOrderState>(key, {
    groupOrder: {},
    updatedAt: new Date().toISOString(),
  });

  const updateGroupOrder = useCallback(
    (groupId: string, sectionIds: string[]) => {
      setState((prev) => ({
        groupOrder: {
          ...prev.groupOrder,
          [groupId]: sectionIds,
        },
        updatedAt: new Date().toISOString(),
      }));
    },
    [setState]
  );

  const resetOrder = useCallback(() => {
    setState({
      groupOrder: {},
      updatedAt: new Date().toISOString(),
    });
  }, [setState]);

  return (
    <SectionOrderContext.Provider value={{ sectionOrder: state.groupOrder, updateGroupOrder, resetOrder }}>
      {children}
    </SectionOrderContext.Provider>
  );
}

/**
 * Hook for accessing section order from context.
 * Must be used within a SectionOrderProvider.
 */
export function useSectionOrder(): [
  Record<string, string[]>,
  (groupId: string, sectionIds: string[]) => void,
  () => void
] {
  const context = useContext(SectionOrderContext);

  // Fallback to standalone hook if not within provider (for backwards compatibility)
  const { user, activeOrganizationId } = useAuth();
  const userId = user?.user_id;
  const orgId = activeOrganizationId;
  const key = userId && orgId ? STORAGE_KEYS.sectionOrder(orgId, userId) : null;

  const [fallbackState, setFallbackState] = usePersistedState<SectionOrderState>(key, {
    groupOrder: {},
    updatedAt: new Date().toISOString(),
  });

  const fallbackUpdateGroupOrder = useCallback(
    (groupId: string, sectionIds: string[]) => {
      setFallbackState((prev) => ({
        groupOrder: {
          ...prev.groupOrder,
          [groupId]: sectionIds,
        },
        updatedAt: new Date().toISOString(),
      }));
    },
    [setFallbackState]
  );

  const fallbackResetOrder = useCallback(() => {
    setFallbackState({
      groupOrder: {},
      updatedAt: new Date().toISOString(),
    });
  }, [setFallbackState]);

  // If we have a context, use it; otherwise use fallback
  if (context) {
    return [context.sectionOrder, context.updateGroupOrder, context.resetOrder];
  }

  return [fallbackState.groupOrder, fallbackUpdateGroupOrder, fallbackResetOrder];
}
