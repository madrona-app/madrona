/**
 * Which basemap style BaseMap actually hands to MapLibre.
 *
 * This is worth asserting rather than eyeballing because the failure mode is
 * silent: a style that resolves to the wrong provider still renders a map.
 * Two real defects hid behind that:
 *
 *   - theme="dark" resolved to the same light raster style as theme="light",
 *     so asking for a dark map got a light one with no error anywhere.
 *   - the default pointed at tile.openstreetmap.org, donation-funded
 *     infrastructure whose usage policy a browser-based app cannot satisfy.
 *
 * The styles are read from import.meta.env at module load, so each case
 * re-imports BaseMap with a fresh registry. Every variable is stubbed in every
 * case, including to '', so a developer's own .env cannot change the result.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

// Hoisted so the same object survives vi.resetModules() re-running the factory.
const captured = vi.hoisted(() => ({ mapStyle: undefined as unknown }));

vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children, mapStyle }: { children?: React.ReactNode; mapStyle?: unknown }) => {
    captured.mapStyle = mapStyle;
    return <div data-testid="map">{children}</div>;
  },
  NavigationControl: () => null,
  ScaleControl: () => null,
  FullscreenControl: () => null,
  GeolocateControl: () => null,
}));

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

const originalGetContext = HTMLCanvasElement.prototype.getContext;

type MapEnv = {
  VITE_CARTO_API_KEY?: string;
  VITE_MAP_STYLE_LIGHT?: string;
  VITE_MAP_STYLE_DARK?: string;
  VITE_MAP_STYLE_STANDARD?: string;
};

/**
 * Render BaseMap at `theme` under exactly `env`, and return the style it gave
 * MapLibre. Unlisted variables are stubbed empty, not inherited.
 */
async function styleFor(theme: 'light' | 'dark' | 'standard', env: MapEnv = {}) {
  vi.resetModules();
  for (const key of [
    'VITE_CARTO_API_KEY',
    'VITE_MAP_STYLE_LIGHT',
    'VITE_MAP_STYLE_DARK',
    'VITE_MAP_STYLE_STANDARD',
  ] as const) {
    vi.stubEnv(key, env[key] ?? '');
  }
  captured.mapStyle = undefined;
  const { default: BaseMap } = await import('../../../components/maps/BaseMap');
  render(<BaseMap theme={theme} />);
  return captured.mapStyle;
}

/** Every tile URL template inside a style, whether it is a URL or an object. */
function tileUrls(style: unknown): string[] {
  if (typeof style === 'string') return [style];
  const sources = (style as { sources?: Record<string, { tiles?: string[] }> })?.sources ?? {};
  return Object.values(sources).flatMap((s) => s.tiles ?? []);
}

describe('BaseMap basemap style', () => {
  beforeEach(() => {
    // BaseMap renders a "Map unavailable" notice unless WebGL looks present.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebGLRenderingContext = function () {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as any;
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).WebGLRenderingContext;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults light to the OpenFreeMap positron style', async () => {
    expect(await styleFor('light')).toBe('https://tiles.openfreemap.org/styles/positron');
  });

  it('defaults standard to the OpenFreeMap liberty style', async () => {
    expect(await styleFor('standard')).toBe('https://tiles.openfreemap.org/styles/liberty');
  });

  it('defaults dark to a genuinely dark style, not the light one', async () => {
    const dark = await styleFor('dark');
    expect(dark).toBe('https://tiles.openfreemap.org/styles/dark');
    expect(dark).not.toBe(await styleFor('light'));
  });

  it('never points a default theme at tile.openstreetmap.org', async () => {
    for (const theme of ['light', 'dark', 'standard'] as const) {
      const urls = tileUrls(await styleFor(theme));
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.join(' ')).not.toContain('tile.openstreetmap.org');
    }
  });

  it('uses CARTO for light and dark when a key is configured', async () => {
    const light = tileUrls(await styleFor('light', { VITE_CARTO_API_KEY: 'k-123' })).join(' ');
    expect(light).toContain('basemaps.cartocdn.com/light_all/');
    expect(light).toContain('api_key=k-123');

    const dark = tileUrls(await styleFor('dark', { VITE_CARTO_API_KEY: 'k-123' })).join(' ');
    expect(dark).toContain('basemaps.cartocdn.com/dark_all/');
  });

  it('leaves standard on OpenFreeMap even with a CARTO key', async () => {
    // CARTO has no third full-colour basemap to stand in for 'standard'.
    expect(await styleFor('standard', { VITE_CARTO_API_KEY: 'k-123' })).toBe(
      'https://tiles.openfreemap.org/styles/liberty',
    );
  });

  it('lets an env override win over both CARTO and the default', async () => {
    const self = 'https://tiles.museum.example/styles/dark';
    expect(
      await styleFor('dark', { VITE_MAP_STYLE_DARK: self, VITE_CARTO_API_KEY: 'k-123' }),
    ).toBe(self);
    // An override for one theme does not leak into the others.
    expect(await styleFor('light', { VITE_MAP_STYLE_DARK: self })).toBe(
      'https://tiles.openfreemap.org/styles/positron',
    );
  });

  it('ignores a blank override rather than handing MapLibre an empty style', async () => {
    expect(await styleFor('light', { VITE_MAP_STYLE_LIGHT: '   ' })).toBe(
      'https://tiles.openfreemap.org/styles/positron',
    );
  });
});
