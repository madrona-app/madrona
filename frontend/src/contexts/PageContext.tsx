/**
 * PageContext — a live snapshot of where the user is in the app.
 *
 * Populated from multiple sources and read by `useAgentChat.sendMessage` on
 * every turn so the Guide sees the user's current page (route, section,
 * entity, workflow state, edit mode) without having to ask.
 *
 * Sources:
 *   - `usePageContextAutoDetect` (mounted in AppShell) — route + product +
 *     navItemId, auto-matched against the nav catalog
 *   - `useWorkspacePage` — entity + editMode, from the page that owns the record
 *   - `ProcedureRequirementsCard` — workflow status + blocking requirements
 *
 * Why a ref alongside state: `useAgentChat.sendMessage` is a stable callback
 * that reads the latest context at send-time. Wiring it through a state
 * closure would stale-capture the first render. The ref gives O(1) access
 * to the live value; state is exposed for any consumers that want to react.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface PageContextEntity {
  type: string;
  id: string;
  label: string;
}

export interface PageContextWorkflow {
  status: string;
  blockingCount: number;
  /** Short labels of the top blockers (≤3 — backend caps to match). */
  topBlockers: string[];
}

export interface PageContextValue {
  route: string;
  product?: string;
  navItemId?: string;
  entity?: PageContextEntity;
  workflow?: PageContextWorkflow;
  editMode?: boolean;
}

interface PageContextApi {
  /** Current snapshot. Reactive — changes trigger re-renders of consumers. */
  pageContext: PageContextValue;
  /** Live ref for callbacks that need the latest value without re-subscribing. */
  pageContextRef: React.MutableRefObject<PageContextValue>;
  /** Merge partial updates into the snapshot. */
  setPageContext: (update: Partial<PageContextValue>) => void;
  /** Clear entity + workflow fields (used when leaving a workspace page). */
  clearEntityContext: () => void;
}

const DEFAULT_CONTEXT: PageContextValue = {
  route: typeof window !== 'undefined' ? window.location.pathname : '/',
};

const PageContextReactContext = createContext<PageContextApi | undefined>(undefined);

/**
 * Shallow-equal check for two PageContextValue shapes. Sub-objects
 * (entity, workflow) are compared field-by-field so callers that push the
 * same content in a new object reference don't cause a re-render cascade.
 *
 * This is the safety net that keeps the whole provider resilient to the
 * classic "unstable object identity in a useEffect dep" bug — if a
 * consumer keeps pushing "equivalent" updates, we just swallow them.
 */
function pageContextsEqual(a: PageContextValue, b: PageContextValue): boolean {
  if (a === b) return true;
  if (
    a.route !== b.route ||
    a.product !== b.product ||
    a.navItemId !== b.navItemId ||
    a.editMode !== b.editMode
  ) {
    return false;
  }
  // entity
  if (!!a.entity !== !!b.entity) return false;
  if (a.entity && b.entity) {
    if (
      a.entity.type !== b.entity.type ||
      a.entity.id !== b.entity.id ||
      a.entity.label !== b.entity.label
    ) {
      return false;
    }
  }
  // workflow
  if (!!a.workflow !== !!b.workflow) return false;
  if (a.workflow && b.workflow) {
    if (
      a.workflow.status !== b.workflow.status ||
      a.workflow.blockingCount !== b.workflow.blockingCount
    ) {
      return false;
    }
    if (a.workflow.topBlockers.length !== b.workflow.topBlockers.length) return false;
    for (let i = 0; i < a.workflow.topBlockers.length; i++) {
      if (a.workflow.topBlockers[i] !== b.workflow.topBlockers[i]) return false;
    }
  }
  return true;
}

export function PageContextProvider({ children }: { children: React.ReactNode }) {
  const [pageContext, setPageContextState] = useState<PageContextValue>(DEFAULT_CONTEXT);
  const pageContextRef = useRef<PageContextValue>(DEFAULT_CONTEXT);

  const setPageContext = useCallback((update: Partial<PageContextValue>) => {
    setPageContextState((prev) => {
      // Shallow merge — entity/workflow get replaced wholesale, not deep-merged,
      // because callers own those sub-objects and we want clears to work.
      const next: PageContextValue = { ...prev, ...update };
      // Content-equal? Return the prior reference so React bails out of
      // the re-render and no consumers fire their effects.
      if (pageContextsEqual(prev, next)) {
        return prev;
      }
      pageContextRef.current = next;
      return next;
    });
  }, []);

  const clearEntityContext = useCallback(() => {
    setPageContextState((prev) => {
      if (
        prev.entity === undefined &&
        prev.workflow === undefined &&
        prev.editMode === undefined
      ) {
        return prev;
      }
      const next: PageContextValue = { ...prev };
      delete next.entity;
      delete next.workflow;
      delete next.editMode;
      pageContextRef.current = next;
      return next;
    });
  }, []);

  const value = useMemo<PageContextApi>(
    () => ({ pageContext, pageContextRef, setPageContext, clearEntityContext }),
    [pageContext, setPageContext, clearEntityContext],
  );

  return (
    <PageContextReactContext.Provider value={value}>
      {children}
    </PageContextReactContext.Provider>
  );
}

/**
 * Consumer hook. Safe to call outside a provider — returns a no-op fallback
 * so code paths that don't depend on PageContext (e.g. unauthenticated
 * routes, tests) don't crash. The fallback is detectable via `hasProvider`.
 */
export function usePageContext(): PageContextApi & { hasProvider: boolean } {
  const ctx = useContext(PageContextReactContext);
  const fallbackRef = useRef<PageContextValue>(DEFAULT_CONTEXT);
  if (ctx) {
    return { ...ctx, hasProvider: true };
  }
  return {
    pageContext: DEFAULT_CONTEXT,
    pageContextRef: fallbackRef,
    setPageContext: () => {},
    clearEntityContext: () => {},
    hasProvider: false,
  };
}
