import type { SectionGroup } from '../../../components/record-detail';
import {
  FileText,
  Calendar,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface Milestone {
  date: string;
  description: string;
}

export interface FormData {
  title: string;
  plan_type: string;
  objectives: string;
  measurable_results: string[];
  actions: string[];
  milestones: Milestone[];
  resources_required: string;
  start_date: string;
  end_date: string;
  review_frequency: string;
  next_review_date: string;
  notes: string;
}

export const defaultFormData: FormData = {
  title: '',
  plan_type: 'cataloging_plan',
  objectives: '',
  measurable_results: [],
  actions: [],
  milestones: [],
  resources_required: '',
  start_date: '',
  end_date: '',
  review_frequency: '',
  next_review_date: '',
  notes: '',
};

// Section groups for nav
export const DOC_PLAN_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: FileText,
    defaultExpanded: true,
    sections: [
      { id: 'basic', label: 'Basic Information', dataKey: 'basic' },
      { id: 'content', label: 'Content', dataKey: 'content' },
    ],
  },
  {
    id: 'details',
    label: 'Details',
    icon: Calendar,
    defaultExpanded: false,
    sections: [
      { id: 'timeline', label: 'Timeline', dataKey: 'timeline' },
      { id: 'resources', label: 'Resources', dataKey: 'resources' },
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
  content: 'overview',
  timeline: 'details',
  resources: 'details',
  notes: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'details', 'admin'];

export const ALL_SECTION_IDS = [
  'basic', 'content',
  'timeline', 'resources',
  'notes', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  basic: true,
  content: true,
  timeline: false,
  resources: false,
  notes: false,
  history: false,
};
