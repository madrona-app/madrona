/**
 * Validation Utilities
 *
 * Defines minimum requirements per procedure and provides validation functions
 * for status advancement and section completion tracking.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface FieldRequirement {
  field: string;
  label: string;
  required: boolean;
  /** For nested fields like items[].condition_note */
  isArray?: boolean;
  /**
   * Custom validation function — overrides the default field lookup, so a
   * requirement can be about something other than a single top-level field
   * (e.g., "at least one item", "every item has a location").
   */
  validate?: (value: unknown, record: Record<string, unknown>) => boolean;
}

export interface SectionRequirements {
  id: string;
  title: string;
  procedureRef: string;
  fields: FieldRequirement[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface SectionCompletion {
  sectionId: string;
  title: string;
  completedCount: number;
  totalCount: number;
  requiredComplete: boolean;
  percentage: number;
  missingRequired: string[];
  missingOptional: string[];
}

// ============================================================================
// OBJECT ENTRY REQUIREMENTS
// ============================================================================

export const OBJECT_ENTRY_SECTIONS: SectionRequirements[] = [
  {
    id: 'entry',
    title: 'Entry Information',
    procedureRef: 'Object Entry - Creating an entry record',
    fields: [
      { field: 'entry_number', label: 'Entry number', required: true },
      { field: 'entry_date', label: 'Entry date', required: true },
      { field: 'reason', label: 'Entry reason', required: true },
    ],
  },
  {
    id: 'depositor',
    title: 'Depositor Information',
    procedureRef: 'Object Entry - Owner/Depositor details',
    fields: [
      { field: 'depositor_id', label: 'Depositor', required: true },
      { field: 'current_owner_id', label: 'Current owner', required: false },
    ],
  },
  {
    id: 'objects',
    title: 'Objects Description',
    procedureRef: 'Object Entry - Object identification',
    fields: [
      { field: 'objects_description', label: 'Brief description', required: true },
      {
        field: 'items',
        label: 'At least one item',
        required: true,
        validate: (_v, record) => {
          const items = record.items as unknown;
          return Array.isArray(items) && items.length >= 1;
        },
      },
    ],
  },
  {
    id: 'duration',
    title: 'Duration & Return',
    procedureRef: 'Object Entry - Return arrangements',
    fields: [
      { field: 'expected_return_date', label: 'Expected return date', required: false },
      { field: 'expected_duration', label: 'Expected duration', required: false },
      { field: 'conditions', label: 'Conditions', required: false },
    ],
  },
  {
    id: 'insurance',
    title: 'Insurance',
    procedureRef: 'Object Entry - Insurance details',
    fields: [
      { field: 'insurance_value', label: 'Insurance value', required: false },
      { field: 'insurance_currency', label: 'Currency', required: false },
      { field: 'insurance_note', label: 'Insurance note', required: false },
    ],
  },
  {
    id: 'terms-acceptance',
    title: 'Terms & Conditions',
    procedureRef: 'Object Entry - Depositor acceptance',
    fields: [
      { field: 'terms_accepted', label: 'Terms accepted', required: true },
      {
        field: 'terms_accepted_date',
        label: 'Acceptance date',
        required: false,
        // Conditionally required when terms are accepted
        validate: (value, record) => {
          if (!record.terms_accepted) return true; // Not required if terms not accepted
          return typeof value === 'string' && value.trim().length > 0;
        },
      },
      {
        // Form stores the accepted-by contact as a FK (terms_accepted_by_id);
        // the legacy text field terms_accepted_by is no longer populated.
        field: 'terms_accepted_by_id',
        label: 'Accepted by',
        required: false,
        // Conditionally required when terms are accepted
        validate: (_value, record) => {
          if (!record.terms_accepted) return true;
          const id = record.terms_accepted_by_id;
          const name = record.terms_accepted_by;
          // Accept either the FK or the legacy text value.
          return (
            (typeof id === 'string' && id.trim().length > 0) ||
            (typeof name === 'string' && (name as string).trim().length > 0)
          );
        },
      },
      { field: 'acceptance_method', label: 'Acceptance method', required: false },
      { field: 'acceptance_note', label: 'Acceptance notes', required: false },
    ],
  },
  {
    id: 'receipt',
    title: 'Receipt',
    procedureRef: 'Object Entry - Receipt generation',
    fields: [
      { field: 'receipt_reference', label: 'Receipt reference', required: false },
    ],
  },
];

// Status-specific requirements for Object Entry
export const OBJECT_ENTRY_STATUS_REQUIREMENTS: Record<string, string[]> = {
  // To mark as "received", these fields must be filled
  received: [
    'entry_number',
    'entry_date',
    'reason',
    'depositor_id',
    'objects_description',
  ],
  // To mark as "processed", all received requirements plus these
  processed: [
    'entry_number',
    'entry_date',
    'reason',
    'depositor_id',
    'objects_description',
    'terms_accepted',
  ],
};

// ============================================================================
// LOAN IN REQUIREMENTS
// ============================================================================

export const LOAN_IN_SECTIONS: SectionRequirements[] = [
  {
    id: 'lender',
    title: 'Lender Information',
    procedureRef: 'Loans In - Lender details',
    fields: [
      { field: 'lender_id', label: 'Lender', required: true },
    ],
  },
  {
    id: 'lender-authorization',
    title: "Lender's Authorization",
    procedureRef: 'Loans In - Lender authorization',
    fields: [
      { field: 'lender_authorizer_name', label: 'Authorizer name', required: false },
      { field: 'lender_authorizer_title', label: 'Authorizer title', required: false },
      { field: 'lender_authorization_date', label: 'Authorization date', required: false },
    ],
  },
  {
    id: 'details',
    title: 'Loan Details',
    procedureRef: 'Loans In - Loan purpose and conditions',
    fields: [
      { field: 'loan_purpose', label: 'Loan purpose', required: true },
      { field: 'exhibition_name', label: 'Exhibition name', required: false },
      { field: 'exhibition_venue', label: 'Exhibition venue', required: false },
      { field: 'loan_conditions', label: 'Loan conditions', required: false },
      { field: 'special_requirements', label: 'Special requirements', required: false },
      { field: 'display_requirements', label: 'Display requirements', required: false },
      { field: 'photography_restrictions', label: 'Photography restrictions', required: false },
    ],
  },
  {
    id: 'dates',
    title: 'Key Dates',
    procedureRef: 'Loans In - Loan dates',
    fields: [
      { field: 'request_date', label: 'Request date', required: true },
      { field: 'approval_date', label: 'Approval date', required: false },
      { field: 'loan_start_date', label: 'Loan start date', required: true },
      { field: 'loan_end_date', label: 'Loan end date', required: true },
    ],
  },
  {
    id: 'insurance',
    title: 'Insurance & Indemnity',
    procedureRef: 'Loans In - Insurance and indemnity',
    fields: [
      { field: 'insurance_value', label: 'Insurance value', required: true },
      { field: 'insurance_currency', label: 'Currency', required: false },
      { field: 'insurance_policy', label: 'Policy number', required: false },
      { field: 'insurance_provider', label: 'Provider', required: false },
      { field: 'indemnity', label: 'Indemnity', required: false },
      { field: 'indemnity_reference', label: 'Indemnity reference', required: false },
    ],
  },
  {
    id: 'facility',
    title: 'Facility Report',
    procedureRef: 'Loans In - Facilities report',
    fields: [
      { field: 'facility_report_sent', label: 'Report sent', required: false },
      { field: 'facility_report_date', label: 'Report date', required: false },
      { field: 'facility_report_approved', label: 'Report approved', required: false },
      { field: 'facility_report_approved_date', label: 'Approved date', required: false },
      { field: 'facility_report_note', label: 'Report notes', required: false },
    ],
  },
  {
    id: 'shipping',
    title: 'Shipping & Transport',
    procedureRef: 'Loans In - Transport arrangements',
    fields: [
      { field: 'shipping_method', label: 'Shipping method', required: false },
      { field: 'shipping_company', label: 'Shipping company', required: false },
      { field: 'courier_required', label: 'Courier required', required: false },
      { field: 'courier_details', label: 'Courier details', required: false },
      { field: 'crate_required', label: 'Crate required', required: false },
      { field: 'crate_specifications', label: 'Crate specifications', required: false },
    ],
  },
  {
    id: 'condition-reports',
    title: 'Condition Reports',
    procedureRef: 'Loans In - Condition checking',
    fields: [
      { field: 'condition_report_in_id', label: 'Incoming condition report', required: false },
      { field: 'condition_report_out_id', label: 'Outgoing condition report', required: false },
    ],
  },
  {
    id: 'agreement',
    title: 'Loan Agreement',
    procedureRef: 'Loans In - Loan agreement',
    fields: [
      { field: 'loan_agreement_reference', label: 'Agreement reference', required: true },
      { field: 'loan_agreement_date', label: 'Agreement date', required: false },
      { field: 'loan_agreement_signed_date', label: 'Signed date', required: false },
    ],
  },
  {
    id: 'renewals',
    title: 'Renewals',
    procedureRef: 'Loans In - Loan renewal',
    fields: [
      { field: 'max_renewals', label: 'Maximum renewals', required: false },
    ],
  },
  {
    id: 'document-location',
    title: 'Document Location',
    procedureRef: 'Loans In - Document location',
    fields: [
      { field: 'document_location', label: 'File location', required: false },
      { field: 'document_location_note', label: 'Location notes', required: false },
    ],
  },
  {
    id: 'loan-contact',
    title: 'Internal Loan Contact',
    procedureRef: 'Loans In - Loan contact',
    fields: [
      { field: 'loan_contact_name', label: 'Contact name', required: false },
      { field: 'loan_contact_email', label: 'Contact email', required: false },
      { field: 'loan_contact_phone', label: 'Contact phone', required: false },
    ],
  },
  {
    id: 'notes',
    title: 'Internal Notes',
    procedureRef: 'Loans In - Internal notes',
    fields: [
      { field: 'internal_note', label: 'Internal notes', required: false },
    ],
  },
];

// Status-specific requirements for Loan In
export const LOAN_IN_STATUS_REQUIREMENTS: Record<string, string[]> = {
  // To approve a loan request
  approved: [
    'lender_id',
    'loan_purpose',
    'request_date',
    'loan_start_date',
    'loan_end_date',
    'insurance_value',
  ],
  // To mark as received
  received: [
    'lender_id',
    'loan_purpose',
    'request_date',
    'loan_start_date',
    'loan_end_date',
    'insurance_value',
    'loan_agreement_reference',
    'condition_report_in_id',
  ],
  // To mark as on_loan
  on_loan: [
    'lender_id',
    'loan_purpose',
    'request_date',
    'loan_start_date',
    'loan_end_date',
    'insurance_value',
    'loan_agreement_reference',
  ],
  // To mark as returned
  returned: [
    'lender_id',
    'loan_purpose',
    'request_date',
    'loan_start_date',
    'loan_end_date',
    'insurance_value',
    'loan_agreement_reference',
    'condition_report_out_id',
  ],
};

// ============================================================================
// MOVEMENT REQUIREMENTS
// ============================================================================

export const MOVEMENT_SECTIONS: SectionRequirements[] = [
  {
    id: 'object',
    title: 'Object',
    procedureRef: 'Movement - Object identification',
    fields: [
      { field: 'object_id', label: 'Object', required: true },
    ],
  },
  {
    id: 'movement',
    title: 'Movement Details',
    procedureRef: 'Movement - Movement details',
    fields: [
      { field: 'reason', label: 'Reason', required: true },
      { field: 'from_location_id', label: 'From location', required: false },
      { field: 'to_location_id', label: 'To location', required: true },
      { field: 'movement_date', label: 'Movement date', required: true },
      { field: 'status', label: 'Status', required: true },
    ],
  },
  {
    id: 'details',
    title: 'Handler & Notes',
    procedureRef: 'Movement - Handler and notes',
    fields: [
      { field: 'handler_id', label: 'Handler', required: false },
      { field: 'movement_note', label: 'Notes', required: false },
    ],
  },
];

export const MOVEMENT_STATUS_REQUIREMENTS: Record<string, string[]> = {
  in_transit: [
    'object_id',
    'reason',
    'to_location_id',
    'movement_date',
  ],
  completed: [
    'object_id',
    'reason',
    'to_location_id',
    'movement_date',
  ],
};

// ============================================================================
// OBJECT EXIT REQUIREMENTS
// ============================================================================

export const OBJECT_EXIT_SECTIONS: SectionRequirements[] = [
  {
    id: 'exit',
    title: 'Exit Information',
    procedureRef: 'Object Exit - Exit details',
    fields: [
      { field: 'exit_number', label: 'Exit number', required: true },
      { field: 'exit_date', label: 'Exit date', required: true },
      { field: 'exit_reason', label: 'Exit reason', required: true },
    ],
  },
  {
    id: 'recipient',
    title: 'Recipient',
    procedureRef: 'Object Exit - Exit destination',
    fields: [
      { field: 'recipient_name', label: 'Recipient name', required: true },
      { field: 'recipient_address', label: 'Recipient address', required: false },
    ],
  },
  {
    id: 'authorization',
    title: 'Authorization',
    procedureRef: 'Object Exit - Exit authorizer',
    fields: [
      { field: 'authorization_id', label: 'Authorizer', required: true },
      { field: 'authorization_date', label: 'Authorization date', required: true },
    ],
  },
  {
    id: 'condition',
    title: 'Condition',
    procedureRef: 'Object Exit - Condition at exit',
    fields: [
      { field: 'condition_at_exit', label: 'Condition', required: false },
      { field: 'condition_report_id', label: 'Condition report', required: false },
    ],
  },
  {
    id: 'receipt',
    title: 'Receipt Acknowledgment',
    procedureRef: 'Object Exit - Recipient signature',
    fields: [
      { field: 'receipt_acknowledged', label: 'Receipt acknowledged', required: false },
      { field: 'receipt_acknowledged_by', label: 'Acknowledged by', required: false },
      { field: 'receipt_acknowledged_date', label: 'Acknowledged date', required: false },
    ],
  },
];

export const OBJECT_EXIT_STATUS_REQUIREMENTS: Record<string, string[]> = {
  preparing: [
    'exit_number',
    'exit_date',
    'exit_reason',
    'recipient_name',
  ],
  dispatched: [
    'exit_number',
    'exit_date',
    'exit_reason',
    'recipient_name',
    'authorization_id',
    'authorization_date',
  ],
  acknowledged: [
    'exit_number',
    'exit_date',
    'exit_reason',
    'recipient_name',
    'authorization_id',
    'authorization_date',
    'receipt_acknowledged',
  ],
};

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Check if a field has a value (handles various types)
 */
function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return true;
  if (typeof value === 'boolean') return value === true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

/**
 * Get a nested field value using dot notation
 */
function getFieldValue(record: Record<string, unknown>, fieldPath: string): unknown {
  const parts = fieldPath.split('.');
  let value: unknown = record;
  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/**
 * Calculate completion for a single section
 */
export function calculateSectionCompletion(
  sectionDef: SectionRequirements,
  record: Record<string, unknown>
): SectionCompletion {
  const missingRequired: string[] = [];
  const missingOptional: string[] = [];
  let completedCount = 0;

  for (const field of sectionDef.fields) {
    const value = getFieldValue(record, field.field);
    const fieldHasValue = field.validate
      ? field.validate(value, record)
      : hasValue(value);

    if (fieldHasValue) {
      completedCount++;
    } else if (field.required) {
      missingRequired.push(field.label);
    } else {
      missingOptional.push(field.label);
    }
  }

  const totalCount = sectionDef.fields.length;
  const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 100;

  return {
    sectionId: sectionDef.id,
    title: sectionDef.title,
    completedCount,
    totalCount,
    requiredComplete: missingRequired.length === 0,
    percentage,
    missingRequired,
    missingOptional,
  };
}

/**
 * Calculate completion for all sections
 */
export function calculateAllSectionCompletions(
  sections: SectionRequirements[],
  record: Record<string, unknown>
): SectionCompletion[] {
  return sections.map(section => calculateSectionCompletion(section, record));
}

/**
 * Validate if a status transition is allowed
 */
export function validateStatusTransition(
  procedure: 'object_entry' | 'loan_in' | 'object_exit' | 'movement',
  targetStatus: string,
  record: Record<string, unknown>
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Get requirements for the target status
  let requirements: string[] = [];
  switch (procedure) {
    case 'object_entry':
      requirements = OBJECT_ENTRY_STATUS_REQUIREMENTS[targetStatus] || [];
      break;
    case 'loan_in':
      requirements = LOAN_IN_STATUS_REQUIREMENTS[targetStatus] || [];
      break;
    case 'object_exit':
      requirements = OBJECT_EXIT_STATUS_REQUIREMENTS[targetStatus] || [];
      break;
    case 'movement':
      requirements = MOVEMENT_STATUS_REQUIREMENTS[targetStatus] || [];
      break;
  }

  // Check each required field
  for (const fieldPath of requirements) {
    const value = getFieldValue(record, fieldPath);
    if (!hasValue(value)) {
      // Find the label for this field
      const sections = procedure === 'object_entry'
        ? OBJECT_ENTRY_SECTIONS
        : procedure === 'loan_in'
          ? LOAN_IN_SECTIONS
          : procedure === 'movement'
            ? MOVEMENT_SECTIONS
            : OBJECT_EXIT_SECTIONS;

      let label = fieldPath;
      for (const section of sections) {
        const field = section.fields.find(f => f.field === fieldPath);
        if (field) {
          label = field.label;
          break;
        }
      }
      errors.push(`${label} is required`);
    }
  }

  // Compliance is advisory — users can move to any status from any status.
  // Errors are returned for display but don't block the transition.
  return {
    valid: true,
    errors,
    warnings,
  };
}

/**
 * Get overall completion percentage for a record
 */
export function getOverallCompletion(
  procedure: 'object_entry' | 'loan_in' | 'object_exit' | 'movement',
  record: Record<string, unknown>
): { percentage: number; requiredComplete: boolean; totalFields: number; completedFields: number } {
  const sections = procedure === 'object_entry'
    ? OBJECT_ENTRY_SECTIONS
    : procedure === 'loan_in'
      ? LOAN_IN_SECTIONS
      : procedure === 'movement'
        ? MOVEMENT_SECTIONS
        : OBJECT_EXIT_SECTIONS;

  const completions = calculateAllSectionCompletions(sections, record);

  let totalFields = 0;
  let completedFields = 0;
  let allRequiredComplete = true;

  for (const completion of completions) {
    totalFields += completion.totalCount;
    completedFields += completion.completedCount;
    if (!completion.requiredComplete) {
      allRequiredComplete = false;
    }
  }

  const percentage = totalFields > 0 ? Math.round((completedFields / totalFields) * 100) : 100;

  return {
    percentage,
    requiredComplete: allRequiredComplete,
    totalFields,
    completedFields,
  };
}
