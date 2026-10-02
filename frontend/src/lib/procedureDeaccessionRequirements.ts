/**
 * Deaccession Requirements Configuration
 */

import type { RequirementGroup } from './procedureComplianceUtils';
import { computeProcedureCompliance, canTransitionToProcedure } from './procedureComplianceUtils';

export type DeaccessionStatus = 'proposed' | 'under_review' | 'committee_reviewed' | 'pending_board' | 'approved' | 'in_progress' | 'completed' | 'cancelled' | 'rejected';

const STATUS_ORDER: DeaccessionStatus[] = ['proposed', 'under_review', 'committee_reviewed', 'pending_board', 'approved', 'in_progress', 'completed', 'cancelled', 'rejected'];

export const DEACCESSION_REQUIREMENT_GROUPS: RequirementGroup[] = [
  {
    id: 'linkedObject',
    label: 'Collection Object',
    sectionId: 'linkedObject',
    requirements: [
      {
        id: 'object_id',
        label: 'Object',
        groupId: 'linkedObject',
        fieldPaths: ['object_id'],
        requiredForStatuses: ['under_review', 'committee_reviewed', 'pending_board', 'approved', 'in_progress', 'completed'],
        severity: 'blocking',
        helpText: 'The collection object being deaccessioned.',
      },
    ],
  },
  {
    id: 'info',
    label: 'Deaccession Information',
    sectionId: 'info',
    requirements: [
      {
        id: 'proposal_date',
        label: 'Proposal date',
        groupId: 'info',
        fieldPaths: ['proposal_date'],
        requiredForStatuses: ['under_review'],
        severity: 'blocking',
        helpText: 'The date the deaccession was proposed.',
      },
      {
        id: 'reason',
        label: 'Reason',
        groupId: 'info',
        fieldPaths: ['reason'],
        requiredForStatuses: ['under_review', 'committee_reviewed'],
        severity: 'blocking',
        helpText: 'The reason for deaccessioning the object.',
      },
      {
        id: 'reason_detail',
        label: 'Reason detail',
        groupId: 'info',
        fieldPaths: ['reason_detail'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'Additional detail about the deaccession reason.',
      },
    ],
  },
  {
    id: 'disposal',
    label: 'Disposal Method',
    sectionId: 'disposal',
    requirements: [
      {
        id: 'disposal_method',
        label: 'Disposal method',
        groupId: 'disposal',
        fieldPaths: ['disposal_method'],
        requiredForStatuses: ['in_progress', 'completed'],
        severity: 'blocking',
        helpText: 'How the object will be disposed of.',
      },
      {
        id: 'recipient_name',
        label: 'Recipient name',
        groupId: 'disposal',
        fieldPaths: ['recipient_name'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'The person or organization receiving the object.',
      },
    ],
  },
  {
    id: 'committee',
    label: 'Committee Review',
    sectionId: 'committee',
    requirements: [
      {
        id: 'committee_review_date',
        label: 'Committee review date',
        groupId: 'committee',
        fieldPaths: ['committee_review_date'],
        requiredForStatuses: ['committee_reviewed', 'pending_board'],
        severity: 'blocking',
        helpText: 'The date of the committee review.',
      },
      {
        id: 'committee_recommendation',
        label: 'Committee recommendation',
        groupId: 'committee',
        fieldPaths: ['committee_recommendation'],
        requiredForStatuses: ['committee_reviewed', 'pending_board'],
        severity: 'blocking',
        helpText: 'The committee\'s recommendation on the deaccession.',
      },
    ],
  },
  {
    id: 'board',
    label: 'Board Approval',
    sectionId: 'board',
    requirements: [
      {
        id: 'board_approval_date',
        label: 'Board approval date',
        groupId: 'board',
        fieldPaths: ['board_approval_date'],
        requiredForStatuses: ['approved'],
        severity: 'blocking',
        helpText: 'The date of the board approval.',
        predicate: (record) => {
          if (!record.board_approval_required) return true;
          const date = record.board_approval_date;
          return typeof date === 'string' && date.trim().length > 0;
        },
      },
      {
        id: 'board_approval_reference',
        label: 'Board approval reference',
        groupId: 'board',
        fieldPaths: ['board_approval_reference'],
        requiredForStatuses: ['approved'],
        severity: 'recommended',
        helpText: 'Reference number for the board approval.',
        predicate: (record) => {
          if (!record.board_approval_required) return true;
          const ref = record.board_approval_reference;
          return typeof ref === 'string' && ref.trim().length > 0;
        },
      },
    ],
  },
  {
    id: 'legal',
    label: 'Legal & Provenance',
    sectionId: 'legal',
    requirements: [
      {
        id: 'legal_review_date',
        label: 'Legal review date',
        groupId: 'legal',
        fieldPaths: ['legal_review_date'],
        requiredForStatuses: ['in_progress', 'completed'],
        severity: 'blocking',
        helpText: 'The date of the legal review.',
      },
      {
        id: 'provenance_review_complete',
        label: 'Provenance review complete',
        groupId: 'legal',
        fieldPaths: ['provenance_review_complete'],
        predicate: (record) => record.provenance_review_complete === true,
        requiredForStatuses: ['in_progress'],
        severity: 'recommended',
        helpText: 'Confirmation that provenance has been reviewed.',
      },
    ],
  },
  {
    id: 'valuation',
    label: 'Valuation',
    sectionId: 'valuation',
    requirements: [
      {
        id: 'appraised_value',
        label: 'Appraised value',
        groupId: 'valuation',
        fieldPaths: ['appraised_value'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'The appraised value of the object.',
      },
    ],
  },
];

export function computeDeaccessionCompliance(
  record: Record<string, unknown>,
  currentStatus: DeaccessionStatus,
  targetStatus?: DeaccessionStatus
) {
  return computeProcedureCompliance(
    DEACCESSION_REQUIREMENT_GROUPS,
    record,
    currentStatus,
    STATUS_ORDER,
    targetStatus
  );
}

export function canTransitionTo(
  record: Record<string, unknown>,
  currentStatus: DeaccessionStatus,
  targetStatus: DeaccessionStatus
) {
  return canTransitionToProcedure(
    DEACCESSION_REQUIREMENT_GROUPS,
    record,
    currentStatus,
    targetStatus,
    STATUS_ORDER
  );
}

export function getNextStatus(currentStatus: DeaccessionStatus): DeaccessionStatus | null {
  const transitions: Record<DeaccessionStatus, DeaccessionStatus | null> = {
    proposed: 'under_review',
    under_review: 'committee_reviewed',
    committee_reviewed: 'pending_board',
    pending_board: 'approved',
    approved: 'in_progress',
    in_progress: 'completed',
    completed: null,
    cancelled: null,
    rejected: null,
  };
  return transitions[currentStatus];
}
