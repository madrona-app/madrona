import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnboardingSeen } from '../../hooks/useOnboardingSeen';

const KEY = 'madrona.guide.onboarding.seen';

describe('useOnboardingSeen', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts unseen when userId and orgId are both known', () => {
    const { result } = renderHook(() => useOnboardingSeen('user-1', 'org-1'));
    expect(result.current.seen).toBe(false);
  });

  it('reports seen while auth is still loading (no userId/orgId)', () => {
    // Don't nag while we don't even know who's signing in.
    const { result } = renderHook(() => useOnboardingSeen(null, null));
    expect(result.current.seen).toBe(true);
  });

  it('persists dismissal and flips seen', () => {
    const { result } = renderHook(() => useOnboardingSeen('user-1', 'org-1'));
    act(() => {
      result.current.markSeen();
    });
    expect(result.current.seen).toBe(true);
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    expect(raw['user-1::org-1']).toBeTypeOf('number');
  });

  it('keeps the flag across re-mounts', () => {
    const first = renderHook(() => useOnboardingSeen('user-1', 'org-1'));
    act(() => {
      first.result.current.markSeen();
    });
    first.unmount();

    const second = renderHook(() => useOnboardingSeen('user-1', 'org-1'));
    expect(second.result.current.seen).toBe(true);
  });

  it('tracks each {userId × orgId} pair independently', () => {
    const { result: u1a } = renderHook(() => useOnboardingSeen('user-1', 'org-a'));
    act(() => {
      u1a.current.markSeen();
    });

    // Same user, different org — fresh welcome
    const { result: u1b } = renderHook(() => useOnboardingSeen('user-1', 'org-b'));
    expect(u1b.current.seen).toBe(false);

    // Different user, same org as first — also fresh
    const { result: u2a } = renderHook(() => useOnboardingSeen('user-2', 'org-a'));
    expect(u2a.current.seen).toBe(false);
  });

  it('reset() forgets the dismissal', () => {
    const { result } = renderHook(() => useOnboardingSeen('user-1', 'org-1'));
    act(() => {
      result.current.markSeen();
    });
    expect(result.current.seen).toBe(true);
    act(() => {
      result.current.reset();
    });
    expect(result.current.seen).toBe(false);
  });

  it('re-reads when the composite key changes (org switch)', () => {
    const { result, rerender } = renderHook(
      ({ userId, orgId }: { userId: string; orgId: string }) =>
        useOnboardingSeen(userId, orgId),
      { initialProps: { userId: 'user-1', orgId: 'org-a' } },
    );
    act(() => {
      result.current.markSeen();
    });
    expect(result.current.seen).toBe(true);

    rerender({ userId: 'user-1', orgId: 'org-b' });
    expect(result.current.seen).toBe(false);
  });

  it('tolerates malformed storage gracefully', () => {
    localStorage.setItem(KEY, 'not-json');
    const { result } = renderHook(() => useOnboardingSeen('user-1', 'org-1'));
    expect(result.current.seen).toBe(false);
  });
});
