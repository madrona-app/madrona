import type { SectionGroup } from '../../../components/record-detail';
import {
  BookOpen,
  Globe,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  citation_type: string;
  brief_citation: string;
  full_citation: string;
  author: string;
  title: string;
  publication: string;
  publisher: string;
  publication_place: string;
  publication_year: string;
  volume: string;
  issue: string;
  pages: string;
  url: string;
  doi: string;
  isbn: string;
  works_cited: boolean;
  works_illustrated: boolean;
  notes: string;
}

export const defaultFormData: FormData = {
  citation_type: 'book',
  brief_citation: '',
  full_citation: '',
  author: '',
  title: '',
  publication: '',
  publisher: '',
  publication_place: '',
  publication_year: '',
  volume: '',
  issue: '',
  pages: '',
  url: '',
  doi: '',
  isbn: '',
  works_cited: false,
  works_illustrated: false,
  notes: '',
};

// Section groups for nav
export const CITATION_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: BookOpen,
    defaultExpanded: true,
    sections: [
      { id: 'basic', label: 'Basic Information', dataKey: 'basic' },
      { id: 'structured', label: 'Structured Fields', dataKey: 'structured' },
    ],
  },
  {
    id: 'details',
    label: 'Details',
    icon: Globe,
    defaultExpanded: false,
    sections: [
      { id: 'digital', label: 'Digital Identifiers', dataKey: 'digital' },
      { id: 'flags', label: 'Citation Flags', dataKey: 'flags' },
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
  basic: 'overview',
  structured: 'overview',
  digital: 'details',
  flags: 'details',
  notes: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'details', 'admin'];

export const ALL_SECTION_IDS = [
  'basic', 'structured',
  'digital', 'flags',
  'notes', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  basic: true,
  structured: true,
  digital: false,
  flags: false,
  notes: false,
  history: false,
};
