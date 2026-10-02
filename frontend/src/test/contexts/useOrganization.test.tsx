import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { OrgContext, type OrgContextValue } from '../../contexts/orgContextTypes';
import { useOrganization } from '../../contexts/useOrganization';

function makeContextValue(overrides: Partial<OrgContextValue> = {}): OrgContextValue {
  return {
    activeOrganizationId: 'org-1',
    activeOrganization: {
      organization_id: 'org-1',
      organization_name: 'Org One',
      organization_slug: 'org-one',
      organization_timezone: 'UTC',
      role: 'admin',
    },
    organizations: [],
    setActiveOrganizationId: vi.fn().mockResolvedValue(undefined),
    refreshOrganizations: vi.fn(),
    isLoading: false,
    error: null,
    ...overrides,
  };
}

function makeWrapper(value: OrgContextValue) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
  };
}

describe('useOrganization', () => {
  it('returns the OrgContext value when inside provider', () => {
    const value = makeContextValue();
    const { result } = renderHook(() => useOrganization(), {
      wrapper: makeWrapper(value),
    });
    expect(result.current.activeOrganizationId).toBe('org-1');
    expect(result.current.activeOrganization?.organization_name).toBe('Org One');
  });

  it('exposes loading and error state from context', () => {
    const err = new Error('boom');
    const value = makeContextValue({
      activeOrganizationId: null,
      activeOrganization: null,
      isLoading: true,
      error: err,
    });
    const { result } = renderHook(() => useOrganization(), {
      wrapper: makeWrapper(value),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBe(err);
    expect(result.current.activeOrganizationId).toBeNull();
  });

  it('throws when used outside an OrgProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useOrganization())).toThrow(
      /useOrganization must be used within an OrgProvider/
    );
    spy.mockRestore();
  });
});
