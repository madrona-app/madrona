import type { SectionGroup } from '../../../components/record-detail';
import {
  Tag,
  Globe,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  preferred_term: string;
  variant_terms: string[];
  subject_type: string;
  aat_id: string;
  iconclass_id: string;
  wikidata_id: string;
  broader_subject_id: string | null;
  description: string;
  notes: string;
  status: string;
}

export const defaultFormData: FormData = {
  preferred_term: '',
  variant_terms: [],
  subject_type: 'iconographic',
  aat_id: '',
  iconclass_id: '',
  wikidata_id: '',
  broader_subject_id: null,
  description: '',
  notes: '',
  status: 'active',
};

// Section groups for nav
export const SUBJECT_AUTHORITY_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: Tag,
    defaultExpanded: true,
    sections: [
      { id: 'identity', label: 'Identity', dataKey: 'identity' },
      { id: 'description', label: 'Description', dataKey: 'description' },
    ],
  },
  {
    id: 'details',
    label: 'Details',
    icon: Globe,
    defaultExpanded: false,
    sections: [
      { id: 'external', label: 'External Identifiers', dataKey: 'external' },
      { id: 'status', label: 'Status', dataKey: 'status' },
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
  identity: 'overview',
  description: 'overview',
  external: 'details',
  status: 'details',
  notes: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'details', 'admin'];

export const ALL_SECTION_IDS = [
  'identity', 'description',
  'external', 'status',
  'notes', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  identity: true,
  description: true,
  external: false,
  status: false,
  notes: false,
  history: false,
};
