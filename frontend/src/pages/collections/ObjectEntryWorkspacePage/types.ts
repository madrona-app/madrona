/**
 * Type definitions for ObjectEntryWorkspacePage components
 */

import type { LucideIcon } from 'lucide-react';
import type { LoanIn, Media } from '../../../lib/schemas';
import type { RequirementResult } from '../../../lib/procedureComplianceUtils';
import type { SectionCompletion } from '../../../lib/procedureValidation';
import type { SectionGroup } from '../../../components/record-detail';
import type { LookupOption } from '../../../hooks/useLookupValues';

// Extended LoanIn type that includes the join table ID when fetched from entry context
export type LinkedLoanWithEntryId = LoanIn & { loan_in_entry_id: string };

// Minimal media info needed for the linker component
export type MediaInfo = Pick<Media, 'media_id' | 'filename' | 'media_type' | 'mime_type' | 'thumbnail_url' | 'preview_url'>;

// Save status for form autosave
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// Status configuration
export interface StatusConfig {
  label: string;
  color: string;
  icon: LucideIcon;
}

// Workflow step
export interface WorkflowStep {
  key: string;
  label: string;
}

// Entry form data
export interface EntryFormData {
  entry_date: string;
  reason: string;
  depositor_id: string;
  depositor_name: string;
  current_owner_id: string;
  current_owner: string;
  receipt_reference: string;
  objects_description: string;
  expected_duration: string;
  expected_return_date: string;
  conditions: string;
  insurance_value: string;
  insurance_currency: string;
  insurance_note: string;
  entry_note: string;
  // Entry method
  entry_method: string;
  // Authorization
  authorizer_id: string;
  authorizer_name: string;
  authorization_date: string;
  authorization_note: string;
  // Terms acceptance
  terms_accepted: boolean;
  terms_accepted_date: string;
  terms_accepted_by_id: string;
  acceptance_method: string;
  acceptance_note: string;
  [key: string]: unknown;
}

// Dialog states
export interface StatusAdvancementDialogState {
  isOpen: boolean;
  targetStatus: string;
  targetStatusLabel: string;
}

export interface ExceptionDialogState {
  isOpen: boolean;
  targetStatus: string;
  targetStatusLabel: string;
  blockingRequirements: RequirementResult[];
}

export interface BlockingDialogState {
  isOpen: boolean;
  actionLabel: string;
  blockerLabel: string;
  sectionId: string;
  fieldPath: string | undefined;
}

// Section expansion state
export type SectionExpansionState = Record<string, boolean>;

// Shared section props
export interface SectionBaseProps {
  isEditing: boolean;
  isCreateMode: boolean;
}

// Entry section props
export interface EntrySectionProps extends SectionBaseProps {
  formData: EntryFormData;
  updateField: (field: string, value: unknown) => void;
  isExpanded: boolean;
  onToggle: () => void;
  getSectionOrder: (sectionId: string) => number | undefined;
  sectionCompletion?: SectionCompletion;
  entryReasonOptions: LookupOption[];
  orgId: string;
}

// Depositor section props
export interface DepositorSectionProps extends SectionBaseProps {
  formData: EntryFormData;
  updateField: (field: string, value: unknown) => void;
  isExpanded: boolean;
  onToggle: () => void;
  getSectionOrder: (sectionId: string) => number | undefined;
  sectionCompletion?: SectionCompletion;
  orgId: string;
  isRestricted: (field: string) => boolean;
}

// Objects section props
export interface ObjectsSectionProps extends SectionBaseProps {
  formData: EntryFormData;
  updateField: (field: string, value: unknown) => void;
  isExpanded: boolean;
  onToggle: () => void;
  getSectionOrder: (sectionId: string) => number | undefined;
  sectionCompletion?: SectionCompletion;
  orgId: string;
  entryId?: string;
  entry?: {
    entry_id?: string;
    items?: Array<{
      entry_item_id?: string;
      item_number?: number | null;
      brief_description?: string | null;
      detailed_description?: string | null;
      lender_object_number?: string | null;
      object_id?: string | null;
      declared_value?: number | null;
      declared_value_currency?: string | null;
      condition_note?: string | null;
      condition_report_id?: string | null;
      condition_report_number?: string | null;
      location_id?: string | null;
      location_name?: string | null;
      location_path?: string | null;
      item_status?: string | null;
      item_outcome?: string | null;
      item_outcome_note?: string | null;
      media?: Array<{
        media_id: string;
        filename: string;
        media_type: string;
        mime_type: string;
        thumbnail_url?: string | null;
        is_primary?: boolean;
        sort_order?: number;
        caption?: string | null;
        usage_type?: string | null;
      }>;
    }> | null;
  } | null;
  /** Whether the Media application is enabled */
  hasMediaApp?: boolean;
}

// Duration section props
export interface DurationSectionProps extends SectionBaseProps {
  formData: EntryFormData;
  updateField: (field: string, value: unknown) => void;
  isExpanded: boolean;
  onToggle: () => void;
  getSectionOrder: (sectionId: string) => number | undefined;
  durationOptions: LookupOption[];
  isRestricted: (field: string) => boolean;
}

// Insurance section props
export interface InsuranceSectionProps extends SectionBaseProps {
  formData: EntryFormData;
  updateField: (field: string, value: unknown) => void;
  isExpanded: boolean;
  onToggle: () => void;
  getSectionOrder: (sectionId: string) => number | undefined;
  currencyOptions: LookupOption[];
  isRestricted: (field: string) => boolean;
}

// Terms section props
export interface TermsSectionProps extends SectionBaseProps {
  formData: EntryFormData;
  updateField: (field: string, value: unknown) => void;
  isExpanded: boolean;
  onToggle: () => void;
  getSectionOrder: (sectionId: string) => number | undefined;
  sectionCompletion?: SectionCompletion;
  orgId: string;
  entryId?: string;
  onGenerateReceipt: () => void;
  isGeneratingReceipt: boolean;
}

// Notes section props
export interface NotesSectionProps extends SectionBaseProps {
  formData: EntryFormData;
  updateField: (field: string, value: unknown) => void;
  isExpanded: boolean;
  onToggle: () => void;
  getSectionOrder: (sectionId: string) => number | undefined;
}

// Linked records section props
export interface LinkedRecordsSectionProps extends SectionBaseProps {
  orgId?: string;
  entryId?: string;
  effectiveReason: string;
  linkedAcquisition?: { acquisition_id: string; [key: string]: unknown };
  linkedLoan?: LinkedLoanWithEntryId;
  linkedExit?: { exit_id: string; [key: string]: unknown };
  expandedSections: SectionExpansionState;
  onToggle: (sectionId: string) => void;
  getSectionOrder: (sectionId: string) => number | undefined;
  depositorName?: string;
  onLinkChange: () => void;
}

// Re-export SectionGroup for convenience
export type { SectionGroup };
