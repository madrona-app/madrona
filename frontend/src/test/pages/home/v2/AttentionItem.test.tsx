import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AttentionItemRow } from '../../../../pages/home/v2/components/AttentionItem';
import type { AttentionItem } from '../../../../pages/home/v2/types';

function renderRow(item: AttentionItem) {
  return render(
    <MemoryRouter>
      <AttentionItemRow item={item} />
    </MemoryRouter>,
  );
}

describe('AttentionItemRow', () => {
  const base: AttentionItem = {
    id: 'item-1',
    type: 'incident',
    severity: 'urgent',
    refNumber: 'INC-2026-003',
    title: 'Climate excursion in Gallery 4',
    context: 'Reported 38 minutes ago by N. Vasquez',
    href: '/organizations/o/collections/incidents/item-1',
  };

  it('renders the badge label, ref number, title, and context', () => {
    renderRow(base);
    expect(screen.getByText('Incident')).toBeInTheDocument();
    expect(screen.getByText('INC-2026-003')).toBeInTheDocument();
    expect(screen.getByText('Climate excursion in Gallery 4')).toBeInTheDocument();
    expect(
      screen.getByText('Reported 38 minutes ago by N. Vasquez'),
    ).toBeInTheDocument();
  });

  it('renders as a Link when href is set', () => {
    renderRow(base);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute(
      'href',
      '/organizations/o/collections/incidents/item-1',
    );
  });

  it('renders as a non-interactive div when href is missing', () => {
    renderRow({ ...base, href: '' });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('INC-2026-003')).toBeInTheDocument();
  });

  it('renders as a non-interactive div when href is just "#"', () => {
    renderRow({ ...base, href: '#' });
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('uses the right badge label per type', () => {
    const { rerender } = renderRow({ ...base, type: 'loan' });
    expect(screen.getByText('Loan')).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <AttentionItemRow item={{ ...base, type: 'accession' }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Accession')).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <AttentionItemRow item={{ ...base, type: 'condition_report' }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Condition')).toBeInTheDocument();
  });
});
