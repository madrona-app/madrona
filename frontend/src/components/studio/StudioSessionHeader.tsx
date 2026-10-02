import { StudioAvatar } from './StudioAvatar';
import { cn } from '../../lib/utils';

/**
 * Studio session header (brand spec §6) — shown while Studio is actively working
 * a plan. The avatar + a status label, with the agent count and roles set in
 * IBM Plex Mono (technical metadata). Per §8 the avatar is NOT animated to
 * signal "working"; this header carries that meaning instead.
 *
 *   [S]  Currently drafting
 *        3 agents · Registrar, Conservator
 */
interface StudioSessionHeaderProps {
  /** Status label, e.g. "Currently drafting" / "Awaiting your input". */
  label: string;
  /** Distinct agent count (omit to hide the meta line). */
  agentCount?: number;
  /** Agent role labels, joined with " · " after the count. */
  roles?: string[];
  className?: string;
}

export function StudioSessionHeader({
  label,
  agentCount,
  roles = [],
  className,
}: StudioSessionHeaderProps) {
  const metaParts: string[] = [];
  if (agentCount != null) {
    metaParts.push(`${agentCount} ${agentCount === 1 ? 'agent' : 'agents'}`);
  }
  if (roles.length) metaParts.push(roles.join(', '));

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <StudioAvatar size={28} />
      <div className="min-w-0">
        <div className="font-sans text-[11px] font-medium uppercase tracking-[0.04em] text-archive">
          {label}
        </div>
        {metaParts.length > 0 && (
          <div className="font-mono text-[11px] text-archive truncate">
            {metaParts.join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

export default StudioSessionHeader;
