/**
 * Form error message utilities for Collections workspace pages.
 * Converts raw API field names to user-friendly labels.
 */

// Common field label mappings used across multiple forms
const COMMON_FIELD_LABELS: Record<string, string> = {
  object_id: 'Object',
  name: 'Name',
  title: 'Title',
  reason: 'Reason',
  status: 'Status',
  notes: 'Notes',
};

// Form-specific field label mappings
export const FIELD_LABELS: Record<string, Record<string, string>> = {
  deaccession: {
    ...COMMON_FIELD_LABELS,
    reason: 'Reason for Deaccession',
    disposal_method: 'Disposal Method',
    recipient_name: 'Recipient',
    proposal_date: 'Proposal Date',
  },
  movement: {
    ...COMMON_FIELD_LABELS,
    to_location_id: 'Destination Location',
    from_location_id: 'Current Location',
    reason: 'Movement Reason',
    movement_date: 'Movement Date',
  },
  contact: {
    ...COMMON_FIELD_LABELS,
    contact_type: 'Contact Type',
    email: 'Email Address',
    phone: 'Phone Number',
  },
  condition_report: {
    ...COMMON_FIELD_LABELS,
    report_type: 'Report Type',
    overall_condition: 'Overall Condition',
    examiner_name: 'Examiner',
    report_date: 'Report Date',
  },
  object_entry: {
    ...COMMON_FIELD_LABELS,
    reason: 'Entry Reason',
    entry_date: 'Entry Date',
    depositor_name: 'Depositor',
  },
  acquisition: {
    ...COMMON_FIELD_LABELS,
    acquisition_method: 'Acquisition Method',
    acquisition_date: 'Acquisition Date',
    source_name: 'Source',
  },
  loan_in: {
    ...COMMON_FIELD_LABELS,
    loan_purpose: 'Loan Purpose',
    lender_name: 'Lender',
    loan_start_date: 'Start Date',
    loan_end_date: 'End Date',
  },
  loan_out: {
    ...COMMON_FIELD_LABELS,
    loan_purpose: 'Loan Purpose',
    borrower_name: 'Borrower',
    venue_name: 'Venue',
    loan_start_date: 'Start Date',
    loan_end_date: 'End Date',
  },
  conservation: {
    ...COMMON_FIELD_LABELS,
    treatment_type: 'Treatment Type',
    conservator_name: 'Conservator',
    start_date: 'Start Date',
  },
  object_exit: {
    ...COMMON_FIELD_LABELS,
    exit_reason: 'Exit Reason',
    exit_date: 'Exit Date',
    recipient_name: 'Recipient',
  },
  authority: {
    ...COMMON_FIELD_LABELS,
    preferred_name: 'Preferred Name',
    authority_type: 'Authority Type',
    birth_date: 'Birth Date',
    death_date: 'Death Date',
  },
  citation: {
    ...COMMON_FIELD_LABELS,
    brief_citation: 'Citation',
    full_citation: 'Full Citation',
    publication_date: 'Publication Date',
  },
  documentation_plan: {
    ...COMMON_FIELD_LABELS,
    plan_type: 'Plan Type',
    target_date: 'Target Date',
  },
  emergency_plan: {
    ...COMMON_FIELD_LABELS,
    plan_version: 'Version',
    facility_name: 'Facility',
  },
  incident_report: {
    ...COMMON_FIELD_LABELS,
    incident_type: 'Incident Type',
    incident_description: 'Description',
    incident_date: 'Incident Date',
    reported_by: 'Reported By',
  },
  collections_review: {
    ...COMMON_FIELD_LABELS,
    review_type: 'Review Type',
    review_date: 'Review Date',
  },
  audit_campaign: {
    ...COMMON_FIELD_LABELS,
    audit_type: 'Audit Type',
    start_date: 'Start Date',
    end_date: 'End Date',
  },
  right: {
    ...COMMON_FIELD_LABELS,
    right_type: 'Right Type',
    right_holder_name: 'Right Holder',
    start_date: 'Start Date',
    end_date: 'End Date',
  },
  use_request: {
    ...COMMON_FIELD_LABELS,
    use_type: 'Use Type',
    requester_name: 'Requester Name',
    use_purpose: 'Purpose',
    requested_date: 'Requested Date',
  },
  valuation: {
    ...COMMON_FIELD_LABELS,
    valuation_type: 'Valuation Type',
    valuation_amount: 'Amount',
    valuation_date: 'Valuation Date',
    valuator_name: 'Valuator',
  },
  reproduction_request: {
    ...COMMON_FIELD_LABELS,
    request_type: 'Request Type',
    requester_name: 'Requester Name',
    intended_use: 'Intended Use',
  },
};

/**
 * Formats an API error message to be user-friendly.
 * Converts "Missing: field1, field2" style messages to friendly labels.
 *
 * @param message - The raw error message from the API
 * @param formType - The form type to use for field label lookups
 * @returns A user-friendly error message
 */
export function formatErrorMessage(message: string, formType?: keyof typeof FIELD_LABELS): string {
  // Check if it's a "Missing: field1, field2" style message
  const missingMatch = message.match(/^Missing(?:\s+required\s+fields)?:\s*(.+)$/i);
  if (missingMatch) {
    const fields = missingMatch[1].split(',').map(f => f.trim());
    const labels = formType ? FIELD_LABELS[formType] : COMMON_FIELD_LABELS;
    const friendlyFields = fields.map(f => labels[f] || COMMON_FIELD_LABELS[f] || f.replace(/_/g, ' '));
    return `Please fill in the required fields: ${friendlyFields.join(', ')}`;
  }

  // Check for "X is required" style messages
  const requiredMatch = message.match(/^(\w+)\s+is\s+required$/i);
  if (requiredMatch) {
    const field = requiredMatch[1];
    const labels = formType ? FIELD_LABELS[formType] : COMMON_FIELD_LABELS;
    const friendlyField = labels[field] || COMMON_FIELD_LABELS[field] || field.replace(/_/g, ' ');
    return `Please fill in the required field: ${friendlyField}`;
  }

  return message;
}
