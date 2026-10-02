/**
 * ResponsiveImage — <picture> element with WebP + JPEG srcset support.
 *
 * Falls back gracefully to a plain <img> when no srcset data is available.
 */
import type { SrcSetData } from '../../types/discover';

interface ResponsiveImageProps {
  src: string;
  srcset?: SrcSetData | null;
  alt: string;
  sizes?: string;
  className?: string;
  loading?: 'lazy' | 'eager';
}

function buildSrcSetString(entries: { url: string; width: number }[]): string {
  return entries.map((e) => `${e.url} ${e.width}w`).join(', ');
}

export function ResponsiveImage({
  src,
  srcset,
  alt,
  sizes,
  className,
  loading = 'lazy',
}: ResponsiveImageProps) {
  const hasWebp = srcset?.webp && srcset.webp.length > 0;
  const hasJpeg = srcset?.jpeg && srcset.jpeg.length > 0;

  if (!hasWebp && !hasJpeg) {
    return (
      <img
        src={src}
        alt={alt}
        className={className}
        loading={loading}
      />
    );
  }

  return (
    <picture>
      {hasWebp && (
        <source
          type="image/webp"
          srcSet={buildSrcSetString(srcset.webp!)}
          sizes={sizes}
        />
      )}
      {hasJpeg && (
        <source
          type="image/jpeg"
          srcSet={buildSrcSetString(srcset.jpeg!)}
          sizes={sizes}
        />
      )}
      <img
        src={src}
        alt={alt}
        className={className}
        loading={loading}
        sizes={sizes}
      />
    </picture>
  );
}
