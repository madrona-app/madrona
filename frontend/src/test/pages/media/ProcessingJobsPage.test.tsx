import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProcessingJobsPage from '../../../pages/media/ProcessingJobsPage';
import * as api from '../../../lib/api';
import * as mediaDam from '../../../lib/api/media-dam';

vi.mock('../../../lib/api', () => ({
  getProcessingJobs: vi.fn(),
  retryProcessingJob: vi.fn(),
}));

vi.mock('../../../lib/api/media-dam', () => ({
  bulkTranscribe: vi.fn(),
  bulkGenerateClip: vi.fn(),
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), toasts: [], dismissToast: vi.fn() }),
}));

const mockGetProcessingJobs = vi.mocked(api.getProcessingJobs);
const mockRetryProcessingJob = vi.mocked(api.retryProcessingJob);
const mockBulkTranscribe = vi.mocked(mediaDam.bulkTranscribe);
const mockBulkGenerateClip = vi.mocked(mediaDam.bulkGenerateClip);

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
      <MemoryRouter initialEntries={[`/organizations/${orgId}/media/processing-jobs`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/media/processing-jobs"
            element={<ProcessingJobsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ProcessingJobsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page heading and stats cards', async () => {
    mockGetProcessingJobs.mockResolvedValue({
      stats: { pending: 1, processing: 2, completed: 50, failed: 3 },
      jobs: [],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: /processing jobs/i })
      ).toBeInTheDocument();
    });
    // Stat-card numerals
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    // Stat labels (filter buttons share these names, so use getAllBy)
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Processing').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
  });

  it('shows loading state', () => {
    mockGetProcessingJobs.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/loading jobs/i)).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    mockGetProcessingJobs.mockRejectedValue(new Error('upstream error'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/upstream error/i)).toBeInTheDocument();
    });
  });

  it('renders empty state when no jobs', async () => {
    mockGetProcessingJobs.mockResolvedValue({
      stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
      jobs: [],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /no.*jobs/i })).toBeInTheDocument();
    });
    expect(
      screen.getByText(/processing jobs are created automatically/i)
    ).toBeInTheDocument();
  });

  it('renders job rows for each job', async () => {
    mockGetProcessingJobs.mockResolvedValue({
      stats: { pending: 0, processing: 0, completed: 1, failed: 1 },
      jobs: [
        {
          job_id: 'j-1',
          media_id: 'm-1',
          job_type: 'derivatives',
          status: 'completed',
          filename: 'photo.jpg',
          error_message: null,
          created_at: '2025-01-15T10:00:00Z',
        },
        {
          job_id: 'j-2',
          media_id: 'm-2',
          job_type: 'transcode',
          status: 'failed',
          filename: 'video.mp4',
          error_message: 'codec error',
          created_at: '2025-01-15T11:00:00Z',
        },
      ],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    });
    expect(screen.getByText('video.mp4')).toBeInTheDocument();
    // "Derivative Generation" appears in both the job row and the about section
    expect(screen.getAllByText('Derivative Generation').length).toBeGreaterThan(0);
    // "Video Transcoding" likewise appears in row + about section
    expect(screen.getAllByText('Video Transcoding').length).toBeGreaterThan(0);
    expect(screen.getByText('codec error')).toBeInTheDocument();
  });

  it('shows retry button for failed jobs and triggers retry', async () => {
    mockGetProcessingJobs.mockResolvedValue({
      stats: { pending: 0, processing: 0, completed: 0, failed: 1 },
      jobs: [
        {
          job_id: 'j-2',
          media_id: 'm-2',
          job_type: 'transcode',
          status: 'failed',
          filename: 'broken.mp4',
          error_message: 'failed',
          created_at: '2025-01-15T11:00:00Z',
        },
      ],
    } as any);
    mockRetryProcessingJob.mockResolvedValue({} as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('broken.mp4')).toBeInTheDocument();
    });
    const retryBtn = screen.getByTitle(/retry job/i);
    fireEvent.click(retryBtn);
    await waitFor(() => {
      expect(mockRetryProcessingJob).toHaveBeenCalledWith('org-123', 'j-2');
    });
  });

  it('changes filter when filter tab is clicked', async () => {
    mockGetProcessingJobs.mockResolvedValue({
      stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
      jobs: [],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(mockGetProcessingJobs).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({ page_size: 50 })
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
    await waitFor(() => {
      expect(mockGetProcessingJobs).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({ status: 'failed' })
      );
    });
  });

  it('triggers bulk transcribe when button clicked', async () => {
    mockGetProcessingJobs.mockResolvedValue({
      stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
      jobs: [],
    } as any);
    mockBulkTranscribe.mockResolvedValue({} as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /bulk transcribe/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /bulk transcribe/i }));
    await waitFor(() => {
      expect(mockBulkTranscribe).toHaveBeenCalledWith('org-123');
    });
  });

  it('triggers bulk CLIP when button clicked', async () => {
    mockGetProcessingJobs.mockResolvedValue({
      stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
      jobs: [],
    } as any);
    mockBulkGenerateClip.mockResolvedValue({} as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /bulk clip/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /bulk clip/i }));
    await waitFor(() => {
      expect(mockBulkGenerateClip).toHaveBeenCalledWith('org-123');
    });
  });

  it('renders the about section', async () => {
    mockGetProcessingJobs.mockResolvedValue({
      stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
      jobs: [],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/about processing jobs/i)).toBeInTheDocument();
    });
    // "Derivative Generation" appears at least once in the about section header
    const matches = screen.getAllByText(/derivative generation/i);
    expect(matches.length).toBeGreaterThan(0);
  });
});
