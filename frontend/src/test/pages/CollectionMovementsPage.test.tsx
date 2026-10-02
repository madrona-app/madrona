import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CollectionMovementsPage from '../../pages/collections/CollectionMovementsPage';
import * as api from '../../lib/api';
import * as usePermissionsHook from '../../hooks/usePermissions';

vi.mock('../../lib/api', () => ({
  getMovements: vi.fn(),
  getCollectionObject: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

const mockGetMovements = vi.mocked(api.getMovements);
const mockGetCollectionObject = vi.mocked(api.getCollectionObject);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgId = 'org-123', search = '') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[`/organizations/${orgId}/collections/movements${search}`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/collections/movements"
            element={<CollectionMovementsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleMovements = {
  items: [
    {
      movement_id: 'm-1',
      movement_number: 'MV-001',
      object_id: 'obj-1',
      object_name: 'Vase',
      object_number: 'OBJ-001',
      from_location_id: 'l-1',
      from_location_name: 'Storage A',
      to_location_id: 'l-2',
      to_location_name: 'Gallery 1',
      movement_date: '2024-01-15',
      movement_type: 'display',
      handler_name: 'Jane Handler',
      reason: 'For exhibition',
      status: 'completed',
    },
    {
      movement_id: 'm-2',
      movement_number: 'MV-002',
      object_id: 'obj-2',
      object_name: 'Painting',
      object_number: 'OBJ-002',
      from_location_id: 'l-2',
      from_location_name: 'Gallery 1',
      to_location_id: null,
      to_location_name: null,
      movement_date: null,
      movement_type: null,
      status: 'pending',
    },
  ],
  total: 2,
};

describe('CollectionMovementsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('renders heading after loading', async () => {
    mockGetMovements.mockResolvedValue(sampleMovements as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /movement control/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders description text', async () => {
    mockGetMovements.mockResolvedValue(sampleMovements as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/tracks where objects are stored/i),
      ).toBeInTheDocument();
    });
  });

  it('renders movement rows', async () => {
    mockGetMovements.mockResolvedValue(sampleMovements as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('OBJ-001')).toBeInTheDocument();
    });
    expect(screen.getByText('OBJ-002')).toBeInTheDocument();
  });

  it('shows New Movement link when permitted', async () => {
    mockGetMovements.mockResolvedValue(sampleMovements as any);
    renderPage();
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /new movement/i });
      expect(link).toHaveAttribute(
        'href',
        '/organizations/org-123/collections/movements/create',
      );
    });
  });

  it('renders error state on failure', async () => {
    mockGetMovements.mockRejectedValue(new Error('move broke'));
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/error loading movements: move broke/i),
      ).toBeInTheDocument();
    });
  });

  it('queries object info when object_id query param is set', async () => {
    mockGetMovements.mockResolvedValue(sampleMovements as any);
    mockGetCollectionObject.mockResolvedValue({
      object_id: 'obj-1',
      object_number: 'OBJ-001',
      titles: [{ is_preferred: true, title: 'Test Object' }],
    } as any);
    renderPage('org-123', '?object_id=obj-1');
    await waitFor(() => {
      expect(mockGetCollectionObject).toHaveBeenCalledWith('org-123', 'obj-1');
    });
  });

  it('hides New Movement when user lacks permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockGetMovements.mockResolvedValue(sampleMovements as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('OBJ-001')).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('link', { name: /new movement/i }),
    ).not.toBeInTheDocument();
  });
});
