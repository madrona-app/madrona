import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';

/**
 * Studio launcher card (brand spec §6): a forest-filled card, distinct from the
 * parchment cards used for the holdings products — the visual cue that this is
 * the intelligence layer, not data. On the dark ground the avatar inverts
 * (parchment circle, copper "S") and the wordmark is parchment, not copper.
 *
 * Used as the branded hero for an empty Studio inbox (Plans/Drafts). Renders a
 * Link when `to` is given, else a static panel.
 */
interface StudioLauncherCardProps {
  /** Descriptor copy — Studio voice (§9): "Studio drafts…", not "AI helps…". */
  descriptor?: ReactNode;
  /** Optional navigation target; omit for an informational (non-link) card. */
  to?: string;
  className?: string;
}

export function StudioLauncherCard({ descriptor, to, className }: StudioLauncherCardProps) {
  const inner = (
    <>
      <div className="flex items-center gap-3">
        {/* Inverted avatar: parchment circle, copper S (§6). */}
        <span
          className="inline-grid place-items-center rounded-full bg-parchment text-copper font-display select-none"
          style={{ width: 24, height: 24 }}
          aria-hidden
        >
          <span className="not-italic leading-none" style={{ fontSize: 15, fontWeight: 600 }}>S</span>
        </span>
        {/* Wordmark is parchment on the forest ground, not copper. */}
        <span className="font-display font-medium not-italic text-xl text-parchment">Studio</span>
      </div>
      {descriptor && (
        <p className="font-sans text-[11px] leading-relaxed text-parchment/70 mt-2 max-w-sm">
          {descriptor}
        </p>
      )}
    </>
  );

  const classes = cn('block rounded-lg bg-forest px-5 py-4', to && 'transition-opacity hover:opacity-90', className);

  return to ? (
    <Link to={to} className={classes} aria-label="Studio">{inner}</Link>
  ) : (
    <div className={classes} role="note" aria-label="Studio">{inner}</div>
  );
}

export default StudioLauncherCard;
