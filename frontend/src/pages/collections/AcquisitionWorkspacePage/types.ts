import type { SectionGroup } from '../../../components/record-detail';
import {
  ClipboardList,
  DollarSign,
  Package,
  MessageSquare,
  } from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  acquisition_method: string;
  acquisition_date: string;
  source_id: string;
  source_type: string;
  authorization_date: string;
  authorization_note: string;
  funding_source: string;
  funding_account: string;
  funding_note: string;
  cost: string;
  cost_currency: string;
  appraised_value: string;
  appraised_value_currency: string;
  appraised_date: string;
  appraiser_name: string;
  legal_status: string;
  legal_note: string;
  provenance_verified: boolean;
  provenance_note: string;
  provisos: string;
  donor_restrictions: string;
  acquisition_reason: string;
  acknowledgement_date: string;
  acknowledgement_reference: string;
  transfer_of_title_number: string;
  credit_line: string;
  deed_of_gift_date: string;
  deed_of_gift_reference: string;
  board_approval_required: boolean;
  board_approval_date: string;
  board_approval_reference: string;
  board_note: string;
  objects_count: number;
  acquisition_note: string;
  internal_note: string;
  accession_number: string;
  accession_date: string;
  accessioning_approved: boolean;
  accessioning_approved_date: string;
  accessioning_resolution: string;
  accessioning_note: string;
}

// Section groups for nav
export const ACQUISITION_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: ClipboardList,
    defaultExpanded: true,
    sections: [
      { id: 'acquisition', label: 'Acquisition Info', dataKey: 'acquisition' },
      { id: 'source', label: 'Source', dataKey: 'source' },
    ],
  },
  {
    id: 'details',
    label: 'Details',
    icon: DollarSign,
    defaultExpanded: false,
    sections: [
      { id: 'financial', label: 'Financial', dataKey: 'financial' },
      { id: 'legal', label: 'Legal & Provenance', dataKey: 'legal' },
      { id: 'boardApproval', label: 'Board Approval', dataKey: 'boardApproval' },
      { id: 'documentation', label: 'Documentation', dataKey: 'documentation' },
    ],
  },
  {
    id: 'linked',
    label: 'Linked',
    icon: Package,
    defaultExpanded: false,
    sections: [
      { id: 'linkedEntry', label: 'Source Entry', dataKey: 'linkedEntry' },
      { id: 'accessioning', label: 'Accessioning', dataKey: 'accessioning' },
      { id: 'objects', label: 'Linked Objects', dataKey: 'objects' },
    ],
  },
  {
    id: 'admin',
    label: 'Collaboration',
    icon: MessageSquare,
    defaultExpanded: false,
    sections: [
      { id: 'discussion', label: 'Discussion', dataKey: 'discussion' },
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

// Section-to-group mapping
export const SECTION_GROUPS: Record<string, string> = {
  acquisition: 'overview',
  source: 'overview',
  objects: 'linked',
  financial: 'details',
  legal: 'details',
  boardApproval: 'details',
  documentation: 'details',
  linkedEntry: 'linked',
  accessioning: 'linked',
  discussion: 'admin',
  history: 'admin',
};

// Default section order within groups
export const DEFAULT_SECTION_ORDER: Record<string, string[]> = {
  overview: ['acquisition', 'source'],
  details: ['financial', 'legal', 'boardApproval', 'documentation'],
  linked: ['linkedEntry', 'accessioning', 'objects'],
  admin: ['discussion', 'history'],
};

export const GROUP_ORDER = ['overview', 'details', 'linked', 'admin'];

/** All section IDs derived from ACQUISITION_SECTION_GROUPS — single source of truth for nav. */
export const ALL_SECTION_IDS = ACQUISITION_SECTION_GROUPS.flatMap(g => g.sections.map(s => s.id));

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  linkedEntry: true,
  acquisition: true,
  source: true,
  financial: false,
  legal: false,
  boardApproval: false,
  documentation: false,
  objects: true,
  accessioning: true,
  discussion: false,
  history: false,
};
