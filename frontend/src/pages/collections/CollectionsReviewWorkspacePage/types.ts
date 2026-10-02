import type { SectionGroup } from '../../../components/record-detail';
import {
  FileSearch,
  FileText,
  CheckSquare,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  title: string;
  review_type: string;
  review_reason: string;
  scope_description: string;
  methodology: string;
  scoring_guidance: string;
  planned_start_date: string;
  planned_end_date: string;
  objects_total: string;
  findings_summary: string;
  recommendations: string;
}

export const defaultFormData: FormData = {
  title: '',
  review_type: 'significance',
  review_reason: '',
  scope_description: '',
  methodology: '',
  scoring_guidance: '',
  planned_start_date: '',
  planned_end_date: '',
  objects_total: '0',
  findings_summary: '',
  recommendations: '',
};

export const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-archive',
  approved: 'bg-semantic-success/10 text-semantic-success',
  in_progress: 'bg-forest/10 text-forest',
  completed: 'bg-stone text-archive',
  cancelled: 'bg-stone text-archive',
};

export const RECOMMENDATION_LABELS: Record<string, string> = {
  retain: 'Retain',
  retain_priority: 'Retain (Priority)',
  further_review: 'Further Review',
  deaccession: 'Deaccession',
  transfer: 'Transfer',
  conservation: 'Conservation Needed',
  rehouse: 'Rehouse',
  document: 'Document',
  digitize: 'Digitize',
};

// Section groups for nav
export const REVIEW_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: FileSearch,
    defaultExpanded: true,
    sections: [
      { id: 'info', label: 'Review Information', dataKey: 'info' },
      { id: 'timeline', label: 'Timeline', dataKey: 'timeline' },
    ],
  },
  {
    id: 'details',
    label: 'Details',
    icon: FileText,
    defaultExpanded: false,
    sections: [
      { id: 'methodology', label: 'Methodology', dataKey: 'methodology' },
      { id: 'progress', label: 'Progress', dataKey: 'progress' },
      { id: 'assessments', label: 'Recent Assessments', dataKey: 'assessments' },
    ],
  },
  {
    id: 'outcome',
    label: 'Outcome',
    icon: CheckSquare,
    defaultExpanded: false,
    sections: [
      { id: 'findings', label: 'Findings & Recommendations', dataKey: 'findings' },
      { id: 'team', label: 'Team', dataKey: 'team' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: History,
    defaultExpanded: false,
    sections: [
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

// Section-to-group mapping
export const SECTION_GROUPS: Record<string, string> = {
  info: 'overview',
  timeline: 'overview',
  methodology: 'details',
  progress: 'details',
  assessments: 'details',
  findings: 'outcome',
  team: 'outcome',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'details', 'outcome', 'admin'];

export const ALL_SECTION_IDS = [
  'info', 'timeline',
  'methodology', 'progress', 'assessments',
  'findings', 'team',
  'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  info: true,
  timeline: true,
  methodology: false,
  progress: true,
  assessments: false,
  findings: false,
  team: false,
  history: false,
};
