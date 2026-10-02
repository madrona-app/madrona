import { Link } from 'react-router-dom';
import {
  Download,
  CheckCircle,
  Clock,
  ArrowRight,
  LogOut,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { UseMutationResult } from '@tanstack/react-query';
import type { LoanInStatus, FormData } from './types';
import { STATUS_CONFIG, WORKFLOW_PHASES, getPhaseIndex, getPhaseSubIndex } from './types';
import { ChangeStatusDropdown } from '../../../components/collections/ChangeStatusDropdown';
import type { LoanIn } from '../../../lib/schemas';

interface StatusSectionProps {
  orgId: string;
  loanId: string;
  loan: LoanIn;
  formData: FormData;
  daysRemaining: number | null;
  statusMutation: UseMutationResult<LoanIn, Error, LoanInStatus, unknown>;
  deleteMutation: UseMutationResult<{ success: boolean }, Error, void, unknown>;
  handleStatusAdvancement: (targetStatus: LoanInStatus, targetStatusLabel: string) => void;
  handleDelete: () => void;
  purposeLabel: string;
  hasPermission?: (permission: string) => boolean;
  rollbackMutation?: UseMutationResult<LoanIn, Error, { targetStatus: string; reason: string }, unknown>;
  onRollback?: (targetStatus: string, targetStatusLabel: string) => void;
}

export function WorkflowProgressIndicator({ loan }: { loan: LoanIn }) {
  const status = loan.status || 'requested';

  if (status === 'cancelled') {
    return null;
  }

  const currentPhaseIdx = getPhaseIndex(status);
  const currentSubIdx = getPhaseSubIndex(status);
  const statusConfig = STATUS_CONFIG[status];

  // Hint text combines sub-status + short guidance. LoanIn has 11 possible
  // statuses grouped into 5 phases (Request / Agreement / Transit / Active /
  // Closing); the phase row renders just 5 circles to match the house style
  // used on other workspace pages (Object Entry, Loan Out, etc.) while the
  // sub-status is surfaced in the hint.
  const subStatusLabel = statusConfig?.label || '';
  const guidance =
    status === 'requested' ? 'Awaiting approval'
    : status === 'pending_approval' ? 'Pending approver review'
    : status === 'approved' ? 'Ready to send agreement'
    : status === 'agreement_sent' ? 'Awaiting signed agreement'
    : status === 'agreement_signed' ? 'Ready for transit'
    : status === 'in_transit' ? 'Objects in transit'
    : status === 'received' ? 'Mark as on loan when displayed'
    : status === 'on_loan' ? 'Objects currently on loan'
    : status === 'return_initiated' ? 'Return in progress'
    : status === 'returned' ? 'Awaiting closing tasks'
    : status === 'closed' ? 'Loan completed'
    : '';
  const hint = subStatusLabel && guidance
    ? `${subStatusLabel} · ${guidance}`
    : subStatusLabel || guidance;

  return (
    <div className="mb-6 p-4 bg-stone/30 rounded-lg">
      <div className="flex items-center justify-between mb-2 gap-3">
        <span className="text-sm font-medium text-ink">Loan Workflow</span>
        <span className="text-xs text-archive truncate">{hint}</span>
      </div>
      <div className="flex items-center gap-0.5 overflow-x-auto">
        {WORKFLOW_PHASES.map((phase, phaseIdx) => {
          const isComplete = phaseIdx < currentPhaseIdx;
          const isCurrent = phaseIdx === currentPhaseIdx;
          const isLast = phaseIdx === WORKFLOW_PHASES.length - 1;
          // Fraction of this phase that's complete — used to partially
          // fill the connector line coming out of an in-progress phase so
          // sub-progress through multi-status phases is still visible.
          const subProgress =
            isCurrent && phase.statuses.length > 1
              ? (currentSubIdx + 1) / phase.statuses.length
              : isComplete
              ? 1
              : 0;

          return (
            <div key={phase.id} className="flex items-center flex-1 min-w-0">
              <div
                className={cn(
                  'flex items-center justify-center flex-shrink-0 rounded-full text-xs font-medium transition-colors',
                  'w-6 h-6 sm:w-7 sm:h-7',
                  isComplete
                    ? 'bg-forest text-parchment'
                    : isCurrent
                    ? 'bg-copper text-parchment'
                    : 'bg-stone text-archive',
                )}
                title={`${phase.label}: ${phase.statuses
                  .map((s) => STATUS_CONFIG[s]?.label || s)
                  .join(', ')}`}
              >
                {isComplete ? <CheckCircle size={14} /> : phaseIdx + 1}
              </div>
              <span
                className={cn(
                  'ml-1 text-[10px] sm:text-xs font-medium hidden md:inline truncate',
                  isComplete || isCurrent ? 'text-ink' : 'text-archive',
                )}
              >
                {phase.label}
              </span>
              {!isLast && (
                <div className="flex-1 h-0.5 mx-1 bg-stone relative overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-forest transition-all"
                    style={{ width: `${subProgress * 100}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DaysRemainingAlert({
  daysRemaining,
  status
}: {
  daysRemaining: number | null;
  status: string;
}) {
  if (daysRemaining === null || daysRemaining < 0 || daysRemaining > 30 || status !== 'on_loan') {
    return null;
  }

  return (
    <div className="bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg p-4 mb-6">
      <div className="flex items-center gap-3">
        <Clock size={20} className="text-semantic-warning" />
        <div>
          <p className="font-medium text-ink">
            {daysRemaining === 0 ? 'Loan expires today!' : `${daysRemaining} days remaining`}
          </p>
          <p className="text-sm text-accessible-gray">
            Coordinate return or request renewal from lender.
          </p>
        </div>
      </div>
    </div>
  );
}

export function StatusBar({
  orgId,
  loanId,
  loan,
  formData,
  statusMutation,
  deleteMutation: _deleteMutation,
  handleStatusAdvancement,
  handleDelete: _handleDelete,
  purposeLabel,
  hasPermission: _hasPermission,
  rollbackMutation: _rollbackMutation,
  onRollback: _onRollback,
}: StatusSectionProps) {
  const status = loan.status || 'requested';
  const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG.requested;
  const StatusIcon = statusConfig.icon;

  return (
    <div className="flex items-center gap-4 mb-6">
      <span className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium', statusConfig.color)}>
        <StatusIcon size={16} />
        {statusConfig.label}
      </span>
      <span className="text-sm text-archive">{purposeLabel}</span>

      {/* Status Actions */}
      <div className="flex-1" />
      {/* Primary forward action */}
      {status === 'requested' && (
        <button
          onClick={() => handleStatusAdvancement('approved', 'Approved')}
          className="btn btn-primary text-sm"
          disabled={statusMutation.isPending}
        >
          <CheckCircle size={16} className="mr-1.5" />
          Approve
        </button>
      )}
      {status === 'approved' && (
        <button
          onClick={() => handleStatusAdvancement('received', 'Received')}
          className="btn btn-primary text-sm"
          disabled={statusMutation.isPending}
        >
          <Download size={16} className="mr-1.5" />
          Mark Received
        </button>
      )}
      {status === 'received' && (
        <button
          onClick={() => handleStatusAdvancement('on_loan', 'On Loan')}
          className="btn btn-primary text-sm"
          disabled={statusMutation.isPending}
        >
          <CheckCircle size={16} className="mr-1.5" />
          Mark On Loan
        </button>
      )}
      {status === 'on_loan' && (
        <button
          onClick={() => handleStatusAdvancement('returned', 'Returned')}
          className="btn btn-primary text-sm"
          disabled={statusMutation.isPending}
        >
          <ArrowRight size={16} className="mr-1.5" />
          Mark Returned
        </button>
      )}
      {status === 'returned' && (
        <Link
          to={`/organizations/${orgId}/collections/exits/create?reference_type=loan_in&reference_id=${loanId}&recipient_id=${formData.lender_id || ''}&exit_reason=loan_return`}
          className="btn btn-secondary text-sm flex items-center"
        >
          <LogOut size={16} className="mr-1.5" />
          Create Return Exit
        </Link>
      )}
      {/* Change Status dropdown — any status */}
      <ChangeStatusDropdown
        currentStatus={status}
        allStatuses={[
          { key: 'requested', label: 'Requested' },
          { key: 'approved', label: 'Approved' },
          { key: 'received', label: 'Received' },
          { key: 'on_loan', label: 'On Loan' },
          { key: 'returned', label: 'Returned' },
          { key: 'cancelled', label: 'Cancelled' },
        ]}
        statusConfig={STATUS_CONFIG}
        onStatusChange={(target) => statusMutation.mutate(target as LoanInStatus)}
        isPending={statusMutation.isPending}
        sideStatuses={['cancelled']}
      />
    </div>
  );
}
