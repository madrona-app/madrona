import { z } from 'zod';
import { MediaSchema } from './media';

// ============================================================================
// PROCEDURE SCHEMAS
// ============================================================================

// Contact schema (depositors, lenders, borrowers, conservators)
export const ContactSchema = z.object({
  contact_id: z.string(),
  organization_id: z.string(),
  contact_type: z.enum(['person', 'organization', 'department', 'estate', 'dealer', 'auction_house']),
  name: z.string(),
  title: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  organization_name: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  phone_secondary: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  address: z.object({
    street: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    postal_code: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
  }).nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
});

export type Contact = z.infer<typeof ContactSchema>;

export const PaginatedContactsSchema = z.object({
  contacts: z.array(ContactSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedContacts = z.infer<typeof PaginatedContactsSchema>;

// Condition Report schema (CDWA 14)
export const ConditionReportSchema = z.object({
  report_id: z.string(),
  organization_id: z.string(),
  report_number: z.string(),
  report_type: z.enum(['intake', 'loan_out', 'loan_in', 'periodic', 'conservation', 'incident']),
  check_reason: z.string().nullable().optional(),
  report_date: z.string().nullable().optional(),
  completeness: z.string().nullable().optional(),
  completeness_date: z.string().nullable().optional(),
  next_check_date: z.string().nullable().optional(),
  examiner_id: z.string().nullable().optional(),
  examiner_name: z.string().nullable().optional(),
  object_id: z.string().nullable().optional(),
  linked_entity_type: z.string().nullable().optional(),
  linked_entity_id: z.string().nullable().optional(),
  overall_condition: z.enum(['excellent', 'good', 'fair', 'poor', 'unacceptable']).nullable().optional(),
  condition_summary: z.string().nullable().optional(),
  detailed_findings: z.array(z.object({
    part: z.string().nullable().optional(),
    condition: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    images: z.array(z.string()).nullable().optional(),
  })).nullable().optional(),
  hazards: z.array(z.object({
    type: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    precautions: z.string().nullable().optional(),
  })).nullable().optional(),
  recommendations: z.string().nullable().optional(),
  conservation_needed: z.boolean(),
  conservation_priority: z.enum(['urgent', 'high', 'medium', 'low']).nullable().optional(),
  handling_requirements: z.string().nullable().optional(),
  packing_requirements: z.string().nullable().optional(),
  display_restrictions: z.string().nullable().optional(),
  image_references: z.array(z.object({
    media_id: z.string().nullable().optional(),
    caption: z.string().nullable().optional(),
    area: z.string().nullable().optional(),
  })).nullable().optional(),
  previous_report_id: z.string().nullable().optional(),
  status: z.enum(['draft', 'pending_approval', 'completed', 'reviewed']),
  reviewed_by: z.string().nullable().optional(),
  reviewed_date: z.string().nullable().optional(),
  report_note: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
  _restricted_fields: z.array(z.string()).optional(),
  // Embedded object summary (when fetching report details)
  object: z.object({
    object_id: z.string(),
    object_number: z.string(),
    title: z.string().nullable().optional(),
  }).nullable().optional(),
});

export type ConditionReport = z.infer<typeof ConditionReportSchema>;

export const PaginatedConditionReportsSchema = z.object({
  items: z.array(ConditionReportSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedConditionReports = z.infer<typeof PaginatedConditionReportsSchema>;

// Object Entry schema
export const ObjectEntryItemSchema = z.object({
  entry_item_id: z.string(),
  entry_id: z.string(),
  organization_id: z.string(),
  item_number: z.number().nullable().optional(),
  brief_description: z.string().nullable().optional(),
  detailed_description: z.string().nullable().optional(),
  lender_object_number: z.string().nullable().optional(),
  object_id: z.string().nullable().optional(),
  acquisition_id: z.string().nullable().optional(),
  declared_value: z.number().nullable().optional(),
  declared_value_currency: z.string().nullable().optional(),
  condition_note: z.string().nullable().optional(),
  condition_report_id: z.string().nullable().optional(),
  condition_report_number: z.string().nullable().optional(),
  location_id: z.string().nullable().optional(),
  location_name: z.string().nullable().optional(),
  location_path: z.string().nullable().optional(),
  item_status: z.string().nullable().optional(),
  item_outcome: z.string().nullable().optional(),
  item_outcome_note: z.string().nullable().optional(),
  media: z.array(z.object({
    media_id: z.string(),
    filename: z.string(),
    media_type: z.string(),
    mime_type: z.string(),
    thumbnail_url: z.string().nullable().optional(),
    is_primary: z.boolean().optional(),
    sort_order: z.number().optional(),
    caption: z.string().nullable().optional(),
    usage_type: z.string().nullable().optional()
  })).optional(),
  created_at: z.string(),
}).passthrough();

export type ObjectEntryItem = z.infer<typeof ObjectEntryItemSchema>;

export const ObjectEntrySchema = z.object({
  entry_id: z.string(),
  organization_id: z.string(),
  entry_number: z.string(),
  entry_date: z.string().nullable().optional(),
  depositor_id: z.string().nullable().optional(),
  depositor_name: z.string().nullable().optional(),
  current_owner_id: z.string().nullable().optional(),
  current_owner: z.string().nullable().optional(),
  reason: z.string(),
  expected_duration: z.string().nullable().optional(),
  expected_return_date: z.string().nullable().optional(),
  receipt_reference: z.string().nullable().optional(),
  entry_note: z.string().nullable().optional(),
  objects_description: z.string().nullable().optional(),
  insurance_value: z.number().nullable().optional(),
  insurance_currency: z.string().nullable().optional(),
  insurance_note: z.string().nullable().optional(),
  conditions: z.string().nullable().optional(),
  // Entry method
  entry_method: z.string().nullable().optional(),
  // Authorization — who in the institution authorized accepting this deposit
  authorizer_id: z.string().nullable().optional(),
  authorizer_name: z.string().nullable().optional(),
  authorization_date: z.string().nullable().optional(),
  authorization_note: z.string().nullable().optional(),
  // Terms acceptance
  terms_accepted: z.boolean().nullable().optional(),
  terms_accepted_date: z.string().nullable().optional(),
  terms_accepted_by_id: z.string().nullable().optional(),
  terms_accepted_by: z.string().nullable().optional(), // Deprecated
  acceptance_method: z.string().nullable().optional(),
  signature_reference: z.string().nullable().optional(),
  signature_media_id: z.string().nullable().optional(),
  acceptance_note: z.string().nullable().optional(),
  status: z.enum(['pending', 'received', 'processed', 'returned', 'acquired']),
  processed_date: z.string().nullable().optional(),
  processed_by: z.string().nullable().optional(),
  outcome: z.enum(['returned', 'acquired', 'transferred']).nullable().optional(),
  outcome_reference_id: z.string().nullable().optional(),
  return_date: z.string().nullable().optional(),
  returned_to: z.string().nullable().optional(),
  exit_id: z.string().nullable().optional(),
  identifiers: z.array(z.object({
    type: z.string(),
    value: z.string(),
  })).nullable().optional(),
  department_id: z.string().nullable().optional(),
  objects_count: z.number().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
  items: z.array(ObjectEntryItemSchema).nullable().optional(),
}).passthrough();

export type ObjectEntry = z.infer<typeof ObjectEntrySchema>;

export const PaginatedObjectEntriesSchema = z.object({
  items: z.array(ObjectEntrySchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedObjectEntries = z.infer<typeof PaginatedObjectEntriesSchema>;

// Acquisition schema
export const AcquisitionSchema = z.object({
  acquisition_id: z.string(),
  organization_id: z.string(),
  acquisition_number: z.string(),
  acquisition_method: z.enum(['gift', 'purchase', 'bequest', 'transfer', 'exchange', 'field_collection', 'other']),
  acquisition_date: z.string().nullable().optional(),
  source_id: z.string().nullable().optional(),
  source_name: z.string().nullable().optional(),
  source_type: z.enum(['individual', 'institution', 'estate', 'dealer', 'other']).nullable().optional(),
  authorization_id: z.string().nullable().optional(),
  authorization_date: z.string().nullable().optional(),
  authorization_note: z.string().nullable().optional(),
  funding_source: z.string().nullable().optional(),
  funding_account: z.string().nullable().optional(),
  funding_note: z.string().nullable().optional(),
  cost: z.number().nullable().optional(),
  cost_currency: z.string().nullable().optional(),
  // Appraisal
  appraised_value: z.number().nullable().optional(),
  appraised_value_currency: z.string().nullable().optional(),
  appraised_date: z.string().nullable().optional(),
  appraiser_name: z.string().nullable().optional(),
  // Legal
  legal_status: z.enum(['clear', 'pending_provenance', 'disputed', 'restricted']).nullable().optional(),
  legal_note: z.string().nullable().optional(),
  provenance_verified: z.boolean(),
  provenance_note: z.string().nullable().optional(),
  provisos: z.string().nullable().optional(),
  donor_restrictions: z.string().nullable().optional(),
  acquisition_reason: z.string().nullable().optional(),
  acknowledgement_date: z.string().nullable().optional(),
  acknowledgement_reference: z.string().nullable().optional(),
  credit_line: z.string().nullable().optional(),
  transfer_of_title_number: z.string().nullable().optional(),
  // Documentation
  deed_of_gift_date: z.string().nullable().optional(),
  deed_of_gift_reference: z.string().nullable().optional(),
  // Board approval
  board_approval_required: z.boolean(),
  board_approval_date: z.string().nullable().optional(),
  board_approval_reference: z.string().nullable().optional(),
  board_note: z.string().nullable().optional(),
  // Links
  entry_id: z.string().nullable().optional(),
  objects_count: z.number(),
  // Notes
  acquisition_note: z.string().nullable().optional(),
  internal_note: z.string().nullable().optional(),
  status: z.enum(['proposed', 'pending_approval', 'approved', 'completed', 'accessioned', 'cancelled']),
  completed_date: z.string().nullable().optional(),
  // Accessioning
  accession_number: z.string().nullable().optional(),
  accession_date: z.string().nullable().optional(),
  accessioning_approved: z.boolean(),
  accessioning_approved_by: z.string().nullable().optional(),
  accessioning_approved_date: z.string().nullable().optional(),
  accessioning_resolution: z.string().nullable().optional(),
  accessioning_note: z.string().nullable().optional(),
  department_id: z.string().nullable().optional(),
  created_at: z.string(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  _restricted_fields: z.array(z.string()).optional(),
});

export type Acquisition = z.infer<typeof AcquisitionSchema>;

export const PaginatedAcquisitionsSchema = z.object({
  items: z.array(AcquisitionSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedAcquisitions = z.infer<typeof PaginatedAcquisitionsSchema>;

// Loan In schema
export const LoanInObjectSchema = z.object({
  loan_object_id: z.string(),
  loan_in_id: z.string(),
  organization_id: z.string(),
  object_id: z.string().nullable().optional(),
  object_number_lender: z.string().nullable().optional(),
  object_title: z.string().nullable().optional(),
  object_description: z.string().nullable().optional(),
  artist_maker: z.string().nullable().optional(),
  date_description: z.string().nullable().optional(),
  insurance_value: z.number().nullable().optional(),
  insurance_currency: z.string().nullable().optional(),
  dimensions: z.string().nullable().optional(),
  medium: z.string().nullable().optional(),
  special_requirements: z.string().nullable().optional(),
  display_requirements: z.string().nullable().optional(),
  condition_report_in_id: z.string().nullable().optional(),
  condition_report_out_id: z.string().nullable().optional(),
  current_location_id: z.string().nullable().optional(),
  item_status: z.string().nullable().optional(),
  received_date: z.string().nullable().optional(),
  returned_date: z.string().nullable().optional(),
  object: z.object({
    object_id: z.string(),
    object_number: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    object_name: z.string().nullable().optional(),
    primary_image_url: z.string().nullable().optional(),
  }).optional(),
  created_at: z.string(),
});

export type LoanInObject = z.infer<typeof LoanInObjectSchema>;

export const LoanInSchema = z.object({
  loan_in_id: z.string(),
  organization_id: z.string(),
  loan_number: z.string(),
  lender_id: z.string().nullable().optional(),
  lender_name: z.string().nullable().optional(),
  lender_contact: z.record(z.string(), z.any()).nullable().optional(),
  loan_purpose: z.enum(['exhibition', 'research', 'conservation', 'long_term', 'other']),
  exhibition_id: z.string().nullable().optional(),
  exhibition_name: z.string().nullable().optional(),
  request_date: z.string().nullable().optional(),
  approval_date: z.string().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  loan_start_date: z.string().nullable().optional(),
  loan_end_date: z.string().nullable().optional(),
  actual_receipt_date: z.string().nullable().optional(),
  actual_return_date: z.string().nullable().optional(),
  renewal_count: z.number(),
  // Mirrors the loan serializer's renewal_history exactly. It previously
  // declared a required `date` and an `approved_by` that the serializer never
  // emits, so every loan carrying a renewal failed validation outright and the
  // page rendered "Loan not found". Only new_end_date is genuinely nullable in
  // the column, but the whole row is optional-tolerant here because a loan must
  // stay readable even when a renewal is incomplete.
  renewal_history: z.array(z.object({
    renewal_id: z.string(),
    renewal_number: z.number().nullable().optional(),
    previous_end_date: z.string().nullable().optional(),
    new_end_date: z.string().nullable().optional(),
    approval_date: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  }).passthrough()).nullable().optional(),
  loan_conditions: z.string().nullable().optional(),
  special_requirements: z.string().nullable().optional(),
  insurance_value: z.number().nullable().optional(),
  insurance_currency: z.string().nullable().optional(),
  insurance_policy: z.string().nullable().optional(),
  insurance_provider: z.string().nullable().optional(),
  indemnity: z.boolean(),
  facility_report_sent: z.boolean(),
  facility_report_date: z.string().nullable().optional(),
  facility_report_approved: z.boolean().nullable().optional(),
  shipping_method: z.string().nullable().optional(),
  courier_required: z.boolean().nullable().optional(),
  courier_details: z.string().nullable().optional(),
  crate_required: z.boolean().nullable().optional(),
  condition_report_in_id: z.string().nullable().optional(),
  condition_report_out_id: z.string().nullable().optional(),
  entry_id: z.string().nullable().optional(),
  identifiers: z.array(z.object({
    type: z.string(),
    value: z.string(),
  })).nullable().optional(),
  loan_agreement_reference: z.string().nullable().optional(),
  loan_agreement_date: z.string().nullable().optional(),
  loan_agreement_signed_date: z.string().nullable().optional(),
  // procedure compliance: Lender's Authorization
  lender_authorizer_id: z.string().nullable().optional(),
  lender_authorizer_name: z.string().nullable().optional(),
  lender_authorizer_title: z.string().nullable().optional(),
  lender_authorization_date: z.string().nullable().optional(),
  // procedure compliance: Document Location
  document_location: z.string().nullable().optional(),
  document_location_note: z.string().nullable().optional(),
  // procedure compliance: Loan Contact
  loan_contact_name: z.string().nullable().optional(),
  loan_contact_email: z.string().nullable().optional(),
  loan_contact_phone: z.string().nullable().optional(),
  // Additional fields
  display_requirements: z.string().nullable().optional(),
  photography_restrictions: z.string().nullable().optional(),
  exhibition_venue: z.string().nullable().optional(),
  indemnity_reference: z.string().nullable().optional(),
  facility_report_approved_date: z.string().nullable().optional(),
  facility_report_note: z.string().nullable().optional(),
  shipping_company: z.string().nullable().optional(),
  crate_specifications: z.string().nullable().optional(),
  internal_note: z.string().nullable().optional(),
  max_renewals: z.number().nullable().optional(),
  // Lender contact
  lender_contact_id: z.string().nullable().optional(),
  lender_contact_name: z.string().nullable().optional(),
  // Closing fields
  closing_invoice_sent: z.boolean().nullable().optional(),
  closing_invoice_date: z.string().nullable().optional(),
  closing_invoice_reference: z.string().nullable().optional(),
  closing_invoice_amount: z.number().nullable().optional(),
  closing_invoice_currency: z.string().nullable().optional(),
  receipt_acknowledged: z.boolean().nullable().optional(),
  receipt_acknowledged_date: z.string().nullable().optional(),
  receipt_acknowledged_reference: z.string().nullable().optional(),
  conditions_met_confirmed: z.boolean().nullable().optional(),
  conditions_met_date: z.string().nullable().optional(),
  conditions_met_note: z.string().nullable().optional(),
  closing_note: z.string().nullable().optional(),
  status: z.enum(['requested', 'pending_approval', 'approved', 'agreement_sent', 'agreement_signed', 'in_transit', 'received', 'on_loan', 'return_initiated', 'returned', 'closed', 'cancelled', 'overdue']),
  loan_note: z.string().nullable().optional(),
  department_id: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
  objects: z.array(LoanInObjectSchema).nullable().optional(),
});

export type LoanIn = z.infer<typeof LoanInSchema>;

export const PaginatedLoansInSchema = z.object({
  items: z.array(LoanInSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedLoansIn = z.infer<typeof PaginatedLoansInSchema>;

// Loan Out schema
export const LoanOutObjectSchema = z.object({
  loan_object_id: z.string(),
  loan_out_id: z.string(),
  organization_id: z.string(),
  object_id: z.string(),
  insurance_value: z.number().nullable().optional(),
  insurance_currency: z.string().nullable().optional(),
  display_credit_line: z.string().nullable().optional(),
  display_label: z.string().nullable().optional(),
  display_requirements: z.string().nullable().optional(),
  installation_requirements: z.string().nullable().optional(),
  special_conditions: z.string().nullable().optional(),
  handling_requirements: z.string().nullable().optional(),
  environmental_requirements: z.string().nullable().optional(),
  condition_report_out_id: z.string().nullable().optional(),
  condition_report_out_number: z.string().nullable().optional(),
  condition_report_return_id: z.string().nullable().optional(),
  condition_report_return_number: z.string().nullable().optional(),
  exit_id: z.string().nullable().optional(),
  exit_number: z.string().nullable().optional(),
  photography_restrictions: z.string().nullable().optional(),
  item_status: z.string().nullable().optional(),
  dispatched_date: z.string().nullable().optional(),
  returned_date: z.string().nullable().optional(),
  damage_reported: z.boolean().nullable().optional(),
  damage_note: z.string().nullable().optional(),
  // Per-object required fields
  valuation: z.number().nullable().optional(),
  valuation_currency: z.string().nullable().optional(),
  valuation_date: z.string().nullable().optional(),
  dimensions_note: z.string().nullable().optional(),
  ip_rights_note: z.string().nullable().optional(),
  estimated_costs: z.number().nullable().optional(),
  estimated_costs_currency: z.string().nullable().optional(),
  estimated_costs_note: z.string().nullable().optional(),
  photography_permitted: z.boolean().nullable().optional(),
  reproduction_rights_note: z.string().nullable().optional(),
  object: z.object({
    object_id: z.string(),
    object_number: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    titles: z.array(z.object({
      title: z.string().nullable().optional(),
      title_type: z.string().nullable().optional(),
      language: z.string().nullable().optional(),
      is_preferred: z.boolean().nullable().optional(),
    })).optional(),
    object_name: z.string().nullable().optional(),
    primary_image_url: z.string().nullable().optional(),
  }).optional(),
  created_at: z.string(),
});

export type LoanOutObject = z.infer<typeof LoanOutObjectSchema>;

export const LoanOutSchema = z.object({
  loan_out_id: z.string(),
  organization_id: z.string(),
  loan_number: z.string(),
  borrower_id: z.string().nullable().optional(),
  borrower_name: z.string().nullable().optional(),
  borrower_contact: z.record(z.string(), z.any()).nullable().optional(),
  venue_name: z.string().nullable().optional(),
  venue_address: z.record(z.string(), z.any()).nullable().optional(),
  loan_purpose: z.enum(['exhibition', 'research', 'conservation', 'education', 'photography', 'touring', 'inter_museum', 'other']),
  exhibition_title: z.string().nullable().optional(),
  request_date: z.string().nullable().optional(),
  approval_date: z.string().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  board_approval_date: z.string().nullable().optional(),
  board_approval_reference: z.string().nullable().optional(),
  loan_start_date: z.string().nullable().optional(),
  loan_end_date: z.string().nullable().optional(),
  actual_dispatch_date: z.string().nullable().optional(),
  actual_return_date: z.string().nullable().optional(),
  renewal_count: z.number(),
  // Mirrors the loan serializer's renewal_history exactly. It previously
  // declared a required `date` and an `approved_by` that the serializer never
  // emits, so every loan carrying a renewal failed validation outright and the
  // page rendered "Loan not found". Only new_end_date is genuinely nullable in
  // the column, but the whole row is optional-tolerant here because a loan must
  // stay readable even when a renewal is incomplete.
  renewal_history: z.array(z.object({
    renewal_id: z.string(),
    renewal_number: z.number().nullable().optional(),
    previous_end_date: z.string().nullable().optional(),
    new_end_date: z.string().nullable().optional(),
    approval_date: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  }).passthrough()).nullable().optional(),
  loan_conditions: z.string().nullable().optional(),
  insurance_requirements: z.string().nullable().optional(),
  insurance_value_total: z.number().nullable().optional(),
  insurance_currency: z.string().nullable().optional(),
  insurance_coverage_type: z.enum(['wall_to_wall', 'nail_to_nail', 'borrower_policy', 'lender_policy', 'government_indemnity', 'shared']).nullable().optional(),
  certificate_of_insurance_received: z.boolean(),
  certificate_of_insurance_date: z.string().nullable().optional(),
  facility_report_received: z.boolean(),
  facility_report_date: z.string().nullable().optional(),
  facility_report_approved: z.boolean().nullable().optional(),
  facility_report_approved_by: z.string().nullable().optional(),
  shipping_method: z.string().nullable().optional(),
  courier_required: z.boolean().nullable().optional(),
  courier_out_name: z.string().nullable().optional(),
  courier_return_name: z.string().nullable().optional(),
  crate_specifications: z.string().nullable().optional(),
  condition_report_out_id: z.string().nullable().optional(),
  condition_report_return_id: z.string().nullable().optional(),
  loan_agreement_reference: z.string().nullable().optional(),
  loan_agreement_signed_date: z.string().nullable().optional(),
  status: z.enum(['requested', 'pending_approval', 'approved', 'agreement_sent', 'agreement_signed', 'in_transit', 'on_loan', 'return_scheduled', 'returned', 'closed', 'declined', 'cancelled']),
  loan_note: z.string().nullable().optional(),
  department_id: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
  objects: z.array(LoanOutObjectSchema).nullable().optional(),
}).passthrough();

export type LoanOut = z.infer<typeof LoanOutSchema>;

export const PaginatedLoansOutSchema = z.object({
  items: z.array(LoanOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedLoansOut = z.infer<typeof PaginatedLoansOutSchema>;

// Conservation Treatment schema
export const ConservationTreatmentSchema = z.object({
  treatment_id: z.string(),
  organization_id: z.string(),
  treatment_number: z.string(),
  object_id: z.string().nullable().optional(),
  conservator_id: z.string().nullable().optional(),
  conservator_name: z.string().nullable().optional(),
  conservator_institution: z.string().nullable().optional(),
  treatment_type: z.enum(['preventive', 'remedial', 'restoration', 'analysis', 'other']),
  proposal_date: z.string().nullable().optional(),
  proposal_summary: z.string().nullable().optional(),
  proposal_document_ref: z.string().nullable().optional(),
  estimated_duration_days: z.number().nullable().optional(),
  estimated_cost: z.number().nullable().optional(),
  estimated_cost_currency: z.string().nullable().optional(),
  approval_date: z.string().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  approval_note: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  actual_duration_days: z.number().nullable().optional(),
  actual_cost: z.number().nullable().optional(),
  actual_cost_currency: z.string().nullable().optional(),
  treatment_description: z.string().nullable().optional(),
  materials_used: z.array(z.object({
    material: z.string().nullable().optional(),
    supplier: z.string().nullable().optional(),
    lot_number: z.string().nullable().optional(),
  })).nullable().optional(),
  methods_used: z.string().nullable().optional(),
  condition_before_id: z.string().nullable().optional(),
  condition_after_id: z.string().nullable().optional(),
  before_images: z.array(z.object({
    media_id: z.string(),
    caption: z.string().nullable().optional(),
  })).nullable().optional(),
  after_images: z.array(z.object({
    media_id: z.string(),
    caption: z.string().nullable().optional(),
  })).nullable().optional(),
  documentation_images: z.array(z.object({
    media_id: z.string(),
    caption: z.string().nullable().optional(),
  })).nullable().optional(),
  recommendations: z.string().nullable().optional(),
  restrictions: z.string().nullable().optional(),
  status: z.enum(['proposed', 'approved', 'in_progress', 'completed', 'cancelled']),
  treatment_note: z.string().nullable().optional(),
  department_id: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
  _restricted_fields: z.array(z.string()).optional(),
  // Embedded object summary (when fetching treatment details)
  object: z.object({
    object_id: z.string(),
    object_number: z.string(),
    title: z.string().nullable().optional(),
  }).nullable().optional(),
});

export type ConservationTreatment = z.infer<typeof ConservationTreatmentSchema>;

export const PaginatedConservationTreatmentsSchema = z.object({
  items: z.array(ConservationTreatmentSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedConservationTreatments = z.infer<typeof PaginatedConservationTreatmentsSchema>;

// Object Exit schema
export const ObjectExitItemSchema = z.object({
  exit_item_id: z.string(),
  exit_id: z.string(),
  organization_id: z.string(),
  object_id: z.string().nullable().optional(),
  item_number: z.number().nullable().optional(),
  brief_description: z.string().nullable().optional(),
  condition_note: z.string().nullable().optional(),
  condition_report_id: z.string().nullable().optional(),
  insurance_value: z.number().nullable().optional(),
  insurance_currency: z.string().nullable().optional(),
  item_status: z.enum(['pending', 'preparing', 'dispatched', 'acknowledged', 'cancelled']).nullable().optional(),
  dispatched_date: z.string().nullable().optional(),
  acknowledged_date: z.string().nullable().optional(),
  created_at: z.string(),
});

export type ObjectExitItem = z.infer<typeof ObjectExitItemSchema>;

export const ObjectExitSchema = z.object({
  exit_id: z.string(),
  organization_id: z.string(),
  exit_number: z.string(),
  exit_date: z.string().nullable().optional(),
  entry_id: z.string().nullable().optional(),
  recipient_id: z.string().nullable().optional(),
  recipient_name: z.string().nullable().optional(),
  recipient_address: z.record(z.string(), z.any()).nullable().optional(),
  recipient_contact: z.record(z.string(), z.any()).nullable().optional(),
  exit_reason: z.enum([
    'loan_return', 'loan_out', 'transfer', 'disposal', 'deaccession',
    'conservation', 'photography', 'enquiry_return', 'repatriation',
    'destruction', 'theft_loss', 'other'
  ]),
  reference_type: z.enum(['loan_in', 'loan_out', 'deaccession', 'transfer', 'conservation', 'object_entry']).nullish(),
  reference_id: z.string().nullable().optional(),
  authorization_id: z.string().nullable().optional(),
  authorization_date: z.string().nullable().optional(),
  authorization_note: z.string().nullable().optional(),
  exit_method: z.enum(['courier', 'freight', 'hand_carry', 'pickup', 'registered_mail', 'own_transport']).nullish(),
  packing_method: z.string().nullable().optional(),
  shipping_method: z.string().nullable().optional(),
  shipping_company: z.string().nullable().optional(),
  tracking_number: z.string().nullable().optional(),
  courier_name: z.string().nullable().optional(),
  courier_contact: z.record(z.string(), z.any()).nullable().optional(),
  insurance_value: z.number().nullable().optional(),
  insurance_currency: z.string().nullable().optional(),
  insurance_note: z.string().nullable().optional(),
  condition_at_exit: z.enum(['excellent', 'good', 'fair', 'poor', 'unacceptable']).nullish(),
  condition_report_id: z.string().nullable().optional(),
  receipt_acknowledged: z.boolean(),
  receipt_acknowledged_date: z.string().nullable().optional(),
  receipt_acknowledged_by: z.string().nullable().optional(),
  receipt_reference: z.string().nullable().optional(),
  receipt_note: z.string().nullable().optional(),
  expected_return_date: z.string().nullable().optional(),
  expected_return_method: z.string().nullable().optional(),
  status: z.enum(['pending', 'pending_approval', 'preparing', 'dispatched', 'in_transit', 'acknowledged', 'cancelled']),
  exit_note: z.string().nullable().optional(),
  internal_note: z.string().nullable().optional(),
  department_id: z.string().nullable().optional(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  items: z.array(ObjectExitItemSchema).nullable().optional(),
  // Courier contact FK (for courier-accompanied shipments)
  courier_id: z.string().nullable().optional(),
  _restricted_fields: z.array(z.string()).optional(),
});

export type ObjectExit = z.infer<typeof ObjectExitSchema>;

export const PaginatedObjectExitsSchema = z.object({
  items: z.array(ObjectExitSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedObjectExits = z.infer<typeof PaginatedObjectExitsSchema>;

// Deaccession schema
export const DeaccessionAuditSchema = z.object({
  audit_id: z.string(),
  deaccession_id: z.string(),
  organization_id: z.string(),
  action: z.enum([
    'created', 'status_changed', 'field_updated', 'document_added',
    'committee_reviewed', 'board_approved', 'board_rejected',
    'legal_reviewed', 'provenance_reviewed', 'donor_notified',
    'public_notice_posted', 'sale_completed', 'disposal_completed',
    'exit_linked', 'cancelled', 'comment_added'
  ]),
  field_name: z.string().nullable().optional(),
  old_value: z.string().nullable().optional(),
  new_value: z.string().nullable().optional(),
  performed_by: z.string().nullable().optional(),
  performed_by_name: z.string().nullable().optional(),
  performed_at: z.string(),
  ip_address: z.string().nullable().optional(),
  user_agent: z.string().nullable().optional(),
  session_id: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export type DeaccessionAudit = z.infer<typeof DeaccessionAuditSchema>;

export const DeaccessionSchema = z.object({
  deaccession_id: z.string(),
  organization_id: z.string(),
  deaccession_number: z.string(),
  object_id: z.string(),
  proposal_date: z.string().nullable().optional(),
  proposed_by: z.string().nullable().optional(),
  reason: z.enum([
    'duplicate', 'outside_scope', 'deterioration', 'damage',
    'repatriation', 'theft_loss', 'exchange', 'ethical',
    'donor_request', 'legal_requirement', 'hazard', 'other'
  ]),
  reason_detail: z.string().nullable().optional(),
  justification: z.string().nullable().optional(),
  disposal_method: z.enum([
    'sale', 'gift', 'exchange', 'destruction', 'repatriation',
    'transfer', 'return_to_donor', 'write_off', 'other'
  ]).nullable().optional(),
  disposal_method_detail: z.string().nullable().optional(),
  recipient_id: z.string().nullable().optional(),
  recipient_name: z.string().nullable().optional(),
  recipient_contact: z.record(z.string(), z.any()).nullable().optional(),
  // Committee review
  committee_review_required: z.boolean(),
  committee_review_date: z.string().nullable().optional(),
  committee_members: z.array(z.object({
    member_name: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    vote: z.string().nullable().optional(),
    vote_date: z.string().nullable().optional(),
  })).nullable().optional(),
  committee_recommendation: z.enum(['approve', 'reject', 'defer', 'modify']).nullable().optional(),
  committee_note: z.string().nullable().optional(),
  // Board approval
  board_approval_required: z.boolean(),
  board_approval_date: z.string().nullable().optional(),
  board_approval_reference: z.string().nullable().optional(),
  board_resolution: z.string().nullable().optional(),
  board_note: z.string().nullable().optional(),
  // Legal review
  legal_review_required: z.boolean(),
  legal_review_date: z.string().nullable().optional(),
  legal_review_note: z.string().nullable().optional(),
  legal_cleared: z.boolean().nullable().optional(),
  // Provenance review
  provenance_review_required: z.boolean(),
  provenance_review_complete: z.boolean(),
  provenance_review_date: z.string().nullable().optional(),
  provenance_review_note: z.string().nullable().optional(),
  provenance_issues_found: z.boolean(),
  // Donor restrictions
  donor_restrictions_exist: z.boolean(),
  donor_restrictions_note: z.string().nullable().optional(),
  donor_notified: z.boolean().nullable().optional(),
  donor_notified_date: z.string().nullable().optional(),
  // Valuation
  appraised_value: z.number().nullable().optional(),
  appraised_value_currency: z.string().nullable().optional(),
  appraised_date: z.string().nullable().optional(),
  appraiser_name: z.string().nullable().optional(),
  appraiser_id: z.string().nullable().optional(),
  // Sale details
  sale_method: z.enum(['auction', 'private_sale', 'dealer', 'trade', 'other']).nullable().optional(),
  sale_price: z.number().nullable().optional(),
  sale_currency: z.string().nullable().optional(),
  sale_date: z.string().nullable().optional(),
  sale_reference: z.string().nullable().optional(),
  buyer_name: z.string().nullable().optional(),
  proceeds_usage: z.string().nullable().optional(),
  // Public notice
  public_notice_required: z.boolean(),
  public_notice_date: z.string().nullable().optional(),
  public_notice_publication: z.string().nullable().optional(),
  public_notice_reference: z.string().nullable().optional(),
  public_notice_period_end: z.string().nullable().optional(),
  // Links
  exit_id: z.string().nullable().optional(),
  deaccession_date: z.string().nullable().optional(),
  // Status
  status: z.enum([
    'proposed', 'pending_approval', 'under_review', 'committee_reviewed', 'pending_board',
    'approved', 'in_progress', 'completed', 'cancelled', 'rejected'
  ]),
  completion_date: z.string().nullable().optional(),
  deaccession_note: z.string().nullable().optional(),
  internal_note: z.string().nullable().optional(),
  department_id: z.string().nullable().optional(),
  created_at: z.string(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  _restricted_fields: z.array(z.string()).optional(),
  // Audit trail (optional, included when fetching detail)
  audit_trail: z.array(DeaccessionAuditSchema).nullable().optional(),
});

export type Deaccession = z.infer<typeof DeaccessionSchema>;

export const PaginatedDeaccessionsSchema = z.object({
  items: z.array(DeaccessionSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedDeaccessions = z.infer<typeof PaginatedDeaccessionsSchema>;

// ============================================================================
// OBJECT PROCEDURES SCHEMA (Related procedures for a collection object)
// ============================================================================

// Summary schemas for related procedures (lighter versions for the list)
export const AcquisitionSummarySchema = z.object({
  acquisition_id: z.string(),
  acquisition_number: z.string(),
  acquisition_method: z.string(),
  status: z.string(),
  acquisition_date: z.string().nullable().optional(),
  source_name: z.string().nullable().optional(),
});

export type AcquisitionSummary = z.infer<typeof AcquisitionSummarySchema>;

export const LoanOutSummarySchema = z.object({
  loan_out_id: z.string(),
  loan_number: z.string(),
  borrower_name: z.string().nullable().optional(),
  venue_name: z.string().nullable().optional(),
  status: z.string(),
  loan_start_date: z.string().nullable().optional(),
  loan_end_date: z.string().nullable().optional(),
});

export type LoanOutSummary = z.infer<typeof LoanOutSummarySchema>;

export const LoanInSummarySchema = z.object({
  loan_in_id: z.string(),
  loan_number: z.string(),
  lender_name: z.string().nullable().optional(),
  status: z.string(),
  loan_start_date: z.string().nullable().optional(),
  loan_end_date: z.string().nullable().optional(),
});

export type LoanInSummary = z.infer<typeof LoanInSummarySchema>;

export const ConservationSummarySchema = z.object({
  treatment_id: z.string(),
  treatment_number: z.string(),
  treatment_type: z.string(),
  status: z.string(),
  conservator_name: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
});

export type ConservationSummary = z.infer<typeof ConservationSummarySchema>;

export const ConditionReportSummarySchema = z.object({
  report_id: z.string(),
  report_number: z.string(),
  report_type: z.string(),
  status: z.string(),
  overall_condition: z.string().nullable().optional(),
  report_date: z.string().nullable().optional(),
  examiner_name: z.string().nullable().optional(),
});

export type ConditionReportSummary = z.infer<typeof ConditionReportSummarySchema>;

export const DeaccessionSummarySchema = z.object({
  deaccession_id: z.string(),
  deaccession_number: z.string(),
  reason: z.string(),
  disposal_method: z.string().nullable().optional(),
  status: z.string(),
  deaccession_date: z.string().nullable().optional(),
});

export type DeaccessionSummary = z.infer<typeof DeaccessionSummarySchema>;

export const UseRequestSummarySchema = z.object({
  request_id: z.string(),
  request_number: z.string(),
  use_type: z.string(),
  requester_name: z.string(),
  requester_institution: z.string().nullable().optional(),
  status: z.string(),
  request_date: z.string().nullable().optional(),
});

export type UseRequestSummary = z.infer<typeof UseRequestSummarySchema>;

export const IncidentReportSummarySchema = z.object({
  report_id: z.string(),
  report_number: z.string(),
  incident_type: z.string(),
  incident_date: z.string().nullable().optional(),
  status: z.string(),
  report_date: z.string().nullable().optional(),
});

export type IncidentReportSummary = z.infer<typeof IncidentReportSummarySchema>;

export const ObjectProceduresSchema = z.object({
  object_id: z.string(),
  object_number: z.string(),
  acquisitions: z.array(AcquisitionSummarySchema),
  loans_out: z.array(LoanOutSummarySchema),
  conservation: z.array(ConservationSummarySchema),
  condition_reports: z.array(ConditionReportSummarySchema),
  deaccessions: z.array(DeaccessionSummarySchema),
  use_requests: z.array(UseRequestSummarySchema),
  incident_reports: z.array(IncidentReportSummarySchema),
});

export type ObjectProcedures = z.infer<typeof ObjectProceduresSchema>;

// Object Rights
export const ObjectRightSchema = z.object({
  right_id: z.string(),
  organization_id: z.string(),
  object_id: z.string(),
  // Type
  right_type: z.string(),
  right_subtype: z.string().nullable().optional(),
  // Rights holder - linked to Contact
  rights_holder_contact_id: z.string().nullable().optional(),
  // Status
  status: z.string(),
  // Dates
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  is_perpetual: z.boolean(),
  // Territory
  territory: z.string().nullable().optional(),
  territory_note: z.string().nullable().optional(),
  // License details
  license_type: z.string().nullable().optional(),
  license_reference: z.string().nullable().optional(),
  license_url: z.string().nullable().optional(),
  usage_conditions: z.string().nullable().optional(),
  restrictions: z.string().nullable().optional(),
  // Fees
  fee_required: z.boolean(),
  fee_amount: z.number().nullable().optional(),
  fee_currency: z.string().nullable().optional(),
  fee_note: z.string().nullable().optional(),
  // Orphan works
  is_orphan_work: z.boolean(),
  due_diligence_conducted: z.boolean(),
  due_diligence_date: z.string().nullable().optional(),
  due_diligence_steps: z.any().nullable().optional(), // JSONB
  orphan_works_license_number: z.string().nullable().optional(),
  orphan_works_license_date: z.string().nullable().optional(),
  orphan_works_license_expiry: z.string().nullable().optional(),
  // Permissions granted
  permissions_granted: z.any().nullable().optional(), // JSONB
  // Documentation
  agreement_reference: z.string().nullable().optional(),
  documentation_references: z.any().nullable().optional(), // JSONB
  // Review
  next_review_date: z.string().nullable().optional(),
  last_review_date: z.string().nullable().optional(),
  // Notes
  right_note: z.string().nullable().optional(),
  internal_note: z.string().nullable().optional(),
  // Audit
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  // Joined data
  object_number: z.string().nullable().optional(),
  object_title: z.string().nullable().optional(),
  rights_holder_contact: z.object({
    contact_id: z.string(),
    name: z.string(),
    contact_type: z.string(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    organization_name: z.string().nullable().optional(),
  }).nullable().optional(),
});

export type ObjectRight = z.infer<typeof ObjectRightSchema>;

// ============================================================================
// SECONDARY PROCEDURES SCHEMAS
// ============================================================================

// Emergency Plans
export const EmergencyPlanSchema = z.object({
  plan_id: z.string(),
  organization_id: z.string(),
  plan_number: z.string().nullish(),
  title: z.string(),
  plan_version: z.string().nullish(),
  // Facility
  facility_name: z.string().nullish(),
  facility_address: z.any().nullish(), // JSONB
  covered_locations: z.array(z.string()).nullish(),
  // Risk assessment
  risk_assessments: z.array(z.object({
    hazard_type: z.string().nullable().optional(),
    likelihood: z.string().nullable().optional(),
    impact: z.string().nullable().optional(),
    mitigation_measures: z.string().nullable().optional(),
  })).nullish(),
  // Contacts
  emergency_contacts: z.array(z.object({
    name: z.string(),
    role: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    priority: z.number().nullable().optional(),
  })).nullish(),
  external_services: z.any().nullish(), // JSONB
  // Evacuation
  evacuation_routes: z.array(z.object({
    route_name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    primary: z.boolean().nullable().optional(),
  })).nullish(),
  assembly_points: z.array(z.object({
    name: z.string(),
    location: z.string().nullable().optional(),
    capacity: z.number().nullable().optional(),
  })).nullish(),
  evacuation_procedures: z.string().nullish(),
  // Equipment
  equipment_inventory: z.array(z.object({
    item_name: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    quantity: z.number().nullable().optional(),
    last_checked: z.string().nullable().optional(),
  })).nullish(),
  // Salvage
  salvage_priority_guidance: z.string().nullish(),
  // Procedures
  response_procedures: z.any().nullish(), // JSONB
  recovery_procedures: z.string().nullish(),
  training_requirements: z.string().nullish(),
  // Drills
  last_drill_date: z.string().nullish(),
  next_drill_date: z.string().nullish(),
  // Status
  status: z.string(), // draft, approved, active, inactive
  approved_by: z.string().nullish(),
  approval_date: z.string().nullish(),
  next_review_date: z.string().nullish(),
  plan_note: z.string().nullish(),
  // Audit
  created_at: z.string().nullish(),
  created_by: z.string().nullish(),
  updated_at: z.string().nullish(),
  updated_by: z.string().nullish(),
});

export type EmergencyPlan = z.infer<typeof EmergencyPlanSchema>;

export const PaginatedEmergencyPlansSchema = z.object({
  items: z.array(EmergencyPlanSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedEmergencyPlans = z.infer<typeof PaginatedEmergencyPlansSchema>;

// Incident Reports
export const IncidentReportObjectSchema = z.object({
  incident_object_id: z.string(),
  incident_id: z.string().nullable().optional(),
  organization_id: z.string().nullable().optional(),
  object_id: z.string().nullable().optional(),
  // Joined object details
  object_number: z.string().nullable().optional(),
  object_title: z.string().nullable().optional(),
  damage_description: z.string().nullable().optional(),
  damage_extent: z.string().nullable().optional(), // minor, moderate, severe, total_loss
  condition_before: z.string().nullable().optional(),
  condition_after: z.string().nullable().optional(),
  estimated_loss_value: z.number().nullable().optional(),
  recovered: z.boolean(),
  recovered_date: z.string().nullable().optional(),
  recovery_note: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

export type IncidentReportObject = z.infer<typeof IncidentReportObjectSchema>;

export const IncidentReportSchema = z.object({
  report_id: z.string(),
  organization_id: z.string(),
  report_number: z.string().nullable().optional(),
  report_date: z.string().nullable().optional(),
  // Incident details
  incident_type: z.string().nullable().optional(), // damage, loss, theft, vandalism, environmental, fire, water, pest, other
  incident_subtype: z.string().nullable().optional(),
  incident_date: z.string().nullable().optional(),
  incident_location_id: z.string().nullable().optional(),
  incident_location_description: z.string().nullable().optional(),
  // Discovery
  discovered_date: z.string().nullable().optional(),
  discovered_by_name: z.string().nullable().optional(),
  discovery_circumstances: z.string().nullable().optional(),
  // Description
  incident_description: z.string().nullable().optional(),
  cause_analysis: z.string().nullable().optional(),
  immediate_actions: z.string().nullable().optional(),
  // Police
  police_notified: z.boolean().nullable().optional(),
  police_report_number: z.string().nullable().optional(),
  police_report_date: z.string().nullable().optional(),
  // Insurance
  insurance_claim_filed: z.boolean().nullable().optional(),
  insurance_claim_number: z.string().nullable().optional(),
  insurance_claim_status: z.string().nullable().optional(),
  insurance_claim_amount: z.number().nullable().optional(),
  insurance_settlement_amount: z.number().nullable().optional(),
  // Investigation
  investigation_required: z.boolean().nullable().optional(),
  investigation_findings: z.string().nullable().optional(),
  investigation_completed_date: z.string().nullable().optional(),
  // Resolution
  resolution_summary: z.string().nullable().optional(),
  resolved_date: z.string().nullable().optional(),
  lessons_learned: z.string().nullable().optional(),
  // Status
  status: z.string().nullable().optional(), // draft, submitted, under_investigation, resolved, closed
  // Affected objects (joined)
  affected_objects: z.array(IncidentReportObjectSchema).nullable().optional(),
  // Audit
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type IncidentReport = z.infer<typeof IncidentReportSchema>;

export const PaginatedIncidentReportsSchema = z.object({
  items: z.array(IncidentReportSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedIncidentReports = z.infer<typeof PaginatedIncidentReportsSchema>;

// Collections Reviews
export const ObjectReviewAssessmentSchema = z.object({
  assessment_id: z.string(),
  review_id: z.string(),
  organization_id: z.string(),
  object_id: z.string(),
  // Scores (JSONB)
  scores: z.any().nullable().optional(),
  overall_score: z.number().nullable().optional(),
  // Significance assessments
  historical_significance: z.string().nullable().optional(),
  aesthetic_significance: z.string().nullable().optional(),
  scientific_significance: z.string().nullable().optional(),
  social_significance: z.string().nullable().optional(),
  // Fit assessments
  collection_fit: z.string().nullable().optional(),
  mission_alignment: z.string().nullable().optional(),
  research_value: z.string().nullable().optional(),
  // Needs assessments
  conservation_needs: z.string().nullable().optional(),
  storage_needs: z.string().nullable().optional(),
  documentation_needs: z.string().nullable().optional(),
  // Recommendation
  recommendation: z.string().nullable().optional(), // retain, retain_priority, further_review, deaccession, transfer, conservation, rehouse, document, digitize
  recommendation_rationale: z.string().nullable().optional(),
  priority: z.string().nullable().optional(), // high, medium, low
  // Audit
  assessed_by: z.string().nullable().optional(),
  assessed_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

export type ObjectReviewAssessment = z.infer<typeof ObjectReviewAssessmentSchema>;

export const CollectionsReviewSchema = z.object({
  review_id: z.string(),
  organization_id: z.string(),
  review_number: z.string().nullable().optional(),
  title: z.string(),
  review_type: z.string(), // significance, relevance, care, deaccession, rationalization, thematic, condition, documentation, comprehensive
  // Scope
  scope_description: z.string().nullable().optional(),
  target_collections: z.array(z.string()).nullable().optional(),
  target_locations: z.array(z.string()).nullable().optional(),
  // Methodology
  methodology: z.string().nullable().optional(),
  assessment_criteria: z.any().nullable().optional(), // JSONB
  scoring_guidance: z.string().nullable().optional(),
  // Team
  review_lead_id: z.string().nullable().optional(),
  review_team: z.array(z.string()).nullable().optional(),
  // Dates
  planned_start_date: z.string().nullable().optional(),
  planned_end_date: z.string().nullable().optional(),
  actual_start_date: z.string().nullable().optional(),
  actual_end_date: z.string().nullable().optional(),
  // Progress
  objects_total: z.number(),
  objects_reviewed: z.number(),
  // Results
  findings_summary: z.string().nullable().optional(),
  recommendations: z.string().nullable().optional(),
  follow_up_actions: z.any().nullable().optional(), // JSONB
  // Status
  status: z.string(), // draft, approved, in_progress, completed, cancelled
  approved_by_id: z.string().nullable().optional(),
  approval_date: z.string().nullable().optional(),
  // Audit
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type CollectionsReview = z.infer<typeof CollectionsReviewSchema>;

export const PaginatedCollectionsReviewsSchema = z.object({
  items: z.array(CollectionsReviewSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedCollectionsReviews = z.infer<typeof PaginatedCollectionsReviewsSchema>;

// Audit Campaigns
export const AuditResultSchema = z.object({
  result_id: z.string(),
  campaign_id: z.string(),
  organization_id: z.string(),
  object_id: z.string().nullable().optional(),
  location_id: z.string().nullable().optional(),
  // Verification
  verified: z.boolean(),
  verification_date: z.string().nullable().optional(),
  // Location check
  expected_location_id: z.string().nullable().optional(),
  actual_location_id: z.string().nullable().optional(),
  location_correct: z.boolean().nullable().optional(),
  // Condition check
  expected_condition: z.string().nullable().optional(),
  actual_condition: z.string().nullable().optional(),
  condition_changed: z.boolean().nullable().optional(),
  // Documentation check
  documentation_complete: z.boolean().nullable().optional(),
  security_adequate: z.boolean().nullable().optional(),
  // Result
  result_status: z.string(), // verified, not_found, discrepancy, inaccessible, pending
  discrepancy_type: z.string().nullable().optional(),
  // Follow-up
  follow_up_required: z.boolean(),
  follow_up_action: z.string().nullable().optional(),
  follow_up_completed: z.boolean(),
  // Audit
  audited_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

export type AuditResult = z.infer<typeof AuditResultSchema>;

export const AuditCampaignSchema = z.object({
  audit_id: z.string(),
  organization_id: z.string(),
  audit_number: z.string().nullable().optional(),
  title: z.string(),
  audit_type: z.string(),
  scope: z.string().nullable().optional(),
  methodology: z.string().nullable().optional(),
  sample_method: z.string().nullable().optional(),
  sample_size: z.number().nullable().optional(),
  sample_percentage: z.number().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  items_total: z.number(),
  items_audited: z.number(),
  discrepancies_found: z.number(),
  accuracy_rate: z.number().nullable().optional(),
  findings_summary: z.string().nullable().optional(),
  remedial_actions: z.union([z.string(), z.array(z.any())]).nullable().optional(),
  status: z.string(),
  lead_auditor: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type AuditCampaign = z.infer<typeof AuditCampaignSchema>;

export const PaginatedAuditCampaignsSchema = z.object({
  items: z.array(AuditCampaignSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedAuditCampaigns = z.infer<typeof PaginatedAuditCampaignsSchema>;

// Use Requests
export const UseRequestObjectSchema = z.object({
  request_object_id: z.string(),
  request_id: z.string(),
  object_id: z.string(),
  object_note: z.string().nullable().optional(),
  special_handling: z.string().nullable().optional(),
  // Approval
  approved: z.boolean().nullable().optional(),
  approval_note: z.string().nullable().optional(),
  denial_reason: z.string().nullable().optional(),
  // Fulfillment
  fulfilled: z.boolean().nullable().optional(),
  fulfillment_date: z.string().nullable().optional(),
  fulfillment_note: z.string().nullable().optional(),
  // Audit
  created_at: z.string().nullable().optional(),
  // Joined object data (optional)
  object: z.object({
    object_id: z.string(),
    object_number: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    object_name: z.string().nullable().optional(),
  }).nullable().optional(),
});

export type UseRequestObject = z.infer<typeof UseRequestObjectSchema>;

export const UseRequestSchema = z.object({
  request_id: z.string(),
  organization_id: z.string(),
  request_number: z.string().nullable().optional(),
  request_date: z.string().nullable().optional(),
  // Type
  use_type: z.string(), // research, exhibition, reproduction, education, publication, broadcast, commercial, conservation, loan, digitization, other
  use_subtype: z.string().nullable().optional(),
  use_purpose: z.string().nullable().optional(),
  use_description: z.string().nullable().optional(),
  // Requester
  requester_name: z.string(),
  requester_title: z.string().nullable().optional(),
  requester_institution: z.string().nullable().optional(),
  requester_email: z.string().nullable().optional(),
  requester_phone: z.string().nullable().optional(),
  // Request details
  access_date_start: z.string().nullable().optional(),
  access_date_end: z.string().nullable().optional(),
  location_required: z.string().nullable().optional(),
  project_title: z.string().nullable().optional(),
  project_description: z.string().nullable().optional(),
  project_deadline: z.string().nullable().optional(),
  // Reproduction details
  reproduction_type: z.string().nullable().optional(),
  reproduction_quantity: z.number().nullable().optional(),
  reproduction_format: z.string().nullable().optional(),
  intended_use: z.string().nullable().optional(),
  publication_details: z.string().nullable().optional(),
  credit_line: z.string().nullable().optional(),
  // Exhibition details
  exhibition_title: z.string().nullable().optional(),
  exhibition_venue: z.string().nullable().optional(),
  exhibition_dates: z.any().nullable().optional(), // JSONB array of date objects
  insurance_value: z.number().nullable().optional(),
  // Fees
  fee_quoted: z.number().nullable().optional(),
  fee_paid: z.number(), // Amount paid
  fee_waived: z.boolean(),
  fee_waiver_reason: z.string().nullable().optional(),
  // Status
  status: z.string(), // submitted, under_review, approved, denied, in_progress, completed, cancelled, withdrawn
  reviewed_by_id: z.string().nullable().optional(),
  approved_by_id: z.string().nullable().optional(),
  approval_conditions: z.string().nullable().optional(),
  // Fulfillment
  fulfillment_date: z.string().nullable().optional(),
  // Outcomes
  knowledge_gained: z.string().nullable().optional(),
  publication_reference: z.string().nullable().optional(),
  // Objects (joined)
  objects: z.array(UseRequestObjectSchema).nullable().optional(),
  // Audit
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type UseRequest = z.infer<typeof UseRequestSchema>;

export const PaginatedUseRequestsSchema = z.object({
  items: z.array(UseRequestSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedUseRequests = z.infer<typeof PaginatedUseRequestsSchema>;

// Valuation
export const ValuationSchema = z.object({
  valuation_id: z.string(),
  organization_id: z.string(),
  object_id: z.string().nullable().optional(),
  // Valuation details
  valuation_type: z.string(), // insurance, market, replacement, probate, donation, internal
  valuation_amount: z.number().nullable().optional(),
  valuation_currency: z.string(),
  valuation_date: z.string().nullable().optional(),
  // Source - linked contact or free-text
  valuator_id: z.string().nullable().optional(),
  valuator_name: z.string().nullable().optional(),
  valuator_organization: z.string().nullable().optional(),
  valuator_credentials: z.string().nullable().optional(),
  valuation_method: z.string().nullable().optional(), // comparable_sales, replacement_cost, income_approach, expert_opinion
  // Documentation
  documentation_reference: z.string().nullable().optional(),
  valuation_note: z.string().nullable().optional(),
  // this procedure — formal authorization (returned by serializer)
  authorizer_id: z.string().nullable().optional(),
  authorization_date: z.string().nullable().optional(),
  authorization_note: z.string().nullable().optional(),
  // Validity
  valid_from: z.string().nullable().optional(),
  valid_until: z.string().nullable().optional(),
  is_current: z.boolean(),
  // Audit
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  // Joined data (optional - populated when fetching with object)
  object_number: z.string().nullable().optional(),
  object_title: z.string().nullable().optional(),
  // Linked valuator contact (optional - populated when valuator_id is set)
  valuator: z.object({
    contact_id: z.string(),
    name: z.string(),
    organization_name: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
  }).nullable().optional(),
});

export type Valuation = z.infer<typeof ValuationSchema>;

export const PaginatedValuationsSchema = z.object({
  items: z.array(ValuationSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedValuations = z.infer<typeof PaginatedValuationsSchema>;

// Reproduction Requests
export const ReproductionRequestSchema = z.object({
  reproduction_id: z.string(),
  organization_id: z.string(),
  request_number: z.string(),
  // Link to use request (optional)
  use_request_id: z.string().nullable().optional(),
  object_id: z.string().nullable().optional(),
  // Requester
  requester_name: z.string(),
  requester_institution: z.string().nullable().optional(),
  requester_email: z.string().nullable().optional(),
  requester_phone: z.string().nullable().optional(),
  // Reproduction details
  reproduction_type: z.string(), // photograph, scan, cast, 3d_print, digital_copy, film, video
  reproduction_purpose: z.string().nullable().optional(), // publication, exhibition, research, commercial, educational
  intended_use: z.string().nullable().optional(),
  quantity: z.number().nullable().optional(),
  format_requested: z.string().nullable().optional(),
  dimensions_requested: z.string().nullable().optional(),
  // Rights clearance
  rights_cleared: z.boolean(),
  rights_check_date: z.string().nullable().optional(),
  rights_cleared_by: z.string().nullable().optional(),
  rights_restrictions: z.string().nullable().optional(),
  credit_line_required: z.string().nullable().optional(),
  // Linked rights
  object_right_id: z.string().nullable().optional(),
  // Fees
  fee_type: z.string().nullable().optional(), // flat, per_image, commercial_rate, educational_rate, waived
  fee_amount: z.number().nullable().optional(),
  fee_currency: z.string().nullable().optional(),
  fee_paid: z.boolean(),
  payment_date: z.string().nullable().optional(),
  // Fulfillment
  master_file_reference: z.string().nullable().optional(),
  delivery_method: z.string().nullable().optional(), // download, physical, api
  delivery_date: z.string().nullable().optional(),
  quality_approved: z.boolean().nullable().optional(),
  // Status
  status: z.string(), // submitted, rights_review, approved, denied, in_production, delivered, completed
  // Notes
  notes: z.string().nullable().optional(),
  // Audit
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  // Joined data (optional - populated when fetching with object)
  object_number: z.string().nullable().optional(),
  object_title: z.string().nullable().optional(),
});

export type ReproductionRequest = z.infer<typeof ReproductionRequestSchema>;

export const PaginatedReproductionRequestsSchema = z.object({
  items: z.array(ReproductionRequestSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedReproductionRequests = z.infer<typeof PaginatedReproductionRequestsSchema>;

// ============================================================================
// DOCUMENTATION PLANS SCHEMA
// ============================================================================

export const DocumentationPlanStatusSchema = z.enum([
  'draft', 'approved', 'in_progress', 'completed', 'cancelled'
]);
export type DocumentationPlanStatus = z.infer<typeof DocumentationPlanStatusSchema>;

export const DocumentationPlanTypeSchema = z.enum([
  'documentation_policy', 'cataloging_plan', 'photography_plan',
  'digitisation_plan', 'inventory_plan', 'backlog_plan', 'other'
]);
export type DocumentationPlanType = z.infer<typeof DocumentationPlanTypeSchema>;

export const DocumentationPlanSchema = z.object({
  plan_id: z.string(),
  organization_id: z.string(),
  plan_number: z.string().nullable().optional(),
  title: z.string(),
  plan_type: z.string(),
  objectives: z.string().nullable().optional(),
  measurable_results: z.any().nullable().optional(), // JSON array
  actions: z.any().nullable().optional(), // JSON array
  milestones: z.any().nullable().optional(), // JSON array of {date, description}
  resources_required: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  review_frequency: z.string().nullable().optional(),
  next_review_date: z.string().nullable().optional(),
  status: z.string(),
  approved_by: z.string().nullable().optional(),
  approved_at: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type DocumentationPlan = z.infer<typeof DocumentationPlanSchema>;

export const PaginatedDocumentationPlansSchema = z.object({
  items: z.array(DocumentationPlanSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedDocumentationPlans = z.infer<typeof PaginatedDocumentationPlansSchema>;

// ============================================================================
// REPORT BUILDER SCHEMAS
// ============================================================================

// Report Definition
export const ReportSchema = z.object({
  report_id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  report_type: z.string(), // 'template' | 'custom'
  template_key: z.string().nullable().optional(),
  data_source: z.string().nullable().optional(),
  selected_columns: z.array(z.string()).nullable().optional(),
  sort_config: z.array(z.object({
    field: z.string(),
    direction: z.string(),
  })).nullable().optional(),
  visualization_type: z.string(),
  visualization_config: z.any().nullable().optional(), // JSONB
  is_public: z.boolean(),
  is_favorite: z.boolean().nullable().optional(),
  category: z.string().nullable().optional(),
  domain: z.enum(['collections', 'media', 'bridge']).nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  // Joined data
  schedules: z.array(z.any()).nullable().optional(),
});

export type Report = z.infer<typeof ReportSchema>;

export const PaginatedReportsSchema = z.object({
  reports: z.array(ReportSchema),
  total: z.number(),
  skip: z.number(),
  limit: z.number(),
});

export type PaginatedReports = z.infer<typeof PaginatedReportsSchema>;

// Report Schedule
export const ReportScheduleSchema = z.object({
  schedule_id: z.string(),
  report_id: z.string(),
  schedule_type: z.string(), // 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'cron'
  cron_expression: z.string().nullable().optional(),
  hour: z.number(),
  minute: z.number(),
  timezone: z.string(),
  recipients: z.array(z.string()),
  attachment_format: z.string(), // 'pdf' | 'excel' | 'csv'
  enabled: z.boolean(),
  last_run_at: z.string().nullable().optional(),
  next_run_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

export type ReportSchedule = z.infer<typeof ReportScheduleSchema>;

// Report Run
export const ReportRunSchema = z.object({
  run_id: z.string(),
  report_id: z.string(),
  schedule_id: z.string().nullable().optional(),
  status: z.string(), // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  triggered_by: z.string(), // 'manual' | 'scheduled' | 'api'
  row_count: z.number().nullable().optional(),
  execution_time_ms: z.number().nullable().optional(),
  export_format: z.string().nullable().optional(),
  export_s3_key: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  triggered_by_user_id: z.string().nullable().optional(),
});

export type ReportRun = z.infer<typeof ReportRunSchema>;

export const PaginatedReportRunsSchema = z.object({
  items: z.array(ReportRunSchema),
  total: z.number(),
  skip: z.number(),
  limit: z.number(),
});

export type PaginatedReportRuns = z.infer<typeof PaginatedReportRunsSchema>;

// Report Templates
export const ReportTemplateSchema = z.object({
  template_key: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  data_source: z.string(),
  category: z.string(),
  default_visualization: z.string(),
  visualization_options: z.array(z.string()).nullable().optional(),
  default_columns: z.array(z.string()).nullable().optional(),
  fields: z.array(z.object({
    name: z.string(),
    label: z.string(),
    type: z.string(),
    options: z.array(z.string()).nullable().optional(),
  })).nullable().optional(),
});

export type ReportTemplate = z.infer<typeof ReportTemplateSchema>;

export const ReportTemplatesResponseSchema = z.object({
  templates: z.array(ReportTemplateSchema),
  categories: z.array(z.string()),
});

export type ReportTemplatesResponse = z.infer<typeof ReportTemplatesResponseSchema>;

// Data Source Field
export const DataSourceFieldSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: z.string(),
  options: z.array(z.string()).nullable().optional(),
});

export type DataSourceField = z.infer<typeof DataSourceFieldSchema>;

// Report Execution Result
export const ReportExecutionResultSchema = z.object({
  run_id: z.string(),
  status: z.string(),
  row_count: z.number().nullable().optional(),
  execution_time_ms: z.number().nullable().optional(),
  columns: z.array(z.object({
    field: z.string(),
    label: z.string(),
    type: z.string(),
  })).nullable().optional(),
  data: z.array(z.record(z.string(), z.any())).nullable().optional(),
  error: z.string().nullable().optional(),
});

export type ReportExecutionResult = z.infer<typeof ReportExecutionResultSchema>;

// ============================================================================
// INSURANCE MANAGEMENT
// ============================================================================

// Insurance Policy Types
export const PolicyTypeEnum = z.enum([
  'blanket', 'fine_arts', 'marine', 'exhibition', 'all_risk', 'named_perils'
]);
export type PolicyType = z.infer<typeof PolicyTypeEnum>;

export const PolicyStatusEnum = z.enum([
  'draft', 'pending_approval', 'active', 'expired', 'cancelled', 'renewed'
]);
export type PolicyStatus = z.infer<typeof PolicyStatusEnum>;

export const InsurancePolicySchema = z.object({
  policy_id: z.string(),
  organization_id: z.string(),
  policy_number: z.string(),
  policy_name: z.string().nullable().optional(),
  policy_type: PolicyTypeEnum,
  policy_type_label: z.string(),
  provider_name: z.string().nullable().optional(),
  provider_contact_id: z.string().nullable().optional(),
  broker_name: z.string().nullable().optional(),
  effective_date: z.string().nullable().optional(),
  expiration_date: z.string().nullable().optional(),
  coverage_limit: z.number().nullable().optional(),
  coverage_limit_currency: z.string(),
  per_occurrence_limit: z.number().nullable().optional(),
  deductible: z.number().nullable().optional(),
  annual_premium: z.number().nullable().optional(),
  status: PolicyStatusEnum,
  status_label: z.string(),
  renewal_of_policy_id: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  is_active: z.boolean(),
  is_expired: z.boolean(),
  coverages: z.array(z.any()).nullable().optional(),
  coverage_count: z.number().nullable().optional(),
});

export type InsurancePolicy = z.infer<typeof InsurancePolicySchema>;

// Insurance Coverage Types
export const CoveredEntityTypeEnum = z.enum([
  'collection_object', 'loan_in', 'loan_out', 'shipment',
  'exhibition', 'movement', 'object_entry', 'object_exit'
]);
export type CoveredEntityType = z.infer<typeof CoveredEntityTypeEnum>;

export const CoverageStatusEnum = z.enum([
  'pending', 'confirmed', 'certificate_issued', 'expired', 'cancelled', 'claimed'
]);
export type CoverageStatus = z.infer<typeof CoverageStatusEnum>;

export const InsuranceCoverageSchema = z.object({
  coverage_id: z.string(),
  organization_id: z.string(),
  policy_id: z.string().nullable().optional(),
  covered_entity_type: CoveredEntityTypeEnum,
  covered_entity_type_label: z.string(),
  covered_entity_id: z.string(),
  coverage_start_date: z.string().nullable().optional(),
  coverage_end_date: z.string().nullable().optional(),
  declared_value: z.number().nullable().optional(),
  agreed_value: z.number().nullable().optional(),
  value_currency: z.string(),
  third_party_provider: z.string().nullable().optional(),
  third_party_policy_number: z.string().nullable().optional(),
  certificate_requested: z.boolean(),
  certificate_received: z.boolean(),
  certificate_received_date: z.string().nullable().optional(),
  certificate_number: z.string().nullable().optional(),
  status: CoverageStatusEnum,
  status_label: z.string(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  is_third_party: z.boolean(),
  has_certificate: z.boolean(),
  policy: z.object({
    policy_id: z.string(),
    policy_number: z.string(),
    policy_name: z.string().nullable().optional(),
    provider_name: z.string().nullable().optional(),
  }).nullable().optional(),
  covered_entity: z.object({
    reference: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    url_path: z.string().nullable().optional(),
  }).nullable().optional(),
});

export type InsuranceCoverage = z.infer<typeof InsuranceCoverageSchema>;

// Indemnity Types
export const IndemnityProgramEnum = z.enum([
  'us_arts', 'uk_gis', 'canada_special', 'eu_national', 'australia_indemnity', 'other'
]);
export type IndemnityProgram = z.infer<typeof IndemnityProgramEnum>;

export const IndemnityStatusEnum = z.enum([
  'draft', 'submitted', 'under_review', 'approved', 'rejected', 'active', 'expired'
]);
export type IndemnityStatus = z.infer<typeof IndemnityStatusEnum>;

export const IndemnityObjectSchema = z.object({
  link_id: z.string(),
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  object_title: z.string().nullable().optional(),
  declared_value: z.number().nullable().optional(),
  approved_value: z.number().nullable().optional(),
  value_currency: z.string(),
});

export type IndemnityObject = z.infer<typeof IndemnityObjectSchema>;

export const IndemnityArrangementSchema = z.object({
  indemnity_id: z.string(),
  organization_id: z.string(),
  program: IndemnityProgramEnum,
  program_label: z.string(),
  reference_number: z.string().nullable().optional(),
  internal_reference: z.string().nullable().optional(),
  exhibition_id: z.string().nullable().optional(),
  loan_in_id: z.string().nullable().optional(),
  application_date: z.string().nullable().optional(),
  requested_coverage: z.number().nullable().optional(),
  awarded_coverage: z.number().nullable().optional(),
  coverage_currency: z.string(),
  coverage_start_date: z.string().nullable().optional(),
  coverage_end_date: z.string().nullable().optional(),
  commercial_gap_required: z.boolean(),
  gap_coverage_id: z.string().nullable().optional(),
  status: IndemnityStatusEnum,
  status_label: z.string(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  // List endpoint omits per-object aggregates (returns null); detail populates them.
  // Accept null/undefined and coerce to the empty defaults so both shapes validate.
  objects: z.array(IndemnityObjectSchema).nullish().transform((v) => v ?? []),
  object_count: z.number().nullish().transform((v) => v ?? 0),
  total_declared_value: z.number().nullish().transform((v) => v ?? 0),
  total_approved_value: z.number().nullish().transform((v) => v ?? 0),
});

export type IndemnityArrangement = z.infer<typeof IndemnityArrangementSchema>;

// Insurance Claims Types
export const LossTypeEnum = z.enum([
  'damage', 'theft', 'loss', 'destruction', 'vandalism'
]);
export type LossType = z.infer<typeof LossTypeEnum>;

export const ClaimStatusEnum = z.enum([
  'draft', 'filed', 'under_investigation', 'approved', 'denied', 'settled', 'closed'
]);
export type ClaimStatus = z.infer<typeof ClaimStatusEnum>;

export const InsuranceClaimSchema = z.object({
  claim_id: z.string(),
  organization_id: z.string(),
  claim_number: z.string().nullable().optional(),
  insurer_claim_number: z.string().nullable().optional(),
  coverage_id: z.string().nullable().optional(),
  indemnity_id: z.string().nullable().optional(),
  incident_report_id: z.string().nullable().optional(),
  date_of_loss: z.string().nullable().optional(),
  loss_description: z.string().nullable().optional(),
  loss_type: LossTypeEnum.nullable().optional(),
  loss_type_label: z.string().nullable().optional(),
  claimed_amount: z.number().nullable().optional(),
  settlement_amount: z.number().nullable().optional(),
  amount_currency: z.string(),
  adjuster_name: z.string().nullable().optional(),
  adjuster_contact: z.string().nullable().optional(),
  status: ClaimStatusEnum,
  status_label: z.string(),
  filed_date: z.string().nullable().optional(),
  settled_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type InsuranceClaim = z.infer<typeof InsuranceClaimSchema>;

// Insurance Enums Schema (for dropdowns)
export const InsuranceEnumsSchema = z.object({
  policy_types: z.array(z.object({ value: z.string(), label: z.string() })),
  policy_statuses: z.array(z.object({ value: z.string(), label: z.string() })),
  covered_entity_types: z.array(z.object({ value: z.string(), label: z.string() })),
  coverage_statuses: z.array(z.object({ value: z.string(), label: z.string() })),
  indemnity_programs: z.array(z.object({ value: z.string(), label: z.string() })),
  indemnity_statuses: z.array(z.object({ value: z.string(), label: z.string() })),
  loss_types: z.array(z.object({ value: z.string(), label: z.string() })),
  claim_statuses: z.array(z.object({ value: z.string(), label: z.string() })),
});

export type InsuranceEnums = z.infer<typeof InsuranceEnumsSchema>;

// List Response Schemas
export const InsurancePoliciesListSchema = z.object({
  items: z.array(InsurancePolicySchema),
  total: z.number(),
});

export type InsurancePoliciesList = z.infer<typeof InsurancePoliciesListSchema>;

export const InsuranceCoveragesListSchema = z.object({
  coverages: z.array(InsuranceCoverageSchema),
  total: z.number(),
});

export type InsuranceCoveragesList = z.infer<typeof InsuranceCoveragesListSchema>;

export const IndemnityArrangementsListSchema = z.object({
  indemnities: z.array(IndemnityArrangementSchema),
  total: z.number(),
});

export type IndemnityArrangementsList = z.infer<typeof IndemnityArrangementsListSchema>;

export const InsuranceClaimsListSchema = z.object({
  claims: z.array(InsuranceClaimSchema),
  total: z.number(),
});

export type InsuranceClaimsList = z.infer<typeof InsuranceClaimsListSchema>;

// ============================================================================
// COLLECTION OBJECT MEDIA SCHEMA
// ============================================================================

export const CollectionObjectMediaSchema = z.object({
  object_id: z.string(),
  media_id: z.string(),
  is_primary: z.boolean(),
  sort_order: z.number(),
  caption_override: z.string().nullable().optional(),
  usage_type: z.string().nullable().optional(),
  created_at: z.string(),
  media: MediaSchema.nullable().optional(),
});

export type CollectionObjectMedia = z.infer<typeof CollectionObjectMediaSchema>;

export const CollectionObjectMediaListSchema = z.object({
  media: z.array(CollectionObjectMediaSchema),
  total: z.number(),
});

export type CollectionObjectMediaList = z.infer<typeof CollectionObjectMediaListSchema>;

// ============================================================================
// EXHIBIT SCHEMAS
// ============================================================================

export const ExhibitionPlacementSchema = z.object({
  placement_id: z.string(),
  floor_plan_id: z.string(),
  floor_plan_name: z.string().nullable().optional(),
  display_title: z.string().nullable().optional(),
  display_artist: z.string().nullable().optional(),
}).passthrough();

export const ExhibitionStatusHistorySchema = z.object({
  status: z.string(),
  status_date: z.string().nullable().optional(),
  changed_by: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
}).passthrough();

export const ExhibitionSchema = z.object({
  exhibition_id: z.string(),
  // Nullable in the database, and `str | None` in the API response model —
  // only this hand-maintained schema insisted on a string. An exhibition
  // saved without a number failed Zod validation in the client, which
  // stayed invisible for as long as no exhibition existed to return.
  exhibition_number: z.string().nullable().optional(),
  title: z.string(),
  description: z.string().nullable().optional(),
  curator_notes: z.string().nullable().optional(),
  exhibition_type: z.string(),
  status: z.string(),
  organizer_id: z.string().nullable().optional(),
  authorizer_id: z.string().nullable().optional(),
  authorization_date: z.string().nullable().optional(),
  provisos: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
  venue_id: z.string().nullable().optional(),
  venue_name: z.string().nullable().optional(),
  planned_start_date: z.string().nullable().optional(),
  planned_end_date: z.string().nullable().optional(),
  actual_start_date: z.string().nullable().optional(),
  actual_end_date: z.string().nullable().optional(),
  is_public: z.boolean(),
  public_url_slug: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  placement_count: z.number().nullable().optional(),
  placements: z.array(ExhibitionPlacementSchema).nullable().optional(),
  status_history: z.array(ExhibitionStatusHistorySchema).nullable().optional(),
}).passthrough();

export const ExhibitionsResponseSchema = z.object({
  exhibitions: z.array(ExhibitionSchema),
  total: z.number().nullable().optional(),
}).passthrough();

export const CreateExhibitionResponseSchema = z.object({
  exhibition_id: z.string(),
  title: z.string(),
  message: z.string(),
}).passthrough();

export const ExhibitionObjectSchema = z.object({
  exhibition_object_id: z.string(),
  object_id: z.string().nullable().optional(),
  entity_key: z.string().nullable().optional(),
  source_type: z.string().nullable().optional(),
  object_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  creator: z.string().nullable().optional(),
  date_created: z.string().nullable().optional(),
  primary_image_url: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
  section: z.string().nullable().optional(),
  object_status: z.string(),
  confirmed_date: z.string().nullable().optional(),
  loan_in_id: z.string().nullable().optional(),
  credit_line_override: z.string().nullable().optional(),
  special_requirements: z.string().nullable().optional(),
  installation_notes: z.string().nullable().optional(),
  condition_in_report_id: z.string().nullable().optional(),
  condition_out_report_id: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export const ExhibitionObjectsResponseSchema = z.object({
  exhibition_objects: z.array(ExhibitionObjectSchema),
}).passthrough();

export const AddExhibitionObjectResponseSchema = z.object({
  exhibition_object_id: z.string(),
  message: z.string(),
}).passthrough();

export const UpdateExhibitionObjectResponseSchema = z.object({
  exhibition_object_id: z.string(),
  message: z.string(),
}).passthrough();

export const BatchAddExhibitionObjectsResponseSchema = z.object({
  added: z.array(z.string()),
  skipped: z.array(z.string()),
  message: z.string(),
}).passthrough();

export const SearchExhibitExhibitionsResponseSchema = z.object({
  exhibitions: z.array(z.object({
    exhibition_id: z.string(),
    title: z.string(),
    // Same drift as ExhibitionSchema; lib/api/exhibit.ts already types this
    // `string | null`. Nullable but not optional: the response model gives
    // the field a None default, so the key is always serialised.
    exhibition_number: z.string().nullable(),
  }).passthrough()),
}).passthrough();

export const LabelTemplateFieldSchema = z.object({
  name: z.string(),
  source: z.string(),
  format: z.string().nullable().optional(),
}).passthrough();

export const LabelTemplateFieldsSchema = z.object({
  fields: z.array(LabelTemplateFieldSchema),
  layout: z.string().nullable().optional(),
  alignment: z.string().nullable().optional(),
}).passthrough();

export const LabelTemplateSchema = z.object({
  template_id: z.string(),
  name: z.string(),
  label_type: z.string(),
  template_fields: LabelTemplateFieldsSchema,
  font_family: z.string(),
  font_size_pt: z.number(),
  width_cm: z.number().nullable().optional(),
  height_cm: z.number().nullable().optional(),
  is_default: z.boolean(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export const LabelTemplatesResponseSchema = z.object({
  label_templates: z.array(LabelTemplateSchema),
}).passthrough();

export const CreateLabelTemplateResponseSchema = z.object({
  template_id: z.string(),
  name: z.string(),
  message: z.string(),
}).passthrough();

export const UpdateLabelTemplateResponseSchema = z.object({
  template_id: z.string(),
  message: z.string(),
}).passthrough();

export const ExhibitionLabelSchema = z.object({
  label_id: z.string(),
  exhibition_object_id: z.string().nullable().optional(),
  template_id: z.string().nullable().optional(),
  label_type: z.string(),
  generated_text: z.string(),
  custom_text: z.string().nullable().optional(),
  display_text: z.string(),
  status: z.string(),
  reviewed_by: z.string().nullable().optional(),
  reviewed_at: z.string().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  approved_at: z.string().nullable().optional(),
  last_printed_at: z.string().nullable().optional(),
  print_count: z.number(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export const ExhibitionLabelsResponseSchema = z.object({
  labels: z.array(ExhibitionLabelSchema).default([]),
}).passthrough();

export const GenerateExhibitionLabelsResponseSchema = z.object({
  generated_count: z.number(),
  exhibition_object_ids: z.array(z.string()),
  message: z.string(),
}).passthrough();

export const ApproveExhibitionLabelResponseSchema = z.object({
  label_id: z.string(),
  status: z.string(),
  message: z.string(),
}).passthrough();

export const FrameStyleSchema = z.object({
  frame_style_id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  profile_type: z.string(),
  default_width_cm: z.number(),
  default_depth_cm: z.number(),
  color: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  preview_image_url: z.string().nullable().optional(),
  is_system: z.boolean(),
}).passthrough();

export const FrameStylesResponseSchema = z.object({
  frame_styles: z.array(FrameStyleSchema),
}).passthrough();

export const CreateFrameStyleResponseSchema = z.object({
  frame_style_id: z.string(),
  message: z.string(),
}).passthrough();

export const UpdateFrameStyleResponseSchema = z.object({
  frame_style_id: z.string(),
  message: z.string(),
}).passthrough();

export const MountConfigSchema = z.object({
  mount_config_id: z.string(),
  name: z.string(),
  mount_type: z.string(),
  config: z.record(z.string(), z.unknown()),
  preview_image_url: z.string().nullable().optional(),
  is_system: z.boolean(),
}).passthrough();

export const MountConfigsResponseSchema = z.object({
  mount_configs: z.array(MountConfigSchema),
}).passthrough();

export const CreateMountConfigResponseSchema = z.object({
  mount_config_id: z.string(),
  message: z.string(),
}).passthrough();

export const UpdateMountConfigResponseSchema = z.object({
  mount_config_id: z.string(),
  message: z.string(),
}).passthrough();

export const ExhibitionContentBlockSchema = z.object({
  block_id: z.string(),
  block_type: z.string(),
  section: z.string().nullable().optional(),
  display_order: z.number(),
  title: z.string().nullable().optional(),
  content: z.string(),
  content_format: z.string(),
  media_id: z.string().nullable().optional(),
  media_caption: z.string().nullable().optional(),
  status: z.string(),
  is_public: z.boolean(),
  related_object_ids: z.array(z.string()).nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export const ExhibitionContentBlocksResponseSchema = z.object({
  content_blocks: z.array(ExhibitionContentBlockSchema),
}).passthrough();

export const CreateContentBlockResponseSchema = z.object({
  block_id: z.string(),
  message: z.string(),
}).passthrough();

export const UpdateContentBlockResponseSchema = z.object({
  block_id: z.string(),
  message: z.string(),
}).passthrough();

export const ReorderContentBlocksResponseSchema = z.object({
  message: z.string(),
}).passthrough();

export const ExhibitionVenueSchema = z.object({
  exhibition_venue_id: z.string(),
  venue_id: z.string().nullable().optional(),
  venue_name: z.string().nullable().optional(),
  external_venue_name: z.string().nullable().optional(),
  external_venue_address: z.string().nullable().optional(),
  contact_id: z.string().nullable().optional(),
  tour_order: z.number(),
  planned_start_date: z.string().nullable().optional(),
  planned_end_date: z.string().nullable().optional(),
  actual_start_date: z.string().nullable().optional(),
  actual_end_date: z.string().nullable().optional(),
  status: z.string(),
  loan_agreement_id: z.string().nullable().optional(),
  fee_amount: z.number().nullable().optional(),
  fee_currency: z.string().nullable().optional(),
  special_requirements: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export const ExhibitionVenuesResponseSchema = z.object({
  exhibition_venues: z.array(ExhibitionVenueSchema),
}).passthrough();

export const CreateExhibitionVenueResponseSchema = z.object({
  exhibition_venue_id: z.string(),
  message: z.string(),
}).passthrough();

export const UpdateExhibitionVenueResponseSchema = z.object({
  exhibition_venue_id: z.string(),
  message: z.string(),
}).passthrough();

export const PublicExhibitionSchema = z.object({
  exhibition_id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  exhibition_type: z.string(),
  status: z.string(),
  venue_name: z.string().nullable().optional(),
  planned_start_date: z.string().nullable().optional(),
  planned_end_date: z.string().nullable().optional(),
  actual_start_date: z.string().nullable().optional(),
  actual_end_date: z.string().nullable().optional(),
  public_url_slug: z.string(),
}).passthrough();

export const PublicExhibitionObjectSchema = z.object({
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  creator: z.string().nullable().optional(),
  date_created: z.string().nullable().optional(),
  medium: z.string().nullable().optional(),
  dimensions: z.string().nullable().optional(),
  credit_line: z.string().nullable().optional(),
  primary_image_url: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
  display_order: z.number(),
}).passthrough();

export const PublicExhibitionObjectsResponseSchema = z.object({
  objects: z.array(PublicExhibitionObjectSchema),
  total: z.number(),
  page: z.number(),
  per_page: z.number(),
  has_more: z.boolean(),
}).passthrough();

export const PublicExhibitionContentResponseSchema = z.object({
  content_blocks: z.array(ExhibitionContentBlockSchema),
}).passthrough();
