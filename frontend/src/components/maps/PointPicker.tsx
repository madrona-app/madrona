/**
 * PointPicker component - Interactive coordinate entry via map click.
 *
 * Allows users to click on a map to place a marker and capture coordinates.
 * This replaces manual text entry of lat/lng with a visual interface.
 */

import { useState, useCallback, useRef } from 'react';
import { Marker, Popup } from 'react-map-gl/maplibre';
import { MapPin, X, RotateCcw } from 'lucide-react';
import BaseMap from './BaseMap';
import type { BaseMapRef } from './BaseMap';

// Local type for marker drag event
interface MarkerDragEvent {
  lngLat: { lng: number; lat: number };
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface PointPickerProps {
  /** Initial coordinates (if editing existing point) */
  value?: Coordinates | null;
  /** Callback when coordinates change */
  onChange: (coords: Coordinates | null) => void;
  /** Height of the map */
  height?: string | number;
  /** Map theme */
  theme?: 'light' | 'dark' | 'standard';
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Placeholder text shown when no point is selected */
  placeholder?: string;
  /** Show coordinate display below map */
  showCoordinates?: boolean;
  /** Allow dragging the marker to adjust position */
  draggable?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export default function PointPicker({
  value,
  onChange,
  height = 300,
  theme = 'light',
  disabled = false,
  placeholder = 'Click on the map to place a marker',
  showCoordinates = true,
  draggable = true,
  className = '',
}: PointPickerProps) {
  const mapRef = useRef<BaseMapRef>(null);
  const [showPopup, setShowPopup] = useState(false);

  // Handle map click to place/move marker
  const handleMapClick = useCallback(
    (event: { lngLat: { lng: number; lat: number } }) => {
      if (disabled) return;

      const coords: Coordinates = {
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      };
      onChange(coords);
    },
    [disabled, onChange]
  );

  // Handle marker drag
  const handleMarkerDrag = useCallback(
    (event: MarkerDragEvent) => {
      if (disabled || !draggable) return;

      const coords: Coordinates = {
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      };
      onChange(coords);
    },
    [disabled, draggable, onChange]
  );

  // Clear the marker
  const handleClear = useCallback(() => {
    onChange(null);
    setShowPopup(false);
  }, [onChange]);

  // Center map on marker
  const handleCenterOnMarker = useCallback(() => {
    if (value && mapRef.current) {
      mapRef.current.flyTo({
        center: [value.longitude, value.latitude],
        zoom: 12,
        duration: 1000,
      });
    }
  }, [value]);

  // Format coordinate for display
  const formatCoord = (num: number, isLat: boolean) => {
    const dir = isLat ? (num >= 0 ? 'N' : 'S') : num >= 0 ? 'E' : 'W';
    return `${Math.abs(num).toFixed(6)}° ${dir}`;
  };

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="relative">
        <BaseMap
          ref={mapRef}
          latitude={value?.latitude ?? 20}
          longitude={value?.longitude ?? 0}
          zoom={value ? 10 : 2}
          height={height}
          theme={theme}
          onClick={handleMapClick}
          showNavigation={true}
          showScale={true}
          interactive={!disabled}
          className={disabled ? 'opacity-75 cursor-not-allowed' : 'cursor-crosshair'}
        >
          {value && (
            <>
              <Marker
                latitude={value.latitude}
                longitude={value.longitude}
                draggable={draggable && !disabled}
                onDrag={handleMarkerDrag}
                onClick={() => setShowPopup(true)}
              >
                <div className="relative">
                  <MapPin
                    className={`w-8 h-8 -mt-8 ${
                      draggable && !disabled ? 'cursor-move' : ''
                    } text-semantic-info drop-shadow-lg`}
                    fill="currentColor"
                    strokeWidth={1}
                  />
                </div>
              </Marker>

              {showPopup && (
                <Popup
                  latitude={value.latitude}
                  longitude={value.longitude}
                  closeOnClick={false}
                  onClose={() => setShowPopup(false)}
                  offset={[0, -30]}
                  className="rounded-lg"
                >
                  <div className="p-2 text-sm">
                    <div className="font-medium mb-1">Selected Location</div>
                    <div className="text-accessible-gray text-xs space-y-0.5">
                      <div>Lat: {formatCoord(value.latitude, true)}</div>
                      <div>Lng: {formatCoord(value.longitude, false)}</div>
                    </div>
                  </div>
                </Popup>
              )}
            </>
          )}
        </BaseMap>

        {/* Overlay hint when no marker */}
        {!value && !disabled && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-parchment/90 dark:bg-forest/90 px-4 py-2 rounded-lg shadow-lg text-sm text-accessible-gray dark:text-stone">
              <MapPin className="w-4 h-4 inline-block mr-2" />
              {placeholder}
            </div>
          </div>
        )}

        {/* Action buttons */}
        {value && !disabled && (
          <div className="absolute top-2 left-2 flex gap-1">
            <button
              type="button"
              onClick={handleCenterOnMarker}
              className="p-1.5 bg-parchment rounded shadow hover:bg-stone text-accessible-gray"
              title="Center on marker"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="p-1.5 bg-parchment rounded shadow hover:bg-stone text-semantic-error"
              title="Clear marker"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Coordinate display */}
      {showCoordinates && (
        <div className="flex items-center justify-between px-3 py-2 bg-stone dark:bg-forest rounded-lg text-sm">
          {value ? (
            <>
              <div className="flex gap-4">
                <span className="text-archive">Latitude:</span>
                <span className="font-mono">{value.latitude.toFixed(6)}</span>
              </div>
              <div className="flex gap-4">
                <span className="text-archive">Longitude:</span>
                <span className="font-mono">{value.longitude.toFixed(6)}</span>
              </div>
            </>
          ) : (
            <span className="text-archive italic">No location selected</span>
          )}
        </div>
      )}
    </div>
  );
}
