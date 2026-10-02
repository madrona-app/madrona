/**
 * AreaDrawer component - Draw polygon regions on a map.
 *
 * Allows users to draw polygon boundaries for:
 * - Excavation sites
 * - Geographic regions
 * - Administrative boundaries
 */

import { useState, useCallback, useRef } from 'react';
import { Marker, Source, Layer } from 'react-map-gl/maplibre';
import { Trash2, Check, Undo2, PenTool } from 'lucide-react';
import BaseMap from './BaseMap';
import type { BaseMapRef } from './BaseMap';

export interface PolygonCoordinates {
  /** Array of [longitude, latitude] coordinate pairs */
  coordinates: [number, number][];
}

export interface AreaDrawerProps {
  /** Initial polygon (if editing) */
  value?: PolygonCoordinates | null;
  /** Callback when polygon changes */
  onChange: (polygon: PolygonCoordinates | null) => void;
  /** Height of the map */
  height?: string | number;
  /** Map theme */
  theme?: 'light' | 'dark' | 'standard';
  /** Whether the drawer is disabled */
  disabled?: boolean;
  /** Polygon fill color */
  fillColor?: string;
  /** Polygon stroke color */
  strokeColor?: string;
  /** Additional CSS classes */
  className?: string;
}

export default function AreaDrawer({
  value,
  onChange,
  height = 400,
  theme = 'light',
  disabled = false,
  fillColor = 'rgba(59, 130, 246, 0.3)',
  strokeColor = '#B0533A',
  className = '',
}: AreaDrawerProps) {
  const mapRef = useRef<BaseMapRef>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [points, setPoints] = useState<[number, number][]>(value?.coordinates ?? []);

  // Start drawing mode
  const handleStartDrawing = useCallback(() => {
    if (disabled) return;
    setIsDrawing(true);
    setPoints([]);
    onChange(null);
  }, [disabled, onChange]);

  // Add point on map click (when in drawing mode)
  const handleMapClick = useCallback(
    (event: { lngLat: { lng: number; lat: number } }) => {
      if (!isDrawing || disabled) return;

      const newPoint: [number, number] = [event.lngLat.lng, event.lngLat.lat];
      setPoints((prev) => [...prev, newPoint]);
    },
    [isDrawing, disabled]
  );

  // Complete the polygon
  const handleComplete = useCallback(() => {
    if (points.length < 3) {
      // Need at least 3 points for a valid polygon
      return;
    }

    // Close the polygon by adding the first point at the end
    const closedCoords = [...points, points[0]];
    onChange({ coordinates: closedCoords });
    setIsDrawing(false);
  }, [points, onChange]);

  // Undo last point
  const handleUndo = useCallback(() => {
    setPoints((prev) => prev.slice(0, -1));
  }, []);

  // Clear the polygon
  const handleClear = useCallback(() => {
    setPoints([]);
    onChange(null);
    setIsDrawing(false);
  }, [onChange]);

  // Create GeoJSON for the polygon/lines
  const getGeoJSON = useCallback(() => {
    if (value?.coordinates && value.coordinates.length >= 4) {
      // Complete polygon (from value)
      return {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'Polygon' as const,
          coordinates: [value.coordinates],
        },
      };
    } else if (points.length >= 2) {
      // Drawing in progress - show as line
      return {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: points,
        },
      };
    }
    return null;
  }, [value, points]);

  const geoJSON = getGeoJSON();

  // Calculate centroid for displaying area info
  const getCentroid = useCallback(
    (coords: [number, number][]) => {
      if (coords.length === 0) return null;
      const sumLng = coords.reduce((sum, c) => sum + c[0], 0);
      const sumLat = coords.reduce((sum, c) => sum + c[1], 0);
      return [sumLng / coords.length, sumLat / coords.length] as [number, number];
    },
    []
  );

  const displayCoords = value?.coordinates ?? points;
  const centroid = getCentroid(displayCoords);

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2">
        {!isDrawing && !value && (
          <button
            type="button"
            onClick={handleStartDrawing}
            disabled={disabled}
            className="flex items-center gap-2 px-3 py-1.5 bg-semantic-info text-parchment rounded hover:bg-semantic-info disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            <PenTool className="w-4 h-4" />
            Draw Area
          </button>
        )}

        {isDrawing && (
          <>
            <span className="text-sm text-accessible-gray">
              Click to add points ({points.length} points)
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={handleUndo}
              disabled={points.length === 0}
              className="p-1.5 text-accessible-gray hover:bg-stone rounded disabled:opacity-50"
              title="Undo last point"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleComplete}
              disabled={points.length < 3}
              className="flex items-center gap-1 px-3 py-1.5 bg-semantic-success text-parchment rounded hover:bg-semantic-success disabled:opacity-50 text-sm"
              title="Complete polygon (needs at least 3 points)"
            >
              <Check className="w-4 h-4" />
              Complete
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="p-1.5 text-semantic-error hover:bg-semantic-error/10 rounded"
              title="Cancel drawing"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}

        {value && !isDrawing && (
          <>
            <span className="text-sm text-accessible-gray">
              Area defined ({value.coordinates.length - 1} points)
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={handleStartDrawing}
              disabled={disabled}
              className="flex items-center gap-1 px-3 py-1.5 bg-stone text-ink rounded hover:bg-lichen text-sm"
            >
              <PenTool className="w-4 h-4" />
              Redraw
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={disabled}
              className="p-1.5 text-semantic-error hover:bg-semantic-error/10 rounded"
              title="Clear area"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Map */}
      <div className="relative">
        <BaseMap
          ref={mapRef}
          latitude={centroid?.[1] ?? 20}
          longitude={centroid?.[0] ?? 0}
          zoom={centroid ? 10 : 2}
          height={height}
          theme={theme}
          onClick={handleMapClick}
          showNavigation={true}
          showScale={true}
          interactive={!disabled}
          className={isDrawing ? 'cursor-crosshair' : ''}
        >
          {/* Render polygon or line */}
          {geoJSON && (
            <Source id="polygon-source" type="geojson" data={geoJSON}>
              {/* Fill layer for completed polygons */}
              {value?.coordinates && (
                <Layer
                  id="polygon-fill"
                  type="fill"
                  paint={{
                    'fill-color': fillColor,
                  }}
                />
              )}
              {/* Stroke layer */}
              <Layer
                id="polygon-stroke"
                type="line"
                paint={{
                  'line-color': strokeColor,
                  'line-width': 2,
                  'line-dasharray': isDrawing ? [2, 2] : [1],
                }}
              />
            </Source>
          )}

          {/* Render vertex markers while drawing */}
          {isDrawing &&
            points.map((point, index) => (
              <Marker
                key={index}
                longitude={point[0]}
                latitude={point[1]}
              >
                <div
                  className={`w-3 h-3 rounded-full border-2 border-parchment shadow ${
                    index === 0 ? 'bg-semantic-success/100' : 'bg-semantic-info/100'
                  }`}
                />
              </Marker>
            ))}
        </BaseMap>

        {/* Drawing mode overlay */}
        {isDrawing && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-parchment/90 px-4 py-2 rounded-lg shadow-lg text-sm">
            Click to add points. {points.length >= 3 ? 'Click "Complete" when done.' : `Need ${3 - points.length} more point(s).`}
          </div>
        )}
      </div>
    </div>
  );
}
