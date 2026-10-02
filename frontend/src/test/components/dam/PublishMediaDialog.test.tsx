import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PublishMediaDialog } from '../../../components/dam/PublishMediaDialog';

const { publishMediaMock, getMediaMock } = vi.hoisted(() => ({
  publishMediaMock: vi.fn(),
  getMediaMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  publishMedia: publishMediaMock,
  getMedia: getMediaMock,
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

// Default: a fully publishable item (rights documented + reviewed + completed).
function media(over: Record<string, unknown> = {}) {
  return {
    media_id: 'm-1',
    filename: 'vase.jpg',
    copyright_status: 'public_domain',
    metadata_reviewed: true,
    processing_status: 'completed',
    ...over,
  };
}

function renderDialog(props: Partial<Parameters<typeof PublishMediaDialog>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <PublishMediaDialog
        organizationId="org-1"
        mediaId="m-1"
        mediaTitle="A Beautiful Vase"
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

const publishBtn = () => screen.getByRole('button', { name: 'Publish', hidden: true });

describe('PublishMediaDialog', () => {
  beforeEach(() => {
    publishMediaMock.mockReset();
    getMediaMock.mockReset();
    getMediaMock.mockResolvedValue(media());
  });

  it('enables Publish when rights are documented and review is complete', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText('Rights documented')).toBeInTheDocument());
    expect(screen.getByText('Reviewed for sensitive content')).toBeInTheDocument();
    expect(publishBtn()).toBeEnabled();
  });

  it('blocks Publish when rights are not documented', async () => {
    getMediaMock.mockResolvedValue(media({ copyright_status: null }));
    renderDialog();
    await waitFor(() => expect(screen.getByText('Rights not documented')).toBeInTheDocument());
    expect(screen.getByText(/Resolve before publishing/)).toBeInTheDocument();
    expect(screen.getByText(/Document the rights/)).toBeInTheDocument();
    expect(publishBtn()).toBeDisabled();
  });

  it('blocks Publish when sensitive-content review is pending', async () => {
    getMediaMock.mockResolvedValue(media({ metadata_reviewed: false }));
    renderDialog();
    await waitFor(() => expect(screen.getByText('Sensitive-content review pending')).toBeInTheDocument());
    expect(screen.getByText(/Complete the sensitive-content review/)).toBeInTheDocument();
    expect(publishBtn()).toBeDisabled();
  });

  it('shows a non-blocking advisory for incomplete processing but still allows publish', async () => {
    getMediaMock.mockResolvedValue(media({ processing_status: 'queued' }));
    renderDialog();
    await waitFor(() => expect(screen.getByText(/Processing status is "queued"/)).toBeInTheDocument());
    // Rights + review satisfied → still publishable despite the advisory.
    expect(publishBtn()).toBeEnabled();
  });

  it('publishes and shows the success view when there are no warnings', async () => {
    publishMediaMock.mockResolvedValue({ warnings: [] });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    renderDialog({ onClose, onSuccess });
    await waitFor(() => expect(publishBtn()).toBeEnabled());
    fireEvent.click(publishBtn());
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows post-publish warnings inline when the API returns them', async () => {
    publishMediaMock.mockResolvedValue({ warnings: ['Tag missing'] });
    const onClose = vi.fn();
    renderDialog({ onClose });
    await waitFor(() => expect(publishBtn()).toBeEnabled());
    fireEvent.click(publishBtn());
    await waitFor(() => expect(screen.getByText(/Tag missing/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Done', hidden: true })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('surfaces a server error inline (the backstop)', async () => {
    publishMediaMock.mockRejectedValue(new Error('Publish blew up'));
    renderDialog();
    await waitFor(() => expect(publishBtn()).toBeEnabled());
    fireEvent.click(publishBtn());
    await waitFor(() => expect(screen.getByText('Publish blew up')).toBeInTheDocument());
  });

  it('Cancel triggers onClose', async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    await waitFor(() => expect(screen.getByText('Rights documented')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
