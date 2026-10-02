import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TodaysPulse } from '../../../../pages/home/v2/components/TodaysPulse';
import type { PulseData } from '../../../../pages/home/v2/types';

function renderPulse(data: PulseData) {
  return render(
    <MemoryRouter>
      <TodaysPulse pulseData={data} />
    </MemoryRouter>,
  );
}

describe('TodaysPulse', () => {
  it('renders the heading', () => {
    renderPulse({ stats: [], recentObject: null });
    expect(
      screen.getByRole('heading', { name: "Today's pulse" }),
    ).toBeInTheDocument();
  });

  it('renders each stat with value and label', () => {
    renderPulse({
      stats: [
        { value: 12, label: 'Loans active' },
        { value: 7, label: 'Open conditions' },
      ],
      recentObject: null,
    });
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Loans active')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('Open conditions')).toBeInTheDocument();
  });

  it('renders a link to the most recently updated object', () => {
    renderPulse({
      stats: [],
      recentObject: {
        name: 'Starry Night',
        href: '/organizations/o/collections/objects/sn-1',
        updatedAgo: '2 hours ago',
      },
    });
    const link = screen.getByRole('link', { name: /Starry Night/ });
    expect(link).toHaveAttribute(
      'href',
      '/organizations/o/collections/objects/sn-1',
    );
    expect(screen.getByText('Most recently updated')).toBeInTheDocument();
    expect(screen.getByText(/updated 2 hours ago/)).toBeInTheDocument();
  });

  it('omits the recent-object panel when none is provided', () => {
    renderPulse({ stats: [], recentObject: null });
    expect(screen.queryByText('Most recently updated')).not.toBeInTheDocument();
  });
});
