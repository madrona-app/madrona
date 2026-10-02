import type { SectionGroup } from '../../../components/record-detail';
import {
  Box,
  Ruler,
  MapPin,
  History,
} from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  crate_number: string;
  description: string;
  // Exterior dimensions
  height_cm: string;
  width_cm: string;
  depth_cm: string;
  weight_empty_kg: string;
  // Interior dimensions
  interior_height_cm: string;
  interior_width_cm: string;
  interior_depth_cm: string;
  // Construction & condition
  materials: string;
  condition: string;
  // Features
  climate_controlled: boolean;
  is_stackable: boolean;
  is_oversized: boolean;
  // Location tracking
  location_id: string | null;
  home_location_id: string | null;
  // Status
  is_active: boolean;
  notes: string;
}

export const defaultFormData: FormData = {
  crate_number: '',
  description: '',
  height_cm: '',
  width_cm: '',
  depth_cm: '',
  weight_empty_kg: '',
  interior_height_cm: '',
  interior_width_cm: '',
  interior_depth_cm: '',
  materials: '',
  condition: '',
  climate_controlled: false,
  is_stackable: true,
  is_oversized: false,
  location_id: null,
  home_location_id: null,
  is_active: true,
  notes: '',
};

// Condition options
export const CONDITION_OPTIONS = [
  { value: '', label: '-- Select --' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'damaged', label: 'Damaged' },
];

// Section groups for nav
export const CRATE_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: Box,
    defaultExpanded: true,
    sections: [
      { id: 'identification', label: 'Identification', dataKey: 'identification' },
      { id: 'condition', label: 'Condition & Features', dataKey: 'condition' },
    ],
  },
  {
    id: 'physical',
    label: 'Physical',
    icon: Ruler,
    defaultExpanded: false,
    sections: [
      { id: 'exterior', label: 'Exterior Dimensions', dataKey: 'exterior' },
      { id: 'interior', label: 'Interior Dimensions', dataKey: 'interior' },
    ],
  },
  {
    id: 'location',
    label: 'Location',
    icon: MapPin,
    defaultExpanded: false,
    sections: [
      { id: 'locations', label: 'Location Tracking', dataKey: 'locations' },
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
  identification: 'overview',
  condition: 'overview',
  exterior: 'physical',
  interior: 'physical',
  locations: 'location',
  notes: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'physical', 'location', 'admin'];

export const ALL_SECTION_IDS = [
  'identification', 'condition',
  'exterior', 'interior',
  'locations',
  'notes', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  identification: true,
  condition: true,
  exterior: false,
  interior: false,
  locations: false,
  notes: false,
  history: false,
};
