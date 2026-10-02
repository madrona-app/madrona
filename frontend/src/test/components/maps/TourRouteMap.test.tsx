import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TourRouteMap from '../../../components/maps/TourRouteMap';
import type { TourVenue } from '../../../components/maps/TourRouteMap';

vi.mock('react-map-gl/maplibre', () => ({
  Marker: ({ children }: { children?: React.ReactNode }) => <div data-testid="marker">{children}</div>,
  Source: ({ children }: { children?: React.ReactNode }) => <div data-testid="source">{children}</div>,
  Layer: () => <div data-testid="layer" />,
  Popup: ({ children }: { children?: React.ReactNode }) => <div data-testid="popup">{children}</div>,
}));

vi.mock('../../../components/maps/BaseMap', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div data-testid="base-map">{children}</div>,
}));

const venues: TourVenue[] = [
  {
    venue_id: 'v-1',
    name: 'MoMA',
    latitude: 40.76,
    longitude: -73.97,
    sequence_order: 1,
    status: 'completed',
    city: 'New York',
    start_date: '2025-01-01',
    end_date: '2025-03-01',
  },
  {
    venue_id: 'v-2',
    name: 'Tate',
    latitude: 51.5,
    longitude: -0.1,
    sequence_order: 2,
    status: 'open',
    city: 'London',
  },
  {
    venue_id: 'v-3',
    name: 'Cancelled',
    latitude: 35,
    longitude: 139,
    sequence_order: 3,
    status: 'cancelled',
    city: 'Tokyo',
  },
];

describe('TourRouteMap', () => {
  it('renders BaseMap', () => {
    render(<TourRouteMap venues={venues} />);
    expect(screen.getByTestId('base-map')).toBeInTheDocument();
  });

  it('renders the exhibition title when given', () => {
    render(<TourRouteMap venues={venues} exhibitionTitle="World Tour" />);
    expect(screen.getByText('World Tour')).toBeInTheDocument();
  });

  it('renders route line source when 2+ venues', () => {
    render(<TourRouteMap venues={venues} />);
    expect(screen.getByTestId('source')).toBeInTheDocument();
  });

  it('does not render route line when only 1 venue', () => {
    render(<TourRouteMap venues={[venues[0]]} />);
    expect(screen.queryByTestId('source')).not.toBeInTheDocument();
  });

  it('filters out cancelled venues', () => {
    render(<TourRouteMap venues={venues} />);
    // Cancelled venue should not be a marker
    expect(screen.queryByText('Cancelled')).not.toBeInTheDocument();
  });

  it('handles empty venues array', () => {
    render(<TourRouteMap venues={[]} />);
    expect(screen.getByTestId('base-map')).toBeInTheDocument();
  });

  it('renders markers for active venues', () => {
    render(<TourRouteMap venues={venues} />);
    const markers = screen.getAllByTestId('marker');
    expect(markers.length).toBeGreaterThanOrEqual(2);
  });
});
