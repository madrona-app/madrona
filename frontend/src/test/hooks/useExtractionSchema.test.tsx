import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useExtractionSchema, useExtractionSchemas } from '../../hooks/useExtractionSchema';
import * as api from '../../lib/api';

// Mock the API
vi.mock('../../lib/api', () => ({
  getExtractionSchema: vi.fn(),
  listExtractionSchemas: vi.fn(),
}));

const mockGetExtractionSchema = vi.mocked(api.getExtractionSchema);
const mockListExtractionSchemas = vi.mocked(api.listExtractionSchemas);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useExtractionSchema', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when definitionKey is null', () => {
    it('returns null schema', () => {
      const { result } = renderHook(() => useExtractionSchema(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.schema).toBeNull();
    });

    it('returns loading false', () => {
      const { result } = renderHook(() => useExtractionSchema(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
    });

    it('returns hasExtractionSchema false', () => {
      const { result } = renderHook(() => useExtractionSchema(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.hasExtractionSchema).toBe(false);
    });

    it('does not call API', () => {
      renderHook(() => useExtractionSchema(null), {
        wrapper: createWrapper(),
      });

      expect(mockGetExtractionSchema).not.toHaveBeenCalled();
    });
  });

  describe('when definitionKey is provided', () => {
    it('returns loading true initially', () => {
      mockGetExtractionSchema.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useExtractionSchema('db-sqlserver'), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('calls API with definitionKey', async () => {
      mockGetExtractionSchema.mockResolvedValue({
        definitionKey: 'db-sqlserver',
        extractionSchema: {},
      } as any);

      renderHook(() => useExtractionSchema('db-sqlserver'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockGetExtractionSchema).toHaveBeenCalledWith('db-sqlserver');
      });
    });

    it('returns schema on success', async () => {
      const mockSchema = {
        definitionKey: 'db-sqlserver',
        extractionSchema: { type: 'object' },
        objectSchema: { type: 'object' },
      };

      mockGetExtractionSchema.mockResolvedValue(mockSchema as any);

      const { result } = renderHook(() => useExtractionSchema('db-sqlserver'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.schema).toEqual(mockSchema);
      });
    });

    it('sets hasExtractionSchema true when extractionSchema exists', async () => {
      mockGetExtractionSchema.mockResolvedValue({
        definitionKey: 'db-sqlserver',
        extractionSchema: { type: 'object' },
      } as any);

      const { result } = renderHook(() => useExtractionSchema('db-sqlserver'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.hasExtractionSchema).toBe(true);
      });
    });

    it('sets hasExtractionSchema false when extractionSchema is null', async () => {
      mockGetExtractionSchema.mockResolvedValue({
        definitionKey: 'db-sqlserver',
        extractionSchema: null,
      } as any);

      const { result } = renderHook(() => useExtractionSchema('db-sqlserver'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.hasExtractionSchema).toBe(false);
      });
    });

    it('sets loading false after fetch', async () => {
      mockGetExtractionSchema.mockResolvedValue({
        definitionKey: 'db-sqlserver',
        extractionSchema: {},
      } as any);

      const { result } = renderHook(() => useExtractionSchema('db-sqlserver'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('returns error on failure', async () => {
      const testError = new Error('API Error');
      mockGetExtractionSchema.mockRejectedValue(testError);

      const { result } = renderHook(() => useExtractionSchema('db-sqlserver'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.error).toBe(testError);
      });
    });

    it('returns null schema on error', async () => {
      mockGetExtractionSchema.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useExtractionSchema('db-sqlserver'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.schema).toBeNull();
      });
    });
  });
});

describe('useExtractionSchemas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('returns loading true initially', () => {
      mockListExtractionSchemas.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useExtractionSchemas(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('returns empty schemas initially', () => {
      mockListExtractionSchemas.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useExtractionSchemas(), {
        wrapper: createWrapper(),
      });

      expect(result.current.schemas).toEqual([]);
    });
  });

  describe('successful fetch', () => {
    it('returns schemas from API', async () => {
      const mockSchemas = [
        { definitionKey: 'db-sqlserver', extractionSchema: {} },
        { definitionKey: 'db-postgres', extractionSchema: {} },
      ];

      mockListExtractionSchemas.mockResolvedValue({ schemas: mockSchemas } as any);

      const { result } = renderHook(() => useExtractionSchemas(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.schemas).toEqual(mockSchemas);
      });
    });

    it('sets loading false after fetch', async () => {
      mockListExtractionSchemas.mockResolvedValue({ schemas: [] } as any);

      const { result } = renderHook(() => useExtractionSchemas(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe('direction filter', () => {
    it('passes source direction to API', async () => {
      mockListExtractionSchemas.mockResolvedValue({ schemas: [] } as any);

      renderHook(() => useExtractionSchemas('source'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockListExtractionSchemas).toHaveBeenCalledWith('source');
      });
    });

    it('passes target direction to API', async () => {
      mockListExtractionSchemas.mockResolvedValue({ schemas: [] } as any);

      renderHook(() => useExtractionSchemas('target'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockListExtractionSchemas).toHaveBeenCalledWith('target');
      });
    });

    it('passes undefined when no direction', async () => {
      mockListExtractionSchemas.mockResolvedValue({ schemas: [] } as any);

      renderHook(() => useExtractionSchemas(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockListExtractionSchemas).toHaveBeenCalledWith(undefined);
      });
    });
  });

  describe('error handling', () => {
    it('returns error on failure', async () => {
      const testError = new Error('API Error');
      mockListExtractionSchemas.mockRejectedValue(testError);

      const { result } = renderHook(() => useExtractionSchemas(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.error).toBe(testError);
      });
    });

    it('returns empty schemas on error', async () => {
      mockListExtractionSchemas.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useExtractionSchemas(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.schemas).toEqual([]);
      });
    });
  });
});
