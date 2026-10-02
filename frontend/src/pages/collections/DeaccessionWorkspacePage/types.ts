import type { SectionGroup } from '../../../components/record-detail';
import {
  FileText,
  Gavel,
  Scale,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type DeaccessionStatus = 'proposed' | 'under_review' | 'committee_reviewed' | 'pending_board' | 'approved' | 'in_progress' | 'completed' | 'cancelled' | 'rejected';

export interface DeaccessionFormData {
  object_id: string;
  proposal_date: string;
  reason: string;
  reason_detail: string;
  disposal_method: string;
  disposal_method_detail: string;
  recipient_name: string;
  committee_review_date: string;
  committee_recommendation: string;
  committee_note: string;
  board_approval_required: boolean;
  board_approval_date: string;
  board_approval_reference: string;
  board_note: string;
  legal_review_date: string;
  legal_review_note: string;
  provenance_review_complete: boolean;
  provenance_review_note: string;
  appraised_value: string;
  appraised_value_currency: string;
  appraised_date: string;
  appraiser_id: string;
  sale_price: string;
  sale_currency: string;
  proceeds_usage: string;
  public_notice_required: boolean;
  public_notice_date: string;
  public_notice_reference: string;
  deaccession_note: string;
}

// Section groups for nav
export const DEACCESSION_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: FileText,
    defaultExpanded: true,
    sections: [
      { id: 'linkedObject', label: 'Collection Object', dataKey: 'linkedObject' },
      { id: 'info', label: 'Deaccession Info', dataKey: 'info' },
      { id: 'disposal', label: 'Disposal Method', dataKey: 'disposal' },
    ],
  },
  {
    id: 'governance',
    label: 'Governance',
    icon: Gavel,
    defaultExpanded: false,
    sections: [
      { id: 'committee', label: 'Committee Review', dataKey: 'committee' },
      { id: 'board', label: 'Board Approval', dataKey: 'board' },
    ],
  },
  {
    id: 'details',
    label: 'Details',
    icon: Scale,
    defaultExpanded: false,
    sections: [
      { id: 'legal', label: 'Legal & Provenance', dataKey: 'legal' },
      { id: 'valuation', label: 'Valuation', dataKey: 'valuation' },
      { id: 'notice', label: 'Public Notice', dataKey: 'notice' },
      { id: 'shipments', label: 'Shipments', dataKey: 'shipments' },
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
  linkedObject: 'overview',
  info: 'overview',
  disposal: 'overview',
  committee: 'governance',
  board: 'governance',
  legal: 'details',
  valuation: 'details',
  notice: 'details',
  shipments: 'details',
  notes: 'admin',
  history: 'admin',
};

export const DEFAULT_SECTION_ORDER: Record<string, string[]> = {
  overview: ['linkedObject', 'info', 'disposal'],
  governance: ['committee', 'board'],
  details: ['legal', 'valuation', 'notice', 'shipments'],
  admin: ['notes', 'history'],
};

export const GROUP_ORDER = ['overview', 'governance', 'details', 'admin'];

export const ALL_SECTION_IDS = [
  'linkedObject', 'info', 'disposal',
  'committee', 'board',
  'legal', 'valuation', 'notice', 'shipments',
  'notes', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  linkedObject: true,
  info: true,
  disposal: true,
  committee: false,
  board: false,
  legal: false,
  valuation: false,
  notice: false,
  shipments: false,
  notes: false,
  history: false,
};
