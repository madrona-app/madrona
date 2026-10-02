import { useState } from 'react';
import { ShieldCheck, ShieldAlert, Shield } from 'lucide-react';
import type { ProcedureValidation } from '../../lib/api/drafts';

/**
 * ProcedurePreApprovalRibbon — a trust marker on a Studio-proposed draft: it
 * names the procedure the draft follows and reports its payload against
 * that procedure's proposal-stage blocking requirements (§7).
 *
 * Honest by construction — the green "checked" claim is only made when there was
 * something to check:
 *  - requirements exist and all met → success ("meets N/N requirements")
 *  - requirements exist, some unmet → warning, listing the gaps
 *  - no proposal-stage requirements → NEUTRAL "follows the procedure" — never a
 *    green "validated", because nothing was actually validated.
 */
export function ProcedurePreApprovalRibbon({
  procedure,
  className,
}: {
  procedure: ProcedureValidation;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { passed, procedure_label, blocking_total, blocking_met, missing } = procedure;

  const nothingChecked = blocking_total === 0;
  const Icon = nothingChecked ? Shield : passed ? ShieldCheck : ShieldAlert;
  const tone = nothingChecked
    ? 'bg-stone/40 text-archive border-lichen'
    : passed
      ? 'bg-semantic-success/10 text-semantic-success border-semantic-success/30'
      : 'bg-semantic-warning/10 text-semantic-warning border-semantic-warning/30';
  const detail = nothingChecked
    ? 'follows the procedure'
    : passed
      ? `meets ${blocking_met}/${blocking_total} requirements`
      : `${missing.length} requirement${missing.length !== 1 ? 's' : ''} to resolve`;

  const canExpand = !passed && !nothingChecked && missing.length > 0;

  return (
    <span className={`inline-flex flex-col gap-1 ${className ?? ''}`}>
      <button
        type="button"
        onClick={canExpand ? () => setOpen((v) => !v) : undefined}
        aria-expanded={canExpand ? open : undefined}
        title={`${procedure_label} procedure — ${detail}`}
        className={`inline-flex items-center gap-1.5 self-start rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone} ${
          canExpand ? 'cursor-pointer hover:brightness-95 focus-visible:ring-2 ring-bark/30 ring-offset-1' : 'cursor-default'
        }`}
      >
        <Icon size={13} aria-hidden />
        <span>{procedure_label}</span>
        <span className="opacity-75">· {detail}</span>
      </button>
      {canExpand && open && (
        <ul className="ml-1 flex flex-col gap-0.5 text-xs text-semantic-warning">
          {missing.map((m) => (
            <li key={m.id} className="flex items-center gap-1.5">
              <span className="h-1 w-1 shrink-0 rounded-full bg-semantic-warning" aria-hidden />
              {m.label}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

export default ProcedurePreApprovalRibbon;
