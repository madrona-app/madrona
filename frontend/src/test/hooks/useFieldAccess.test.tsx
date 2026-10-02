import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { useFieldAccess } from '../../hooks/useFieldAccess';
import { AuthContext, type AuthContextValue } from '../../contexts/AuthContext';
import { createMockAuthContext } from '../utils/renderWithProviders';

function createWrapper(authOverrides: Partial<AuthContextValue> = {}) {
  const mockContext: AuthContextValue = {
    ...createMockAuthContext(authOverrides),
    roleOverride: authOverrides.roleOverride ?? null,
    setRoleOverride: vi.fn(),
  };
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AuthContext.Provider value={mockContext}>
        {children}
      </AuthContext.Provider>
    );
  };
}

describe('useFieldAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('with restricted fields', () => {
    it('reports restricted fields correctly', () => {
      const { result } = renderHook(
        () => useFieldAccess(['insurance_value', 'provenance']),
        { wrapper: createWrapper({ isPlatformAdmin: false }) }
      );

      expect(result.current.isRestricted('insurance_value')).toBe(true);
      expect(result.current.isRestricted('provenance')).toBe(true);
      expect(result.current.hasRestrictions).toBe(true);
    });

    it('reports unrestricted fields correctly', () => {
      const { result } = renderHook(
        () => useFieldAccess(['insurance_value']),
        { wrapper: createWrapper({ isPlatformAdmin: false }) }
      );

      expect(result.current.isRestricted('title')).toBe(false);
      expect(result.current.isRestricted('description')).toBe(false);
    });
  });

  describe('with no restricted fields', () => {
    it('reports no restrictions when array is empty', () => {
      const { result } = renderHook(
        () => useFieldAccess([]),
        { wrapper: createWrapper({ isPlatformAdmin: false }) }
      );

      expect(result.current.isRestricted('anything')).toBe(false);
      expect(result.current.hasRestrictions).toBe(false);
    });

    it('handles undefined restricted fields', () => {
      const { result } = renderHook(
        () => useFieldAccess(undefined),
        { wrapper: createWrapper({ isPlatformAdmin: false }) }
      );

      expect(result.current.isRestricted('anything')).toBe(false);
      expect(result.current.hasRestrictions).toBe(false);
    });
  });

  describe('platform admin bypass', () => {
    it('bypasses all restrictions for platform admin', () => {
      const { result } = renderHook(
        () => useFieldAccess(['insurance_value', 'provenance']),
        { wrapper: createWrapper({ isPlatformAdmin: true }) }
      );

      expect(result.current.isRestricted('insurance_value')).toBe(false);
      expect(result.current.isRestricted('provenance')).toBe(false);
      expect(result.current.hasRestrictions).toBe(false);
    });

    it('does not bypass when roleOverride is active', () => {
      const { result } = renderHook(
        () => useFieldAccess(['insurance_value']),
        {
          wrapper: createWrapper({
            isPlatformAdmin: true,
            roleOverride: 'viewer',
          }),
        }
      );

      expect(result.current.isRestricted('insurance_value')).toBe(true);
      expect(result.current.hasRestrictions).toBe(true);
    });
  });
});
