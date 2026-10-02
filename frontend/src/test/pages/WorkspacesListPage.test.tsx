import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkspacesListPage from '../../pages/work/WorkspacesListPage';
import * as api from '../../lib/api';
import * as useOrganizationHook from '../../contexts/useOrganization';
import * as useActiveProductHook from '../../hooks/useActiveProduct';

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof api>('../../lib/api');
  return {
    ...actual,
    listWorkspaces: vi.fn(),
    deleteWorkspace: vi.fn(),
    deleteMediaWorkspace: vi.fn(),
    setWorkspaceContext: vi.fn(),
    setMediaWorkspaceContext: vi.fn(),
  };
});

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../../hooks/useActiveProduct', () => ({
  useActiveProduct: vi.fn(),
}));

const mockListWorkspaces = vi.mocked(api.listWorkspaces);
const mockUseOrganization = vi.mocked(useOrganizationHook.useOrganization);
const mockUseActiveProduct = vi.mocked(useActiveProductHook.useActiveProduct);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(orgId = 'org-123') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[`/organizations/${orgId}/work/workspaces`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/work/workspaces"
            element={<WorkspacesListPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const collectionsWorkspace = {
  workspace_id: 'ws-1',
  name: 'Egyptian Antiquities',
  description: 'Items in storage A',
  visibility: 'private',
  workspace_type: 'collections',
  object_count: 5,
  is_owner: true,
  owner_name: 'Alice',
  is_dynamic: false,
  cover_thumbnail_url: null,
};

const mediaWorkspace = {
  workspace_id: 'ws-2',
  name: 'Photo archive',
  description: 'Image collection',
  visibility: 'shared',
  workspace_type: 'media',
  asset_count: 12,
  object_count: 0,
  is_owner: false,
  owner_name: 'Bob',
  is_dynamic: false,
  cover_thumbnail_url: null,
};

describe('WorkspacesListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: 'org-123',
      activeOrganization: {
        organization_id: 'org-123',
        name: 'Test Org',
        slug: 'test-org',
      },
      organizations: [],
      setActiveOrganizationId: vi.fn(),
      refreshOrganizations: vi.fn(),
      isLoading: false,
      error: null,
    } as ReturnType<typeof useOrganizationHook.useOrganization>);

    mockUseActiveProduct.mockReturnValue({
      activeProductId: 'collections',
      setActiveProductId: vi.fn(),
    } as ReturnType<typeof useActiveProductHook.useActiveProduct>);
  });

  describe('loading state', () => {
    it('shows skeleton while loading', () => {
      mockListWorkspaces.mockImplementation(() => new Promise(() => {}));
      const { container } = renderPage();
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(
        0
      );
    });
  });

  describe('basic render', () => {
    beforeEach(() => {
      mockListWorkspaces.mockResolvedValue({ items: [] });
    });

    it('renders the Work Sets heading', async () => {
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: 'Work Sets' })
        ).toBeInTheDocument();
      });
    });

    it('renders the New Work Set button', async () => {
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /new work set/i })
        ).toBeInTheDocument();
      });
    });

    it('renders search input', async () => {
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(/search work sets/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('shows empty state when no workspaces', async () => {
      mockListWorkspaces.mockResolvedValue({ items: [] });
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('No work sets yet.')).toBeInTheDocument();
      });
    });

    it('shows create your first work set button', async () => {
      mockListWorkspaces.mockResolvedValue({ items: [] });
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /create your first work set/i })
        ).toBeInTheDocument();
      });
    });
  });

  describe('workspace list rendering', () => {
    it('renders a collections workspace', async () => {
      mockListWorkspaces.mockResolvedValue({
        items: [collectionsWorkspace],
      });
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Egyptian Antiquities')).toBeInTheDocument();
      });
    });

    it('shows the description', async () => {
      mockListWorkspaces.mockResolvedValue({
        items: [collectionsWorkspace],
      });
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Items in storage A')).toBeInTheDocument();
      });
    });

    it('renders Collections badge for collections workspaces', async () => {
      mockListWorkspaces.mockResolvedValue({
        items: [collectionsWorkspace],
      });
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Collections')).toBeInTheDocument();
      });
    });

    it('renders visibility label', async () => {
      mockListWorkspaces.mockResolvedValue({
        items: [collectionsWorkspace],
      });
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Private')).toBeInTheDocument();
      });
    });
  });

  describe('media filter', () => {
    it('renders media workspaces when filter set to media', async () => {
      // Active product = null so type filter switcher visible
      mockUseActiveProduct.mockReturnValue({
        activeProductId: null,
        setActiveProductId: vi.fn(),
      } as ReturnType<typeof useActiveProductHook.useActiveProduct>);

      // First call: collections type, second call: media type
      mockListWorkspaces.mockImplementation(
        async (_org: string, opts?: { type?: string }) => {
          if (opts?.type === 'media') {
            return { items: [mediaWorkspace] };
          }
          return { items: [collectionsWorkspace] };
        }
      );

      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Egyptian Antiquities')).toBeInTheDocument();
      });
      expect(screen.getByText('Photo archive')).toBeInTheDocument();
    });
  });

  describe('grid size toggle', () => {
    it('renders grid size toggle buttons', async () => {
      mockListWorkspaces.mockResolvedValue({ items: [] });
      renderPage();
      await waitFor(() => {
        expect(screen.getByLabelText('2 columns')).toBeInTheDocument();
      });
      expect(screen.getByLabelText('4 columns')).toBeInTheDocument();
      expect(screen.getByLabelText('6 columns')).toBeInTheDocument();
    });

    it('changes grid size when clicked', async () => {
      mockListWorkspaces.mockResolvedValue({ items: [] });
      renderPage();
      await waitFor(() => {
        expect(screen.getByLabelText('2 columns')).toBeInTheDocument();
      });

      const twoColBtn = screen.getByLabelText('2 columns');
      fireEvent.click(twoColBtn);
      expect(twoColBtn.getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('ownership filter', () => {
    it('renders ownership filter buttons', async () => {
      mockListWorkspaces.mockResolvedValue({ items: [] });
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /^all$/i })
        ).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /^mine$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^shared$/i })).toBeInTheDocument();
    });

    it('switches to "mine" when clicked', async () => {
      mockListWorkspaces.mockResolvedValue({ items: [] });
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^mine$/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /^mine$/i }));

      await waitFor(() => {
        expect(mockListWorkspaces).toHaveBeenCalledWith(
          'org-123',
          expect.objectContaining({ filter: 'owned' })
        );
      });
    });
  });
});
