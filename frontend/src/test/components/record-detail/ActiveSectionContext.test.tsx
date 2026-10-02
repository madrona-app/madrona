import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  ActiveSectionProvider,
  useActiveSection,
  useActiveSectionRequired,
} from '../../../components/record-detail/ActiveSectionContext';

function wrapper({ children }: { children: ReactNode }) {
  return <ActiveSectionProvider>{children}</ActiveSectionProvider>;
}

describe('ActiveSectionContext', () => {
  it('useActiveSection returns null outside the provider', () => {
    const { result } = renderHook(() => useActiveSection());
    expect(result.current).toBeNull();
  });

  it('useActiveSection exposes active section and setter inside the provider', () => {
    const { result } = renderHook(() => useActiveSection(), { wrapper });
    expect(result.current).not.toBeNull();
    expect(result.current!.activeSection).toBe('');
    expect(typeof result.current!.setActiveSection).toBe('function');
  });

  it('setActiveSection updates the stored section id', () => {
    const { result } = renderHook(() => useActiveSection(), { wrapper });

    act(() => {
      result.current!.setActiveSection('physical');
    });
    expect(result.current!.activeSection).toBe('physical');

    act(() => {
      result.current!.setActiveSection('condition');
    });
    expect(result.current!.activeSection).toBe('condition');
  });

  it('useActiveSectionRequired throws outside provider', () => {
    expect(() => renderHook(() => useActiveSectionRequired())).toThrow(
      /useActiveSectionRequired must be used within ActiveSectionProvider/,
    );
  });

  it('useActiveSectionRequired returns context inside provider', () => {
    const { result } = renderHook(() => useActiveSectionRequired(), { wrapper });
    expect(result.current.activeSection).toBe('');
    act(() => {
      result.current.setActiveSection('id-1');
    });
    expect(result.current.activeSection).toBe('id-1');
  });
});
