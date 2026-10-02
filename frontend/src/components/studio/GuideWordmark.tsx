import { cn } from '../../lib/utils';

/**
 * Guide wordmark (Guide Studio brand spec §11). Cormorant Garamond, weight 500,
 * copper — but ITALIC. The italic treatment is the typographic shorthand for the
 * intelligence layer's *voice* (Guide), as opposed to the roman *production*
 * mark (Studio, see StudioWordmark). Same face, same copper; style carries the
 * role. Per §8 Guide is signaled typographically + chromatically, never with a
 * speech bubble / face / robot.
 */
interface GuideWordmarkProps {
  /** Muted copper (bark) for high-density/secondary contexts (spec §5). */
  muted?: boolean;
  className?: string;
}

export function GuideWordmark({ muted = false, className }: GuideWordmarkProps) {
  return (
    <span
      className={cn(
        'font-display font-medium italic tracking-normal',
        muted ? 'text-bark' : 'text-copper',
        className,
      )}
    >
      Guide
    </span>
  );
}

export default GuideWordmark;
