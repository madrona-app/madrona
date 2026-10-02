import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MediaAIConfigPage from '../../../pages/media/MediaAIConfigPage';
import * as api from '../../../lib/api';
import * as useOrganizationHook from '../../../contexts/useOrganization';
import * as usePermissionsHook from '../../../hooks/usePermissions';

vi.mock('../../../lib/api', () => ({
  getMediaAIConfig: vi.fn(),
  updateMediaAIConfig: vi.fn(),
  getAITaggingStats: vi.fn(),
}));

vi.mock('../../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

vi.mock('../../../components/dam', () => ({
  AITagMappingsManager: () => <div data-testid="ai-tag-mappings" />,
  UnmappedAISuggestionsPanel: () => <div data-testid="unmapped-ai-panel" />,
  BulkAIReprocessPanel: () => <div data-testid="bulk-reprocess-panel" />,
}));

const mockGetMediaAIConfig = vi.mocked(api.getMediaAIConfig);
const mockGetAITaggingStats = vi.mocked(api.getAITaggingStats);
const mockUseOrganization = vi.mocked(useOrganizationHook.useOrganization);
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
        initialEntries={[`/organizations/${orgId}/media/ai-config`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/media/ai-config"
            element={<MediaAIConfigPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleConfig = {
  auto_tag_on_upload: true,
  detect_labels: true,
  detect_text: false,
  detect_faces: true,
  detect_celebrities: false,
  detect_moderation: true,
  extract_pdf_text: false,
  min_label_confidence: 0.75,
  min_text_confidence: 0.85,
  max_labels_per_image: 10,
  monthly_budget_usd: 50,
};

const sampleStats = {
  total_media: 1234,
  completed_count: 1000,
  pending_count: 200,
  failed_count: 34,
  total_ai_tags: 5678,
  total_cost_usd: 12.5,
};

describe('MediaAIConfigPage', () => {
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

  it('shows loading state', () => {
    mockGetMediaAIConfig.mockImplementation(() => new Promise(() => {}));
    mockGetAITaggingStats.mockResolvedValue(sampleStats as any);
    renderPage();
    expect(screen.getByText(/loading ai configuration/i)).toBeInTheDocument();
  });

  it('renders heading and back link', async () => {
    mockGetMediaAIConfig.mockResolvedValue(sampleConfig as any);
    mockGetAITaggingStats.mockResolvedValue(sampleStats as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /ai auto-tagging/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole('link', { name: /back to media configuration/i }),
    ).toBeInTheDocument();
  });

  it('renders detection feature toggles', async () => {
    mockGetMediaAIConfig.mockResolvedValue(sampleConfig as any);
    mockGetAITaggingStats.mockResolvedValue(sampleStats as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/auto-tag on upload/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/detect labels/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/detect text \(ocr\)/i)).toBeInTheDocument();
    expect(screen.getAllByText(/detect faces/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/content moderation/i)).toBeInTheDocument();
  });

  it('shows stats section when stats data is loaded', async () => {
    mockGetMediaAIConfig.mockResolvedValue(sampleConfig as any);
    mockGetAITaggingStats.mockResolvedValue(sampleStats as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/processing status/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/total media/i)).toBeInTheDocument();
    expect(screen.getByText(/ai tags/i)).toBeInTheDocument();
  });

  it('shows confidence thresholds section', async () => {
    mockGetMediaAIConfig.mockResolvedValue(sampleConfig as any);
    mockGetAITaggingStats.mockResolvedValue(sampleStats as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/confidence thresholds/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/minimum label confidence/i),
    ).toBeInTheDocument();
  });

  it('renders error state when config load fails', async () => {
    mockGetMediaAIConfig.mockRejectedValue(new Error('failed'));
    mockGetAITaggingStats.mockResolvedValue(sampleStats as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/unable to load ai configuration/i),
      ).toBeInTheDocument();
    });
  });

  it('shows error when no organization id', () => {
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: undefined,
    } as ReturnType<typeof useOrganizationHook.useOrganization>);
    mockGetMediaAIConfig.mockResolvedValue(sampleConfig as any);
    mockGetAITaggingStats.mockResolvedValue(sampleStats as any);
    // Render without orgId in URL
    const qc = createQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/no-org']}>
          <Routes>
            <Route path="/no-org" element={<MediaAIConfigPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      screen.getByText(/organization id is required/i),
    ).toBeInTheDocument();
  });
});
