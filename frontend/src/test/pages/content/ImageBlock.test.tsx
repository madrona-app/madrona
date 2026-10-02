import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ImageEditor,
  ImageRenderer,
} from '../../../pages/content/components/blocks/ImageBlock';

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
      <div role="dialog">
        <button onClick={() => onSelect('img-42')}>pick</button>
        <button onClick={onClose}>x</button>
      </div>
    ) : null,
}));

vi.mock('../../../components/ui/ResponsiveImage', () => ({
  ResponsiveImage: (props: { src: string; alt: string }) => (
    <img src={props.src} alt={props.alt} />
  ),
}));

describe('ImageEditor', () => {
  it('renders alt text and caption inputs', () => {
    render(<ImageEditor content={{}} onChange={vi.fn()} organizationId="o-1" />);
    expect(
      screen.getByPlaceholderText(/Describe the image/i),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Optional caption/i),
    ).toBeInTheDocument();
  });

  it('emits onChange for alt edits', () => {
    const onChange = vi.fn();
    render(<ImageEditor content={{}} onChange={onChange} organizationId="o-1" />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the image/i), {
      target: { value: 'A painting' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ alt: 'A painting' }),
    );
  });

  it('emits onChange for size dropdown', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ImageEditor content={{}} onChange={onChange} organizationId="o-1" />,
    );
    const select = container.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'small' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ size: 'small' }),
    );
  });

  it('selecting from media picker sets media_id', () => {
    const onChange = vi.fn();
    render(<ImageEditor content={{}} onChange={onChange} organizationId="o-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Browse media library/i }));
    fireEvent.click(screen.getByRole('button', { name: 'pick' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ media_id: 'img-42' }),
    );
  });
});

describe('ImageRenderer', () => {
  it('renders an empty state when no image is set', () => {
    render(<ImageRenderer content={{}} />);
    expect(screen.getByText(/No image selected/i)).toBeInTheDocument();
  });

  it('renders the image with caption', () => {
    render(
      <ImageRenderer
        content={{ media_id: 'a', caption: 'A flower', alt: 'flower' }}
      />,
    );
    expect(screen.getByAltText('flower')).toBeInTheDocument();
    expect(screen.getByText('A flower')).toBeInTheDocument();
  });
});
