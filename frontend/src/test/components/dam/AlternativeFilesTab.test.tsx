import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlternativeFilesTab } from '../../../components/dam/AlternativeFilesTab';

vi.mock('../../../lib/api/media-dam', () => ({
  getAlternatives: vi.fn(),
  getAlternativeDownloadUrl: vi.fn(),
  deleteAlternative: vi.fn(),
}));

const showToast = vi.fn();
vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
}));

import { getAlternatives, deleteAlternative } from '../../../lib/api/media-dam';
const mockGet = vi.mocked(getAlternatives);
const mockDelete = vi.mocked(deleteAlternative);

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AlternativeFilesTab organizationId="org-1" mediaId="m-1" />
    </QueryClientProvider>,
  );
}

describe('AlternativeFilesTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders alternative file list when data returned', async () => {
    mockGet.mockResolvedValue({
      alternatives: [
        {
          alternative_id: 'a-1',
          alternative_type: 'transcript_txt',
          filename: 'transcript.txt',
          file_size: 1024,
        },
      ],
    } as never);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('transcript.txt')).toBeInTheDocument();
    });
  });

  it('shows file type label', async () => {
    mockGet.mockResolvedValue({
      alternatives: [
        { alternative_id: 'a-1', alternative_type: 'subtitle_vtt', filename: 'cc.vtt', file_size: 512 },
      ],
    } as never);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('VTT Subtitles')).toBeInTheDocument();
    });
  });

  it('formats file size in KB', async () => {
    mockGet.mockResolvedValue({
      alternatives: [
        { alternative_id: 'a-1', alternative_type: 'transcript_txt', filename: 'a.txt', file_size: 2048 },
      ],
    } as never);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
    });
  });

  it('formats file size in MB', async () => {
    mockGet.mockResolvedValue({
      alternatives: [
        { alternative_id: 'a-1', alternative_type: 'conversion', filename: 'big.mp4', file_size: 5_242_880 },
      ],
    } as never);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText(/5\.0 MB/)).toBeInTheDocument();
    });
  });

  it('shows multiple types correctly', async () => {
    mockGet.mockResolvedValue({
      alternatives: [
        { alternative_id: 'a-1', alternative_type: 'transcript_txt', filename: 'tx.txt', file_size: 100 },
        { alternative_id: 'a-2', alternative_type: 'crop', filename: 'crop.jpg', file_size: 200 },
      ],
    } as never);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('Transcript')).toBeInTheDocument();
      expect(screen.getByText('Crop')).toBeInTheDocument();
    });
  });

  it('opens delete confirmation when Trash button clicked', async () => {
    mockGet.mockResolvedValue({
      alternatives: [{ alternative_id: 'a-1', alternative_type: 'transcript_txt', filename: 'a.txt', file_size: 100 }],
    } as never);
    mockDelete.mockResolvedValue({} as never);
    renderTab();
    await waitFor(() => screen.getByText('a.txt'));
    fireEvent.click(screen.getByTitle('Delete'));
    expect(screen.getByText('Delete Alternative File')).toBeInTheDocument();
  });

  it('shows the count in the header', async () => {
    mockGet.mockResolvedValue({
      alternatives: [
        { alternative_id: 'a-1', alternative_type: 'transcript_txt', filename: 'a.txt', file_size: 100 },
        { alternative_id: 'a-2', alternative_type: 'crop', filename: 'b.jpg', file_size: 200 },
      ],
    } as never);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('Alternative Files (2)')).toBeInTheDocument();
    });
  });

  it('handles empty alternatives list', async () => {
    mockGet.mockResolvedValue({ alternatives: [] } as never);
    renderTab();
    await waitFor(() => {
      // Just verify the component renders without crashing
      expect(screen.queryByText('Transcript')).not.toBeInTheDocument();
    });
  });
});
