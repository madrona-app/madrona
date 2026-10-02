import type { SectionGroup } from '../../../components/record-detail';
import {
  Calendar,
  Package,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  title: string;
  event_type: string;
  status: string;
  start_at: string;
  end_at: string;
  location_id: string;
  // Teaching fields
  course_code: string;
  instructor_id: string;
  department: string;
  institution: string;
  headcount: string;
  session_format: string;
  // Program fields
  audience: string;
  capacity: string;
  registration_url: string;
  // General
  description: string;
  notes: string;
}

export const defaultFormData: FormData = {
  title: '',
  event_type: 'program',
  status: 'draft',
  start_at: '',
  end_at: '',
  location_id: '',
  course_code: '',
  instructor_id: '',
  department: '',
  institution: '',
  headcount: '',
  session_format: '',
  audience: '',
  capacity: '',
  registration_url: '',
  description: '',
  notes: '',
};

// Section groups for nav
export const EVENT_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: Calendar,
    defaultExpanded: true,
    sections: [
      { id: 'details', label: 'Event Details', dataKey: 'details' },
      { id: 'teaching', label: 'Teaching Details', dataKey: 'teaching' },
      { id: 'program', label: 'Program Details', dataKey: 'program' },
    ],
  },
  {
    id: 'linked',
    label: 'Linked Records',
    icon: Package,
    defaultExpanded: false,
    sections: [
      { id: 'objects', label: 'Related Objects', dataKey: 'objects' },
      { id: 'impact', label: 'Collections Impact', dataKey: 'impact' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: History,
    defaultExpanded: false,
    sections: [
      { id: 'discussion', label: 'Discussion', dataKey: 'discussion' },
      { id: 'notes', label: 'Notes', dataKey: 'notes' },
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

// Section-to-group mapping
export const SECTION_GROUPS: Record<string, string> = {
  details: 'overview',
  teaching: 'overview',
  program: 'overview',
  objects: 'linked',
  impact: 'linked',
  discussion: 'admin',
  notes: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'linked', 'admin'];

export const ALL_SECTION_IDS = [
  'details', 'teaching', 'program',
  'objects', 'impact',
  'discussion', 'notes', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  details: true,
  teaching: true,
  program: true,
  objects: true,
  impact: true,
  discussion: false,
  notes: false,
  history: false,
};
