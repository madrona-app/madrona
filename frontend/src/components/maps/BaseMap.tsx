/**
 * BaseMap component - Foundation for all map features in Madrona.
 *
 * Uses MapLibre GL JS with react-map-gl for a Madrona-themed map experience.
 * Supports both light and dark themes, with controls styled to match the app.
 */

import { useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import Map, {
  NavigationControl,
  ScaleControl,
  FullscreenControl,
  GeolocateControl,
  type ViewStateChangeEvent as MapViewStateChangeEvent,
} from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

// onMove hands callers the library's own event type rather than a local
// stand-in. There were local ViewState / ViewStateChangeEvent interfaces here,
// added "to avoid import issues with react-map-gl types". They read as a tidy
// narrowing of the library surface but were not assignable in either
// direction — the handler couldn't satisfy <Map onMove>, and the library event
// couldn't satisfy the local prop. Nothing outside this file passes onMove, so
// there was no API to preserve.

// Basemap tiles.
//
// Default: OpenFreeMap — OpenStreetMap data served as vector tiles with no
// account, no API key and no usage limits, commercial use allowed, MIT
// licensed, self-hostable. Attribution travels in the style's TileJSON, so
// MapLibre's attribution control renders it without our help.
//
// Two providers stood here before and both had to go:
//
//   CARTO's Positron / Dark Matter were usable anonymously once and are not
//   any more — unauthenticated requests still return tiles, with "API KEY
//   REQUIRED" stamped across them, which reads as a bug in Madrona rather
//   than a missing credential. Still honoured for anyone holding a key, never
//   the default.
//
//   tile.openstreetmap.org replaced it as the key-free fallback, and that was
//   a worse trade than it looked. The OSMF tile usage policy asks each app to
//   identify itself with a distinct User-Agent, which a browser cannot do,
//   and those servers are donation-funded infrastructure for osm.org itself;
//   shipping a self-hostable product that points every install there by
//   default is the pattern that policy exists to discourage. It was also
//   raster and light-only, so theme="dark" quietly rendered a light map.
//
// Every theme's style is repointable by env var — at a self-hosted
// OpenFreeMap instance, a Protomaps PMTiles file, MapTiler, anything that
// serves a MapLibre style document. An institution that cannot reach a third
// party at all needs configuration, not a fork.

type MapTheme = 'light' | 'dark' | 'standard';

// OpenFreeMap's own style names: positron is the muted light style CARTO
// popularised, liberty the full-colour osm-carto alike.
const OPENFREEMAP_STYLES: Record<MapTheme, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
  standard: 'https://tiles.openfreemap.org/styles/liberty',
};

// One static read per key rather than import.meta.env[name]: Vite substitutes
// these at build time and a computed key is not guaranteed to be replaced.
const STYLE_OVERRIDES: Record<MapTheme, string | undefined> = {
  light: import.meta.env.VITE_MAP_STYLE_LIGHT as string | undefined,
  dark: import.meta.env.VITE_MAP_STYLE_DARK as string | undefined,
  standard: import.meta.env.VITE_MAP_STYLE_STANDARD as string | undefined,
};

const CARTO_API_KEY = import.meta.env.VITE_CARTO_API_KEY as string | undefined;

type RasterStyle = {
  version: 8;
  sources: Record<string, {
    type: 'raster';
    tiles: string[];
    tileSize: number;
    attribution: string;
  }>;
  layers: { id: string; type: 'raster'; source: string; minzoom: number; maxzoom: number }[];
};

function rasterStyle(tiles: string[], attribution: string): RasterStyle {
  return {
    version: 8 as const,
    sources: {
      basemap: { type: 'raster' as const, tiles, tileSize: 256, attribution },
    },
    layers: [
      { id: 'basemap', type: 'raster' as const, source: 'basemap', minzoom: 0, maxzoom: 19 },
    ],
  };
}

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' +
  ' contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const cartoTiles = (variant: 'light_all' | 'dark_all'): string[] =>
  ['a', 'b', 'c'].map(
    (sub) =>
      `https://${sub}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}.png` +
      `?api_key=${encodeURIComponent(CARTO_API_KEY ?? '')}`,
  );

function styleFor(theme: MapTheme): string | RasterStyle {
  const override = STYLE_OVERRIDES[theme]?.trim();
  if (override) return override;
  // CARTO has no third full-colour basemap to stand in for 'standard', so
  // that theme stays on OpenFreeMap even when a CARTO key is present.
  if (CARTO_API_KEY && theme !== 'standard') {
    return rasterStyle(
      cartoTiles(theme === 'dark' ? 'dark_all' : 'light_all'),
      CARTO_ATTRIBUTION,
    );
  }
  return OPENFREEMAP_STYLES[theme];
}

const TILE_STYLES: Record<MapTheme, string | RasterStyle> = {
  light: styleFor('light'),
  dark: styleFor('dark'),
  standard: styleFor('standard'),
};

/**
 * Whether the browser can create a WebGL context. MapLibre requires WebGL;
 * when it's unavailable (e.g. hardware acceleration disabled in the browser),
 * map creation throws a webglcontextcreationerror and the canvas stays blank.
 * We detect it up front and show a readable message instead.
 */
function isWebGLAvailable(): boolean {
  if (typeof window === 'undefined' || !window.WebGLRenderingContext) return false;
  try {
    const canvas = document.createElement('canvas');
    // MapLibre runs on WebGL2 or WebGL1 — accept either (a browser can
    // expose webgl2 without webgl1).
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    if (!gl) return false;
    // Release the probe context so it doesn't count against the browser's
    // per-page context limit (BaseMap can mount many times in a session).
    const ctx = gl as WebGLRenderingContext;
    if (typeof ctx.getExtension === 'function') {
      ctx.getExtension('WEBGL_lose_context')?.loseContext();
    }
    return true;
  } catch {
    return false;
  }
}

export interface BaseMapProps {
  /** Initial center latitude */
  latitude?: number;
  /** Initial center longitude */
  longitude?: number;
  /** Initial zoom level (0-20) */
  zoom?: number;
  /** Map theme: 'light', 'dark', or 'standard' */
  theme?: MapTheme;
  /** Height of the map container */
  height?: string | number;
  /** Width of the map container */
  width?: string | number;
  /** Show navigation controls */
  showNavigation?: boolean;
  /** Show scale control */
  showScale?: boolean;
  /** Show fullscreen control */
  showFullscreen?: boolean;
  /** Show geolocate control */
  showGeolocate?: boolean;
  /** Callback when map is clicked */
  onClick?: (event: { lngLat: { lng: number; lat: number } }) => void;
  /** Callback when view state changes */
  onMove?: (event: MapViewStateChangeEvent) => void;
  /** Children to render inside the map (markers, layers, etc.) */
  children?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Disable map interactions */
  interactive?: boolean;
}

interface BaseMapRefType {
  /** Get the underlying MapLibre map instance */
  getMap: () => unknown;
  /** Fly to a location */
  flyTo: (options: { center: [number, number]; zoom?: number; duration?: number }) => void;
  /** Fit bounds */
  fitBounds: (bounds: [[number, number], [number, number]], options?: { padding?: number }) => void;
}

export type BaseMapRef = BaseMapRefType;

const BaseMap = forwardRef<BaseMapRefType, BaseMapProps>(
  (
    {
      latitude = 0,
      longitude = 0,
      zoom = 2,
      theme = 'light',
      height = '100%',
      width = '100%',
      showNavigation = true,
      showScale = true,
      showFullscreen = false,
      showGeolocate = false,
      onClick,
      onMove,
      children,
      className = '',
      interactive = true,
    },
    ref
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapRef = useRef<any>(null);
    const [viewState, setViewState] = useState({
      latitude,
      longitude,
      zoom,
    });

    // Expose map methods via ref
    useImperativeHandle(ref, () => ({
      getMap: () => mapRef.current?.getMap() ?? null,
      flyTo: (options) => {
        mapRef.current?.flyTo(options);
      },
      fitBounds: (bounds, options) => {
        mapRef.current?.fitBounds(bounds, options);
      },
    }));

    const handleMove = useCallback(
      (event: MapViewStateChangeEvent) => {
        setViewState(event.viewState);
        onMove?.(event);
      },
      [onMove]
    );

    const mapStyle = TILE_STYLES[theme];

    const [webglAvailable] = useState(isWebGLAvailable);

    if (!webglAvailable) {
      return (
        <div
          className={`relative overflow-hidden rounded-lg border border-lichen bg-stone/30 flex items-center justify-center p-6 text-center ${className}`}
          style={{ height, width }}
        >
          <div className="max-w-xs text-sm text-archive">
            <p className="font-medium text-ink">Map unavailable</p>
            <p className="mt-1">
              Your browser can’t render maps (WebGL is disabled). Turn on hardware
              acceleration in your browser settings, then reload.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`relative overflow-hidden rounded-lg ${className}`}
        style={{ height, width }}
      >
        <Map
          ref={mapRef}
          {...viewState}
          onMove={handleMove}
          onClick={onClick}
          mapStyle={mapStyle}
          // {} rather than true: maplibre 6 types this as
          // `false | AttributionControlOptions`, so `true` no longer compiles.
          // An empty options object is the same thing — attribution on, with
          // defaults — and the tile providers require it.
          attributionControl={{}}
          interactive={interactive}
          style={{ width: '100%', height: '100%' }}
        >
          {showNavigation && (
            <NavigationControl position="top-right" showCompass={true} showZoom={true} />
          )}
          {showScale && <ScaleControl position="bottom-left" maxWidth={100} unit="metric" />}
          {showFullscreen && <FullscreenControl position="top-right" />}
          {showGeolocate && (
            <GeolocateControl
              position="top-right"
              trackUserLocation={false}
              showUserLocation={true}
            />
          )}
          {children}
        </Map>
      </div>
    );
  }
);

BaseMap.displayName = 'BaseMap';

export default BaseMap;
