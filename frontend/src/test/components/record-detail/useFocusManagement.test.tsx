import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFocusManagement } from '../../../components/record-detail/useFocusManagement';

describe('useFocusManagement', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('returns expected API surface', () => {
    const { result } = renderHook(() => useFocusManagement());
    expect(typeof result.current.saveFocus).toBe('function');
    expect(typeof result.current.restoreFocus).toBe('function');
    expect(typeof result.current.focusSection).toBe('function');
    expect(typeof result.current.focusFirst).toBe('function');
  });

  it('saveFocus + restoreFocus brings focus back to the previously focused element', () => {
    const a = document.createElement('button');
    a.textContent = 'A';
    const b = document.createElement('button');
    b.textContent = 'B';
    document.body.appendChild(a);
    document.body.appendChild(b);

    a.focus();
    expect(document.activeElement).toBe(a);

    const { result } = renderHook(() => useFocusManagement());

    act(() => {
      result.current.saveFocus();
    });

    b.focus();
    expect(document.activeElement).toBe(b);

    act(() => {
      result.current.restoreFocus();
    });

    expect(document.activeElement).toBe(a);

    // Calling restoreFocus again should be a no-op (ref is cleared)
    b.focus();
    act(() => {
      result.current.restoreFocus();
    });
    expect(document.activeElement).toBe(b);
  });

  it('focusFirst focuses the first focusable element within a container', () => {
    const container = document.createElement('div');
    const disabled = document.createElement('button');
    disabled.setAttribute('disabled', '');
    const first = document.createElement('button');
    first.textContent = 'First';
    const second = document.createElement('input');
    container.appendChild(disabled);
    container.appendChild(first);
    container.appendChild(second);
    document.body.appendChild(container);

    const { result } = renderHook(() => useFocusManagement());

    act(() => {
      result.current.focusFirst(container);
    });

    expect(document.activeElement).toBe(first);
  });

  it('focusFirst handles null container gracefully', () => {
    const { result } = renderHook(() => useFocusManagement());
    expect(() => result.current.focusFirst(null)).not.toThrow();
  });

  it('focusSection focuses an accordion trigger button after delay', () => {
    vi.useFakeTimers();

    const section = document.createElement('div');
    section.id = 'section-identification';
    const trigger = document.createElement('button');
    trigger.setAttribute('aria-expanded', 'true');
    section.appendChild(trigger);
    document.body.appendChild(section);

    const { result } = renderHook(() => useFocusManagement());
    act(() => {
      result.current.focusSection('identification', 50);
    });

    // Before the timer elapses, focus is not yet moved
    expect(document.activeElement).not.toBe(trigger);

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(document.activeElement).toBe(trigger);

    vi.useRealTimers();
  });


  it('focusSection does nothing when section not found', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFocusManagement());
    const before = document.activeElement;

    act(() => {
      result.current.focusSection('nonexistent', 0);
      vi.advanceTimersByTime(0);
    });

    // Active element should be unchanged
    expect(document.activeElement).toBe(before);
    vi.useRealTimers();
  });
});
