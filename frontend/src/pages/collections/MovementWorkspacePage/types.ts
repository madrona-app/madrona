import type { SectionGroup } from '../../../components/record-detail';
import {
  ClipboardList,
  ShieldCheck,
  Truck,
  FileCheck,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface MovementFormData {
  // Core
  object_id: string;
  reason: string;
  from_location_id: string;
  to_location_id: string;
  movement_date: string;
  status: string;
  movement_note: string;
  handler_id: string;
  handler_name: string;

  // Authorization
  authorizer_id: string;
  authorization_date: string;
  authorization_note: string;

  // Shipping & Courier
  movement_method: string;
  organization_courier: boolean;
  courier_name: string;
  shipper_id: string;
  shipper_name: string;
  shipping_method: string;
  shipping_tracking_number: string;
  shipping_insurance_value: string;
  shipping_insurance_currency: string;
  shipping_note: string;

  // Condition
  condition_note: string;
  condition_report_id: string;

  // Planning
  location_fitness: string;
  planned_removal_date: string;
  planned_return_date: string;
}

// Section groups for nav
export const MOVEMENT_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: ClipboardList,
    defaultExpanded: true,
    sections: [
      { id: 'object', label: 'Object', dataKey: 'object' },
      { id: 'movement', label: 'Movement Details', dataKey: 'movement' },
    ],
  },
  {
    id: 'authorization',
    label: 'Authorization',
    icon: ShieldCheck,
    defaultExpanded: false,
    sections: [
      { id: 'authorization', label: 'Authorization', dataKey: 'authorization' },
    ],
  },
  {
    id: 'transport',
    label: 'Transport',
    icon: Truck,
    defaultExpanded: false,
    sections: [
      { id: 'handler', label: 'Handler & Notes', dataKey: 'handler' },
      { id: 'shipping', label: 'Shipping & Courier', dataKey: 'shipping' },
    ],
  },
  {
    id: 'condition',
    label: 'Condition & Planning',
    icon: FileCheck,
    defaultExpanded: false,
    sections: [
      { id: 'condition', label: 'Condition', dataKey: 'condition' },
      { id: 'planning', label: 'Planning', dataKey: 'planning' },
    ],
  },
  {
    id: 'admin',
    label: 'History',
    icon: History,
    defaultExpanded: false,
    sections: [
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

// Section-to-group mapping
export const SECTION_GROUPS: Record<string, string> = {
  object: 'overview',
  movement: 'overview',
  authorization: 'authorization',
  handler: 'transport',
  shipping: 'transport',
  condition: 'condition',
  planning: 'condition',
  history: 'admin',
};

// Default section order within groups
export const DEFAULT_SECTION_ORDER: Record<string, string[]> = {
  overview: ['object', 'movement'],
  authorization: ['authorization'],
  transport: ['handler', 'shipping'],
  condition: ['condition', 'planning'],
  admin: ['history'],
};

// Group order for getSectionOrder calculation
export const GROUP_ORDER = ['overview', 'authorization', 'transport', 'condition', 'admin'];

// All section IDs for nav
export const ALL_SECTION_IDS = ['object', 'movement', 'authorization', 'handler', 'shipping', 'condition', 'planning', 'history'];

// Expanded sections initial state
export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  object: true,
  movement: true,
  authorization: true,
  handler: true,
  shipping: false,
  condition: false,
  planning: false,
  history: false,
};
