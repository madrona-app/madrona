import type { SectionGroup } from '../../../components/record-detail';
import {
  FileText,
  AlertTriangle,
  ClipboardList,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface EmergencyContact {
  name: string;
  role: string;
  phone: string;
  email: string;
  priority: number;
}

export interface RiskAssessment {
  hazard_type: string;
  likelihood: string;
  impact: string;
  mitigation_measures: string;
}

export interface FormData {
  title: string;
  plan_version: string;
  facility_name: string;
  evacuation_procedures: string;
  response_procedures: string;
  recovery_procedures: string;
  salvage_priority_guidance: string;
  last_drill_date: string;
  next_drill_date: string;
  review_date: string;
  notes: string;
}

export const defaultFormData: FormData = {
  title: '',
  plan_version: '1.0',
  facility_name: '',
  evacuation_procedures: '',
  response_procedures: '',
  recovery_procedures: '',
  salvage_priority_guidance: '',
  last_drill_date: '',
  next_drill_date: '',
  review_date: '',
  notes: '',
};

export const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-archive',
  approved: 'bg-semantic-success/10 text-semantic-success',
  active: 'bg-forest/10 text-forest',
  inactive: 'bg-stone text-archive',
};

// Section groups for nav
export const EMERGENCY_PLAN_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: FileText,
    defaultExpanded: true,
    sections: [
      { id: 'info', label: 'Plan Information', dataKey: 'info' },
      { id: 'contacts', label: 'Emergency Contacts', dataKey: 'contacts' },
    ],
  },
  {
    id: 'assessment',
    label: 'Assessment',
    icon: AlertTriangle,
    defaultExpanded: false,
    sections: [
      { id: 'risks', label: 'Risk Assessments', dataKey: 'risks' },
    ],
  },
  {
    id: 'response',
    label: 'Response',
    icon: ClipboardList,
    defaultExpanded: false,
    sections: [
      { id: 'procedures', label: 'Procedures', dataKey: 'procedures' },
      { id: 'schedule', label: 'Drill Schedule', dataKey: 'schedule' },
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
  info: 'overview',
  contacts: 'overview',
  risks: 'assessment',
  procedures: 'response',
  schedule: 'response',
  notes: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'assessment', 'response', 'admin'];

export const ALL_SECTION_IDS = [
  'info', 'contacts',
  'risks',
  'procedures', 'schedule',
  'notes', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  info: true,
  contacts: true,
  risks: false,
  procedures: false,
  schedule: false,
  notes: false,
  history: false,
};
