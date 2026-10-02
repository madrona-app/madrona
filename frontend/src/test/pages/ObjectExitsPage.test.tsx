import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ObjectExitsPage from '../../pages/collections/ObjectExitsPage';
import * as api from '../../lib/api';
import * as usePermissionsHook from '../../hooks/usePermissions';

vi.mock('../../lib/api', () => ({
  getObjectExits: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

const mockGetObjectExits = vi.mocked(api.getObjectExits);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/exits`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/exits"
            element={<ObjectExitsPage />}
          />
          <Route
            path="/organizations/:orgId/collections/exits/create"
            element={<div>Create Exit</div>}
          />
          <Route
            path="/organizations/:orgId/collections/exits/:exitId"
            element={<div>Exit Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ObjectExitsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('renders heading and total count when loaded', async () => {
    mockGetObjectExits.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Object Exit' })).toBeInTheDocument();
    });
    expect(screen.getByText('No exits yet')).toBeInTheDocument();
  });

  it('shows first-time empty state when no exits', async () => {
    mockGetObjectExits.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No exits yet.' })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /create first exit/i })).toBeInTheDocument();
  });


  it('shows error state on API failure', async () => {
    mockGetObjectExits.mockRejectedValue(new Error('Network down'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading object exits/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/network down/i)).toBeInTheDocument();
  });

  it('passes status filter to query when changed', async () => {
    mockGetObjectExits.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Object Exit' })).toBeInTheDocument();
    });

    const statusSelect = screen.getByDisplayValue('All Statuses');
    fireEvent.change(statusSelect, { target: { value: 'in_transit' } });

    await waitFor(() => {
      expect(mockGetObjectExits).toHaveBeenLastCalledWith(
        'org-1',
        expect.objectContaining({ status: 'in_transit' })
      );
    });
  });

  it('updates search input value', async () => {
    mockGetObjectExits.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Object Exit' })).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Search exits...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'EX-2024' } });
    expect(input.value).toBe('EX-2024');
  });

  it('shows create CTA in header when user has create permission', async () => {
    mockGetObjectExits.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Object Exit' })).toBeInTheDocument();
    });
    const links = screen.getAllByRole('link', { name: /new object exit/i });
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  it('disables create CTA in header when user lacks permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockGetObjectExits.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Object Exit' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: /new object exit/i })).not.toBeInTheDocument();
    expect(screen.getByTitle(/requires collections.create permission/i)).toBeInTheDocument();
  });
});
