/**
 * Authority-Aware Autocomplete Types
 *
 * Data contracts between frontend and backend for the autocomplete component.
 * Note: "Authority" terminology is internal only - never shown to users.
 */

// ============================================================================
// COMPONENT PROPS
// ============================================================================

export type FieldType =
  | 'creator'      // People: artists, makers, architects
  | 'material'     // Materials: oil paint, bronze, canvas
  | 'technique'    // Techniques: impasto, etching, casting
  | 'place'        // Places: Paris, France; New York, NY
  | 'subject'      // Subjects: landscapes, portraits, still life
  | 'classification' // Object types: painting, sculpture, print
  | 'organization'; // Organizations: museums, galleries, workshops

export interface AuthorityAutocompleteProps {
  /** Field type determines which reference sources to search */
  fieldType: FieldType;

  /** Current value (for controlled component) */
  value: AuthorityBackedValue | null;

  /** Callback when value changes */
  onChange: (value: AuthorityBackedValue | null) => void;

  /** Placeholder text */
  placeholder?: string;

  /** Whether the field is disabled */
  disabled?: boolean;

  /** Whether the field is required */
  required?: boolean;

  /** Additional field-specific context (e.g., role for creators) */
  context?: Record<string, string>;

  /** Whether to show the "verified" indicator for linked values */
  showVerifiedBadge?: boolean;

  /** Maximum suggestions to show */
  maxSuggestions?: number;

  /** Debounce delay for external search (ms) */
  debounceMs?: number;

  /** Whether to allow creating new values not in suggestions */
  allowCreate?: boolean;

  /** Custom class name */
  className?: string;

  /** Aria label for accessibility */
  ariaLabel?: string;

  /** ID for form association */
  id?: string;

  /** Name for form association */
  name?: string;
}

// ============================================================================
// VALUE TYPES (matches backend schema)
// ============================================================================

/**
 * A reference link to an external source.
 * Internal name: "AuthorityLink" - but users see "reference" or nothing.
 */
export interface ReferenceLink {
  /** Full URI to the reference record */
  uri: string;

  /** Source identifier (internal use - displayed as friendly name) */
  source: ReferenceSource;

  /** Optional label from the source (for verification) */
  label?: string;

  /** Confidence level */
  matchConfidence?: 'exact' | 'probable' | 'suggested';
}

/**
 * Supported reference sources.
 * These map to well-known databases used in cultural heritage.
 */
export type ReferenceSource =
  | 'VIAF'           // Virtual International Authority File
  | 'ULAN'           // Getty Union List of Artist Names
  | 'AAT'            // Getty Art & Architecture Thesaurus
  | 'TGN'            // Getty Thesaurus of Geographic Names
  | 'Nomenclature'   // AASLH Nomenclature for Museum Cataloging
  | 'Wikidata'       // Wikidata
  | 'LCNAF'          // Library of Congress Name Authority File
  | 'ORCID'          // ORCID (researchers)
  | 'ROR'            // Research Organization Registry
  | 'GeoNames'       // GeoNames geographic database
  | 'LCSH'           // Library of Congress Subject Headings
  | 'Iconclass'      // Iconclass iconographic classification
  | 'Local';         // Organization's local vocabulary

/**
 * User-friendly names for reference sources.
 * Shown in suggestion badges.
 */
export const REFERENCE_SOURCE_LABELS: Record<ReferenceSource, string> = {
  VIAF: 'VIAF',
  ULAN: 'Getty ULAN',
  AAT: 'Getty AAT',
  TGN: 'Getty TGN',
  Nomenclature: 'Nomenclature',
  Wikidata: 'Wikidata',
  LCNAF: 'Library of Congress',
  ORCID: 'ORCID',
  ROR: 'ROR',
  GeoNames: 'GeoNames',
  LCSH: 'Library of Congress',
  Iconclass: 'Iconclass',
  Local: 'Local term',
};

/**
 * The main value type for authority-backed fields.
 * Users just see this as "the value they entered" - the references are invisible extras.
 */
export interface AuthorityBackedValue {
  /** Display value - what the user sees and edits */
  value: string;

  /** Optional reference links (hidden from user unless they look) */
  authorities?: ReferenceLink[];

  /** Optional note from cataloger */
  note?: string;

  // Field-specific extensions (optional)
  role?: string;           // For creators
  attribution?: string;    // For creators (e.g., "attributed to")
  extent?: string;         // For creators (e.g., "design only")
  part?: string;           // For materials (e.g., "support", "medium")
  placeType?: string;      // For places
  subjectType?: string;    // For subjects
  isPrimary?: boolean;     // For classifications
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Search request to the autocomplete endpoint.
 */
export interface AutocompleteSearchRequest {
  /** Search query (what the user typed) */
  query: string;

  /** Field type for context-appropriate results */
  fieldType: FieldType;

  /** Organization ID for local results */
  organizationId: string;

  /** Maximum results to return */
  limit?: number;

  /** Which sources to search (defaults to all applicable) */
  sources?: ('local' | 'recent' | 'external')[];

  /** Additional context (e.g., role=artist for creator fields) */
  context?: Record<string, string>;
}

/**
 * A single suggestion from the autocomplete endpoint.
 */
export interface AutocompleteSuggestion {
  /** Unique ID for this suggestion (for React keys) */
  id: string;

  /** Primary display text */
  label: string;

  /** Secondary description (dates, nationality, etc.) */
  description?: string;

  /** Source of this suggestion */
  source: SuggestionSource;

  /** Reference link if this is from an external source */
  reference?: ReferenceLink;

  /** How good is this match? */
  score: number;

  /** Additional metadata for display */
  metadata?: {
    dates?: string;        // "1840-1926"
    nationality?: string;  // "French"
    type?: string;         // "painter"
    usageCount?: number;   // How often used in this org
    lastUsed?: string;     // ISO date
  };
}

/**
 * Where did this suggestion come from?
 */
export type SuggestionSource =
  | 'recent'         // User's recent entries
  | 'organization'   // Used by others in this org
  | 'vocabulary'     // Local controlled vocabulary
  | 'getty'          // Getty vocabularies (ULAN, AAT, TGN)
  | 'nomenclature'  // AASLH Nomenclature for Museum Cataloging
  | 'wikidata'       // Wikidata
  | 'viaf'           // VIAF
  | 'iconclass'      // Iconclass iconographic classification
  | 'other';         // Other external source

/**
 * Response from the autocomplete endpoint.
 */
export interface AutocompleteSearchResponse {
  /** The search query (echoed back) */
  query: string;

  /** Suggestions grouped by source */
  suggestions: AutocompleteSuggestion[];

  /** Whether external sources were searched */
  externalSearched: boolean;

  /** Any errors that occurred (non-fatal) */
  warnings?: string[];

  /** Time taken for the search (ms) */
  searchTimeMs: number;
}

// ============================================================================
// COMPONENT STATE
// ============================================================================

export interface AutocompleteState {
  /** Current input text */
  inputValue: string;

  /** Whether dropdown is open */
  isOpen: boolean;

  /** Currently highlighted suggestion index */
  highlightedIndex: number;

  /** Local suggestions (immediate) */
  localSuggestions: AutocompleteSuggestion[];

  /** External suggestions (async) */
  externalSuggestions: AutocompleteSuggestion[];

  /** Loading state */
  isLoading: boolean;

  /** Error state */
  error: string | null;

  /** Whether external services are available */
  externalAvailable: boolean;
}

// ============================================================================
// EVENTS
// ============================================================================

export interface AutocompleteEvents {
  onSelect: (suggestion: AutocompleteSuggestion) => void;
  onCreateNew: (value: string) => void;
  onClear: () => void;
  onFocus: () => void;
  onBlur: () => void;
}
