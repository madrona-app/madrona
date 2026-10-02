import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ChecklistTemplatesPage from '../../pages/exhibit/ChecklistTemplatesPage';
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

function renderPage(orgId = 'org-1') {
  return render(
    <MemoryRouter
      initialEntries={[`/organizations/${orgId}/collections/exhibitions/settings/checklist-templates`]}
    >
      <Routes>
        <Route
          path="/organizations/:orgId/collections/exhibitions/settings/checklist-templates"
          element={<ChecklistTemplatesPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('ChecklistTemplatesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('shows the loader while templates are loading', () => {
    mockApiFetch.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('renders the page heading once data has loaded', async () => {
    mockApiFetch.mockResolvedValue({ templates: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /checklist templates/i })).toBeInTheDocument();
    });
  });

  it('shows empty state when there are no templates', async () => {
    mockApiFetch.mockResolvedValue({ templates: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no templates yet/i)).toBeInTheDocument();
    });
  });

  it('renders template rows when templates exist', async () => {
    mockApiFetch.mockResolvedValue({
      templates: [
        {
          template_id: 't-1',
          name: 'Standard Template',
          description: 'For most exhibitions',
          exhibition_type: 'general',
          is_archived: false,
          created_at: '2025-12-01T00:00:00Z',
          versions: [{ version_id: 'v-1', version_number: 1, is_published: true, is_locked: true }],
          published_version_id: 'v-1',
          published_version_number: 1,
        },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Standard Template')).toBeInTheDocument();
    });
    expect(screen.getByText('For most exhibitions')).toBeInTheDocument();
    expect(screen.getByText(/published v1/i)).toBeInTheDocument();
  });

  it('hides the New Template button when user lacks edit permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockApiFetch.mockResolvedValue({ templates: [] });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no templates yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /new template/i })).not.toBeInTheDocument();
  });

  it('filters templates via search', async () => {
    mockApiFetch.mockResolvedValue({
      templates: [
        {
          template_id: 't-1',
          name: 'Standard Template',
          description: null,
          exhibition_type: 'general',
          is_archived: false,
          created_at: '2025-12-01T00:00:00Z',
          versions: [],
          published_version_id: null,
          published_version_number: null,
        },
        {
          template_id: 't-2',
          name: 'Touring Show Template',
          description: null,
          exhibition_type: 'outgoing_traveling',
          is_archived: false,
          created_at: '2025-12-01T00:00:00Z',
          versions: [],
          published_version_id: null,
          published_version_number: null,
        },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Standard Template')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/search templates/i), {
      target: { value: 'touring' },
    });

    expect(screen.queryByText('Standard Template')).not.toBeInTheDocument();
    expect(screen.getByText('Touring Show Template')).toBeInTheDocument();
  });

  it('shows the create modal when New Template is clicked', async () => {
    mockApiFetch.mockResolvedValue({ templates: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no templates yet/i)).toBeInTheDocument();
    });

    const buttons = screen.getAllByRole('button', { name: /new template|create template/i });
    fireEvent.click(buttons[0]);

    expect(screen.getByRole('heading', { name: /create checklist template/i })).toBeInTheDocument();
  });
});
