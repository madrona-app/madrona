import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DuplicateDetectionPanel } from '../../../components/dam/DuplicateDetectionPanel';

const { findDuplicatesMock, bulkGenerateClipMock, showToastMock } = vi.hoisted(() => ({
  findDuplicatesMock: vi.fn(),
  bulkGenerateClipMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock('../../../lib/api/media-dam', () => ({
  findDuplicates: findDuplicatesMock,
  bulkGenerateClip: bulkGenerateClipMock,
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPanel() {
  return render(
    <QueryClientProvider client={createClient()}>
      <DuplicateDetectionPanel organizationId="org-1" />
    </QueryClientProvider>,
  );
}

describe('DuplicateDetectionPanel', () => {
  beforeEach(() => {
    findDuplicatesMock.mockReset();
    bulkGenerateClipMock.mockReset();
    showToastMock.mockReset();
  });

  it('renders the title and description', () => {
    renderPanel();
    expect(screen.getByText('Duplicate Detection')).toBeInTheDocument();
    expect(screen.getByText(/Find visually similar images/)).toBeInTheDocument();
  });

  it('shows the threshold percentage initially at 95%', () => {
    renderPanel();
    expect(screen.getByText('95%')).toBeInTheDocument();
  });

  it('updates the displayed threshold when the slider changes', () => {
    renderPanel();
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '0.85' } });
    expect(screen.getByText('85%')).toBeInTheDocument();
  });

  it('triggers a fetch on Scan and renders results', async () => {
    findDuplicatesMock.mockResolvedValue({
      total: 2,
      duplicates: [
        { media_id_a: 'aaaaaaaaaaaaaaaa', media_id_b: 'bbbbbbbbbbbbbbbb', similarity: 0.97 },
        { media_id_a: 'cccccccccccccccc', media_id_b: 'dddddddddddddddd', similarity: 0.91 },
      ],
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Scan for Duplicates/, hidden: true }));
    await waitFor(() => expect(findDuplicatesMock).toHaveBeenCalledWith('org-1', 0.95));
    expect(await screen.findByText(/2 potential duplicate pairs found/)).toBeInTheDocument();
    expect(screen.getByText('97% similar')).toBeInTheDocument();
  });

  it('shows the no-duplicates message when results are empty', async () => {
    findDuplicatesMock.mockResolvedValue({ total: 0, duplicates: [] });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Scan for Duplicates/, hidden: true }));
    await waitFor(() =>
      expect(screen.getByText(/No duplicates found at 95% threshold/)).toBeInTheDocument(),
    );
  });

  it('triggers bulk CLIP generation and shows a toast on success', async () => {
    bulkGenerateClipMock.mockResolvedValue({});
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Embeddings', hidden: true }));
    await waitFor(() => expect(bulkGenerateClipMock).toHaveBeenCalledWith('org-1'));
    await waitFor(() => expect(showToastMock).toHaveBeenCalled());
  });
});
