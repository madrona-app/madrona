import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ActivityThread } from '../../../../pages/home/v2/components/ActivityThread';
import type { ActivityEntry } from '../../../../pages/home/v2/types';

function makeEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 'e-1',
    kind: 'self',
    text: 'You opened OBJ-1',
    href: '/organizations/o/collections/objects/1',
    timestamp: Date.now() - 1000 * 60 * 5,
    ...overrides,
  };
}

function renderThread(entries: ActivityEntry[], viewAllHref: string | null = null) {
  return render(
    <MemoryRouter>
      <ActivityThread entries={entries} viewAllHref={viewAllHref} />
    </MemoryRouter>,
  );
}

describe('ActivityThread', () => {
  it('renders the heading', () => {
    renderThread([]);
    expect(
      screen.getByRole('heading', {
        name: 'A short history of the last few hours',
      }),
    ).toBeInTheDocument();
  });

  it('shows an empty-state message when there are no entries', () => {
    renderThread([]);
    expect(screen.getByText('No recent activity.')).toBeInTheDocument();
  });

  it('does not show the "view all" link when there are no entries', () => {
    renderThread([], '/organizations/o/recent');
    expect(screen.queryByRole('link', { name: 'view all' })).not.toBeInTheDocument();
  });

  it('shows the "view all" link when entries exist and a target is provided', () => {
    renderThread([makeEntry()], '/organizations/o/recent');
    expect(screen.getByRole('link', { name: 'view all' })).toHaveAttribute(
      'href',
      '/organizations/o/recent',
    );
  });

  it('omits the "view all" link when no target is provided', () => {
    renderThread([makeEntry()], null);
    expect(screen.queryByRole('link', { name: 'view all' })).not.toBeInTheDocument();
  });

  it('caps rendering at 8 entries', () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      makeEntry({
        id: `e-${i}`,
        text: `Entry ${i}`,
        timestamp: Date.now() - i * 1000,
      }),
    );
    renderThread(entries);
    // Entries 0..7 are rendered, 8..11 are not.
    expect(screen.getByText('Entry 0')).toBeInTheDocument();
    expect(screen.getByText('Entry 7')).toBeInTheDocument();
    expect(screen.queryByText('Entry 8')).not.toBeInTheDocument();
    expect(screen.queryByText('Entry 11')).not.toBeInTheDocument();
  });
});
