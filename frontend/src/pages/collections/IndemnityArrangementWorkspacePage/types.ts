import type { SectionGroup } from '../../../components/record-detail';
import type { LucideIcon } from 'lucide-react';
import {
  Shield,
  Calendar,
  DollarSign,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type FormData = {
  program: string;
  reference_number: string;
  internal_reference: string;
  exhibition_id: string;
  loan_in_id: string;
  application_date: string;
  requested_coverage: string;
  awarded_coverage: string;
  coverage_currency: string;
  coverage_start_date: string;
  coverage_end_date: string;
  commercial_gap_required: boolean;
  gap_coverage_id: string;
  status: string;
  notes: string;
};

export const defaultFormData: FormData = {
  program: 'uk_gis',
  reference_number: '',
  internal_reference: '',
  exhibition_id: '',
  loan_in_id: '',
  application_date: new Date().toISOString().split('T')[0],
  requested_coverage: '',
  awarded_coverage: '',
  coverage_currency: 'USD',
  coverage_start_date: '',
  coverage_end_date: '',
  commercial_gap_required: false,
  gap_coverage_id: '',
  status: 'draft',
  notes: '',
};

export const PROGRAM_OPTIONS = [
  { value: 'us_arts', label: 'US Arts & Artifacts Indemnity' },
  { value: 'uk_gis', label: 'UK Government Indemnity Scheme' },
  { value: 'canada_special', label: 'Canada Special' },
  { value: 'eu_national', label: 'EU National' },
  { value: 'australia_indemnity', label: 'Australia Indemnity' },
  { value: 'other', label: 'Other' },
];

export const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
];

export const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD - US Dollar' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'GBP', label: 'GBP - British Pound' },
  { value: 'CAD', label: 'CAD - Canadian Dollar' },
  { value: 'AUD', label: 'AUD - Australian Dollar' },
  { value: 'CHF', label: 'CHF - Swiss Franc' },
  { value: 'JPY', label: 'JPY - Japanese Yen' },
];

export const STATUS_STYLES: Record<string, { bg: string; text: string; icon: LucideIcon }> = {
  draft: { bg: 'bg-stone', text: 'text-archive', icon: Shield },
  submitted: { bg: 'bg-semantic-warning/10', text: 'text-semantic-warning', icon: Calendar },
  under_review: { bg: 'bg-semantic-info/10', text: 'text-semantic-info', icon: Shield },
  approved: { bg: 'bg-semantic-success/10', text: 'text-semantic-success', icon: Shield },
  rejected: { bg: 'bg-semantic-error/10', text: 'text-semantic-error', icon: Shield },
  active: { bg: 'bg-semantic-success/10', text: 'text-semantic-success', icon: Shield },
  expired: { bg: 'bg-stone', text: 'text-archive', icon: Shield },
};

// Section groups for nav
export const INDEMNITY_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: Shield,
    defaultExpanded: true,
    sections: [
      { id: 'arrangement', label: 'Arrangement Details', dataKey: 'arrangement' },
      { id: 'application', label: 'Application & Coverage', dataKey: 'application' },
    ],
  },
  {
    id: 'coverage',
    label: 'Coverage',
    icon: DollarSign,
    defaultExpanded: false,
    sections: [
      { id: 'coveragePeriod', label: 'Coverage Period', dataKey: 'coveragePeriod' },
      { id: 'objects', label: 'Covered Objects', dataKey: 'objects' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: History,
    defaultExpanded: false,
    sections: [
      { id: 'notes', label: 'Notes', dataKey: 'notes' },
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

// Section-to-group mapping
export const SECTION_GROUPS: Record<string, string> = {
  arrangement: 'overview',
  application: 'overview',
  coveragePeriod: 'coverage',
  objects: 'coverage',
  notes: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'coverage', 'admin'];

export const ALL_SECTION_IDS = [
  'arrangement', 'application',
  'coveragePeriod', 'objects',
  'notes', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  arrangement: true,
  application: true,
  coveragePeriod: false,
  objects: false,
  notes: false,
  history: false,
};
