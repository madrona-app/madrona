import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RelationshipNavigationStrip } from '../../components/collections/RelationshipNavigationStrip';

const DEFAULT_COUNTS = {
  contacts: 0,
  authorities: 0,
  relationships: 0,
  citations: 0,
  rights: 0,
  movements: 0,
  procedures: 0,
};

describe('RelationshipNavigationStrip', () => {
  it('renders one button per section', () => {
    render(
      <RelationshipNavigationStrip
        counts={DEFAULT_COUNTS}
        onNavigate={vi.fn()}
      />
    );
    // Seven defined section chips
    expect(screen.getAllByRole('button')).toHaveLength(7);
    expect(screen.getByRole('button', { name: /People/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Authorities/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Procedures/i })).toBeInTheDocument();
  });

  it('does not render "Located" indicator when hasLocation is false', () => {
    render(
      <RelationshipNavigationStrip
        counts={DEFAULT_COUNTS}
        onNavigate={vi.fn()}
      />
    );
    expect(screen.queryByText('Located')).not.toBeInTheDocument();
  });

  it('renders "Located" status chip when hasLocation is true', () => {
    render(
      <RelationshipNavigationStrip
        counts={DEFAULT_COUNTS}
        onNavigate={vi.fn()}
        hasLocation
      />
    );
    expect(screen.getByText('Located')).toBeInTheDocument();
  });

  it('calls onNavigate with the section id when a chip is clicked', () => {
    const onNavigate = vi.fn();
    render(
      <RelationshipNavigationStrip
        counts={DEFAULT_COUNTS}
        onNavigate={onNavigate}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Citations/i }));
    expect(onNavigate).toHaveBeenCalledWith('citations');
  });

  it('displays a numeric count badge when count > 0', () => {
    render(
      <RelationshipNavigationStrip
        counts={{ ...DEFAULT_COUNTS, contacts: 3, citations: 5 }}
        onNavigate={vi.fn()}
      />
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('omits count badge when count is 0', () => {
    render(
      <RelationshipNavigationStrip
        counts={DEFAULT_COUNTS}
        onNavigate={vi.fn()}
      />
    );
    // No badge number renders for zero counts
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('applies active styling to the current section', () => {
    render(
      <RelationshipNavigationStrip
        counts={DEFAULT_COUNTS}
        onNavigate={vi.fn()}
        activeSection="rights"
      />
    );
    const rightsButton = screen.getByRole('button', { name: /Rights/i });
    expect(rightsButton.className).toContain('bg-bark');
    // Inactive sections should not have bark background
    const peopleButton = screen.getByRole('button', { name: /People/i });
    expect(peopleButton.className).not.toContain('bg-bark ');
  });
});
