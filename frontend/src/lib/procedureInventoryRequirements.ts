/**
 * Inventory & Cataloging Requirements
 *
 * Two separate requirement sets:
 *
 * INVENTORY — Core accountability.
 * "Can you account for every object in your care?"
 * Pass/fail for audit compliance. 5 required fields.
 *
 * CATALOGING — Full scholarly documentation.
 * "Is the object fully documented for research, exhibition, and access?"
 * Progress indicator for documentation depth. 11 fields.
 */

import type { RequirementGroup } from './procedureComplianceUtils';
import { computeProcedureCompliance } from './procedureComplianceUtils';


// ============================================================================
// INVENTORY — Core accountability (5 required fields)
// ============================================================================

export const INVENTORY_REQUIREMENT_GROUPS: RequirementGroup[] = [
  {
    id: 'identification',
    label: 'Identification',
    sectionId: 'identification',
    requirements: [
      {
        id: 'object_number',
        label: 'Object number',
        groupId: 'identification',
        fieldPaths: ['object_number'],
        requiredForStatuses: ['inventory_complete'],
        severity: 'blocking',
        helpText: 'A unique number securely associated with the object.',
      },
      {
        id: 'object_name',
        label: 'Object name',
        groupId: 'identification',
        fieldPaths: ['object_name'],
        requiredForStatuses: ['inventory_complete'],
        severity: 'blocking',
        helpText: 'What the object is — e.g. painting, vase, photograph.',
      },
      {
        id: 'object_status',
        label: 'Object status',
        groupId: 'identification',
        fieldPaths: ['object_status'],
        requiredForStatuses: ['inventory_complete'],
        severity: 'blocking',
        helpText: 'Current status in the collection — accessioned, on loan, etc.',
      },
    ],
  },
  {
    id: 'description',
    label: 'Description',
    sectionId: 'description',
    requirements: [
      {
        id: 'brief_description',
        label: 'Brief description',
        groupId: 'description',
        fieldPaths: ['brief_description'],
        requiredForStatuses: ['inventory_complete'],
        severity: 'blocking',
        helpText: 'A brief description sufficient to identify the object. An image can substitute.',
      },
    ],
  },
  {
    id: 'location',
    label: 'Location',
    sectionId: 'location',
    requirements: [
      {
        id: 'current_location_id',
        label: 'Current location',
        groupId: 'location',
        fieldPaths: ['current_location_id'],
        requiredForStatuses: ['inventory_complete'],
        severity: 'blocking',
        helpText: 'Where the object is right now.',
      },
    ],
  },
];


// ============================================================================
// CATALOGING — Full documentation (11 fields)
// ============================================================================

export const CATALOGING_REQUIREMENT_GROUPS: RequirementGroup[] = [
  {
    id: 'identification',
    label: 'Identification',
    sectionId: 'identification',
    requirements: [
      {
        id: 'title',
        label: 'Title',
        groupId: 'identification',
        fieldPaths: ['titles'],
        requiredForStatuses: ['cataloging_complete'],
        severity: 'blocking',
        helpText: 'The title of the object, if applicable (CDWA 1).',
      },
      {
        id: 'object_type',
        label: 'Object type',
        groupId: 'identification',
        fieldPaths: ['object_type'],
        requiredForStatuses: ['cataloging_complete'],
        severity: 'blocking',
        helpText: 'Classification or type of work — e.g. oil painting, lithograph (CDWA 9).',
      },
    ],
  },
  {
    id: 'production',
    label: 'Production',
    sectionId: 'people',
    requirements: [
      {
        id: 'creator',
        label: 'Creator / maker',
        groupId: 'production',
        fieldPaths: ['constituents'],
        requiredForStatuses: ['cataloging_complete'],
        severity: 'blocking',
        helpText: 'Who created or produced the object (CDWA 5).',
      },
      {
        id: 'creation_date',
        label: 'Date of production',
        groupId: 'production',
        fieldPaths: ['creation_date_display'],
        requiredForStatuses: ['cataloging_complete'],
        severity: 'blocking',
        helpText: 'When the object was created — e.g. c. 1890, 19th century (CDWA 6).',
      },
      {
        id: 'creation_place',
        label: 'Place of creation',
        groupId: 'production',
        fieldPaths: ['creation_place'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'Where the object was created or found (CDWA 7).',
      },
    ],
  },
  {
    id: 'physical',
    label: 'Physical Characteristics',
    sectionId: 'physical',
    requirements: [
      {
        id: 'materials',
        label: 'Materials',
        groupId: 'physical',
        fieldPaths: ['material_count'],
        requiredForStatuses: ['cataloging_complete'],
        severity: 'blocking',
        helpText: 'What the object is made of (CDWA 12).',
      },
      {
        id: 'measurements',
        label: 'Dimensions',
        groupId: 'physical',
        fieldPaths: ['measurements'],
        requiredForStatuses: ['cataloging_complete'],
        severity: 'blocking',
        helpText: 'Height, width, depth, weight, or other measurements (CDWA 13).',
      },
    ],
  },
  {
    id: 'acquisition',
    label: 'Acquisition',
    sectionId: 'acquisition',
    requirements: [
      {
        id: 'credit_line',
        label: 'Credit line',
        groupId: 'acquisition',
        fieldPaths: ['credit_line'],
        requiredForStatuses: ['cataloging_complete'],
        severity: 'blocking',
        helpText: 'Acknowledgment of the source — e.g. Gift of John Smith, 2024.',
      },
    ],
  },
  {
    id: 'condition',
    label: 'Condition',
    sectionId: 'condition',
    requirements: [
      {
        id: 'condition_rating',
        label: 'Condition rating',
        groupId: 'condition',
        fieldPaths: ['condition_rating'],
        requiredForStatuses: [],
        severity: 'recommended',
        helpText: 'Current condition assessment — excellent, good, fair, poor.',
      },
    ],
  },
  {
    id: 'media',
    label: 'Image',
    sectionId: 'media',
    requirements: [
      {
        id: 'has_image',
        label: 'Object image',
        groupId: 'media',
        fieldPaths: ['primary_image_url'],
        requiredForStatuses: ['cataloging_complete'],
        severity: 'blocking',
        helpText: 'A photograph of the object.',
      },
    ],
  },
];

/**
 * Compute inventory completeness for a collection object.
 *
 * Uses a synthetic "inventory_complete" status to check all core requirements.
 * The result shows which procedure core inventory fields are populated.
 */
export function computeInventoryCompleteness(
  record: Record<string, unknown>,
) {
  return computeProcedureCompliance(
    INVENTORY_REQUIREMENT_GROUPS,
    record,
    'current', // synthetic current status
    ['current', 'inventory_complete'], // synthetic status order
    'inventory_complete' // target: check all core requirements
  );
}
