import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  HeroBannerEditor,
  HeroBannerRenderer,
} from '../../../pages/content/components/blocks/HeroBannerBlock';

vi.mock('../../../components/content/MediaPickerModal', () => ({
  MediaPickerModal: ({
    isOpen,
    onClose,
    onSelect,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (id: string) => void;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="picker-stub">
        <button onClick={() => onSelect('media-xyz')}>pick-media</button>
        <button onClick={onClose}>close</button>
      </div>
    ) : null,
}));

vi.mock('../../../components/ui/ResponsiveImage', () => ({
  ResponsiveImage: (props: { src: string; alt: string; className?: string }) => (
    <img src={props.src} alt={props.alt} className={props.className} />
  ),
}));

describe('HeroBannerEditor', () => {
  it('renders title, subtitle, and CTA inputs', () => {
    render(
      <HeroBannerEditor content={{}} onChange={vi.fn()} organizationId="o-1" />,
    );
    expect(screen.getByPlaceholderText('Banner headline')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Supporting text')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Explore Collection/i)).toBeInTheDocument();
  });

  it('emits onChange when title is set', () => {
    const onChange = vi.fn();
    render(<HeroBannerEditor content={{}} onChange={onChange} organizationId="o-1" />);
    fireEvent.change(screen.getByPlaceholderText('Banner headline'), {
      target: { value: 'Welcome' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Welcome' }),
    );
  });

  it('opens picker, then sets media_id when picker selects', () => {
    const onChange = vi.fn();
    render(<HeroBannerEditor content={{}} onChange={onChange} organizationId="o-1" />);
    fireEvent.click(
      screen.getByRole('button', { name: /Browse media library/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'pick-media' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ media_id: 'media-xyz' }),
    );
  });

  it('removes selected media on remove button', () => {
    const onChange = vi.fn();
    render(
      <HeroBannerEditor
        content={{ media_id: 'm-1' }}
        onChange={onChange}
        organizationId="o-1"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ media_id: '' }),
    );
  });
});

describe('HeroBannerRenderer', () => {
  it('renders the title heading', () => {
    render(<HeroBannerRenderer content={{ title: 'Hello' }} />);
    expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(
      <HeroBannerRenderer content={{ title: 'T', subtitle: 'subtitle text' }} />,
    );
    expect(screen.getByText('subtitle text')).toBeInTheDocument();
  });

  it('renders CTA link only when text+url both set', () => {
    render(
      <HeroBannerRenderer
        content={{ title: 'T', cta_text: 'Click', cta_url: '/x' }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Click' })).toHaveAttribute(
      'href',
      '/x',
    );
  });
});
