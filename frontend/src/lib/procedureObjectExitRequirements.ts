/**
 * Object Exit Requirements Configuration
 */

import type { RequirementGroup } from './procedureComplianceUtils';
import { computeProcedureCompliance, canTransitionToProcedure } from './procedureComplianceUtils';

export type ObjectExitStatus = 'pending' | 'preparing' | 'dispatched' | 'in_transit' | 'acknowledged' | 'cancelled';

const STATUS_ORDER: ObjectExitStatus[] = ['pending', 'preparing', 'dispatched', 'in_transit', 'acknowledged', 'cancelled'];

export const OBJECT_EXIT_REQUIREMENT_GROUPS: RequirementGroup[] = [
  {
    id: 'exit',
    label: 'Exit Information',
    sectionId: 'exit',
    requirements: [
      {
        id: 'exit_date',
        label: 'Exit date',
        groupId: 'exit',
        fieldPaths: ['exit_date'],
        requiredForStatuses: ['preparing', 'dispatched', 'acknowledged'],
        severity: 'blocking',
        helpText: 'The date the objects are expected to or did leave.',
      },
      {
        id: 'exit_reason',
        label: 'Exit reason',
        groupId: 'exit',
        fieldPaths: ['exit_reason'],
        requiredForStatuses: ['preparing', 'dispatched', 'acknowledged'],
        severity: 'blocking',
        helpText: 'The reason for the objects leaving.',
      },
      {
        id: 'exit_method',
        label: 'Exit method',
        groupId: 'exit',
        fieldPaths: ['exit_method'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'How the objects will leave (courier, post, collection).',
      },
    ],
  },
  {
    id: 'recipient',
    label: 'Recipient',
    sectionId: 'recipient',
    requirements: [
      {
        id: 'recipient_name',
        label: 'Recipient name',
        groupId: 'recipient',
        fieldPaths: ['recipient_name'],
        requiredForStatuses: ['preparing', 'dispatched', 'acknowledged'],
        severity: 'blocking',
        helpText: 'The person or organization receiving the objects.',
      },
    ],
  },
  {
    id: 'shipping',
    label: 'Shipping Details',
    sectionId: 'shipping',
    requirements: [
      {
        id: 'shipping_method',
        label: 'Shipping method',
        groupId: 'shipping',
        fieldPaths: ['shipping_method'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'The shipping method used.',
      },
      {
        id: 'packing_method',
        label: 'Packing method',
        groupId: 'shipping',
        fieldPaths: ['packing_method'],
        requiredForStatuses: [],
        severity: 'info',
        helpText: 'How the objects were packed for transport.',
      },
    ],
  },
  {
    id: 'condition',
    label: 'Condition',
    sectionId: 'condition',
    requirements: [
      {
        id: 'condition_at_exit',
        label: 'Condition at exit',
        groupId: 'condition',
        fieldPaths: ['condition_at_exit'],
        requiredForStatuses: ['dispatched'],
        severity: 'recommended',
        helpText: 'The condition of objects when they leave.',
      },
    ],
  },
  {
    id: 'authorization',
    label: 'Authorization',
    sectionId: 'authorization',
    requirements: [
      {
        id: 'authorization_id',
        label: 'Exit authorizer',
        groupId: 'authorization',
        fieldPaths: ['authorization_id'],
        requiredForStatuses: ['dispatched', 'acknowledged'],
        severity: 'blocking',
        helpText: 'The person authorizing the exit in your organization.',
      },
      {
        id: 'authorization_date',
        label: 'Authorization date',
        groupId: 'authorization',
        fieldPaths: ['authorization_date'],
        requiredForStatuses: ['dispatched', 'acknowledged'],
        severity: 'blocking',
        helpText: 'The date the exit was authorized.',
      },
      {
        id: 'authorization_note',
        label: 'Authorization note',
        groupId: 'authorization',
        fieldPaths: ['authorization_note'],
        requiredForStatuses: [],
        severity: 'info',
        helpText: 'Notes about the authorization.',
      },
    ],
  },
  {
    id: 'receipt',
    label: 'Receipt Acknowledgment',
    sectionId: 'receipt',
    requirements: [
      {
        id: 'receipt_acknowledged',
        label: 'Receipt acknowledged',
        groupId: 'receipt',
        fieldPaths: ['receipt_acknowledged'],
        predicate: (entry) => entry.receipt_acknowledged === true,
        requiredForStatuses: ['acknowledged'],
        severity: 'blocking',
        helpText: 'Confirmation that safe handover of objects has been acknowledged with a signature.',
      },
      {
        id: 'receipt_reference',
        label: 'Receipt reference',
        groupId: 'receipt',
        fieldPaths: ['receipt_reference'],
        requiredForStatuses: ['acknowledged'],
        severity: 'recommended',
        helpText: 'Reference for the receipt acknowledgment.',
      },
    ],
  },
];

export function computeObjectExitCompliance(
  record: Record<string, unknown>,
  currentStatus: ObjectExitStatus,
  targetStatus?: ObjectExitStatus
) {
  return computeProcedureCompliance(
    OBJECT_EXIT_REQUIREMENT_GROUPS,
    record,
    currentStatus,
    STATUS_ORDER,
    targetStatus
  );
}

export function canTransitionTo(
  record: Record<string, unknown>,
  currentStatus: ObjectExitStatus,
  targetStatus: ObjectExitStatus
) {
  return canTransitionToProcedure(
    OBJECT_EXIT_REQUIREMENT_GROUPS,
    record,
    currentStatus,
    targetStatus,
    STATUS_ORDER
  );
}

export function getNextStatus(currentStatus: ObjectExitStatus): ObjectExitStatus | null {
  const transitions: Record<ObjectExitStatus, ObjectExitStatus | null> = {
    pending: 'preparing',
    preparing: 'dispatched',
    dispatched: 'in_transit',
    in_transit: 'acknowledged',
    acknowledged: null,
    cancelled: null,
  };
  return transitions[currentStatus];
}
