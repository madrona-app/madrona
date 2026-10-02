import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MediaSection } from '../../../pages/collections/CollectionObjectWorkspacePage/MediaSection';
import { makeCollectionObject } from './fixtures';
import type { LinkedMediaItem } from '../../../components/collections/MediaLibraryLinker';

vi.mock('../../../components/record-detail/ActiveSectionContext', () => ({
  useActiveSection: () => ({ activeSection: null, setActiveSection: vi.fn() }),
}));

vi.mock('../../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../components/collections/MediaManager', () => ({
  MediaManager: ({ objectId }: { objectId: string }) => (
    <div data-testid="media-manager">manager:{objectId}</div>
  ),
}));

vi.mock('../../../components/collections/MediaLibraryLinker', () => ({
  MediaLibraryLinker: ({ linkedMedia }: { linkedMedia: unknown[] }) => (
    <div data-testid="media-linker">linker:{linkedMedia?.length ?? 0}</div>
  ),
  OBJECT_USAGE_TYPES: [{ value: 'main', label: 'Main' }],
}));

vi.mock('../../../components/IIIFViewer', () => ({
  __esModule: true,
  default: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="iiif-viewer">
      <button onClick={onClose}>close iiif</button>
    </div>
  ),
}));

const linkedMedia: LinkedMediaItem[] = [
  {
    link_id: 'm-1',
    media_id: 'm-1',
    is_primary: true,
    caption_override: 'Front view',
    usage_type: 'main',
    media: {
      media_id: 'm-1',
      thumbnail_url: 'https://example.com/thumb1.jpg',
      preview_url: 'https://example.com/preview1.jpg',
      url: 'https://example.com/full1.jpg',
      title: 'Front',
      alt_text: 'Front image',
    } as never,
  },
  {
    link_id: 'm-2',
    media_id: 'm-2',
    is_primary: false,
    media: {
      media_id: 'm-2',
      thumbnail_url: 'https://example.com/thumb2.jpg',
      title: 'Back',
      alt_text: 'Back image',
    } as never,
  },
];

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'org-1',
    objectId: 'obj-1',
    object: makeCollectionObject(),
    isEditing: false,
    isCreateMode: false,
    linkedMedia,
    isLoadingMedia: false,
    expandedSections: { media: true },
    toggleSection: vi.fn(),
    sectionRefs: { current: {} },
    getSectionOrder: () => 1,
    isEmpty: false,
    sectionSummaries: { media: '2 images' },
    hasMediaApp: true,
    onLinkMedia: vi.fn(),
    onUnlinkMedia: vi.fn(),
    onSetPrimary: vi.fn(),
    onUpdateLink: vi.fn(),
    ...overrides,
  } as Parameters<typeof MediaSection>[0];
}

describe('MediaSection', () => {
  it('returns null in create mode (media requires a saved record)', () => {
    const { container } = render(<MediaSection {...makeProps({ isCreateMode: true })} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when there is no objectId', () => {
    const { container } = render(<MediaSection {...makeProps({ objectId: '' })} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the "Media" title', () => {
    render(<MediaSection {...makeProps()} />);
    expect(screen.getByText('Media')).toBeInTheDocument();
  });

  it('shows the primary image badge when the primary item is selected', () => {
    render(<MediaSection {...makeProps()} />);
    expect(screen.getByText('Primary Image')).toBeInTheDocument();
  });

  it('shows the thumbnail count text when multiple images exist', () => {
    render(<MediaSection {...makeProps()} />);
    expect(screen.getByText('2 images attached')).toBeInTheDocument();
  });

  it('renders empty-state copy when there is no linked media in view mode', () => {
    render(<MediaSection {...makeProps({ linkedMedia: [] })} />);
    expect(screen.getByText('No media attached to this object.')).toBeInTheDocument();
  });

  it('renders MediaManager and MediaLibraryLinker in edit mode', () => {
    render(<MediaSection {...makeProps({ isEditing: true })} />);
    expect(screen.getByTestId('media-manager')).toHaveTextContent('manager:obj-1');
    expect(screen.getByTestId('media-linker')).toHaveTextContent('linker:2');
  });

  it('opens the IIIF deep-zoom viewer when "Deep Zoom" button is clicked', () => {
    render(<MediaSection {...makeProps()} />);
    fireEvent.click(screen.getByText('Deep Zoom'));
    expect(screen.getByTestId('iiif-viewer')).toBeInTheDocument();
  });

  it('shows the section hint when collapsed', () => {
    render(<MediaSection {...makeProps({ expandedSections: { media: false } })} />);
    expect(screen.getByText('2 images')).toBeInTheDocument();
  });

  it('calls toggleSection with "media" when collapsed header is clicked', () => {
    const toggleSection = vi.fn();
    render(
      <MediaSection
        {...makeProps({
          expandedSections: { media: false },
          toggleSection,
        })}
      />,
    );
    fireEvent.click(screen.getByText('Media'));
    expect(toggleSection).toHaveBeenCalledWith('media');
  });
});
