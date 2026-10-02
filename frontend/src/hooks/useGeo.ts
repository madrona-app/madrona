/**
 * useGeo hook - React Query hooks for GIS API endpoints.
 *
 * Provides geocoding, reverse geocoding, and spatial query capabilities.
 *
 * @example
 * ```tsx
 * import { useGeo } from '@/hooks/useGeo';
 *
 * function MyComponent() {
 *   const { geocode, reverseGeocode, searchObjectsInPolygon } = useGeo();
 *
 *   const handleGeocode = async () => {
 *     const result = await geocode.mutateAsync({ address: '123 Main St, NYC' });
 *     console.log(result.point); // { latitude: 40.7, longitude: -74 }
 *   };
 * }
 * ```
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { useAuth } from './useAuth';

// =============================================================================
// TYPES
// =============================================================================

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface GeocodeResult {
  success: boolean;
  point?: GeoPoint;
  display_name?: string;
  address_components?: {
    country?: string;
    country_code?: string;
    admin_name?: string;
    admin_name2?: string;
    feature_class?: string;
  };
  source?: string;
  error?: string;
}

export interface NearbyPlace {
  place_authority_id: string;
  preferred_name: string;
  place_type: string;
  country_code: string | null;
  distance_km: number | null;
  coordinates: {
    lat: number | null;
    lng: number | null;
  };
}

export interface SpatialSearchResult {
  object_id: string;
  object_number: string;
  title: string;
  place_role: string;
  place_name: string;
  coordinates: {
    lat: number | null;
    lng: number | null;
  };
}

// Visualization types
export interface LoanContact {
  contact_id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  loans_out_count: number;
  loans_in_count: number;
  active_loans: number;
}

export interface LoanNetworkData {
  organization: {
    name: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  contacts: LoanContact[];
}

export interface TourVenue {
  venue_id: string;
  name: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  sequence_order: number;
  start_date: string | null;
  end_date: string | null;
  status: 'proposed' | 'confirmed' | 'in_transit' | 'installed' | 'open' | 'closing' | 'returned';
}

export interface TourRouteData {
  exhibition: {
    exhibition_id: string;
    title: string;
    is_touring: boolean;
  };
  venues: TourVenue[];
}

export interface PlaceOrigin {
  place_id: string;
  name: string;
  hierarchy: string | null;
  latitude: number | null;
  longitude: number | null;
  object_count: number;
  role: string;
  place_type: string | null;
}

export interface CollectionOriginsData {
  total_objects: number;
  places: PlaceOrigin[];
  /** Linked places that can't plot because they have no coordinates. */
  linked_places_without_coordinates?: number;
}

// Shipment types
export interface ShipmentRoute {
  shipment_id: string;
  shipment_number: string | null;
  direction: 'inbound' | 'outbound';
  status: 'planned' | 'shipped' | 'in_transit' | 'delayed' | 'arrived' | 'closed';
  carrier: string | null;
  tracking_number: string | null;
  origin: string | null;
  origin_coordinates: { lat: number | null; lng: number | null } | null;
  destination: string | null;
  destination_coordinates: { lat: number | null; lng: number | null } | null;
  ship_date: string | null;
  expected_arrival: string | null;
  actual_arrival: string | null;
  object_count: number;
}

export interface ExhibitionShipmentsData {
  exhibition: {
    exhibition_id: string;
    title: string;
  };
  shipments: ShipmentRoute[];
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

const geoApi = {
  /**
   * Geocode an address to coordinates.
   */
  geocode: async (
    organizationId: string,
    address: string,
    countryCode?: string
  ): Promise<GeocodeResult> => {
    return apiFetch(`/organizations/${organizationId}/geo/geocode`, {
      method: 'POST',
      body: JSON.stringify({ address, country_code: countryCode }),
    });
  },

  /**
   * Reverse geocode coordinates to an address.
   */
  reverseGeocode: async (
    organizationId: string,
    latitude: number,
    longitude: number
  ): Promise<GeocodeResult> => {
    return apiFetch(`/organizations/${organizationId}/geo/reverse-geocode`, {
      method: 'POST',
      body: JSON.stringify({ latitude, longitude }),
    });
  },

  /**
   * Find places within radius of a point.
   */
  nearbyPlaces: async (
    organizationId: string,
    lat: number,
    lng: number,
    radiusKm: number = 50,
    limit: number = 50
  ): Promise<{ places: NearbyPlace[] }> => {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lng: lng.toString(),
      radius_km: radiusKm.toString(),
      limit: limit.toString(),
    });
    return apiFetch(`/organizations/${organizationId}/geo/nearby/places?${params}`);
  },

  /**
   * Find entities within a bounding box.
   */
  bboxSearch: async (
    organizationId: string,
    entityType: 'places' | 'contacts' | 'locations',
    minLat: number,
    minLng: number,
    maxLat: number,
    maxLng: number,
    limit: number = 100
  ): Promise<{ entities: unknown[]; count: number }> => {
    const params = new URLSearchParams({
      min_lat: minLat.toString(),
      min_lng: minLng.toString(),
      max_lat: maxLat.toString(),
      max_lng: maxLng.toString(),
      limit: limit.toString(),
    });
    return apiFetch(`/organizations/${organizationId}/geo/bbox/${entityType}?${params}`);
  },

  /**
   * Search for objects within a polygon.
   */
  searchObjectsInPolygon: async (
    organizationId: string,
    polygon: [number, number][],
    placeRoles?: string[]
  ): Promise<{ objects: SpatialSearchResult[]; count: number }> => {
    return apiFetch(`/organizations/${organizationId}/geo/search/objects`, {
      method: 'POST',
      body: JSON.stringify({ polygon, place_roles: placeRoles }),
    });
  },

  /**
   * Find nearest entities to a point.
   */
  findNearest: async (
    organizationId: string,
    entityType: 'places' | 'contacts' | 'locations',
    lat: number,
    lng: number,
    limit: number = 5
  ): Promise<{ entities: { entity: unknown; distance_km: number | null }[] }> => {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lng: lng.toString(),
      limit: limit.toString(),
    });
    return apiFetch(`/organizations/${organizationId}/geo/nearest/${entityType}?${params}`);
  },

  /**
   * Calculate distance between two points.
   */
  calculateDistance: async (
    organizationId: string,
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
  ): Promise<{ distance_km: number; distance_miles: number }> => {
    const params = new URLSearchParams({
      lat1: lat1.toString(),
      lng1: lng1.toString(),
      lat2: lat2.toString(),
      lng2: lng2.toString(),
    });
    return apiFetch(`/organizations/${organizationId}/geo/distance?${params}`);
  },

  /**
   * Update geometry for a place authority.
   */
  updatePlaceGeometry: async (
    organizationId: string,
    placeAuthorityId: string,
    geometry:
      | { type: 'point'; latitude: number; longitude: number }
      | { type: 'polygon'; coordinates: [number, number][] }
  ): Promise<{ success: boolean; place_authority_id: string; geometry_type: string }> => {
    return apiFetch(
      `/organizations/${organizationId}/geo/places/${placeAuthorityId}/geometry`,
      {
        method: 'PUT',
        body: JSON.stringify(geometry),
      }
    );
  },

  // =========================================================================
  // VISUALIZATION DATA ENDPOINTS
  // =========================================================================

  /**
   * Get loan network data for visualization.
   */
  getLoanNetwork: async (
    organizationId: string,
    activeOnly: boolean = false
  ): Promise<LoanNetworkData> => {
    const params = new URLSearchParams();
    if (activeOnly) params.set('active_only', 'true');
    const query = params.toString() ? `?${params}` : '';
    return apiFetch(`/organizations/${organizationId}/geo/loans/network${query}`);
  },

  /**
   * Get tour route data for an exhibition.
   */
  getTourRoute: async (
    organizationId: string,
    exhibitionId: string
  ): Promise<TourRouteData> => {
    return apiFetch(
      `/organizations/${organizationId}/geo/exhibitions/${exhibitionId}/tour-route`
    );
  },

  /**
   * Get collection origins data for visualization.
   */
  getCollectionOrigins: async (
    organizationId: string,
    role?: string,
    limit: number = 200
  ): Promise<CollectionOriginsData> => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (role) params.set('role', role);
    return apiFetch(`/organizations/${organizationId}/geo/collection-origins?${params}`);
  },

  /**
   * Update geometry for an exhibition venue.
   */
  updateVenueGeometry: async (
    organizationId: string,
    exhibitionVenueId: string,
    latitude: number,
    longitude: number
  ): Promise<{ success: boolean; exhibition_venue_id: string }> => {
    return apiFetch(
      `/organizations/${organizationId}/geo/venues/${exhibitionVenueId}/geometry`,
      {
        method: 'PUT',
        body: JSON.stringify({ latitude, longitude }),
      }
    );
  },

  /**
   * Get shipment routes for an exhibition.
   */
  getExhibitionShipments: async (
    organizationId: string,
    exhibitionId: string
  ): Promise<ExhibitionShipmentsData> => {
    return apiFetch(
      `/organizations/${organizationId}/geo/exhibitions/${exhibitionId}/shipments`
    );
  },

  /**
   * Update shipment geometry (origin and/or destination).
   */
  updateShipmentGeometry: async (
    organizationId: string,
    shipmentId: string,
    origin?: { latitude: number; longitude: number },
    destination?: { latitude: number; longitude: number }
  ): Promise<{ success: boolean; shipment_id: string }> => {
    return apiFetch(
      `/organizations/${organizationId}/geo/shipments/${shipmentId}/geometry`,
      {
        method: 'PUT',
        body: JSON.stringify({ origin, destination }),
      }
    );
  },

  /**
   * Get organization headquarters coordinates.
   */
  getHeadquarters: async (
    organizationId: string
  ): Promise<{ name: string; latitude: number | null; longitude: number | null }> => {
    return apiFetch(`/organizations/${organizationId}/geo/headquarters`);
  },

  /**
   * Update organization headquarters coordinates.
   */
  updateHeadquarters: async (
    organizationId: string,
    latitude: number | null,
    longitude: number | null
  ): Promise<{ success: boolean; latitude: number | null; longitude: number | null }> => {
    return apiFetch(`/organizations/${organizationId}/geo/headquarters`, {
      method: 'PUT',
      body: JSON.stringify({ latitude, longitude }),
    });
  },
};

// =============================================================================
// HOOK
// =============================================================================

export function useGeo() {
  const { activeOrganizationId } = useAuth();
  const organizationId = activeOrganizationId;

  /**
   * Geocode mutation - convert address to coordinates.
   */
  const geocode = useMutation({
    mutationFn: ({ address, countryCode }: { address: string; countryCode?: string }) => {
      if (!organizationId) throw new Error('No organization selected');
      return geoApi.geocode(organizationId, address, countryCode);
    },
  });

  /**
   * Reverse geocode mutation - convert coordinates to address.
   */
  const reverseGeocode = useMutation({
    mutationFn: ({ latitude, longitude }: GeoPoint) => {
      if (!organizationId) throw new Error('No organization selected');
      return geoApi.reverseGeocode(organizationId, latitude, longitude);
    },
  });

  /**
   * Search objects within polygon mutation.
   */
  const searchObjectsInPolygon = useMutation({
    mutationFn: ({
      polygon,
      placeRoles,
    }: {
      polygon: [number, number][];
      placeRoles?: string[];
    }) => {
      if (!organizationId) throw new Error('No organization selected');
      return geoApi.searchObjectsInPolygon(organizationId, polygon, placeRoles);
    },
  });

  /**
   * Update place geometry mutation.
   */
  const updatePlaceGeometry = useMutation({
    mutationFn: ({
      placeAuthorityId,
      geometry,
    }: {
      placeAuthorityId: string;
      geometry:
        | { type: 'point'; latitude: number; longitude: number }
        | { type: 'polygon'; coordinates: [number, number][] };
    }) => {
      if (!organizationId) throw new Error('No organization selected');
      return geoApi.updatePlaceGeometry(organizationId, placeAuthorityId, geometry);
    },
  });

  /**
   * Update venue geometry mutation.
   */
  const updateVenueGeometry = useMutation({
    mutationFn: ({
      exhibitionVenueId,
      latitude,
      longitude,
    }: {
      exhibitionVenueId: string;
      latitude: number;
      longitude: number;
    }) => {
      if (!organizationId) throw new Error('No organization selected');
      return geoApi.updateVenueGeometry(organizationId, exhibitionVenueId, latitude, longitude);
    },
  });

  /**
   * Query nearby places (returns query object for react-query).
   */
  const useNearbyPlaces = (
    lat: number,
    lng: number,
    radiusKm: number = 50,
    options?: { enabled?: boolean }
  ) => {
    return useQuery({
      queryKey: ['geo', 'nearby', organizationId, lat, lng, radiusKm],
      queryFn: () => geoApi.nearbyPlaces(organizationId!, lat, lng, radiusKm),
      enabled: !!organizationId && options?.enabled !== false,
    });
  };

  /**
   * Calculate distance between two points.
   */
  const calculateDistance = useMutation({
    mutationFn: ({
      lat1,
      lng1,
      lat2,
      lng2,
    }: {
      lat1: number;
      lng1: number;
      lat2: number;
      lng2: number;
    }) => {
      if (!organizationId) throw new Error('No organization selected');
      return geoApi.calculateDistance(organizationId, lat1, lng1, lat2, lng2);
    },
  });

  // =========================================================================
  // VISUALIZATION DATA QUERIES
  // =========================================================================

  /**
   * Get loan network data.
   */
  const useLoanNetwork = (activeOnly: boolean = false, options?: { enabled?: boolean }) => {
    return useQuery({
      queryKey: ['geo', 'loan-network', organizationId, activeOnly],
      queryFn: () => geoApi.getLoanNetwork(organizationId!, activeOnly),
      enabled: !!organizationId && options?.enabled !== false,
    });
  };

  /**
   * Get tour route for an exhibition.
   */
  const useTourRoute = (exhibitionId: string, options?: { enabled?: boolean }) => {
    return useQuery({
      queryKey: ['geo', 'tour-route', organizationId, exhibitionId],
      queryFn: () => geoApi.getTourRoute(organizationId!, exhibitionId),
      enabled: !!organizationId && !!exhibitionId && options?.enabled !== false,
    });
  };

  /**
   * Get collection origins data.
   */
  const useCollectionOrigins = (
    role?: string,
    limit: number = 200,
    options?: { enabled?: boolean }
  ) => {
    return useQuery({
      queryKey: ['geo', 'collection-origins', organizationId, role, limit],
      queryFn: () => geoApi.getCollectionOrigins(organizationId!, role, limit),
      enabled: !!organizationId && options?.enabled !== false,
    });
  };

  /**
   * Get shipment routes for an exhibition.
   */
  const useExhibitionShipments = (exhibitionId: string, options?: { enabled?: boolean }) => {
    return useQuery({
      queryKey: ['geo', 'exhibition-shipments', organizationId, exhibitionId],
      queryFn: () => geoApi.getExhibitionShipments(organizationId!, exhibitionId),
      enabled: !!organizationId && !!exhibitionId && options?.enabled !== false,
    });
  };

  /**
   * Update shipment geometry mutation.
   */
  const updateShipmentGeometry = useMutation({
    mutationFn: ({
      shipmentId,
      origin,
      destination,
    }: {
      shipmentId: string;
      origin?: { latitude: number; longitude: number };
      destination?: { latitude: number; longitude: number };
    }) => {
      if (!organizationId) throw new Error('No organization selected');
      return geoApi.updateShipmentGeometry(organizationId, shipmentId, origin, destination);
    },
  });

  /**
   * Get organization headquarters coordinates.
   */
  const useHeadquarters = (options?: { enabled?: boolean }) => {
    return useQuery({
      queryKey: ['geo', 'headquarters', organizationId],
      queryFn: () => geoApi.getHeadquarters(organizationId!),
      enabled: !!organizationId && options?.enabled !== false,
    });
  };

  /**
   * Update organization headquarters coordinates.
   */
  const updateHeadquarters = useMutation({
    mutationFn: ({
      latitude,
      longitude,
    }: {
      latitude: number | null;
      longitude: number | null;
    }) => {
      if (!organizationId) throw new Error('No organization selected');
      return geoApi.updateHeadquarters(organizationId, latitude, longitude);
    },
  });

  return {
    geocode,
    reverseGeocode,
    searchObjectsInPolygon,
    updatePlaceGeometry,
    updateVenueGeometry,
    updateShipmentGeometry,
    updateHeadquarters,
    useNearbyPlaces,
    calculateDistance,
    // Visualization data
    useLoanNetwork,
    useTourRoute,
    useCollectionOrigins,
    useExhibitionShipments,
    useHeadquarters,
  };
}

export default useGeo;
