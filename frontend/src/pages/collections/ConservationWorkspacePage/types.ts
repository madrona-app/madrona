import type { SectionGroup } from '../../../components/record-detail';
import type { LucideIcon } from 'lucide-react';
import {
  Wrench,
  FileText,
  Calendar,
  StickyNote,
  Clock,
  CheckCircle,
  PlayCircle,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface ConservationFormData {
  object_id: string;
  conservator_id: string;
  treatment_type: string;
  proposal_date: string;
  proposal_summary: string;
  proposal_document_ref: string;
  estimated_duration_days: string;
  estimated_cost: string;
  estimated_cost_currency: string;
  start_date: string;
  end_date: string;
  actual_duration_days: string;
  actual_cost: string;
  actual_cost_currency: string;
  treatment_description: string;
  materials_used: string;
  methods_used: string;
  recommendations: string;
  restrictions: string;
  treatment_note: string;
}

export const defaultFormData: ConservationFormData = {
  object_id: '',
  conservator_id: '',
  treatment_type: 'remedial',
  proposal_date: new Date().toISOString().split('T')[0],
  proposal_summary: '',
  proposal_document_ref: '',
  estimated_duration_days: '',
  estimated_cost: '',
  estimated_cost_currency: 'USD',
  start_date: '',
  end_date: '',
  actual_duration_days: '',
  actual_cost: '',
  actual_cost_currency: 'USD',
  treatment_description: '',
  materials_used: '',
  methods_used: '',
  recommendations: '',
  restrictions: '',
  treatment_note: '',
};

export const STATUS_CONFIG: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  proposed: { label: 'Proposed', color: 'bg-semantic-warning/10 text-semantic-warning', icon: Clock },
  approved: { label: 'Approved', color: 'bg-semantic-info/10 text-semantic-info', icon: CheckCircle },
  in_progress: { label: 'In Progress', color: 'bg-bark/10 text-bark', icon: PlayCircle },
  completed: { label: 'Completed', color: 'bg-semantic-success/10 text-semantic-success', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-stone text-archive', icon: Clock },
};

// Section groups for nav
export const CONSERVATION_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: Wrench,
    defaultExpanded: true,
    sections: [
      { id: 'treatment', label: 'Treatment Info', dataKey: 'treatment' },
      { id: 'conservator', label: 'Conservator', dataKey: 'conservator' },
    ],
  },
  {
    id: 'proposal',
    label: 'Proposal',
    icon: FileText,
    defaultExpanded: false,
    sections: [
      { id: 'proposal', label: 'Treatment Proposal', dataKey: 'proposal' },
    ],
  },
  {
    id: 'execution',
    label: 'Execution',
    icon: Calendar,
    defaultExpanded: false,
    sections: [
      { id: 'execution', label: 'Treatment Execution', dataKey: 'execution' },
      { id: 'actuals', label: 'Actual Results', dataKey: 'actuals' },
    ],
  },
  {
    id: 'outcome',
    label: 'Outcome',
    icon: StickyNote,
    defaultExpanded: false,
    sections: [
      { id: 'recommendations', label: 'Recommendations', dataKey: 'recommendations' },
      { id: 'notes', label: 'Notes', dataKey: 'notes' },
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

// Section-to-group mapping
export const SECTION_GROUPS: Record<string, string> = {
  treatment: 'overview',
  conservator: 'overview',
  proposal: 'proposal',
  execution: 'execution',
  actuals: 'execution',
  recommendations: 'outcome',
  notes: 'outcome',
  history: 'outcome',
};

export const GROUP_ORDER = ['overview', 'proposal', 'execution', 'outcome'];

export const ALL_SECTION_IDS = [
  'treatment', 'conservator',
  'proposal',
  'execution', 'actuals',
  'recommendations', 'notes', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  treatment: true,
  conservator: true,
  proposal: false,
  execution: false,
  actuals: false,
  recommendations: false,
  notes: false,
  history: false,
};
