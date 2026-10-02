import type { SectionGroup } from '../../../components/record-detail';
import { Settings, Printer } from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface BarcodeLabel {
  label_id: string;
  organization_id: string;
  entity_type: string;
  entity_type_label: string;
  entity_id: string;
  barcode_value: string;
  label_format: string;
  label_format_label: string;
  is_printed: boolean;
  print_count: number;
  last_printed_at: string | null;
  batch_id: string | null;
  status: string;
  status_label: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  entity_summary?: Record<string, string | null>;
  public_url?: string | null;
}

export interface EnumsResponse {
  entity_types: { value: string; label: string }[];
  label_formats: { value: string; label: string }[];
}

export interface EntitySearchResult {
  object_id?: string;
  location_id?: string;
  part_id?: string;
  crate_id?: string;
  object_number?: string;
  name?: string;
  title?: string;
  titles?: { title: string }[];
}

export interface FormData {
  entity_type: string;
  entity_id: string;
  barcode_value: string;
  auto_generate: boolean;
  label_format: string;
  note: string;
}

export const defaultFormData: FormData = {
  entity_type: 'collection_object',
  entity_id: '',
  barcode_value: '',
  auto_generate: true,
  label_format: 'code128',
  note: '',
};

// bwip-js barcode type IDs
export const BWIP_BCID: Record<string, string> = {
  code128: 'code128',
  qr: 'qrcode',
  datamatrix: 'datamatrix',
  ean13: 'ean13',
  code39: 'code39',
};

// Standard archival label sizes (inches -> mm for print CSS)
export const LABEL_SIZES = [
  { value: '1x3', label: '1\u2033 \u00d7 3\u2033 (Storage)', widthMm: 76.2, heightMm: 25.4 },
  { value: '2x2', label: '2\u2033 \u00d7 2\u2033 (Gallery QR)', widthMm: 50.8, heightMm: 50.8 },
  { value: '1.5x4', label: '1.5\u2033 \u00d7 4\u2033 (Shelf)', widthMm: 101.6, heightMm: 38.1 },
  { value: '2x4', label: '2\u2033 \u00d7 4\u2033 (Shipping)', widthMm: 101.6, heightMm: 50.8 },
  { value: '3x5', label: '3\u2033 \u00d7 5\u2033 (Gallery Card)', widthMm: 127, heightMm: 76.2 },
] as const;

export const ENTITY_SEARCH_ENDPOINTS: Record<string, string> = {
  collection_object: 'objects',
  location: 'locations',
};

// Section groups for nav
export const BARCODE_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'setup',
    label: 'Label Setup',
    icon: Settings,
    defaultExpanded: true,
    sections: [
      { id: 'entity', label: 'Entity Selection', dataKey: 'entity' },
      { id: 'format', label: 'Barcode Format', dataKey: 'format' },
    ],
  },
  {
    id: 'output',
    label: 'Label Output',
    icon: Printer,
    defaultExpanded: false,
    sections: [
      { id: 'label', label: 'Label Details', dataKey: 'label' },
      { id: 'actions', label: 'Actions', dataKey: 'actions' },
    ],
  },
];

// Section-to-group mapping
export const SECTION_GROUPS: Record<string, string> = {
  entity: 'setup',
  format: 'setup',
  label: 'output',
  actions: 'output',
};

export const GROUP_ORDER = ['setup', 'output'];

export const ALL_SECTION_IDS = ['entity', 'format', 'label', 'actions'];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  entity: true,
  format: true,
  label: true,
  actions: true,
};
