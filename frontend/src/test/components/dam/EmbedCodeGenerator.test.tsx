import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmbedCodeGenerator } from '../../../components/dam/EmbedCodeGenerator';

vi.mock('../../../lib/api/media-dam', () => ({
  getEmbedCode: vi.fn(),
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

import { getEmbedCode } from '../../../lib/api/media-dam';

const mockGetEmbedCode = vi.mocked(getEmbedCode);

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe('EmbedCodeGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockGetEmbedCode.mockReturnValue(new Promise(() => {})); // never resolves
    renderWithQuery(
      <EmbedCodeGenerator organizationId="org-1" mediaId="media-1" />
    );
    // Loading spinner should be present
    const container = document.querySelector('.animate-spin');
    expect(container).toBeTruthy();
  });

  it('renders iframe and URL after loading', async () => {
    mockGetEmbedCode.mockResolvedValue({
      media_id: 'media-1',
      embed_codes: {
        iframe: '<iframe src="https://example.com/embed/media-1"></iframe>',
        url: 'https://example.com/embed/media-1',
      },
    });

    renderWithQuery(
      <EmbedCodeGenerator organizationId="org-1" mediaId="media-1" />
    );

    await waitFor(() => {
      expect(screen.getByText('Iframe Embed')).toBeInTheDocument();
    });

    expect(screen.getByText('Direct URL')).toBeInTheDocument();
  });

  it('renders copy buttons', async () => {
    mockGetEmbedCode.mockResolvedValue({
      media_id: 'media-1',
      embed_codes: {
        iframe: '<iframe></iframe>',
        url: 'https://example.com/embed/media-1',
      },
    });

    renderWithQuery(
      <EmbedCodeGenerator organizationId="org-1" mediaId="media-1" />
    );

    await waitFor(() => {
      const copyButtons = screen.getAllByText('Copy');
      expect(copyButtons).toHaveLength(2);
    });
  });

  it('renders nothing when data is null', async () => {
    mockGetEmbedCode.mockResolvedValue(null as any);

    const { container } = renderWithQuery(
      <EmbedCodeGenerator organizationId="org-1" mediaId="media-1" />
    );

    await waitFor(() => {
      expect(container.querySelector('.animate-spin')).toBeNull();
    });
  });
});
