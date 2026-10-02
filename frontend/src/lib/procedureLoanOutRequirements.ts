/**
 * Loan Out Requirements Configuration
 *
 * Full compliance with the collections standard "Loans out (lending objects)" procedure.
 * Requirements are mapped to statuses — blocking requirements prevent
 * status transitions, recommended requirements show warnings.
 */

import type { RequirementGroup } from './procedureComplianceUtils';
import { computeProcedureCompliance, canTransitionToProcedure } from './procedureComplianceUtils';

export type LoanOutStatus =
  | 'requested'
  | 'pending_approval'
  | 'approved'
  | 'agreement_sent'
  | 'agreement_signed'
  | 'in_transit'
  | 'on_loan'
  | 'return_scheduled'
  | 'returned'
  | 'closed'
  | 'declined'
  | 'cancelled';

const STATUS_ORDER: LoanOutStatus[] = [
  'requested',
  'pending_approval',
  'approved',
  'agreement_sent',
  'agreement_signed',
  'in_transit',
  'on_loan',
  'return_scheduled',
  'returned',
  'closed',
  'declined',
  'cancelled',
];

export const LOAN_OUT_REQUIREMENT_GROUPS: RequirementGroup[] = [
  {
    id: 'borrower',
    label: 'Borrower',
    sectionId: 'borrower',
    requirements: [
      {
        id: 'borrower_id',
        label: 'Borrower',
        groupId: 'borrower',
        fieldPaths: ['borrower_id'],
        requiredForStatuses: ['approved', 'agreement_sent', 'agreement_signed', 'in_transit', 'on_loan', 'return_scheduled', 'returned', 'closed'],
        severity: 'blocking',
        helpText: 'The institution or individual borrowing the objects.',
      },
      {
        id: 'borrower_contact_id',
        label: 'Borrower contact person',
        groupId: 'borrower',
        fieldPaths: ['borrower_contact_id'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'The contact person at the borrowing institution.',
      },
    ],
  },
  {
    id: 'details',
    label: 'Loan Details',
    sectionId: 'details',
    requirements: [
      {
        id: 'loan_purpose',
        label: 'Loan purpose',
        groupId: 'details',
        fieldPaths: ['loan_purpose'],
        requiredForStatuses: ['approved', 'agreement_sent', 'agreement_signed', 'in_transit', 'on_loan', 'return_scheduled', 'returned', 'closed'],
        severity: 'blocking',
        helpText: 'The reason for the loan (exhibition, research, etc.).',
      },
      {
        id: 'exhibition_title',
        label: 'Exhibition title',
        groupId: 'details',
        fieldPaths: ['exhibition_title'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'Title of the exhibition or project for which objects are lent.',
      },
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    sectionId: 'objects',
    requirements: [
      {
        id: 'objects',
        label: 'Loan objects',
        groupId: 'objects',
        fieldPaths: ['objects'],
        requiredForStatuses: ['approved', 'agreement_sent', 'agreement_signed', 'in_transit', 'on_loan', 'return_scheduled', 'returned', 'closed'],
        severity: 'blocking',
        helpText: 'At least one object must be added to the loan.',
      },
    ],
  },
  {
    id: 'authorization',
    label: 'Authorization',
    sectionId: 'authorization',
    requirements: [
      {
        id: 'authorizer_id',
        label: 'Authorizer',
        groupId: 'authorization',
        fieldPaths: ['authorizer_id'],
        requiredForStatuses: ['agreement_sent', 'agreement_signed', 'in_transit', 'on_loan', 'return_scheduled', 'returned', 'closed'],
        severity: 'blocking',
        helpText: 'The person who authorized the loan.',
      },
      {
        id: 'authorization_date',
        label: 'Authorization date',
        groupId: 'authorization',
        fieldPaths: ['authorization_date'],
        requiredForStatuses: ['agreement_sent', 'agreement_signed', 'in_transit', 'on_loan', 'return_scheduled', 'returned', 'closed'],
        severity: 'blocking',
        helpText: 'The date the loan was authorized.',
      },
    ],
  },
  {
    id: 'dates',
    label: 'Key Dates',
    sectionId: 'dates',
    requirements: [
      {
        id: 'loan_start_date',
        label: 'Loan start date',
        groupId: 'dates',
        fieldPaths: ['loan_start_date'],
        requiredForStatuses: ['in_transit', 'on_loan', 'return_scheduled', 'returned', 'closed'],
        severity: 'blocking',
        helpText: 'The agreed start date for the loan period.',
      },
      {
        id: 'loan_end_date',
        label: 'Loan end date',
        groupId: 'dates',
        fieldPaths: ['loan_end_date'],
        requiredForStatuses: ['in_transit', 'on_loan', 'return_scheduled', 'returned', 'closed'],
        severity: 'blocking',
        helpText: 'The agreed end date for the loan period.',
      },
    ],
  },
  {
    id: 'insurance',
    label: 'Insurance',
    sectionId: 'insurance',
    requirements: [
      {
        id: 'insurance_value_total',
        label: 'Insurance value',
        groupId: 'insurance',
        fieldPaths: ['insurance_value_total'],
        requiredForStatuses: ['in_transit', 'on_loan', 'return_scheduled', 'returned', 'closed'],
        severity: 'blocking',
        helpText: 'Total insurance value for all loaned objects.',
      },
      {
        id: 'certificate_of_insurance_received',
        label: 'Certificate of insurance',
        groupId: 'insurance',
        fieldPaths: ['certificate_of_insurance_received'],
        requiredForStatuses: ['in_transit'],
        severity: 'recommended',
        helpText: 'Confirmation that a certificate of insurance has been received from the borrower.',
      },
    ],
  },
  {
    id: 'facility',
    label: 'Facility Report',
    sectionId: 'facility',
    requirements: [
      {
        id: 'condition_report_out_id',
        label: 'Outbound condition report',
        groupId: 'facility',
        fieldPaths: ['condition_report_out_id'],
        requiredForStatuses: ['in_transit'],
        severity: 'recommended',
        helpText: 'Condition check with images before objects leave the building.',
      },
      {
        id: 'facility_report_received',
        label: 'Facility report',
        groupId: 'facility',
        fieldPaths: ['facility_report_received'],
        requiredForStatuses: ['in_transit'],
        severity: 'recommended',
        helpText: 'Confirmation that a facility report has been received and reviewed.',
      },
      {
        id: 'security_conditions_confirmed',
        label: 'Security conditions confirmed',
        groupId: 'facility',
        fieldPaths: ['security_conditions_confirmed'],
        requiredForStatuses: ['in_transit'],
        severity: 'recommended',
        helpText: 'Confirmation that security conditions at the borrowing venue have been reviewed and confirmed.',
      },
    ],
  },
  {
    id: 'agreement',
    label: 'Loan Agreement',
    sectionId: 'agreement',
    requirements: [
      {
        id: 'loan_agreement_signed_date',
        label: 'Agreement signed',
        groupId: 'agreement',
        fieldPaths: ['loan_agreement_signed_date'],
        requiredForStatuses: ['agreement_signed', 'in_transit', 'on_loan', 'return_scheduled', 'returned', 'closed'],
        severity: 'blocking',
        helpText: 'Date the loan agreement was signed by both parties.',
      },
      {
        id: 'document_location',
        label: 'Document location',
        groupId: 'agreement',
        fieldPaths: ['document_location'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'Where the physical loan file and documents are stored.',
      },
    ],
  },
  {
    id: 'closing',
    label: 'Closing',
    sectionId: 'closing',
    requirements: [
      {
        id: 'actual_return_date',
        label: 'Actual return date',
        groupId: 'closing',
        fieldPaths: ['actual_return_date'],
        requiredForStatuses: ['returned', 'closed'],
        severity: 'blocking',
        helpText: 'The date objects were actually returned to the institution.',
      },
      {
        id: 'receipt_acknowledged',
        label: 'Receipt acknowledged',
        groupId: 'closing',
        fieldPaths: ['receipt_acknowledged'],
        requiredForStatuses: ['closed'],
        severity: 'blocking',
        helpText: 'Confirmation that safe receipt of returned objects has been acknowledged.',
      },
      {
        id: 'conditions_met_confirmed',
        label: 'All conditions met',
        groupId: 'closing',
        fieldPaths: ['conditions_met_confirmed'],
        requiredForStatuses: ['closed'],
        severity: 'blocking',
        helpText: 'Confirmation that all loan conditions have been satisfied.',
      },
      {
        id: 'closing_invoice_sent',
        label: 'Invoice sent',
        groupId: 'closing',
        fieldPaths: ['closing_invoice_sent'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'Whether the borrower has been invoiced for any remaining costs.',
      },
    ],
  },
];

export function computeLoanOutCompliance(
  record: Record<string, unknown>,
  currentStatus: LoanOutStatus,
  targetStatus?: LoanOutStatus
) {
  return computeProcedureCompliance(
    LOAN_OUT_REQUIREMENT_GROUPS,
    record,
    currentStatus,
    STATUS_ORDER,
    targetStatus
  );
}

export function canTransitionTo(
  record: Record<string, unknown>,
  currentStatus: LoanOutStatus,
  targetStatus: LoanOutStatus
) {
  return canTransitionToProcedure(
    LOAN_OUT_REQUIREMENT_GROUPS,
    record,
    currentStatus,
    targetStatus,
    STATUS_ORDER
  );
}
