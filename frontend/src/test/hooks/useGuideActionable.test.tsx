import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { PageContextProvider, usePageContext } from '../../contexts/PageContext';
import { useGuideActionable } from '../../hooks/useGuideActionable';

function wrapper({ children }: { children: React.ReactNode }) {
  return <PageContextProvider>{children}</PageContextProvider>;
}

/**
 * Harness: exposes both the hook under test and the page context setter so
 * each test can mutate context and observe the actionable state in one
 * renderHook invocation.
 */
function useHarness() {
  const actionable = useGuideActionable();
  const ctx = usePageContext();
  return { actionable, ctx };
}

describe('useGuideActionable', () => {
  it('returns non-actionable when there is no provider', () => {
    const { result } = renderHook(() => useGuideActionable());
    expect(result.current.actionable).toBe(false);
    expect(result.current.reason).toBeNull();
  });

  it('returns non-actionable on a page with no workflow', () => {
    const { result } = renderHook(useHarness, { wrapper });
    act(() => {
      result.current.ctx.setPageContext({
        route: '/organizations/abc/collections/objects',
      });
    });
    expect(result.current.actionable.actionable).toBe(false);
    expect(result.current.actionable.reason).toBeNull();
  });

  it('returns non-actionable when workflow has zero blockers', () => {
    const { result } = renderHook(useHarness, { wrapper });
    act(() => {
      result.current.ctx.setPageContext({
        route: '/x',
        editMode: true,
        workflow: { status: 'approved', blockingCount: 0, topBlockers: [] },
      });
    });
    expect(result.current.actionable.actionable).toBe(false);
  });

  it('fires even when editMode is off (viewers still see the nudge)', () => {
    // Dropped the edit-mode gate because most workflow pages don't use
    // the shared useWorkspacePage hook and therefore never push editMode
    // into PageContext at all. See useGuideActionable.ts header comment.
    const { result } = renderHook(useHarness, { wrapper });
    act(() => {
      result.current.ctx.setPageContext({
        route: '/x',
        editMode: false,
        workflow: { status: 'draft', blockingCount: 3, topBlockers: ['A'] },
      });
    });
    expect(result.current.actionable.actionable).toBe(true);
  });

  it('fires when editMode is undefined (most workflow pages)', () => {
    const { result } = renderHook(useHarness, { wrapper });
    act(() => {
      result.current.ctx.setPageContext({
        route: '/x',
        workflow: { status: 'draft', blockingCount: 2, topBlockers: ['X'] },
      });
    });
    expect(result.current.actionable.actionable).toBe(true);
  });

  it('returns actionable when in edit mode with blockers', () => {
    const { result } = renderHook(useHarness, { wrapper });
    act(() => {
      result.current.ctx.setPageContext({
        route: '/x',
        editMode: true,
        workflow: {
          status: 'draft',
          blockingCount: 2,
          topBlockers: ['Authorizer signature', 'Treatment description'],
        },
      });
    });
    expect(result.current.actionable.actionable).toBe(true);
    expect(result.current.actionable.reason).toContain('2 requirements blocking');
    expect(result.current.actionable.reason).toContain('Authorizer signature');
  });

  it('pluralizes correctly for a single blocker', () => {
    const { result } = renderHook(useHarness, { wrapper });
    act(() => {
      result.current.ctx.setPageContext({
        route: '/x',
        editMode: true,
        workflow: {
          status: 'draft',
          blockingCount: 1,
          topBlockers: ['Missing signature'],
        },
      });
    });
    expect(result.current.actionable.actionable).toBe(true);
    expect(result.current.actionable.reason).toMatch(/1 requirement blocking/);
    expect(result.current.actionable.reason).not.toMatch(/1 requirements/);
  });

  it('falls back gracefully when topBlockers is empty', () => {
    const { result } = renderHook(useHarness, { wrapper });
    act(() => {
      result.current.ctx.setPageContext({
        route: '/x',
        editMode: true,
        workflow: { status: 'draft', blockingCount: 1, topBlockers: [] },
      });
    });
    expect(result.current.actionable.actionable).toBe(true);
    // Should still produce a reason, just without the specific blocker name
    expect(result.current.actionable.reason).toBe('1 requirement blocking next step');
  });

  it('flips back to non-actionable when blockers are cleared', () => {
    const { result } = renderHook(useHarness, { wrapper });
    act(() => {
      result.current.ctx.setPageContext({
        route: '/x',
        editMode: true,
        workflow: { status: 'draft', blockingCount: 2, topBlockers: ['X'] },
      });
    });
    expect(result.current.actionable.actionable).toBe(true);
    act(() => {
      result.current.ctx.setPageContext({
        workflow: { status: 'approved', blockingCount: 0, topBlockers: [] },
      });
    });
    expect(result.current.actionable.actionable).toBe(false);
  });
});
