import { cn } from '../../lib/utils';

/**
 * Studio wordmark (Guide Studio brand spec §3).
 *
 * Cormorant Garamond, weight 500, copper. The roman (upright) treatment is
 * structural: it distinguishes Studio (production) from Guide (voice), which
 * uses the italic of the same face. In the full lockup, "Guide" is italic and
 * "Studio" is roman.
 *
 *   <StudioWordmark />               → Studio   (in-product short form)
 *   <StudioWordmark variant="full"/> → Guide Studio
 *   <StudioWordmark muted />         → muted copper (bark) for metadata/attribution
 */
interface StudioWordmarkProps {
  /** 'short' = "Studio" (default, in-product); 'full' = "Guide Studio" (external). */
  variant?: 'short' | 'full';
  /**
   * Use the muted copper variant (bark) for high-density daily-use contexts —
   * breadcrumbs, audit trails — to reduce eye fatigue (spec §5).
   */
  muted?: boolean;
  className?: string;
}

export function StudioWordmark({
  variant = 'short',
  muted = false,
  className,
}: StudioWordmarkProps) {
  return (
    <span
      className={cn(
        'font-display font-medium tracking-normal',
        muted ? 'text-bark' : 'text-copper',
        className,
      )}
    >
      {variant === 'full' && <span className="italic">Guide </span>}
      <span className="not-italic">Studio</span>
    </span>
  );
}

export default StudioWordmark;
