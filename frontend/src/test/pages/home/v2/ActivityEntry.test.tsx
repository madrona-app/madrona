import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ActivityEntryRow } from '../../../../pages/home/v2/components/ActivityEntry';
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

function renderRow(entry: ActivityEntry) {
  return render(
    <MemoryRouter>
      <ActivityEntryRow entry={entry} />
    </MemoryRouter>,
  );
}

describe('ActivityEntryRow', () => {
  it('renders entry text', () => {
    renderRow(makeEntry({ text: 'You opened a thing' }));
    expect(screen.getByText('You opened a thing')).toBeInTheDocument();
  });

  it('wraps the row in a Link when href is provided', () => {
    renderRow(makeEntry({ href: '/organizations/o/path' }));
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/organizations/o/path');
  });

  it('renders without a Link when href is missing', () => {
    renderRow(makeEntry({ href: undefined, text: 'No link entry' }));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('No link entry')).toBeInTheDocument();
  });

  it('renders a relative timestamp', () => {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    renderRow(makeEntry({ timestamp: fiveMinAgo }));
    // formatRelativeTime emits "5 minutes ago" or similar — assert minutes appear
    expect(screen.getByText(/minute/i)).toBeInTheDocument();
  });
});
