import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCommandPaletteShortcut } from '../../hooks/useCommandPaletteShortcut';

describe('useCommandPaletteShortcut', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function fireKey(opts: {
    key: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
  }): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', {
      key: opts.key,
      metaKey: !!opts.metaKey,
      ctrlKey: !!opts.ctrlKey,
      cancelable: true,
    });
    window.dispatchEvent(ev);
    return ev;
  }

  it('invokes onToggle when Cmd+K is pressed', () => {
    const onToggle = vi.fn();
    renderHook(() => useCommandPaletteShortcut(onToggle));

    fireKey({ key: 'k', metaKey: true });

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('invokes onToggle when Ctrl+K is pressed', () => {
    const onToggle = vi.fn();
    renderHook(() => useCommandPaletteShortcut(onToggle));

    fireKey({ key: 'k', ctrlKey: true });

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('accepts capital K (shift-aware)', () => {
    const onToggle = vi.fn();
    renderHook(() => useCommandPaletteShortcut(onToggle));

    fireKey({ key: 'K', metaKey: true });

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does not fire for plain k (no modifier)', () => {
    const onToggle = vi.fn();
    renderHook(() => useCommandPaletteShortcut(onToggle));

    fireKey({ key: 'k' });

    expect(onToggle).not.toHaveBeenCalled();
  });

  it('does not fire for other keys with Cmd', () => {
    const onToggle = vi.fn();
    renderHook(() => useCommandPaletteShortcut(onToggle));

    fireKey({ key: 'a', metaKey: true });
    fireKey({ key: 'p', metaKey: true });

    expect(onToggle).not.toHaveBeenCalled();
  });

  it('calls preventDefault on the event', () => {
    const onToggle = vi.fn();
    renderHook(() => useCommandPaletteShortcut(onToggle));

    const ev = fireKey({ key: 'k', metaKey: true });

    expect(ev.defaultPrevented).toBe(true);
  });

  it('removes the event listener on unmount', () => {
    const onToggle = vi.fn();
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useCommandPaletteShortcut(onToggle));
    unmount();

    // Ensure a removeEventListener with 'keydown' was called
    const keydownRemovals = removeSpy.mock.calls.filter((c) => c[0] === 'keydown');
    expect(keydownRemovals.length).toBeGreaterThanOrEqual(1);

    // After unmount, pressing Cmd+K should not invoke the old callback
    fireKey({ key: 'k', metaKey: true });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('rebinds when the callback identity changes', () => {
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) => useCommandPaletteShortcut(cb),
      { initialProps: { cb: first } },
    );

    fireKey({ key: 'k', metaKey: true });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    rerender({ cb: second });

    fireKey({ key: 'k', metaKey: true });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
