import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IncidentReportsPage from '../../pages/collections/IncidentReportsPage';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getIncidentReports: vi.fn(),
}));

const mockGetIncidentReports = vi.mocked(api.getIncidentReports);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/incidents`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/incidents"
            element={<IncidentReportsPage />}
          />
          <Route
            path="/organizations/:orgId/collections/incidents/create"
            element={<div>Create Incident</div>}
          />
          <Route
            path="/organizations/:orgId/collections/incidents/:id"
            element={<div>Incident Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('IncidentReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading', async () => {
    mockGetIncidentReports.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Damage and Loss' })).toBeInTheDocument();
    });
  });

  it('renders an incident report row', async () => {
    mockGetIncidentReports.mockResolvedValue({
      items: [
        {
          report_id: 'inc-1',
          report_number: 'IR-2024-001',
          incident_type: 'damage',
          status: 'submitted',
          incident_date: '2024-04-10',
          incident_description: 'Minor surface scratch',
          severity: 'minor',
          affected_objects: [],
        },
      ],
      total: 1,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('IR-2024-001')).toBeInTheDocument();
    });
  });

  it('shows error state on failure', async () => {
    mockGetIncidentReports.mockRejectedValue(new Error('Server error'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading incident reports/i)).toBeInTheDocument();
    });
  });


  it('renders the incident documentation banner', async () => {
    mockGetIncidentReports.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Incident Documentation')).toBeInTheDocument();
    });
  });

  it('passes status filter to query when changed', async () => {
    mockGetIncidentReports.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Damage and Loss' })).toBeInTheDocument();
    });

    const statusSelect = screen.getByDisplayValue('All Statuses');
    fireEvent.change(statusSelect, { target: { value: 'under_investigation' } });

    await waitFor(() => {
      expect(mockGetIncidentReports).toHaveBeenLastCalledWith(
        'org-1',
        expect.objectContaining({ status: 'under_investigation' })
      );
    });
  });
});
