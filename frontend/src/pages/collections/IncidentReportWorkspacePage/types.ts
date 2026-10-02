import type { SectionGroup } from '../../../components/record-detail';
import {
  AlertTriangle,
  Zap,
  CheckCircle,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  report_number: string;
  report_date: string;
  incident_type: string;
  incident_subtype: string;
  incident_date: string;
  incident_location_description: string;
  discovered_date: string;
  discovered_by_name: string;
  discovery_circumstances: string;
  incident_description: string;
  cause_analysis: string;
  immediate_actions: string;
  police_notified: boolean;
  police_report_number: string;
  police_report_date: string;
  insurance_claim_filed: boolean;
  insurance_claim_number: string;
  insurance_claim_status: string;
  insurance_claim_amount: string;
  insurance_settlement_amount: string;
  investigation_required: boolean;
  investigation_findings: string;
  investigation_completed_date: string;
  resolution_summary: string;
  resolved_date: string;
  lessons_learned: string;
}

export const defaultFormData: FormData = {
  report_number: '',
  report_date: new Date().toISOString().split('T')[0],
  incident_type: 'damage',
  incident_subtype: '',
  incident_date: '',
  incident_location_description: '',
  discovered_date: '',
  discovered_by_name: '',
  discovery_circumstances: '',
  incident_description: '',
  cause_analysis: '',
  immediate_actions: '',
  police_notified: false,
  police_report_number: '',
  police_report_date: '',
  insurance_claim_filed: false,
  insurance_claim_number: '',
  insurance_claim_status: '',
  insurance_claim_amount: '',
  insurance_settlement_amount: '',
  investigation_required: false,
  investigation_findings: '',
  investigation_completed_date: '',
  resolution_summary: '',
  resolved_date: '',
  lessons_learned: '',
};

export const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-archive',
  submitted: 'bg-semantic-info/10 text-semantic-info',
  under_investigation: 'bg-semantic-warning/10 text-semantic-warning',
  resolved: 'bg-semantic-success/10 text-semantic-success',
  closed: 'bg-stone text-archive',
};

// Section groups for nav
export const INCIDENT_REPORT_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: AlertTriangle,
    defaultExpanded: true,
    sections: [
      { id: 'incident', label: 'Incident Information', dataKey: 'incident' },
      { id: 'discovery', label: 'Discovery', dataKey: 'discovery' },
      { id: 'objects', label: 'Affected Objects', dataKey: 'objects' },
    ],
  },
  {
    id: 'response',
    label: 'Response',
    icon: Zap,
    defaultExpanded: false,
    sections: [
      { id: 'response', label: 'Response', dataKey: 'response' },
      { id: 'police', label: 'Police Report', dataKey: 'police' },
      { id: 'insurance', label: 'Insurance Claim', dataKey: 'insurance' },
    ],
  },
  {
    id: 'outcome',
    label: 'Outcome',
    icon: CheckCircle,
    defaultExpanded: false,
    sections: [
      { id: 'investigation', label: 'Investigation', dataKey: 'investigation' },
      { id: 'resolution', label: 'Resolution', dataKey: 'resolution' },
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
  incident: 'overview',
  discovery: 'overview',
  objects: 'overview',
  response: 'response',
  police: 'response',
  insurance: 'response',
  investigation: 'outcome',
  resolution: 'outcome',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'response', 'outcome', 'admin'];

export const ALL_SECTION_IDS = [
  'incident', 'discovery', 'objects',
  'response', 'police', 'insurance',
  'investigation', 'resolution',
  'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  incident: true,
  discovery: true,
  objects: true,
  response: false,
  police: false,
  insurance: false,
  investigation: false,
  resolution: false,
  history: false,
};
