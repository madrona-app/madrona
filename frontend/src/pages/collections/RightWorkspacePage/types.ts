import type { SectionGroup } from '../../../components/record-detail';
import {
  Scale,
  User,
  FileSignature,
  AlertTriangle,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  object_id: string;
  right_type: string;
  right_subtype: string;
  rights_holder_contact_id: string;
  status: string;
  start_date: string;
  end_date: string;
  is_perpetual: boolean;
  territory: string;
  territory_note: string;
  license_type: string;
  license_reference: string;
  license_url: string;
  usage_conditions: string;
  restrictions: string;
  fee_required: boolean;
  fee_amount: string;
  fee_currency: string;
  fee_note: string;
  is_orphan_work: boolean;
  due_diligence_conducted: boolean;
  due_diligence_date: string;
  orphan_works_license_number: string;
  orphan_works_license_date: string;
  orphan_works_license_expiry: string;
  agreement_reference: string;
  next_review_date: string;
  right_note: string;
  internal_note: string;
}

export const defaultFormData: FormData = {
  object_id: '',
  right_type: 'copyright',
  right_subtype: '',
  rights_holder_contact_id: '',
  status: 'unknown',
  start_date: '',
  end_date: '',
  is_perpetual: false,
  territory: '',
  territory_note: '',
  license_type: '',
  license_reference: '',
  license_url: '',
  usage_conditions: '',
  restrictions: '',
  fee_required: false,
  fee_amount: '',
  fee_currency: 'USD',
  fee_note: '',
  is_orphan_work: false,
  due_diligence_conducted: false,
  due_diligence_date: '',
  orphan_works_license_number: '',
  orphan_works_license_date: '',
  orphan_works_license_expiry: '',
  agreement_reference: '',
  next_review_date: '',
  right_note: '',
  internal_note: '',
};

// Section groups for nav
export const RIGHT_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: Scale,
    defaultExpanded: true,
    sections: [
      { id: 'object', label: 'Linked Object', dataKey: 'object' },
      { id: 'details', label: 'Right Details', dataKey: 'details' },
    ],
  },
  {
    id: 'parties',
    label: 'Parties & Duration',
    icon: User,
    defaultExpanded: false,
    sections: [
      { id: 'holder', label: 'Rights Holder', dataKey: 'holder' },
      { id: 'duration', label: 'Duration & Territory', dataKey: 'duration' },
    ],
  },
  {
    id: 'licensing',
    label: 'Licensing & Fees',
    icon: FileSignature,
    defaultExpanded: false,
    sections: [
      { id: 'license', label: 'License Details', dataKey: 'license' },
      { id: 'fees', label: 'Fees', dataKey: 'fees' },
    ],
  },
  {
    id: 'compliance',
    label: 'Compliance & Notes',
    icon: AlertTriangle,
    defaultExpanded: false,
    sections: [
      { id: 'orphan', label: 'Orphan Works (UK Compliance)', dataKey: 'orphan' },
      { id: 'notes', label: 'Documentation & Notes', dataKey: 'notes' },
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

// Section-to-group mapping
export const SECTION_GROUPS: Record<string, string> = {
  object: 'overview',
  details: 'overview',
  holder: 'parties',
  duration: 'parties',
  license: 'licensing',
  fees: 'licensing',
  orphan: 'compliance',
  notes: 'compliance',
  history: 'compliance',
};

export const GROUP_ORDER = ['overview', 'parties', 'licensing', 'compliance'];

export const ALL_SECTION_IDS = [
  'object', 'details',
  'holder', 'duration',
  'license', 'fees',
  'orphan', 'notes', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  object: true,
  details: true,
  holder: false,
  duration: false,
  license: false,
  fees: false,
  orphan: false,
  notes: false,
  history: false,
};
