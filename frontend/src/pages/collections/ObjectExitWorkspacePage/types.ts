import type { SectionGroup } from '../../../components/record-detail';
import {
  Calendar,
  Truck,
  CheckCircle,
  ExternalLink,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  exit_date: string;
  exit_reason: string;
  exit_method: string;
  recipient_name: string;
  packing_method: string;
  shipping_method: string;
  shipping_company: string;
  tracking_number: string;
  courier_id: string;
  condition_at_exit: string;
  authorization_date: string;
  authorization_note: string;
  receipt_reference: string;
  receipt_note: string;
  exit_note: string;
  internal_note: string;
}

// Section groups for nav
export const EXIT_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: Calendar,
    defaultExpanded: true,
    sections: [
      { id: 'exit', label: 'Exit Info', dataKey: 'exit' },
      { id: 'recipient', label: 'Recipient', dataKey: 'recipient' },
    ],
  },
  {
    id: 'details',
    label: 'Details',
    icon: Truck,
    defaultExpanded: false,
    sections: [
      { id: 'condition', label: 'Condition', dataKey: 'condition' },
      { id: 'authorization', label: 'Authorization', dataKey: 'authorization' },
      { id: 'shipments', label: 'Shipments', dataKey: 'shipments' },
    ],
  },
  {
    id: 'outcome',
    label: 'Outcome',
    icon: CheckCircle,
    defaultExpanded: false,
    sections: [
      { id: 'receipt', label: 'Receipt', dataKey: 'receipt' },
      { id: 'notes', label: 'Notes', dataKey: 'notes' },
    ],
  },
  {
    id: 'linked',
    label: 'Linked',
    icon: ExternalLink,
    defaultExpanded: false,
    sections: [
      { id: 'entry', label: 'Source Entry', dataKey: 'entry' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: History,
    defaultExpanded: false,
    sections: [
      { id: 'discussion', label: 'Discussion', dataKey: 'discussion' },
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

// Section-to-group mapping
export const SECTION_GROUPS: Record<string, string> = {
  exit: 'overview',
  recipient: 'overview',
  condition: 'details',
  authorization: 'details',
  shipments: 'details',
  receipt: 'outcome',
  notes: 'outcome',
  entry: 'linked',
  discussion: 'admin',
  history: 'admin',
};

export const DEFAULT_SECTION_ORDER: Record<string, string[]> = {
  overview: ['exit', 'recipient'],
  details: ['condition', 'authorization', 'shipments'],
  outcome: ['receipt', 'notes'],
  linked: ['entry'],
  admin: ['discussion', 'history'],
};

export const GROUP_ORDER = ['overview', 'details', 'outcome', 'linked', 'admin'];

export const ALL_SECTION_IDS = [
  'exit', 'recipient',
  'condition', 'authorization', 'shipments',
  'receipt', 'notes',
  'entry',
  'discussion', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  exit: true,
  recipient: true,
  condition: false,
  authorization: false,
  shipments: false,
  receipt: true,
  notes: false,
  entry: true,
  discussion: false,
  history: false,
};
