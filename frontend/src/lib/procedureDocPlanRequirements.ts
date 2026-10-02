/**
 * Documentation Planning Requirements Configuration
 *
 * Implements the primary procedure: "Making documentation systems
 * better and enhancing information as an ongoing process of continual improvement."
 *
 * Minimum standard requirements:
 * - Review existing collections information and agree improvement areas
 * - Written documentation plan with specific, achievable objectives,
 *   realistic timeframe, and resources
 * - Regularly review progress toward plan objectives
 */

import type { RequirementGroup } from './procedureComplianceUtils';
import { computeProcedureCompliance, canTransitionToProcedure } from './procedureComplianceUtils';

export type DocPlanStatus = 'draft' | 'approved' | 'in_progress' | 'completed' | 'superseded' | 'cancelled';

const STATUS_ORDER: DocPlanStatus[] = ['draft', 'approved', 'in_progress', 'completed', 'superseded', 'cancelled'];

export const DOC_PLAN_REQUIREMENT_GROUPS: RequirementGroup[] = [
  {
    id: 'basic',
    label: 'Plan Information',
    sectionId: 'basic',
    requirements: [
      {
        id: 'title',
        label: 'Plan title',
        groupId: 'basic',
        fieldPaths: ['title'],
        requiredForStatuses: ['approved', 'in_progress', 'completed'],
        severity: 'blocking',
        helpText: 'A descriptive title for the documentation plan.',
      },
      {
        id: 'plan_type',
        label: 'Plan type',
        groupId: 'basic',
        fieldPaths: ['plan_type'],
        requiredForStatuses: ['approved', 'in_progress', 'completed'],
        severity: 'blocking',
        helpText: 'The type of documentation plan (collection-wide, project, thematic, etc.).',
      },
    ],
  },
  {
    id: 'content',
    label: 'Objectives & Actions',
    sectionId: 'content',
    requirements: [
      {
        id: 'objectives',
        label: 'Objectives',
        groupId: 'content',
        fieldPaths: ['objectives'],
        requiredForStatuses: ['approved', 'in_progress', 'completed'],
        severity: 'blocking',
        helpText: 'Specific, achievable objectives for the plan.',
      },
      {
        id: 'measurable_results',
        label: 'Measurable results',
        groupId: 'content',
        fieldPaths: ['measurable_results'],
        predicate: (record) => {
          const results = record.measurable_results;
          return Array.isArray(results) && results.length > 0;
        },
        requiredForStatuses: ['approved', 'in_progress', 'completed'],
        severity: 'recommended',
        helpText: 'Measurable results to evaluate success.',
      },
      {
        id: 'actions',
        label: 'Actions',
        groupId: 'content',
        fieldPaths: ['actions'],
        predicate: (record) => {
          const actions = record.actions;
          return Array.isArray(actions) && actions.length > 0;
        },
        requiredForStatuses: ['in_progress'],
        severity: 'recommended',
        helpText: 'Concrete actions to achieve the objectives.',
      },
    ],
  },
  {
    id: 'timeline',
    label: 'Timeline',
    sectionId: 'timeline',
    requirements: [
      {
        id: 'start_date',
        label: 'Start date',
        groupId: 'timeline',
        fieldPaths: ['start_date'],
        requiredForStatuses: ['approved', 'in_progress', 'completed'],
        severity: 'blocking',
        helpText: 'Planned start date.',
      },
      {
        id: 'end_date',
        label: 'End date',
        groupId: 'timeline',
        fieldPaths: ['end_date'],
        requiredForStatuses: ['approved', 'in_progress', 'completed'],
        severity: 'blocking',
        helpText: 'Planned end date.',
      },
      {
        id: 'review_frequency',
        label: 'Review frequency',
        groupId: 'timeline',
        fieldPaths: ['review_frequency'],
        requiredForStatuses: ['in_progress'],
        severity: 'recommended',
        helpText: 'How often progress will be reviewed.',
      },
    ],
  },
  {
    id: 'resources',
    label: 'Resources',
    sectionId: 'resources',
    requirements: [
      {
        id: 'resources_required',
        label: 'Resources required',
        groupId: 'resources',
        fieldPaths: ['resources_required'],
        predicate: (record) => {
          const resources = record.resources_required;
          if (Array.isArray(resources)) return resources.length > 0;
          if (typeof resources === 'string') return resources.trim().length > 0;
          return false;
        },
        requiredForStatuses: ['approved'],
        severity: 'recommended',
        helpText: 'Staff, funding, and other resources needed.',
      },
    ],
  },
  {
    id: 'approval',
    label: 'Approval',
    sectionId: 'basic',
    requirements: [
      {
        id: 'approved_by',
        label: 'Approved by',
        groupId: 'approval',
        fieldPaths: ['approved_by'],
        requiredForStatuses: ['in_progress', 'completed'],
        severity: 'blocking',
        helpText: 'Who approved this plan.',
      },
      {
        id: 'approval_date',
        label: 'Approval date',
        groupId: 'approval',
        fieldPaths: ['approval_date'],
        requiredForStatuses: ['in_progress', 'completed'],
        severity: 'recommended',
        helpText: 'When the plan was approved.',
      },
    ],
  },
];

export function computeDocPlanCompliance(
  record: Record<string, unknown>,
  currentStatus: DocPlanStatus,
  targetStatus?: DocPlanStatus
) {
  return computeProcedureCompliance(
    DOC_PLAN_REQUIREMENT_GROUPS,
    record,
    currentStatus,
    STATUS_ORDER,
    targetStatus
  );
}

export function canTransitionTo(
  record: Record<string, unknown>,
  currentStatus: DocPlanStatus,
  targetStatus: DocPlanStatus
) {
  return canTransitionToProcedure(
    DOC_PLAN_REQUIREMENT_GROUPS,
    record,
    currentStatus,
    targetStatus,
    STATUS_ORDER
  );
}

export function getNextStatus(currentStatus: DocPlanStatus): DocPlanStatus | null {
  const transitions: Record<DocPlanStatus, DocPlanStatus | null> = {
    draft: 'approved',
    approved: 'in_progress',
    in_progress: 'completed',
    completed: null,
    superseded: null,
    cancelled: null,
  };
  return transitions[currentStatus];
}
