import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  VideoEditor,
  VideoRenderer,
} from '../../../pages/content/components/blocks/VideoBlock';

describe('VideoEditor', () => {
  it('shows success indicator when YouTube URL is recognized', () => {
    render(
      <VideoEditor
        content={{ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Embed URL detected')).toBeInTheDocument();
  });

  it('shows warning when URL cannot be parsed', () => {
    render(
      <VideoEditor
        content={{ url: 'https://example.com/not-a-video' }}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Could not parse embed URL/i),
    ).toBeInTheDocument();
  });

  it('emits onChange when URL is edited', () => {
    const onChange = vi.fn();
    render(<VideoEditor content={{}} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/youtube\.com\/watch/i), {
      target: { value: 'https://youtu.be/dQw4w9WgXcQ' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
    );
  });
});

describe('VideoRenderer', () => {
  it('renders fallback when URL is empty', () => {
    render(<VideoRenderer content={{}} />);
    expect(screen.getByText(/No video URL provided/i)).toBeInTheDocument();
  });

  it('renders fallback for unsupported URL', () => {
    render(<VideoRenderer content={{ url: 'https://example.com/foo' }} />);
    expect(screen.getByText(/Unsupported video URL/i)).toBeInTheDocument();
  });

  it('renders an iframe with embed URL for YouTube short link', () => {
    const { container } = render(
      <VideoRenderer content={{ url: 'https://youtu.be/abcdefghijk' }} />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toContain('youtube.com/embed/abcdefghijk');
  });

  it('renders Vimeo embed URL', () => {
    const { container } = render(
      <VideoRenderer content={{ url: 'https://vimeo.com/123456' }} />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toContain('player.vimeo.com/video/123456');
  });
});
