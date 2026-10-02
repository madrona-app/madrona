/**
 * Object Entry Requirements Configuration
 *
 * Defines the complete requirement spec for Object Entry compliance,
 * including severity levels, status-based blocking, and conditional requirements.
 *
 * Shared types (Requirement, RequirementGroup, etc.) are defined in
 * procedureComplianceUtils.ts — this file imports and re-exports them.
 */

import type {
  Requirement,
  RequirementGroup,
  RequirementResult,
  RequirementSeverity,
  GroupResult,
  ComplianceResult,
} from './procedureComplianceUtils';
// Aliased: this module exports its own entry-specific
// computeProcedureCompliance that delegates to the generic one.
import { computeProcedureCompliance as computeGenericCompliance } from './procedureComplianceUtils';

// Re-export types so existing consumers that import from this file still work
export type { Requirement, RequirementGroup, RequirementResult, RequirementSeverity, GroupResult, ComplianceResult };

export type EntryStatus = 'pending' | 'received' | 'processing' | 'processed' | 'returned' | 'acquired';

// =============================================================================
// REQUIREMENT GROUPS
// =============================================================================

export const OBJECT_ENTRY_REQUIREMENT_GROUPS: RequirementGroup[] = [
  {
    id: 'entry',
    label: 'Entry Information',
    sectionId: 'entry',
    requirements: [
      {
        id: 'entry_number',
        label: 'Entry number',
        groupId: 'entry',
        fieldPaths: ['entry_number'],
        requiredForStatuses: ['received', 'processed', 'returned', 'acquired'],
        severity: 'blocking',
        helpText: 'A unique identifier assigned when objects are received.',
      },
      {
        id: 'entry_date',
        label: 'Entry date',
        groupId: 'entry',
        fieldPaths: ['entry_date'],
        requiredForStatuses: ['received', 'processed', 'returned', 'acquired'],
        severity: 'blocking',
        helpText: 'The date objects arrived or are expected to arrive.',
      },
      {
        id: 'reason',
        label: 'Reason for entry',
        groupId: 'entry',
        fieldPaths: ['entry_reason'],
        requiredForStatuses: ['received', 'processed'],
        severity: 'blocking',
        helpText: 'Why these objects are entering your care.',
      },
      {
        id: 'receipt_reference',
        label: 'Receipt reference',
        groupId: 'entry',
        fieldPaths: ['receipt_reference'],
        requiredForStatuses: ['processed'],
        severity: 'recommended',
        helpText: 'Reference number for the receipt given to the depositor.',
      },
    ],
  },
  {
    id: 'depositor',
    label: 'Depositor Information',
    sectionId: 'depositor',
    requirements: [
      {
        id: 'depositor_id',
        label: 'Depositor',
        groupId: 'depositor',
        fieldPaths: ['depositor_id'],
        requiredForStatuses: ['received', 'processed', 'returned'],
        severity: 'blocking',
        helpText: 'The person or organization bringing objects to you.',
      },
      {
        id: 'current_owner_id',
        label: 'Current owner',
        groupId: 'depositor',
        fieldPaths: ['current_owner_id'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'The legal owner of the objects, if different from depositor.',
      },
    ],
  },
  {
    id: 'objects',
    label: 'Objects Description',
    sectionId: 'objects',
    requirements: [
      {
        id: 'objects_description',
        label: 'Brief description',
        groupId: 'objects',
        fieldPaths: ['objects_description'],
        requiredForStatuses: ['received', 'processed', 'returned'],
        severity: 'blocking',
        helpText: 'A description sufficient to identify the objects.',
      },
      {
        id: 'items_count',
        label: 'At least one item',
        groupId: 'objects',
        fieldPaths: ['items'],
        predicate: (entry) => Array.isArray(entry.items) && entry.items.length >= 1,
        requiredForStatuses: ['received'],
        severity: 'blocking',
        helpText: 'Add at least one item to this entry.',
      },
      {
        id: 'entry_location',
        label: 'Storage location',
        groupId: 'objects',
        fieldPaths: ['items'],
        predicate: (entry) => {
          const items = entry.items as Array<{ location_id?: string | null }> | undefined;
          if (!Array.isArray(items) || items.length === 0) return false;
          return items.every((i) => !!(i && i.location_id));
        },
        requiredForStatuses: ['processed'],
        severity: 'recommended',
        helpText: 'Each item should have a storage location assigned.',
      },
      {
        id: 'entry_image',
        label: 'Object image',
        groupId: 'objects',
        fieldPaths: ['media_count'],
        predicate: (entry) => {
          const count = entry.media_count;
          return typeof count === 'number' && count > 0;
        },
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'Photograph documenting the object at time of entry.',
      },
    ],
  },
  {
    id: 'duration',
    label: 'Duration & Return',
    sectionId: 'duration',
    requirements: [
      {
        id: 'expected_duration',
        label: 'Expected duration',
        groupId: 'duration',
        fieldPaths: ['expected_duration'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'How long you expect to keep the objects.',
      },
      {
        id: 'expected_return_date',
        label: 'Expected return date',
        groupId: 'duration',
        fieldPaths: ['expected_return_date'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'When the objects should be returned to the depositor.',
      },
      {
        id: 'conditions',
        label: 'Conditions',
        groupId: 'duration',
        fieldPaths: ['conditions'],
        requiredForStatuses: [],
        severity: 'info',
        helpText: 'Any special conditions for the temporary custody.',
      },
    ],
  },
  {
    id: 'insurance',
    label: 'Insurance',
    sectionId: 'insurance',
    requirements: [
      {
        id: 'insurance_value',
        label: 'Insurance value',
        groupId: 'insurance',
        fieldPaths: ['insurance_value'],
        // Conditional: only required if insurance is applicable
        predicate: (entry) => {
          // If insurance_applicable is explicitly false, skip this requirement
          if (entry.insurance_applicable === false) return true;
          // Otherwise check if value is provided
          const value = entry.insurance_value;
          return value !== null && value !== undefined && value !== '' && value !== 0;
        },
        requiredForStatuses: ['processed'],
        severity: 'recommended',
        helpText: 'The agreed value for insurance purposes.',
      },
      {
        id: 'insurance_currency',
        label: 'Insurance currency',
        groupId: 'insurance',
        fieldPaths: ['insurance_currency'],
        requiredForStatuses: [],
        severity: 'info',
        helpText: 'Currency for the insurance value.',
      },
      {
        id: 'insurance_note',
        label: 'Insurance notes',
        groupId: 'insurance',
        fieldPaths: ['insurance_note'],
        requiredForStatuses: [],
        severity: 'info',
        helpText: 'Additional insurance arrangements or notes.',
      },
    ],
  },
  {
    id: 'terms-acceptance',
    label: 'Terms & Conditions',
    sectionId: 'terms-acceptance',
    requirements: [
      {
        id: 'terms_accepted',
        label: 'Terms accepted',
        groupId: 'terms-acceptance',
        fieldPaths: ['terms_accepted'],
        predicate: (entry) => entry.terms_accepted === true,
        requiredForStatuses: ['processed', 'returned'],
        severity: 'blocking',
        helpText: 'Requires documented acceptance of terms before objects enter your care. This blocks transition to Processed and Returned statuses.',
      },
      {
        id: 'terms_accepted_date',
        label: 'Acceptance date',
        groupId: 'terms-acceptance',
        fieldPaths: ['terms_accepted_date'],
        // Only required if terms are accepted
        predicate: (entry) => {
          if (!entry.terms_accepted) return true;
          const date = entry.terms_accepted_date;
          return typeof date === 'string' && date.trim().length > 0;
        },
        requiredForStatuses: ['processed'],
        severity: 'recommended',
        helpText: 'When the depositor accepted the terms.',
      },
      {
        id: 'terms_accepted_by',
        label: 'Accepted by',
        groupId: 'terms-acceptance',
        fieldPaths: ['terms_accepted_by'],
        predicate: (entry) => {
          if (!entry.terms_accepted) return true;
          const name = entry.terms_accepted_by;
          return typeof name === 'string' && name.trim().length > 0;
        },
        requiredForStatuses: ['processed'],
        severity: 'recommended',
        helpText: 'Name of the person who accepted the terms.',
      },
      {
        id: 'acceptance_method',
        label: 'Acceptance method',
        groupId: 'terms-acceptance',
        fieldPaths: ['acceptance_method'],
        requiredForStatuses: [],
        severity: 'info',
        helpText: 'How acceptance was documented (signature, email, verbal).',
      },
      {
        id: 'signature_reference',
        label: 'Signature reference',
        groupId: 'terms-acceptance',
        fieldPaths: ['signature_reference'],
        requiredForStatuses: [],
        severity: 'info',
        helpText: 'Reference to the signed document or signature image.',
      },
    ],
  },
  {
    id: 'receipt',
    label: 'Receipt',
    sectionId: 'entry', // Maps back to entry section where receipt reference lives
    requirements: [
      {
        id: 'receipt_issued',
        label: 'Receipt issued to depositor',
        groupId: 'receipt',
        fieldPaths: ['receipt_reference'],
        requiredForStatuses: ['processed'],
        severity: 'recommended',
        helpText: 'Requires giving the depositor a copy of the entry record.',
      },
    ],
  },
];

// =============================================================================
// STATUS ORDER & COMPLIANCE HELPERS
// =============================================================================

const ENTRY_STATUS_ORDER: EntryStatus[] = ['pending', 'received', 'processing', 'processed', 'returned', 'acquired'];

/**
 * Compute procedure compliance for an object entry.
 * Delegates to the generic computeGenericCompliance with entry-specific config.
 */
export function computeProcedureCompliance(
  entry: Record<string, unknown>,
  currentStatus: EntryStatus,
  targetStatus?: EntryStatus
): ComplianceResult {
  return computeGenericCompliance(
    OBJECT_ENTRY_REQUIREMENT_GROUPS,
    entry,
    currentStatus,
    ENTRY_STATUS_ORDER,
    targetStatus,
  );
}

/**
 * Get the next logical status for an entry.
 * Uses a lookup table because entry statuses have non-linear outcomes
 * (processed can lead to returned OR acquired).
 */
export function getEntryNextStatus(currentStatus: EntryStatus): EntryStatus | null {
  const statusTransitions: Record<EntryStatus, EntryStatus | null> = {
    pending: 'received',
    received: 'processed',
    processing: 'processed',
    processed: null, // Multiple outcomes possible
    returned: null,
    acquired: null,
  };
  return statusTransitions[currentStatus];
}

/** @deprecated Use getEntryNextStatus instead */
export const getNextStatus = getEntryNextStatus;

/**
 * Check if a status transition is allowed (without exceptions)
 */
export function canTransitionTo(
  entry: Record<string, unknown>,
  currentStatus: EntryStatus,
  targetStatus: EntryStatus
): { allowed: boolean; blockingRequirements: RequirementResult[] } {
  const compliance = computeProcedureCompliance(entry, currentStatus, targetStatus);
  return {
    allowed: compliance.blockingMissing.length === 0,
    blockingRequirements: compliance.blockingMissing,
  };
}
