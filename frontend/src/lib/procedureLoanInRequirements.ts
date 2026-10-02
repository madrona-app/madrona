/**
 * Loan In Requirements Configuration
 *
 * Full compliance with the collections standard "Loans in (borrowing objects)" procedure.
 * Requirements are mapped to statuses — blocking requirements prevent
 * status transitions, recommended requirements show warnings.
 */

import type { RequirementGroup } from './procedureComplianceUtils';
import { computeProcedureCompliance, canTransitionToProcedure } from './procedureComplianceUtils';

export type LoanInStatus =
  | 'requested'
  | 'pending_approval'
  | 'approved'
  | 'agreement_sent'
  | 'agreement_signed'
  | 'in_transit'
  | 'received'
  | 'on_loan'
  | 'return_initiated'
  | 'returned'
  | 'closed'
  | 'cancelled'
  | 'overdue';

const STATUS_ORDER: LoanInStatus[] = [
  'requested',
  'pending_approval',
  'approved',
  'agreement_sent',
  'agreement_signed',
  'in_transit',
  'received',
  'on_loan',
  'return_initiated',
  'returned',
  'closed',
  'cancelled',
  'overdue',
];

export const LOAN_IN_REQUIREMENT_GROUPS: RequirementGroup[] = [
  {
    id: 'lender',
    label: 'Lender',
    sectionId: 'lender',
    requirements: [
      {
        id: 'lender_id',
        label: 'Lender',
        groupId: 'lender',
        fieldPaths: ['lender_id'],
        requiredForStatuses: ['approved', 'agreement_sent', 'agreement_signed', 'in_transit', 'received', 'on_loan', 'return_initiated', 'returned', 'closed'],
        severity: 'blocking',
        helpText: 'The institution or individual lending the objects.',
      },
      {
        id: 'lender_contact_id',
        label: 'Lender contact person',
        groupId: 'lender',
        fieldPaths: ['lender_contact_id'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'The contact person at the lending institution.',
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
        requiredForStatuses: ['approved', 'agreement_sent', 'agreement_signed', 'in_transit', 'received', 'on_loan', 'return_initiated', 'returned', 'closed'],
        severity: 'blocking',
        helpText: 'The reason for the loan (exhibition, research, etc.).',
      },
      {
        id: 'exhibition_name',
        label: 'Exhibition name',
        groupId: 'details',
        fieldPaths: ['exhibition_name'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'Name of the exhibition or project for which objects are borrowed.',
      },
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    sectionId: 'linkedEntry',
    requirements: [
      {
        id: 'objects',
        label: 'Loan objects',
        groupId: 'objects',
        fieldPaths: ['objects'],
        requiredForStatuses: ['approved', 'agreement_sent', 'agreement_signed', 'in_transit', 'received', 'on_loan', 'return_initiated', 'returned', 'closed'],
        severity: 'blocking',
        helpText: 'At least one object must be added to the loan.',
      },
    ],
  },
  {
    id: 'lender_authorization',
    label: 'Lender Authorization',
    sectionId: 'lender-authorization',
    requirements: [
      {
        id: 'lender_authorizer_id',
        label: 'Lender authorizer',
        groupId: 'lender_authorization',
        fieldPaths: ['lender_authorizer_id'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'The person who authorized the loan on behalf of the lender.',
      },
      {
        id: 'lender_authorization_date',
        label: 'Lender authorization date',
        groupId: 'lender_authorization',
        fieldPaths: ['lender_authorization_date'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'The date the lender authorized the loan.',
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
        requiredForStatuses: ['in_transit', 'received', 'on_loan', 'return_initiated', 'returned', 'closed'],
        severity: 'blocking',
        helpText: 'The agreed start date for the loan period.',
      },
      {
        id: 'loan_end_date',
        label: 'Loan end date',
        groupId: 'dates',
        fieldPaths: ['loan_end_date'],
        requiredForStatuses: ['in_transit', 'received', 'on_loan', 'return_initiated', 'returned', 'closed'],
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
        id: 'insurance_value',
        label: 'Insurance value',
        groupId: 'insurance',
        fieldPaths: ['insurance_value'],
        requiredForStatuses: ['in_transit', 'received', 'on_loan', 'return_initiated', 'returned', 'closed'],
        severity: 'blocking',
        helpText: 'Total insurance value for all borrowed objects.',
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
        requiredForStatuses: ['agreement_signed', 'in_transit', 'received', 'on_loan', 'return_initiated', 'returned', 'closed'],
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
        helpText: 'The date objects were actually returned to the lender.',
      },
      {
        id: 'receipt_acknowledged',
        label: 'Receipt acknowledged',
        groupId: 'closing',
        fieldPaths: ['receipt_acknowledged'],
        requiredForStatuses: ['closed'],
        severity: 'blocking',
        helpText: 'Confirmation that safe receipt of returned objects has been acknowledged by the lender.',
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
        helpText: 'Whether the lender has been invoiced for any remaining costs.',
      },
    ],
  },
];

export function computeLoanInCompliance(
  record: Record<string, unknown>,
  currentStatus: LoanInStatus,
  targetStatus?: LoanInStatus
) {
  return computeProcedureCompliance(
    LOAN_IN_REQUIREMENT_GROUPS,
    record,
    currentStatus,
    STATUS_ORDER,
    targetStatus
  );
}

export function canTransitionTo(
  record: Record<string, unknown>,
  currentStatus: LoanInStatus,
  targetStatus: LoanInStatus
) {
  return canTransitionToProcedure(
    LOAN_IN_REQUIREMENT_GROUPS,
    record,
    currentStatus,
    targetStatus,
    STATUS_ORDER
  );
}
