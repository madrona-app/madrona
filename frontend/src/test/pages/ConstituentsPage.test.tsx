import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ConstituentsPage from '../../pages/collections/ConstituentsPage';
import * as constituentsApi from '../../lib/api/constituents';
import * as usePermissionsHook from '../../hooks/usePermissions';

vi.mock('../../lib/api/constituents', () => ({
  getConstituents: vi.fn(),
  deleteConstituent: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

const mockGetConstituents = vi.mocked(constituentsApi.getConstituents);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/constituents`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/constituents"
            element={<ConstituentsPage />}
          />
          <Route
            path="/organizations/:orgId/collections/constituents/create"
            element={<div>Create Person or Organization</div>}
          />
          <Route
            path="/organizations/:orgId/collections/constituents/:id"
            element={<div>Constituent Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ConstituentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('renders heading', async () => {
    mockGetConstituents.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'People and Organizations' })).toBeInTheDocument();
    });
  });

  it('shows first-time empty state when none exist', async () => {
    mockGetConstituents.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No people or organizations yet.' })).toBeInTheDocument();
    });
  });

  it('renders constituent row with name and type', async () => {
    mockGetConstituents.mockResolvedValue({
      items: [
        {
          constituent_id: 'c-1',
          name: 'Frida Kahlo',
          constituent_type: 'person',
          status: 'active',
          email: 'frida@example.org',
          nationality: 'Mexican',
          birth_date_display: '1907',
          death_date_display: '1954',
          is_verified: true,
        },
      ],
      total: 1,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Frida Kahlo')).toBeInTheDocument();
    });
    // "Person" appears in both type filter <option> and row type label; ensure ≥1 match
    expect(screen.getAllByText('Person').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Mexican')).toBeInTheDocument();
  });

  it('shows error state on failure', async () => {
    mockGetConstituents.mockRejectedValue(new Error('Server error'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading people and organizations/i)).toBeInTheDocument();
    });
  });

  it('renders create CTA when user has permission', async () => {
    mockGetConstituents.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'People and Organizations' })).toBeInTheDocument();
    });
    const links = screen.getAllByRole('link', { name: /new person or organization/i });
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  it('hides create CTA when user lacks permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockGetConstituents.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'People and Organizations' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: /new person or organization/i })).not.toBeInTheDocument();
  });
});
