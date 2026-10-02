/**
 * CollectionOriginMap - Visualizes collection origins geographically.
 *
 * Shows where objects in the collection originated from, with markers
 * sized by count and grouped by place authority.
 */

import { useMemo, useRef, useEffect, useState } from 'react';
import { Marker, Source, Layer, Popup } from 'react-map-gl/maplibre';
import { MapPin, Eye, Globe } from 'lucide-react';
import BaseMap from './BaseMap';
import type { BaseMapRef } from './BaseMap';
import { formatNumber } from '@/lib/formatters';

export interface PlaceOrigin {
  place_id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Number of objects from this place */
  object_count: number;
  /** Place hierarchy (e.g., "Paris, France") */
  hierarchy?: string;
  /** Place type (e.g., country, city, region) */
  place_type?: string;
  /** Role of this place (creation, discovery, provenance) */
  role?: 'creation_place' | 'discovery_place' | 'provenance_place' | 'other';
}

export interface CollectionOriginMapProps {
  /** List of places with object counts */
  places: PlaceOrigin[];
  /** Height of the map container */
  height?: string | number;
  /** Called when a place marker is clicked */
  onPlaceClick?: (place: PlaceOrigin) => void;
  /** Filter by place role */
  roleFilter?: PlaceOrigin['role'] | 'all';
  /** Show as heatmap instead of markers */
  displayMode?: 'markers' | 'heatmap';
  /** Collection name for display */
  collectionName?: string;
}

export default function CollectionOriginMap({
  places,
  height = 500,
  onPlaceClick,
  roleFilter = 'all',
  displayMode = 'markers',
  collectionName,
}: CollectionOriginMapProps) {
  const mapRef = useRef<BaseMapRef>(null);
  const [selectedPlace, setSelectedPlace] = useState<PlaceOrigin | null>(null);

  // Filter places by role
  const filteredPlaces = useMemo(() => {
    if (roleFilter === 'all') return places;
    return places.filter((p) => p.role === roleFilter);
  }, [places, roleFilter]);

  // Calculate bounds to fit all markers
  useEffect(() => {
    if (filteredPlaces.length === 0 || !mapRef.current) return;

    const coords = filteredPlaces.map((p) => [p.longitude, p.latitude] as [number, number]);

    if (coords.length > 1) {
      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ];

      setTimeout(() => {
        mapRef.current?.fitBounds(bounds, { padding: 50 });
      }, 100);
    } else if (coords.length === 1) {
      setTimeout(() => {
        mapRef.current?.flyTo({
          center: coords[0],
          zoom: 6,
        });
      }, 100);
    }
  }, [filteredPlaces]);

  // Generate heatmap data for heatmap mode
  const heatmapGeoJSON = useMemo(() => {
    if (displayMode !== 'heatmap') return null;

    return {
      type: 'FeatureCollection' as const,
      features: filteredPlaces.map((place) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [place.longitude, place.latitude],
        },
        properties: {
          weight: place.object_count,
          name: place.name,
        },
      })),
    };
  }, [filteredPlaces, displayMode]);

  // Calculate initial center
  const initialCenter = useMemo(() => {
    if (filteredPlaces.length > 0) {
      const avgLat = filteredPlaces.reduce((sum, p) => sum + p.latitude, 0) / filteredPlaces.length;
      const avgLng = filteredPlaces.reduce((sum, p) => sum + p.longitude, 0) / filteredPlaces.length;
      return { latitude: avgLat, longitude: avgLng };
    }
    return { latitude: 30, longitude: 0 }; // World center
  }, [filteredPlaces]);

  // Calculate max count for normalization
  const maxCount = useMemo(() => {
    return Math.max(...filteredPlaces.map((p) => p.object_count), 1);
  }, [filteredPlaces]);

  // Get marker size based on object count
  const getMarkerSize = (count: number) => {
    const ratio = count / maxCount;
    if (ratio >= 0.5) return 'xl';
    if (ratio >= 0.25) return 'lg';
    if (ratio >= 0.1) return 'md';
    return 'sm';
  };

  // Get marker color based on role
  const getRoleColor = (role?: PlaceOrigin['role']) => {
    switch (role) {
      case 'creation_place':
        return 'bg-semantic-info/100';
      case 'discovery_place':
        return 'bg-semantic-success/100';
      case 'provenance_place':
        return 'bg-viz-3/100';
      default:
        return 'bg-bark';
    }
  };

  const sizeClasses = {
    sm: 'w-6 h-6 text-xs',
    md: 'w-8 h-8 text-xs',
    lg: 'w-10 h-10 text-sm',
    xl: 'w-14 h-14 text-base',
  };

  // Calculate totals for stats
  const totalObjects = useMemo(() => {
    return filteredPlaces.reduce((sum, p) => sum + p.object_count, 0);
  }, [filteredPlaces]);

  const handlePlaceClick = (place: PlaceOrigin) => {
    setSelectedPlace(place);
    onPlaceClick?.(place);
  };

  return (
    <div className="relative">
      <BaseMap
        ref={mapRef}
        latitude={initialCenter.latitude}
        longitude={initialCenter.longitude}
        zoom={2}
        height={height}
        showNavigation={true}
        showScale={true}
      >
        {/* Heatmap layer */}
        {displayMode === 'heatmap' && heatmapGeoJSON && (
          <Source id="origins-heatmap" type="geojson" data={heatmapGeoJSON}>
            <Layer
              id="origins-heat"
              type="heatmap"
              paint={{
                'heatmap-weight': ['get', 'weight'],
                'heatmap-intensity': 1,
                'heatmap-color': [
                  'interpolate',
                  ['linear'],
                  ['heatmap-density'],
                  0,
                  'rgba(0, 0, 0, 0)',
                  0.2,
                  'rgba(103, 169, 207, 0.4)',
                  0.4,
                  'rgba(209, 229, 240, 0.6)',
                  0.6,
                  'rgba(253, 219, 199, 0.8)',
                  0.8,
                  'rgba(239, 138, 98, 0.9)',
                  1,
                  'rgba(178, 24, 43, 1)',
                ],
                'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 9, 20],
                'heatmap-opacity': 0.8,
              }}
            />
          </Source>
        )}

        {/* Marker mode */}
        {displayMode === 'markers' &&
          filteredPlaces.map((place) => {
            const size = getMarkerSize(place.object_count);
            const colorClass = getRoleColor(place.role);

            return (
              <Marker
                key={place.place_id}
                latitude={place.latitude}
                longitude={place.longitude}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  handlePlaceClick(place);
                }}
              >
                <div
                  className={`${sizeClasses[size]} ${colorClass} rounded-full flex items-center justify-center shadow-lg cursor-pointer hover:scale-110 transition-transform border-2 border-parchment`}
                  title={`${place.name}: ${place.object_count} objects`}
                >
                  <span className="text-parchment font-bold">{place.object_count}</span>
                </div>
              </Marker>
            );
          })}

        {/* Popup for selected place */}
        {selectedPlace && displayMode === 'markers' && (
          <Popup
            latitude={selectedPlace.latitude}
            longitude={selectedPlace.longitude}
            anchor="bottom"
            onClose={() => setSelectedPlace(null)}
            closeOnClick={false}
          >
            <div className="p-2 min-w-[180px]">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="w-4 h-4 text-bark" />
                <span className="font-medium text-ink">{selectedPlace.name}</span>
              </div>
              {selectedPlace.hierarchy && selectedPlace.hierarchy !== selectedPlace.name && (
                <div className="text-sm text-archive mb-2">{selectedPlace.hierarchy}</div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-archive">Objects:</span>
                <span className="font-medium text-ink">{selectedPlace.object_count}</span>
              </div>
              {selectedPlace.role && (
                <div className="flex items-center justify-between text-sm mt-1">
                  <span className="text-archive">Role:</span>
                  <span className="capitalize text-ink">
                    {selectedPlace.role.replace('_', ' ')}
                  </span>
                </div>
              )}
              {selectedPlace.place_type && (
                <div className="flex items-center justify-between text-sm mt-1">
                  <span className="text-archive">Type:</span>
                  <span className="capitalize text-ink">{selectedPlace.place_type}</span>
                </div>
              )}
              <button
                className="w-full mt-3 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-bark text-parchment text-sm rounded-lg hover:bg-copper-dark transition-colors"
                onClick={() => onPlaceClick?.(selectedPlace)}
              >
                <Eye className="w-4 h-4" />
                View Objects
              </button>
            </div>
          </Popup>
        )}
      </BaseMap>

      {/* Header with collection info */}
      <div className="absolute top-4 left-4 bg-parchment rounded-lg shadow-md p-3">
        <div className="flex items-center gap-2 mb-1">
          <Globe className="w-4 h-4 text-bark" />
          <span className="text-xs text-archive">Collection Origins</span>
        </div>
        {collectionName && <div className="font-medium text-ink">{collectionName}</div>}
        <div className="text-sm text-archive mt-1">
          {formatNumber(totalObjects)} objects from {filteredPlaces.length} places
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-parchment rounded-lg shadow-md p-3 text-sm">
        <div className="font-medium text-ink mb-2">Place Roles</div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-semantic-info/100 rounded-full" />
            <span className="text-archive">Creation Place</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-semantic-success/100 rounded-full" />
            <span className="text-archive">Discovery Place</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-viz-3/100 rounded-full" />
            <span className="text-archive">Provenance Place</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-bark rounded-full" />
            <span className="text-archive">Other</span>
          </div>
        </div>
        <div className="mt-3 pt-2 border-t border-lichen">
          <div className="text-xs text-archive">Marker size = object count</div>
        </div>
      </div>

      {/* Display mode toggle */}
      <div className="absolute top-4 right-4 bg-parchment rounded-lg shadow-md overflow-hidden">
        <button
          className={`px-3 py-2 text-sm ${displayMode === 'markers' ? 'bg-bark text-parchment' : 'text-ink hover:bg-stone'}`}
          onClick={() => {
            // This would be controlled by parent, but for now just show state
          }}
          title="Marker view"
        >
          Markers
        </button>
        <button
          className={`px-3 py-2 text-sm ${displayMode === 'heatmap' ? 'bg-bark text-parchment' : 'text-ink hover:bg-stone'}`}
          onClick={() => {
            // This would be controlled by parent
          }}
          title="Heatmap view"
        >
          Heatmap
        </button>
      </div>

      {/* Top places list */}
      <div className="absolute bottom-4 right-4 bg-parchment rounded-lg shadow-md p-3 text-sm max-h-[200px] overflow-y-auto">
        <div className="font-medium text-ink mb-2">Top Origins</div>
        <div className="space-y-1">
          {[...filteredPlaces]
            .sort((a, b) => b.object_count - a.object_count)
            .slice(0, 5)
            .map((place, index) => (
              <div
                key={place.place_id}
                className="flex items-center justify-between gap-4 cursor-pointer hover:bg-stone px-1 py-0.5 rounded"
                onClick={() => handlePlaceClick(place)}
              >
                <span className="text-archive">
                  {index + 1}. {place.name}
                </span>
                <span className="font-medium text-ink">{place.object_count}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
