import {
  Clock,
  Search,
  CheckCircle,
  XCircle,
  Download,
  AlertTriangle,
  Ban,
} from 'lucide-react';
import type { DownloadRequestStatusType } from '../../lib/schemas';

interface DownloadRequestStatusBadgeProps {
  status: DownloadRequestStatusType | string;
  size?: 'sm' | 'md';
}

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; bgColor: string; textColor: string; iconColor: string }
> = {
  submitted: {
    label: 'Submitted',
    icon: Clock,
    bgColor: 'bg-semantic-info/10',
    textColor: 'text-semantic-info',
    iconColor: 'text-semantic-info',
  },
  review: {
    label: 'In Review',
    icon: Search,
    bgColor: 'bg-semantic-warning/10',
    textColor: 'text-semantic-warning',
    iconColor: 'text-semantic-warning',
  },
  approved: {
    label: 'Approved',
    icon: CheckCircle,
    bgColor: 'bg-semantic-success/10',
    textColor: 'text-semantic-success',
    iconColor: 'text-semantic-success',
  },
  denied: {
    label: 'Denied',
    icon: XCircle,
    bgColor: 'bg-semantic-error/10',
    textColor: 'text-semantic-error',
    iconColor: 'text-semantic-error',
  },
  fulfilled: {
    label: 'Fulfilled',
    icon: Download,
    bgColor: 'bg-semantic-success/10',
    textColor: 'text-semantic-success',
    iconColor: 'text-semantic-success',
  },
  expired: {
    label: 'Expired',
    icon: AlertTriangle,
    bgColor: 'bg-stone',
    textColor: 'text-archive',
    iconColor: 'text-archive',
  },
  cancelled: {
    label: 'Cancelled',
    icon: Ban,
    bgColor: 'bg-stone',
    textColor: 'text-archive',
    iconColor: 'text-archive',
  },
};

export function DownloadRequestStatusBadge({
  status,
  size = 'md',
}: DownloadRequestStatusBadgeProps) {
  const config: { label: string; icon: React.ElementType; bgColor: string; textColor: string; iconColor: string } = STATUS_CONFIG[status] || {
    label: status,
    icon: Clock,
    bgColor: 'bg-stone',
    textColor: 'text-archive',
    iconColor: 'text-archive',
  };

  const Icon = config.icon as React.ElementType;
  const iconSize = size === 'sm' ? 12 : 14;
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';
  const padding = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-1';

  return (
    <span
      className={`inline-flex items-center gap-1 ${padding} ${config.bgColor} ${config.textColor} ${textSize} font-medium rounded-full`}
    >
      <Icon size={iconSize} className={config.iconColor} />
      {config.label}
    </span>
  );
}

export const DOWNLOAD_REQUEST_STATUS_OPTIONS = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'review', label: 'In Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const DOWNLOAD_REQUEST_PURPOSE_LABELS: Record<string, string> = {
  research: 'Research',
  publication: 'Publication',
  exhibition: 'Exhibition',
  commercial: 'Commercial Use',
  educational: 'Educational',
  personal: 'Personal Use',
  other: 'Other',
};

export const DERIVATIVE_TYPE_LABELS: Record<string, string> = {
  access_master: 'Access Master',
  large: 'Large',
  original: 'Original',
  watermarked: 'Watermarked',
};
