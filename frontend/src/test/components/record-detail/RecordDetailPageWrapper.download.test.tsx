/**
 * Tests for the inline download / request-download / open-in-media wiring that
 * RecordDetailPageWrapper threads into the ImageModal. The heavy presentational
 * children are stubbed so we isolate the handler logic; ImageModal is stubbed to
 * expose its action callbacks as buttons.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { RecordDetailPageWrapper } from '../../../components/record-detail/RecordDetailPageWrapper';

// --- Mocks -----------------------------------------------------------------

const getDownloadUrl = vi.fn();
const downloadWithFilename = vi.fn();
const showToast = vi.fn();

vi.mock('../../../lib/api/media-dam', () => ({
  getDownloadUrl: (...args: unknown[]) => getDownloadUrl(...args),
}));
vi.mock('../../../lib/download', () => ({
  downloadWithFilename: (...args: unknown[]) => downloadWithFilename(...args),
}));
vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
}));

// Layout shell → passthrough; leaf presentational components → noop.
vi.mock('../../../components/record-detail/RecordDetailLayout', () => {
  const pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    RecordDetailLayout: pass,
    RecordDetailHeaderArea: pass,
    RecordDetailSectionNav: pass,
    RecordDetailMain: pass,
    RecordDetailRail: pass,
  };
});
vi.mock('../../../components/record-detail/SectionNav', () => ({
  SectionNav: () => null,
  DEFAULT_SECTION_GROUPS: [],
}));
vi.mock('../../../components/record-detail/RightRailSummary', () => ({ RightRailSummary: () => null }));
vi.mock('../../../components/record-detail/RecordHeader', () => ({ RecordHeader: () => null }));
vi.mock('../../../components/record-detail/KeyInfoStrip', () => ({ KeyInfoStrip: () => null }));

// ImageModal stub — surfaces the action callbacks as buttons.
vi.mock('../../../components/record-detail/ImageModal', () => ({
  ImageModal: ({
    media,
    canDownload,
    onDownload,
    onRequestDownload,
    onOpenInMedia,
  }: {
    media: Array<{ id: string; filename?: string }>;
    canDownload?: boolean;
    onDownload?: (m: unknown) => void;
    onRequestDownload?: (m: unknown) => void;
    onOpenInMedia?: (m: unknown) => void;
  }) => (
    <div data-testid="image-modal">
      <span data-testid="can-download">{String(canDownload)}</span>
      <button onClick={() => onDownload?.(media[0])}>stub-download</button>
      <button onClick={() => onRequestDownload?.(media[0])}>stub-request</button>
      <button onClick={() => onOpenInMedia?.(media[0])}>stub-open</button>
    </div>
  ),
}));

// RequestDownloadModal stub — renders the org + media it was handed.
vi.mock('../../../components/dam/RequestDownloadModal', () => ({
  RequestDownloadModal: ({
    organizationId,
    mediaItems,
    onClose,
  }: {
    organizationId: string;
    mediaItems: Array<{ media_id: string }>;
    onClose: () => void;
  }) => (
    <div data-testid="request-modal">
      <span data-testid="req-org">{organizationId}</span>
      <span data-testid="req-media">{mediaItems.map((m) => m.media_id).join(',')}</span>
      <button onClick={onClose}>req-close</button>
    </div>
  ),
}));

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="probe">{loc.pathname + loc.search}</div>;
}

const MEDIA = [
  {
    media_id: 'm1',
    filename: 'one.jpg',
    url: '/p1.jpg',
    thumbnail_url: '/t1.jpg',
    is_primary: true,
    download_access: 'request' as const,
  },
];

const ENTRY_PATH = '/organizations/org-1/collections/entries/e1';

function renderWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[ENTRY_PATH]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/entries/:entryId"
            element={
              <RecordDetailPageWrapper
                object={{ object_id: 'e1', object_type: 'Object Entry' }}
                media={MEDIA}
                sectionIds={[]}
                permissions={{ canDownloadMedia: true }}
              >
                <div>content</div>
              </RecordDetailPageWrapper>
            }
          />
          <Route path="/organizations/:orgId/media/:mediaId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RecordDetailPageWrapper — inline download wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDownloadUrl.mockResolvedValue({ download_url: 'https://signed/url' });
    downloadWithFilename.mockResolvedValue(undefined);
  });

  it('passes canDownloadMedia through to the modal', () => {
    renderWrapper();
    expect(screen.getByTestId('can-download').textContent).toBe('true');
  });

  it('direct download fetches a signed URL then downloads with the filename', async () => {
    renderWrapper();
    fireEvent.click(screen.getByText('stub-download'));
    await waitFor(() => expect(getDownloadUrl).toHaveBeenCalledWith('org-1', 'm1'));
    await waitFor(() =>
      expect(downloadWithFilename).toHaveBeenCalledWith('https://signed/url', 'one.jpg'),
    );
  });

  it('falls back to the request modal when the signed-URL fetch is 403', async () => {
    getDownloadUrl.mockRejectedValueOnce({ status: 403 });
    renderWrapper();
    fireEvent.click(screen.getByText('stub-download'));
    expect(await screen.findByTestId('request-modal')).toBeInTheDocument();
    expect(showToast).toHaveBeenCalled();
    expect(downloadWithFilename).not.toHaveBeenCalled();
  });

  it('opens the request modal inline with the asset, staying in Collections', () => {
    renderWrapper();
    expect(screen.queryByTestId('request-modal')).toBeNull();
    fireEvent.click(screen.getByText('stub-request'));
    expect(screen.getByTestId('req-org').textContent).toBe('org-1');
    expect(screen.getByTestId('req-media').textContent).toBe('m1');
  });

  it('closing the request modal removes it', () => {
    renderWrapper();
    fireEvent.click(screen.getByText('stub-request'));
    fireEvent.click(screen.getByText('req-close'));
    expect(screen.queryByTestId('request-modal')).toBeNull();
  });

  it('"Open in Media" navigates to the asset with an encoded returnTo', () => {
    renderWrapper();
    fireEvent.click(screen.getByText('stub-open'));
    const probe = screen.getByTestId('probe').textContent || '';
    expect(probe.startsWith('/organizations/org-1/media/m1')).toBe(true);
    expect(probe).toContain(`returnTo=${encodeURIComponent(ENTRY_PATH)}`);
  });
});
