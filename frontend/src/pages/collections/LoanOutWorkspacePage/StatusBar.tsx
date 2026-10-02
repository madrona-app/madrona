import { DollarSign } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { STATUS_CONFIG, STATUS_TRANSITIONS, WORKFLOW_STEPS } from './constants';
import { ChangeStatusDropdown } from '../../../components/collections/ChangeStatusDropdown';
import { formatNumber } from '@/lib/formatters';
import type { ExistingLoan } from './types';

interface StatusBarProps {
  existingLoan: ExistingLoan;
  purposeLabel: string;
  onStatusChange: (targetStatus: string) => void;
  isStatusPending: boolean;
}

export function StatusBar({
  existingLoan,
  purposeLabel,
  onStatusChange,
  isStatusPending,
}: StatusBarProps) {
  const status = existingLoan.status || 'requested';
  const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG.requested;
  const StatusIcon = statusConfig.icon;
  const transitions = STATUS_TRANSITIONS[status] || [];

  // Primary forward action = first non-side transition
  const sideStatuses = ['declined', 'cancelled'];
  const sideSet = new Set(sideStatuses);
  const primaryTransition = transitions.find(t => !sideSet.has(t.targetStatus));

  // All statuses for the dropdown
  const allStatuses = [
    ...WORKFLOW_STEPS,
    { key: 'declined', label: 'Declined' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 sm:gap-4 mb-6">
      <span className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium', statusConfig.color)}>
        <StatusIcon size={16} />
        {statusConfig.label}
      </span>
      <span className="text-sm text-archive hidden sm:inline">{purposeLabel}</span>
      {existingLoan.insurance_value_total && (
        <span className="text-sm text-ink hidden md:inline">
          <DollarSign size={14} className="inline mr-1" />
          {existingLoan.insurance_currency || 'USD'} {formatNumber(existingLoan.insurance_value_total)}
        </span>
      )}

      {/* Status Actions */}
      <div className="flex-1 min-w-0" />

      {/* Primary forward action */}
      {primaryTransition && (
        <button
          onClick={() => onStatusChange(primaryTransition.targetStatus)}
          className="btn btn-primary text-sm"
          disabled={isStatusPending}
        >
          {(() => { const Icon = primaryTransition.icon; return <Icon size={16} className="mr-1.5" />; })()}
          {primaryTransition.label}
        </button>
      )}

      {/* Change Status dropdown — all other statuses */}
      <ChangeStatusDropdown
        currentStatus={status}
        allStatuses={allStatuses}
        statusConfig={STATUS_CONFIG}
        onStatusChange={onStatusChange}
        isPending={isStatusPending}
        sideStatuses={sideStatuses}
      />
    </div>
  );
}
