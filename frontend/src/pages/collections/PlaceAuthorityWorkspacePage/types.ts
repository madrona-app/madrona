import type { SectionGroup } from '../../../components/record-detail';
import {
  MapPin,
  Globe,
  History,
  } from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  preferred_name: string;
  variant_names: string[];
  place_type: string;
  tgn_id: string;
  geonames_id: string;
  wikidata_id: string;
  coordinates_lat: number | null;
  coordinates_lng: number | null;
  parent_place_id: string | null;
  hierarchy_path: string;
  country_code: string;
  notes: string;
  status: string;
}

export const defaultFormData: FormData = {
  preferred_name: '',
  variant_names: [],
  place_type: 'place',
  tgn_id: '',
  geonames_id: '',
  wikidata_id: '',
  coordinates_lat: null,
  coordinates_lng: null,
  parent_place_id: null,
  hierarchy_path: '',
  country_code: '',
  notes: '',
  status: 'active',
};

export const PLACE_TYPE_OPTIONS = [
  { value: 'city', label: 'City' },
  { value: 'region', label: 'Region' },
  { value: 'country', label: 'Country' },
  { value: 'site', label: 'Site' },
  { value: 'building', label: 'Building' },
  { value: 'district', label: 'District' },
  { value: 'state', label: 'State' },
  { value: 'province', label: 'Province' },
  { value: 'continent', label: 'Continent' },
  { value: 'body_of_water', label: 'Body of Water' },
  { value: 'place', label: 'Place (General)' },
];

export const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'deprecated', label: 'Deprecated' },
];

// Section groups for nav
export const PLACE_AUTHORITY_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: MapPin,
    defaultExpanded: true,
    sections: [
      { id: 'identity', label: 'Identity', dataKey: 'identity' },
      { id: 'location', label: 'Geographic Coordinates', dataKey: 'location' },
    ],
  },
  {
    id: 'details',
    label: 'Details',
    icon: Globe,
    defaultExpanded: false,
    sections: [
      { id: 'area', label: 'Geographic Area', dataKey: 'area' },
      { id: 'external', label: 'External Identifiers', dataKey: 'external' },
      { id: 'status', label: 'Status', dataKey: 'status' },
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
  identity: 'overview',
  location: 'overview',
  area: 'details',
  external: 'details',
  status: 'details',
  notes: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'details', 'admin'];

export const ALL_SECTION_IDS = [
  'identity', 'location',
  'area', 'external', 'status',
  'notes', 'history',
];

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  identity: true,
  location: true,
  area: false,
  external: false,
  status: false,
  notes: false,
  history: false,
};
