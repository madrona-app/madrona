import type { SectionGroup } from '../../../components/record-detail';
import {
  FileText,
  Calendar,
  Package,
  Users,
  Eye,
  History,
  ClipboardList,
  } from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  title: string;
  exhibition_number: string;
  description: string;
  curator_notes: string;
  exhibition_type: string;
  status: string;
  provisos: string;
  outcome: string;
  planned_start_date: string;
  planned_end_date: string;
  actual_start_date: string;
  actual_end_date: string;
  venue_id: string;
  is_public: boolean;
  public_url_slug: string;
  // Authorization fields
  authorization_date: string;
  authorizer_name: string;
}

export const defaultFormData: FormData = {
  title: '',
  exhibition_number: '',
  description: '',
  curator_notes: '',
  exhibition_type: 'temporary',
  status: 'proposed',
  provisos: '',
  outcome: '',
  planned_start_date: '',
  planned_end_date: '',
  actual_start_date: '',
  actual_end_date: '',
  venue_id: '',
  is_public: false,
  public_url_slug: '',
  authorization_date: '',
  authorizer_name: '',
};

// Section groups for nav
export const EXHIBITION_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: FileText,
    defaultExpanded: true,
    sections: [
      { id: 'details', label: 'Exhibition Details', dataKey: 'details' },
      { id: 'dates', label: 'Dates', dataKey: 'dates' },
      { id: 'authorization', label: 'Authorization', dataKey: 'authorization' },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    icon: Package,
    defaultExpanded: false,
    sections: [
      { id: 'objects', label: 'Exhibition Objects', dataKey: 'objects' },
      { id: 'labels', label: 'Labels', dataKey: 'labels' },
      { id: 'interpretive', label: 'Interpretive Content', dataKey: 'interpretive' },
      { id: 'touring', label: 'Touring Schedule', dataKey: 'touring' },
    ],
  },
  {
    id: 'planning',
    label: 'Planning',
    icon: ClipboardList,
    defaultExpanded: false,
    sections: [
      { id: 'checklist', label: 'Checklist', dataKey: 'checklist' },
      { id: 'budget', label: 'Budget', dataKey: 'budget' },
      { id: 'logistics', label: 'Logistics', dataKey: 'logistics' },
      { id: 'loans', label: 'Loans', dataKey: 'loans' },
    ],
  },
  {
    id: 'publishing',
    label: 'Publishing',
    icon: Eye,
    defaultExpanded: false,
    sections: [
      { id: 'exports', label: 'Exports', dataKey: 'exports' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: History,
    defaultExpanded: false,
    sections: [
      { id: 'notes', label: 'Notes', dataKey: 'notes' },
      { id: 'discussion', label: 'Discussion', dataKey: 'discussion' },
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

// Section-to-group mapping
export const SECTION_GROUPS: Record<string, string> = {
  details: 'overview',
  dates: 'overview',
  authorization: 'overview',
  objects: 'content',
  labels: 'content',
  interpretive: 'content',
  touring: 'content',
  checklist: 'planning',
  budget: 'planning',
  logistics: 'planning',
  loans: 'planning',
  public: 'publishing',
  exports: 'publishing',
  notes: 'admin',
  discussion: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'content', 'planning', 'publishing', 'admin'];

export const ALL_SECTION_IDS = [
  'details', 'dates', 'authorization',
  'objects', 'labels', 'interpretive', 'touring',
  'checklist', 'budget', 'logistics', 'loans',
  'exports',
  'notes', 'discussion', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  details: true,
  dates: true,
  authorization: false,
  objects: false,
  labels: false,
  interpretive: false,
  touring: false,
  checklist: false,
  budget: false,
  logistics: false,
  loans: false,
  public: false,
  exports: false,
  notes: false,
  discussion: false,
  history: false,
};

export const EXHIBITION_TYPES = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'temporary', label: 'Temporary' },
  { value: 'touring', label: 'Touring' },
  { value: 'traveling', label: 'Traveling' },
  { value: 'online', label: 'Online' },
  { value: 'pop_up', label: 'Pop-up' },
];

export const STATUS_OPTIONS = [
  { value: 'proposed', label: 'Proposed' },
  { value: 'authorized', label: 'Authorized' },
  { value: 'in_preparation', label: 'In Preparation' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'archived', label: 'Archived' },
];

export const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof FileText }> = {
  proposed: { label: 'Proposed', color: 'bg-stone text-ink', icon: Calendar },
  authorized: { label: 'Authorized', color: 'bg-semantic-info/10 text-semantic-info', icon: Users },
  in_preparation: { label: 'In Preparation', color: 'bg-semantic-warning/10 text-semantic-warning', icon: Calendar },
  open: { label: 'Open', color: 'bg-semantic-success/10 text-semantic-success', icon: Eye },
  closed: { label: 'Closed', color: 'bg-bark/10 text-bark', icon: Users },
  archived: { label: 'Archived', color: 'bg-archive/10 text-archive', icon: FileText },
};

export const WORKFLOW_STEPS = [
  { key: 'proposed', label: 'Proposed' },
  { key: 'authorized', label: 'Authorized' },
  { key: 'in_preparation', label: 'In Preparation' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
];
