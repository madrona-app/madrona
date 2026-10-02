import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LabelTemplatesPage from '../../pages/exhibit/LabelTemplatesPage';
import * as api from '../../lib/api';
import * as usePermissionsHook from '../../hooks/usePermissions';

vi.mock('../../lib/api', () => ({
  getLabelTemplates: vi.fn(),
  deleteLabelTemplate: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

// LabelTemplateEditor pulls in heavy editor deps; replace with stub.
vi.mock('../../components/exhibit/LabelTemplateEditor', () => ({
  LabelTemplateEditor: () => null,
}));

const mockGetLabelTemplates = vi.mocked(api.getLabelTemplates);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);

function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(orgId = 'org-1') {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[`/organizations/${orgId}/collections/exhibitions/settings/label-templates`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/collections/exhibitions/settings/label-templates"
            element={<LabelTemplatesPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LabelTemplatesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('shows the loader while templates are loading', () => {
    mockGetLabelTemplates.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('renders the page heading once loaded', async () => {
    mockGetLabelTemplates.mockResolvedValue({ label_templates: [] } as never);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /label templates/i })).toBeInTheDocument();
    });
  });

  it('shows the empty state when there are no templates', async () => {
    mockGetLabelTemplates.mockResolvedValue({ label_templates: [] } as never);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no templates found/i)).toBeInTheDocument();
    });
  });

  it('renders a card per template', async () => {
    mockGetLabelTemplates.mockResolvedValue({
      label_templates: [
        { template_id: 't-1', name: 'Modern Sculpture Tombstone Template', label_type: 'tombstone' },
        { template_id: 't-2', name: 'Wing C Wall Text Template', label_type: 'wall' },
      ],
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Modern Sculpture Tombstone Template')).toBeInTheDocument();
    });
    expect(screen.getByText('Wing C Wall Text Template')).toBeInTheDocument();
  });

  it('shows the error banner on API failure', async () => {
    mockGetLabelTemplates.mockRejectedValue(new Error('boom'));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument();
    });
  });

  it('hides the New Template button without edit permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockGetLabelTemplates.mockResolvedValue({ label_templates: [] } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no templates found/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /new template/i })).not.toBeInTheDocument();
  });
});
