import { Lock } from 'lucide-react';

import { ErrorState } from './ErrorState';

/**
 * AccessDeniedState — what a surface shows when the server said 403.
 *
 * Distinct from <ErrorState /> on purpose. A permission failure is not a
 * transient fault: "Try again" is a false promise, and falling through to
 * <EmptyState /> is worse still, because "No pages yet" tells the reader the
 * collection is empty when in fact they are not allowed to see it.
 *
 * Renders no retry affordance. The only route forward is a permission change,
 * so the copy names what is missing instead.
 */
export function AccessDeniedState({
  what,
  requires,
  variant = 'default',
}: {
  /** What could not be shown, e.g. "pages". Used in the description. */
  what?: string;
  /** Permission the server asked for, when the response names one. */
  requires?: string;
  variant?: 'default' | 'compact' | 'inline';
}) {
  const subject = what ? `these ${what}` : 'this';
  return (
    <ErrorState
      icon={Lock}
      title="You don't have access"
      description={
        requires
          ? `Viewing ${subject} requires the ${requires} permission. Ask an administrator to grant it.`
          : `Your role doesn't include permission to view ${subject}. Ask an administrator for access.`
      }
      variant={variant}
    />
  );
}

/** True when a caught query error is the server refusing on permissions. */
export function isForbidden(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 403;
}
