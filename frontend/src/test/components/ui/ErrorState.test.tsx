import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WifiOff } from 'lucide-react';
import { ErrorState } from '../../../components/ui/ErrorState';

describe('ErrorState', () => {
  describe('default variant', () => {
    it('falls back to a default title', () => {
      render(<ErrorState />);
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('renders a custom title and description', () => {
      render(<ErrorState title="Could not load plans" description="The server did not respond." />);
      expect(screen.getByText('Could not load plans')).toBeInTheDocument();
      expect(screen.getByText('The server did not respond.')).toBeInTheDocument();
    });

    it('exposes role="alert" so assistive tech announces the failure', () => {
      render(<ErrorState title="Boom" />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('uses an h3 heading for the default variant title', () => {
      render(<ErrorState title="Boom" />);
      expect(screen.getByRole('heading', { level: 3, name: 'Boom' })).toBeInTheDocument();
    });

    it('renders a retry button only when onRetry is provided, and calls it', () => {
      const onRetry = vi.fn();
      const { rerender } = render(<ErrorState title="Boom" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();

      rerender(<ErrorState title="Boom" onRetry={onRetry} />);
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('supports a custom retry label', () => {
      render(<ErrorState onRetry={vi.fn()} retryLabel="Reload" />);
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    });

    it('renders a custom icon', () => {
      const { container } = render(<ErrorState icon={WifiOff} title="Offline" />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('compact variant', () => {
    it('renders title and description without an h3 heading', () => {
      render(<ErrorState title="Compact error" description="Details here" variant="compact" />);
      expect(screen.getByText('Compact error')).toBeInTheDocument();
      expect(screen.getByText('Details here')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    });

    it('calls onRetry in compact variant', () => {
      const onRetry = vi.fn();
      render(<ErrorState title="Compact" onRetry={onRetry} variant="compact" />);
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('inline variant', () => {
    it('renders the title and a working retry in a single row', () => {
      const onRetry = vi.fn();
      render(<ErrorState title="Inline error" onRetry={onRetry} variant="inline" />);
      expect(screen.getByText('Inline error')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('omits the retry affordance when onRetry is not given', () => {
      render(<ErrorState title="Inline" variant="inline" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});
