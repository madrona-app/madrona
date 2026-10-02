/**
 * Location and Movement Control Requirements Configuration
 *
 * Implements the primary procedure: "Keeping a record of where all
 * objects can be found, and updating location each time an object is moved."
 *
 * Minimum standard requirements:
 * - Record every movement including date, update location record
 * - Record who moved objects (and who authorized)
 * - Access location info by object number and location name
 * - Full history of previous locations
 * - Assess risks of moving objects
 * - Appropriate insurance/indemnity before transporting
 */

import type { RequirementGroup } from './procedureComplianceUtils';
import { computeProcedureCompliance, canTransitionToProcedure } from './procedureComplianceUtils';

export type MovementStatus = 'pending' | 'in_transit' | 'completed' | 'cancelled';

const STATUS_ORDER: MovementStatus[] = ['pending', 'in_transit', 'completed', 'cancelled'];

export const MOVEMENT_REQUIREMENT_GROUPS: RequirementGroup[] = [
  {
    id: 'object',
    label: 'Object',
    sectionId: 'object',
    requirements: [
      {
        id: 'object_id',
        label: 'Object',
        groupId: 'object',
        fieldPaths: ['object_id'],
        requiredForStatuses: ['pending', 'in_transit', 'completed'],
        severity: 'blocking',
        helpText: 'The object being moved.',
      },
    ],
  },
  {
    id: 'movement',
    label: 'Movement Details',
    sectionId: 'movement',
    requirements: [
      {
        id: 'reason',
        label: 'Movement reason',
        groupId: 'movement',
        fieldPaths: ['reason'],
        requiredForStatuses: ['pending', 'in_transit', 'completed'],
        severity: 'blocking',
        helpText: 'Why the object is being moved.',
      },
      {
        id: 'to_location_id',
        label: 'Destination location',
        groupId: 'movement',
        fieldPaths: ['to_location_id'],
        requiredForStatuses: ['pending', 'in_transit', 'completed'],
        severity: 'blocking',
        helpText: 'Where the object is being moved to.',
      },
      {
        id: 'movement_date',
        label: 'Movement date',
        groupId: 'movement',
        fieldPaths: ['movement_date'],
        requiredForStatuses: ['in_transit', 'completed'],
        severity: 'blocking',
        helpText: 'The date of the movement.',
      },
      {
        id: 'from_location_id',
        label: 'Previous location',
        groupId: 'movement',
        fieldPaths: ['from_location_id'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'Where the object is being moved from.',
      },
      {
        id: 'movement_method',
        label: 'Movement method',
        groupId: 'movement',
        fieldPaths: ['movement_method'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'How the object was moved — hand-carried, cart, shipped, etc..',
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
        requiredForStatuses: ['in_transit', 'completed'],
        severity: 'blocking',
        helpText: 'Who authorized the movement.',
      },
      {
        id: 'authorization_date',
        label: 'Authorization date',
        groupId: 'authorization',
        fieldPaths: ['authorization_date'],
        requiredForStatuses: ['in_transit', 'completed'],
        severity: 'recommended',
        helpText: 'When the movement was authorized.',
      },
    ],
  },
  {
    id: 'handler',
    label: 'Handler',
    sectionId: 'handler',
    requirements: [
      {
        id: 'handler_id',
        label: 'Handler',
        groupId: 'handler',
        fieldPaths: ['handler_id'],
        requiredForStatuses: ['completed'],
        severity: 'recommended',
        helpText: 'Who physically handled the object.',
      },
    ],
  },
  {
    id: 'shipping',
    label: 'Shipping & Courier',
    sectionId: 'shipping',
    requirements: [
      {
        id: 'shipping_insurance_value',
        label: 'Shipping insurance value',
        groupId: 'shipping',
        fieldPaths: ['shipping_insurance_value'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'Insurance value for transit.',
        predicate: (record) => {
          // Only relevant for shipped/couriered movements
          const method = record.movement_method;
          if (method !== 'shipped' && method !== 'courier') return true;
          const value = record.shipping_insurance_value;
          return value !== null && value !== undefined && value !== '' && value !== 0;
        },
      },
      {
        id: 'shipping_method',
        label: 'Shipping method',
        groupId: 'shipping',
        fieldPaths: ['shipping_method'],
        requiredForStatuses: [],
        severity: 'info',
        helpText: 'Shipping method — ground, air, or sea.',
        predicate: (record) => {
          const method = record.movement_method;
          if (method !== 'shipped' && method !== 'courier') return true;
          return !!record.shipping_method;
        },
      },
    ],
  },
  {
    id: 'condition',
    label: 'Condition',
    sectionId: 'condition',
    requirements: [
      {
        id: 'condition_note',
        label: 'Condition note',
        groupId: 'condition',
        fieldPaths: ['condition_note'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'Note on the condition of the object before/during movement.',
      },
    ],
  },
  {
    id: 'planning',
    label: 'Planning',
    sectionId: 'planning',
    requirements: [
      {
        id: 'location_fitness',
        label: 'Location fitness',
        groupId: 'planning',
        fieldPaths: ['location_fitness'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'Assessment of whether the destination location is suitable for the object.',
      },
    ],
  },
];

export function computeMovementCompliance(
  record: Record<string, unknown>,
  currentStatus: MovementStatus,
  targetStatus?: MovementStatus
) {
  return computeProcedureCompliance(
    MOVEMENT_REQUIREMENT_GROUPS,
    record,
    currentStatus,
    STATUS_ORDER,
    targetStatus
  );
}

export function canTransitionTo(
  record: Record<string, unknown>,
  currentStatus: MovementStatus,
  targetStatus: MovementStatus
) {
  return canTransitionToProcedure(
    MOVEMENT_REQUIREMENT_GROUPS,
    record,
    currentStatus,
    targetStatus,
    STATUS_ORDER
  );
}

export function getNextStatus(currentStatus: MovementStatus): MovementStatus | null {
  const transitions: Record<MovementStatus, MovementStatus | null> = {
    pending: 'in_transit',
    in_transit: 'completed',
    completed: null,
    cancelled: null,
  };
  return transitions[currentStatus];
}
