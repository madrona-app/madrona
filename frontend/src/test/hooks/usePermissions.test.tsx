import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePermissions } from '../../hooks/usePermissions';
import { AuthContext, type AuthContextValue } from '../../contexts/AuthContext';
import {
  createMockUser,
  createMockAdminUser,
  createMockAuthContext,
} from '../utils/renderWithProviders';

/**
 * Create a wrapper with AuthContext for testing hooks
 */
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

describe('usePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('with viewer user', () => {
    const viewerUser = createMockUser({
      permissions: ['data.view', 'runs.view'],
    });

    it('returns correct permissions array', () => {
      const { result } = renderHook(() => usePermissions(), {
        wrapper: createWrapper({ user: viewerUser }),
      });

      expect(result.current.permissions).toEqual(['data.view', 'runs.view']);
    });

    it('hasPermission returns true for granted permissions', () => {
      const { result } = renderHook(() => usePermissions(), {
        wrapper: createWrapper({ user: viewerUser }),
      });

      expect(result.current.hasPermission('data.view')).toBe(true);
      expect(result.current.hasPermission('runs.view')).toBe(true);
    });

    it('hasPermission returns false for denied permissions', () => {
      const { result } = renderHook(() => usePermissions(), {
        wrapper: createWrapper({ user: viewerUser }),
      });

      expect(result.current.hasPermission('runs.execute')).toBe(false);
      expect(result.current.hasPermission('settings.manage')).toBe(false);
    });
  });

  describe('with admin user', () => {
    const adminUser = createMockAdminUser();

    it('hasPermission returns true for all admin permissions', () => {
      const { result } = renderHook(() => usePermissions(), {
        wrapper: createWrapper({ user: adminUser }),
      });

      expect(result.current.hasPermission('data.view')).toBe(true);
      expect(result.current.hasPermission('data.manage')).toBe(true);
      expect(result.current.hasPermission('runs.execute')).toBe(true);
      expect(result.current.hasPermission('settings.manage')).toBe(true);
    });
  });

  describe('hasAnyPermission', () => {
    const viewerUser = createMockUser({
      permissions: ['data.view', 'runs.view'],
    });

    it('returns true if user has at least one permission', () => {
      const { result } = renderHook(() => usePermissions(), {
        wrapper: createWrapper({ user: viewerUser }),
      });

      expect(
        result.current.hasAnyPermission(['data.view', 'data.manage'])
      ).toBe(true);
      expect(
        result.current.hasAnyPermission(['runs.execute', 'runs.view'])
      ).toBe(true);
    });

    it('returns false if user has none of the permissions', () => {
      const { result } = renderHook(() => usePermissions(), {
        wrapper: createWrapper({ user: viewerUser }),
      });

      expect(
        result.current.hasAnyPermission(['data.manage', 'settings.manage'])
      ).toBe(false);
    });

    it('returns false for empty array', () => {
      const { result } = renderHook(() => usePermissions(), {
        wrapper: createWrapper({ user: viewerUser }),
      });

      expect(result.current.hasAnyPermission([])).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    const viewerUser = createMockUser({
      permissions: ['data.view', 'runs.view', 'pipelines.view'],
    });

    it('returns true if user has all permissions', () => {
      const { result } = renderHook(() => usePermissions(), {
        wrapper: createWrapper({ user: viewerUser }),
      });

      expect(
        result.current.hasAllPermissions(['data.view', 'runs.view'])
      ).toBe(true);
      expect(
        result.current.hasAllPermissions(['data.view'])
      ).toBe(true);
    });

    it('returns false if user is missing any permission', () => {
      const { result } = renderHook(() => usePermissions(), {
        wrapper: createWrapper({ user: viewerUser }),
      });

      expect(
        result.current.hasAllPermissions(['data.view', 'data.manage'])
      ).toBe(false);
      expect(
        result.current.hasAllPermissions(['runs.view', 'runs.execute'])
      ).toBe(false);
    });

    it('returns true for empty array', () => {
      const { result } = renderHook(() => usePermissions(), {
        wrapper: createWrapper({ user: viewerUser }),
      });

      expect(result.current.hasAllPermissions([])).toBe(true);
    });
  });

  describe('with undefined user', () => {
    it('returns empty permissions array', () => {
      const { result } = renderHook(() => usePermissions(), {
        wrapper: createWrapper({ user: null }),
      });

      expect(result.current.permissions).toEqual([]);
    });

    it('hasPermission returns false for all permissions', () => {
      const { result } = renderHook(() => usePermissions(), {
        wrapper: createWrapper({ user: null }),
      });

      expect(result.current.hasPermission('data.view')).toBe(false);
      expect(result.current.hasPermission('runs.execute')).toBe(false);
    });

    it('hasAnyPermission returns false', () => {
      const { result } = renderHook(() => usePermissions(), {
        wrapper: createWrapper({ user: null }),
      });

      expect(result.current.hasAnyPermission(['data.view'])).toBe(false);
    });

    it('hasAllPermissions returns true for empty array, false otherwise', () => {
      const { result } = renderHook(() => usePermissions(), {
        wrapper: createWrapper({ user: null }),
      });

      expect(result.current.hasAllPermissions([])).toBe(true);
      expect(result.current.hasAllPermissions(['data.view'])).toBe(false);
    });
  });

  describe('with user missing permissions field', () => {
    it('handles undefined permissions gracefully', () => {
      const userWithoutPermissions = {
        ...createMockUser(),
        permissions: undefined as unknown as string[],
      };

      const { result } = renderHook(() => usePermissions(), {
        wrapper: createWrapper({ user: userWithoutPermissions }),
      });

      expect(result.current.permissions).toEqual([]);
      expect(result.current.hasPermission('data.view')).toBe(false);
    });
  });
});
