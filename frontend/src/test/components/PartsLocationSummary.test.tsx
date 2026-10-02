import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  PartsLocationSummary,
  PartsLocationTooltip,
} from '../../components/collections/PartsLocationSummary';

function makePart(overrides: Partial<Parameters<typeof PartsLocationSummary>[0]['parts'][number]> = {}) {
  return {
    part_id: `part-${Math.random()}`,
    current_location_id: 'loc-1',
    current_location_name: 'Gallery A',
    current_location_path: 'Main > Gallery A',
    current_location_on_display: false,
    ...overrides,
  };
}

describe('PartsLocationSummary', () => {
  it('renders nothing when parts is empty', () => {
    const { container } = render(<PartsLocationSummary parts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when there is only a single part', () => {
    const { container } = render(
      <PartsLocationSummary parts={[makePart()]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('summarises "N parts in Location" when all parts share one location', () => {
    render(
      <PartsLocationSummary
        parts={[
          makePart({ part_id: 'p1' }),
          makePart({ part_id: 'p2' }),
          makePart({ part_id: 'p3' }),
        ]}
      />
    );
    expect(screen.getByText('3 parts in Main > Gallery A')).toBeInTheDocument();
  });

  it('summarises "M on display, N in storage" when parts are mixed', () => {
    render(
      <PartsLocationSummary
        parts={[
          makePart({ part_id: 'p1', current_location_id: 'loc-1', current_location_on_display: true }),
          makePart({
            part_id: 'p2',
            current_location_id: 'loc-2',
            current_location_name: 'Storage',
            current_location_path: 'Main > Storage',
            current_location_on_display: false,
          }),
        ]}
      />
    );
    expect(screen.getByText('1 on display, 1 in storage')).toBeInTheDocument();
  });

  it('summarises "N parts on display" when all are on display across multiple rooms', () => {
    render(
      <PartsLocationSummary
        parts={[
          makePart({
            part_id: 'p1',
            current_location_id: 'loc-1',
            current_location_path: 'Gallery A',
            current_location_on_display: true,
          }),
          makePart({
            part_id: 'p2',
            current_location_id: 'loc-2',
            current_location_path: 'Gallery B',
            current_location_on_display: true,
          }),
        ]}
      />
    );
    expect(screen.getByText('2 parts on display')).toBeInTheDocument();
  });

  it('summarises "N parts in storage" when none on display across multiple rooms', () => {
    render(
      <PartsLocationSummary
        parts={[
          makePart({
            part_id: 'p1',
            current_location_id: 'loc-1',
            current_location_path: 'Storage A',
            current_location_on_display: false,
          }),
          makePart({
            part_id: 'p2',
            current_location_id: 'loc-2',
            current_location_path: 'Storage B',
            current_location_on_display: false,
          }),
        ]}
      />
    );
    expect(screen.getByText('2 parts in storage')).toBeInTheDocument();
  });
});

describe('PartsLocationTooltip', () => {
  it('renders nothing when parts is empty', () => {
    const { container } = render(
      <PartsLocationTooltip parts={[]} objectNumber="2024.1" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a row per part with location path', () => {
    const parts = [
      { ...makePart({ part_id: 'p1' }), part_number: '1', name: 'Base' } as any,
      { ...makePart({ part_id: 'p2' }), part_number: '2', name: 'Lid' } as any,
    ];
    render(<PartsLocationTooltip parts={parts} objectNumber="2024.1" />);
    expect(screen.getByText('Base')).toBeInTheDocument();
    expect(screen.getByText('Lid')).toBeInTheDocument();
    // Both rows should show the same path
    expect(screen.getAllByText('Main > Gallery A')).toHaveLength(2);
  });

  it('falls back to "objectNumber.partNumber" when name is missing', () => {
    const parts = [
      { ...makePart({ part_id: 'p1' }), part_number: '1', name: null } as any,
    ];
    render(<PartsLocationTooltip parts={parts} objectNumber="2024.7" />);
    expect(screen.getByText('2024.7.1')).toBeInTheDocument();
  });

  it('appends "(Display)" when part is on display', () => {
    const parts = [
      {
        ...makePart({
          part_id: 'p1',
          current_location_on_display: true,
        }),
        part_number: '1',
        name: 'Frame',
      } as any,
    ];
    render(<PartsLocationTooltip parts={parts} objectNumber="2024.1" />);
    expect(screen.getByText(/\(Display\)/)).toBeInTheDocument();
  });

  it('renders "No location" when location is not set', () => {
    const parts = [
      {
        part_id: 'p1',
        current_location_id: null,
        current_location_name: null,
        current_location_path: null,
        current_location_on_display: false,
        part_number: '1',
        name: 'Frame',
      } as any,
    ];
    render(<PartsLocationTooltip parts={parts} objectNumber="2024.1" />);
    expect(screen.getByText('No location')).toBeInTheDocument();
  });
});
