import type { SectionGroup } from '../../../components/record-detail';
import {
  User,
  Calendar,
  Image,
  DollarSign,
  Package,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  request_number: string;
  request_date: string;
  use_type: string;
  use_subtype: string;
  use_purpose: string;
  use_description: string;
  requester_name: string;
  requester_title: string;
  requester_institution: string;
  requester_email: string;
  requester_phone: string;
  access_date_start: string;
  access_date_end: string;
  location_required: string;
  project_title: string;
  project_description: string;
  project_deadline: string;
  reproduction_type: string;
  reproduction_quantity: string;
  reproduction_format: string;
  intended_use: string;
  publication_details: string;
  credit_line: string;
  exhibition_title: string;
  exhibition_venue: string;
  exhibition_dates: string;
  insurance_value: string;
  fee_quoted: string;
  fee_paid: string;
  fee_waived: boolean;
  fee_waiver_reason: string;
  approval_conditions: string;
}

export const defaultFormData: FormData = {
  request_number: '',
  request_date: new Date().toISOString().split('T')[0],
  use_type: 'research',
  use_subtype: '',
  use_purpose: '',
  use_description: '',
  requester_name: '',
  requester_title: '',
  requester_institution: '',
  requester_email: '',
  requester_phone: '',
  access_date_start: '',
  access_date_end: '',
  location_required: '',
  project_title: '',
  project_description: '',
  project_deadline: '',
  reproduction_type: '',
  reproduction_quantity: '',
  reproduction_format: '',
  intended_use: '',
  publication_details: '',
  credit_line: '',
  exhibition_title: '',
  exhibition_venue: '',
  exhibition_dates: '',
  insurance_value: '',
  fee_quoted: '',
  fee_paid: '',
  fee_waived: false,
  fee_waiver_reason: '',
  approval_conditions: '',
};

// Section groups for nav
export const USE_REQUEST_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: User,
    defaultExpanded: true,
    sections: [
      { id: 'requester', label: 'Requester Information', dataKey: 'requester' },
      { id: 'details', label: 'Request Details', dataKey: 'details' },
    ],
  },
  {
    id: 'linked',
    label: 'Linked Records',
    icon: Package,
    defaultExpanded: true,
    sections: [
      { id: 'objects', label: 'Requested Objects', dataKey: 'objects' },
    ],
  },
  {
    id: 'scheduling',
    label: 'Scheduling',
    icon: Calendar,
    defaultExpanded: false,
    sections: [
      { id: 'access', label: 'Access Period', dataKey: 'access' },
      { id: 'project', label: 'Project Details', dataKey: 'project' },
    ],
  },
  {
    id: 'fulfillment',
    label: 'Fulfillment',
    icon: Image,
    defaultExpanded: false,
    sections: [
      { id: 'reproduction', label: 'Reproduction Details', dataKey: 'reproduction' },
      { id: 'exhibition', label: 'Exhibition Details', dataKey: 'exhibition' },
    ],
  },
  {
    id: 'financial',
    label: 'Financial',
    icon: DollarSign,
    defaultExpanded: false,
    sections: [
      { id: 'fees', label: 'Fees', dataKey: 'fees' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: History,
    defaultExpanded: false,
    sections: [
      { id: 'approval', label: 'Approval Conditions', dataKey: 'approval' },
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

// Section-to-group mapping
export const SECTION_GROUPS: Record<string, string> = {
  requester: 'overview',
  details: 'overview',
  objects: 'linked',
  access: 'scheduling',
  project: 'scheduling',
  reproduction: 'fulfillment',
  exhibition: 'fulfillment',
  fees: 'financial',
  approval: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'linked', 'scheduling', 'fulfillment', 'financial', 'admin'];

export const ALL_SECTION_IDS = [
  'requester', 'details',
  'objects',
  'access', 'project',
  'reproduction', 'exhibition',
  'fees',
  'approval', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  requester: true,
  details: true,
  objects: true,
  access: false,
  project: false,
  reproduction: false,
  exhibition: false,
  fees: false,
  approval: false,
  history: false,
};
