import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { useAuth, useRequireAuth } from '../../hooks/useAuth';
import { AuthContext, type AuthContextValue } from '../../contexts/AuthContext';
import { createMockUser, createMockAuthContext } from '../utils/renderWithProviders';

function createWrapper(authContext: Partial<AuthContextValue> = {}) {
  const mockContext = createMockAuthContext(authContext);
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AuthContext.Provider value={mockContext}>
        {children}
      </AuthContext.Provider>
    );
  };
}

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns auth context value', () => {
    const user = createMockUser();
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper({ user }),
    });

    expect(result.current.user).toEqual(user);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('throws error when used outside AuthProvider', () => {
    // AuthContext defaults to undefined when no provider is present
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow('useAuth must be used within an AuthProvider');
  });

  it('returns all context methods', () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    expect(typeof result.current.refreshMe).toBe('function');
    expect(typeof result.current.logout).toBe('function');
    expect(typeof result.current.setActiveOrganization).toBe('function');
    expect(typeof result.current.hasAppAccess).toBe('function');
  });
});

describe('useRequireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns user when authenticated', () => {
    const user = createMockUser();
    const { result } = renderHook(() => useRequireAuth(), {
      wrapper: createWrapper({ user, isAuthenticated: true, isLoading: false }),
    });

    expect(result.current.user).toEqual(user);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns undefined user when loading', () => {
    const { result } = renderHook(() => useRequireAuth(), {
      wrapper: createWrapper({ user: null, isAuthenticated: false, isLoading: true }),
    });

    expect(result.current.user).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('returns null user when not authenticated', () => {
    const { result } = renderHook(() => useRequireAuth(), {
      wrapper: createWrapper({ user: null, isAuthenticated: false, isLoading: false }),
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
  });
});
