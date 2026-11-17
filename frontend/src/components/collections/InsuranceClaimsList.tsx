import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { getInsuranceClaims } from '../../lib/api';
import type { InsuranceClaim } from '../../lib/api';
import { formatCurrency, formatDateShort } from '../../lib/formatters';
import { RecordAuditHistory } from '../workspace/RecordAuditHistory';

/**
 * Claims made against an insurance policy or an indemnity arrangement, each
 * with its own change history behind a disclosure button.
 *
 * Claims have no page of their own, so this is where staff read what was
 * claimed, what was settled, and who changed it when.
 */

export interface InsuranceClaimsListProps {
  organizationId: string;
  /** Claims on this policy's coverages. */
  policyId?: string;
  /** Claims under this indemnity arrangement. */
  indemnityId?: string;
  /** Show each claim's change history (needs org.view_audit_logs). */
  canViewHistory: boolean;
  /** Heading level for each claim (the section heading is one above). */
  headingLevel?: 3 | 4;
}

function claimName(claim: InsuranceClaim): string {
  if (claim.claim_number) return `Claim ${claim.claim_number}`;
  if (claim.insurer_claim_number) return `Insurer claim ${claim.insurer_claim_number}`;
  if (claim.date_of_loss) return `Claim for loss on ${formatDateShort(claim.date_of_loss)}`;
  return 'Claim without a reference';
}

function money(amount: number | null | undefined, currency: string): string | null {
  return amount == null ? null : formatCurrency(amount, currency || 'USD');
}

function ClaimItem({
  claim,
  organizationId,
  canViewHistory,
  headingLevel,
}: {
  claim: InsuranceClaim;
  organizationId: string;
  canViewHistory: boolean;
  headingLevel: 3 | 4;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const name = claimName(claim);
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const historyLevel = headingLevel === 3 ? 4 : 5;

  const facts: Array<[string, string | null | undefined]> = [
    ['Status', claim.status_label],
    ['Loss type', claim.loss_type_label],
    ['Date of loss', claim.date_of_loss ? formatDateShort(claim.date_of_loss) : null],
    ['Amount claimed', money(claim.claimed_amount, claim.amount_currency)],
    ['Settlement', money(claim.settlement_amount, claim.amount_currency)],
    ['Filed', claim.filed_date ? formatDateShort(claim.filed_date) : null],
    ['Settled', claim.settled_date ? formatDateShort(claim.settled_date) : null],
    ['Insurer reference', claim.claim_number ? claim.insurer_claim_number : null],
    ['Adjuster', claim.adjuster_name],
  ];

  return (
    <li className="border border-lichen rounded-lg bg-parchment p-3">
      <Heading className="text-sm font-semibold text-ink">{name}</Heading>
      <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {facts.filter(([, v]) => v).map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="text-archive">{label}:</dt>
            <dd className="text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {claim.loss_description && (
        <p className="mt-2 text-sm text-ink">{claim.loss_description}</p>
      )}
      {canViewHistory && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            className="mt-3 inline-flex items-center gap-1 min-h-[44px] px-3 text-sm text-bark hover:text-copper-dark border border-lichen rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          >
            {open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
            <span>{open ? 'Hide' : 'Show'} change history</span>{' '}
            <span className="sr-only">for {name}</span>
          </button>
          <div id={panelId} hidden={!open} className="mt-3">
            {open && (
              <RecordAuditHistory
                organizationId={organizationId}
                entityType="insurance_claim"
                entityId={claim.claim_id}
                title={`Change history: ${name}`}
                headingLevel={historyLevel}
              />
            )}
          </div>
        </>
      )}
    </li>
  );
}

export function InsuranceClaimsList({
  organizationId,
  policyId,
  indemnityId,
  canViewHistory,
  headingLevel = 3,
}: InsuranceClaimsListProps) {
  const params = policyId ? { policy_id: policyId } : { indemnity_id: indemnityId };
  const { data, isLoading, isError } = useQuery({
    queryKey: ['insurance-claims', organizationId, params],
    queryFn: () => getInsuranceClaims(organizationId, params),
    enabled: !!organizationId && !!(policyId || indemnityId),
  });

  if (isLoading) {
    return <p role="status" className="text-sm text-archive">Loading claims…</p>;
  }
  if (isError) {
    return <p role="alert" className="text-sm text-semantic-error">Claims could not be loaded.</p>;
  }
  const claims = data?.claims ?? [];
  if (claims.length === 0) {
    return (
      <p className="text-sm text-archive">
        No claims have been recorded against this {policyId ? 'policy' : 'arrangement'}.
      </p>
    );
  }
  return (
    <ul className="space-y-3" aria-label={`Claims (${claims.length})`}>
      {claims.map((claim) => (
        <ClaimItem
          key={claim.claim_id}
          claim={claim}
          organizationId={organizationId}
          canViewHistory={canViewHistory}
          headingLevel={headingLevel}
        />
      ))}
    </ul>
  );
}

export default InsuranceClaimsList;
