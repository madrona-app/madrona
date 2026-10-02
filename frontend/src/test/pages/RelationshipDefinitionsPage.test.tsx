import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RelationshipDefinitionsPage from '../../pages/admin/RelationshipDefinitionsPage';
import * as useAuthHook from '../../hooks/useAuth';
import * as useOrgHook from '../../contexts/useOrganization';
import * as api from '../../lib/api';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  getRelationshipDefinitions: vi.fn(),
  createRelationshipDefinition: vi.fn(),
  updateRelationshipDefinition: vi.fn(),
  deleteRelationshipDefinition: vi.fn(),
  evaluateRelationshipDefinition: vi.fn(),
  getDatasets: vi.fn(),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), toasts: [], dismissToast: vi.fn() }),
}));

vi.mock('../../components/RelationshipAnalyticsDashboard', () => ({
  RelationshipAnalyticsDashboard: () => <div>Analytics Dashboard</div>,
}));

const mockUseAuth = vi.mocked(useAuthHook.useAuth);
const mockUseOrg = vi.mocked(useOrgHook.useOrganization);
const mockGetDefinitions = vi.mocked(api.getRelationshipDefinitions);
const mockCreate = vi.mocked(api.createRelationshipDefinition);
const mockGetDatasets = vi.mocked(api.getDatasets);

function setAuth(permissions: string[] = ['platform.admin']) {
  mockUseAuth.mockReturnValue({
    user: {
      user_id: 'user-1',
      name: 'Admin',
      email: 'admin@example.com',
      permissions,
    },
    memberships: [],
    activeOrganizationId: 'org-1',
    applications: [{ key: 'collections', enabled: true, status: 'active' }],
    isLoading: false,
    isAuthenticated: true,
    error: null,
  } as any);
}

function renderPage(orgId = 'org-1') {
  mockUseOrg.mockReturnValue({ activeOrganizationId: orgId } as any);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/admin/relationships`]}>
        <Routes>
          <Route path="/organizations/:orgId/admin/relationships" element={<RelationshipDefinitionsPage />} />
          <Route path="/organizations/:orgId/collections/objects" element={<div>Collections Landing</div>} />
          <Route path="/organizations/:orgId/collections/*" element={<div>Collections Landing</div>} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RelationshipDefinitionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDatasets.mockResolvedValue([]);
  });

  describe('permission gate', () => {
    it('redirects when user lacks platform.admin', async () => {
      setAuth([]);
      mockGetDefinitions.mockResolvedValue({ items: [], total_count: 0 } as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Collections Landing|Home/i)).toBeInTheDocument();
      });
      expect(screen.queryByText(/Manage relationship definitions/i)).not.toBeInTheDocument();
    });

    it('renders for platform admin', async () => {
      setAuth(['platform.admin']);
      mockGetDefinitions.mockResolvedValue({ items: [], total_count: 0 } as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Relationships/i })).toBeInTheDocument();
      });
    });
  });

  describe('rendering', () => {
    beforeEach(() => {
      setAuth(['platform.admin']);
    });

    it('shows tabs', async () => {
      mockGetDefinitions.mockResolvedValue({ items: [], total_count: 0 } as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Definitions/i })).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /Analytics/i })).toBeInTheDocument();
    });

    it('shows New Definition button on Definitions tab', async () => {
      mockGetDefinitions.mockResolvedValue({ items: [], total_count: 0 } as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /New Definition/i })).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('shows loading message', async () => {
      setAuth(['platform.admin']);
      mockGetDefinitions.mockImplementation(() => new Promise(() => {}));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Loading definitions/i)).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('shows empty message and CTA', async () => {
      setAuth(['platform.admin']);
      mockGetDefinitions.mockResolvedValue({ items: [], total_count: 0 } as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/No relationship definitions/i)).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /Create First Definition/i })).toBeInTheDocument();
    });
  });

  describe('with data', () => {
    const definitions = {
      items: [
        {
          definition_id: 'def-1',
          name: 'Object to Media',
          description: 'Links objects to their media',
          relationship_type: 'hasMedia',
          source_dataset_id: null,
          source_entity_type: 'object',
          source_field_path: 'payload.media_refs[*].id',
          target_dataset_id: null,
          target_entity_type: 'media',
          target_field_path: 'payload.identifiers[scheme=source].value',
          match_transform: 'exact',
          case_sensitive: true,
          enabled: true,
          auto_link_on_ingest: true,
          bidirectional: false,
          inverse_relationship_type: null,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      total_count: 1,
    };

    it('renders definition cards', async () => {
      setAuth(['platform.admin']);
      mockGetDefinitions.mockResolvedValue(definitions as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Object to Media')).toBeInTheDocument();
      });
      expect(screen.getByText(/Links objects to their media/i)).toBeInTheDocument();
    });

    it('shows enabled badge', async () => {
      setAuth(['platform.admin']);
      mockGetDefinitions.mockResolvedValue(definitions as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Enabled')).toBeInTheDocument();
      });
    });

    it('shows auto-link badge for auto-link definitions', async () => {
      setAuth(['platform.admin']);
      mockGetDefinitions.mockResolvedValue(definitions as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Auto-link')).toBeInTheDocument();
      });
    });
  });

  describe('create flow', () => {
    beforeEach(() => {
      setAuth(['platform.admin']);
      mockGetDefinitions.mockResolvedValue({ items: [], total_count: 0 } as any);
    });

    it('opens create form', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /New Definition/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /New Definition/i }));

      expect(screen.getByText('Create Relationship Definition')).toBeInTheDocument();
    });

    it('calls create when valid form submitted', async () => {
      mockCreate.mockResolvedValue({ definition_id: 'new' } as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /New Definition/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /New Definition/i }));

      // Fill required fields
      fireEvent.change(screen.getByPlaceholderText(/Objects to Media/i), {
        target: { value: 'Test Definition' },
      });
      fireEvent.change(screen.getByPlaceholderText(/hasMedia, relatedTo/i), {
        target: { value: 'testRel' },
      });
      fireEvent.change(screen.getByPlaceholderText(/payload.media_refs/i), {
        target: { value: 'src.field' },
      });
      fireEvent.change(screen.getByPlaceholderText(/payload.identifiers/i), {
        target: { value: 'tgt.field' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Create Definition/i }));

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Test Definition',
            relationship_type: 'testRel',
            source_field_path: 'src.field',
            target_field_path: 'tgt.field',
          }),
        );
      });
    });
  });

  describe('tabs', () => {
    it('switches to analytics tab', async () => {
      setAuth(['platform.admin']);
      mockGetDefinitions.mockResolvedValue({ items: [], total_count: 0 } as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Analytics/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Analytics/i }));

      await waitFor(() => {
        expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument();
      });
    });
  });
});
