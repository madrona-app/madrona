import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VenuesPage from '../../pages/exhibit/VenuesPage';
import * as apiClient from '../../lib/apiClient';
import * as usePermissionsHook from '../../hooks/usePermissions';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

const mockApiFetch = vi.mocked(apiClient.apiFetch);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);

function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(orgId = 'org-1') {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/exhibitions/venues`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/exhibitions/venues"
            element={<VenuesPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('VenuesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('shows loader while venues are loading', () => {
    mockApiFetch.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('renders the page heading once loaded', async () => {
    mockApiFetch.mockResolvedValue({ venues: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Venues' })).toBeInTheDocument();
    });
  });

  it('shows empty state when no venues', async () => {
    mockApiFetch.mockResolvedValue({ venues: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no venues found/i)).toBeInTheDocument();
    });
  });

  it('renders venue cards when venues exist', async () => {
    mockApiFetch.mockResolvedValue({
      venues: [
        {
          venue_id: 'v-1',
          name: 'Main Building',
          description: null,
          address: '123 Museum Way',
          default_ceiling_height_cm: 300,
          default_wall_color: 'rgb(var(--color-parchment-warm))',
          floor_plan_count: 3,
          created_at: '2025-12-01T00:00:00Z',
        },
        {
          venue_id: 'v-2',
          name: 'Annex',
          description: null,
          address: null,
          default_ceiling_height_cm: 280,
          default_wall_color: 'rgb(var(--color-parchment-warm))',
          floor_plan_count: 0,
          created_at: '2025-12-01T00:00:00Z',
        },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Main Building')).toBeInTheDocument();
    });
    expect(screen.getByText('Annex')).toBeInTheDocument();
    expect(screen.getByText('123 Museum Way')).toBeInTheDocument();
    expect(screen.getByText('3 rooms')).toBeInTheDocument();
    expect(screen.getByText('0 rooms')).toBeInTheDocument();
  });

  it('filters venues by search term', async () => {
    mockApiFetch.mockResolvedValue({
      venues: [
        {
          venue_id: 'v-1',
          name: 'Main Building',
          description: null,
          address: null,
          default_ceiling_height_cm: 300,
          default_wall_color: 'rgb(var(--color-parchment-warm))',
          floor_plan_count: 0,
          created_at: '2025-12-01T00:00:00Z',
        },
        {
          venue_id: 'v-2',
          name: 'Annex Outpost',
          description: null,
          address: null,
          default_ceiling_height_cm: 300,
          default_wall_color: 'rgb(var(--color-parchment-warm))',
          floor_plan_count: 0,
          created_at: '2025-12-01T00:00:00Z',
        },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Main Building')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/search venues/i), {
      target: { value: 'annex' },
    });

    expect(screen.queryByText('Main Building')).not.toBeInTheDocument();
    expect(screen.getByText('Annex Outpost')).toBeInTheDocument();
  });

  it('hides New Venue button when permission missing', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockApiFetch.mockResolvedValue({ venues: [] });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no venues found/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /new venue/i })).not.toBeInTheDocument();
  });
});
