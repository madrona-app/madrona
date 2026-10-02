import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MediaAITagsTab from '../../../components/dam/MediaAITagsTab';

vi.mock('../../../lib/api', () => ({
  getMediaAITags: vi.fn(),
  reprocessMediaAITags: vi.fn(),
  deleteMediaAITag: vi.fn(),
}));

import { getMediaAITags, reprocessMediaAITags, deleteMediaAITag } from '../../../lib/api';
const mockGet = vi.mocked(getMediaAITags);
const mockReprocess = vi.mocked(reprocessMediaAITags);
const mockDelete = vi.mocked(deleteMediaAITag);

function renderTab(props?: Partial<Parameters<typeof MediaAITagsTab>[0]>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MediaAITagsTab organizationId="org-1" mediaId="m-1" {...props} />
    </QueryClientProvider>,
  );
}

describe('MediaAITagsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading dots initially', () => {
    mockGet.mockReturnValue(new Promise(() => {}) as never);
    renderTab();
    expect(screen.getByText('Loading AI tags...')).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('Failed to load AI tags')).toBeInTheDocument();
    });
  });

  it('shows "AI tagging not yet run" banner when no status', async () => {
    mockGet.mockResolvedValue({ ai_tags: [], ai_processing_status: null } as never);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText(/AI tagging not yet run/)).toBeInTheDocument();
      expect(screen.getByText('Analyze Now')).toBeInTheDocument();
    });
  });

  it('shows "Analysis complete" banner when status is completed', async () => {
    mockGet.mockResolvedValue({
      ai_tags: [],
      ai_processing_status: 'completed',
      ai_processed_at: '2025-01-01T00:00:00Z',
    } as never);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('Analysis complete')).toBeInTheDocument();
    });
  });

  it('shows tag count summary', async () => {
    mockGet.mockResolvedValue({
      ai_tags: [
        { ai_tag_id: 't-1', tag_type: 'label', tag_value: 'cat', confidence: 0.95, mapping_status: 'pending' },
      ],
      ai_processing_status: 'completed',
    } as never);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText(/AI-detected tags/i)).toBeInTheDocument();
      expect(screen.getByText('cat')).toBeInTheDocument();
    });
  });

  it('shows "No tags detected" when status completed but no tags', async () => {
    mockGet.mockResolvedValue({ ai_tags: [], ai_processing_status: 'completed' } as never);
    renderTab({ aiProcessingStatus: 'completed' });
    await waitFor(() => {
      expect(screen.getByText('No tags were detected in this media')).toBeInTheDocument();
    });
  });

  it('groups tags by type and shows section headers', async () => {
    mockGet.mockResolvedValue({
      ai_tags: [
        { ai_tag_id: 't-1', tag_type: 'label', tag_value: 'dog', confidence: 0.9, mapping_status: 'pending' },
        { ai_tag_id: 't-2', tag_type: 'face', tag_value: 'person', confidence: 0.85, mapping_status: 'pending' },
      ],
      ai_processing_status: 'completed',
    } as never);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('Labels')).toBeInTheDocument();
      expect(screen.getByText('Faces')).toBeInTheDocument();
    });
  });

  it('triggers reprocess when Analyze Now is clicked', async () => {
    mockGet.mockResolvedValue({ ai_tags: [], ai_processing_status: null } as never);
    mockReprocess.mockResolvedValue({} as never);
    renderTab();
    await waitFor(() => screen.getByText('Analyze Now'));
    fireEvent.click(screen.getByText('Analyze Now'));
    await waitFor(() => {
      expect(mockReprocess).toHaveBeenCalledWith('org-1', 'm-1');
    });
  });

  it('triggers delete when X clicked on tag', async () => {
    mockGet.mockResolvedValue({
      ai_tags: [
        { ai_tag_id: 't-1', tag_type: 'label', tag_value: 'cat', confidence: 0.95, mapping_status: 'pending' },
      ],
      ai_processing_status: 'completed',
    } as never);
    mockDelete.mockResolvedValue({} as never);
    renderTab();
    await waitFor(() => screen.getByLabelText('Remove cat tag'));
    fireEvent.click(screen.getByLabelText('Remove cat tag'));
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('org-1', 'm-1', 't-1');
    });
  });
});
