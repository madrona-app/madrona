import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EmergencyPlansPage from '../../pages/collections/EmergencyPlansPage';
import * as api from '../../lib/api';
import * as usePermissionsHook from '../../hooks/usePermissions';

vi.mock('../../lib/api', () => ({
  getEmergencyPlans: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

const mockGetEmergencyPlans = vi.mocked(api.getEmergencyPlans);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);

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
        initialEntries={[`/organizations/${orgId}/collections/emergency-plans`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/collections/emergency-plans"
            element={<EmergencyPlansPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const samplePlans = {
  total: 2,
  items: [
    {
      plan_id: 'p-1',
      title: 'Main Building Plan',
      facility_name: 'Main Building',
      plan_version: '2.0',
      last_drill_date: '2024-01-15',
      next_review_date: '2025-01-15',
      status: 'active',
    },
    {
      plan_id: 'p-2',
      title: 'Annex Plan',
      facility_name: 'Annex',
      plan_version: '1.0',
      status: 'draft',
    },
  ],
};

describe('EmergencyPlansPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('shows loader on initial render', () => {
    mockGetEmergencyPlans.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(
      screen.queryByRole('heading', { name: /emergency planning/i }),
    ).not.toBeInTheDocument();
  });

  it('renders heading and plan rows', async () => {
    mockGetEmergencyPlans.mockResolvedValue(samplePlans as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /emergency planning/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Main Building Plan')).toBeInTheDocument();
    expect(screen.getByText('Annex Plan')).toBeInTheDocument();
  });

  it('renders an info banner about preparedness', async () => {
    mockGetEmergencyPlans.mockResolvedValue(samplePlans as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/emergency preparedness/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/should be reviewed regularly/i),
    ).toBeInTheDocument();
  });

  it('renders stat cards for plan statuses', async () => {
    mockGetEmergencyPlans.mockResolvedValue(samplePlans as any);
    renderPage();
    await waitFor(() => {
      // "Draft" appears as both a stat label and a select option, so use getAllByText
      expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);
  });

  it('renders error state on failure', async () => {
    mockGetEmergencyPlans.mockRejectedValue(new Error('explode'));
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/error loading emergency plans: explode/i),
      ).toBeInTheDocument();
    });
  });

  it('renders empty state when no plans', async () => {
    mockGetEmergencyPlans.mockResolvedValue({ total: 0, items: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no emergency plans yet\./i)).toBeInTheDocument();
    });
  });

  it('disables create when user lacks permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockGetEmergencyPlans.mockResolvedValue(samplePlans as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/main building plan/i)).toBeInTheDocument();
    });
    expect(
      screen.getByTitle(/requires collections.create permission/i),
    ).toBeInTheDocument();
  });

  it('changing status filter triggers refetch', async () => {
    mockGetEmergencyPlans.mockResolvedValue(samplePlans as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Main Building Plan')).toBeInTheDocument();
    });
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'active' } });
    await waitFor(() => {
      expect(mockGetEmergencyPlans).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({ status: 'active' }),
      );
    });
  });
});
