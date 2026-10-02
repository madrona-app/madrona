import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MediaWorkPage from '../../../pages/media/MediaWorkPage';
import * as api from '../../../lib/api';
import * as useOrganizationHook from '../../../contexts/useOrganization';

vi.mock('../../../lib/api', () => ({
  getMediaActiveContext: vi.fn(),
}));

vi.mock('../../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

const mockGetMediaActiveContext = vi.mocked(api.getMediaActiveContext);
const mockUseOrganization = vi.mocked(useOrganizationHook.useOrganization);

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(path: string) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/organizations/:orgId/media/work" element={<MediaWorkPage />} />
          <Route path="/organizations/:orgId/media/work/tasks" element={<MediaWorkPage />} />
          <Route path="/organizations/:orgId/media/work/recent" element={<MediaWorkPage />} />
          <Route path="/organizations/:orgId/media/work/actions" element={<MediaWorkPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MediaWorkPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrganization.mockReturnValue({
      activeOrganization: { organization_id: 'org-123' },
      activeOrganizationId: 'org-123',
    } as ReturnType<typeof useOrganizationHook.useOrganization>);
    mockGetMediaActiveContext.mockResolvedValue({ context: null } as any);
  });

  it('renders overview page header and dashboard sections', async () => {
    renderPage('/organizations/org-123/media/work');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Work', level: 1 })).toBeInTheDocument();
    });
    expect(
      screen.getByText(/your tasks, recent assets, and quick actions/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^my tasks$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^recent assets$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /quick actions/i })).toBeInTheDocument();
  });

  it('renders tasks subview when on /tasks route', async () => {
    renderPage('/organizations/org-123/media/work/tasks');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'My Tasks', level: 1 })).toBeInTheDocument();
    });
    expect(screen.getByText(/tasks requiring your attention/i)).toBeInTheDocument();
    expect(screen.getByText(/no pending tasks/i)).toBeInTheDocument();
  });

  it('renders recent subview when on /recent route', async () => {
    renderPage('/organizations/org-123/media/work/recent');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Recent Assets', level: 1 })).toBeInTheDocument();
    });
    expect(screen.getByText(/recently accessed assets/i)).toBeInTheDocument();
    expect(screen.getByText(/no recent assets/i)).toBeInTheDocument();
  });

  it('renders actions subview with all quick action buttons', async () => {
    renderPage('/organizations/org-123/media/work/actions');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Quick Actions', level: 1 })).toBeInTheDocument();
    });
    // 5 quick actions
    expect(screen.getByRole('button', { name: /download assets/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /bulk tag/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /move to folder/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create renditions/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set rights policy/i })).toBeInTheDocument();
  });

  it('shows active asset banner when asset context is set', async () => {
    mockGetMediaActiveContext.mockResolvedValue({
      context: {
        type: 'asset',
        asset: {
          media_id: 'm-1',
          filename: 'photo.jpg',
          title: null,
          thumbnail_url: null,
        },
      },
    } as any);
    renderPage('/organizations/org-123/media/work');
    await waitFor(() => {
      expect(screen.getByText(/working with asset/i)).toBeInTheDocument();
    });
    // photo.jpg appears in banner + right column context indicator
    expect(screen.getAllByText('photo.jpg').length).toBeGreaterThan(0);
    const link = screen.getByText(/view asset/i).closest('a');
    expect(link).toHaveAttribute('href', '/organizations/org-123/media/m-1');
  });

  it('shows active workspace banner when workspace context is set', async () => {
    mockGetMediaActiveContext.mockResolvedValue({
      context: {
        type: 'media_workspace',
        workspace: {
          workspace_id: 'ws-1',
          name: 'Press Kit',
          asset_count: 7,
        },
      },
    } as any);
    renderPage('/organizations/org-123/media/work');
    await waitFor(() => {
      expect(screen.getByText(/working with workspace/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/press kit \(7 assets\)/i)).toBeInTheDocument();
  });

  it('shows breadcrumb on subview pages linking back to Work', async () => {
    renderPage('/organizations/org-123/media/work/tasks');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'My Tasks', level: 1 })).toBeInTheDocument();
    });
    const breadcrumbLink = screen.getByRole('link', { name: 'Work' });
    expect(breadcrumbLink).toHaveAttribute('href', '/organizations/org-123/media/work');
  });

  it('disables quick action buttons that require context when none is set', async () => {
    renderPage('/organizations/org-123/media/work/actions');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /download assets/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /download assets/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /bulk tag/i })).toBeDisabled();
  });

  it('shows "No context selected" when no active context on actions view', async () => {
    renderPage('/organizations/org-123/media/work/actions');
    await waitFor(() => {
      expect(screen.getByText(/no context selected/i)).toBeInTheDocument();
    });
    const browseLink = screen.getByRole('link', { name: /browse media library/i });
    expect(browseLink).toHaveAttribute('href', '/organizations/org-123/media');
  });
});
