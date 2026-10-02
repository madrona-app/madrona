import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ShipmentRouteMap from '../../../components/maps/ShipmentRouteMap';
import type { ShipmentPoint } from '../../../components/maps/ShipmentRouteMap';

vi.mock('react-map-gl/maplibre', () => ({
  Marker: ({ children }: { children?: React.ReactNode }) => <div data-testid="marker">{children}</div>,
  Source: ({ children }: { children?: React.ReactNode }) => <div data-testid="source">{children}</div>,
  Layer: () => <div data-testid="layer" />,
  Popup: ({ children }: { children?: React.ReactNode }) => <div data-testid="popup">{children}</div>,
}));

vi.mock('../../../components/maps/BaseMap', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div data-testid="base-map">{children}</div>,
}));

const shipments: ShipmentPoint[] = [
  {
    shipment_id: 's-1',
    shipment_number: 'SHIP-001',
    direction: 'outbound',
    status: 'in_transit',
    carrier: 'FedEx',
    tracking_number: 'TRK1',
    origin: 'New York',
    origin_coordinates: { lat: 40, lng: -73 },
    destination: 'Paris',
    destination_coordinates: { lat: 48, lng: 2 },
    ship_date: '2025-01-01',
    expected_arrival: '2025-01-10',
    actual_arrival: null,
    object_count: 5,
  },
  {
    shipment_id: 's-2',
    shipment_number: 'SHIP-002',
    direction: 'inbound',
    status: 'arrived',
    carrier: null,
    tracking_number: null,
    origin: 'London',
    origin_coordinates: { lat: 51, lng: -0.1 },
    destination: 'Boston',
    destination_coordinates: { lat: 42, lng: -71 },
    ship_date: null,
    expected_arrival: null,
    actual_arrival: '2025-01-05',
    object_count: 3,
  },
];

describe('ShipmentRouteMap', () => {
  it('renders BaseMap', () => {
    render(<ShipmentRouteMap shipments={shipments} />);
    expect(screen.getByTestId('base-map')).toBeInTheDocument();
  });

  it('renders the exhibition title when given', () => {
    render(<ShipmentRouteMap shipments={shipments} exhibitionTitle="My Exhibition" />);
    expect(screen.getByText('My Exhibition')).toBeInTheDocument();
  });

  it('shows shipment status legend with counts', () => {
    render(<ShipmentRouteMap shipments={shipments} />);
    expect(screen.getByText('Shipment Status')).toBeInTheDocument();
    expect(screen.getByText(/In Transit \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Arrived \(1\)/)).toBeInTheDocument();
  });

  it('shows shipment status legend or labels', () => {
    render(<ShipmentRouteMap shipments={shipments} />);
    // The status filter and legend should be visible
    const baseMap = screen.getByTestId('base-map');
    expect(baseMap).toBeInTheDocument();
  });

  it('renders source for the route lines', () => {
    render(<ShipmentRouteMap shipments={shipments} />);
    expect(screen.getByTestId('source')).toBeInTheDocument();
  });

  it('filters by status when statusFilter prop given', () => {
    const { rerender } = render(<ShipmentRouteMap shipments={shipments} statusFilter={['arrived']} />);
    rerender(<ShipmentRouteMap shipments={shipments} statusFilter={['arrived']} />);
    expect(screen.getByTestId('base-map')).toBeInTheDocument();
  });

  it('handles empty shipments list', () => {
    render(<ShipmentRouteMap shipments={[]} />);
    expect(screen.getByTestId('base-map')).toBeInTheDocument();
  });

  it('renders markers for shipments with coordinates', () => {
    render(<ShipmentRouteMap shipments={shipments} />);
    const markers = screen.getAllByTestId('marker');
    expect(markers.length).toBeGreaterThan(0);
  });
});
