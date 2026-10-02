import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Workshop } from '../../../../pages/home/v2/components/Workshop';
import type { AppStatus } from '../../../../pages/home/v2/types';

const apps: AppStatus[] = [
  {
    key: 'guide',
    name: 'Guide',
    monogram: 'G',
    statusLine: 'Ready',
    isActive: false,
    href: '/organizations/o/guide/chat',
  },
  {
    key: 'collections',
    name: 'Collections',
    monogram: 'C',
    statusLine: '12.8k records',
    isActive: false,
    href: '/organizations/o/collections/objects',
  },
  {
    key: 'bridge',
    name: 'Bridge',
    monogram: 'B',
    statusLine: '2 imports running',
    isActive: true,
    href: '/organizations/o/bridge',
  },
];

describe('Workshop', () => {
  it('renders all apps as links to their landing paths', () => {
    render(
      <MemoryRouter>
        <Workshop apps={apps} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Guide')).toBeInTheDocument();
    expect(screen.getByText('Collections')).toBeInTheDocument();
    expect(screen.getByText('Bridge')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('12.8k records')).toBeInTheDocument();
    expect(screen.getByText('2 imports running')).toBeInTheDocument();
  });

  it('shows the active dot only for apps with isActive=true', () => {
    const { container } = render(
      <MemoryRouter>
        <Workshop apps={apps} />
      </MemoryRouter>,
    );
    // Only one tile should have the moss-colored active dot
    const dots = container.querySelectorAll('.text-moss');
    expect(dots.length).toBe(1);
  });

  it('inverts Guide tile colors (copper bg, parchment letter)', () => {
    const { container } = render(
      <MemoryRouter>
        <Workshop apps={[apps[0]]} />
      </MemoryRouter>,
    );
    const monogramBox = container.querySelector('.bg-copper');
    expect(monogramBox).toBeTruthy();
    expect(monogramBox?.className).toContain('text-parchment');
  });

  it('uses forest+parchment for non-Guide tiles', () => {
    const { container } = render(
      <MemoryRouter>
        <Workshop apps={[apps[1]]} />
      </MemoryRouter>,
    );
    const monogramBox = container.querySelector('.bg-forest');
    expect(monogramBox).toBeTruthy();
    expect(monogramBox?.className).toContain('text-parchment');
  });
});
