import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  withErrorBoundary,
  WorkspaceErrorBoundary,
} from '../../../components/workspace/withErrorBoundary';

vi.mock('../../../lib/logger', () => ({
  logger: { error: vi.fn() },
}));

function ThrowingComponent() {
  throw new Error('boom');
}

function NormalComponent({ name }: { name: string }) {
  return <div>Hello {name}</div>;
}

describe('withErrorBoundary', () => {
  it('renders the wrapped component when no error occurs', () => {
    const Wrapped = withErrorBoundary(NormalComponent);
    render(
      <MemoryRouter>
        <Wrapped name="World" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('shows the workspace fallback when an error is thrown', () => {
    const Wrapped = withErrorBoundary(ThrowingComponent);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <MemoryRouter>
        <Wrapped />
      </MemoryRouter>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    errSpy.mockRestore();
  });

  it('uses custom backLabel when provided', () => {
    const Wrapped = withErrorBoundary(ThrowingComponent, { backLabel: 'Back to Stuff' });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <MemoryRouter>
        <Wrapped />
      </MemoryRouter>,
    );
    expect(screen.getByText('Back to Stuff')).toBeInTheDocument();
    errSpy.mockRestore();
  });

  it('uses custom fallback when provided', () => {
    const Wrapped = withErrorBoundary(ThrowingComponent, {
      fallback: <div data-testid="custom-fallback">Oh no</div>,
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <MemoryRouter>
        <Wrapped />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
    errSpy.mockRestore();
  });

  it('preserves the wrapped component displayName', () => {
    function Foo() {
      return null;
    }
    const Wrapped = withErrorBoundary(Foo);
    expect(Wrapped.displayName).toBe('withErrorBoundary(Foo)');
  });

  it('forwards props to the wrapped component', () => {
    const Wrapped = withErrorBoundary(NormalComponent);
    render(
      <MemoryRouter>
        <Wrapped name="Madrona" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Hello Madrona')).toBeInTheDocument();
  });
});

describe('WorkspaceErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <MemoryRouter>
        <WorkspaceErrorBoundary>
          <div>safe</div>
        </WorkspaceErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText('safe')).toBeInTheDocument();
  });

  it('shows fallback on error', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <MemoryRouter>
        <WorkspaceErrorBoundary>
          <ThrowingComponent />
        </WorkspaceErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    errSpy.mockRestore();
  });

  it('passes backLabel through', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <MemoryRouter>
        <WorkspaceErrorBoundary backLabel="Return to List">
          <ThrowingComponent />
        </WorkspaceErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText('Return to List')).toBeInTheDocument();
    errSpy.mockRestore();
  });
});
