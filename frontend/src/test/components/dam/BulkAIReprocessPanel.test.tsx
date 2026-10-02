import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BulkAIReprocessPanel } from '../../../components/dam/BulkAIReprocessPanel';

const { bulkReprocessAITagsMock } = vi.hoisted(() => ({
  bulkReprocessAITagsMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  bulkReprocessAITags: bulkReprocessAITagsMock,
}));

function renderPanel(extra: Partial<React.ComponentProps<typeof BulkAIReprocessPanel>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BulkAIReprocessPanel
        organizationId="org-1"
        stats={{ pending_count: 80, failed_count: 5 } as never}
        canEdit
        {...extra}
      />
    </QueryClientProvider>,
  );
}

describe('BulkAIReprocessPanel', () => {
  beforeEach(() => {
    bulkReprocessAITagsMock.mockReset();
  });

  it('renders nothing when canEdit is false', () => {
    const { container } = renderPanel({ canEdit: false });
    expect(container.firstChild).toBeNull();
  });

  it('renders the heading', () => {
    renderPanel();
    expect(screen.getByText('Bulk Processing')).toBeInTheDocument();
  });

  it('shows the pending count in the filter chip', () => {
    renderPanel();
    expect(screen.getByText(/Pending \(80\)/)).toBeInTheDocument();
  });

  it('shows the failed count in the filter chip', () => {
    renderPanel();
    expect(screen.getByText(/Failed \(5\)/)).toBeInTheDocument();
  });

  it('shows the all count in the filter chip', () => {
    renderPanel();
    expect(screen.getByText(/All \(85\)/)).toBeInTheDocument();
  });

  it('process button shows the smaller of batch size and total count', () => {
    renderPanel({ stats: { pending_count: 10, failed_count: 0 } as never });
    expect(screen.getByText(/Process 10 Items/)).toBeInTheDocument();
  });

  it('process button defaults to batch size of 50 when more items available', () => {
    renderPanel();
    expect(screen.getByText(/Process 50 Items/)).toBeInTheDocument();
  });

  it('switching filter to failed shows updated count', () => {
    renderPanel();
    fireEvent.click(screen.getByText(/Failed \(5\)/));
    expect(screen.getByText(/Process 5 Items/)).toBeInTheDocument();
  });

  it('switching to all combines pending + failed', () => {
    renderPanel();
    fireEvent.click(screen.getByText(/All \(85\)/));
    expect(screen.getByText(/Process 50 Items/)).toBeInTheDocument();
  });

  it('clicking process calls bulkReprocessAITags with the right args', async () => {
    bulkReprocessAITagsMock.mockResolvedValue({ queued_count: 50, task_id: 't-1' });
    renderPanel();
    fireEvent.click(screen.getByText(/Process 50 Items/));
    await waitFor(() => {
      expect(bulkReprocessAITagsMock).toHaveBeenCalledWith('org-1', {
        status_filter: 'pending',
        limit: 50,
      });
    });
  });

  it('shows success message after a successful run', async () => {
    bulkReprocessAITagsMock.mockResolvedValue({ queued_count: 12, task_id: 't-9' });
    renderPanel();
    fireEvent.click(screen.getByText(/Process 50 Items/));
    expect(await screen.findByText(/Successfully queued 12 items/)).toBeInTheDocument();
  });

  it('shows error message when API rejects', async () => {
    bulkReprocessAITagsMock.mockRejectedValue(new Error('rate limit'));
    renderPanel();
    fireEvent.click(screen.getByText(/Process 50 Items/));
    expect(await screen.findByText('rate limit')).toBeInTheDocument();
  });

  it('shows "more remaining" message when total exceeds batch size', () => {
    renderPanel();
    expect(screen.getByText(/30 more items remaining after this batch/)).toBeInTheDocument();
  });

  it('changing batch size updates the process count', () => {
    renderPanel();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '25' } });
    expect(screen.getByText(/Process 25 Items/)).toBeInTheDocument();
  });
});
