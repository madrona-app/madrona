/**
 * Acquisition Requirements Configuration
 */

import type { RequirementGroup } from './procedureComplianceUtils';
import { computeProcedureCompliance, canTransitionToProcedure } from './procedureComplianceUtils';

export type AcquisitionStatus = 'proposed' | 'approved' | 'completed' | 'cancelled';

const STATUS_ORDER: AcquisitionStatus[] = ['proposed', 'approved', 'completed', 'cancelled'];

export const ACQUISITION_REQUIREMENT_GROUPS: RequirementGroup[] = [
  {
    id: 'acquisition',
    label: 'Acquisition Information',
    sectionId: 'acquisition',
    requirements: [
      {
        id: 'acquisition_method',
        label: 'Acquisition method',
        groupId: 'acquisition',
        fieldPaths: ['acquisition_method'],
        requiredForStatuses: ['approved', 'completed'],
        severity: 'blocking',
        helpText: 'How the object is being acquired (gift, purchase, bequest, etc.).',
      },
      {
        id: 'acquisition_date',
        label: 'Acquisition date',
        groupId: 'acquisition',
        fieldPaths: ['acquisition_date'],
        requiredForStatuses: ['completed'],
        severity: 'recommended',
        helpText: 'The date the acquisition was finalized.',
      },
    ],
  },
  {
    id: 'source',
    label: 'Source Information',
    sectionId: 'source',
    requirements: [
      {
        id: 'source_id',
        label: 'Source',
        groupId: 'source',
        fieldPaths: ['source_id'],
        requiredForStatuses: ['approved', 'completed'],
        severity: 'blocking',
        helpText: 'The person or organization from whom the object is acquired.',
      },
      {
        id: 'source_type',
        label: 'Source type',
        groupId: 'source',
        fieldPaths: ['source_type'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'Type of source (individual, institution, estate, etc.).',
      },
    ],
  },
  {
    id: 'financial',
    label: 'Financial Information',
    sectionId: 'financial',
    requirements: [
      {
        id: 'cost',
        label: 'Cost/Value',
        groupId: 'financial',
        fieldPaths: ['cost'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'The purchase price or assessed value of the acquisition.',
      },
      {
        id: 'funding_source',
        label: 'Funding source',
        groupId: 'financial',
        fieldPaths: ['funding_source'],
        requiredForStatuses: [],
        severity: 'info',
        helpText: 'The source of funds for the acquisition.',
      },
    ],
  },
  {
    id: 'legal',
    label: 'Legal & Provenance',
    sectionId: 'legal',
    requirements: [
      {
        id: 'legal_status',
        label: 'Legal status',
        groupId: 'legal',
        fieldPaths: ['legal_status'],
        requiredForStatuses: ['completed'],
        severity: 'blocking',
        helpText: 'Confirmation of clear legal title for acquisition.',
      },
      {
        id: 'credit_line',
        label: 'Credit line',
        groupId: 'legal',
        fieldPaths: ['credit_line'],
        requiredForStatuses: ['completed'],
        severity: 'recommended',
        helpText: 'The donor credit line for display and publication.',
      },
      {
        id: 'provenance_verified',
        label: 'Provenance verified',
        groupId: 'legal',
        fieldPaths: ['provenance_verified'],
        requiredForStatuses: ['completed'],
        severity: 'recommended',
        helpText: 'Confirmation that provenance research has been completed.',
      },
    ],
  },
  {
    id: 'boardApproval',
    label: 'Board Approval',
    sectionId: 'boardApproval',
    requirements: [
      {
        id: 'board_approval_date',
        label: 'Board approval date',
        groupId: 'boardApproval',
        fieldPaths: ['board_approval_date'],
        requiredForStatuses: [],
        severity: 'info',
        helpText: 'Date the board approved this acquisition (if board approval is required).',
      },
    ],
  },
  {
    id: 'documentation',
    label: 'Documentation',
    sectionId: 'documentation',
    requirements: [
      {
        id: 'deed_of_gift_date',
        label: 'Deed of gift date',
        groupId: 'documentation',
        fieldPaths: ['deed_of_gift_date'],
        requiredForStatuses: ['completed'],
        severity: 'blocking',
        helpText: 'Date the deed of gift or transfer agreement was signed.',
      },
      {
        id: 'authorization_date',
        label: 'Authorization date',
        groupId: 'documentation',
        fieldPaths: ['authorization_date'],
        requiredForStatuses: ['completed'],
        severity: 'blocking',
        helpText: 'Date the acquisition was formally authorized.',
      },
      {
        id: 'deed_of_gift_reference',
        label: 'Deed of gift reference',
        groupId: 'documentation',
        fieldPaths: ['deed_of_gift_reference'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'Reference number for the deed of gift document.',
      },
    ],
  },
];

export function computeAcquisitionCompliance(
  record: Record<string, unknown>,
  currentStatus: AcquisitionStatus,
  targetStatus?: AcquisitionStatus
) {
  return computeProcedureCompliance(
    ACQUISITION_REQUIREMENT_GROUPS,
    record,
    currentStatus,
    STATUS_ORDER,
    targetStatus
  );
}

export function canTransitionTo(
  record: Record<string, unknown>,
  currentStatus: AcquisitionStatus,
  targetStatus: AcquisitionStatus
) {
  return canTransitionToProcedure(
    ACQUISITION_REQUIREMENT_GROUPS,
    record,
    currentStatus,
    targetStatus,
    STATUS_ORDER
  );
}

export function getNextStatus(currentStatus: AcquisitionStatus): AcquisitionStatus | null {
  const transitions: Record<AcquisitionStatus, AcquisitionStatus | null> = {
    proposed: 'approved',
    approved: 'completed',
    completed: null,
    cancelled: null,
  };
  return transitions[currentStatus];
}
