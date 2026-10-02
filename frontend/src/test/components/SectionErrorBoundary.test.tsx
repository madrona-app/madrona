import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SectionErrorBoundary } from '../../components/SectionErrorBoundary';

function ThrowError({ shouldThrow, message = 'Boom' }: { shouldThrow: boolean; message?: string }) {
  if (shouldThrow) throw new Error(message);
  return <div>Healthy content</div>;
}

describe('SectionErrorBoundary', () => {
  const originalError = console.error;

  beforeEach(() => {
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalError;
  });

  it('renders children when no error occurs', () => {
    render(
      <SectionErrorBoundary>
        <ThrowError shouldThrow={false} />
      </SectionErrorBoundary>,
    );
    expect(screen.getByText('Healthy content')).toBeInTheDocument();
  });

  it('renders the default fallback UI on error', () => {
    render(
      <SectionErrorBoundary>
        <ThrowError shouldThrow />
      </SectionErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/This section encountered an error/)).toBeInTheDocument();
    expect(screen.queryByText('Healthy content')).not.toBeInTheDocument();
  });

  it('uses sectionName in the headline when provided', () => {
    render(
      <SectionErrorBoundary sectionName="Object Details">
        <ThrowError shouldThrow />
      </SectionErrorBoundary>,
    );
    expect(screen.getByText('Error loading Object Details')).toBeInTheDocument();
  });

  it('renders a custom fallback when provided', () => {
    render(
      <SectionErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowError shouldThrow />
      </SectionErrorBoundary>,
    );
    expect(screen.getByText('Custom fallback')).toBeInTheDocument();
    expect(screen.queryByText('Try again')).not.toBeInTheDocument();
  });

  it('invokes onError callback with error and errorInfo', () => {
    const onError = vi.fn();
    render(
      <SectionErrorBoundary onError={onError}>
        <ThrowError shouldThrow message="my error" />
      </SectionErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    const [errArg, infoArg] = onError.mock.calls[0];
    expect((errArg as Error).message).toBe('my error');
    expect(infoArg).toBeTruthy();
  });

  it('clicking "Try again" clears the error and re-renders children', () => {
    let throwOnNextRender = true;
    function MaybeThrow() {
      if (throwOnNextRender) throw new Error('first render');
      return <div>Recovered</div>;
    }

    render(
      <SectionErrorBoundary>
        <MaybeThrow />
      </SectionErrorBoundary>,
    );

    // Error is shown
    expect(screen.getByText('Try again')).toBeInTheDocument();

    // Stop throwing and click retry
    throwOnNextRender = false;
    fireEvent.click(screen.getByText('Try again'));

    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });

  it('invokes onReset when Try again is clicked', () => {
    const onReset = vi.fn();
    render(
      <SectionErrorBoundary onReset={onReset}>
        <ThrowError shouldThrow />
      </SectionErrorBoundary>,
    );
    fireEvent.click(screen.getByText('Try again'));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('logs the error to the logger via console.error', () => {
    render(
      <SectionErrorBoundary sectionName="Foo">
        <ThrowError shouldThrow />
      </SectionErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalled();
  });
  describe('stale chunk after a deploy', () => {
    const reload = vi.fn();

    beforeEach(() => {
      sessionStorage.clear();
      reload.mockClear();
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...window.location, reload },
      });
    });

    afterEach(() => {
      sessionStorage.clear();
    });

    it.each([
      'Failed to fetch dynamically imported module: /assets/index-abc123.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
    ])('reloads rather than showing an error for: %s', (message) => {
      render(
        <SectionErrorBoundary>
          <ThrowError shouldThrow message={message} />
        </SectionErrorBoundary>,
      );
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does not reload for an ordinary error', () => {
      render(
        <SectionErrorBoundary>
          <ThrowError shouldThrow message="Cannot read properties of undefined" />
        </SectionErrorBoundary>,
      );
      expect(reload).not.toHaveBeenCalled();
    });

    it('does not reload twice inside the cooldown', () => {
      const boom = 'Failed to fetch dynamically imported module: /assets/x.js';
      render(
        <SectionErrorBoundary>
          <ThrowError shouldThrow message={boom} />
        </SectionErrorBoundary>,
      );
      render(
        <SectionErrorBoundary>
          <ThrowError shouldThrow message={boom} />
        </SectionErrorBoundary>,
      );
      // Second one must fall through to the error UI, not spin.
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
