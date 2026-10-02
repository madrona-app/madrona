/**
 * Centralized status configuration for all entity types.
 *
 * This module provides consistent status labels, colors, and icons
 * across all workspace pages and list views.
 *
 * Usage:
 *   import { getStatusConfig, getStatusLabel } from '@/lib/statusConfig';
 *
 *   // Get full config
 *   const config = getStatusConfig('object_entry', entry.status);
 *   <Badge className={config.className}>{config.label}</Badge>
 *
 *   // Get just the label
 *   const label = getStatusLabel('loan_in', loan.status);
 */

import type { LucideIcon } from 'lucide-react';
import {
  FileText,
  Clock,
  CheckCircle,
  Package,
  RotateCcw,
  Archive,
  XCircle,
  AlertTriangle,
  Send,
  ArrowRightLeft,
  Eye,
  FileCheck,
  Truck,
  Shield,
  Users,
  HandCoins,
  Gavel,
} from 'lucide-react';

// =============================================================================
// Types
// =============================================================================

export interface StatusConfig {
  label: string;
  /** Tailwind class for badge/indicator background + text */
  className: string;
  /** Icon component */
  icon: LucideIcon;
  /** Optional description for tooltips */
  description?: string;
}

export type EntityType =
  | 'object_entry'
  | 'object_exit'
  | 'loan_in'
  | 'loan_out'
  | 'acquisition'
  | 'deaccession'
  | 'condition_report'
  | 'conservation'
  | 'movement'
  | 'use_request'
  | 'valuation'
  | 'insurance_claim'
  | 'exhibition';

// =============================================================================
// Status Configurations
// =============================================================================

const OBJECT_ENTRY_STATUSES: Record<string, StatusConfig> = {
  pending: {
    label: 'Pending',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: Clock,
    description: 'Entry awaiting receipt',
  },
  received: {
    label: 'Received',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: Package,
    description: 'Objects received but not processed',
  },
  processed: {
    label: 'Processed',
    className: 'bg-semantic-success/10 text-semantic-success',
    icon: CheckCircle,
    description: 'Entry fully processed',
  },
  returned: {
    label: 'Returned',
    className: 'bg-archive/10 text-archive',
    icon: RotateCcw,
    description: 'Objects returned to depositor',
  },
  acquired: {
    label: 'Acquired',
    className: 'bg-bark/10 text-bark',
    icon: Archive,
    description: 'Objects accessioned into collection',
  },
};

const OBJECT_EXIT_STATUSES: Record<string, StatusConfig> = {
  pending: {
    label: 'Pending',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: Clock,
    description: 'Exit authorization pending',
  },
  authorized: {
    label: 'Authorized',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: FileCheck,
    description: 'Exit authorized',
  },
  dispatched: {
    label: 'Dispatched',
    className: 'bg-semantic-success/10 text-semantic-success',
    icon: Truck,
    description: 'Objects dispatched',
  },
  acknowledged: {
    label: 'Acknowledged',
    className: 'bg-archive/10 text-archive',
    icon: CheckCircle,
    description: 'Receipt acknowledged',
  },
};

const LOAN_IN_STATUSES: Record<string, StatusConfig> = {
  requested: {
    label: 'Requested',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: FileText,
    description: 'Loan request submitted',
  },
  pending_approval: {
    label: 'Pending Approval',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: Clock,
    description: 'Awaiting lender approval',
  },
  approved: {
    label: 'Approved',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: CheckCircle,
    description: 'Loan approved by lender',
  },
  agreement_sent: {
    label: 'Agreement Sent',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: Send,
    description: 'Loan agreement sent for signing',
  },
  agreement_signed: {
    label: 'Agreement Signed',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: FileCheck,
    description: 'Loan agreement fully executed',
  },
  in_transit: {
    label: 'In Transit',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: Truck,
    description: 'Objects in transit',
  },
  on_loan: {
    label: 'On Loan',
    className: 'bg-semantic-success/10 text-semantic-success',
    icon: Package,
    description: 'Objects on loan',
  },
  return_scheduled: {
    label: 'Return Scheduled',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: RotateCcw,
    description: 'Return date confirmed',
  },
  returned: {
    label: 'Returned',
    className: 'bg-archive/10 text-archive',
    icon: RotateCcw,
    description: 'Objects returned to lender',
  },
  closed: {
    label: 'Closed',
    className: 'bg-archive/10 text-archive',
    icon: Archive,
    description: 'Loan closed and archived',
  },
  declined: {
    label: 'Declined',
    className: 'bg-semantic-error/10 text-semantic-error',
    icon: XCircle,
    description: 'Loan request declined',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-semantic-error/10 text-semantic-error',
    icon: XCircle,
  },
};

const LOAN_OUT_STATUSES: Record<string, StatusConfig> = {
  requested: {
    label: 'Requested',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: FileText,
    description: 'Loan request received',
  },
  pending_approval: {
    label: 'Pending Approval',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: Clock,
    description: 'Awaiting internal approval',
  },
  approved: {
    label: 'Approved',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: CheckCircle,
    description: 'Loan approved',
  },
  agreement_sent: {
    label: 'Agreement Sent',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: Send,
    description: 'Loan agreement sent for signing',
  },
  agreement_signed: {
    label: 'Agreement Signed',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: FileCheck,
    description: 'Loan agreement fully executed',
  },
  in_transit: {
    label: 'In Transit',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: Truck,
    description: 'Objects in transit to borrower',
  },
  on_loan: {
    label: 'On Loan',
    className: 'bg-semantic-success/10 text-semantic-success',
    icon: Send,
    description: 'Objects on loan',
  },
  return_scheduled: {
    label: 'Return Scheduled',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: RotateCcw,
    description: 'Return date confirmed',
  },
  returned: {
    label: 'Returned',
    className: 'bg-archive/10 text-archive',
    icon: RotateCcw,
    description: 'Objects returned',
  },
  closed: {
    label: 'Closed',
    className: 'bg-archive/10 text-archive',
    icon: Archive,
    description: 'Loan closed and archived',
  },
  declined: {
    label: 'Declined',
    className: 'bg-semantic-error/10 text-semantic-error',
    icon: XCircle,
    description: 'Loan request declined',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-semantic-error/10 text-semantic-error',
    icon: XCircle,
  },
};

const ACQUISITION_STATUSES: Record<string, StatusConfig> = {
  proposed: {
    label: 'Proposed',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: FileText,
  },
  pending_approval: {
    label: 'Pending Approval',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: Clock,
  },
  approved: {
    label: 'Approved',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: CheckCircle,
  },
  completed: {
    label: 'Completed',
    className: 'bg-semantic-success/10 text-semantic-success',
    icon: CheckCircle,
  },
  accessioned: {
    label: 'Accessioned',
    className: 'bg-bark/10 text-bark',
    icon: Archive,
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-semantic-error/10 text-semantic-error',
    icon: XCircle,
  },
};

const DEACCESSION_STATUSES: Record<string, StatusConfig> = {
  proposed: {
    label: 'Proposed',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: FileText,
  },
  under_review: {
    label: 'Under Review',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: Eye,
  },
  committee_review: {
    label: 'Committee Review',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: Users,
  },
  board_approval: {
    label: 'Board Approval',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: Gavel,
  },
  approved: {
    label: 'Approved',
    className: 'bg-semantic-success/10 text-semantic-success',
    icon: CheckCircle,
  },
  completed: {
    label: 'Completed',
    className: 'bg-archive/10 text-archive',
    icon: Archive,
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-semantic-error/10 text-semantic-error',
    icon: XCircle,
  },
};

const CONDITION_REPORT_STATUSES: Record<string, StatusConfig> = {
  draft: {
    label: 'Draft',
    className: 'bg-archive/10 text-archive',
    icon: FileText,
  },
  submitted: {
    label: 'Submitted',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: Send,
  },
  reviewed: {
    label: 'Reviewed',
    className: 'bg-semantic-success/10 text-semantic-success',
    icon: CheckCircle,
  },
};

const CONSERVATION_STATUSES: Record<string, StatusConfig> = {
  proposed: {
    label: 'Proposed',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: FileText,
  },
  approved: {
    label: 'Approved',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: CheckCircle,
  },
  in_progress: {
    label: 'In Progress',
    className: 'bg-semantic-success/10 text-semantic-success',
    icon: Clock,
  },
  completed: {
    label: 'Completed',
    className: 'bg-archive/10 text-archive',
    icon: CheckCircle,
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-semantic-error/10 text-semantic-error',
    icon: XCircle,
  },
};

const MOVEMENT_STATUSES: Record<string, StatusConfig> = {
  planned: {
    label: 'Planned',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: Clock,
  },
  authorized: {
    label: 'Authorized',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: FileCheck,
  },
  in_transit: {
    label: 'In Transit',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: ArrowRightLeft,
  },
  completed: {
    label: 'Completed',
    className: 'bg-semantic-success/10 text-semantic-success',
    icon: CheckCircle,
  },
};

const USE_REQUEST_STATUSES: Record<string, StatusConfig> = {
  submitted: {
    label: 'Submitted',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: FileText,
  },
  under_review: {
    label: 'Under Review',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: Eye,
  },
  approved: {
    label: 'Approved',
    className: 'bg-semantic-success/10 text-semantic-success',
    icon: CheckCircle,
  },
  fulfilled: {
    label: 'Fulfilled',
    className: 'bg-archive/10 text-archive',
    icon: CheckCircle,
  },
  denied: {
    label: 'Denied',
    className: 'bg-semantic-error/10 text-semantic-error',
    icon: XCircle,
  },
};

const VALUATION_STATUSES: Record<string, StatusConfig> = {
  requested: {
    label: 'Requested',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: FileText,
  },
  in_progress: {
    label: 'In Progress',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: Clock,
  },
  completed: {
    label: 'Completed',
    className: 'bg-semantic-success/10 text-semantic-success',
    icon: HandCoins,
  },
};

const INSURANCE_CLAIM_STATUSES: Record<string, StatusConfig> = {
  draft: {
    label: 'Draft',
    className: 'bg-archive/10 text-archive',
    icon: FileText,
  },
  filed: {
    label: 'Filed',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: Send,
  },
  under_review: {
    label: 'Under Review',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: Eye,
  },
  approved: {
    label: 'Approved',
    className: 'bg-semantic-success/10 text-semantic-success',
    icon: CheckCircle,
  },
  settled: {
    label: 'Settled',
    className: 'bg-archive/10 text-archive',
    icon: Shield,
  },
  denied: {
    label: 'Denied',
    className: 'bg-semantic-error/10 text-semantic-error',
    icon: XCircle,
  },
};

const EXHIBITION_STATUSES: Record<string, StatusConfig> = {
  planning: {
    label: 'Planning',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: FileText,
  },
  preparation: {
    label: 'Preparation',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: Clock,
  },
  installation: {
    label: 'Installation',
    className: 'bg-semantic-info/10 text-semantic-info',
    icon: Package,
  },
  open: {
    label: 'Open',
    className: 'bg-semantic-success/10 text-semantic-success',
    icon: CheckCircle,
  },
  deinstallation: {
    label: 'Deinstallation',
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: ArrowRightLeft,
  },
  closed: {
    label: 'Closed',
    className: 'bg-archive/10 text-archive',
    icon: Archive,
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-semantic-error/10 text-semantic-error',
    icon: XCircle,
  },
};

// =============================================================================
// Lookup Map
// =============================================================================

const STATUS_CONFIGS: Record<EntityType, Record<string, StatusConfig>> = {
  object_entry: OBJECT_ENTRY_STATUSES,
  object_exit: OBJECT_EXIT_STATUSES,
  loan_in: LOAN_IN_STATUSES,
  loan_out: LOAN_OUT_STATUSES,
  acquisition: ACQUISITION_STATUSES,
  deaccession: DEACCESSION_STATUSES,
  condition_report: CONDITION_REPORT_STATUSES,
  conservation: CONSERVATION_STATUSES,
  movement: MOVEMENT_STATUSES,
  use_request: USE_REQUEST_STATUSES,
  valuation: VALUATION_STATUSES,
  insurance_claim: INSURANCE_CLAIM_STATUSES,
  exhibition: EXHIBITION_STATUSES,
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the full status configuration for an entity type and status.
 *
 * @param entityType - The type of entity
 * @param status - The current status value
 * @returns StatusConfig or a fallback for unknown statuses
 */
export function getStatusConfig(
  entityType: EntityType,
  status: string
): StatusConfig {
  const configs = STATUS_CONFIGS[entityType];
  if (!configs) {
    return {
      label: status,
      className: 'bg-archive/10 text-archive',
      icon: AlertTriangle,
    };
  }

  const config = configs[status];
  if (!config) {
    return {
      label: status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      className: 'bg-archive/10 text-archive',
      icon: AlertTriangle,
    };
  }

  return config;
}

/**
 * Get just the display label for a status.
 *
 * @param entityType - The type of entity
 * @param status - The current status value
 * @returns Human-readable status label
 */
export function getStatusLabel(entityType: EntityType, status: string): string {
  return getStatusConfig(entityType, status).label;
}

/**
 * Get all status options for an entity type.
 * Useful for building select dropdowns.
 *
 * @param entityType - The type of entity
 * @returns Array of { value, label } options
 */
export function getStatusOptions(
  entityType: EntityType
): Array<{ value: string; label: string }> {
  const configs = STATUS_CONFIGS[entityType];
  if (!configs) {
    return [];
  }

  return Object.entries(configs).map(([value, config]) => ({
    value,
    label: config.label,
  }));
}

/**
 * Check if a status indicates a "complete" or "closed" state.
 *
 * @param entityType - The type of entity
 * @param status - The current status value
 * @returns true if the status indicates completion
 */
export function isTerminalStatus(
  entityType: EntityType,
  status: string
): boolean {
  const terminalStatuses: Record<EntityType, string[]> = {
    object_entry: ['returned', 'acquired'],
    object_exit: ['acknowledged'],
    loan_in: ['returned', 'closed', 'declined', 'cancelled'],
    loan_out: ['returned', 'closed', 'declined', 'cancelled'],
    acquisition: ['accessioned', 'cancelled'],
    deaccession: ['completed', 'rejected'],
    condition_report: ['reviewed'],
    conservation: ['completed', 'cancelled'],
    movement: ['completed'],
    use_request: ['fulfilled', 'denied'],
    valuation: ['completed'],
    insurance_claim: ['settled', 'denied'],
    exhibition: ['closed', 'cancelled'],
  };

  return terminalStatuses[entityType]?.includes(status) ?? false;
}
