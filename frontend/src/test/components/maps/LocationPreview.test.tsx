import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LocationPreview from '../../../components/maps/LocationPreview';

// Mock react-map-gl/maplibre — we don't need to render an actual map
vi.mock('react-map-gl/maplibre', () => ({
  Marker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="map-marker">{children}</div>
  ),
}));

// Mock BaseMap — render children inside a stub so we can verify
vi.mock('../../../components/maps/BaseMap', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="base-map">{children}</div>
  ),
}));

describe('LocationPreview', () => {
  it('renders the map and a marker for valid coordinates', () => {
    render(<LocationPreview latitude={47.6} longitude={-122.3} />);
    expect(screen.getByTestId('base-map')).toBeInTheDocument();
    expect(screen.getByTestId('map-marker')).toBeInTheDocument();
  });

  it('passes the location name as a tooltip to the marker', () => {
    const { container } = render(
      <LocationPreview latitude={47.6} longitude={-122.3} name="Seattle" />,
    );
    const titled = container.querySelector('[title="Seattle"]');
    expect(titled).toBeInTheDocument();
  });

  it('renders the invalid-coordinates fallback for NaN', () => {
    render(<LocationPreview latitude={NaN} longitude={NaN} />);
    expect(screen.getByText('Invalid coordinates')).toBeInTheDocument();
    expect(screen.queryByTestId('base-map')).not.toBeInTheDocument();
  });

  it('renders the invalid-coordinates fallback for out-of-range latitude', () => {
    render(<LocationPreview latitude={91} longitude={0} />);
    expect(screen.getByText('Invalid coordinates')).toBeInTheDocument();
  });

  it('renders the invalid-coordinates fallback for out-of-range longitude', () => {
    render(<LocationPreview latitude={0} longitude={181} />);
    expect(screen.getByText('Invalid coordinates')).toBeInTheDocument();
  });

  it('treats latitude=-90 and longitude=-180 as valid', () => {
    render(<LocationPreview latitude={-90} longitude={-180} />);
    expect(screen.getByTestId('base-map')).toBeInTheDocument();
  });

  it('treats latitude=90 and longitude=180 as valid', () => {
    render(<LocationPreview latitude={90} longitude={180} />);
    expect(screen.getByTestId('base-map')).toBeInTheDocument();
  });

  it('applies the className on the invalid-coordinates fallback', () => {
    const { container } = render(
      <LocationPreview latitude={NaN} longitude={0} className="foo-class" />,
    );
    expect(container.firstChild).toHaveClass('foo-class');
  });
});
