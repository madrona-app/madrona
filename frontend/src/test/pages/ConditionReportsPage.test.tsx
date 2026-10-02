import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ConditionReportsPage from '../../pages/collections/ConditionReportsPage';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getConditionReports: vi.fn(),
}));

const mockGetConditionReports = vi.mocked(api.getConditionReports);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/condition-reports`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/condition-reports"
            element={<ConditionReportsPage />}
          />
          <Route
            path="/organizations/:orgId/collections/condition-reports/create"
            element={<div>Create Report</div>}
          />
          <Route
            path="/organizations/:orgId/collections/condition-reports/:id"
            element={<div>Report Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ConditionReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading', async () => {
    mockGetConditionReports.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Condition Reports' })).toBeInTheDocument();
    });
  });

  it('shows empty state when no reports', async () => {
    mockGetConditionReports.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No condition reports yet.' })).toBeInTheDocument();
    });
  });

  it('renders condition report row', async () => {
    mockGetConditionReports.mockResolvedValue({
      items: [
        {
          report_id: 'r-1',
          report_number: 'CR-2024-001',
          report_type: 'intake',
          status: 'completed',
          report_date: '2024-03-12',
          condition_grade: 'good',
          examiner_name: 'Pat Examiner',
        },
      ],
      total: 1,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('CR-2024-001')).toBeInTheDocument();
    });
    expect(screen.getByText('Pat Examiner')).toBeInTheDocument();
  });

  it('shows error state on failure', async () => {
    mockGetConditionReports.mockRejectedValue(new Error('Bad gateway'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading condition reports/i)).toBeInTheDocument();
    });
  });

  it('passes type filter to query when changed', async () => {
    mockGetConditionReports.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Condition Reports' })).toBeInTheDocument();
    });

    const typeSelect = screen.getByDisplayValue('All Types');
    fireEvent.change(typeSelect, { target: { value: 'periodic' } });

    await waitFor(() => {
      expect(mockGetConditionReports).toHaveBeenLastCalledWith(
        'org-1',
        expect.objectContaining({ report_type: 'periodic' })
      );
    });
  });
});
