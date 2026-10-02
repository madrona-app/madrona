import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoanNetworkMap from '../../../components/maps/LoanNetworkMap';
import type { LoanContact } from '../../../components/maps/LoanNetworkMap';

vi.mock('react-map-gl/maplibre', () => ({
  Marker: ({ children }: { children?: React.ReactNode }) => <div data-testid="marker">{children}</div>,
  Source: ({ children }: { children?: React.ReactNode }) => <div data-testid="source">{children}</div>,
  Layer: () => <div data-testid="layer" />,
}));

vi.mock('../../../components/maps/BaseMap', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div data-testid="base-map">{children}</div>,
}));

const contacts: LoanContact[] = [
  {
    contact_id: 'c-1',
    name: 'Louvre',
    latitude: 48.8,
    longitude: 2.3,
    loans_out_count: 3,
    loans_in_count: 0,
    active_loans: 2,
  },
  {
    contact_id: 'c-2',
    name: 'British Museum',
    latitude: 51.5,
    longitude: -0.1,
    loans_out_count: 0,
    loans_in_count: 5,
    active_loans: 1,
  },
  {
    contact_id: 'c-3',
    name: 'No Coords Place',
    latitude: null,
    longitude: null,
    loans_out_count: 1,
    loans_in_count: 1,
    active_loans: 0,
  },
];

describe('LoanNetworkMap', () => {
  it('renders BaseMap', () => {
    render(<LoanNetworkMap contacts={contacts} />);
    expect(screen.getByTestId('base-map')).toBeInTheDocument();
  });

  it('renders the legend', () => {
    render(<LoanNetworkMap contacts={contacts} />);
    expect(screen.getByText('Loan Network')).toBeInTheDocument();
    expect(screen.getByText('Your Organization')).toBeInTheDocument();
    expect(screen.getByText('Loans Out (we lent)')).toBeInTheDocument();
    expect(screen.getByText('Loans In (they lent)')).toBeInTheDocument();
  });

  it('shows institution counts in the stats summary', () => {
    render(<LoanNetworkMap contacts={contacts} />);
    expect(screen.getByText('Institutions')).toBeInTheDocument();
    // Two contacts have valid coordinates
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('aggregates loans out across contacts', () => {
    render(<LoanNetworkMap contacts={contacts} />);
    // 3 loans out from Louvre + 0 from British = 3
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('aggregates loans in across contacts', () => {
    render(<LoanNetworkMap contacts={contacts} />);
    // 0 + 5 = 5
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows "active loans only" message when activeOnly is true', () => {
    render(<LoanNetworkMap contacts={contacts} activeOnly />);
    expect(screen.getByText('Showing active loans only')).toBeInTheDocument();
  });

  it('renders organization marker when coordinates given', () => {
    render(
      <LoanNetworkMap
        contacts={contacts}
        organizationCoordinates={{ latitude: 40, longitude: -73, name: 'My Museum' }}
      />,
    );
    expect(screen.getByText('My Museum')).toBeInTheDocument();
  });

  it('does not render lines when showFlowLines is false', () => {
    render(
      <LoanNetworkMap
        contacts={contacts}
        organizationCoordinates={{ latitude: 40, longitude: -73 }}
        showFlowLines={false}
      />,
    );
    expect(screen.queryByTestId('source')).not.toBeInTheDocument();
  });

  it('renders flow line source when showFlowLines is true and org coords given', () => {
    render(
      <LoanNetworkMap
        contacts={contacts}
        organizationCoordinates={{ latitude: 40, longitude: -73 }}
        showFlowLines={true}
      />,
    );
    expect(screen.getByTestId('source')).toBeInTheDocument();
  });

  it('handles empty contacts array', () => {
    render(<LoanNetworkMap contacts={[]} />);
    expect(screen.getByText('Institutions')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
  });
});
