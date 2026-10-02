/**
 * Collapsed card shown inline in an assistant message when the staff agent
 * delegated to a specialist persona via `delegate_to_specialist`.
 *
 * Renders the specialist's headline, the answer body, and an expandable
 * trace of tool calls the specialist made. Marks errors/aborts with a
 * warning tint so the user knows when the specialist couldn't finish.
 */

import { useState } from 'react';
import { Network, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import type { AgentMessageUI } from '../../hooks/useAgentChat';

const SPECIALIST_LABELS: Record<string, string> = {
  registrar: 'Registrar',
  loans_registrar: 'Loans Registrar',
  conservator: 'Conservator',
  rights_specialist: 'Rights Specialist',
  curator: 'Curator',
};

type DelegationHint = AgentMessageUI & { kind: 'delegation' };

export function DelegationCard({ hint }: { hint: DelegationHint }) {
  const [open, setOpen] = useState(false);
  const label = SPECIALIST_LABELS[hint.specialist] ?? hint.specialist;
  const ToggleIcon = open ? ChevronDown : ChevronRight;
  const hasTrace = hint.tool_calls.length > 0;
  const errored = hint.aborted || !!hint.error;

  return (
    <div
      className={`mt-2 rounded-md border ${
        errored
          ? 'border-semantic-warning/40 bg-semantic-warning/5'
          : 'border-lichen bg-parchment'
      }`}
      data-testid="delegation-card"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-bark/5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30"
        aria-expanded={open}
      >
        <Network size={12} className="text-bark shrink-0" aria-hidden />
        <span className="font-medium text-ink">{label} said</span>
        {errored && (
          <AlertTriangle
            size={12}
            className="text-semantic-warning shrink-0"
            aria-hidden
          />
        )}
        <span className="ml-auto flex items-center gap-1 text-archive">
          {hasTrace && (
            <span className="text-[10px] uppercase tracking-wide">
              {hint.tool_calls.length} {hint.tool_calls.length === 1 ? 'tool' : 'tools'}
            </span>
          )}
          <ToggleIcon size={12} aria-hidden />
        </span>
      </button>
      <div className="px-3 pb-2 text-sm text-ink whitespace-pre-wrap leading-relaxed">
        {hint.answer || (
          <span className="italic text-archive">
            {hint.error
              ? `Specialist returned an error: ${hint.error}`
              : 'No answer returned.'}
          </span>
        )}
      </div>
      {open && hasTrace && (
        <ul className="border-t border-lichen px-3 py-2 space-y-1 text-xs text-archive">
          {hint.tool_calls.map((c, i) => (
            <li key={`${c.tool}-${i}`} className="flex items-center gap-2">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  c.succeeded ? 'bg-semantic-success' : 'bg-semantic-error'
                }`}
                aria-hidden
              />
              <span className="font-mono">{c.tool}</span>
              <span className="text-[10px] text-archive">{c.duration_ms}ms</span>
              {c.error && (
                <span className="text-semantic-error truncate" title={c.error}>
                  {c.error}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
