/**
 * Types and constants for Collection Object field components.
 */

import type { Movement } from '../../../lib/schemas';

// =============================================================================
// TYPES
// =============================================================================

export interface Title {
  title: string;
  title_type?: string | null;
  language?: string | null;
  is_preferred: boolean;
}

export interface Classification {
  term?: string | null;
  value_key?: string | null;
  is_primary?: boolean;
  classification_system?: string | null;
  vocabulary_term_id?: string | null;
}

export interface OtherNumber {
  type: string;
  value: string;
}

export interface Material {
  name: string;
  part: string | null;
  vocabulary_term_id: string | null;
}

export interface Technique {
  name: string;
  part: string | null;
  vocabulary_term_id: string | null;
}

export interface Measurement {
  dimension: string;
  value: number;
  unit: string;
  part?: string | null;
}

export interface Subject {
  term: string;
  type: string | null;
  vocabulary_term_id: string | null;
}

export interface Creator {
  name: string;
  role: string | null;
  role_qualifier: string | null;
  attribution_certainty: string | null;
  attribution_note: string | null;
  authority_id: string | null;
  ulan_id: string | null;
}

export interface OtherNumberTypeOption {
  type_id: string;
  name: string;
  code: string;
}

export interface Inscription {
  text: string;
  inscription_type: string | null;
  location_on_object: string | null;
}

// =============================================================================
// CONSTANTS
// =============================================================================

export const MOVEMENT_REASON_LABELS: Record<string, string> = {
  exhibition: 'Exhibition',
  storage: 'Storage',
  conservation: 'Conservation',
  loan: 'Loan',
  photography: 'Photography',
  research: 'Research',
  inventory: 'Inventory',
  rearrangement: 'Rearrangement',
  environmental: 'Environmental',
  security: 'Security',
  access_request: 'Access Request',
  other: 'Other',
};

export const TITLE_TYPES = [
  { value: 'preferred', label: 'Preferred' },
  { value: 'alternate', label: 'Alternate' },
  { value: 'historical', label: 'Historical' },
  { value: 'translated', label: 'Translated' },
  { value: 'descriptive', label: 'Descriptive' },
];

export const DIMENSION_TYPES = [
  { value: 'height', label: 'Height' },
  { value: 'width', label: 'Width' },
  { value: 'depth', label: 'Depth' },
  { value: 'diameter', label: 'Diameter' },
  { value: 'weight', label: 'Weight' },
  { value: 'circumference', label: 'Circumference' },
  { value: 'length', label: 'Length' },
];

export const DIMENSION_UNITS = [
  { value: 'cm', label: 'cm' },
  { value: 'mm', label: 'mm' },
  { value: 'm', label: 'm' },
  { value: 'in', label: 'in' },
  { value: 'ft', label: 'ft' },
  { value: 'kg', label: 'kg' },
  { value: 'g', label: 'g' },
  { value: 'lb', label: 'lb' },
  { value: 'oz', label: 'oz' },
];

export const SUBJECT_TYPES = [
  { value: 'topic', label: 'Topic' },
  { value: 'person', label: 'Person' },
  { value: 'place', label: 'Place' },
  { value: 'event', label: 'Event' },
  { value: 'style', label: 'Style/Period' },
  { value: 'iconography', label: 'Iconography' },
];

export const INSCRIPTION_TYPES = [
  { value: 'signature', label: 'Signature' },
  { value: 'date', label: 'Date' },
  { value: 'mark', label: 'Mark' },
  { value: 'label', label: 'Label' },
  { value: 'caption', label: 'Caption' },
  { value: 'inscription', label: 'Inscription' },
  { value: 'stamp', label: 'Stamp' },
  { value: 'watermark', label: 'Watermark' },
  { value: 'other', label: 'Other' },
];

export const CREATOR_ROLES = [
  { value: 'artist', label: 'Artist' },
  { value: 'maker', label: 'Maker' },
  { value: 'author', label: 'Author' },
  { value: 'manufacturer', label: 'Manufacturer' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'studio', label: 'Studio' },
  { value: 'designer', label: 'Designer' },
  { value: 'architect', label: 'Architect' },
  { value: 'printer', label: 'Printer' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'photographer', label: 'Photographer' },
  { value: 'attributed_to', label: 'Attributed to' },
  { value: 'circle_of', label: 'Circle of' },
  { value: 'follower_of', label: 'Follower of' },
  { value: 'school_of', label: 'School of' },
  { value: 'after', label: 'After' },
  { value: 'copy_after', label: 'Copy after' },
  { value: 'unknown', label: 'Unknown' },
];

export const ATTRIBUTION_CERTAINTY = [
  { value: 'certain', label: 'Certain' },
  { value: 'probable', label: 'Probable' },
  { value: 'possible', label: 'Possible' },
  { value: 'uncertain', label: 'Uncertain' },
  { value: 'attributed', label: 'Attributed' },
];

// Re-export Movement type for convenience
export type { Movement };
