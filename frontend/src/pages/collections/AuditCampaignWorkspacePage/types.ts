import type { SectionGroup } from '../../../components/record-detail';
import {
  ClipboardCheck,
  Calendar,
  CheckSquare,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  title: string;
  audit_type: string;
  scope_description: string;
  sample_method: string;
  sample_size: string;
  sample_percentage: string;
  sampling_criteria: string;
  methodology: string;
  verification_procedures: string;
  planned_start_date: string;
  planned_end_date: string;
  objects_total: string;
  findings_summary: string;
  recommendations: string;
  remedial_actions: string;
}

export const defaultFormData: FormData = {
  title: '',
  audit_type: 'location',
  scope_description: '',
  sample_method: 'complete',
  sample_size: '',
  sample_percentage: '',
  sampling_criteria: '',
  methodology: '',
  verification_procedures: '',
  planned_start_date: '',
  planned_end_date: '',
  objects_total: '0',
  findings_summary: '',
  recommendations: '',
  remedial_actions: '',
};

// Section groups for nav
export const AUDIT_CAMPAIGN_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: ClipboardCheck,
    defaultExpanded: true,
    sections: [
      { id: 'info', label: 'Audit Information', dataKey: 'info' },
      { id: 'sampling', label: 'Sampling Strategy', dataKey: 'sampling' },
    ],
  },
  {
    id: 'planning',
    label: 'Planning',
    icon: Calendar,
    defaultExpanded: false,
    sections: [
      { id: 'timeline', label: 'Timeline', dataKey: 'timeline' },
      { id: 'methodology', label: 'Methodology', dataKey: 'methodology' },
    ],
  },
  {
    id: 'outcome',
    label: 'Outcome',
    icon: CheckSquare,
    defaultExpanded: false,
    sections: [
      { id: 'findings', label: 'Findings & Recommendations', dataKey: 'findings' },
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
  sampling: 'overview',
  timeline: 'planning',
  methodology: 'planning',
  findings: 'outcome',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'planning', 'outcome', 'admin'];

export const ALL_SECTION_IDS = [
  'info', 'sampling',
  'timeline', 'methodology',
  'findings',
  'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  info: true,
  sampling: true,
  timeline: false,
  methodology: false,
  findings: false,
  history: false,
};

export const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-archive',
  approved: 'bg-semantic-success/10 text-semantic-success',
  in_progress: 'bg-forest/10 text-forest',
  completed: 'bg-stone text-archive',
  cancelled: 'bg-stone text-archive',
};
