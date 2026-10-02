import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AuditCampaignsPage from '../../pages/collections/AuditCampaignsPage';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getAuditCampaigns: vi.fn(),
}));

const mockGetAuditCampaigns = vi.mocked(api.getAuditCampaigns);

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
        initialEntries={[`/organizations/${orgId}/collections/audits`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/collections/audits"
            element={<AuditCampaignsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleData = {
  total: 2,
  items: [
    {
      audit_id: 'a-1',
      audit_number: 'AUD-001',
      title: 'Q1 Inventory',
      scope: 'Storage Room A',
      audit_type: 'location',
      items_total: 100,
      items_audited: 80,
      accuracy_rate: 95.5,
      discrepancies_found: 2,
      status: 'in_progress',
    },
    {
      audit_id: 'a-2',
      audit_number: 'AUD-002',
      title: 'Annual Sweep',
      audit_type: 'annual',
      items_total: 0,
      items_audited: 0,
      accuracy_rate: null,
      discrepancies_found: 0,
      status: 'draft',
    },
  ],
};

describe('AuditCampaignsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('shows loader on initial render', () => {
    mockGetAuditCampaigns.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(
      screen.queryByRole('heading', { name: /^audit$/i }),
    ).not.toBeInTheDocument();
  });

  it('renders heading and campaign rows', async () => {
    mockGetAuditCampaigns.mockResolvedValue(sampleData as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /^audit$/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Q1 Inventory')).toBeInTheDocument();
    expect(screen.getByText('Annual Sweep')).toBeInTheDocument();
  });

  it('shows total count text', async () => {
    mockGetAuditCampaigns.mockResolvedValue(sampleData as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('2 audits')).toBeInTheDocument();
    });
  });

  it('renders summary stats', async () => {
    mockGetAuditCampaigns.mockResolvedValue(sampleData as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Planned')).toBeInTheDocument();
    });
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    expect(screen.getByText(/avg accuracy/i)).toBeInTheDocument();
  });

  it('renders error state on failure', async () => {
    mockGetAuditCampaigns.mockRejectedValue(new Error('audit fail'));
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/error loading audit campaigns: audit fail/i),
      ).toBeInTheDocument();
    });
  });

  it('renders empty state when no campaigns', async () => {
    mockGetAuditCampaigns.mockResolvedValue({ total: 0, items: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no audit campaigns/i)).toBeInTheDocument();
    });
  });

  it('changing status filter triggers refetch', async () => {
    mockGetAuditCampaigns.mockResolvedValue(sampleData as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Q1 Inventory')).toBeInTheDocument();
    });
    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'in_progress' } });
    await waitFor(() => {
      expect(mockGetAuditCampaigns).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({ status: 'in_progress' }),
      );
    });
  });

  it('renders new audit link', async () => {
    mockGetAuditCampaigns.mockResolvedValue(sampleData as any);
    renderPage();
    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /new audit/i });
      expect(links[0]).toHaveAttribute(
        'href',
        '/organizations/org-123/collections/audits/create',
      );
    });
  });
});
