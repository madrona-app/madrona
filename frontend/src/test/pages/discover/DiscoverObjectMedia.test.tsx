import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { DiscoverObjectPage } from '../../../pages/discover/DiscoverObjectPage';
import * as api from '../../../lib/api';
import { checkA11y } from '../../a11y';

vi.mock('../../../lib/api', () => ({
  getDiscoverInfo: vi.fn(),
  getDiscoverObject: vi.fn(),
}));
vi.mock('../../../pages/discover/components/CollectionSiteShell', () => ({
  CollectionSiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('../../../pages/discover/components/RelatedObjects', () => ({ RelatedObjects: () => null }));
vi.mock('../../../pages/discover/components/ShareToolbar', () => ({ ShareToolbar: () => null }));
vi.mock('../../../pages/discover/members/SaveToCollection', () => ({ SaveToCollection: () => null }));
vi.mock('../../../components/ui/ResponsiveImage', () => ({
  ResponsiveImage: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

const base = {
  srcset: null, width: null, height: null, alt_text: null, attribution: null,
  is_primary: false, caption: null,
};

const audio = {
  ...base,
  media_id: 'm-audio',
  media_type: 'audio',
  mime_type: 'audio/mpeg',
  url: 'https://media.test/interview.mp3',
  name: 'Interview with the founder',
  duration_seconds: 1830,
  transcript: 'Welcome to the archive. We begin in 1940.',
  transcript_machine_generated: true,
  captions: [],
  text_alternatives: [],
};

const video = {
  ...base,
  media_id: 'm-video',
  media_type: 'video',
  mime_type: 'video/mp4',
  url: 'https://media.test/walk.mp4',
  name: 'Gallery walkthrough',
  poster_url: 'https://media.test/poster.jpg',
  captions: [
    { url: '/api/discover/museum/media/m-video/alternatives/a1', label: 'English captions', srclang: 'en', kind: 'captions', default: true },
  ],
  transcript: null,
  text_alternatives: [
    { url: '/api/discover/museum/media/m-video/alternatives/a2', label: 'Transcript', kind: 'transcript', file_size: 2048 },
  ],
};

const pdf = {
  ...base,
  media_id: 'm-doc',
  media_type: 'document',
  mime_type: 'application/pdf',
  url: 'https://media.test/catalogue.pdf',
  name: 'Exhibition catalogue',
  file_size: 2_400_000,
  page_count: 48,
  captions: [],
  text_alternatives: [],
};

const image = { ...base, media_id: 'm-img', media_type: 'image', mime_type: 'image/jpeg', url: 'https://media.test/large.jpeg', alt_text: 'A painted vase' };

function renderPage(media: unknown[]) {
  vi.mocked(api.getDiscoverObject).mockResolvedValue({
    object_id: 'obj-1', object_number: 'AV.1', canonical_url: '/c/museum/objects/AV.1',
    title: 'Founders oral history', creators: [], materials: [], techniques: [], measurements: [],
    inscriptions: [], media, has_image: media.some((m) => (m as { media_type: string }).media_type === 'image'),
  } as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/c/museum/objects/AV.1']}>
          <Routes>
            <Route path="/c/:orgSlug/objects/:objectId" element={<DiscoverObjectPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

describe('Discover record page: audio, video and documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getDiscoverInfo).mockResolvedValue({ organization_name: 'Museum' } as never);
  });

  it('renders a named native audio player that never autoplays', async () => {
    const { container } = renderPage([audio]);
    const heading = await screen.findByRole('heading', { level: 3, name: /interview with the founder/i });
    const player = container.querySelector('audio')!;
    expect(player).toHaveAttribute('controls');
    expect(player).not.toHaveAttribute('autoplay');
    expect(player.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(screen.getByText(/duration 30 minutes 30 seconds/i)).toBeInTheDocument();
  });

  it('shows the transcript behind a real disclosure button', async () => {
    const user = userEvent.setup();
    renderPage([audio]);
    const button = await screen.findByRole('button', { name: /transcript: interview with the founder/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
    expect(panel).not.toBeVisible();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toBeVisible();
    expect(within(panel).getByText(/we begin in 1940/i)).toBeInTheDocument();
    expect(within(panel).getByText(/generated automatically/i)).toBeInTheDocument();
  });

  it('renders video with caption tracks from the Discover API and no autoplay', async () => {
    const { container } = renderPage([video]);
    await screen.findByRole('heading', { level: 3, name: /gallery walkthrough/i });
    const el = container.querySelector('video')!;
    expect(el).toHaveAttribute('controls');
    expect(el).not.toHaveAttribute('autoplay');
    const track = el.querySelector('track')!;
    expect(track).toHaveAttribute('kind', 'captions');
    expect(track).toHaveAttribute('srclang', 'en');
    expect(track).toHaveAttribute('label', 'English captions');
    expect(track.getAttribute('src')).toMatch(/\/api\/discover\/museum\/media\/m-video\/alternatives\/a1$/);
    expect(screen.getByRole('link', { name: /transcript: gallery walkthrough \(plain text, 2\.0 kb\)/i })).toBeInTheDocument();
  });

  it('says when a video has no captions', async () => {
    renderPage([{ ...video, captions: [] }]);
    expect(await screen.findByText(/no captions are available/i)).toBeInTheDocument();
  });

  it('names a PDF link with its type and size, without an inline frame', async () => {
    const { container } = renderPage([pdf]);
    const link = await screen.findByRole('link', { name: /open exhibition catalogue \(pdf, 2\.3 mb\)/i });
    expect(link).toHaveAttribute('href', 'https://media.test/catalogue.pdf');
    expect(screen.getByText(/48 pages/)).toBeInTheDocument();
    expect(container.querySelector('iframe, object, embed')).toBeNull();
  });

  it('keeps images in the hero and lists other media separately', async () => {
    renderPage([image, audio, pdf]);
    expect(await screen.findByRole('button', { name: /enlarge image: a painted vase/i })).toBeInTheDocument();
    const section = screen.getByRole('region', { name: /audio, video and documents/i });
    expect(within(section).getAllByRole('article')).toHaveLength(2);
  });

  it('has no axe violations with audio, video and a document', async () => {
    const user = userEvent.setup();
    const { container } = renderPage([image, audio, video, pdf]);
    await screen.findByRole('heading', { level: 3, name: /gallery walkthrough/i });
    await user.click(screen.getByRole('button', { name: /transcript: interview/i }));
    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });
});
