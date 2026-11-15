import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PublicMediaList } from '../../../pages/discover/components/PublicMediaList';
import * as discoverApi from '../../../lib/api/discover';
import type { DiscoverMediaItem } from '../../../types/discover';
import { checkA11y } from '../../a11y';

vi.mock('../../../lib/api/discover', () => ({
  getDiscoverDocumentText: vi.fn(),
}));

const base: DiscoverMediaItem = {
  media_id: 'm-1',
  url: null,
  media_type: 'audio',
  mime_type: 'audio/wav',
  width: null,
  height: null,
  alt_text: null,
  attribution: null,
  is_primary: false,
  caption: null,
  srcset: null,
  captions: [],
  text_alternatives: [],
  downloads: [],
};

const preparingAudio: DiscoverMediaItem = {
  ...base,
  media_id: 'm-audio',
  name: 'Interview with the founder',
  playback_status: 'preparing',
  transcript: 'Welcome to the archive.',
  captions: [{ url: '/api/discover/museum/media/m-audio/alternatives/c1', label: 'English', srclang: 'en', kind: 'captions' }],
};

const preparingVideo: DiscoverMediaItem = {
  ...base,
  media_id: 'm-video',
  media_type: 'video',
  mime_type: 'video/quicktime',
  name: 'Gallery walkthrough',
  playback_status: 'preparing',
  captions: [{ url: '/api/discover/museum/media/m-video/alternatives/c2', label: 'English captions', srclang: 'en', kind: 'captions' }],
};

const proxyAudio: DiscoverMediaItem = {
  ...base,
  media_id: 'm-proxy',
  name: 'Song recording',
  url: 'https://media.test/derivs/web_audio_aac.m4a',
  playback_mime_type: 'audio/mp4',
  playback_source: 'access_copy',
  playback_status: 'ready',
};

const pageImagePdf: DiscoverMediaItem = {
  ...base,
  media_id: 'm-pdf',
  media_type: 'document',
  mime_type: 'application/pdf',
  name: 'Exhibition catalogue',
  page_count: 2,
  file_size: 2_400_000,
  url: 'https://media.test/derivs/access_pdf.pdf',
  playback_source: 'access_copy',
  playback_status: 'ready',
  text_url: '/api/discover/museum/media/m-pdf/text',
};

function renderList(items: DiscoverMediaItem[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PublicMediaList items={items} />
    </QueryClientProvider>,
  );
}

describe('Discover media: access copies instead of originals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(discoverApi.getDiscoverDocumentText).mockResolvedValue({
      pages: [
        { page: 1, text: 'Welcome to the exhibition.' },
        { page: 2, text: '' },
      ],
      truncated: false,
    });
  });

  it('shows a status message instead of a player while a playable copy is prepared', () => {
    const { container } = renderList([preparingAudio]);
    expect(container.querySelector('audio')).toBeNull();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('A playable copy of this recording is being prepared.');
    expect(status).toHaveTextContent('Its text version is below.');
    // The transcript and the caption file remain available.
    expect(screen.getByRole('button', { name: /transcript: interview with the founder/i })).toBeInTheDocument();
  });

  it('offers a video’s captions as files when there is no player', () => {
    const { container } = renderList([preparingVideo]);
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('A playable copy of this video is being prepared.');
    const link = screen.getByRole('link', { name: 'Timed text, English captions: Gallery walkthrough (WebVTT)' });
    expect(link.getAttribute('href')).toMatch(/alternatives\/c2$/);
    expect(screen.queryByText(/no captions are available/i)).toBeNull();
  });

  it('says plainly when no playable copy can be made', () => {
    renderList([{ ...preparingAudio, playback_status: 'unavailable', transcript: null, captions: [] }]);
    expect(screen.getByRole('status')).toHaveTextContent('This recording cannot be played online yet.');
  });

  it('plays the access copy in a native, named player', () => {
    const { container } = renderList([proxyAudio]);
    const player = container.querySelector('audio')!;
    expect(player).toHaveAttribute('src', 'https://media.test/derivs/web_audio_aac.m4a');
    expect(player).toHaveAttribute('controls');
    expect(player.getAttribute('aria-labelledby')).toBe(
      screen.getByRole('heading', { level: 3, name: /song recording/i }).id,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('labels a page-image PDF honestly and offers its text first', async () => {
    const user = userEvent.setup();
    renderList([pageImagePdf]);
    const article = screen.getByRole('article', { name: /exhibition catalogue/i });
    const button = within(article).getByRole('button', { name: 'Read the text of Exhibition catalogue' });
    const link = within(article).getByRole('link', { name: 'Open page images of Exhibition catalogue (PDF, 2 pages, no text layer)' });
    // Reading order: the text view comes before the page-image copy.
    expect(button.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(discoverApi.getDiscoverDocumentText).not.toHaveBeenCalled();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('heading', { level: 4, name: 'Page 1' })).toBeInTheDocument();
    expect(screen.getByText('Welcome to the exhibition.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Page 2' })).toBeInTheDocument();
    expect(screen.getByText('No text on this page.')).toBeInTheDocument();
    expect(discoverApi.getDiscoverDocumentText).toHaveBeenCalledWith('/api/discover/museum/media/m-pdf/text');
  });

  it('shows a document’s text when it is the only access copy', async () => {
    const user = userEvent.setup();
    vi.mocked(discoverApi.getDiscoverDocumentText).mockResolvedValue({
      pages: [{ page: null, text: 'Minutes of the meeting.' }],
      truncated: true,
    });
    renderList([{
      ...base,
      media_id: 'm-docx',
      media_type: 'document',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      name: 'Board minutes',
      playback_status: 'text_only',
      text_url: '/api/discover/museum/media/m-docx/text',
    }]);
    expect(screen.queryByRole('link', { name: /open board minutes/i })).toBeNull();
    expect(screen.getByText('This document is available on this page as text.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Read the text of Board minutes' }));
    expect(await screen.findByText('Minutes of the meeting.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 4 })).toBeNull();
    expect(screen.getByText('The text is too long to show in full here.')).toBeInTheDocument();
  });

  it('announces a failed text load', async () => {
    const user = userEvent.setup();
    vi.mocked(discoverApi.getDiscoverDocumentText).mockRejectedValue(new Error('boom'));
    renderList([pageImagePdf]);
    await user.click(screen.getByRole('button', { name: 'Read the text of Exhibition catalogue' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The text could not be loaded.');
  });

  it('a PDF still being prepared shows a status and no link', () => {
    renderList([{ ...pageImagePdf, url: null, playback_source: null, playback_status: 'preparing', text_url: null }]);
    expect(screen.getByRole('status')).toHaveTextContent('A viewable copy of this document is being prepared.');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('has no axe violations with placeholders, player and an open text view', async () => {
    const user = userEvent.setup();
    const { container } = renderList([preparingAudio, preparingVideo, proxyAudio, pageImagePdf]);
    await user.click(screen.getByRole('button', { name: 'Read the text of Exhibition catalogue' }));
    await screen.findByRole('heading', { level: 4, name: 'Page 1' });
    await user.click(screen.getByRole('button', { name: /transcript: interview/i }));
    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });
});
