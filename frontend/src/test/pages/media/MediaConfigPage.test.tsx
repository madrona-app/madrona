import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MediaConfigPage from '../../../pages/media/MediaConfigPage';
import * as api from '../../../lib/api';
import * as useOrganizationHook from '../../../contexts/useOrganization';
import * as usePermissionsHook from '../../../hooks/usePermissions';

vi.mock('../../../lib/api', () => ({
  reindexMedia: vi.fn(),
  getStorageAnalytics: vi.fn(),
}));

vi.mock('../../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

const mockReindexMedia = vi.mocked(api.reindexMedia);
const mockGetStorageAnalytics = vi.mocked(api.getStorageAnalytics);
const mockUseOrganization = vi.mocked(useOrganizationHook.useOrganization);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(orgId = 'org-123') {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/media/config`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/media/config"
            element={<MediaConfigPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const sampleAnalytics = {
  total_gb: 12.34,
  object_count: 1234,
  lifecycle_rules: [{ status: 'Enabled' }, { status: 'Disabled' }],
  categories: [
    {
      category: 'originals',
      total_bytes: 1024 * 1024 * 1024,
      object_count: 50,
      tiers: [
        { storage_class: 'STANDARD', total_bytes: 1024 * 1024 * 512 },
        { storage_class: 'GLACIER_IR', total_bytes: 1024 * 1024 * 512 },
      ],
    },
    {
      category: 'derivatives',
      total_bytes: 1024 * 1024 * 200,
      object_count: 20,
      tiers: [{ storage_class: 'INTELLIGENT_TIERING', total_bytes: 1024 * 1024 * 200 }],
    },
  ],
};

describe('MediaConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: 'org-123',
    } as ReturnType<typeof useOrganizationHook.useOrganization>);
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('renders page header and section links', async () => {
    mockGetStorageAnalytics.mockResolvedValue(sampleAnalytics as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /media configuration/i })
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: /search index/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /ai auto-tagging/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /tag definitions/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /watermark templates/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /field inheritance/i })
    ).toBeInTheDocument();
  });

  it('renders storage analytics breakdown', async () => {
    mockGetStorageAnalytics.mockResolvedValue(sampleAnalytics as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/originals \(archival masters\)/i)).toBeInTheDocument();
    });
    expect(screen.getByText('12.34 GB')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(
      screen.getByText(/derivatives \(web copies\)/i)
    ).toBeInTheDocument();
    // Active rules count = 1 (one Enabled, one Disabled)
    expect(screen.getByText(/active rules/i)).toBeInTheDocument();
  });

  it('shows storage analytics error banner on failure', async () => {
    mockGetStorageAnalytics.mockRejectedValue(new Error('S3 unavailable'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/unable to load storage analytics/i)).toBeInTheDocument();
    });
  });

  it('triggers reindex on button click', async () => {
    mockGetStorageAnalytics.mockResolvedValue(sampleAnalytics as any);
    mockReindexMedia.mockResolvedValue({
      success: true,
      indexed: 100,
      total: 100,
      message: 'ok',
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reindex now/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /reindex now/i }));
    await waitFor(() => {
      expect(mockReindexMedia).toHaveBeenCalledWith('org-123');
    });
    await waitFor(() => {
      expect(screen.getByText(/reindex complete/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/successfully indexed 100 of 100/i)
    ).toBeInTheDocument();
  });

  it('shows reindex error message on failure', async () => {
    mockGetStorageAnalytics.mockResolvedValue(sampleAnalytics as any);
    mockReindexMedia.mockRejectedValue(new Error('reindex blew up'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reindex now/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /reindex now/i }));
    await waitFor(() => {
      // Error banner heading
      expect(screen.getByText(/^reindex failed$/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/reindex blew up/i)).toBeInTheDocument();
  });

  it('disables reindex button when user lacks media.admin permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockGetStorageAnalytics.mockResolvedValue(sampleAnalytics as any);
    renderPage();
    const btn = await screen.findByRole('button', { name: /reindex now/i });
    expect(btn).toBeDisabled();
  });

  it('renders config section nav links pointing to correct paths', async () => {
    mockGetStorageAnalytics.mockResolvedValue(sampleAnalytics as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /configure ai tagging/i })).toHaveAttribute(
        'href',
        '/organizations/org-123/media/ai-config'
      );
    });
    expect(screen.getByRole('link', { name: /manage tags/i })).toHaveAttribute(
      'href',
      '/organizations/org-123/media/tag-settings'
    );
    expect(screen.getByRole('link', { name: /manage templates/i })).toHaveAttribute(
      'href',
      '/organizations/org-123/media/watermark-templates'
    );
    expect(screen.getByRole('link', { name: /configure fields/i })).toHaveAttribute(
      'href',
      '/organizations/org-123/media/field-inheritance'
    );
  });
});
