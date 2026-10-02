import type { SectionGroup } from '../../../components/record-detail';
import {
  Truck,
  MapPin,
  FileText,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  shipment_number: string;
  shipment_type: string;
  direction: string;
  purpose: string;
  status: string;
  estimated_dispatch_date: string;
  estimated_arrival_date: string;
  actual_dispatch_date: string;
  actual_arrival_date: string;
  requested_date: string;
  insurance_value_total: string;
  insurance_currency: string;
  insurance_note: string;
  courier_required: boolean;
  is_international: boolean;
  is_high_value: boolean;
  remarks: string;
  internal_notes: string;
}

export const defaultFormData: FormData = {
  shipment_number: '',
  shipment_type: 'outbound',
  direction: '',
  purpose: '',
  status: 'draft',
  estimated_dispatch_date: '',
  estimated_arrival_date: '',
  actual_dispatch_date: '',
  actual_arrival_date: '',
  requested_date: '',
  insurance_value_total: '',
  insurance_currency: 'USD',
  insurance_note: '',
  courier_required: false,
  is_international: false,
  is_high_value: false,
  remarks: '',
  internal_notes: '',
};

export interface ShipmentDetail {
  shipment_id: string;
  organization_id: string;
  department_id: string | null;
  shipment_number: string;
  shipment_type: string;
  shipment_type_label: string;
  direction: string | null;
  direction_label: string | null;
  purpose: string | null;
  purpose_label: string | null;
  status: string;
  status_label: string;
  ship_from_contact_id: string | null;
  ship_from_contact: { contact_id: string; display_name: string | null } | null;
  ship_from_location_id: string | null;
  ship_from_location: { location_id: string; name: string | null } | null;
  ship_from_address: Record<string, string> | null;
  ship_to_contact_id: string | null;
  ship_to_contact: { contact_id: string; display_name: string | null } | null;
  ship_to_location_id: string | null;
  ship_to_location: { location_id: string; name: string | null } | null;
  ship_to_address: Record<string, string> | null;
  requested_date: string | null;
  estimated_dispatch_date: string | null;
  estimated_arrival_date: string | null;
  actual_dispatch_date: string | null;
  actual_arrival_date: string | null;
  insurance_value_total: string | null;
  insurance_currency: string | null;
  insurance_note: string | null;
  courier_required: boolean;
  is_international: boolean;
  is_high_value: boolean;
  authorized_by: string | null;
  authorization_date: string | null;
  remarks: string | null;
  internal_notes: string | null;
  legs: LegData[];
  items: ItemData[];
  references: ReferenceData[];
  documents: DocumentData[];
  status_history: StatusHistoryEntry[];
  created_at: string;
  updated_at: string;
}

export interface LegData {
  leg_id: string;
  leg_number: number;
  shipping_method: string | null;
  shipping_method_label: string | null;
  carrier_name: string | null;
  tracking_number: string | null;
  departure_location: string | null;
  departure_date: string | null;
  arrival_location: string | null;
  arrival_date: string | null;
  status: string;
  status_label: string;
}

export interface ItemData {
  shipment_item_id: string;
  object_id: string;
  object_number: string | null;
  object_title: string | null;
  crate_id: string | null;
  crate_number: string | null;
  status: string;
  status_label: string;
  packing_notes: string | null;
}

export interface ReferenceData {
  reference_id: string;
  procedure_type: string;
  procedure_type_label: string;
  procedure_id: string;
  notes: string | null;
}

export interface DocumentData {
  document_id: string;
  media_id: string;
  document_type: string | null;
  document_type_label: string | null;
  label: string | null;
}

export interface StatusHistoryEntry {
  history_id: string;
  status: string;
  status_label: string;
  notes: string | null;
  changed_at: string;
}

export const SHIPMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'outbound', label: 'Outbound' },
  { value: 'return', label: 'Return' },
  { value: 'internal_transfer', label: 'Internal Transfer' },
  { value: 'courier_delivery', label: 'Courier Delivery' },
];

export const DIRECTION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '\u2014' },
  { value: 'inbound', label: 'Inbound' },
  { value: 'outbound', label: 'Outbound' },
];

export const PURPOSE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '\u2014' },
  { value: 'loan', label: 'Loan' },
  { value: 'exhibition', label: 'Exhibition' },
  { value: 'conservation', label: 'Conservation' },
  { value: 'acquisition', label: 'Acquisition' },
  { value: 'repatriation', label: 'Repatriation' },
  { value: 'other', label: 'Other' },
];

export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-ink',
  confirmed: 'bg-semantic-info/10 text-semantic-info',
  dispatched: 'bg-bark/10 text-bark',
  in_transit: 'bg-semantic-info/10 text-semantic-info',
  delayed: 'bg-semantic-warning/10 text-semantic-warning',
  delivered: 'bg-semantic-success/10 text-semantic-success',
  completed: 'bg-semantic-success/10 text-semantic-success',
  cancelled: 'bg-semantic-error/10 text-semantic-error',
};

// Section groups for nav
export const SHIPMENT_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: Truck,
    defaultExpanded: true,
    sections: [
      { id: 'details', label: 'Shipment Details', dataKey: 'details' },
      { id: 'insurance', label: 'Insurance', dataKey: 'insurance' },
    ],
  },
  {
    id: 'route',
    label: 'Route & Cargo',
    icon: MapPin,
    defaultExpanded: false,
    sections: [
      { id: 'legs', label: 'Legs', dataKey: 'legs' },
      { id: 'items', label: 'Items', dataKey: 'items' },
    ],
  },
  {
    id: 'linked',
    label: 'Linked Records',
    icon: FileText,
    defaultExpanded: false,
    sections: [
      { id: 'references', label: 'Linked Procedures', dataKey: 'references' },
      { id: 'documents', label: 'Documents', dataKey: 'documents' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: History,
    defaultExpanded: false,
    sections: [
      { id: 'notes', label: 'Notes', dataKey: 'notes' },
      { id: 'statusHistory', label: 'Status History', dataKey: 'statusHistory' },
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

// Section-to-group mapping
export const SECTION_GROUPS: Record<string, string> = {
  details: 'overview',
  insurance: 'overview',
  legs: 'route',
  items: 'route',
  references: 'linked',
  documents: 'linked',
  notes: 'admin',
  statusHistory: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'route', 'linked', 'admin'];

export const ALL_SECTION_IDS = [
  'details', 'insurance',
  'legs', 'items',
  'references', 'documents',
  'notes', 'statusHistory', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  details: true,
  insurance: true,
  legs: false,
  items: false,
  references: false,
  documents: false,
  notes: false,
  statusHistory: false,
  history: false,
};
