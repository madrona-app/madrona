import type { SectionGroup } from '../../../components/record-detail';
import {
  Palette,
  Globe,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  preferred_term: string;
  variant_terms: string[];
  authority_type: string;
  aat_id: string;
  wikidata_id: string;
  culture: string;
  date_display: string;
  date_earliest: string;
  date_latest: string;
  geographic_scope: string;
  parent_authority_id: string | null;
  description: string;
  notes: string;
  status: string;
}

export const defaultFormData: FormData = {
  preferred_term: '',
  variant_terms: [],
  authority_type: 'style',
  aat_id: '',
  wikidata_id: '',
  culture: '',
  date_display: '',
  date_earliest: '',
  date_latest: '',
  geographic_scope: '',
  parent_authority_id: null,
  description: '',
  notes: '',
  status: 'active',
};

// Section groups for nav
export const STYLE_PERIOD_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: Palette,
    defaultExpanded: true,
    sections: [
      { id: 'identity', label: 'Identity', dataKey: 'identity' },
      { id: 'dates', label: 'Date Range', dataKey: 'dates' },
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
  dates: 'overview',
  external: 'details',
  status: 'details',
  notes: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'details', 'admin'];

export const ALL_SECTION_IDS = [
  'identity', 'dates',
  'external', 'status',
  'notes', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  identity: true,
  dates: true,
  external: false,
  status: false,
  notes: false,
  history: false,
};
