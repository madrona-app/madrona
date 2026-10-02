import {
  Clock,
  CheckCircle,
  Upload,
  ClipboardList,
  Calendar,
  Truck,
  Package,
  FileText,
  MessageSquare,
  History,
  Send,
  FileSignature,
  ArrowRightLeft,
  CalendarCheck,
  Archive,
  XCircle,
  Activity,
  ClipboardCheck,
} from 'lucide-react';
import type { SectionGroup } from '../../../components/record-detail';
import type { StatusConfig, WorkflowStep, FormData } from './types';

// Full the collections standard status configuration
export const STATUS_CONFIG: Record<string, StatusConfig> = {
  requested: { label: 'Requested', color: 'bg-semantic-warning/10 text-semantic-warning', icon: Clock },
  pending_approval: { label: 'Pending Approval', color: 'bg-semantic-warning/10 text-semantic-warning', icon: Clock },
  approved: { label: 'Approved', color: 'bg-forest/10 text-forest', icon: CheckCircle },
  agreement_sent: { label: 'Agreement Sent', color: 'bg-semantic-info/10 text-semantic-info', icon: Send },
  agreement_signed: { label: 'Agreement Signed', color: 'bg-semantic-info/10 text-semantic-info', icon: FileSignature },
  in_transit: { label: 'In Transit', color: 'bg-bark/10 text-bark', icon: Upload },
  on_loan: { label: 'On Loan', color: 'bg-semantic-success/10 text-semantic-success', icon: CheckCircle },
  return_scheduled: { label: 'Return Scheduled', color: 'bg-semantic-info/10 text-semantic-info', icon: CalendarCheck },
  returned: { label: 'Returned', color: 'bg-stone text-archive', icon: Archive },
  closed: { label: 'Closed', color: 'bg-stone text-ink', icon: CheckCircle },
  declined: { label: 'Declined', color: 'bg-semantic-error/10 text-semantic-error', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'bg-semantic-error/10 text-semantic-error', icon: XCircle },
};

// Linear workflow steps (excludes side statuses: declined, cancelled)
export const WORKFLOW_STEPS: WorkflowStep[] = [
  { key: 'requested', label: 'Requested' },
  { key: 'approved', label: 'Approved' },
  { key: 'agreement_sent', label: 'Agreement Sent' },
  { key: 'agreement_signed', label: 'Signed' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'on_loan', label: 'On Loan' },
  { key: 'return_scheduled', label: 'Return Scheduled' },
  { key: 'returned', label: 'Returned' },
  { key: 'closed', label: 'Closed' },
];

// Status transition actions — which action is available from each status
export const STATUS_TRANSITIONS: Record<string, { label: string; targetStatus: string; icon: any }[]> = {
  requested: [
    { label: 'Approve', targetStatus: 'approved', icon: CheckCircle },
    { label: 'Decline', targetStatus: 'declined', icon: XCircle },
  ],
  pending_approval: [
    { label: 'Approve', targetStatus: 'approved', icon: CheckCircle },
    { label: 'Decline', targetStatus: 'declined', icon: XCircle },
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
    { label: 'Mark On Loan', targetStatus: 'on_loan', icon: CheckCircle },
  ],
  on_loan: [
    { label: 'Schedule Return', targetStatus: 'return_scheduled', icon: CalendarCheck },
  ],
  return_scheduled: [
    { label: 'Mark Returned', targetStatus: 'returned', icon: Archive },
  ],
  returned: [
    { label: 'Close Loan', targetStatus: 'closed', icon: CheckCircle },
  ],
};

// Section groups for nav (matches SectionNav format)
export const LOAN_OUT_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: ClipboardList,
    defaultExpanded: true,
    sections: [
      { id: 'borrower', label: 'Borrower', dataKey: 'borrower' },
      { id: 'details', label: 'Loan Details', dataKey: 'details' },
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: Package,
    defaultExpanded: true,
    sections: [
      { id: 'objects', label: 'Loan Objects', dataKey: 'objects' },
    ],
  },
  {
    id: 'dates',
    label: 'Dates & Authorization',
    icon: Calendar,
    defaultExpanded: false,
    sections: [
      { id: 'dates', label: 'Key Dates', dataKey: 'dates' },
      { id: 'authorization', label: 'Authorization', dataKey: 'authorization' },
      { id: 'renewals', label: 'Renewals', dataKey: 'renewals' },
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
    id: 'documentation',
    label: 'Documentation',
    icon: FileText,
    defaultExpanded: false,
    sections: [
      { id: 'agreement', label: 'Loan Agreement', dataKey: 'agreement' },
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
  borrower: 'overview',
  details: 'overview',
  dates: 'dates',
  authorization: 'dates',
  renewals: 'dates',
  insurance: 'logistics',
  facility: 'logistics',
  shipments: 'logistics',
  objects: 'objects',
  agreement: 'documentation',
  notes: 'documentation',
  monitoring: 'monitoring',
  closing: 'closing',
  discussion: 'collaboration',
  history: 'history',
};

// Default section order within groups
export const DEFAULT_SECTION_ORDER: Record<string, string[]> = {
  overview: ['borrower', 'details'],
  objects: ['objects'],
  dates: ['dates', 'authorization', 'renewals'],
  logistics: ['insurance', 'facility', 'shipments'],
  documentation: ['agreement', 'notes'],
  monitoring: ['monitoring'],
  closing: ['closing'],
  collaboration: ['discussion'],
  history: ['history'],
};

// Group order for CSS ordering
export const GROUP_ORDER = ['overview', 'objects', 'dates', 'logistics', 'documentation', 'monitoring', 'closing', 'collaboration', 'history'];

// Default form data for new loans
export const defaultFormData: FormData = {
  borrower_id: '',
  borrower_contact_id: '',
  borrower_status: '',
  venue_name: '',
  venue_street: '',
  venue_city: '',
  venue_state: '',
  venue_postal_code: '',
  venue_country: '',
  loan_purpose: 'exhibition',
  exhibition_title: '',
  request_date: new Date().toISOString().split('T')[0],
  loan_start_date: '',
  loan_end_date: '',
  loan_conditions: '',
  special_conditions: '',
  // Authorization
  authorizer_id: '',
  authorization_date: '',
  authorization_note: '',
  // Insurance
  insurance_requirements: '',
  insurance_value_total: '',
  insurance_currency: 'USD',
  insurance_coverage_type: 'wall_to_wall',
  certificate_of_insurance_received: false,
  certificate_of_insurance_date: '',
  // Facility
  facility_report_received: false,
  facility_report_date: '',
  facility_report_approved: false,
  security_conditions_confirmed: false,
  // Agreement
  loan_agreement_reference: '',
  loan_agreement_signed_date: '',
  document_location: '',
  // Photography & Rights
  photography_permitted: null as boolean | null,
  photography_conditions: '',
  reproduction_rights_note: '',
  // Notes
  loan_note: '',
  // Closing
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

// All section IDs for initializing collapsed state
export const ALL_SECTION_IDS = [
  'borrower',
  'details',
  'dates',
  'authorization',
  'renewals',
  'insurance',
  'facility',
  'shipments',
  'objects',
  'agreement',
  'notes',
  'monitoring',
  'closing',
  'discussion',
  'history',
] as const;

/** Sections hidden in create mode (no record to reference yet). */
export const CREATE_MODE_EXCLUDE = ['renewals', 'monitoring', 'closing', 'discussion', 'history'];
