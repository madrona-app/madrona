import type { LucideIcon } from 'lucide-react';
import {
  Clock,
  FileText,
  Users,
  Gavel,
  CheckCircle,
  Archive,
  Trash2,
} from 'lucide-react';
import type { DeaccessionFormData } from './types';

export const STATUS_CONFIG: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  proposed: { label: 'Proposed', color: 'bg-semantic-warning/10 text-semantic-warning', icon: Clock },
  under_review: { label: 'Under Review', color: 'bg-semantic-info/10 text-semantic-info', icon: FileText },
  committee_reviewed: { label: 'Committee Reviewed', color: 'bg-bark/10 text-bark', icon: Users },
  pending_board: { label: 'Pending Board', color: 'bg-copper/10 text-copper', icon: Gavel },
  approved: { label: 'Approved', color: 'bg-forest/10 text-forest', icon: CheckCircle },
  in_progress: { label: 'In Progress', color: 'bg-semantic-info/10 text-semantic-info', icon: Clock },
  completed: { label: 'Completed', color: 'bg-semantic-success/10 text-semantic-success', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-stone text-archive', icon: Archive },
  rejected: { label: 'Rejected', color: 'bg-semantic-error/10 text-semantic-error', icon: Trash2 },
};

export const DEFAULT_FORM_DATA: DeaccessionFormData = {
  object_id: '',
  proposal_date: new Date().toISOString().split('T')[0],
  reason: 'outside_scope',
  reason_detail: '',
  disposal_method: '',
  disposal_method_detail: '',
  recipient_name: '',
  committee_review_date: '',
  committee_recommendation: '',
  committee_note: '',
  board_approval_required: true,
  board_approval_date: '',
  board_approval_reference: '',
  board_note: '',
  legal_review_date: '',
  legal_review_note: '',
  provenance_review_complete: false,
  provenance_review_note: '',
  appraised_value: '',
  appraised_value_currency: 'USD',
  appraised_date: '',
  appraiser_id: '',
  sale_price: '',
  sale_currency: 'USD',
  proceeds_usage: '',
  public_notice_required: false,
  public_notice_date: '',
  public_notice_reference: '',
  deaccession_note: '',
};

export const DEACCESSION_STATUS_ORDER = [
  'proposed', 'under_review', 'committee_reviewed', 'pending_board',
  'approved', 'in_progress', 'completed', 'cancelled', 'rejected',
];
