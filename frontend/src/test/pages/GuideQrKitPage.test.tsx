import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GuideQrKitPage from '../../pages/guide/GuideQrKitPage';
import * as useOrganizationHook from '../../contexts/useOrganization';
import * as collectionsApi from '../../lib/api/collections';
import * as qrApi from '../../lib/api/qr';

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../../lib/api/collections', () => ({
  searchCollections: vi.fn(),
}));

// Keep the real MAX_LABELS_PER_BATCH (100); stub only the network calls.
vi.mock('../../lib/api/qr', async (importOriginal) => {
  const actual = await importOriginal<typeof qrApi>();
  return {
    ...actual,
    getSiteQr: vi.fn(),
    generateLabelPdf: vi.fn(),
  };
});

const mockUseOrganization = vi.mocked(useOrganizationHook.useOrganization);
const mockSearch = vi.mocked(collectionsApi.searchCollections);
const mockGetSiteQr = vi.mocked(qrApi.getSiteQr);
const mockGenerateLabelPdf = vi.mocked(qrApi.generateLabelPdf);

function makeHit(i: number, withImage = false) {
  return {
    object_id: `obj-${i}`,
    object_number: `N-${i}`,
    title: `Object ${i}`,
    is_discoverable: true,
    primary_image_url: withImage ? `https://img.example/${i}.jpg` : null,
  };
}

function mockSearchResult(hits: ReturnType<typeof makeHit>[], total?: number) {
  mockSearch.mockResolvedValue({
    hits,
    total: total ?? hits.length,
    took_ms: 1,
    used_semantic_search: false,
  } as Awaited<ReturnType<typeof collectionsApi.searchCollections>>);
}

function renderPage() {
  mockUseOrganization.mockReturnValue({
    activeOrganizationId: 'org-1',
    activeOrganization: { organization_id: 'org-1', organization_slug: 'museum-of-art', name: 'Museum' },
  } as ReturnType<typeof useOrganizationHook.useOrganization>);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <GuideQrKitPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('GuideQrKitPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSiteQr.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    mockGenerateLabelPdf.mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }));
    mockSearchResult([makeHit(1, true), makeHit(2)]);
    // jsdom has no object-URL support.
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it('renders both sections', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'QR Codes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Museum QR' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Object label QRs' })).toBeInTheDocument();
  });

  it('queries discoverable objects only and lists them', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Object 1')).toBeInTheDocument();
    });
    expect(mockSearch).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ filters: { is_discoverable: true } })
    );
  });

  it('downloads the museum QR as PNG', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /download png/i }));
    await waitFor(() => {
      expect(mockGetSiteQr).toHaveBeenCalledWith('org-1', 'png');
    });
  });

  it('generates a label PDF for the selected object with the chosen layout', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Object 1')).toBeInTheDocument();
    });
    // Select the first object.
    const firstRow = screen.getByText('Object 1').closest('label')!;
    fireEvent.click(within(firstRow).getByRole('checkbox'));
    // Pick the 6-up layout.
    fireEvent.click(screen.getByRole('radio', { name: /6 per page/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate pdf/i }));
    await waitFor(() => {
      expect(mockGenerateLabelPdf).toHaveBeenCalledWith('org-1', ['obj-1'], '6up');
    });
  });

  it('caps selection at 100 and shows the limit note', async () => {
    // 100 discoverable hits on one page; select-all reaches the cap.
    mockSearchResult(Array.from({ length: 100 }, (_, i) => makeHit(i)), 100);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Object 0')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /select all on page/i }));
    await waitFor(() => {
      expect(screen.getByText(/reached the 100-object limit/i)).toBeInTheDocument();
    });
    expect(screen.getByText('100 selected of 100 max')).toBeInTheDocument();
  });
});
