import type { Constituent } from '../../../lib/api/constituents';
import type { SectionGroup } from '../../../components/record-detail';
import { User, Mail, Globe, Shield } from 'lucide-react';

// ---------------------------------------------------------------------------
// Form data shape (flat record for easy field-level updates)
// ---------------------------------------------------------------------------

export interface ConstituentFormData {
  // Identity
  constituent_type: string;
  name: string;
  display_name: string;
  sort_name: string;
  given_name: string;
  family_name: string;
  name_prefix: string;
  name_suffix: string;
  variant_names: string[];
  nationality: string;
  culture: string;
  gender: string;
  life_roles: string[];

  // Contact Details
  email: string;
  phone: string;
  phone_secondary: string;
  title: string;
  role: string;
  organization_name: string;
  department: string;
  website: string;
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;

  // Biography
  birth_date_display: string;
  birth_place: string;
  birth_place_tgn_id: string;
  death_date_display: string;
  death_place: string;
  death_place_tgn_id: string;
  active_date_display: string;
  biography: string;
  biography_source: string;

  // External IDs
  ulan_id: string;
  viaf_id: string;
  wikidata_id: string;
  loc_id: string;
  // Authority display names (not persisted — for UI display only)
  ulan_label: string;
  viaf_label: string;
  wikidata_label: string;
  loc_label: string;

  // Admin
  status: string;
  is_active: boolean;
  is_verified: boolean;
  notes: string;
  internal_notes: string;
  cataloger_notes: string;
}

export const EMPTY_FORM: ConstituentFormData = {
  constituent_type: 'person',
  name: '',
  display_name: '',
  sort_name: '',
  given_name: '',
  family_name: '',
  name_prefix: '',
  name_suffix: '',
  variant_names: [],
  nationality: '',
  culture: '',
  gender: '',
  life_roles: [],

  email: '',
  phone: '',
  phone_secondary: '',
  title: '',
  role: '',
  organization_name: '',
  department: '',
  website: '',
  street: '',
  city: '',
  state: '',
  postal_code: '',
  country: '',

  birth_date_display: '',
  birth_place: '',
  birth_place_tgn_id: '',
  death_date_display: '',
  death_place: '',
  death_place_tgn_id: '',
  active_date_display: '',
  biography: '',
  biography_source: '',

  ulan_id: '',
  viaf_id: '',
  wikidata_id: '',
  loc_id: '',
  ulan_label: '',
  viaf_label: '',
  wikidata_label: '',
  loc_label: '',

  status: 'active',
  is_active: true,
  is_verified: false,
  notes: '',
  internal_notes: '',
  cataloger_notes: '',
};

// ---------------------------------------------------------------------------
// Common section props
// ---------------------------------------------------------------------------

export interface BaseSectionProps {
  orgId: string;
  constituentId?: string;
  isEditing: boolean;
  isCreateMode: boolean;
  formData: ConstituentFormData;
  updateField: (field: keyof ConstituentFormData, value: any) => void;
  handleFieldBlur: () => void;
  expandedSections: Record<string, boolean>;
  toggleSection: (sectionId: string) => void;
  sectionRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  getSectionOrder: (sectionId: string) => number;
  isEmpty?: boolean;
  sectionSummaries?: Record<string, string | undefined>;
  isRestricted: (field: string) => boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONSTITUENT_TYPE_OPTIONS = [
  { value: 'person', label: 'Person' },
  { value: 'organization', label: 'Organization' },
  { value: 'corporate_body', label: 'Corporate Body' },
  { value: 'family', label: 'Family' },
  { value: 'department', label: 'Department' },
  { value: 'estate', label: 'Estate' },
  { value: 'dealer', label: 'Dealer' },
  { value: 'auction_house', label: 'Auction House' },
  { value: 'unknown', label: 'Unknown' },
];

export const CONSTITUENT_TYPE_ICONS: Record<string, typeof User> = {
  person: User,
  organization: User,
  corporate_body: User,
  family: User,
  department: User,
  estate: User,
  dealer: User,
  auction_house: User,
  unknown: User,
};

export const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'deprecated', label: 'Deprecated' },
  { value: 'merged', label: 'Merged' },
  { value: 'deleted', label: 'Deleted' },
];

// ---------------------------------------------------------------------------
// Section group mapping for ordering
// ---------------------------------------------------------------------------

export const SECTION_GROUPS: Record<string, string> = {
  media: 'overview',
  identity: 'overview',
  contact: 'details',
  biography: 'details',
  external: 'authority',
  admin: 'admin',
  discussion: 'admin',
  history: 'admin',
};

export const GROUP_ORDER = ['overview', 'details', 'authority', 'admin'];

export const DEFAULT_SECTION_ORDER: Record<string, number> = {
  media: 0, identity: 1,
  contact: 0, biography: 1,
  external: 0,
  admin: 0, discussion: 1, history: 2,
};

export const INITIAL_EXPANDED_SECTIONS: Record<string, boolean> = {
  media: true,
  identity: true,
  contact: false,
  biography: false,
  external: false,
  admin: false,
  discussion: false,
  history: false,
};

// ---------------------------------------------------------------------------
// Page section groups for RecordDetailPageWrapper nav
// ---------------------------------------------------------------------------

export const PAGE_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: User,
    defaultExpanded: true,
    sections: [
      { id: 'media', label: 'Media', dataKey: 'media' },
      { id: 'identity', label: 'Identity', dataKey: 'identity' },
    ],
  },
  {
    id: 'details',
    label: 'Details',
    icon: Mail,
    defaultExpanded: true,
    sections: [
      { id: 'contact', label: 'Contact Details', dataKey: 'contact' },
      { id: 'biography', label: 'Biography', dataKey: 'biography' },
    ],
  },
  {
    id: 'authority',
    label: 'Authority Links',
    icon: Globe,
    defaultExpanded: false,
    sections: [
      { id: 'external', label: 'External IDs', dataKey: 'external' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: Shield,
    defaultExpanded: false,
    sections: [
      { id: 'admin', label: 'Record Status', dataKey: 'admin' },
      { id: 'discussion', label: 'Discussion', dataKey: 'discussion' },
      { id: 'history', label: 'Change History', dataKey: 'history' },
    ],
  },
];

/** All section IDs derived from PAGE_SECTION_GROUPS — single source of truth for nav. */
export const ALL_SECTION_IDS = PAGE_SECTION_GROUPS.flatMap(g => g.sections.map(s => s.id));

/** Sections hidden in create mode (no record to reference yet). */
export const CREATE_MODE_EXCLUDE = ['discussion', 'history'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert the flat form record into an API-shaped payload. */
export function buildPayload(fd: ConstituentFormData): Partial<Constituent> {
  return {
    constituent_type: fd.constituent_type,
    name: fd.name,
    display_name: fd.display_name || null,
    sort_name: fd.sort_name || null,
    given_name: fd.given_name || null,
    family_name: fd.family_name || null,
    name_prefix: fd.name_prefix || null,
    name_suffix: fd.name_suffix || null,
    variant_names: fd.variant_names.length ? fd.variant_names : null,
    nationality: fd.nationality || null,
    culture: fd.culture || null,
    gender: fd.gender || null,
    life_roles: fd.life_roles.length ? fd.life_roles : null,

    email: fd.email || null,
    phone: fd.phone || null,
    phone_secondary: fd.phone_secondary || null,
    title: fd.title || null,
    role: fd.role || null,
    organization_name: fd.organization_name || null,
    department: fd.department || null,
    website: fd.website || null,
    address: {
      street: fd.street || null,
      city: fd.city || null,
      state: fd.state || null,
      postal_code: fd.postal_code || null,
      country: fd.country || null,
    },

    birth_date_display: fd.birth_date_display || null,
    birth_place: fd.birth_place || null,
    birth_place_tgn_id: fd.birth_place_tgn_id || null,
    death_date_display: fd.death_date_display || null,
    death_place: fd.death_place || null,
    death_place_tgn_id: fd.death_place_tgn_id || null,
    active_date_display: fd.active_date_display || null,
    biography: fd.biography || null,
    biography_source: fd.biography_source || null,

    ulan_id: fd.ulan_id || null,
    viaf_id: fd.viaf_id || null,
    wikidata_id: fd.wikidata_id || null,
    loc_id: fd.loc_id || null,

    status: fd.status as any,
    is_active: fd.is_active,
    is_verified: fd.is_verified,
    notes: fd.notes || null,
    internal_notes: fd.internal_notes || null,
    cataloger_notes: fd.cataloger_notes || null,
  } as Partial<Constituent>;
}

/** Hydrate flat form data from an existing API record. */
export function hydrateForm(c: Constituent): ConstituentFormData {
  return {
    constituent_type: c.constituent_type || 'person',
    name: c.name || '',
    display_name: c.display_name || '',
    sort_name: c.sort_name || '',
    given_name: c.given_name || '',
    family_name: c.family_name || '',
    name_prefix: c.name_prefix || '',
    name_suffix: c.name_suffix || '',
    variant_names: c.variant_names || [],
    nationality: c.nationality || '',
    culture: c.culture || '',
    gender: c.gender || '',
    life_roles: c.life_roles || [],

    email: c.email || '',
    phone: c.phone || '',
    phone_secondary: c.phone_secondary || '',
    title: c.title || '',
    role: c.role || '',
    organization_name: c.organization_name || '',
    department: c.department || '',
    website: c.website || '',
    street: c.address?.street || '',
    city: c.address?.city || '',
    state: c.address?.state || '',
    postal_code: c.address?.postal_code || '',
    country: c.address?.country || '',

    birth_date_display: c.birth_date_display || '',
    birth_place: c.birth_place || '',
    birth_place_tgn_id: c.birth_place_tgn_id || '',
    death_date_display: c.death_date_display || '',
    death_place: c.death_place || '',
    death_place_tgn_id: c.death_place_tgn_id || '',
    active_date_display: c.active_date_display || '',
    biography: c.biography || '',
    biography_source: c.biography_source || '',

    ulan_id: c.ulan_id || '',
    viaf_id: c.viaf_id || '',
    wikidata_id: c.wikidata_id || '',
    loc_id: c.loc_id || '',
    ulan_label: '',
    viaf_label: '',
    wikidata_label: '',
    loc_label: '',

    status: c.status || 'active',
    is_active: c.is_active ?? true,
    is_verified: c.is_verified ?? false,
    notes: c.notes || '',
    internal_notes: c.internal_notes || '',
    cataloger_notes: c.cataloger_notes || '',
  };
}
