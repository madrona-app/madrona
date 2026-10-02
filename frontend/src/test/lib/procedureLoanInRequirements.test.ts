import { describe, it, expect } from 'vitest';
import {
  LOAN_IN_REQUIREMENT_GROUPS,
  computeLoanInCompliance,
  canTransitionTo,
} from '../../lib/procedureLoanInRequirements';

describe('procedureLoanInRequirements', () => {
  describe('LOAN_IN_REQUIREMENT_GROUPS', () => {
    it('exposes at least one group', () => {
      expect(LOAN_IN_REQUIREMENT_GROUPS.length).toBeGreaterThan(0);
    });

    it('exposes a "lender" group', () => {
      const ids = LOAN_IN_REQUIREMENT_GROUPS.map((g) => g.id);
      expect(ids).toContain('lender');
    });
  });

  describe('computeLoanInCompliance', () => {
    it('reports blocking for empty record targeting "approved"', () => {
      const result = computeLoanInCompliance({}, 'requested', 'approved');
      expect(result.blockingMissing.length).toBeGreaterThan(0);
      expect(result.blockingMissing.some((r) => r.requirement.id === 'lender_id')).toBe(true);
    });

    it('reports requiredTotal greater than zero', () => {
      const result = computeLoanInCompliance({}, 'requested');
      expect(result.requiredTotal).toBeGreaterThan(0);
    });

    it('clears blocking when required fields are filled for approved transition', () => {
      const record = {
        lender_id: 'L-1',
        loan_purpose: 'exhibit',
        objects: [{ id: 'o1' }],
      };
      const result = computeLoanInCompliance(record, 'requested', 'approved');
      // The three blocking fields above should be cleared
      const blockingIds = result.blockingMissing.map((r) => r.requirement.id);
      expect(blockingIds).not.toContain('lender_id');
      expect(blockingIds).not.toContain('loan_purpose');
      expect(blockingIds).not.toContain('objects');
    });

    it('does not throw on unknown current status', () => {
      expect(() => computeLoanInCompliance({}, 'requested')).not.toThrow();
    });
  });

  describe('canTransitionTo', () => {
    it('returns an object with allowed and blockingRequirements', () => {
      const result = canTransitionTo({}, 'requested', 'pending_approval');
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('blockingRequirements');
    });
  });
});
