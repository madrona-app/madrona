import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGeo } from '../../hooks/useGeo';

// Mock useAuth
vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn().mockReturnValue({
    activeOrganizationId: 'org-1',
  }),
}));

// Mock apiClient
vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../lib/apiClient';
const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('useGeo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockReset();
  });

  describe('initialization', () => {
    it('returns mutation and query functions', () => {
      const { result } = renderHook(() => useGeo(), { wrapper: createWrapper() });

      expect(result.current.geocode).toBeDefined();
      expect(result.current.reverseGeocode).toBeDefined();
      expect(result.current.searchObjectsInPolygon).toBeDefined();
      expect(result.current.updatePlaceGeometry).toBeDefined();
      expect(result.current.updateVenueGeometry).toBeDefined();
      expect(result.current.calculateDistance).toBeDefined();
      expect(typeof result.current.useNearbyPlaces).toBe('function');
      expect(typeof result.current.useLoanNetwork).toBe('function');
      expect(typeof result.current.useTourRoute).toBe('function');
      expect(typeof result.current.useCollectionOrigins).toBe('function');
      expect(typeof result.current.useExhibitionShipments).toBe('function');
      expect(typeof result.current.useHeadquarters).toBe('function');
    });
  });

  describe('geocode mutation', () => {
    it('calls API with correct params', async () => {
      mockApiFetch.mockResolvedValueOnce({
        success: true,
        point: { latitude: 40.7, longitude: -74 },
      });

      const { result } = renderHook(() => useGeo(), { wrapper: createWrapper() });

      await result.current.geocode.mutateAsync({ address: '123 Main St' });

      expect(mockApiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/geo/geocode',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('reverseGeocode mutation', () => {
    it('calls API with coordinates', async () => {
      mockApiFetch.mockResolvedValueOnce({
        success: true,
        display_name: '123 Main St, NYC',
      });

      const { result } = renderHook(() => useGeo(), { wrapper: createWrapper() });

      await result.current.reverseGeocode.mutateAsync({
        latitude: 40.7,
        longitude: -74,
      });

      expect(mockApiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/geo/reverse-geocode',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('calculateDistance mutation', () => {
    it('calls API with four coordinates', async () => {
      mockApiFetch.mockResolvedValueOnce({
        distance_km: 100,
        distance_miles: 62.14,
      });

      const { result } = renderHook(() => useGeo(), { wrapper: createWrapper() });

      const response = await result.current.calculateDistance.mutateAsync({
        lat1: 40.7, lng1: -74, lat2: 51.5, lng2: -0.1,
      });

      expect(response.distance_km).toBe(100);
      expect(mockApiFetch).toHaveBeenCalled();
    });
  });

  describe('no organization', () => {
    it('throws when no org selected', async () => {
      const { useAuth } = await import('../../hooks/useAuth');
      (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
        activeOrganizationId: null,
      });

      const { result } = renderHook(() => useGeo(), { wrapper: createWrapper() });

      await expect(
        result.current.geocode.mutateAsync({ address: 'test' })
      ).rejects.toThrow('No organization selected');

      // Restore mock
      (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
        activeOrganizationId: 'org-1',
      });
    });
  });
});
