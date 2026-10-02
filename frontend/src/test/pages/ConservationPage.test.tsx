import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ConservationPage from '../../pages/collections/ConservationPage';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getConservationTreatments: vi.fn(),
}));

const mockGetConservationTreatments = vi.mocked(api.getConservationTreatments);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/conservation`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/conservation"
            element={<ConservationPage />}
          />
          <Route
            path="/organizations/:orgId/collections/conservation/create"
            element={<div>Create Treatment</div>}
          />
          <Route
            path="/organizations/:orgId/collections/conservation/:id"
            element={<div>Treatment Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ConservationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading', async () => {
    mockGetConservationTreatments.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Conservation' })).toBeInTheDocument();
    });
  });

  it('shows empty state when no treatments', async () => {
    mockGetConservationTreatments.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no treatments yet/i)).toBeInTheDocument();
    });
  });

  it('renders a treatment row', async () => {
    mockGetConservationTreatments.mockResolvedValue({
      items: [
        {
          treatment_id: 't-1',
          treatment_number: 'CT-2024-001',
          treatment_type: 'cleaning',
          status: 'in_progress',
          conservator_name: 'Lee Conservator',
          start_date: '2024-04-01',
          estimated_cost: 1500,
        },
      ],
      total: 1,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('CT-2024-001')).toBeInTheDocument();
    });
  });

  it('shows error state on failure', async () => {
    mockGetConservationTreatments.mockRejectedValue(new Error('Forbidden'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading conservation treatments/i)).toBeInTheDocument();
    });
  });

  it('passes status filter to query when changed', async () => {
    mockGetConservationTreatments.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Conservation' })).toBeInTheDocument();
    });

    const statusSelect = screen.getByDisplayValue('All Statuses');
    fireEvent.change(statusSelect, { target: { value: 'in_progress' } });

    await waitFor(() => {
      expect(mockGetConservationTreatments).toHaveBeenLastCalledWith(
        'org-1',
        expect.objectContaining({ status: 'in_progress' })
      );
    });
  });
});
