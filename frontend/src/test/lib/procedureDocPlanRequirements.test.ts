import { describe, it, expect } from 'vitest';
import {
  DOC_PLAN_REQUIREMENT_GROUPS,
  computeDocPlanCompliance,
  canTransitionTo,
  getNextStatus,
  type DocPlanStatus,
} from '../../lib/procedureDocPlanRequirements';

describe('procedureDocPlanRequirements', () => {
  describe('DOC_PLAN_REQUIREMENT_GROUPS', () => {
    it('exposes at least one group', () => {
      expect(DOC_PLAN_REQUIREMENT_GROUPS.length).toBeGreaterThan(0);
    });

    it('every group has a sectionId', () => {
      for (const group of DOC_PLAN_REQUIREMENT_GROUPS) {
        expect(group.sectionId).toBeTruthy();
      }
    });
  });

  describe('computeDocPlanCompliance', () => {
    it('returns a result with the expected shape', () => {
      const result = computeDocPlanCompliance({}, 'draft');
      expect(result).toHaveProperty('requiredTotal');
      expect(result).toHaveProperty('requiredComplete');
      expect(result).toHaveProperty('percentComplete');
      expect(result).toHaveProperty('blockingMissing');
      expect(result).toHaveProperty('groups');
    });

    it('handles being called with no targetStatus', () => {
      expect(() => computeDocPlanCompliance({}, 'draft')).not.toThrow();
    });
  });

  describe('canTransitionTo', () => {
    it('reports allowed and blockingRequirements', () => {
      const result = canTransitionTo({}, 'draft', 'approved');
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('blockingRequirements');
    });
  });

  describe('getNextStatus', () => {
    it('returns the next status in the linear workflow', () => {
      expect(getNextStatus('draft')).toBe('approved');
      expect(getNextStatus('approved')).toBe('in_progress');
      expect(getNextStatus('in_progress')).toBe('completed');
    });

    it('returns null for terminal statuses', () => {
      expect(getNextStatus('completed' as DocPlanStatus)).toBeNull();
      expect(getNextStatus('superseded' as DocPlanStatus)).toBeNull();
      expect(getNextStatus('cancelled' as DocPlanStatus)).toBeNull();
    });
  });
});
