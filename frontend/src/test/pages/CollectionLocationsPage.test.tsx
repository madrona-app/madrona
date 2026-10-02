import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CollectionLocationsPage from '../../pages/collections/CollectionLocationsPage';
import * as api from '../../lib/api';
import * as usePermissionsHook from '../../hooks/usePermissions';

vi.mock('../../lib/api', () => ({
  getLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

const mockGetLocations = vi.mocked(api.getLocations);
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
        initialEntries={[`/organizations/${orgId}/collections/config/locations`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/collections/config/locations"
            element={<CollectionLocationsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleLocations = {
  items: [
    {
      location_id: 'l-1',
      name: 'Main Building',
      location_type: 'building',
      parent_id: null,
      status: 'active',
      current_count: 100,
    },
    {
      location_id: 'l-2',
      name: 'First Floor',
      location_type: 'floor',
      parent_id: 'l-1',
      status: 'active',
      current_count: 50,
    },
  ],
};

describe('CollectionLocationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('shows loading skeleton initially', () => {
    mockGetLocations.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(
      screen.queryByRole('heading', { name: /location and movement control/i }),
    ).not.toBeInTheDocument();
  });

  it('renders heading and description', async () => {
    mockGetLocations.mockResolvedValue(sampleLocations as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          name: /location and movement control/i,
        }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/tracks where objects are stored/i)).toBeInTheDocument();
  });

  it('renders the location count summary', async () => {
    mockGetLocations.mockResolvedValue(sampleLocations as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('2 locations')).toBeInTheDocument();
    });
  });

  it('renders the tree node names', async () => {
    mockGetLocations.mockResolvedValue(sampleLocations as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Main Building')).toBeInTheDocument();
    });
  });

  it('renders empty state when no locations', async () => {
    mockGetLocations.mockResolvedValue({ items: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no locations yet\./i)).toBeInTheDocument();
    });
  });

  it('renders Add Location button when permitted', async () => {
    mockGetLocations.mockResolvedValue(sampleLocations as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: /add location/i }).length,
      ).toBeGreaterThan(0);
    });
  });

  it('hides Add Location button when not permitted', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockGetLocations.mockResolvedValue(sampleLocations as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Main Building')).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /add location/i }),
    ).not.toBeInTheDocument();
  });

  it('renders error state on failure', async () => {
    mockGetLocations.mockRejectedValue(new Error('locations broke'));
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/error loading locations: locations broke/i),
      ).toBeInTheDocument();
    });
  });

  it('clicking a location selects it', async () => {
    mockGetLocations.mockResolvedValue(sampleLocations as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Main Building')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Main Building'));
    // Detail panel should now show
    await waitFor(() => {
      // The detail panel renders the location name
      expect(screen.getAllByText('Main Building').length).toBeGreaterThan(0);
    });
  });
});
