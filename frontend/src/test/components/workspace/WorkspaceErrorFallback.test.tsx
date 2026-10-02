import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { WorkspaceErrorFallback } from '../../../components/workspace/WorkspaceErrorFallback';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function renderFallback(props: Partial<React.ComponentProps<typeof WorkspaceErrorFallback>> = {}) {
  return render(
    <MemoryRouter initialEntries={['/organizations/org-1/something']}>
      <Routes>
        <Route
          path="/organizations/:orgId/*"
          element={<WorkspaceErrorFallback {...props} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WorkspaceErrorFallback', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  it('renders the standard heading and copy', () => {
    renderFallback();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText(/We encountered an error loading this page/),
    ).toBeInTheDocument();
  });

  it('renders the default back label', () => {
    renderFallback();
    expect(screen.getByText('Go Back')).toBeInTheDocument();
  });

  it('uses custom backLabel', () => {
    renderFallback({ backLabel: 'Back to List' });
    expect(screen.getByText('Back to List')).toBeInTheDocument();
  });

  it('clicking back without backUrl calls navigate(-1)', () => {
    renderFallback();
    fireEvent.click(screen.getByText('Go Back'));
    expect(navigateMock).toHaveBeenCalledWith(-1);
  });

  it('clicking back with backUrl navigates to that URL', () => {
    renderFallback({ backUrl: '/somewhere' });
    fireEvent.click(screen.getByText('Go Back'));
    expect(navigateMock).toHaveBeenCalledWith('/somewhere');
  });

  it('Try Again calls resetError when provided', () => {
    const resetError = vi.fn();
    renderFallback({ resetError });
    fireEvent.click(screen.getByText('Try Again'));
    expect(resetError).toHaveBeenCalled();
  });

  it('Home navigates to the org root when orgId is in the URL', () => {
    renderFallback();
    fireEvent.click(screen.getByText('Home'));
    expect(navigateMock).toHaveBeenCalledWith('/organizations/org-1');
  });

  it('renders error details in dev mode if error is provided', () => {
    const error = new Error('detailed problem');
    renderFallback({ error });
    // Details element renders as collapsed but the message is in DOM
    expect(screen.getByText(/detailed problem/)).toBeInTheDocument();
  });

  it('uses test-id for the error boundary container', () => {
    renderFallback();
    expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
  });
});
