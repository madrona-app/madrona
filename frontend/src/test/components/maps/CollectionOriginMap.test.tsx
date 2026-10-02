import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CollectionOriginMap from '../../../components/maps/CollectionOriginMap';
import type { PlaceOrigin } from '../../../components/maps/CollectionOriginMap';

vi.mock('react-map-gl/maplibre', () => ({
  Marker: ({ children, onClick }: { children?: React.ReactNode; onClick?: (e: { originalEvent: { stopPropagation: () => void } }) => void }) => (
    <div data-testid="marker" onClick={() => onClick?.({ originalEvent: { stopPropagation: () => {} } })}>
      {children}
    </div>
  ),
  Source: ({ children }: { children?: React.ReactNode }) => <div data-testid="source">{children}</div>,
  Layer: () => <div data-testid="layer" />,
  Popup: ({ children }: { children?: React.ReactNode }) => <div data-testid="popup">{children}</div>,
}));

vi.mock('../../../components/maps/BaseMap', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div data-testid="base-map">{children}</div>,
}));

const places: PlaceOrigin[] = [
  {
    place_id: 'p-1',
    name: 'Paris',
    latitude: 48.8,
    longitude: 2.3,
    object_count: 10,
    role: 'creation_place',
    hierarchy: 'Paris, France',
  },
  {
    place_id: 'p-2',
    name: 'London',
    latitude: 51.5,
    longitude: -0.1,
    object_count: 5,
    role: 'discovery_place',
  },
];

describe('CollectionOriginMap', () => {
  it('renders BaseMap', () => {
    render(<CollectionOriginMap places={places} />);
    expect(screen.getByTestId('base-map')).toBeInTheDocument();
  });

  it('renders header with collection name and counts', () => {
    render(<CollectionOriginMap places={places} collectionName="Test Collection" />);
    expect(screen.getByText('Test Collection')).toBeInTheDocument();
    expect(screen.getByText(/15 objects from 2 places/)).toBeInTheDocument();
  });

  it('renders legend', () => {
    render(<CollectionOriginMap places={places} />);
    expect(screen.getByText('Place Roles')).toBeInTheDocument();
    expect(screen.getByText('Creation Place')).toBeInTheDocument();
    expect(screen.getByText('Discovery Place')).toBeInTheDocument();
    expect(screen.getByText('Provenance Place')).toBeInTheDocument();
  });

  it('renders display mode toggle', () => {
    render(<CollectionOriginMap places={places} />);
    expect(screen.getByText('Markers')).toBeInTheDocument();
    expect(screen.getByText('Heatmap')).toBeInTheDocument();
  });

  it('renders Top Origins list', () => {
    render(<CollectionOriginMap places={places} />);
    expect(screen.getByText('Top Origins')).toBeInTheDocument();
    expect(screen.getByText(/1\. Paris/)).toBeInTheDocument();
    expect(screen.getByText(/2\. London/)).toBeInTheDocument();
  });

  it('renders one Marker per place in markers mode', () => {
    render(<CollectionOriginMap places={places} displayMode="markers" />);
    const markers = screen.getAllByTestId('marker');
    expect(markers.length).toBeGreaterThanOrEqual(2);
  });

  it('renders heatmap source in heatmap mode', () => {
    render(<CollectionOriginMap places={places} displayMode="heatmap" />);
    expect(screen.getByTestId('source')).toBeInTheDocument();
    expect(screen.getByTestId('layer')).toBeInTheDocument();
  });

  it('filters by role when roleFilter is set', () => {
    render(<CollectionOriginMap places={places} roleFilter="creation_place" />);
    expect(screen.getByText(/10 objects from 1 places/)).toBeInTheDocument();
  });

  it('calls onPlaceClick when clicking top origin', () => {
    const onPlaceClick = vi.fn();
    render(<CollectionOriginMap places={places} onPlaceClick={onPlaceClick} />);
    fireEvent.click(screen.getByText(/1\. Paris/));
    expect(onPlaceClick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Paris' }));
  });

  it('uses default world center when no places given', () => {
    render(<CollectionOriginMap places={[]} />);
    expect(screen.getByText(/0 objects from 0 places/)).toBeInTheDocument();
  });
});
