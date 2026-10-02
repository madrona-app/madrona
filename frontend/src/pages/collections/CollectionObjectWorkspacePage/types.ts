import type { CollectionObject } from '../../../lib/schemas';
import type {
  Title,
  Classification,
  OtherNumber,
  Measurement,
} from '../../../components/collections/ObjectFieldComponents';
import type { SectionGroup } from '../../../components/record-detail';
import { ClipboardList, Palette, Users, HeartPulse, Settings } from 'lucide-react';

// FormData interface for local state
export interface FormData {
  object_number: string;
  titles: Title[];
  object_name: string;
  object_type: string;
  classifications: Classification[];
  object_status: string;
  other_numbers: OtherNumber[];
  number_of_objects: number;
  department_id: string | null;
  // Description
  brief_description: string;
  full_description: string;
  comments: string;
  distinguishing_features: string;
  content_description: string;
  // Production
  creation_date_display: string;
  creation_date_earliest: string;
  creation_date_latest: string;
  creation_place: string;
  production_reason: string;
  production_note: string;
  // Physical
  physical_description: string;
  color: string;
  form: string;
  // Materials and techniques are now managed via link tables (MaterialLinker/TechniqueLinker)
  measurements: Measurement[];
  inscriptions: string[];
  edition: string;
  copy_number: string;
  edition_note: string;
  state_number: number | null;
  total_states: number | null;
  state_description: string;
  catalog_level: string;
  age: string;
  age_qualifier: string;
  age_unit: string;
  orientation: string;
  facture_description: string;
  arrangement: string;
  installation_instructions: string;
  // Physical — JSONB arrays
  watermarks: Record<string, any>[];
  technical_attributes: Record<string, any>[];
  // Subject — string lists (no authority backing)
  depicted_activities: string[];
  depicted_concepts: string[];
  associated_concepts: string[];
  // Condition
  condition_note: string;
  completeness: string;
  completeness_note: string;
  conservation_priority: string;
  next_condition_check_date: string;
  handling_requirements: string;
  salvage_priority: string;
  hazards: Record<string, any>[];
  environmental_requirements: Record<string, any> | null;
  // Location
  current_location_id: string | null;
  current_location_fitness: string;
  current_location_note: string;
  home_location_id: string | null;
  is_discoverable: boolean;
  // Acquisition & History
  acquisition_method: string;
  acquisition_date: string;
  acquisition_source: string;
  provenance: string;
  credit_line: string;
  object_history_note: string;
  usage: string;
  usage_note: string;
  associated_cultural_affinity: string;
  association_note: string;
  // History — JSONB arrays
  provenance_structured: Record<string, any>[];
  exhibition_history: Record<string, any>[];
  publication_history: Record<string, any>[];
  // Archaeological context
  excavation_site: string;
  excavation_date: string;
  field_collection_number: string;
}

// Quick action callbacks passed to sections
export interface QuickActionCallbacks {
  onCreateTask: () => void;
  onDelete: () => void;
  onMovementClick: () => void;
  onConditionReportClick: () => void;
  onIncidentClick: () => void;
  onConservationClick: () => void;
  onValuationClick: () => void;
  onLoanRequestClick: () => void;
  onUseRequestClick: () => void;
}

// Common section props
export interface BaseSectionProps {
  orgId: string;
  objectId?: string;
  isEditing: boolean;
  isCreateMode: boolean;
  formData: FormData | null;
  object: CollectionObject | null;
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  updateFieldSilent: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  handleFieldBlur: () => void;
  expandedSections: Record<string, boolean>;
  toggleSection: (sectionId: string) => void;
  sectionRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  getSectionOrder: (sectionId: string) => number;
  /** Whether the section has no data (renders compact when collapsed) */
  isEmpty?: boolean;
  /** Per-section summary hints keyed by section ID */
  sectionSummaries?: Record<string, string | undefined>;
  isRestricted: (field: string) => boolean;
}

// Constants
export const OBJECT_TYPES = [
  { value: 'painting', label: 'Painting' },
  { value: 'sculpture', label: 'Sculpture' },
  { value: 'photograph', label: 'Photograph' },
  { value: 'print', label: 'Print' },
  { value: 'drawing', label: 'Drawing' },
  { value: 'textile', label: 'Textile' },
  { value: 'ceramic', label: 'Ceramic' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'metalwork', label: 'Metalwork' },
  { value: 'glass', label: 'Glass' },
  { value: 'other', label: 'Other' },
];

/**
 * Classification terms where NAGPRA section is shown by default.
 * Matched against the object's classifications[].term values.
 * NAGPRA also shows on any object that already has a NAGPRA action,
 * regardless of classification.
 */
export const NAGPRA_RELEVANT_CLASSIFICATIONS = new Set([
  'ethnographic',
  'natural_history',
  'ceramic',
  'textile',
  'weapon',
  'vessel',
  'tool',
  'costume',
]);

export const OBJECT_STATUSES = [
  { value: 'accessioned', label: 'Accessioned' },
  { value: 'active', label: 'Active' },
  { value: 'on_loan', label: 'On Loan' },
  { value: 'in_conservation', label: 'In Conservation' },
  { value: 'pending', label: 'Pending' },
  { value: 'deaccessioned', label: 'Deaccessioned' },
  { value: 'missing', label: 'Missing' },
];

// Section group mapping for ordering
export const SECTION_GROUPS: Record<string, string> = {
  media: 'overview',
  identification: 'overview',
  description: 'object-details',
  physical: 'object-details',
  stylePeriods: 'object-details',
  subjects: 'object-details',
  people: 'relationships',
  places: 'relationships',
  relationships: 'relationships',
  citations: 'relationships',
  events: 'relationships',
  condition: 'care',
  location: 'care',
  rights: 'care',
  nagpra: 'care',
  acquisition: 'operations',
  valuations: 'operations',
  procedures: 'operations',
  parts: 'operations',
  history: 'operations',
};

export const GROUP_ORDER = ['overview', 'object-details', 'relationships', 'care', 'operations'];

// Default section order within groups
export const DEFAULT_SECTION_ORDER: Record<string, number> = {
  media: 0, identification: 1,
  description: 0, physical: 1, stylePeriods: 2, subjects: 3,
  people: 0, places: 1, relationships: 2, citations: 3, events: 4,
  condition: 0, location: 1, rights: 2, nagpra: 3,
  acquisition: 0, valuations: 1, procedures: 2, parts: 3, history: 4,
};

// Initial expanded state for all sections
export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  media: false,
  identification: false,
  description: false,
  physical: false,
  condition: false,
  acquisition: false,
  people: false,
  places: false,
  stylePeriods: false,
  subjects: false,
  relationships: false,
  citations: false,
  events: false,
  rights: false,
  nagpra: false,
  parts: false,
  location: false,
  valuations: false,
  procedures: false,
  history: false,
};

// Page section groups for RecordDetailPageWrapper nav
export const PAGE_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: ClipboardList,
    defaultExpanded: true,
    sections: [
      { id: 'media', label: 'Media', dataKey: 'media' },
      { id: 'identification', label: 'Identification', dataKey: 'identification' },
    ],
  },
  {
    id: 'object-details',
    label: 'Object Details',
    icon: Palette,
    defaultExpanded: true,
    sections: [
      { id: 'description', label: 'Description', dataKey: 'description' },
      { id: 'physical', label: 'Physical Description', dataKey: 'physical_description' },
      { id: 'stylePeriods', label: 'Styles & Periods', dataKey: 'styles_periods' },
      { id: 'subjects', label: 'Subjects', dataKey: 'subjects' },
    ],
  },
  {
    id: 'relationships',
    label: 'Relationships',
    icon: Users,
    defaultExpanded: false,
    sections: [
      { id: 'people', label: 'People', dataKey: 'people' },
      { id: 'places', label: 'Places', dataKey: 'places' },
      { id: 'relationships', label: 'Related Objects', dataKey: 'related_objects' },
      { id: 'citations', label: 'Citations', dataKey: 'citations' },
      { id: 'events', label: 'Events', dataKey: 'events' },
    ],
  },
  {
    id: 'care',
    label: 'Care',
    icon: HeartPulse,
    defaultExpanded: false,
    sections: [
      { id: 'condition', label: 'Condition', dataKey: 'condition' },
      {
        id: 'location',
        label: 'Location',
        dataKey: 'location',
        isRequired: true,
        requiredFields: ['current_location_id'],
      },
      { id: 'rights', label: 'Rights', dataKey: 'rights' },
      { id: 'nagpra', label: 'NAGPRA', dataKey: 'nagpra' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: Settings,
    defaultExpanded: false,
    sections: [
      { id: 'acquisition', label: 'Acquisition', dataKey: 'acquisition' },
      { id: 'valuations', label: 'Valuations', dataKey: 'valuations' },
      { id: 'procedures', label: 'Procedures', dataKey: 'procedures' },
      { id: 'parts', label: 'Parts', dataKey: 'parts' },
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

/** All section IDs derived from PAGE_SECTION_GROUPS — single source of truth for nav. */
export const ALL_SECTION_IDS = PAGE_SECTION_GROUPS.flatMap(g => g.sections.map(s => s.id));

/** Sections hidden in create mode (no record to reference yet). */
export const CREATE_MODE_EXCLUDE = ['events', 'location', 'valuations', 'procedures', 'parts', 'history'];
