import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DeaccessionsPage from '../../pages/collections/DeaccessionsPage';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getDeaccessions: vi.fn(),
}));

const mockGetDeaccessions = vi.mocked(api.getDeaccessions);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/deaccessions`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/deaccessions"
            element={<DeaccessionsPage />}
          />
          <Route
            path="/organizations/:orgId/collections/deaccessions/create"
            element={<div>Create Deaccession</div>}
          />
          <Route
            path="/organizations/:orgId/collections/deaccessions/:id"
            element={<div>Deaccession Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DeaccessionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading', async () => {
    mockGetDeaccessions.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Deaccessioning' })).toBeInTheDocument();
    });
  });

  it('shows empty state when no deaccessions', async () => {
    mockGetDeaccessions.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No deaccessions yet.' })).toBeInTheDocument();
    });
  });

  it('renders deaccession row with key fields', async () => {
    mockGetDeaccessions.mockResolvedValue({
      items: [
        {
          deaccession_id: 'd-1',
          deaccession_number: 'DA-2024-001',
          status: 'proposed',
          reason: 'duplicate',
          disposal_method: 'sale',
          appraised_value: 5000,
          proposal_date: '2024-01-15',
        },
      ],
      total: 1,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('DA-2024-001')).toBeInTheDocument();
    });
    // "Duplicate" exists as both <option> and row text; getAllByText
    expect(screen.getAllByText('Duplicate').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Sale')).toBeInTheDocument();
  });

  it('shows error state on failure', async () => {
    mockGetDeaccessions.mockRejectedValue(new Error('Forbidden'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading deaccessions/i)).toBeInTheDocument();
    });
  });

  it('updates query when status filter changes', async () => {
    mockGetDeaccessions.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Deaccessioning' })).toBeInTheDocument();
    });

    const statusSelect = screen.getByDisplayValue('All Statuses');
    fireEvent.change(statusSelect, { target: { value: 'pending_board' } });

    await waitFor(() => {
      expect(mockGetDeaccessions).toHaveBeenLastCalledWith(
        'org-1',
        expect.objectContaining({ status: 'pending_board' })
      );
    });
  });

  it('always shows the warning banner about review process', async () => {
    mockGetDeaccessions.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Deaccession Review Process')).toBeInTheDocument();
    });
  });

  it('renders header create button link', async () => {
    mockGetDeaccessions.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /new deaccession/i })).toBeInTheDocument();
    });
  });
});
