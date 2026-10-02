import type { SectionGroup } from '../../../components/record-detail';
import {
  DollarSign,
  Calendar,
  Link as History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type FormData = {
  valuation_type: string;
  valuation_amount: string;
  valuation_currency: string;
  valuation_date: string;
  valuation_method: string;
  is_current: boolean;
  object_id: string;
  valuator_id: string;
  valuator_credentials: string;
  valid_from: string;
  valid_until: string;
  documentation_reference: string;
  valuation_note: string;
  // this procedure — formal authorization. Backend has these
  // columns on `valuations` (authorizer_id / authorization_date /
  // authorization_note); the procedure gap audit flagged them as missing
  // from the UI.
  authorizer_id: string;
  authorization_date: string;
  authorization_note: string;
};

export const defaultFormData: FormData = {
  valuation_type: 'insurance',
  valuation_amount: '',
  valuation_currency: 'USD',
  valuation_date: new Date().toISOString().split('T')[0],
  valuation_method: '',
  is_current: true,
  object_id: '',
  valuator_id: '',
  valuator_credentials: '',
  valid_from: '',
  valid_until: '',
  documentation_reference: '',
  valuation_note: '',
  authorizer_id: '',
  authorization_date: '',
  authorization_note: '',
};

// Section groups for nav
export const VALUATION_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: DollarSign,
    defaultExpanded: true,
    sections: [
      { id: 'details', label: 'Valuation Details', dataKey: 'details' },
      { id: 'valuator', label: 'Valuator Information', dataKey: 'valuator' },
    ],
  },
  {
    id: 'timing',
    label: 'Timing & Scope',
    icon: Calendar,
    defaultExpanded: false,
    sections: [
      { id: 'validity', label: 'Validity Period', dataKey: 'validity' },
      { id: 'linkedObject', label: 'Linked Object', dataKey: 'linkedObject' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: History,
    defaultExpanded: false,
    sections: [
      { id: 'documentation', label: 'Documentation', dataKey: 'documentation' },
      { id: 'authorization', label: 'Authorization', dataKey: 'authorization' },
      { id: 'notes', label: 'Additional Notes', dataKey: 'notes' },
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

// Section-to-group mapping
export const SECTION_GROUPS: Record<string, string> = {
  details: 'overview',
  valuator: 'overview',
  validity: 'timing',
  linkedObject: 'timing',
  documentation: 'admin',
  authorization: 'admin',
  notes: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'timing', 'admin'];

export const ALL_SECTION_IDS = [
  'details', 'valuator',
  'validity', 'linkedObject',
  'documentation', 'authorization', 'notes', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  details: true,
  valuator: true,
  validity: false,
  linkedObject: false,
  documentation: false,
  authorization: false,
  notes: false,
  history: false,
};
