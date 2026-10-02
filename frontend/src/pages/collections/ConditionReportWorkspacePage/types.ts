import type { SectionGroup } from '../../../components/record-detail';
import {
  FileText,
  Wrench,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  report_type: string;
  check_reason: string;
  report_date: string;
  examiner_id: string;
  object_id: string;
  overall_condition: string;
  condition_summary: string;
  completeness: string;
  completeness_date: string;
  hazards: string;
  recommendations: string;
  conservation_needed: boolean;
  conservation_priority: string;
  handling_requirements: string;
  packing_requirements: string;
  display_restrictions: string;
  next_check_date: string;
  report_note: string;
}

export const defaultFormData: FormData = {
  report_type: 'periodic',
  check_reason: '',
  report_date: new Date().toISOString().split('T')[0],
  examiner_id: '',
  object_id: '',
  overall_condition: '',
  condition_summary: '',
  completeness: '',
  completeness_date: '',
  hazards: '',
  recommendations: '',
  conservation_needed: false,
  conservation_priority: '',
  handling_requirements: '',
  packing_requirements: '',
  display_restrictions: '',
  next_check_date: '',
  report_note: '',
};

// Section groups for nav
export const CONDITION_REPORT_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: FileText,
    defaultExpanded: true,
    sections: [
      { id: 'report', label: 'Report Information', dataKey: 'report' },
      { id: 'condition', label: 'Condition Assessment', dataKey: 'condition' },
    ],
  },
  {
    id: 'details',
    label: 'Details',
    icon: Wrench,
    defaultExpanded: false,
    sections: [
      { id: 'conservation', label: 'Conservation', dataKey: 'conservation' },
      { id: 'requirements', label: 'Handling Requirements', dataKey: 'requirements' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: History,
    defaultExpanded: false,
    sections: [
      { id: 'notes', label: 'Additional Notes', dataKey: 'notes' },
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

// Section-to-group mapping
export const SECTION_GROUPS: Record<string, string> = {
  report: 'overview',
  condition: 'overview',
  conservation: 'details',
  requirements: 'details',
  notes: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'details', 'admin'];

export const ALL_SECTION_IDS = [
  'report', 'condition',
  'conservation', 'requirements',
  'notes', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  report: true,
  condition: true,
  conservation: false,
  requirements: false,
  notes: false,
  history: false,
};
