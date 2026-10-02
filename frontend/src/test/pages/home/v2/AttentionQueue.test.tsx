import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AttentionQueue } from '../../../../pages/home/v2/components/AttentionQueue';
import type { AttentionItem } from '../../../../pages/home/v2/types';

function makeItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: 'a-1',
    type: 'incident',
    severity: 'urgent',
    refNumber: 'INC-001',
    title: 'A worrying incident',
    context: 'Filed 2 hours ago',
    href: '/organizations/o/collections/incidents/a-1',
    ...overrides,
  };
}

function renderAtt(items: AttentionItem[]) {
  return render(
    <MemoryRouter>
      <AttentionQueue items={items} />
    </MemoryRouter>,
  );
}

describe('AttentionQueue', () => {
  it('shows an empty-state message when there are no items', () => {
    renderAtt([]);
    expect(
      screen.getByText('Nothing needs attention right now.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'For your attention' }),
    ).not.toBeInTheDocument();
  });

  it('renders the heading and singular item count for a single item', () => {
    renderAtt([makeItem()]);
    expect(
      screen.getByRole('heading', { name: 'For your attention' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 item')).toBeInTheDocument();
  });

  it('uses plural item count for multiple items', () => {
    renderAtt([
      makeItem({ id: 'a-1', refNumber: 'INC-001' }),
      makeItem({ id: 'a-2', refNumber: 'INC-002', title: 'Another' }),
      makeItem({ id: 'a-3', refNumber: 'INC-003', title: 'Third' }),
    ]);
    expect(screen.getByText('3 items')).toBeInTheDocument();
  });

  it('renders a row per item with title, ref, and context', () => {
    renderAtt([
      makeItem({ id: 'a-1', refNumber: 'INC-001', title: 'First' }),
      makeItem({ id: 'a-2', refNumber: 'INC-002', title: 'Second', context: 'Other context' }),
    ]);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText('INC-001')).toBeInTheDocument();
    expect(screen.getByText('INC-002')).toBeInTheDocument();
    expect(screen.getByText('Other context')).toBeInTheDocument();
  });
});
