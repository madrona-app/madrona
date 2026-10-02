/**
 * §2E / §4 — the "show the power" header for an orchestration plan.
 *
 * One line states the story: how many of N steps ran, across how many
 * specialists, and the work done (tool calls · time). The raw token/cost totals
 * are DEMOTED behind a "details" toggle (the buyer who cares can expand; nobody
 * else is taxed). A failed plan shows a distinct error banner — never confused
 * with "needs you". A mini sparkline shows where the AI worked hardest.
 */
import { useState } from 'react';
import { ArrowRight, AlertTriangle } from 'lucide-react';

import type { AgentPlanDetail } from '../../lib/api/agentPlans';
import {
  effortColor,
  formatCost,
  formatDuration,
  formatTokens,
} from '../../lib/planEffort';

interface PlanSummaryHeaderProps {
  detail: AgentPlanDetail;
}

export function PlanSummaryHeader({ detail }: PlanSummaryHeaderProps) {
  const summary = detail.effort_summary;
  const steps = detail.steps;
  const [showDetails, setShowDetails] = useState(false);

  const specialists = new Set(
    steps.filter((s) => s.kind === 'delegate' && s.persona).map((s) => s.persona),
  );
  const ran = steps.filter((s) => s.status === 'completed').length;
  const awaitingStep = detail.awaiting_step_id
    ? steps.find((s) => s.step_id === detail.awaiting_step_id)
    : null;
  const failed = detail.status === 'failed';

  // Lead line: work done (tool calls · time). Tokens/cost are behind details.
  const lead: string[] = [];
  if (summary) {
    if (summary.total_tool_calls) {
      lead.push(`${summary.total_tool_calls} ${summary.total_tool_calls === 1 ? 'tool call' : 'tool calls'}`);
    }
    const dur = formatDuration(summary.total_latency_ms || null);
    if (dur) lead.push(dur);
  }
  const tok = formatTokens(summary?.total_tokens || null);
  const cost = formatCost(summary?.cost_estimate_usd);
  const hasDetails = !!(tok || cost);

  return (
    <div
      className="rounded-md border border-lichen bg-parchment-warm px-3 py-2.5"
      data-testid="plan-summary-header"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink">
            <span className="font-semibold text-forest">
              {ran > 0
                ? `The AI ran ${ran} of ${detail.step_count} ${detail.step_count === 1 ? 'step' : 'steps'}`
                : `${detail.step_count} ${detail.step_count === 1 ? 'step' : 'steps'} planned`}
            </span>
            {specialists.size > 0 && (
              <span className="text-ink">
                {' '}across {specialists.size}{' '}
                {specialists.size === 1 ? 'specialist' : 'specialists'}
              </span>
            )}
            {lead.length > 0 && <span className="text-archive"> · {lead.join(' · ')}</span>}
            {hasDetails && (
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className="ml-2 text-[11px] text-bark hover:text-copper-dark"
              >
                details {showDetails ? '▴' : '▾'}
              </button>
            )}
          </p>

          {showDetails && hasDetails && (
            <p className="mt-0.5 font-mono text-[11px] text-archive/80">
              {[tok && `≈${tok}`, cost && `≈${cost}`].filter(Boolean).join(' · ')}
            </p>
          )}

          {failed ? (
            <p className="mt-1 inline-flex items-start gap-1 text-sm text-semantic-error">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
              <span><span className="font-medium">This plan failed.</span>{detail.last_error ? ` ${detail.last_error}` : ''}</span>
            </p>
          ) : awaitingStep ? (
            <p className="mt-1 inline-flex items-center gap-1 text-sm text-bark">
              <ArrowRight size={13} aria-hidden />
              <span className="font-medium">One thing needs you:</span>
              <span className="truncate">{awaitingStep.description}</span>
            </p>
          ) : detail.status === 'completed' ? (
            <p className="mt-0.5 text-xs text-semantic-success">All steps complete.</p>
          ) : null}
        </div>

        <EffortSparkline detail={detail} />
      </div>
    </div>
  );
}

/** A mini bar-per-step sparkline of normalized effort weights. */
function EffortSparkline({ detail }: { detail: AgentPlanDetail }) {
  const bars = detail.steps
    .filter((s) => s.kind !== 'await')
    .map((s) => s.effort?.weight ?? 0);
  if (bars.length === 0) return null;
  return (
    <div
      className="hidden h-7 items-end gap-0.5 sm:flex"
      aria-hidden
      title="Per-step effort"
    >
      {bars.map((w, i) => (
        <div
          key={i}
          className="w-1 rounded-sm"
          style={{
            height: `${Math.max(10, w * 100)}%`,
            backgroundColor: effortColor(w),
          }}
        />
      ))}
    </div>
  );
}
