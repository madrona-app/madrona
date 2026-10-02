/**
 * Tests for MediaDetailPage sub-route pages: AnnotationsPage, TransformPage,
 * PreservationPage, RightsPage, AIPage, and HistoryPage. These are thin
 * wrappers over outlet context that delegate to component children, so we
 * mock the heavy DAM children and assert routing-level behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AnnotationsPage from '../../../pages/media/MediaDetailPage/AnnotationsPage';
import TransformPage from '../../../pages/media/MediaDetailPage/TransformPage';
import PreservationPage from '../../../pages/media/MediaDetailPage/PreservationPage';
import RightsPage from '../../../pages/media/MediaDetailPage/RightsPage';
import AIPage from '../../../pages/media/MediaDetailPage/AIPage';
import HistoryPage from '../../../pages/media/MediaDetailPage/HistoryPage';
import { computeRightsStatus } from '../../../pages/media/MediaDetailPage/types';

// AI sections depend on deployment capabilities.
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    hasAppAccess: () => true,
    user: { ai_tagging_enabled: true, transcription_enabled: true },
  }),
}));

// Mock the heavy child components so we can isolate the wrapper logic.
vi.mock('../../../components/dam', () => ({
  MediaPreservationTab: (props: any) => (
    <div data-testid="preservation-tab">
      preservation:{props.formatName || 'no-format'}
    </div>
  ),
  MediaAITagsTab: (props: any) => (
    <div data-testid="ai-tags-tab">
      ai-tags:{props.aiProcessingStatus || 'idle'}
    </div>
  ),
  VersionHistoryTab: (props: any) => (
    <div data-testid="versions-tab">
      versions:v{props.currentVersion}
    </div>
  ),
  ProcessingHistoryTab: () => (
    <div data-testid="processing-history-tab">processing-history</div>
  ),
}));

vi.mock('../../../components/dam/AnnotationEditorTab', () => ({
  AnnotationEditorTab: (props: any) => (
    <div data-testid="annotation-editor">annotation:{props.imageUrl}</div>
  ),
}));

vi.mock('../../../components/dam/ImageCropEditor', () => ({
  ImageCropEditor: (props: any) => (
    <div data-testid="image-crop-editor">crop:{props.imageUrl}</div>
  ),
}));

vi.mock('../../../components/dam/MediaPreservationTab', () => ({
  default: (props: any) => (
    <div data-testid="preservation-tab-default">
      preservation-default:{props.formatName || 'no-format'}
    </div>
  ),
}));

vi.mock('../../../components/dam/TranscriptPanel', () => ({
  TranscriptPanel: () => (
    <div data-testid="transcript-panel">transcript</div>
  ),
}));

// Mock RightsTabContent (it's a separate file in same dir)
vi.mock('../../../pages/media/MediaDetailPage/RightsTabContent', () => ({
  RightsTabContent: (props: any) => (
    <div data-testid="rights-tab-content">
      rights:{props.media.media_type}
    </div>
  ),
}));

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderWithOutletContext(
  Element: React.ComponentType,
  context: any,
  path = '/m/m-1/sub'
) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/m/:mediaId"
            element={<Outlet context={context} />}
          >
            <Route path="sub" element={<Element />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const baseContext = (overrides: any = {}) => ({
  organizationId: 'org-123',
  mediaId: 'm-1',
  media: {
    media_id: 'm-1',
    media_type: 'image',
    url: 'https://cdn/full.jpg',
    preview_url: 'https://cdn/preview.jpg',
    width: 1024,
    height: 768,
    format_name: 'JPEG',
    pronom_puid: 'fmt/43',
    format_risk_level: 'low',
    current_version: 3,
    ai_processing_status: 'completed',
    ai_processed_at: '2025-01-15T10:00:00Z',
    ai_label_count: 5,
  },
  rightsStatus: computeRightsStatus([]),
  setPreviewCollapsed: vi.fn(),
  queryClient: createTestQueryClient(),
  usageStats: null,
  reviewMetadataMutation: { mutate: vi.fn() },
  clearReviewMutation: { mutate: vi.fn() },
  ...overrides,
});

describe('MediaDetailPage sub-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AnnotationsPage', () => {
    it('renders annotation editor for image media', () => {
      const ctx = baseContext();
      renderWithOutletContext(AnnotationsPage, ctx);
      expect(screen.getByTestId('annotation-editor')).toHaveTextContent(
        'annotation:https://cdn/full.jpg'
      );
    });

    it('shows fallback for non-image media', () => {
      const ctx = baseContext({
        media: { ...baseContext().media, media_type: 'video' },
      });
      renderWithOutletContext(AnnotationsPage, ctx);
      expect(
        screen.getByText(/annotations are only available for image files/i)
      ).toBeInTheDocument();
    });

    it('collapses preview on mount', () => {
      const setPreviewCollapsed = vi.fn();
      const ctx = baseContext({ setPreviewCollapsed });
      renderWithOutletContext(AnnotationsPage, ctx);
      expect(setPreviewCollapsed).toHaveBeenCalledWith(true);
    });
  });

  describe('TransformPage', () => {
    it('renders crop editor for images with a URL', () => {
      const ctx = baseContext();
      renderWithOutletContext(TransformPage, ctx);
      expect(screen.getByTestId('image-crop-editor')).toBeInTheDocument();
    });

    it('shows fallback for non-image media', () => {
      const ctx = baseContext({
        media: { ...baseContext().media, media_type: 'audio' },
      });
      renderWithOutletContext(TransformPage, ctx);
      expect(
        screen.getByText(/image transform is only available for image files/i)
      ).toBeInTheDocument();
    });

    it('shows fallback when image has no url', () => {
      const ctx = baseContext({
        media: { ...baseContext().media, url: null },
      });
      renderWithOutletContext(TransformPage, ctx);
      expect(
        screen.getByText(/image transform is only available for image files/i)
      ).toBeInTheDocument();
    });
  });

  describe('PreservationPage', () => {
    it('renders preservation tab with media format props', () => {
      const ctx = baseContext();
      renderWithOutletContext(PreservationPage, ctx);
      expect(screen.getByTestId('preservation-tab-default')).toHaveTextContent(
        'preservation-default:JPEG'
      );
    });
  });

  describe('RightsPage', () => {
    it('renders rights tab content with outlet context', () => {
      const ctx = baseContext();
      renderWithOutletContext(RightsPage, ctx);
      expect(screen.getByTestId('rights-tab-content')).toHaveTextContent('rights:image');
    });
  });

  describe('AIPage', () => {
    it('renders AI tags tab for images (no transcript toggle)', () => {
      const ctx = baseContext();
      renderWithOutletContext(AIPage, ctx);
      expect(screen.getByTestId('ai-tags-tab')).toHaveTextContent('ai-tags:completed');
      expect(screen.queryByRole('button', { name: /transcript/i })).not.toBeInTheDocument();
    });

    it('renders transcript toggle for video media and lets user switch', () => {
      const ctx = baseContext({
        media: { ...baseContext().media, media_type: 'video' },
      });
      renderWithOutletContext(AIPage, ctx);
      expect(screen.getByRole('button', { name: /auto-tags/i })).toBeInTheDocument();
      const transcriptBtn = screen.getByRole('button', { name: /transcript/i });
      expect(transcriptBtn).toBeInTheDocument();
      fireEvent.click(transcriptBtn);
      expect(screen.getByTestId('transcript-panel')).toBeInTheDocument();
    });
  });

  describe('HistoryPage', () => {
    it('renders processing history by default', () => {
      const ctx = baseContext();
      renderWithOutletContext(HistoryPage, ctx);
      expect(screen.getByTestId('processing-history-tab')).toBeInTheDocument();
    });

    it('switches to versions when versions button clicked', () => {
      const ctx = baseContext();
      renderWithOutletContext(HistoryPage, ctx);
      fireEvent.click(screen.getByRole('button', { name: /versions/i }));
      expect(screen.getByTestId('versions-tab')).toHaveTextContent('versions:v3');
    });
  });
});
