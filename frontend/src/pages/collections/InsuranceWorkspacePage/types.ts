import type { SectionGroup } from '../../../components/record-detail';
import type { LucideIcon } from 'lucide-react';
import {
  Shield,
  Calendar,
  DollarSign,
  LinkIcon,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type FormData = {
  policy_number: string;
  policy_name: string;
  policy_type: string;
  provider_name: string;
  broker_name: string;
  effective_date: string;
  expiration_date: string;
  coverage_limit: string;
  coverage_limit_currency: string;
  per_occurrence_limit: string;
  deductible: string;
  annual_premium: string;
  status: string;
  notes: string;
};

export const defaultFormData: FormData = {
  policy_number: '',
  policy_name: '',
  policy_type: 'blanket',
  provider_name: '',
  broker_name: '',
  effective_date: new Date().toISOString().split('T')[0],
  expiration_date: '',
  coverage_limit: '',
  coverage_limit_currency: 'USD',
  per_occurrence_limit: '',
  deductible: '',
  annual_premium: '',
  status: 'draft',
  notes: '',
};

export const POLICY_TYPE_OPTIONS = [
  { value: 'blanket', label: 'Blanket Coverage' },
  { value: 'fine_arts', label: 'Fine Arts' },
  { value: 'marine', label: 'Marine' },
  { value: 'exhibition', label: 'Exhibition' },
  { value: 'all_risk', label: 'All Risk' },
  { value: 'named_perils', label: 'Named Perils' },
];

export const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'renewed', label: 'Renewed' },
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
  pending_approval: { bg: 'bg-semantic-warning/10', text: 'text-semantic-warning', icon: Calendar },
  active: { bg: 'bg-semantic-success/10', text: 'text-semantic-success', icon: Shield },
  expired: { bg: 'bg-stone', text: 'text-archive', icon: Shield },
  cancelled: { bg: 'bg-semantic-error/10', text: 'text-semantic-error', icon: Shield },
  renewed: { bg: 'bg-semantic-info/10', text: 'text-semantic-info', icon: Shield },
};

export const ENTITY_TYPE_OPTIONS = [
  { value: 'collection_object', label: 'Collection Object' },
  { value: 'loan_in', label: 'Loan In' },
  { value: 'loan_out', label: 'Loan Out' },
  { value: 'shipment', label: 'Shipment' },
  { value: 'exhibition', label: 'Exhibition' },
  { value: 'movement', label: 'Movement' },
  { value: 'object_entry', label: 'Object Entry' },
  { value: 'object_exit', label: 'Object Exit' },
];

// Section groups for nav
export const INSURANCE_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: Shield,
    defaultExpanded: true,
    sections: [
      { id: 'details', label: 'Policy Details', dataKey: 'details' },
      { id: 'provider', label: 'Provider Information', dataKey: 'provider' },
    ],
  },
  {
    id: 'financial',
    label: 'Financial',
    icon: DollarSign,
    defaultExpanded: false,
    sections: [
      { id: 'coverage', label: 'Coverage & Financial', dataKey: 'coverage' },
      { id: 'dates', label: 'Coverage Period', dataKey: 'dates' },
    ],
  },
  {
    id: 'linked',
    label: 'Linked Items',
    icon: LinkIcon,
    defaultExpanded: false,
    sections: [
      { id: 'coveredItems', label: 'Covered Items', dataKey: 'coveredItems' },
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
  details: 'overview',
  provider: 'overview',
  coverage: 'financial',
  dates: 'financial',
  coveredItems: 'linked',
  notes: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'financial', 'linked', 'admin'];

export const ALL_SECTION_IDS = [
  'details', 'provider',
  'coverage', 'dates',
  'coveredItems',
  'notes', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  details: true,
  provider: true,
  coverage: true,
  dates: false,
  coveredItems: true,
  notes: false,
  history: false,
};
