import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConstituentSelector, useConstituentSelectors } from '../../hooks/useContactSelector';

describe('useConstituentSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts with isOpen false', () => {
      const { result } = renderHook(() => useConstituentSelector());
      expect(result.current.isOpen).toBe(false);
    });

    it('returns open, close, and createSelectHandler', () => {
      const { result } = renderHook(() => useConstituentSelector());
      expect(typeof result.current.open).toBe('function');
      expect(typeof result.current.close).toBe('function');
      expect(typeof result.current.createSelectHandler).toBe('function');
    });
  });

  describe('open/close', () => {
    it('sets isOpen to true when opened', () => {
      const { result } = renderHook(() => useConstituentSelector());

      act(() => {
        result.current.open();
      });

      expect(result.current.isOpen).toBe(true);
    });

    it('sets isOpen to false when closed', () => {
      const { result } = renderHook(() => useConstituentSelector());

      act(() => {
        result.current.open();
      });
      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.close();
      });
      expect(result.current.isOpen).toBe(false);
    });
  });

  describe('createSelectHandler', () => {
    it('calls onSelect callback and closes the selector', () => {
      const { result } = renderHook(() => useConstituentSelector());
      const onSelect = vi.fn();

      act(() => {
        result.current.open();
      });
      expect(result.current.isOpen).toBe(true);

      const handler = result.current.createSelectHandler(onSelect);

      act(() => {
        handler('contact-123');
      });

      expect(onSelect).toHaveBeenCalledWith('contact-123');
      expect(result.current.isOpen).toBe(false);
    });

    it('works when called multiple times', () => {
      const { result } = renderHook(() => useConstituentSelector());
      const onSelect = vi.fn();
      const handler = result.current.createSelectHandler(onSelect);

      act(() => {
        result.current.open();
      });

      act(() => {
        handler('contact-1');
      });
      expect(onSelect).toHaveBeenCalledWith('contact-1');

      act(() => {
        result.current.open();
      });

      act(() => {
        handler('contact-2');
      });
      expect(onSelect).toHaveBeenCalledWith('contact-2');
      expect(onSelect).toHaveBeenCalledTimes(2);
    });
  });
});

describe('useConstituentSelectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates selectors for each field name', () => {
    const { result } = renderHook(() =>
      useConstituentSelectors(['depositor', 'owner', 'lender'] as const)
    );

    expect(result.current.depositor).toBeDefined();
    expect(result.current.owner).toBeDefined();
    expect(result.current.lender).toBeDefined();
  });

  it('each selector starts closed', () => {
    const { result } = renderHook(() =>
      useConstituentSelectors(['depositor', 'owner'] as const)
    );

    expect(result.current.depositor.isOpen).toBe(false);
    expect(result.current.owner.isOpen).toBe(false);
  });

  it('selectors are independent of each other', () => {
    const { result } = renderHook(() =>
      useConstituentSelectors(['depositor', 'owner'] as const)
    );

    act(() => {
      result.current.depositor.open();
    });

    expect(result.current.depositor.isOpen).toBe(true);
    expect(result.current.owner.isOpen).toBe(false);
  });

  it('createSelectHandler closes the specific selector', () => {
    const { result } = renderHook(() =>
      useConstituentSelectors(['depositor', 'owner'] as const)
    );

    const onSelect = vi.fn();

    act(() => {
      result.current.depositor.open();
      result.current.owner.open();
    });

    const handler = result.current.depositor.createSelectHandler(onSelect);

    act(() => {
      handler('contact-123');
    });

    expect(onSelect).toHaveBeenCalledWith('contact-123');
    expect(result.current.depositor.isOpen).toBe(false);
    // Owner should remain open
    expect(result.current.owner.isOpen).toBe(true);
  });
});
