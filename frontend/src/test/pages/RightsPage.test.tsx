import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RightsPage from '../../pages/collections/RightsPage';
import * as api from '../../lib/api';
import * as usePermissionsHook from '../../hooks/usePermissions';

vi.mock('../../lib/api', () => ({
  getAllRights: vi.fn(),
  deleteObjectRight: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

const mockGetAllRights = vi.mocked(api.getAllRights);
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
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/rights`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/rights"
            element={<RightsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleRights = {
  total: 2,
  items: [
    {
      right_id: 'r-1',
      object_title: 'Vase #1',
      object_number: 'OBJ-001',
      right_type: 'copyright',
      rights_holder_contact: { name: 'Some Holder' },
      status: 'owned',
      is_perpetual: true,
      end_date: null,
      is_orphan_work: false,
    },
    {
      right_id: 'r-2',
      object_title: null,
      object_number: 'OBJ-002',
      right_type: 'reproduction',
      rights_holder_contact: null,
      status: 'orphan',
      is_perpetual: false,
      start_date: '2024-01-01',
      end_date: '2025-01-01',
      is_orphan_work: true,
      territory: 'US',
      fee_required: true,
    },
  ],
};

describe('RightsPage', () => {
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
    mockGetAllRights.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(
      screen.queryByRole('heading', { name: /rights management/i }),
    ).not.toBeInTheDocument();
  });

  it('renders page heading and description after loading', async () => {
    mockGetAllRights.mockResolvedValue(sampleRights as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /rights management/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/documents intellectual property rights/i),
    ).toBeInTheDocument();
  });

  it('renders rows for each right', async () => {
    mockGetAllRights.mockResolvedValue(sampleRights as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Vase #1')).toBeInTheDocument();
    });
    expect(screen.getByText('OBJ-002')).toBeInTheDocument();
    expect(screen.getByText('Some Holder')).toBeInTheDocument();
    expect(screen.getByText('Public Domain', { exact: false }) || screen.getByText(/owned/i)).toBeTruthy();
  });

  it('renders add button when user has create permission', async () => {
    mockGetAllRights.mockResolvedValue(sampleRights as any);
    renderPage();
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /add right record/i });
      expect(link).toHaveAttribute(
        'href',
        '/organizations/org-123/collections/rights/create',
      );
    });
  });

  it('disables add button when user lacks permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockGetAllRights.mockResolvedValue(sampleRights as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/add right record/i)).toBeInTheDocument();
    });
    // No link, just a span with the title
    const elem = screen.getByTitle(/requires collections.create/i);
    expect(elem).toBeInTheDocument();
  });

  it('shows stats: orphan, expiring soon, due for review', async () => {
    mockGetAllRights.mockResolvedValue(sampleRights as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Total Rights')).toBeInTheDocument();
    });
    expect(screen.getByText('Orphan Works')).toBeInTheDocument();
    expect(screen.getByText('Expiring Soon')).toBeInTheDocument();
    expect(screen.getByText('Due for Review')).toBeInTheDocument();
  });

  it('renders error banner when query fails', async () => {
    mockGetAllRights.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading rights/i)).toBeInTheDocument();
    });
  });

  it('renders empty state when no records and no filters', async () => {
    mockGetAllRights.mockResolvedValue({ total: 0, items: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no rights records yet\./i)).toBeInTheDocument();
    });
  });

  it('updates the type filter and refetches', async () => {
    mockGetAllRights.mockResolvedValue(sampleRights as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Vase #1')).toBeInTheDocument();
    });
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'copyright' } });
    await waitFor(() => {
      expect(mockGetAllRights).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({ right_type: 'copyright' }),
      );
    });
  });
});
