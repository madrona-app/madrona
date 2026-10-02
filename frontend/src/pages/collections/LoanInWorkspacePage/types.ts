import type { LucideIcon } from 'lucide-react';
import type { LoanIn } from '../../../lib/schemas';
import type { SectionGroup } from '../../../components/record-detail';
import {
  ClipboardList,
  Calendar,
  Truck,
  Package,
  FileText,
  MessageSquare,
  History,
  Clock,
  CheckCircle,
  Download,
  ArrowRight,
  Send,
  FileSignature,
  ArrowRightLeft,
  Archive,
  XCircle,
  AlertTriangle,
  Activity,
  ClipboardCheck,
} from 'lucide-react';

// Status type extracted from the LoanIn schema
export type LoanInStatus = LoanIn['status'];

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  lender_id: string;
  lender_contact_id: string;
  lender_authorizer_id: string;
  loan_purpose: string;
  exhibition_id: string;
  exhibition_name: string;
  exhibition_venue: string;
  request_date: string;
  approval_date: string;
  loan_start_date: string;
  loan_end_date: string;
  loan_conditions: string;
  special_requirements: string;
  display_requirements: string;
  photography_restrictions: string;
  insurance_value: string;
  insurance_currency: string;
  insurance_policy: string;
  insurance_provider: string;
  indemnity: boolean;
  indemnity_reference: string;
  facility_report_sent: boolean;
  facility_report_date: string;
  facility_report_approved: boolean;
  facility_report_approved_date: string;
  facility_report_note: string;
  shipping_method: string;
  shipping_company: string;
  courier_required: boolean;
  courier_details: string;
  crate_required: boolean;
  crate_specifications: string;
  loan_agreement_reference: string;
  loan_agreement_date: string;
  loan_agreement_signed_date: string;
  loan_note: string;
  internal_note: string;
  max_renewals: string;
  // procedure compliance fields
  lender_authorizer_name: string;
  lender_authorizer_title: string;
  lender_authorization_date: string;
  document_location: string;
  document_location_note: string;
  loan_contact_name: string;
  loan_contact_email: string;
  loan_contact_phone: string;
  // Closing fields
  closing_invoice_sent: boolean;
  closing_invoice_date: string;
  closing_invoice_reference: string;
  closing_invoice_amount: string;
  closing_invoice_currency: string;
  receipt_acknowledged: boolean;
  receipt_acknowledged_date: string;
  receipt_acknowledged_reference: string;
  conditions_met_confirmed: boolean;
  conditions_met_date: string;
  conditions_met_note: string;
  closing_note: string;
}

export const defaultFormData: FormData = {
  lender_id: '',
  lender_contact_id: '',
  lender_authorizer_id: '',
  loan_purpose: 'exhibition',
  exhibition_id: '',
  exhibition_name: '',
  exhibition_venue: '',
  request_date: new Date().toISOString().split('T')[0],
  approval_date: '',
  loan_start_date: '',
  loan_end_date: '',
  loan_conditions: '',
  special_requirements: '',
  display_requirements: '',
  photography_restrictions: '',
  insurance_value: '',
  insurance_currency: 'USD',
  insurance_policy: '',
  insurance_provider: '',
  indemnity: false,
  indemnity_reference: '',
  facility_report_sent: false,
  facility_report_date: '',
  facility_report_approved: false,
  facility_report_approved_date: '',
  facility_report_note: '',
  shipping_method: '',
  shipping_company: '',
  courier_required: false,
  courier_details: '',
  crate_required: false,
  crate_specifications: '',
  loan_agreement_reference: '',
  loan_agreement_date: '',
  loan_agreement_signed_date: '',
  loan_note: '',
  internal_note: '',
  max_renewals: '2',
  // procedure compliance fields
  lender_authorizer_name: '',
  lender_authorizer_title: '',
  lender_authorization_date: '',
  document_location: '',
  document_location_note: '',
  loan_contact_name: '',
  loan_contact_email: '',
  loan_contact_phone: '',
  // Closing fields
  closing_invoice_sent: false,
  closing_invoice_date: '',
  closing_invoice_reference: '',
  closing_invoice_amount: '',
  closing_invoice_currency: 'USD',
  receipt_acknowledged: false,
  receipt_acknowledged_date: '',
  receipt_acknowledged_reference: '',
  conditions_met_confirmed: false,
  conditions_met_date: '',
  conditions_met_note: '',
  closing_note: '',
};

export const STATUS_CONFIG: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  requested: { label: 'Requested', color: 'bg-semantic-warning/10 text-semantic-warning', icon: Clock },
  pending_approval: { label: 'Pending Approval', color: 'bg-semantic-warning/10 text-semantic-warning', icon: Clock },
  approved: { label: 'Approved', color: 'bg-forest/10 text-forest', icon: CheckCircle },
  agreement_sent: { label: 'Agreement Sent', color: 'bg-semantic-info/10 text-semantic-info', icon: Send },
  agreement_signed: { label: 'Agreement Signed', color: 'bg-semantic-info/10 text-semantic-info', icon: FileSignature },
  in_transit: { label: 'In Transit', color: 'bg-bark/10 text-bark', icon: ArrowRightLeft },
  received: { label: 'Received', color: 'bg-bark/10 text-bark', icon: Download },
  on_loan: { label: 'On Loan', color: 'bg-semantic-success/10 text-semantic-success', icon: CheckCircle },
  return_initiated: { label: 'Return Initiated', color: 'bg-semantic-info/10 text-semantic-info', icon: ArrowRight },
  returned: { label: 'Returned', color: 'bg-stone text-archive', icon: Archive },
  closed: { label: 'Closed', color: 'bg-stone text-ink', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-semantic-error/10 text-semantic-error', icon: XCircle },
  overdue: { label: 'Overdue', color: 'bg-semantic-error/10 text-semantic-error', icon: AlertTriangle },
};

// Workflow steps (linear flow, excludes side statuses: cancelled, overdue)
export const WORKFLOW_STEPS = [
  { key: 'requested', label: 'Requested' },
  { key: 'pending_approval', label: 'Pending Approval' },
  { key: 'approved', label: 'Approved' },
  { key: 'agreement_sent', label: 'Agreement Sent' },
  { key: 'agreement_signed', label: 'Signed' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'received', label: 'Received' },
  { key: 'on_loan', label: 'On Loan' },
  { key: 'returned', label: 'Returned' },
  { key: 'closed', label: 'Closed' },
];

/**
 * Phase grouping for the workflow indicator. Ten (plus return_initiated)
 * linear statuses are too cramped to render as a single row of circles;
 * grouping them into five phases gives staff a clearer mental model
 * (Request → Agreement → Transit → Active → Closing) and fits any screen.
 *
 * Each phase's statuses must be in execution order so the sub-progress
 * dot-sequence renders correctly.
 */
export const WORKFLOW_PHASES: Array<{
  id: string;
  label: string;
  statuses: string[];
}> = [
  {
    id: 'request',
    label: 'Request',
    statuses: ['requested', 'pending_approval', 'approved'],
  },
  {
    id: 'agreement',
    label: 'Agreement',
    statuses: ['agreement_sent', 'agreement_signed'],
  },
  {
    id: 'transit',
    label: 'Transit',
    statuses: ['in_transit', 'received'],
  },
  {
    id: 'active',
    label: 'Active',
    statuses: ['on_loan'],
  },
  {
    id: 'closing',
    label: 'Closing',
    statuses: ['return_initiated', 'returned', 'closed'],
  },
];

/** Which phase does the given status belong to? Returns -1 if not linear. */
export const getPhaseIndex = (status: string): number => {
  return WORKFLOW_PHASES.findIndex((phase) => phase.statuses.includes(status));
};

/** Index of the status inside its phase (0-based), or -1. */
export const getPhaseSubIndex = (status: string): number => {
  const phaseIdx = getPhaseIndex(status);
  if (phaseIdx < 0) return -1;
  return WORKFLOW_PHASES[phaseIdx].statuses.indexOf(status);
};

// Status transition actions — which action is available from each status
export const STATUS_TRANSITIONS: Record<string, { label: string; targetStatus: string; icon: any }[]> = {
  requested: [
    { label: 'Submit for Approval', targetStatus: 'pending_approval', icon: Clock },
    { label: 'Cancel', targetStatus: 'cancelled', icon: XCircle },
  ],
  pending_approval: [
    { label: 'Approve', targetStatus: 'approved', icon: CheckCircle },
    { label: 'Cancel', targetStatus: 'cancelled', icon: XCircle },
  ],
  approved: [
    { label: 'Send Agreement', targetStatus: 'agreement_sent', icon: Send },
  ],
  agreement_sent: [
    { label: 'Mark Signed', targetStatus: 'agreement_signed', icon: FileSignature },
  ],
  agreement_signed: [
    { label: 'Mark In Transit', targetStatus: 'in_transit', icon: ArrowRightLeft },
  ],
  in_transit: [
    { label: 'Mark Received', targetStatus: 'received', icon: Download },
  ],
  received: [
    { label: 'Mark On Loan', targetStatus: 'on_loan', icon: CheckCircle },
  ],
  on_loan: [
    { label: 'Initiate Return', targetStatus: 'return_initiated', icon: ArrowRight },
  ],
  return_initiated: [
    { label: 'Mark Returned', targetStatus: 'returned', icon: Archive },
  ],
  returned: [
    { label: 'Close Loan', targetStatus: 'closed', icon: CheckCircle },
  ],
};

// Section groups for nav (matches SectionNav format)
export const LOAN_IN_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: ClipboardList,
    defaultExpanded: true,
    sections: [
      { id: 'lender', label: 'Lender', dataKey: 'lender' },
      { id: 'lender-authorization', label: 'Lender Authorization', dataKey: 'lender_authorization' },
      { id: 'details', label: 'Loan Details', dataKey: 'details' },
    ],
  },
  {
    id: 'dates',
    label: 'Dates',
    icon: Calendar,
    defaultExpanded: false,
    sections: [
      { id: 'dates', label: 'Key Dates', dataKey: 'dates' },
    ],
  },
  {
    id: 'logistics',
    label: 'Logistics',
    icon: Truck,
    defaultExpanded: false,
    sections: [
      { id: 'insurance', label: 'Insurance', dataKey: 'insurance' },
      { id: 'facility', label: 'Facility Report', dataKey: 'facility' },
      { id: 'shipments', label: 'Shipments', dataKey: 'shipments' },
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: Package,
    defaultExpanded: false,
    sections: [
      { id: 'linkedEntry', label: 'Loan Objects', dataKey: 'linkedEntry' },
      { id: 'linkedExit', label: 'Object Exits', dataKey: 'linkedExit' },
      { id: 'condition-reports', label: 'Condition Reports', dataKey: 'condition_reports' },
      { id: 'renewals', label: 'Renewals', dataKey: 'renewals' },
    ],
  },
  {
    id: 'documentation',
    label: 'Documentation',
    icon: FileText,
    defaultExpanded: false,
    sections: [
      { id: 'agreement', label: 'Loan Agreement', dataKey: 'agreement' },
      { id: 'document-location', label: 'Document Location', dataKey: 'document_location' },
      { id: 'loan-contact', label: 'Internal Contact', dataKey: 'loan_contact' },
      { id: 'notes', label: 'Notes', dataKey: 'notes' },
    ],
  },
  {
    id: 'monitoring',
    label: 'Monitoring',
    icon: Activity,
    defaultExpanded: false,
    sections: [
      { id: 'monitoring', label: 'Loan Monitoring', dataKey: 'monitoring' },
    ],
  },
  {
    id: 'closing',
    label: 'Closing',
    icon: ClipboardCheck,
    defaultExpanded: false,
    sections: [
      { id: 'closing', label: 'Closing Checklist', dataKey: 'closing' },
    ],
  },
  {
    id: 'collaboration',
    label: 'Collaboration',
    icon: MessageSquare,
    defaultExpanded: false,
    sections: [
      { id: 'discussion', label: 'Discussion', dataKey: 'discussion' },
    ],
  },
  {
    id: 'history',
    label: 'History',
    icon: History,
    defaultExpanded: false,
    sections: [
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

// Section groups for ordering (maps section ID to group ID)
export const SECTION_GROUPS: Record<string, string> = {
  lender: 'overview',
  'lender-authorization': 'overview',
  details: 'overview',
  dates: 'dates',
  insurance: 'logistics',
  facility: 'logistics',
  shipments: 'logistics',
  linkedEntry: 'objects',
  linkedExit: 'objects',
  'condition-reports': 'objects',
  renewals: 'objects',
  agreement: 'documentation',
  'document-location': 'documentation',
  'loan-contact': 'documentation',
  notes: 'documentation',
  monitoring: 'monitoring',
  closing: 'closing',
  discussion: 'collaboration',
  history: 'history',
};

// Default section order within groups
export const DEFAULT_SECTION_ORDER: Record<string, string[]> = {
  overview: ['lender', 'lender-authorization', 'details'],
  dates: ['dates'],
  logistics: ['insurance', 'facility', 'shipments'],
  objects: ['linkedEntry', 'linkedExit', 'condition-reports', 'renewals'],
  documentation: ['agreement', 'document-location', 'loan-contact', 'notes'],
  monitoring: ['monitoring'],
  closing: ['closing'],
  collaboration: ['discussion'],
  history: ['history'],
};

// All section IDs for nav
export const ALL_SECTION_IDS = [
  'lender', 'lender-authorization', 'details',
  'dates',
  'insurance', 'facility', 'shipments',
  'linkedEntry', 'linkedExit', 'condition-reports', 'renewals',
  'agreement', 'document-location', 'loan-contact', 'notes',
  'monitoring',
  'closing',
  'discussion',
  'history',
];

// Group order for getSectionOrder calculation
export const GROUP_ORDER = ['overview', 'dates', 'logistics', 'objects', 'documentation', 'monitoring', 'closing', 'collaboration', 'history'];

// Helper to get workflow step index
export const getStepIndex = (status: string): number => {
  const index = WORKFLOW_STEPS.findIndex(s => s.key === status);
  return index >= 0 ? index : 0;
};

// Expanded sections initial state — core overview sections visible on load
export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  lender: true,
  'lender-authorization': false,
  details: true,
  dates: false,
  insurance: false,
  facility: false,
  shipments: false,
  agreement: false,
  'document-location': false,
  'loan-contact': false,
  notes: false,
  linkedEntry: false,
  linkedExit: false,
  objects: false,
  'condition-reports': false,
  renewals: false,
  monitoring: false,
  closing: false,
  discussion: false,
  history: false,
};
