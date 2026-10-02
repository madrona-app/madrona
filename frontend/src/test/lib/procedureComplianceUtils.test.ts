import { describe, it, expect } from 'vitest';
import {
  computeProcedureCompliance,
  canTransitionToProcedure,
  getNextStatus,
  type RequirementGroup,
} from '../../lib/procedureComplianceUtils';

const STATUS_ORDER = ['draft', 'review', 'approved', 'completed'];

const SAMPLE_GROUPS: RequirementGroup[] = [
  {
    id: 'basic',
    label: 'Basic',
    sectionId: 'basic',
    requirements: [
      {
        id: 'title',
        label: 'Title',
        groupId: 'basic',
        fieldPaths: ['title'],
        requiredForStatuses: ['review', 'approved', 'completed'],
        severity: 'blocking',
      },
      {
        id: 'description',
        label: 'Description',
        groupId: 'basic',
        fieldPaths: ['description'],
        requiredForStatuses: ['approved', 'completed'],
        severity: 'recommended',
      },
    ],
  },
  {
    id: 'meta',
    label: 'Meta',
    sectionId: 'meta',
    requirements: [
      {
        id: 'note',
        label: 'Note',
        groupId: 'meta',
        fieldPaths: ['meta.note'],
        requiredForStatuses: ['completed'],
        severity: 'info',
      },
    ],
  },
];

describe('procedureComplianceUtils', () => {
  describe('computeProcedureCompliance', () => {
    it('reports 100% complete when all required fields present', () => {
      const record = { title: 'My Title', description: 'desc' };
      const result = computeProcedureCompliance(SAMPLE_GROUPS, record, 'review', STATUS_ORDER);
      expect(result.requiredComplete).toBeGreaterThan(0);
      expect(result.percentComplete).toBe(100);
    });

    it('flags missing blocking field', () => {
      const record = {};
      const result = computeProcedureCompliance(
        SAMPLE_GROUPS,
        record,
        'draft',
        STATUS_ORDER,
        'review',
      );
      expect(result.blockingMissing.length).toBeGreaterThan(0);
      expect(result.blockingMissing[0].requirement.id).toBe('title');
    });

    it('flags missing recommended field separately from blocking', () => {
      const record = { title: 'Has title' };
      const result = computeProcedureCompliance(
        SAMPLE_GROUPS,
        record,
        'review',
        STATUS_ORDER,
        'approved',
      );
      expect(result.recommendedMissing.length).toBeGreaterThan(0);
      expect(result.recommendedMissing[0].requirement.id).toBe('description');
      expect(result.blockingMissing).toHaveLength(0);
    });

    it('treats empty string as missing', () => {
      const record = { title: '   ' };
      const result = computeProcedureCompliance(
        SAMPLE_GROUPS,
        record,
        'draft',
        STATUS_ORDER,
        'review',
      );
      expect(result.blockingMissing.some((r) => r.requirement.id === 'title')).toBe(true);
    });

    it('treats false boolean as missing', () => {
      const groups: RequirementGroup[] = [
        {
          id: 'g',
          label: 'G',
          sectionId: 's',
          requirements: [
            {
              id: 'check',
              label: 'Check',
              groupId: 'g',
              fieldPaths: ['check'],
              requiredForStatuses: ['review'],
              severity: 'blocking',
            },
          ],
        },
      ];
      const result = computeProcedureCompliance(groups, { check: false }, 'draft', STATUS_ORDER, 'review');
      expect(result.blockingMissing).toHaveLength(1);
    });

    it('treats empty array as missing', () => {
      const groups: RequirementGroup[] = [
        {
          id: 'g',
          label: 'G',
          sectionId: 's',
          requirements: [
            {
              id: 'list',
              label: 'List',
              groupId: 'g',
              fieldPaths: ['list'],
              requiredForStatuses: ['review'],
              severity: 'blocking',
            },
          ],
        },
      ];
      const result = computeProcedureCompliance(groups, { list: [] }, 'draft', STATUS_ORDER, 'review');
      expect(result.blockingMissing).toHaveLength(1);
    });

    it('uses dot notation to navigate nested fields', () => {
      const record = { meta: { note: 'present' } };
      const result = computeProcedureCompliance(SAMPLE_GROUPS, record, 'completed', STATUS_ORDER, 'completed');
      const noteResult = result.groups.find((g) => g.group.id === 'meta')?.results.find((r) => r.requirement.id === 'note');
      expect(noteResult?.satisfied).toBe(true);
    });

    it('reports nextBlockingField with sectionId and fieldPath', () => {
      const record = {};
      const result = computeProcedureCompliance(
        SAMPLE_GROUPS,
        record,
        'draft',
        STATUS_ORDER,
        'review',
      );
      expect(result.nextBlockingField).toEqual({
        sectionId: 'basic',
        fieldPath: 'title',
      });
    });

    it('uses custom predicate when provided', () => {
      const groups: RequirementGroup[] = [
        {
          id: 'g',
          label: 'G',
          sectionId: 's',
          requirements: [
            {
              id: 'pred',
              label: 'Predicate',
              groupId: 'g',
              fieldPaths: ['x'],
              predicate: (r) => r.special === true,
              requiredForStatuses: ['review'],
              severity: 'blocking',
            },
          ],
        },
      ];
      const passing = computeProcedureCompliance(
        groups,
        { special: true },
        'draft',
        STATUS_ORDER,
        'review',
      );
      expect(passing.blockingMissing).toHaveLength(0);

      const failing = computeProcedureCompliance(
        groups,
        { special: false },
        'draft',
        STATUS_ORDER,
        'review',
      );
      expect(failing.blockingMissing).toHaveLength(1);
    });

    it('returns 100% when no required fields', () => {
      const empty: RequirementGroup[] = [];
      const result = computeProcedureCompliance(empty, {}, 'draft', STATUS_ORDER);
      expect(result.percentComplete).toBe(100);
      expect(result.requiredTotal).toBe(0);
    });
  });

  describe('canTransitionToProcedure', () => {
    it('allows transition when no blocking missing (enforcement on)', () => {
      const record = { title: 'present' };
      const result = canTransitionToProcedure(
        SAMPLE_GROUPS,
        record,
        'draft',
        'review',
        STATUS_ORDER,
        true,
      );
      expect(result.allowed).toBe(true);
      expect(result.blockingRequirements).toHaveLength(0);
    });

    it('disallows transition when blocking missing and enforcement is on', () => {
      const result = canTransitionToProcedure(
        SAMPLE_GROUPS,
        {},
        'draft',
        'review',
        STATUS_ORDER,
        true,
      );
      expect(result.allowed).toBe(false);
      expect(result.blockingRequirements.length).toBeGreaterThan(0);
    });

    it('always allows transition when enforcement is off, but reports missing', () => {
      const result = canTransitionToProcedure(
        SAMPLE_GROUPS,
        {},
        'draft',
        'review',
        STATUS_ORDER,
        false,
      );
      expect(result.allowed).toBe(true);
      expect(result.blockingRequirements.length).toBeGreaterThan(0);
    });
  });

  describe('getNextStatus', () => {
    it('returns the next status in the order', () => {
      expect(getNextStatus('draft', STATUS_ORDER)).toBe('review');
      expect(getNextStatus('review', STATUS_ORDER)).toBe('approved');
    });

    it('returns null for the last status', () => {
      expect(getNextStatus('completed', STATUS_ORDER)).toBeNull();
    });

    it('returns null for unknown status', () => {
      expect(getNextStatus('not-a-status', STATUS_ORDER)).toBeNull();
    });

    it('returns null for empty status order', () => {
      expect(getNextStatus('draft', [])).toBeNull();
    });
  });
});
