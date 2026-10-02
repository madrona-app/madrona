import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ExhibitionsPage from '../../pages/exhibit/ExhibitionsPage';
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

function renderExhibitionsPage(orgId = 'org-1') {
  return render(
    <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/exhibitions`]}>
      <Routes>
        <Route
          path="/organizations/:orgId/collections/exhibitions"
          element={<ExhibitionsPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('ExhibitionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('shows the loader before exhibitions arrive', () => {
    mockApiFetch.mockImplementation(() => new Promise(() => {}));
    renderExhibitionsPage();
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('renders the page header once data has loaded', async () => {
    mockApiFetch.mockResolvedValue({ exhibitions: [] });
    renderExhibitionsPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /exhibition and display/i })).toBeInTheDocument();
    });
  });

  it('shows the empty state when there are no exhibitions', async () => {
    mockApiFetch.mockResolvedValue({ exhibitions: [] });
    renderExhibitionsPage();

    await waitFor(() => {
      expect(screen.getByText(/no exhibitions yet/i)).toBeInTheDocument();
    });
  });

  it('renders an exhibition card for each result', async () => {
    mockApiFetch.mockResolvedValue({
      exhibitions: [
        {
          exhibition_id: 'e-1',
          exhibition_number: 'EX-001',
          title: 'Modern Sculptures',
          description: 'A modern survey',
          exhibition_type: 'temporary',
          status: 'open',
          venue_id: null,
          venue_name: 'Main Gallery',
          planned_start_date: '2026-01-01',
          planned_end_date: '2026-06-01',
          is_public: true,
          public_url_slug: null,
          placement_count: 5,
          created_at: '2025-12-01T00:00:00Z',
        },
        {
          exhibition_id: 'e-2',
          exhibition_number: null,
          title: 'Antique Pottery',
          description: null,
          exhibition_type: 'permanent',
          status: 'proposed',
          venue_id: null,
          venue_name: null,
          planned_start_date: null,
          planned_end_date: null,
          is_public: false,
          public_url_slug: null,
          placement_count: 0,
          created_at: '2025-11-15T00:00:00Z',
        },
      ],
    });

    renderExhibitionsPage();

    await waitFor(() => {
      expect(screen.getByText('Modern Sculptures')).toBeInTheDocument();
    });
    expect(screen.getByText('Antique Pottery')).toBeInTheDocument();
    expect(screen.getByText('5 artworks')).toBeInTheDocument();
  });

  it('filters exhibitions by search input', async () => {
    mockApiFetch.mockResolvedValue({
      exhibitions: [
        {
          exhibition_id: 'e-1',
          exhibition_number: null,
          title: 'Modern Sculptures',
          description: null,
          exhibition_type: 'temporary',
          status: 'open',
          venue_id: null,
          venue_name: null,
          planned_start_date: null,
          planned_end_date: null,
          is_public: true,
          public_url_slug: null,
          placement_count: 0,
          created_at: '2025-12-01T00:00:00Z',
        },
        {
          exhibition_id: 'e-2',
          exhibition_number: null,
          title: 'Antique Pottery',
          description: null,
          exhibition_type: 'permanent',
          status: 'proposed',
          venue_id: null,
          venue_name: null,
          planned_start_date: null,
          planned_end_date: null,
          is_public: false,
          public_url_slug: null,
          placement_count: 0,
          created_at: '2025-11-15T00:00:00Z',
        },
      ],
    });

    renderExhibitionsPage();

    await waitFor(() => {
      expect(screen.getByText('Modern Sculptures')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/search exhibitions/i), {
      target: { value: 'pottery' },
    });

    expect(screen.queryByText('Modern Sculptures')).not.toBeInTheDocument();
    expect(screen.getByText('Antique Pottery')).toBeInTheDocument();
  });

  it('shows the create button when user has create permission', async () => {
    mockApiFetch.mockResolvedValue({ exhibitions: [] });
    renderExhibitionsPage();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /new exhibition/i }).length).toBeGreaterThan(0);
    });
  });

  it('hides the create button when user lacks create permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockApiFetch.mockResolvedValue({ exhibitions: [] });

    renderExhibitionsPage();

    await waitFor(() => {
      expect(screen.getByText(/no exhibitions yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /new exhibition/i })).not.toBeInTheDocument();
  });

  it('shows error banner when load fails', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network unreachable'));
    renderExhibitionsPage();

    await waitFor(() => {
      expect(screen.getByText('Network unreachable')).toBeInTheDocument();
    });
  });
});
