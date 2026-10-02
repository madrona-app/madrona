/**
 * Client-side types for Staff AI Assistance surface.
 * 
 * These types are UI-only for now. Future backend integration will wire
 * these to actual API endpoints for persistence and generation.
 */

export type SuggestionStatus = 'draft' | 'applied' | 'dismissed';

export type SuggestionType = 
  | 'summary' 
  | 'subject_terms'
  | 'field_enrichment';

export interface Suggestion {
  id: string;
  type: SuggestionType;
  targetField?: string;
  currentValue?: string | null;
  proposedValue?: string | null;
  proposedList?: string[];
  createdAt: Date;
  status: SuggestionStatus;
  // Provenance metadata (optional, for future use)
  templateName?: string;
  templateVersion?: string;
  inputs?: Record<string, any>;
}

export interface SuggestionProvenance {
  generatedAt: Date;
  templateName?: string;
  templateVersion?: string;
  inputs?: string[];
}
