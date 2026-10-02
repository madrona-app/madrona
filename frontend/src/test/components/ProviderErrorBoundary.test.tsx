import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProviderErrorBoundary } from '../../components/ProviderErrorBoundary';

function ThrowError({ error }: { error: Error }) {
  throw error;
}

describe('ProviderErrorBoundary', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('renders children when no error', () => {
    render(
      <ProviderErrorBoundary tier="auth">
        <div>Hello World</div>
      </ProviderErrorBoundary>
    );
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  describe('auth tier', () => {
    it('shows "Authentication Error" title on error', () => {
      render(
        <ProviderErrorBoundary tier="auth">
          <ThrowError error={new Error('auth failed')} />
        </ProviderErrorBoundary>
      );
      expect(screen.getByText('Authentication Error')).toBeInTheDocument();
    });

    it('shows "Reload Page" button', () => {
      render(
        <ProviderErrorBoundary tier="auth">
          <ThrowError error={new Error('auth failed')} />
        </ProviderErrorBoundary>
      );
      expect(screen.getByText('Reload Page')).toBeInTheDocument();
    });

    it('does NOT show "Continue in Limited Mode" button', () => {
      render(
        <ProviderErrorBoundary tier="auth">
          <ThrowError error={new Error('auth failed')} />
        </ProviderErrorBoundary>
      );
      expect(screen.queryByText('Continue in Limited Mode')).not.toBeInTheDocument();
    });
  });

  describe('services tier', () => {
    it('shows "Some Features Unavailable" title on error', () => {
      render(
        <ProviderErrorBoundary tier="services">
          <ThrowError error={new Error('service failed')} />
        </ProviderErrorBoundary>
      );
      expect(screen.getByText('Some Features Unavailable')).toBeInTheDocument();
    });

    it('shows both "Reload Page" and "Continue in Limited Mode" buttons', () => {
      render(
        <ProviderErrorBoundary tier="services">
          <ThrowError error={new Error('service failed')} />
        </ProviderErrorBoundary>
      );
      expect(screen.getByText('Reload Page')).toBeInTheDocument();
      expect(screen.getByText('Continue in Limited Mode')).toBeInTheDocument();
    });

    it('clicking "Continue in Limited Mode" re-renders children', () => {
      let shouldThrow = true;

      function MaybeThrow() {
        if (shouldThrow) {
          throw new Error('service failed');
        }
        return <div>Recovered</div>;
      }

      render(
        <ProviderErrorBoundary tier="services">
          <MaybeThrow />
        </ProviderErrorBoundary>
      );

      expect(screen.getByText('Some Features Unavailable')).toBeInTheDocument();

      // Stop throwing before dismissing
      shouldThrow = false;

      fireEvent.click(screen.getByText('Continue in Limited Mode'));

      expect(screen.getByText('Recovered')).toBeInTheDocument();
      expect(screen.queryByText('Some Features Unavailable')).not.toBeInTheDocument();
    });
  });

  it('calls onError callback when error is caught', () => {
    const onError = vi.fn();

    render(
      <ProviderErrorBoundary tier="auth" onError={onError}>
        <ThrowError error={new Error('test error')} />
      </ProviderErrorBoundary>
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'test error' }),
      expect.objectContaining({ componentStack: expect.any(String) })
    );
  });

  it('shows error details toggle in dev mode', () => {
    // import.meta.env.DEV is true in vitest by default
    render(
      <ProviderErrorBoundary tier="services">
        <ThrowError error={new Error('detailed error message')} />
      </ProviderErrorBoundary>
    );

    const toggleButton = screen.getByText('Show Error Details');
    expect(toggleButton).toBeInTheDocument();

    fireEvent.click(toggleButton);

    expect(screen.getByText(/detailed error message/)).toBeInTheDocument();
    expect(screen.getByText('Hide Error Details')).toBeInTheDocument();
  });
});
