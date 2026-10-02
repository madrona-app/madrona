import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import BaseMap from '../../../components/maps/BaseMap';

// Mock all react-map-gl/maplibre exports — render children inline
vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) => (
    <div data-testid="map" style={style}>
      {children}
    </div>
  ),
  NavigationControl: () => <div data-testid="navigation-control" />,
  ScaleControl: () => <div data-testid="scale-control" />,
  FullscreenControl: () => <div data-testid="fullscreen-control" />,
  GeolocateControl: () => <div data-testid="geolocate-control" />,
}));

// Mock the CSS import
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

// BaseMap's WebGL detection short-circuits on !window.WebGLRenderingContext
// AND calls canvas.getContext('webgl'). jsdom has neither — no
// WebGLRenderingContext on window, and getContext returns null. Without
// stubbing both, every test would hit the "Map unavailable" fallback.
// The "BaseMap" suite below assumes WebGL is available; the
// "BaseMap WebGL fallback" suite further down explicitly tests the
// unavailable path by NOT applying this stub.
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const installWebGLStub = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).WebGLRenderingContext = function () {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as any;
};
const uninstallWebGLStub = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).WebGLRenderingContext;
  HTMLCanvasElement.prototype.getContext = originalGetContext;
};

describe('BaseMap', () => {
  beforeEach(installWebGLStub);
  afterEach(uninstallWebGLStub);

  it('renders the map', () => {
    render(<BaseMap />);
    expect(screen.getByTestId('map')).toBeInTheDocument();
  });

  it('renders navigation and scale controls by default', () => {
    render(<BaseMap />);
    expect(screen.getByTestId('navigation-control')).toBeInTheDocument();
    expect(screen.getByTestId('scale-control')).toBeInTheDocument();
  });

  it('omits fullscreen control by default', () => {
    render(<BaseMap />);
    expect(screen.queryByTestId('fullscreen-control')).not.toBeInTheDocument();
  });

  it('omits geolocate control by default', () => {
    render(<BaseMap />);
    expect(screen.queryByTestId('geolocate-control')).not.toBeInTheDocument();
  });

  it('shows fullscreen control when enabled', () => {
    render(<BaseMap showFullscreen />);
    expect(screen.getByTestId('fullscreen-control')).toBeInTheDocument();
  });

  it('shows geolocate control when enabled', () => {
    render(<BaseMap showGeolocate />);
    expect(screen.getByTestId('geolocate-control')).toBeInTheDocument();
  });

  it('hides navigation control when disabled', () => {
    render(<BaseMap showNavigation={false} />);
    expect(screen.queryByTestId('navigation-control')).not.toBeInTheDocument();
  });

  it('hides scale control when disabled', () => {
    render(<BaseMap showScale={false} />);
    expect(screen.queryByTestId('scale-control')).not.toBeInTheDocument();
  });

  it('renders children inside the map', () => {
    render(
      <BaseMap>
        <div data-testid="child-marker">marker</div>
      </BaseMap>,
    );
    expect(screen.getByTestId('child-marker')).toBeInTheDocument();
  });

  it('applies the className to the wrapper', () => {
    const { container } = render(<BaseMap className="custom-cls" />);
    expect(container.firstChild).toHaveClass('custom-cls');
  });

  it('applies width and height styles', () => {
    const { container } = render(<BaseMap height={400} width={600} />);
    expect(container.firstChild).toHaveStyle({ height: '400px', width: '600px' });
  });
});

describe('BaseMap WebGL fallback', () => {
  // jsdom's default behavior — canvas.getContext returns null — is exactly
  // what we want here to drive the isWebGLAvailable() branch into the
  // "unavailable" path. We deliberately do NOT install the WebGL stub.

  it('renders the "Map unavailable" fallback when WebGL is not available', () => {
    render(<BaseMap />);
    expect(screen.getByText('Map unavailable')).toBeInTheDocument();
    expect(
      screen.getByText(/WebGL is disabled/i),
    ).toBeInTheDocument();
    // The actual map should not have rendered.
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
  });

  it('does not render map children in the fallback', () => {
    render(
      <BaseMap>
        <div data-testid="child-marker">marker</div>
      </BaseMap>,
    );
    expect(screen.queryByTestId('child-marker')).not.toBeInTheDocument();
  });

  it('respects the className prop on the fallback wrapper', () => {
    const { container } = render(<BaseMap className="custom-cls" />);
    expect(container.firstChild).toHaveClass('custom-cls');
  });
});
