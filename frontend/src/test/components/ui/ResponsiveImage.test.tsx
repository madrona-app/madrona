import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ResponsiveImage } from '../../../components/ui/ResponsiveImage';

describe('ResponsiveImage', () => {
  it('renders a plain <img> when no srcset provided', () => {
    const { container } = render(<ResponsiveImage src="/x.jpg" alt="test" />);
    const picture = container.querySelector('picture');
    const img = container.querySelector('img');
    expect(picture).toBeNull();
    expect(img).toHaveAttribute('src', '/x.jpg');
    expect(img).toHaveAttribute('alt', 'test');
  });

  it('renders a plain <img> when srcset is null', () => {
    const { container } = render(<ResponsiveImage src="/x.jpg" alt="x" srcset={null} />);
    expect(container.querySelector('picture')).toBeNull();
  });

  it('renders a plain <img> when srcset has empty arrays', () => {
    const { container } = render(
      <ResponsiveImage src="/x.jpg" alt="x" srcset={{ webp: [], jpeg: [] } as never} />,
    );
    expect(container.querySelector('picture')).toBeNull();
  });

  it('renders <picture> with webp source when webp srcset provided', () => {
    const { container } = render(
      <ResponsiveImage
        src="/x.jpg"
        alt="x"
        srcset={{ webp: [{ url: '/x.webp', width: 800 }] } as never}
      />,
    );
    expect(container.querySelector('picture')).toBeInTheDocument();
    const webpSource = container.querySelector('source[type="image/webp"]');
    expect(webpSource).toHaveAttribute('srcset', '/x.webp 800w');
  });

  it('renders <picture> with jpeg source when jpeg srcset provided', () => {
    const { container } = render(
      <ResponsiveImage
        src="/x.jpg"
        alt="x"
        srcset={{ jpeg: [{ url: '/x.jpg', width: 1200 }] } as never}
      />,
    );
    const jpegSource = container.querySelector('source[type="image/jpeg"]');
    expect(jpegSource).toHaveAttribute('srcset', '/x.jpg 1200w');
  });

  it('renders both webp and jpeg sources when both provided', () => {
    const { container } = render(
      <ResponsiveImage
        src="/x.jpg"
        alt="x"
        srcset={{
          webp: [{ url: '/x.webp', width: 800 }, { url: '/x2.webp', width: 1600 }],
          jpeg: [{ url: '/x.jpg', width: 800 }],
        } as never}
      />,
    );
    expect(container.querySelector('source[type="image/webp"]')).toBeInTheDocument();
    expect(container.querySelector('source[type="image/jpeg"]')).toBeInTheDocument();
  });

  it('joins multiple widths into a single srcset string', () => {
    const { container } = render(
      <ResponsiveImage
        src="/x.jpg"
        alt="x"
        srcset={{
          webp: [
            { url: '/x-400.webp', width: 400 },
            { url: '/x-800.webp', width: 800 },
          ],
        } as never}
      />,
    );
    const webpSource = container.querySelector('source[type="image/webp"]');
    expect(webpSource).toHaveAttribute('srcset', '/x-400.webp 400w, /x-800.webp 800w');
  });

  it('passes sizes attribute to source and img', () => {
    const { container } = render(
      <ResponsiveImage
        src="/x.jpg"
        alt="x"
        sizes="(max-width: 768px) 100vw, 50vw"
        srcset={{ webp: [{ url: '/x.webp', width: 400 }] } as never}
      />,
    );
    const source = container.querySelector('source');
    expect(source).toHaveAttribute('sizes', '(max-width: 768px) 100vw, 50vw');
    expect(container.querySelector('img')).toHaveAttribute('sizes', '(max-width: 768px) 100vw, 50vw');
  });

  it('uses lazy loading by default', () => {
    const { container } = render(<ResponsiveImage src="/x.jpg" alt="x" />);
    expect(container.querySelector('img')).toHaveAttribute('loading', 'lazy');
  });

  it('respects eager loading when set', () => {
    const { container } = render(<ResponsiveImage src="/x.jpg" alt="x" loading="eager" />);
    expect(container.querySelector('img')).toHaveAttribute('loading', 'eager');
  });

  it('applies className to the img', () => {
    const { container } = render(<ResponsiveImage src="/x.jpg" alt="x" className="rounded" />);
    expect(container.querySelector('img')).toHaveClass('rounded');
  });
});
