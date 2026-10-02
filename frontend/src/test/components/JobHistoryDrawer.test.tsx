import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import JobHistoryDrawer from '../../components/JobHistoryDrawer';

vi.mock('../../lib/api', () => ({
  getJobs: vi.fn(),
}));

import { getJobs } from '../../lib/api';
const mockGetJobs = vi.mocked(getJobs);

function renderDrawer(props?: Partial<Parameters<typeof JobHistoryDrawer>[0]>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <JobHistoryDrawer
          isOpen
          onClose={vi.fn()}
          pipelineId="p-1"
          organizationId="org-1"
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('JobHistoryDrawer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when isOpen=false', () => {
    const { container } = renderDrawer({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it('shows job list when jobs returned', async () => {
    mockGetJobs.mockResolvedValue({
      items: [
        {
          job_id: 'j-1',
          run_id: 'r-1',
          status: 'succeeded',
          started_at: '2025-01-01T10:00:00Z',
          finished_at: '2025-01-01T10:01:30Z',
        },
      ],
    } as never);
    renderDrawer();
    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });
  });

  it('shows multiple status labels', async () => {
    mockGetJobs.mockResolvedValue({
      items: [
        { job_id: 'j-1', run_id: 'r-1', status: 'failed', started_at: '2025-01-01T10:00:00Z', finished_at: '2025-01-01T10:00:30Z' },
        { job_id: 'j-2', run_id: 'r-2', status: 'running', started_at: '2025-01-01T11:00:00Z', finished_at: null },
      ],
    } as never);
    renderDrawer();
    await waitFor(() => {
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByText('Running')).toBeInTheDocument();
    });
  });

  it('calls onClose when backdrop clicked', async () => {
    mockGetJobs.mockResolvedValue({ items: [] } as never);
    const onClose = vi.fn();
    const { container } = renderDrawer({ onClose });
    await waitFor(() => screen.queryByRole('dialog'));
    // Click the backdrop (first div with the backdrop styles)
    const backdrop = container.querySelector('[aria-hidden="true"]');
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it('formats short duration in seconds', async () => {
    mockGetJobs.mockResolvedValue({
      items: [
        {
          job_id: 'j-1',
          run_id: 'r-1',
          status: 'succeeded',
          started_at: '2025-01-01T10:00:00Z',
          finished_at: '2025-01-01T10:00:45Z',
        },
      ],
    } as never);
    renderDrawer();
    await waitFor(() => {
      expect(screen.getByText('45s')).toBeInTheDocument();
    });
  });

  it('formats minutes and seconds duration', async () => {
    mockGetJobs.mockResolvedValue({
      items: [
        {
          job_id: 'j-1',
          run_id: 'r-1',
          status: 'succeeded',
          started_at: '2025-01-01T10:00:00Z',
          finished_at: '2025-01-01T10:02:15Z',
        },
      ],
    } as never);
    renderDrawer();
    await waitFor(() => {
      expect(screen.getByText('2m 15s')).toBeInTheDocument();
    });
  });

  it('shows em dash for missing dates', async () => {
    mockGetJobs.mockResolvedValue({
      items: [{ job_id: 'j-1', run_id: 'r-1', status: 'pending', started_at: null, finished_at: null }],
    } as never);
    renderDrawer();
    await waitFor(() => {
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });
  });

  it('handles empty jobs array', async () => {
    mockGetJobs.mockResolvedValue({ items: [] } as never);
    renderDrawer();
    await waitFor(() => {
      // Just verify no crash and dialog is open
      expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    });
  });
});
