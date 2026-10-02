import { cn } from '../../lib/utils';

/**
 * Studio avatar (Guide Studio brand spec §4): a forest circle containing a roman
 * capital "S" in copper (Cormorant Garamond, weight 600). Holds down to favicon
 * scale because the upright S keeps its stems. Per spec §8, the avatar is NOT
 * animated to indicate work — use the session header treatment for that.
 */
interface StudioAvatarProps {
  /** Diameter in px. Spec sizes: hero 48–64, header 28–32, nav 22, list 20–24, favicon 16–20. */
  size?: number;
  className?: string;
  /** Accessible label; defaults to "Studio". */
  title?: string;
}

export function StudioAvatar({ size = 28, className, title = 'Studio' }: StudioAvatarProps) {
  return (
    <span
      role="img"
      aria-label={title}
      className={cn(
        'inline-grid place-items-center rounded-full bg-forest text-copper font-display select-none',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span className="not-italic leading-none" style={{ fontSize: Math.round(size * 0.6), fontWeight: 600 }}>
        S
      </span>
    </span>
  );
}

export default StudioAvatar;
