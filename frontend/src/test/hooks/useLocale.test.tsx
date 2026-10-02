import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { useLocale } from '../../hooks/useLocale';
import { AuthContext, type AuthContextValue } from '../../contexts/AuthContext';
import { createMockUser, createMockAuthContext } from '../utils/renderWithProviders';

function createWrapper(authOverrides: Partial<AuthContextValue> = {}) {
  const mockContext = createMockAuthContext(authOverrides);
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AuthContext.Provider value={mockContext}>
        {children}
      </AuthContext.Provider>
    );
  };
}

describe('useLocale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns user locale when set', () => {
    const user = createMockUser({ locale: 'fr-FR' });
    const { result } = renderHook(() => useLocale(), {
      wrapper: createWrapper({ user }),
    });

    expect(result.current).toBe('fr-FR');
  });

  it('falls back to navigator.language when user has no locale', () => {
    const user = createMockUser({ locale: null });
    const { result } = renderHook(() => useLocale(), {
      wrapper: createWrapper({ user }),
    });

    // navigator.language returns a string in test env
    expect(typeof result.current).toBe('string');
    expect(result.current.length).toBeGreaterThan(0);
  });

  it('falls back to navigator.language when user is null', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: createWrapper({ user: null }),
    });

    expect(typeof result.current).toBe('string');
  });

  it('returns user locale preference over browser default', () => {
    const user = createMockUser({ locale: 'ja-JP' });
    const { result } = renderHook(() => useLocale(), {
      wrapper: createWrapper({ user }),
    });

    expect(result.current).toBe('ja-JP');
  });
});
