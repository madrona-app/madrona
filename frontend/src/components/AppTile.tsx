import type { ComponentType } from 'react';
import { products } from '../lib/navigationConfig';

/**
 * App tile — the semantic glyph for an app in a colored rounded tile.
 *
 * Unifies the home "Workshop" treatment and the product selector: same colored
 * tile + same glyph for each app, everywhere. Replaces the older lettermark
 * monograms (which collided — Collections=C vs Content=O) with the app's
 * navigation glyph, which is semantic and unambiguous.
 *
 * Tile color follows the existing Workshop scheme (Guide=copper, others=forest)
 * to stay within the muted Madrona palette; the glyph differentiates apps.
 * Decorative — the adjacent label carries the name, so the tile is aria-hidden.
 */
const TILE_BG: Record<string, string> = {
  guide: 'bg-copper',
};

export function AppTile({
  appKey,
  className = 'w-7 h-7',
  iconSize = 16,
}: {
  appKey: string;
  /** Tailwind size box, e.g. "w-7 h-7" (default) or "w-6 h-6". */
  className?: string;
  iconSize?: number;
}) {
  const product = products.find((p) => p.id === appKey);
  const Icon = product?.icon as
    | ComponentType<{ size?: number; className?: string }>
    | undefined;
  const bg = TILE_BG[appKey] ?? 'bg-forest';

  return (
    <span
      className={`${className} ${bg} text-parchment rounded-md inline-flex items-center justify-center shrink-0`}
      aria-hidden="true"
    >
      {Icon ? <Icon size={iconSize} /> : null}
    </span>
  );
}

export default AppTile;
