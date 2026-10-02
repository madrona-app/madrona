import type { SectionGroup } from '../../../components/record-detail';
import {
  Copy,
  Link as LinkIcon,
  Scale,
  Package,
  History,
  Clock,
  CheckCircle,
  XCircle,
  Camera,
  Truck,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  request_number: string;
  reproduction_type: string;
  reproduction_purpose: string;
  quantity: string;
  format_requested: string;
  dimensions_requested: string;
  intended_use: string;
  requester_name: string;
  requester_institution: string;
  requester_email: string;
  requester_phone: string;
  object_id: string;
  rights_cleared: boolean;
  rights_check_date: string;
  rights_restrictions: string;
  credit_line_required: string;
  fee_type: string;
  fee_amount: string;
  fee_currency: string;
  fee_paid: boolean;
  payment_date: string;
  delivery_method: string;
  delivery_date: string;
  master_file_reference: string;
  quality_approved: boolean;
  notes: string;
}

export const defaultFormData: FormData = {
  request_number: '',
  reproduction_type: 'photograph',
  reproduction_purpose: '',
  quantity: '',
  format_requested: '',
  dimensions_requested: '',
  intended_use: '',
  requester_name: '',
  requester_institution: '',
  requester_email: '',
  requester_phone: '',
  object_id: '',
  rights_cleared: false,
  rights_check_date: '',
  rights_restrictions: '',
  credit_line_required: '',
  fee_type: '',
  fee_amount: '',
  fee_currency: 'USD',
  fee_paid: false,
  payment_date: '',
  delivery_method: '',
  delivery_date: '',
  master_file_reference: '',
  quality_approved: false,
  notes: '',
};

export const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  submitted: { label: 'Submitted', color: 'bg-stone text-archive', icon: Clock },
  rights_review: { label: 'Rights Review', color: 'bg-semantic-warning/10 text-semantic-warning', icon: Clock },
  approved: { label: 'Approved', color: 'bg-semantic-success/10 text-semantic-success', icon: CheckCircle },
  denied: { label: 'Denied', color: 'bg-semantic-error/10 text-semantic-error', icon: XCircle },
  in_production: { label: 'In Production', color: 'bg-semantic-info/10 text-semantic-info', icon: Camera },
  delivered: { label: 'Delivered', color: 'bg-forest/10 text-forest', icon: Truck },
  completed: { label: 'Completed', color: 'bg-semantic-success/10 text-semantic-success', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-stone text-archive', icon: XCircle },
};

// Section groups for nav
export const REPRODUCTION_REQUEST_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: Copy,
    defaultExpanded: true,
    sections: [
      { id: 'details', label: 'Request Details', dataKey: 'details' },
      { id: 'requester', label: 'Requester Information', dataKey: 'requester' },
    ],
  },
  {
    id: 'linked',
    label: 'Linked Records',
    icon: LinkIcon,
    defaultExpanded: false,
    sections: [
      { id: 'linkedObject', label: 'Linked Object', dataKey: 'linkedObject' },
    ],
  },
  {
    id: 'compliance',
    label: 'Rights & Fees',
    icon: Scale,
    defaultExpanded: false,
    sections: [
      { id: 'rights', label: 'Rights Clearance', dataKey: 'rights' },
      { id: 'fees', label: 'Fees', dataKey: 'fees' },
    ],
  },
  {
    id: 'fulfillment',
    label: 'Fulfillment',
    icon: Package,
    defaultExpanded: false,
    sections: [
      { id: 'fulfillment', label: 'Fulfillment', dataKey: 'fulfillment' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: History,
    defaultExpanded: false,
    sections: [
      { id: 'notes', label: 'Additional Notes', dataKey: 'notes' },
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

// Section-to-group mapping
export const SECTION_GROUPS: Record<string, string> = {
  details: 'overview',
  requester: 'overview',
  linkedObject: 'linked',
  rights: 'compliance',
  fees: 'compliance',
  fulfillment: 'fulfillment',
  notes: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'linked', 'compliance', 'fulfillment', 'admin'];

export const ALL_SECTION_IDS = [
  'details', 'requester',
  'linkedObject',
  'rights', 'fees',
  'fulfillment',
  'notes', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  details: true,
  requester: true,
  linkedObject: false,
  rights: false,
  fees: false,
  fulfillment: false,
  notes: false,
  history: false,
};
