import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useScrollSpy,
  scrollToSection,
  getCurrentSection,
} from '../../../components/record-detail/useScrollSpy';

describe('useScrollSpy', () => {
  it('returns empty initial active section and a setter', () => {
    const { result } = renderHook(() => useScrollSpy(['a', 'b', 'c']));
    const [active, setActive] = result.current;
    expect(active).toBe('');
    expect(typeof setActive).toBe('function');
  });

  it('updates the active section when the setter is called', () => {
    const { result } = renderHook(() => useScrollSpy(['a', 'b']));
    act(() => {
      result.current[1]('b');
    });
    expect(result.current[0]).toBe('b');
  });

  it('works with empty section list', () => {
    const { result } = renderHook(() => useScrollSpy([]));
    expect(result.current[0]).toBe('');
    act(() => {
      result.current[1]('anything');
    });
    expect(result.current[0]).toBe('anything');
  });
});

describe('scrollToSection', () => {
  let scrollToSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollToSpy = vi.fn();
    window.scrollTo = scrollToSpy as unknown as typeof window.scrollTo;
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('does nothing when the target element is missing', () => {
    scrollToSection('missing-id');
    expect(scrollToSpy).not.toHaveBeenCalled();
  });


});

describe('getCurrentSection', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('returns first id when no elements exist', () => {
    expect(getCurrentSection(['a', 'b'])).toBe('a');
  });

  it('returns empty string when given empty list', () => {
    expect(getCurrentSection([])).toBe('');
  });

  it('picks the section whose top is at/above the offset and bottom past it', () => {
    const a = document.createElement('div');
    a.id = 'section-a';
    const b = document.createElement('div');
    b.id = 'section-b';
    document.body.appendChild(a);
    document.body.appendChild(b);

    vi.spyOn(a, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      bottom: 100,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(b, 'getBoundingClientRect').mockReturnValue({
      top: 500,
      bottom: 600,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    // Offset 50 => a's top=10, bottom=100 crosses 50 => active is 'a'
    expect(getCurrentSection(['a', 'b'], 50)).toBe('a');
  });
});
