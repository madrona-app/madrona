import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useProcedureRequirements } from '../../hooks/useProcedureRequirements';

// Mock apiClient
vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../lib/apiClient';
const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

const mockApiResponse = {
  procedureType: 'object_entry',
  procedureLabel: 'Object Entry',
  procedureProcedure: 'Object entry',
  statusOrder: ['draft', 'pending', 'approved', 'completed'],
  enforcementEnabled: true,
  requirementGroups: [
    {
      id: 'entry-details',
      label: 'Entry Details',
      sectionId: 'details',
      requirements: [
        {
          id: 'entry_reason',
          label: 'Entry reason',
          groupId: 'entry-details',
          fieldPaths: ['entry_reason'],
          requiredForStatuses: ['pending', 'approved'],
          severity: 'blocking' as const,
          hasPredicate: false,
        },
        {
          id: 'items_count',
          label: 'At least one item linked',
          groupId: 'entry-details',
          fieldPaths: ['items'],
          requiredForStatuses: ['approved'],
          severity: 'blocking' as const,
          hasPredicate: true,
        },
      ],
    },
  ],
};

describe('useProcedureRequirements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockReset();
  });

  describe('loading state', () => {
    it('starts with loading true and empty data', () => {
      mockApiFetch.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(
        () => useProcedureRequirements('object_entry'),
        { wrapper: createWrapper() }
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.requirementGroups).toEqual([]);
      expect(result.current.statusOrder).toEqual([]);
      expect(result.current.procedureLabel).toBe('');
      expect(result.current.enforcementEnabled).toBe(false);
    });
  });

  describe('successful fetch', () => {
    it('returns hydrated requirement groups', async () => {
      mockApiFetch.mockResolvedValue(mockApiResponse);

      const { result } = renderHook(
        () => useProcedureRequirements('object_entry'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.requirementGroups).toHaveLength(1);
      expect(result.current.requirementGroups[0].id).toBe('entry-details');
      expect(result.current.requirementGroups[0].requirements).toHaveLength(2);
    });

    it('hydrates predicates from registry', async () => {
      mockApiFetch.mockResolvedValue(mockApiResponse);

      const { result } = renderHook(
        () => useProcedureRequirements('object_entry'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // The items_count requirement should have a predicate attached
      const itemsCountReq = result.current.requirementGroups[0].requirements.find(
        r => r.id === 'items_count'
      );
      expect(itemsCountReq?.predicate).toBeDefined();
      expect(typeof itemsCountReq?.predicate).toBe('function');

      // Test the predicate
      expect(itemsCountReq!.predicate!({ items: [{ id: 'i1' }] })).toBe(true);
      expect(itemsCountReq!.predicate!({ items: [] })).toBe(false);
    });

    it('does not attach predicate when hasPredicate is false', async () => {
      mockApiFetch.mockResolvedValue(mockApiResponse);

      const { result } = renderHook(
        () => useProcedureRequirements('object_entry'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const entryReasonReq = result.current.requirementGroups[0].requirements.find(
        r => r.id === 'entry_reason'
      );
      expect(entryReasonReq?.predicate).toBeUndefined();
    });

    it('returns status order and procedure label', async () => {
      mockApiFetch.mockResolvedValue(mockApiResponse);

      const { result } = renderHook(
        () => useProcedureRequirements('object_entry'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.statusOrder).toEqual(['draft', 'pending', 'approved', 'completed']);
      expect(result.current.procedureLabel).toBe('Object Entry');
      expect(result.current.enforcementEnabled).toBe(true);
    });
  });

  describe('with organization ID', () => {
    it('fetches the shared baseline route without an organization', async () => {
      mockApiFetch.mockResolvedValue(mockApiResponse);

      renderHook(
        () => useProcedureRequirements('object_entry'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/procedure-requirements/object_entry');
      });
    });

    it('fetches the org-scoped route', async () => {
      mockApiFetch.mockResolvedValue(mockApiResponse);

      renderHook(
        () => useProcedureRequirements('object_entry', 'org-1'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/organizations/org-1/procedure-requirements/object_entry'
        );
      });
    });
  });

  describe('org-added required fields', () => {
    it('keeps the org group, marks sources, and exposes orgRequiredFields', async () => {
      mockApiFetch.mockResolvedValue({
        ...mockApiResponse,
        requirementGroups: [
          ...mockApiResponse.requirementGroups.map((g) => ({
            ...g,
            requirements: g.requirements.map((r) => ({ ...r, source: 'baseline' })),
          })),
          {
            id: 'org_required',
            label: 'Required by your organization',
            sectionId: 'details',
            requirements: [{
              id: 'org:insurance_policy',
              label: 'Insurance policy',
              groupId: 'org_required',
              fieldPaths: ['insurance_policy'],
              requiredForStatuses: ['pending', 'approved', 'completed'],
              severity: 'blocking',
              source: 'org',
            }],
          },
        ],
        orgRequiredFields: [{ field: 'insurance_policy', label: 'Insurance policy' }],
      });

      const { result } = renderHook(
        () => useProcedureRequirements('object_entry', 'org-1'),
        { wrapper: createWrapper() }
      );
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      const orgGroup = result.current.requirementGroups.find((g) => g.id === 'org_required');
      expect(orgGroup?.requirements[0]).toMatchObject({
        fieldPaths: ['insurance_policy'],
        severity: 'blocking',
        source: 'org',
      });
      expect(result.current.requirementGroups[0].requirements[0].source).toBe('baseline');
      expect(result.current.orgRequiredFields).toEqual([{ field: 'insurance_policy', label: 'Insurance policy' }]);
    });
  });

  describe('error handling', () => {
    it('returns error on fetch failure', async () => {
      mockApiFetch.mockRejectedValue(new Error('API error'));

      const { result } = renderHook(
        () => useProcedureRequirements('object_entry'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeTruthy();
      expect(result.current.requirementGroups).toEqual([]);
    });
  });
});
