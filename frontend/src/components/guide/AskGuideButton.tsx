/**
 * AskGuideButton — a reusable "ask the Guide about this" chip.
 *
 * Hands a pre-filled prompt to the Guide chat panel via the existing
 * `openChatWithMessage` API (same path the Cmd+K palette uses). The
 * button keeps `pendingMessage` handling centralized in AgentChatContext
 * so callers never talk to the chat hook directly.
 *
 * Two visual variants:
 *   - `chip` (default) — small pill-shaped button for docked positions
 *     like next to a "Fix blocker" CTA
 *   - `inline` — underline link for dense contexts like tooltips
 *
 * Both variants use the Madrona palette (bark text, bark/10 hover) and carry
 * focus-visible rings for keyboard users. The label stays plain text — this is a
 * small operational CTA, not a brand surface, so the italic Guide wordmark
 * (which is hard to read at button scale) is intentionally not used here. The
 * Guide wordmark lives in brand contexts like the chat-dock header. No icon (§8).
 */

import { useCallback, useContext } from 'react';
import { useAgentChatContext } from '../../contexts/AgentChatContext';
import { AuthContext } from '../../contexts/AuthContext';

export interface AskGuideButtonProps {
  /** The exact message the Guide chat will auto-send on open. */
  prompt: string;
  /** Button label. Defaults to a generic "Ask Guide". */
  label?: string;
  /** Visual variant. */
  variant?: 'chip' | 'inline';
  /** Compact size. */
  size?: 'sm' | 'md';
  /** aria-label override when the visible label isn't descriptive enough. */
  ariaLabel?: string;
  /** Optional extra className to merge on the root. */
  className?: string;
}

export function AskGuideButton({
  prompt,
  label = 'Ask Guide',
  variant = 'chip',
  size = 'sm',
  ariaLabel,
  className = '',
}: AskGuideButtonProps) {
  const { openChatWithMessage } = useAgentChatContext();
  // Read the context directly rather than through useAuth, which throws when
  // no provider is mounted. This is a presentational chip rendered inside
  // requirement cards and field tooltips; making it hard-require the auth
  // provider broke twelve tests that render those in isolation, and would
  // equally break any future non-app surface. Absence of a provider means no
  // information, not "no agent".
  const auth = useContext(AuthContext);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      // Stop propagation so parent handlers (row click, tooltip close, etc.)
      // don't swallow the open. The Guide panel opens synchronously via
      // context setState; `openChatWithMessage` handles the auto-send on the
      // next effect tick.
      e.stopPropagation();
      e.preventDefault();
      openChatWithMessage(prompt);
    },
    [openChatWithMessage, prompt],
  );

  // A deployment with no agent configured (AGENT_ENABLED=false, or no API
  // key) serves 503 "Agent is not enabled" from every agent route, so this
  // chip would open the chat panel onto an error. AppShell already withholds
  // the Ask Guide FAB on exactly this signal; the chip is the same affordance
  // in a docked position and had never consulted it, so requirement cards and
  // field tooltips kept offering it.
  //
  // Note this is deliberately not gated on the Guide *application* being
  // enabled: lite chat is part of base Madrona, and the subscription gate
  // lives in the chat backend. The question here is narrower — can the
  // deployment answer at all.
  // Only an explicit false hides it: unknown state keeps existing behavior.
  if (auth?.user?.agent_enabled === false) {
    return null;
  }

  if (variant === 'inline') {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={ariaLabel || label}
        className={`inline-flex items-center gap-1 text-bark hover:text-copper-dark underline decoration-1 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-1 rounded ${className}`}
      >
        <span>{label}</span>
      </button>
    );
  }

  const padY = size === 'md' ? 'py-1.5' : 'py-1';
  const padX = size === 'md' ? 'px-3' : 'px-2.5';
  const text = size === 'md' ? 'text-sm' : 'text-xs';

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel || label}
      className={`inline-flex items-center gap-1.5 ${padX} ${padY} ${text} font-medium text-bark bg-parchment border border-lichen rounded-md hover:bg-bark/10 hover:border-bark/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-1 transition-colors ${className}`}
    >
      <span>{label}</span>
    </button>
  );
}
