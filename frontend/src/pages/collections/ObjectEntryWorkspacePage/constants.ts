/**
 * Constants for ObjectEntryWorkspacePage
 */

import {
  Clock,
  ArrowDownToLine,
  CheckCircle,
  ArrowRight,
  Archive,
  ClipboardList,
  FileText,
  Link2,
  History,
} from 'lucide-react';
import type { SectionGroup } from '../../../components/record-detail';
import type { StatusConfig, WorkflowStep } from './types';

// Status configuration
export const STATUS_CONFIG: Record<string, StatusConfig> = {
  pending: { label: 'Pending', color: 'bg-semantic-warning/10 text-semantic-warning', icon: Clock },
  received: { label: 'Received', color: 'bg-forest/10 text-forest', icon: ArrowDownToLine },
  processing: { label: 'Processing', color: 'bg-copper/10 text-copper', icon: Clock },
  processed: { label: 'Processed', color: 'bg-bark/10 text-bark', icon: CheckCircle },
  returned: { label: 'Returned', color: 'bg-stone text-archive', icon: ArrowRight },
  acquired: { label: 'Acquired', color: 'bg-semantic-success/10 text-semantic-success', icon: Archive },
};

// Workflow steps for the progress indicator
export const WORKFLOW_STEPS: WorkflowStep[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'received', label: 'Received' },
  { key: 'processed', label: 'Processed' },
  { key: 'linked', label: 'Linked' }, // Linked to Acquisition, Loan In, or Object Exit
];

// Section groups for ordering
export const SECTION_GROUPS: Record<string, string> = {
  acquisition: 'linked',
  'loan-in': 'linked',
  exit: 'linked',
  entry: 'overview',
  depositor: 'overview',
  objects: 'overview',
  duration: 'details',
  insurance: 'details',
  authorization: 'details',
  'terms-acceptance': 'details',
  notes: 'details',
  shipments: 'details',
  discussion: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'details', 'linked', 'admin'];

// Default section order within groups
export const DEFAULT_SECTION_ORDER: Record<string, string[]> = {
  linked: ['acquisition', 'loan-in', 'exit'],
  overview: ['entry', 'depositor', 'objects'],
  details: ['duration', 'insurance', 'authorization', 'terms-acceptance', 'notes', 'shipments'],
  admin: ['discussion', 'history'],
};

// Section groups for the new layout's SectionNav
export const ENTRY_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: ClipboardList,
    defaultExpanded: true,
    sections: [
      { id: 'entry', label: 'Entry Details', dataKey: 'entry' },
      { id: 'depositor', label: 'Depositor', dataKey: 'depositor' },
      { id: 'objects', label: 'Objects', dataKey: 'objects' },
      // Note: location and media are sub-parts of Objects section, not standalone sections
    ],
  },
  {
    id: 'details',
    label: 'Details',
    icon: FileText,
    defaultExpanded: true,
    sections: [
      { id: 'duration', label: 'Duration', dataKey: 'duration' },
      { id: 'insurance', label: 'Insurance', dataKey: 'insurance' },
      { id: 'authorization', label: 'Authorization', dataKey: 'authorization' },
      { id: 'terms-acceptance', label: 'Terms Acceptance', dataKey: 'terms' },
      { id: 'notes', label: 'Notes', dataKey: 'notes' },
      { id: 'shipments', label: 'Shipments', dataKey: 'shipments' },
    ],
  },
  {
    id: 'linked',
    label: 'Linked Records',
    icon: Link2,
    defaultExpanded: true,
    sections: [
      { id: 'acquisition', label: 'Acquisition', dataKey: 'acquisition' },
      { id: 'loan-in', label: 'Loan In', dataKey: 'loan_in' },
      { id: 'exit', label: 'Exit', dataKey: 'exit' },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    icon: History,
    defaultExpanded: false,
    sections: [
      { id: 'discussion', label: 'Discussion', dataKey: 'discussion' },
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

/** All section IDs derived from ENTRY_SECTION_GROUPS — single source of truth for nav. */
export const ALL_SECTION_IDS = ENTRY_SECTION_GROUPS.flatMap(g => g.sections.map(s => s.id));

/**
 * Object Entry procedure (p. 5) routes entries to Acquisition,
 * Loans In, OR Object Exit — any entry can eventually end in a return, so
 * Exit is the universal fallback linked-record type and must always be
 * available in the UI. Acquisition and Loan In sections are shown only when
 * the entry reason suggests that path is in play.
 *
 * Reason values (from the backend `entry_reason` enum):
 *   loan_consideration, gift_offer, purchase_consideration, identification,
 *   conservation, photography, research, enquiry, other
 */
const ACQUISITION_REASONS = new Set(['gift_offer', 'purchase_consideration']);
const LOAN_REASONS = new Set(['loan_consideration']);

export function getExcludedSections(effectiveReason: string): string[] {
  const excluded: string[] = [];
  // Hide the acquisition section unless the reason implies acquisition.
  if (!ACQUISITION_REASONS.has(effectiveReason)) excluded.push('acquisition');
  // Hide the loan-in section unless the reason implies a loan.
  if (!LOAN_REASONS.has(effectiveReason)) excluded.push('loan-in');
  // Exit is never excluded — any entry can result in a return.
  return excluded;
}

// Default form data for create mode
export const DEFAULT_FORM_DATA = {
  entry_date: '',
  reason: 'loan',
  depositor_id: '',
  depositor_name: '',
  current_owner_id: '',
  current_owner: '',
  receipt_reference: '',
  objects_description: '',
  expected_duration: '',
  expected_return_date: '',
  conditions: '',
  insurance_value: '',
  insurance_currency: 'USD',
  insurance_note: '',
  entry_note: '',
  // Entry method
  entry_method: '',
  // Authorization
  authorizer_id: '',
  authorizer_name: '',
  authorization_date: '',
  authorization_note: '',
  // Terms acceptance
  terms_accepted: false,
  terms_accepted_date: '',
  terms_accepted_by_id: '',
  acceptance_method: 'signature',
  acceptance_note: '',
};

// Default expanded sections state — overview core fields visible on load
export const DEFAULT_EXPANDED_SECTIONS: Record<string, boolean> = {
  entry: true,
  depositor: true,
  objects: false,
  duration: false,
  insurance: false,
  authorization: false,
  'terms-acceptance': false,
  notes: false,
  shipments: false,
  acquisition: false,
  'loan-in': false,
  exit: false,
  discussion: false,
  history: false,
};
