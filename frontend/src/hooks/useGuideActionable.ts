/**
 * useGuideActionable — does the current page have concrete Guide-actionable
 * state the user is likely stuck on?
 *
 * Reads the live PageContext (workflow state) and returns a strong signal
 * suitable for visual nudges like a FAB pulse. Intentionally narrow —
 * only pulses when there's a specific thing Guide can actually help
 * resolve, not just "user is on a form".
 *
 * Trigger: `workflow.blockingCount > 0`. ProcedureRequirementsCard pushes
 * this on every procedure workflow page regardless of which per-page hook
 * the page uses, so this gate fires consistently across the app.
 *
 * Earlier versions of this hook also required `editMode === true`, but
 * the edit-mode field is only pushed by the shared `useWorkspacePage`
 * hook, which most workflow pages don't use (they have bespoke
 * `useLoanInWorkspace`/`useAcquisitionWorkspace`/etc. hooks). Gating
 * on it suppressed the nudge everywhere except a handful of pages, so
 * we dropped it. Viewers seeing the pulse on a blocked record is a
 * minor cost compared to editors missing it completely.
 *
 * The returned reason string is surfaced in the FAB title/aria-label so
 * keyboard and screen reader users know why the button is glowing.
 */

import { useMemo } from 'react';
import { usePageContext } from '../contexts/PageContext';

export interface GuideActionableState {
  actionable: boolean;
  /** Human-readable reason, suitable for a title or aria-label suffix. */
  reason: string | null;
}

export function useGuideActionable(): GuideActionableState {
  const { pageContext, hasProvider } = usePageContext();

  return useMemo<GuideActionableState>(() => {
    if (!hasProvider) return { actionable: false, reason: null };
    const workflow = pageContext.workflow;
    if (!workflow || workflow.blockingCount <= 0) {
      return { actionable: false, reason: null };
    }
    const count = workflow.blockingCount;
    const noun = count === 1 ? 'requirement blocking' : 'requirements blocking';
    const firstBlocker = workflow.topBlockers[0];
    const reason = firstBlocker
      ? `${count} ${noun} next step: ${firstBlocker}`
      : `${count} ${noun} next step`;
    return { actionable: true, reason };
  }, [hasProvider, pageContext.workflow]);
}
