import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Breadcrumbs } from '../../../pages/discover/components/Breadcrumbs';
import { checkA11y } from '../../a11y';

describe('Breadcrumbs (WAI-ARIA breadcrumb pattern)', () => {
  const items = [
    { label: 'Home', to: '/c/museum' },
    { label: 'Search results for “vase”', to: '/c/museum?q=vase' },
    { label: 'Blue vase' },
  ];

  it('renders a labelled nav with an ordered list and the current page marked', () => {
    render(
      <MemoryRouter>
        <Breadcrumbs items={items} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const list = within(nav).getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);

    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/c/museum');
    expect(within(nav).getByRole('link', { name: 'Search results for “vase”' })).toHaveAttribute(
      'href',
      '/c/museum?q=vase',
    );
    const current = within(nav).getByText('Blue vase');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByRole('link', { name: 'Blue vase' })).toBeNull();
  });

  it('keeps the legacy content-page props working', () => {
    render(
      <MemoryRouter>
        <Breadcrumbs
          orgSlug="museum"
          ancestors={[{ page_id: 'p1', slug: 'about', title: 'About' } as never]}
          currentTitle="History"
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/c/museum/pages/about');
    expect(screen.getByText('History')).toHaveAttribute('aria-current', 'page');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <Breadcrumbs items={items} />
      </MemoryRouter>,
    );
    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });
});
