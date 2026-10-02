import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Folder } from 'lucide-react';
import { EmptyState } from '../../../components/ui/EmptyState';

describe('EmptyState', () => {
  describe('default variant', () => {
    it('renders the title', () => {
      render(<EmptyState title="No items yet" />);
      expect(screen.getByText('No items yet')).toBeInTheDocument();
    });

    it('renders the description when provided', () => {
      render(
        <EmptyState
          title="No items"
          description="Add your first item to get started."
        />,
      );
      expect(screen.getByText('Add your first item to get started.')).toBeInTheDocument();
    });

    it('does not render description element when not provided', () => {
      render(<EmptyState title="Empty" />);
      // No paragraph for description
      expect(screen.queryByText(/get started/)).not.toBeInTheDocument();
    });

    it('renders an action button and triggers onClick', () => {
      const onClick = vi.fn();
      render(
        <EmptyState
          title="Empty"
          action={{ label: 'Create item', onClick }}
        />,
      );
      const btn = screen.getByRole('button', { name: /Create item/ });
      fireEvent.click(btn);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders the icon when provided', () => {
      const { container } = render(
        <EmptyState icon={Folder} title="Empty" />,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('uses h3 heading for default variant title', () => {
      render(<EmptyState title="Empty" />);
      expect(screen.getByRole('heading', { level: 3, name: 'Empty' })).toBeInTheDocument();
    });
  });

  describe('compact variant', () => {
    it('renders title without h3 heading', () => {
      render(<EmptyState title="Compact empty" variant="compact" />);
      expect(screen.getByText('Compact empty')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    });

    it('does not render description even when provided in compact', () => {
      render(
        <EmptyState
          title="Compact"
          description="Should not appear"
          variant="compact"
        />,
      );
      expect(screen.queryByText('Should not appear')).not.toBeInTheDocument();
    });

    it('renders action button in compact variant', () => {
      const onClick = vi.fn();
      render(
        <EmptyState
          title="Compact"
          action={{ label: 'Add', onClick }}
          variant="compact"
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Add/ }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('inline variant', () => {
    it('renders title in inline variant', () => {
      render(<EmptyState title="Inline empty" variant="inline" />);
      expect(screen.getByText('Inline empty')).toBeInTheDocument();
    });

    it('renders icon when provided in inline variant', () => {
      const { container } = render(
        <EmptyState icon={Folder} title="Inline" variant="inline" />,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders action button in inline variant and triggers onClick', () => {
      const onClick = vi.fn();
      render(
        <EmptyState
          title="Inline"
          action={{ label: 'Add row', onClick }}
          variant="inline"
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Add row/ }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });
});
