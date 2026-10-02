import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TouringTimeline } from '../../../components/exhibit/TouringTimeline';
import type { ExhibitionVenue } from '../../../lib/api';

function venue(overrides: Partial<ExhibitionVenue> = {}): ExhibitionVenue {
  return {
    exhibition_venue_id: 'v-1',
    organization_id: 'org-1',
    exhibition_id: 'ex-1',
    venue_name: 'Test Venue',
    city: null,
    country: null,
    status: 'confirmed',
    sequence_number: 1,
    planned_start_date: '2024-01-01',
    planned_end_date: '2024-04-01',
    actual_start_date: null,
    actual_end_date: null,
    contact_name: null,
    contact_email: null,
    fee_amount: null,
    notes: null,
    address: null,
    coordinates: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  } as unknown as ExhibitionVenue;
}

describe('TouringTimeline', () => {
  it('returns null when there are no dates anywhere', () => {
    const { container } = render(
      <TouringTimeline
        venues={[
          venue({
            planned_start_date: null,
            planned_end_date: null,
            actual_start_date: null,
            actual_end_date: null,
          }),
        ]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the Tour Timeline header when at least one date exists', () => {
    render(<TouringTimeline venues={[venue()]} />);
    expect(screen.getByText('Tour Timeline')).toBeInTheDocument();
  });

  it('renders one row per venue', () => {
    render(
      <TouringTimeline
        venues={[
          venue({ exhibition_venue_id: 'v-1', venue_name: 'Venue One' }),
          venue({
            exhibition_venue_id: 'v-2',
            venue_name: 'Venue Two',
            planned_start_date: '2024-05-01',
            planned_end_date: '2024-08-01',
          }),
        ]}
      />,
    );
    expect(screen.getByText('Venue One')).toBeInTheDocument();
    expect(screen.getByText('Venue Two')).toBeInTheDocument();
  });

  it('still renders venue when only an actual date is set', () => {
    render(
      <TouringTimeline
        venues={[
          venue({
            planned_start_date: null,
            planned_end_date: null,
            actual_start_date: '2024-02-15',
            actual_end_date: null,
          }),
        ]}
      />,
    );
    expect(screen.getByText('Tour Timeline')).toBeInTheDocument();
  });

  it('shows month labels', () => {
    const { container } = render(<TouringTimeline venues={[venue()]} />);
    // months are rendered as absolutely positioned divs; just verify there are some
    expect(container.querySelectorAll('[style*="left:"]').length).toBeGreaterThan(0);
  });

  it('handles many venues without crashing', () => {
    const venues = Array.from({ length: 6 }).map((_, i) =>
      venue({
        exhibition_venue_id: `v-${i}`,
        venue_name: `Venue ${i}`,
        planned_start_date: `2024-0${i + 1}-01`,
        planned_end_date: `2024-0${i + 2}-01`,
      }),
    );
    render(<TouringTimeline venues={venues} />);
    expect(screen.getByText('Venue 0')).toBeInTheDocument();
    expect(screen.getByText('Venue 5')).toBeInTheDocument();
  });
});
