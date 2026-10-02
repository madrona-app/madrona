/**
 * MapSearch component - Draw area on map to find objects within bounds.
 *
 * Enables map-based spatial search: users draw a rectangle or polygon
 * on the map to find all collection objects with place associations
 * within that geographic region.
 */

import { useState, useCallback, useRef } from 'react';
import { Source, Layer, Marker } from 'react-map-gl/maplibre';
import { Search, Trash2, Loader2, MapPin, Square } from 'lucide-react';
import BaseMap from './BaseMap';
import type { BaseMapRef } from './BaseMap';
import { logger } from '../../lib/logger';

interface SearchResult {
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

export interface MapSearchProps {
  /** Callback when search is triggered. Can return results for internal display or void for external handling. */
  onSearch: (polygon: [number, number][]) => Promise<SearchResult[] | void>;
  /** Filter by place roles */
  placeRoles?: string[];
  /** Height of the map */
  height?: string | number;
  /** Map theme */
  theme?: 'light' | 'dark' | 'standard';
  /** Additional CSS classes */
  className?: string;
}

type DrawMode = 'none' | 'rectangle' | 'polygon';

export default function MapSearch({
  onSearch,
  placeRoles: _placeRoles,
  height = 500,
  theme = 'light',
  className = '',
}: MapSearchProps) {
  const mapRef = useRef<BaseMapRef>(null);

  const [drawMode, setDrawMode] = useState<DrawMode>('none');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Rectangle drawing state
  const [rectangleStart, setRectangleStart] = useState<[number, number] | null>(null);
  const [rectangleEnd, setRectangleEnd] = useState<[number, number] | null>(null);

  // Polygon drawing state
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([]);

  // Start rectangle mode
  const handleStartRectangle = useCallback(() => {
    setDrawMode('rectangle');
    setRectangleStart(null);
    setRectangleEnd(null);
    setPolygonPoints([]);
    setResults([]);
    setError(null);
  }, []);

  // Start polygon mode
  const handleStartPolygon = useCallback(() => {
    setDrawMode('polygon');
    setRectangleStart(null);
    setRectangleEnd(null);
    setPolygonPoints([]);
    setResults([]);
    setError(null);
  }, []);

  // Clear search area
  const handleClear = useCallback(() => {
    setDrawMode('none');
    setRectangleStart(null);
    setRectangleEnd(null);
    setPolygonPoints([]);
    setResults([]);
    setError(null);
  }, []);

  // Handle map click based on draw mode
  const handleMapClick = useCallback(
    (event: { lngLat: { lng: number; lat: number } }) => {
      const point: [number, number] = [event.lngLat.lng, event.lngLat.lat];

      if (drawMode === 'rectangle') {
        if (!rectangleStart) {
          setRectangleStart(point);
        } else {
          setRectangleEnd(point);
        }
      } else if (drawMode === 'polygon') {
        setPolygonPoints((prev) => [...prev, point]);
      }
    },
    [drawMode, rectangleStart]
  );

  // Execute search
  const handleSearch = useCallback(async () => {
    let searchPolygon: [number, number][] = [];

    if (drawMode === 'rectangle' && rectangleStart && rectangleEnd) {
      // Convert rectangle to polygon (4 corners + close)
      const [minLng, maxLng] = [
        Math.min(rectangleStart[0], rectangleEnd[0]),
        Math.max(rectangleStart[0], rectangleEnd[0]),
      ];
      const [minLat, maxLat] = [
        Math.min(rectangleStart[1], rectangleEnd[1]),
        Math.max(rectangleStart[1], rectangleEnd[1]),
      ];
      searchPolygon = [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat], // Close the polygon
      ];
    } else if (drawMode === 'polygon' && polygonPoints.length >= 3) {
      searchPolygon = [...polygonPoints, polygonPoints[0]]; // Close the polygon
    } else {
      setError('Please draw a search area first');
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const searchResults = await onSearch(searchPolygon);
      // Only set results if the callback returned them (not void)
      if (searchResults) {
        setResults(searchResults);
      }
      setDrawMode('none'); // Exit draw mode after search
    } catch (err) {
      setError('Search failed. Please try again.');
      logger.error('Map search error:', err);
    } finally {
      setIsSearching(false);
    }
  }, [drawMode, rectangleStart, rectangleEnd, polygonPoints, onSearch]);

  // Generate GeoJSON for visualization
  const getSearchAreaGeoJSON = useCallback(() => {
    if (drawMode === 'rectangle' && rectangleStart && rectangleEnd) {
      const [minLng, maxLng] = [
        Math.min(rectangleStart[0], rectangleEnd[0]),
        Math.max(rectangleStart[0], rectangleEnd[0]),
      ];
      const [minLat, maxLat] = [
        Math.min(rectangleStart[1], rectangleEnd[1]),
        Math.max(rectangleStart[1], rectangleEnd[1]),
      ];
      return {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [minLng, minLat],
              [maxLng, minLat],
              [maxLng, maxLat],
              [minLng, maxLat],
              [minLng, minLat],
            ],
          ],
        },
      };
    } else if (polygonPoints.length >= 2) {
      return {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: polygonPoints,
        },
      };
    } else if (polygonPoints.length >= 3) {
      return {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[...polygonPoints, polygonPoints[0]]],
        },
      };
    }
    return null;
  }, [drawMode, rectangleStart, rectangleEnd, polygonPoints]);

  const searchAreaGeoJSON = getSearchAreaGeoJSON();
  const canSearch =
    (drawMode === 'rectangle' && rectangleStart && rectangleEnd) ||
    (drawMode === 'polygon' && polygonPoints.length >= 3);

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-ink">Draw search area:</span>

        <button
          type="button"
          onClick={handleStartRectangle}
          className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm ${
            drawMode === 'rectangle'
              ? 'bg-semantic-info text-parchment'
              : 'bg-stone text-ink hover:bg-lichen'
          }`}
        >
          <Square className="w-4 h-4" />
          Rectangle
        </button>

        <button
          type="button"
          onClick={handleStartPolygon}
          className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm ${
            drawMode === 'polygon'
              ? 'bg-semantic-info text-parchment'
              : 'bg-stone text-ink hover:bg-lichen'
          }`}
        >
          <MapPin className="w-4 h-4" />
          Polygon
        </button>

        <div className="flex-1" />

        {(drawMode !== 'none' || results.length > 0) && (
          <button
            type="button"
            onClick={handleClear}
            className="p-1.5 text-accessible-gray hover:bg-stone rounded"
            title="Clear"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        <button
          type="button"
          onClick={handleSearch}
          disabled={!canSearch || isSearching}
          className="flex items-center gap-2 px-4 py-1.5 bg-semantic-info text-parchment rounded hover:bg-semantic-info disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {isSearching ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          Search Area
        </button>
      </div>

      {/* Map */}
      <div className="relative">
        <BaseMap
          ref={mapRef}
          latitude={20}
          longitude={0}
          zoom={2}
          height={height}
          theme={theme}
          onClick={handleMapClick}
          showNavigation={true}
          showScale={true}
          className={drawMode !== 'none' ? 'cursor-crosshair' : ''}
        >
          {/* Search area visualization */}
          {searchAreaGeoJSON && (
            <Source id="search-area" type="geojson" data={searchAreaGeoJSON}>
              {searchAreaGeoJSON.geometry.type === 'Polygon' && (
                <Layer
                  id="search-area-fill"
                  type="fill"
                  paint={{
                    'fill-color': 'rgba(59, 130, 246, 0.2)',
                  }}
                />
              )}
              <Layer
                id="search-area-stroke"
                type="line"
                paint={{
                  'line-color': '#B0533A',
                  'line-width': 2,
                  'line-dasharray': [2, 2],
                }}
              />
            </Source>
          )}

          {/* Rectangle start point marker */}
          {drawMode === 'rectangle' && rectangleStart && !rectangleEnd && (
            <Marker longitude={rectangleStart[0]} latitude={rectangleStart[1]}>
              <div className="w-3 h-3 bg-semantic-info/100 rounded-full border-2 border-parchment shadow" />
            </Marker>
          )}

          {/* Polygon point markers */}
          {drawMode === 'polygon' &&
            polygonPoints.map((point, index) => (
              <Marker key={index} longitude={point[0]} latitude={point[1]}>
                <div
                  className={`w-3 h-3 rounded-full border-2 border-parchment shadow ${
                    index === 0 ? 'bg-semantic-success/100' : 'bg-semantic-info/100'
                  }`}
                />
              </Marker>
            ))}

          {/* Result markers */}
          {results.map((result) =>
            result.coordinates.lat && result.coordinates.lng ? (
              <Marker
                key={result.object_id}
                longitude={result.coordinates.lng}
                latitude={result.coordinates.lat}
              >
                <div
                  className="w-4 h-4 bg-semantic-warning/100 rounded-full border-2 border-parchment shadow cursor-pointer"
                  title={`${result.object_number}: ${result.title}`}
                />
              </Marker>
            ) : null
          )}
        </BaseMap>

        {/* Drawing instructions overlay */}
        {drawMode !== 'none' && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-parchment/90 px-4 py-2 rounded-lg shadow-lg text-sm">
            {drawMode === 'rectangle' && !rectangleStart && 'Click to set first corner'}
            {drawMode === 'rectangle' && rectangleStart && !rectangleEnd && 'Click to set opposite corner'}
            {drawMode === 'rectangle' && rectangleStart && rectangleEnd && 'Area selected. Click "Search Area" to find objects.'}
            {drawMode === 'polygon' && polygonPoints.length < 3 && `Click to add points (${3 - polygonPoints.length} more needed)`}
            {drawMode === 'polygon' && polygonPoints.length >= 3 && 'Click "Search Area" when done, or continue adding points'}
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="px-4 py-2 bg-semantic-error/10 border border-semantic-error/30 rounded text-semantic-error text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-stone border-b font-medium text-sm">
            Found {results.length} object{results.length !== 1 ? 's' : ''} in selected area
          </div>
          <div className="max-h-64 overflow-y-auto">
            {results.map((result) => (
              <div
                key={result.object_id}
                className="px-4 py-2 border-b last:border-b-0 hover:bg-stone"
              >
                <div className="font-medium text-sm">{result.object_number}</div>
                <div className="text-sm text-accessible-gray">{result.title}</div>
                <div className="text-xs text-archive mt-1">
                  {result.place_role.replace('_', ' ')}: {result.place_name}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
