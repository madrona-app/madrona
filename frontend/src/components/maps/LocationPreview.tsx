/**
 * LocationPreview component - Display a location marker on a map.
 *
 * A simple read-only map component that shows a single location marker.
 * Used to preview coordinates in forms and detail views.
 */

import { useMemo } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { MapPin } from 'lucide-react';
import BaseMap from './BaseMap';

export interface LocationPreviewProps {
  /** Latitude of the location */
  latitude: number;
  /** Longitude of the location */
  longitude: number;
  /** Display name for the location (shown in tooltip) */
  name?: string;
  /** Height of the map */
  height?: string | number;
  /** Width of the map */
  width?: string | number;
  /** Initial zoom level */
  zoom?: number;
  /** Map theme */
  theme?: 'light' | 'dark' | 'standard';
  /** Marker color (Tailwind color class) */
  markerColor?: string;
  /** Show navigation controls */
  showNavigation?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export default function LocationPreview({
  latitude,
  longitude,
  name,
  height = 200,
  width = '100%',
  zoom = 10,
  theme = 'light',
  markerColor = 'text-semantic-info',
  showNavigation = false,
  className = '',
}: LocationPreviewProps) {
  // Validate coordinates
  const isValidCoordinates = useMemo(() => {
    return (
      typeof latitude === 'number' &&
      typeof longitude === 'number' &&
      !isNaN(latitude) &&
      !isNaN(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    );
  }, [latitude, longitude]);

  if (!isValidCoordinates) {
    return (
      <div
        className={`flex items-center justify-center bg-stone dark:bg-forest rounded-lg text-archive text-sm ${className}`}
        style={{ height, width }}
      >
        <MapPin className="w-5 h-5 mr-2 opacity-50" />
        Invalid coordinates
      </div>
    );
  }

  return (
    <BaseMap
      latitude={latitude}
      longitude={longitude}
      zoom={zoom}
      height={height}
      width={width}
      theme={theme}
      showNavigation={showNavigation}
      showScale={false}
      showFullscreen={false}
      showGeolocate={false}
      interactive={true}
      className={className}
    >
      <Marker latitude={latitude} longitude={longitude}>
        <div className="relative" title={name}>
          <MapPin
            className={`w-8 h-8 -mt-8 ${markerColor} drop-shadow-lg`}
            fill="currentColor"
            strokeWidth={1}
          />
        </div>
      </Marker>
    </BaseMap>
  );
}
