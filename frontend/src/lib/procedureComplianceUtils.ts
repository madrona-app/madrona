/**
 * Procedure Compliance Utilities
 *
 * Generic compliance computation that works with any procedure's RequirementGroup[].
 * All shared types and helpers live here; procedure-specific requirement configs
 * (e.g. procedureObjectEntryRequirements.ts) import FROM this file.
 */

// =============================================================================
// TYPES
// =============================================================================

export type RequirementSeverity = 'blocking' | 'recommended' | 'info';

export interface Requirement {
  id: string;
  label: string;
  groupId: string;
  /** Paths into record data to check (e.g., "depositor_name", "terms_accepted") */
  fieldPaths: string[];
  /** Optional custom predicate for complex validation */
  predicate?: (record: Record<string, unknown>) => boolean;
  /** Which statuses require this field to be complete before transitioning TO them */
  requiredForStatuses: string[];
  severity: RequirementSeverity;
  helpText?: string;
  helpLink?: string;
}

export interface RequirementGroup {
  id: string;
  label: string;
  sectionId: string; // Maps to form section for navigation
  requirements: Requirement[];
}

export interface RequirementResult {
  requirement: Requirement;
  satisfied: boolean;
  missingFields: string[];
}

export interface GroupResult {
  group: RequirementGroup;
  completedCount: number;
  totalCount: number;
  missingLabels: string[];
  blockingMissing: RequirementResult[];
  results: RequirementResult[];
}

export interface ComplianceResult {
  requiredTotal: number;
  requiredComplete: number;
  percentComplete: number;
  blockingMissing: RequirementResult[];
  recommendedMissing: RequirementResult[];
  infoMissing: RequirementResult[];
  groups: GroupResult[];
  nextBlockingField: { sectionId: string; fieldPath: string } | null;
}

/**
 * Check if a field has a value
 */
function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return true;
  if (typeof value === 'boolean') return value === true;
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

/**
 * Get a nested field value using dot notation
 */
function getFieldValue(record: Record<string, unknown>, fieldPath: string): unknown {
  const parts = fieldPath.split('.');
  let value: unknown = record;
  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/**
 * Check if a requirement is satisfied
 */
function checkRequirement(requirement: Requirement, record: Record<string, unknown>): RequirementResult {
  const missingFields: string[] = [];
  let satisfied = true;

  if (requirement.predicate) {
    satisfied = requirement.predicate(record);
    if (!satisfied) {
      missingFields.push(...requirement.fieldPaths);
    }
  } else {
    for (const fieldPath of requirement.fieldPaths) {
      const value = getFieldValue(record, fieldPath);
      if (!hasValue(value)) {
        satisfied = false;
        missingFields.push(fieldPath);
      }
    }
  }

  return { requirement, satisfied, missingFields };
}

/**
 * Compute compliance for any procedure given its requirement groups.
 *
 * @param requirementGroups - The requirement groups for the procedure
 * @param record - The record data to validate
 * @param currentStatus - Current status of the record
 * @param statusOrder - Ordered list of statuses for the procedure
 * @param targetStatus - Optional specific target status (for transition validation)
 */
export function computeProcedureCompliance(
  requirementGroups: RequirementGroup[],
  record: Record<string, unknown>,
  currentStatus: string,
  statusOrder: string[],
  targetStatus?: string
): ComplianceResult {
  const blockingMissing: RequirementResult[] = [];
  const recommendedMissing: RequirementResult[] = [];
  const infoMissing: RequirementResult[] = [];
  const groups: GroupResult[] = [];

  // Determine which statuses we're checking requirements for
  const relevantStatuses = targetStatus
    ? [targetStatus]
    : getStatusesFromCurrent(currentStatus, statusOrder);

  let requiredTotal = 0;
  let requiredComplete = 0;
  let firstBlockingField: { sectionId: string; fieldPath: string } | null = null;

  for (const group of requirementGroups) {
    const groupResults: RequirementResult[] = [];
    const groupMissingLabels: string[] = [];
    const groupBlockingMissing: RequirementResult[] = [];
    let groupCompleted = 0;
    let groupTotal = 0;

    for (const requirement of group.requirements) {
      const result = checkRequirement(requirement, record);
      groupResults.push(result);

      const isRelevant = requirement.requiredForStatuses.some(s => relevantStatuses.includes(s));
      const shouldCount = requirement.severity !== 'info' || isRelevant;

      if (shouldCount) {
        groupTotal++;
        if (result.satisfied) {
          groupCompleted++;
        } else {
          groupMissingLabels.push(requirement.label);
        }
      }

      if (!result.satisfied) {
        const isBlockingForTarget = targetStatus
          ? requirement.requiredForStatuses.includes(targetStatus) && requirement.severity === 'blocking'
          : requirement.requiredForStatuses.some(s => relevantStatuses.includes(s)) && requirement.severity === 'blocking';

        if (isBlockingForTarget) {
          blockingMissing.push(result);
          groupBlockingMissing.push(result);

          if (!firstBlockingField && result.missingFields.length > 0) {
            firstBlockingField = {
              sectionId: group.sectionId,
              fieldPath: result.missingFields[0],
            };
          }
        } else if (requirement.severity === 'recommended') {
          recommendedMissing.push(result);
        } else {
          infoMissing.push(result);
        }
      }

      if (requirement.severity !== 'info') {
        requiredTotal++;
        if (result.satisfied) {
          requiredComplete++;
        }
      }
    }

    groups.push({
      group,
      completedCount: groupCompleted,
      totalCount: groupTotal,
      missingLabels: groupMissingLabels,
      blockingMissing: groupBlockingMissing,
      results: groupResults,
    });
  }

  const percentComplete = requiredTotal > 0
    ? Math.round((requiredComplete / requiredTotal) * 100)
    : 100;

  return {
    requiredTotal,
    requiredComplete,
    percentComplete,
    blockingMissing,
    recommendedMissing,
    infoMissing,
    groups,
    nextBlockingField: firstBlockingField,
  };
}

/**
 * Get all statuses that come after the current status in the workflow
 */
function getStatusesFromCurrent(currentStatus: string, statusOrder: string[]): string[] {
  const currentIndex = statusOrder.indexOf(currentStatus);
  if (currentIndex === -1) return [];
  return statusOrder.slice(currentIndex + 1);
}

/**
 * Generic transition check for any procedure.
 * Returns blocking requirements for advisory display, but always allows the transition.
 * When enforcementEnabled is false (default), requirements are advisory —
 * allowed is always true but blockingRequirements are still populated for display.
 * When true, missing blocking requirements prevent the transition.
 */
export function canTransitionToProcedure(
  requirementGroups: RequirementGroup[],
  record: Record<string, unknown>,
  currentStatus: string,
  targetStatus: string,
  statusOrder: string[],
  enforcementEnabled: boolean = true,
): { allowed: boolean; blockingRequirements: RequirementResult[] } {
  const compliance = computeProcedureCompliance(requirementGroups, record, currentStatus, statusOrder, targetStatus);
  return {
    allowed: enforcementEnabled ? compliance.blockingMissing.length === 0 : true,
    blockingRequirements: compliance.blockingMissing,
  };
}

/**
 * Get the next status in a linear status order.
 * Returns null if the current status is the last one or not found.
 */
export function getNextStatus(currentStatus: string, statusOrder: string[]): string | null {
  const idx = statusOrder.indexOf(currentStatus);
  return idx >= 0 && idx < statusOrder.length - 1 ? statusOrder[idx + 1] : null;
}
