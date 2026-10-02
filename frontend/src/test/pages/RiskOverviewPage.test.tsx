import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RiskOverviewPage from '../../pages/collections/RiskOverviewPage';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getConditionReports: vi.fn(),
  getIncidentReports: vi.fn(),
  getConservationTreatments: vi.fn(),
  getEmergencyPlans: vi.fn(),
}));

const mockGetConditionReports = vi.mocked(api.getConditionReports);
const mockGetIncidentReports = vi.mocked(api.getIncidentReports);
const mockGetConservationTreatments = vi.mocked(api.getConservationTreatments);
const mockGetEmergencyPlans = vi.mocked(api.getEmergencyPlans);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgId = 'org-123') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[`/organizations/${orgId}/collections/risk-overview`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/collections/risk-overview"
            element={<RiskOverviewPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RiskOverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConditionReports.mockResolvedValue({
      items: [
        { report_id: 'r-1', report_number: 'CR-001', overall_condition: 'poor', condition_summary: 'Cracks visible' },
      ],
    } as any);
    mockGetIncidentReports.mockResolvedValue({
      items: [
        {
          report_id: 'i-1',
          report_number: 'IR-001',
          incident_date: new Date().toISOString(),
          incident_type: 'damage',
          status: 'submitted',
        },
      ],
    } as any);
    mockGetConservationTreatments.mockResolvedValue({
      treatments: [
        { treatment_id: 't-1', status: 'in_progress' },
      ],
    } as any);
    mockGetEmergencyPlans.mockResolvedValue({
      items: [{ plan_id: 'p-1', status: 'active' }],
    } as any);
  });

  it('shows loading skeleton initially', () => {
    mockGetConditionReports.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(
      screen.queryByRole('heading', { name: /risk overview/i }),
    ).not.toBeInTheDocument();
  });

  it('renders header and description', async () => {
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /risk overview/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/aggregate view of collection risks/i),
    ).toBeInTheDocument();
  });

  it('renders the four key metric cards', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/open incidents/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/at-risk conditions/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/active treatments/i)).toBeInTheDocument();
    expect(screen.getAllByText(/emergency plans/i).length).toBeGreaterThan(0);
  });

  it('renders recent incidents section', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/recent incidents/i)).toBeInTheDocument();
    });
    expect(screen.getByText('IR-001')).toBeInTheDocument();
  });

  it('renders condition reports section', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('CR-001')).toBeInTheDocument();
    });
  });

  it('renders View All links to relevant pages', async () => {
    renderPage();
    await waitFor(() => {
      const viewAllLinks = screen.getAllByRole('link', { name: /view all/i });
      expect(viewAllLinks.length).toBeGreaterThan(0);
    });
  });

  it('shows empty state for no incidents', async () => {
    mockGetIncidentReports.mockResolvedValue({ items: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/no incidents in the last 30 days/i),
      ).toBeInTheDocument();
    });
  });

  it('shows empty state for no poor condition reports', async () => {
    mockGetConditionReports.mockResolvedValue({
      items: [],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/no objects with poor or unacceptable conditions/i),
      ).toBeInTheDocument();
    });
  });
});
