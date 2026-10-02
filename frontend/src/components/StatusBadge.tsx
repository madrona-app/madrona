import type { RunStatus } from '../lib/schemas';

interface StatusBadgeProps {
  status: RunStatus;
  className?: string;
}

const STATUS_CONFIG: Record<
  RunStatus,
  {
    label: string;
    friendlyMessage: string;
    bgColor: string;
    textColor: string;
  }
> = {
  pending: {
    label: 'Pending',
    friendlyMessage: 'Waiting to start',
    bgColor: 'bg-stone',
    textColor: 'text-archive',
  },
  queued: {
    label: 'Queued',
    friendlyMessage: 'Preparing to extract',
    bgColor: 'bg-semantic-info',
    textColor: 'text-parchment',
  },
  running: {
    label: 'Running',
    friendlyMessage: 'Extracting from source',
    bgColor: 'bg-semantic-warning',
    textColor: 'text-parchment',
  },
  publishing: {
    label: 'Publishing',
    friendlyMessage: 'Publishing to spreadsheet',
    bgColor: 'bg-copper',
    textColor: 'text-parchment',
  },
  success: {
    label: 'Success',
    friendlyMessage: 'Run complete',
    bgColor: 'bg-semantic-success',
    textColor: 'text-parchment',
  },
  warning: {
    label: 'Warning',
    friendlyMessage: 'Completed with warnings',
    bgColor: 'bg-semantic-warning',
    textColor: 'text-parchment',
  },
  failed: {
    label: 'Failed',
    friendlyMessage: 'Error extracting from source',
    bgColor: 'bg-semantic-error',
    textColor: 'text-parchment',
  },
  failed_publish: {
    label: 'Failed',
    friendlyMessage: 'Error publishing to spreadsheet',
    bgColor: 'bg-semantic-error',
    textColor: 'text-parchment',
  },
  failed_finalize: {
    label: 'Failed',
    friendlyMessage: 'Error completing update',
    bgColor: 'bg-semantic-error',
    textColor: 'text-parchment',
  },
  canceled: {
    label: 'Canceled',
    friendlyMessage: 'Run was canceled',
    bgColor: 'bg-stone',
    textColor: 'text-archive',
  },
  rolled_back: {
    label: 'Rolled Back',
    friendlyMessage: 'Run was rolled back',
    bgColor: 'bg-stone',
    textColor: 'text-archive',
  },
};

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-institutional text-xs font-medium ${config.bgColor} ${config.textColor} ${className}`}
      title={config.friendlyMessage}
    >
      {config.label}
    </span>
  );
}

export function getStatusMessage(status: RunStatus): string {
  return STATUS_CONFIG[status].friendlyMessage;
}

export function canExecute(status: RunStatus): boolean {
  return status === 'pending' || status === 'queued';
}

export function canRepublish(status: RunStatus): boolean {
  return status === 'failed_publish' || status === 'publishing' || status === 'failed_finalize';
}

export function isFailedStatus(status: RunStatus): boolean {
  return status.startsWith('failed');
}
