import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageModal, type ImageModalMedia } from '../../../components/record-detail/ImageModal';

vi.mock('../../../hooks/useAccessibleModal', () => ({
  useAccessibleModal: ({ titlePrefix }: { titlePrefix: string }) => ({
    modalRef: { current: null },
    titleId: `${titlePrefix}-title`,
  }),
  getModalAriaProps: (titleId: string) => ({
    role: 'dialog',
    'aria-modal': true,
    'aria-labelledby': titleId,
  }),
}));

vi.mock('../../../components/ModalPortal', () => ({
  ModalPortal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mediaItems: ImageModalMedia[] = [
  { id: 'm1', url: '/i1.jpg', thumbnail_url: '/t1.jpg', title: 'Image One', filename: 'one.jpg' },
  { id: 'm2', url: '/i2.jpg', thumbnail_url: '/t2.jpg', title: 'Image Two', filename: 'two.jpg' },
  { id: 'm3', url: '/i3.jpg', thumbnail_url: '/t3.jpg', title: 'Image Three', filename: 'three.jpg' },
];

describe('ImageModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns null when isOpen is false', () => {
    const { container } = render(
      <ImageModal isOpen={false} onClose={() => {}} media={mediaItems} />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('returns null when media is empty', () => {
    const { container } = render(
      <ImageModal isOpen={true} onClose={() => {}} media={[]} />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the dialog when open with media', () => {
    const { container } = render(<ImageModal isOpen={true} onClose={() => {}} media={mediaItems} />);
    // The modal child div carries the role
    expect(container.querySelector('[aria-modal="true"]')).not.toBeNull();
  });

  it('renders the current image title', () => {
    render(<ImageModal isOpen={true} onClose={() => {}} media={mediaItems} />);
    expect(screen.getByText('Image One')).toBeInTheDocument();
  });

  it('renders the index counter when multiple images', () => {
    render(<ImageModal isOpen={true} onClose={() => {}} media={mediaItems} />);
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('calls onClose when the X button is clicked', () => {
    const onClose = vi.fn();
    render(<ImageModal isOpen={true} onClose={onClose} media={mediaItems} />);
    fireEvent.click(screen.getByLabelText('Close image viewer'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders previous/next buttons when multiple images', () => {
    render(<ImageModal isOpen={true} onClose={() => {}} media={mediaItems} />);
    expect(screen.getByLabelText('Previous image')).toBeInTheDocument();
    expect(screen.getByLabelText('Next image')).toBeInTheDocument();
  });

  it('disables previous on first image', () => {
    render(<ImageModal isOpen={true} onClose={() => {}} media={mediaItems} initialIndex={0} />);
    expect(screen.getByLabelText('Previous image')).toBeDisabled();
  });

  it('disables next on last image', () => {
    render(<ImageModal isOpen={true} onClose={() => {}} media={mediaItems} initialIndex={2} />);
    expect(screen.getByLabelText('Next image')).toBeDisabled();
  });

  it('clicking next moves to the next image', () => {
    render(<ImageModal isOpen={true} onClose={() => {}} media={mediaItems} />);
    fireEvent.click(screen.getByLabelText('Next image'));
    expect(screen.getByText('Image Two')).toBeInTheDocument();
  });

  it('clicking previous on second image moves back', () => {
    render(<ImageModal isOpen={true} onClose={() => {}} media={mediaItems} initialIndex={1} />);
    fireEvent.click(screen.getByLabelText('Previous image'));
    expect(screen.getByText('Image One')).toBeInTheDocument();
  });

  it('renders the download button when canDownload is true', () => {
    const onDownload = vi.fn();
    render(
      <ImageModal
        isOpen={true}
        onClose={() => {}}
        media={mediaItems}
        canDownload
        onDownload={onDownload}
      />,
    );
    expect(screen.getByTitle('Download original')).toBeInTheDocument();
  });

  it('clicking the download button calls onDownload with current media', () => {
    const onDownload = vi.fn();
    render(
      <ImageModal
        isOpen={true}
        onClose={() => {}}
        media={mediaItems}
        canDownload
        onDownload={onDownload}
      />,
    );
    fireEvent.click(screen.getByTitle('Download original'));
    expect(onDownload).toHaveBeenCalledWith(mediaItems[0]);
  });

  it('falls back to the direct download button when download_access is absent', () => {
    // Legacy callers pass canDownload + onDownload with no access mode.
    const onDownload = vi.fn();
    render(
      <ImageModal isOpen onClose={() => {}} media={mediaItems} canDownload onDownload={onDownload} />,
    );
    expect(screen.getByTitle('Download original')).toBeInTheDocument();
  });

  it('renders the direct download button when download_access is "direct"', () => {
    const onDownload = vi.fn();
    const media: ImageModalMedia[] = [{ ...mediaItems[0], download_access: 'direct' }];
    render(<ImageModal isOpen onClose={() => {}} media={media} canDownload onDownload={onDownload} />);
    fireEvent.click(screen.getByTitle('Download original'));
    expect(onDownload).toHaveBeenCalledWith(media[0]);
  });

  it('renders "Request download sizes" and fires onRequestDownload when access is "request"', () => {
    const onRequestDownload = vi.fn();
    const media: ImageModalMedia[] = [{ ...mediaItems[0], download_access: 'request' }];
    render(
      <ImageModal
        isOpen
        onClose={() => {}}
        media={media}
        canDownload
        onDownload={vi.fn()}
        onRequestDownload={onRequestDownload}
      />,
    );
    // The direct-download button must NOT show for request-gated assets.
    expect(screen.queryByTitle('Download original')).toBeNull();
    fireEvent.click(screen.getByTitle('Request download sizes'));
    expect(onRequestDownload).toHaveBeenCalledWith(media[0]);
  });

  it('renders a disabled download button when access is "blocked"', () => {
    const media: ImageModalMedia[] = [{ ...mediaItems[0], download_access: 'blocked' }];
    render(<ImageModal isOpen onClose={() => {}} media={media} canDownload onDownload={vi.fn()} />);
    const blocked = screen.getByTitle('Rights expired or restricted — download unavailable');
    expect(blocked).toBeDisabled();
    expect(screen.queryByTitle('Download original')).toBeNull();
  });

  it('hides the whole download cluster when canDownload is false', () => {
    const media: ImageModalMedia[] = [{ ...mediaItems[0], download_access: 'direct' }];
    render(<ImageModal isOpen onClose={() => {}} media={media} canDownload={false} onDownload={vi.fn()} />);
    expect(screen.queryByTitle('Download original')).toBeNull();
    expect(screen.queryByTitle('Request download sizes')).toBeNull();
  });

  it('renders "Open in Media" and fires onOpenInMedia for the current image', () => {
    const onOpenInMedia = vi.fn();
    const media: ImageModalMedia[] = [{ ...mediaItems[0], download_access: 'request' }];
    render(
      <ImageModal isOpen onClose={() => {}} media={media} canDownload onOpenInMedia={onOpenInMedia} />,
    );
    fireEvent.click(screen.getByTitle('Open in Media'));
    expect(onOpenInMedia).toHaveBeenCalledWith(media[0]);
  });

  it('shows "Open in Media" even without download permission', () => {
    // The escape hatch only views the asset record, so it is not gated on canDownload.
    const onOpenInMedia = vi.fn();
    render(
      <ImageModal isOpen onClose={() => {}} media={mediaItems} canDownload={false} onOpenInMedia={onOpenInMedia} />,
    );
    expect(screen.getByTitle('Open in Media')).toBeInTheDocument();
  });

  it('branches per current image as the gallery navigates', () => {
    const onDownload = vi.fn();
    const onRequestDownload = vi.fn();
    const media: ImageModalMedia[] = [
      { ...mediaItems[0], download_access: 'direct' },
      { ...mediaItems[1], download_access: 'request' },
    ];
    render(
      <ImageModal
        isOpen
        onClose={() => {}}
        media={media}
        canDownload
        onDownload={onDownload}
        onRequestDownload={onRequestDownload}
      />,
    );
    expect(screen.getByTitle('Download original')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Next image'));
    expect(screen.queryByTitle('Download original')).toBeNull();
    expect(screen.getByTitle('Request download sizes')).toBeInTheDocument();
  });

  it('renders zoom controls', () => {
    render(<ImageModal isOpen={true} onClose={() => {}} media={mediaItems} />);
    expect(screen.getByTitle('100% zoom')).toBeInTheDocument();
    expect(screen.getByTitle('200% zoom')).toBeInTheDocument();
    expect(screen.getByTitle('Fit to screen')).toBeInTheDocument();
  });

  it('renders the thumbnail strip when there are multiple images', () => {
    render(<ImageModal isOpen={true} onClose={() => {}} media={mediaItems} />);
    // 3 thumbnails in the strip + the main image
    expect(screen.getAllByLabelText(/View image/).length).toBe(3);
  });

  it('does not render navigation when there is only one image', () => {
    render(<ImageModal isOpen={true} onClose={() => {}} media={[mediaItems[0]]} />);
    expect(screen.queryByLabelText('Previous image')).toBeNull();
    expect(screen.queryByLabelText('Next image')).toBeNull();
  });

  it('uses filename when title is missing', () => {
    render(
      <ImageModal
        isOpen={true}
        onClose={() => {}}
        media={[{ id: 'm', url: '/u', filename: 'some.png' }]}
      />,
    );
    expect(screen.getByText('some.png')).toBeInTheDocument();
  });
});
