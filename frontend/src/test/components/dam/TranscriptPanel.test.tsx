import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TranscriptPanel } from '../../../components/dam/TranscriptPanel';

vi.mock('../../../lib/api/media-dam', () => ({
  getTranscript: vi.fn(),
  triggerTranscription: vi.fn(),
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

import { getTranscript, triggerTranscription } from '../../../lib/api/media-dam';

const mockGetTranscript = vi.mocked(getTranscript);
const _mockTriggerTranscription = vi.mocked(triggerTranscription);

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe('TranscriptPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows not-transcribable message for images', () => {
    renderWithQuery(
      <TranscriptPanel organizationId="org-1" mediaId="m-1" mediaType="image" />
    );
    expect(
      screen.getByText('Transcription is only available for audio and video files.')
    ).toBeInTheDocument();
  });

  it('shows generate button when no transcript exists', async () => {
    mockGetTranscript.mockResolvedValue({
      media_id: 'm-1',
      transcript: null,
      language: null,
      status: null,
      model: null,
    });

    renderWithQuery(
      <TranscriptPanel organizationId="org-1" mediaId="m-1" mediaType="video" />
    );

    await waitFor(() => {
      expect(screen.getByText('Generate Transcript')).toBeInTheDocument();
    });
  });

  it('displays transcript text when available', async () => {
    mockGetTranscript.mockResolvedValue({
      media_id: 'm-1',
      transcript: 'Hello this is a test transcript.',
      language: 'en',
      status: null,
      model: 'base',
    });

    renderWithQuery(
      <TranscriptPanel organizationId="org-1" mediaId="m-1" mediaType="audio" />
    );

    await waitFor(() => {
      expect(
        screen.getByText('Hello this is a test transcript.')
      ).toBeInTheDocument();
    });
    expect(screen.getByText('EN')).toBeInTheDocument();
  });

  it('shows re-transcribe button when transcript exists', async () => {
    mockGetTranscript.mockResolvedValue({
      media_id: 'm-1',
      transcript: 'Existing transcript',
      language: 'en',
      status: null,
      model: 'base',
    });

    renderWithQuery(
      <TranscriptPanel organizationId="org-1" mediaId="m-1" mediaType="video" />
    );

    await waitFor(() => {
      expect(screen.getByText('Re-transcribe')).toBeInTheDocument();
    });
  });

  it('shows processing state', async () => {
    mockGetTranscript.mockResolvedValue({
      media_id: 'm-1',
      transcript: null,
      language: null,
      status: 'processing',
      model: null,
    });

    renderWithQuery(
      <TranscriptPanel organizationId="org-1" mediaId="m-1" mediaType="video" />
    );

    await waitFor(() => {
      expect(
        screen.getByText(/transcription in progress/i)
      ).toBeInTheDocument();
    });
  });

  it('shows failed state', async () => {
    mockGetTranscript.mockResolvedValue({
      media_id: 'm-1',
      transcript: null,
      language: null,
      status: 'failed',
      model: null,
    });

    renderWithQuery(
      <TranscriptPanel organizationId="org-1" mediaId="m-1" mediaType="video" />
    );

    await waitFor(() => {
      expect(
        screen.getByText(/transcription failed/i)
      ).toBeInTheDocument();
    });
  });

  it('shows copy button when transcript exists', async () => {
    mockGetTranscript.mockResolvedValue({
      media_id: 'm-1',
      transcript: 'Some text',
      language: 'en',
      status: null,
      model: 'base',
    });

    renderWithQuery(
      <TranscriptPanel organizationId="org-1" mediaId="m-1" mediaType="video" />
    );

    await waitFor(() => {
      expect(screen.getByText('Copy')).toBeInTheDocument();
    });
  });
});
