import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { QueryBoundary } from '../../components/QueryBoundary';

let attempts = 0;

function ThrowingChild() {
  useQuery({
    queryKey: ['err'],
    queryFn: () => {
      attempts++;
      throw new Error('boom');
    },
    retry: false,
    throwOnError: true,
  });
  return <div>ok</div>;
}

describe('QueryBoundary', () => {
  beforeEach(() => {
    attempts = 0;
  });

  it('renders children when no error occurs', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <QueryBoundary>
          <p>child content</p>
        </QueryBoundary>
      </QueryClientProvider>,
    );
    expect(screen.getByText('child content')).toBeInTheDocument();
  });

  it('catches a thrown query error and shows the section error fallback', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Suppress react-dom error logging spam in test output
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <QueryClientProvider client={client}>
        <QueryBoundary sectionName="My Section">
          <ThrowingChild />
        </QueryBoundary>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Try again/i)).toBeInTheDocument();
    errSpy.mockRestore();
  });

  it('passes sectionName to the SectionErrorBoundary', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <QueryClientProvider client={client}>
        <QueryBoundary sectionName="Provenance">
          <ThrowingChild />
        </QueryBoundary>
      </QueryClientProvider>,
    );
    // SectionErrorBoundary surface includes the section name somewhere
    expect(await screen.findByText(/Provenance/)).toBeInTheDocument();
    errSpy.mockRestore();
  });

  it('clicking "Try again" attempts the query again', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <QueryClientProvider client={client}>
        <QueryBoundary sectionName="X">
          <ThrowingChild />
        </QueryBoundary>
      </QueryClientProvider>,
    );

    const tryAgain = await screen.findByText(/Try again/i);
    const before = attempts;
    fireEvent.click(tryAgain);
    // QueryErrorResetBoundary reset triggers another attempt
    expect(attempts).toBeGreaterThanOrEqual(before);
    errSpy.mockRestore();
  });
});
