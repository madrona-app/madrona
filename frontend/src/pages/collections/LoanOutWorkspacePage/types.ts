import type { LucideIcon } from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FormData {
  borrower_id: string;
  borrower_contact_id: string;
  borrower_status: string;
  venue_name: string;
  venue_street: string;
  venue_city: string;
  venue_state: string;
  venue_postal_code: string;
  venue_country: string;
  loan_purpose: string;
  exhibition_title: string;
  request_date: string;
  loan_start_date: string;
  loan_end_date: string;
  loan_conditions: string;
  special_conditions: string;
  insurance_requirements: string;
  insurance_value_total: string;
  insurance_currency: string;
  insurance_coverage_type: string;
  certificate_of_insurance_received: boolean;
  certificate_of_insurance_date: string;
  facility_report_received: boolean;
  facility_report_date: string;
  facility_report_approved: boolean;
  security_conditions_confirmed: boolean;
  loan_agreement_reference: string;
  loan_agreement_signed_date: string;
  document_location: string;
  photography_permitted: boolean | null;
  photography_conditions: string;
  reproduction_rights_note: string;
  loan_note: string;
  authorizer_id: string;
  authorization_date: string;
  authorization_note: string;
  closing_invoice_sent: boolean;
  closing_invoice_date: string;
  closing_invoice_reference: string;
  closing_invoice_amount: string;
  closing_invoice_currency: string;
  receipt_acknowledged: boolean;
  receipt_acknowledged_date: string;
  receipt_acknowledged_reference: string;
  conditions_met_confirmed: boolean;
  conditions_met_date: string;
  conditions_met_note: string;
  closing_note: string;
}

export interface StatusConfig {
  label: string;
  color: string;
  icon: LucideIcon;
}

export interface WorkflowStep {
  key: string;
  label: string;
}

export interface SelectOption {
  value: string;
  label: string;
}

// Contact type returned from API
export interface Contact {
  contact_id: string;
  name: string;
  organization_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

// Loan object type from API (matches _serialize_loan_out_object with include_object=True)
export interface LoanObject {
  loan_object_id: string;
  loan_out_id: string;
  organization_id: string;
  object_id: string;
  insurance_value?: number | null;
  insurance_currency?: string | null;
  display_credit_line?: string | null;
  display_label?: string | null;
  display_requirements?: string | null;
  installation_requirements?: string | null;
  special_conditions?: string | null;
  handling_requirements?: string | null;
  environmental_requirements?: string | null;
  condition_report_out_id?: string | null;
  condition_report_out_number?: string | null;
  condition_report_return_id?: string | null;
  condition_report_return_number?: string | null;
  exit_id?: string | null;
  exit_number?: string | null;
  photography_restrictions?: string | null;
  item_status?: string | null;
  dispatched_date?: string | null;
  returned_date?: string | null;
  damage_reported?: boolean | null;
  damage_note?: string | null;
  // Per-object required fields
  valuation?: number | null;
  valuation_currency?: string | null;
  valuation_date?: string | null;
  dimensions_note?: string | null;
  ip_rights_note?: string | null;
  estimated_costs?: number | null;
  estimated_costs_currency?: string | null;
  estimated_costs_note?: string | null;
  photography_permitted?: boolean | null;
  reproduction_rights_note?: string | null;
  // Nested object summary (when include_object=True)
  object?: {
    object_id: string;
    object_number?: string | null;
    title?: string | null;
    object_name?: string | null;
    primary_image_url?: string | null;
  };
  created_at?: string;
}

// Existing loan type from API
export interface ExistingLoan {
  loan_out_id: string;
  loan_number?: string | null;
  borrower_id?: string | null;
  borrower_name?: string | null;
  borrower_status?: string | null;
  venue_name?: string | null;
  venue_address?: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
  loan_purpose?: string | null;
  exhibition_title?: string | null;
  request_date?: string | null;
  loan_start_date?: string | null;
  loan_end_date?: string | null;
  loan_conditions?: string | null;
  special_conditions?: string | null;
  insurance_requirements?: string | null;
  insurance_value_total?: number | null;
  insurance_currency?: string | null;
  insurance_coverage_type?: string | null;
  certificate_of_insurance_received?: boolean | null;
  certificate_of_insurance_date?: string | null;
  facility_report_received?: boolean | null;
  facility_report_date?: string | null;
  facility_report_approved?: boolean | null;
  security_conditions_confirmed?: boolean | null;
  shipping_method?: string | null;
  courier_required?: boolean | null;
  courier_out_id?: string | null;
  courier_return_id?: string | null;
  crate_specifications?: string | null;
  loan_agreement_reference?: string | null;
  loan_agreement_signed_date?: string | null;
  document_location?: string | null;
  borrower_contact_id?: string | null;
  borrower_contact_name?: string | null;
  photography_permitted?: boolean | null;
  photography_conditions?: string | null;
  reproduction_rights_note?: string | null;
  loan_note?: string | null;
  authorizer_id?: string | null;

  authorization_date?: string | null;
  authorization_note?: string | null;
  closing_invoice_sent?: boolean | null;
  closing_invoice_date?: string | null;
  closing_invoice_reference?: string | null;
  closing_invoice_amount?: number | null;
  closing_invoice_currency?: string | null;
  receipt_acknowledged?: boolean | null;
  receipt_acknowledged_date?: string | null;
  receipt_acknowledged_reference?: string | null;
  conditions_met_confirmed?: boolean | null;
  conditions_met_date?: string | null;
  conditions_met_note?: string | null;
  closing_note?: string | null;
  status?: string | null;
  actual_dispatch_date?: string | null;
  actual_return_date?: string | null;
  renewal_count?: number | null;
  max_renewals?: number | null;
  objects?: LoanObject[];
  created_at: string;
  updated_at?: string | null;
  [key: string]: unknown;
}

// Dialog states for status advancement
export interface StatusAdvancementDialogState {
  isOpen: boolean;
  targetStatus: string;
  targetStatusLabel: string;
}

export interface ExceptionDialogState {
  isOpen: boolean;
  targetStatus: string;
  targetStatusLabel: string;
  blockingRequirements: import('../../../lib/procedureComplianceUtils').RequirementResult[];
}
