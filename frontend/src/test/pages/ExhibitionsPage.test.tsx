import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ExhibitionsPage from '../../pages/collections/ExhibitionsPage';
import * as api from '../../lib/api';
import * as usePermissionsHook from '../../hooks/usePermissions';

vi.mock('../../lib/api', () => ({
  getExhibitions: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

const mockGetExhibitions = vi.mocked(api.getExhibitions);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/exhibitions`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/exhibitions"
            element={<ExhibitionsPage />}
          />
          <Route
            path="/organizations/:orgId/collections/exhibitions/create"
            element={<div>Create Exhibition</div>}
          />
          <Route
            path="/organizations/:orgId/collections/exhibitions/:id"
            element={<div>Exhibition Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CollectionsExhibitionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('renders heading', async () => {
    mockGetExhibitions.mockResolvedValue({ exhibitions: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Exhibitions' })).toBeInTheDocument();
    });
  });

  it('shows first-time empty state', async () => {
    mockGetExhibitions.mockResolvedValue({ exhibitions: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No exhibitions yet.' })).toBeInTheDocument();
    });
  });

  it('renders an exhibition row', async () => {
    mockGetExhibitions.mockResolvedValue({
      exhibitions: [
        {
          exhibition_id: 'ex-1',
          title: 'Modernism Reconsidered',
          exhibition_type: 'permanent',
          status: 'open',
          venue_name: 'Main Gallery',
          planned_start_date: '2024-03-01',
          planned_end_date: '2024-09-01',
          placement_count: 24,
        },
      ],
      total: 1,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Modernism Reconsidered')).toBeInTheDocument();
    });
  });

  it('shows error state on failure', async () => {
    mockGetExhibitions.mockRejectedValue(new Error('Server boom'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading exhibitions/i)).toBeInTheDocument();
    });
  });

  it('passes type filter to query when changed', async () => {
    mockGetExhibitions.mockResolvedValue({ exhibitions: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Exhibitions' })).toBeInTheDocument();
    });

    const typeSelect = screen.getByDisplayValue('All Types');
    fireEvent.change(typeSelect, { target: { value: 'traveling' } });

    await waitFor(() => {
      expect(mockGetExhibitions).toHaveBeenLastCalledWith(
        'org-1',
        expect.objectContaining({ exhibition_type: 'traveling' })
      );
    });
  });

  it('hides create CTA when user lacks permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockGetExhibitions.mockResolvedValue({ exhibitions: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Exhibitions' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: /new exhibition/i })).not.toBeInTheDocument();
  });
});
