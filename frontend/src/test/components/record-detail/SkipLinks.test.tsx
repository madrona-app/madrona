import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkipLinks } from '../../../components/record-detail/SkipLinks';

describe('SkipLinks', () => {
  it('renders default skip links', () => {
    render(<SkipLinks />);
    expect(screen.getByText('Skip to main content')).toBeInTheDocument();
    expect(screen.getByText('Skip to section navigation')).toBeInTheDocument();
    expect(screen.getByText('Skip to quick actions')).toBeInTheDocument();
  });

  it('uses an aria-label of "Skip links" on the nav', () => {
    render(<SkipLinks />);
    expect(screen.getByRole('navigation', { name: 'Skip links' })).toBeInTheDocument();
  });

  it('renders default links with correct hrefs', () => {
    render(<SkipLinks />);
    const main = screen.getByText('Skip to main content');
    expect(main.closest('a')).toHaveAttribute('href', '#main-content');
    const nav = screen.getByText('Skip to section navigation');
    expect(nav.closest('a')).toHaveAttribute('href', '#section-nav');
  });

  it('renders custom links when provided', () => {
    render(
      <SkipLinks
        links={[
          { href: '#alpha', label: 'Skip to alpha' },
          { href: '#beta', label: 'Skip to beta' },
        ]}
      />
    );
    expect(screen.getByText('Skip to alpha')).toBeInTheDocument();
    expect(screen.getByText('Skip to beta')).toBeInTheDocument();
    // Default links should not be rendered
    expect(screen.queryByText('Skip to main content')).not.toBeInTheDocument();
  });

  it('renders zero links when an empty array is provided', () => {
    const { container } = render(<SkipLinks links={[]} />);
    // The nav still renders, but there are no anchors inside
    expect(container.querySelectorAll('a').length).toBe(0);
  });

  it('applies custom className to the nav element', () => {
    render(<SkipLinks className="custom-class" />);
    const nav = screen.getByRole('navigation', { name: 'Skip links' });
    expect(nav.className).toContain('custom-class');
    expect(nav.className).toContain('skip-links');
  });
});
