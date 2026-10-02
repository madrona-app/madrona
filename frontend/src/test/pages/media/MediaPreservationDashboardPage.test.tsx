import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MediaPreservationDashboardPage from '../../../pages/media/MediaPreservationDashboardPage';
import * as preservationApi from '../../../lib/api/preservation';
import * as useOrganizationHook from '../../../contexts/useOrganization';

vi.mock('../../../lib/api/preservation', () => ({
  getFormatRiskSummary: vi.fn(),
  getAtRiskMedia: vi.fn(),
  getReplicationSummary: vi.fn(),
  getPreservationPolicies: vi.fn(),
  getActionPlans: vi.fn(),
  approveActionPlan: vi.fn(),
  cancelActionPlan: vi.fn(),
  deactivatePreservationPolicy: vi.fn(),
}));

vi.mock('../../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), dismissToast: vi.fn(), toasts: [] }),
}));

vi.mock('../../../components/dam/PolicyFormSlideOver', () => ({
  PolicyFormSlideOver: () => <div data-testid="policy-slideover" />,
}));

// Mock recharts (heavy, requires layout)
vi.mock('recharts', () => ({
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Cell: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const mockGetFormatRiskSummary = vi.mocked(preservationApi.getFormatRiskSummary);
const mockGetAtRiskMedia = vi.mocked(preservationApi.getAtRiskMedia);
const mockGetReplicationSummary = vi.mocked(preservationApi.getReplicationSummary);
const mockGetPreservationPolicies = vi.mocked(preservationApi.getPreservationPolicies);
const mockGetActionPlans = vi.mocked(preservationApi.getActionPlans);
const mockUseOrganization = vi.mocked(useOrganizationHook.useOrganization);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgId: string | undefined = 'org-123') {
  const qc = createQueryClient();
  const path = orgId
    ? `/organizations/${orgId}/media/preservation`
    : '/no-org';
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/organizations/:orgId/media/preservation"
            element={<MediaPreservationDashboardPage />}
          />
          <Route path="/no-org" element={<MediaPreservationDashboardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MediaPreservationDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: 'org-123',
    } as ReturnType<typeof useOrganizationHook.useOrganization>);
    // Default empty replies so no errors
    mockGetFormatRiskSummary.mockResolvedValue({ formats: [] } as any);
    mockGetAtRiskMedia.mockResolvedValue({ items: [], total: 0 } as any);
    mockGetReplicationSummary.mockResolvedValue({
      total_media: 100,
      replicated_media: 80,
      unreplicated_media: 20,
      coverage_percent: 80,
      by_verification_status: { verified: 70, unverified: 10, mismatch: 0 },
    } as any);
    mockGetPreservationPolicies.mockResolvedValue({ policies: [] } as any);
    mockGetActionPlans.mockResolvedValue({ items: [], total: 0 } as any);
  });

  it('renders the page heading and description', async () => {
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /digital preservation/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/oais-compliant format risk/i),
    ).toBeInTheDocument();
  });

  it('renders all top-level section headings', async () => {
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /format risk summary/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole('heading', { name: /replication health/i }),
    ).toBeInTheDocument();
  });

  it('shows replication stats once loaded', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/total media/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/^replicated$/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/^unreplicated$/i)).toBeInTheDocument();
    expect(screen.getAllByText('80%').length).toBeGreaterThan(0);
  });

  it('shows verification status counts', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/70 verified/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/10 unverified/i)).toBeInTheDocument();
  });

  it('shows "No format data available" when empty', async () => {
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/no format data available\./i),
      ).toBeInTheDocument();
    });
  });

  it('renders preservation policies section heading', async () => {
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /preservation policies/i }),
      ).toBeInTheDocument();
    });
  });

  it('shows error banner when format risk fails', async () => {
    mockGetFormatRiskSummary.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/failed to load format risk data/i),
      ).toBeInTheDocument();
    });
  });
});
