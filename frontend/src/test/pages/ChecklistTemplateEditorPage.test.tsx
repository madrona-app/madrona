import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ChecklistTemplateEditorPage from '../../pages/exhibit/ChecklistTemplateEditorPage';
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

const samplePath =
  '/organizations/org-1/collections/exhibitions/settings/checklist-templates/tpl-1';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[samplePath]}>
      <Routes>
        <Route
          path="/organizations/:orgId/collections/exhibitions/settings/checklist-templates/:templateId"
          element={<ChecklistTemplateEditorPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

const sampleVersion = {
  version_id: 'v-1',
  version_number: 1,
  is_published: false,
  is_locked: false,
  change_notes: null,
  created_at: '2026-01-01T00:00:00Z',
  items: [
    {
      template_item_id: 'i-1',
      phase: 'planning' as const,
      title: 'Confirm budget',
      description: 'Lock down show budget',
      responsible_role: 'curator' as const,
      default_due_offset_days: -90,
      sort_order: 0,
      is_required: true,
    },
  ],
  item_count: 1,
};

const sampleTemplate = {
  template_id: 'tpl-1',
  name: 'Standard Template',
  description: 'For most shows',
  exhibition_type: 'general',
  is_archived: false,
  created_at: '2026-01-01T00:00:00Z',
  versions: [sampleVersion],
};

describe('ChecklistTemplateEditorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('shows loader while fetching template', () => {
    mockApiFetch.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('shows error state when load fails', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('boom'));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/failed to load template/i)).toBeInTheDocument();
    });
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to templates/i })).toBeInTheDocument();
  });

  it('renders template name and version info', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ template: sampleTemplate })
      .mockResolvedValueOnce({ version: sampleVersion });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Standard Template' })).toBeInTheDocument();
    });
    expect(screen.getByText('For most shows')).toBeInTheDocument();
    expect(screen.getByText(/Version 1/)).toBeInTheDocument();
    expect(screen.getByText(/draft/i)).toBeInTheDocument();
  });

  it('renders item under its phase group', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ template: sampleTemplate })
      .mockResolvedValueOnce({ version: sampleVersion });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Confirm budget')).toBeInTheDocument();
    });
    expect(screen.getByText(/lock down show budget/i)).toBeInTheDocument();
    expect(screen.getByText(/planning/i)).toBeInTheDocument();
  });

  it('shows publish button when version is unpublished and unlocked', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ template: sampleTemplate })
      .mockResolvedValueOnce({ version: sampleVersion });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /publish/i })).toBeInTheDocument();
    });
  });

  it('shows "no versions" empty state when template has no versions', async () => {
    mockApiFetch.mockResolvedValueOnce({
      template: { ...sampleTemplate, versions: [] },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no versions yet/i)).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /create version/i })
    ).toBeInTheDocument();
  });

  it('hides publish/edit controls when user lacks permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockApiFetch
      .mockResolvedValueOnce({ template: sampleTemplate })
      .mockResolvedValueOnce({ version: sampleVersion });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Standard Template' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });
});
