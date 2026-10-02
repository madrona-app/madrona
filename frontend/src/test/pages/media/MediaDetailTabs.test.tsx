import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MediaDetailTabs } from '../../../pages/media/MediaDetailPage/MediaDetailTabs';
import { computeRightsStatus } from '../../../pages/media/MediaDetailPage/types';

// The AI tab is hidden when the deployment can neither tag nor transcribe.
const { aiCaps } = vi.hoisted(() => ({
  aiCaps: { value: { ai_tagging_enabled: true, transcription_enabled: true } },
}));
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ hasAppAccess: () => true, user: aiCaps.value }),
}));

function renderTabs(props: {
  mediaType?: string;
  activeTab?:
    | 'details'
    | 'derivatives'
    | 'metadata'
    | 'ai'
    | 'alternatives'
    | 'transform'
    | 'annotations'
    | 'rights'
    | 'preservation'
    | 'history'
    | 'discussion';
  onTabChange?: (tab: any) => void;
  basePath?: string;
  initialPath?: string;
} = {}) {
  const onTabChange = props.onTabChange ?? vi.fn();
  return {
    onTabChange,
    ...render(
      <MemoryRouter initialEntries={[props.initialPath ?? '/m/m-1']}>
        <Routes>
          <Route
            path="/m/:mediaId/*"
            element={
              <MediaDetailTabs
                mediaType={props.mediaType ?? 'image'}
                activeTab={props.activeTab ?? 'details'}
                onTabChange={onTabChange}
                rightsStatus={computeRightsStatus([])}
                basePath={props.basePath ?? '/m/m-1'}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    ),
  };
}

describe('MediaDetailTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all primary tabs for image media', () => {
    renderTabs({ mediaType: 'image' });
    expect(screen.getByTitle(/^details$/i)).toBeInTheDocument();
    expect(screen.getByTitle(/^derivatives$/i)).toBeInTheDocument();
    expect(screen.getByTitle(/^technical$/i)).toBeInTheDocument();
    expect(screen.getByTitle(/^ai$/i)).toBeInTheDocument();
    expect(screen.getByTitle(/^files$/i)).toBeInTheDocument();
    expect(screen.getByTitle(/^transform$/i)).toBeInTheDocument();
    expect(screen.getByTitle(/^annotations$/i)).toBeInTheDocument();
    expect(screen.getByTitle(/^rights$/i)).toBeInTheDocument();
  });

  it('hides image-only tabs (Transform, Annotations) for non-image media', () => {
    renderTabs({ mediaType: 'video' });
    expect(screen.queryByTitle(/^transform$/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/^annotations$/i)).not.toBeInTheDocument();
  });

  it('calls onTabChange when an inline-tab button is clicked', () => {
    const { onTabChange } = renderTabs({ mediaType: 'image' });
    fireEvent.click(screen.getByTitle(/^derivatives$/i));
    expect(onTabChange).toHaveBeenCalledWith('derivatives');
  });

  it('renders sub-route tabs as links pointing to base path', () => {
    renderTabs({ mediaType: 'image', basePath: '/m/m-1' });
    const rightsLink = screen.getByTitle(/^rights$/i);
    expect(rightsLink.tagName).toBe('A');
    expect(rightsLink).toHaveAttribute('href', '/m/m-1/rights');
    const transformLink = screen.getByTitle(/^transform$/i);
    expect(transformLink).toHaveAttribute('href', '/m/m-1/transform');
  });

  it('renders an overflow "More" trigger when overflow tabs exist', () => {
    const { container } = renderTabs({ mediaType: 'image' });
    // The visible overflow control is a button at the end of the nav with a
    // chevron-down icon — it has no `title` attribute. Inline-tab buttons
    // (details, derivatives, metadata, alternatives) have a `title`. The
    // More button is detectable as a nav button without a title.
    const navButtons = Array.from(container.querySelectorAll('nav button'));
    const moreBtn = navButtons.find((b) => !b.hasAttribute('title'));
    expect(moreBtn).toBeTruthy();
  });

  it('renders rights status indicator dot in the rights tab', () => {
    const { container } = renderTabs({ mediaType: 'image' });
    const rightsTab = screen.getByTitle(/^rights$/i);
    // The status dot is the small span inside the rights tab
    const dot = rightsTab.querySelector('span[title]');
    expect(dot).toBeTruthy();
    // No-rights case → "Rights incomplete"
    expect(dot).toHaveAttribute('title', expect.stringMatching(/rights incomplete/i));
    expect(container).toBeTruthy();
  });

  describe('AI capabilities', () => {
    afterEach(() => {
      aiCaps.value = { ai_tagging_enabled: true, transcription_enabled: true };
    });

    it('hides the AI tab when the deployment can neither tag nor transcribe', () => {
      aiCaps.value = { ai_tagging_enabled: false, transcription_enabled: false };
      renderTabs({ mediaType: 'image' });
      expect(screen.queryByTitle(/^ai$/i)).not.toBeInTheDocument();
    });

    it('keeps the AI tab for video when only transcription is available', () => {
      aiCaps.value = { ai_tagging_enabled: false, transcription_enabled: true };
      renderTabs({ mediaType: 'video' });
      expect(screen.getByTitle(/^ai$/i)).toBeInTheDocument();
    });

    it('hides it for an image when only transcription is available', () => {
      // Nothing to transcribe in a still image.
      aiCaps.value = { ai_tagging_enabled: false, transcription_enabled: true };
      renderTabs({ mediaType: 'image' });
      expect(screen.queryByTitle(/^ai$/i)).not.toBeInTheDocument();
    });
  });
});
