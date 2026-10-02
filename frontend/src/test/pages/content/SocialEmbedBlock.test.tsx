import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  SocialEmbedEditor,
  SocialEmbedRenderer,
} from '../../../pages/content/components/blocks/SocialEmbedBlock';

describe('SocialEmbedEditor', () => {
  it('renders platform select with default of YouTube', () => {
    const { container } = render(
      <SocialEmbedEditor content={{}} onChange={vi.fn()} />,
    );
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('youtube');
  });

  it('changes placeholder when platform is changed', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SocialEmbedEditor content={{ embed_type: 'youtube' }} onChange={onChange} />,
    );
    const select = container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'instagram' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ embed_type: 'instagram' }),
    );
  });

  it('emits embed_url and caption changes', () => {
    const onChange = vi.fn();
    render(<SocialEmbedEditor content={{}} onChange={onChange} />);
    fireEvent.change(
      screen.getByPlaceholderText(/youtube\.com\/watch/i),
      { target: { value: 'https://www.youtube.com/watch?v=xyz12345678' } },
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        embed_url: 'https://www.youtube.com/watch?v=xyz12345678',
      }),
    );
  });
});

describe('SocialEmbedRenderer', () => {
  it('renders invalid message when no embed url is given', () => {
    render(<SocialEmbedRenderer content={{}} />);
    expect(screen.getByText(/Invalid embed URL/i)).toBeInTheDocument();
  });

  it('renders an iframe for a YouTube URL', () => {
    const { container } = render(
      <SocialEmbedRenderer
        content={{
          embed_type: 'youtube',
          embed_url: 'https://www.youtube.com/watch?v=abcdef12345',
        }}
      />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toContain('youtube.com/embed/abcdef12345');
  });

  it('renders an iframe for a Vimeo URL', () => {
    const { container } = render(
      <SocialEmbedRenderer
        content={{ embed_type: 'vimeo', embed_url: 'https://vimeo.com/4242' }}
      />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toContain('player.vimeo.com/video/4242');
  });

  it('shows caption when provided', () => {
    render(
      <SocialEmbedRenderer
        content={{
          embed_type: 'youtube',
          embed_url: 'https://www.youtube.com/watch?v=abcdef12345',
          caption: 'A nice video',
        }}
      />,
    );
    expect(screen.getByText('A nice video')).toBeInTheDocument();
  });
});
