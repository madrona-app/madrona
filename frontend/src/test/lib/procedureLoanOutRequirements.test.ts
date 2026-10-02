import { describe, it, expect } from 'vitest';
import {
  LOAN_OUT_REQUIREMENT_GROUPS,
  computeLoanOutCompliance,
  canTransitionTo,
} from '../../lib/procedureLoanOutRequirements';

describe('procedureLoanOutRequirements', () => {
  describe('LOAN_OUT_REQUIREMENT_GROUPS', () => {
    it('exposes at least one group', () => {
      expect(LOAN_OUT_REQUIREMENT_GROUPS.length).toBeGreaterThan(0);
    });

    it('every requirement has a non-empty label', () => {
      for (const group of LOAN_OUT_REQUIREMENT_GROUPS) {
        for (const req of group.requirements) {
          expect(req.label).toBeTruthy();
        }
      }
    });
  });

  describe('computeLoanOutCompliance', () => {
    it('returns required count > 0 for empty record', () => {
      const result = computeLoanOutCompliance({}, 'requested');
      expect(result.requiredTotal).toBeGreaterThan(0);
    });

    it('exposes percentComplete in valid range', () => {
      const result = computeLoanOutCompliance({}, 'requested');
      expect(result.percentComplete).toBeGreaterThanOrEqual(0);
      expect(result.percentComplete).toBeLessThanOrEqual(100);
    });

    it('exposes a groups array sized by REQUIREMENT_GROUPS', () => {
      const result = computeLoanOutCompliance({}, 'requested');
      expect(result.groups).toHaveLength(LOAN_OUT_REQUIREMENT_GROUPS.length);
    });
  });

  describe('canTransitionTo', () => {
    it('returns object with allowed and blockingRequirements', () => {
      const result = canTransitionTo({}, 'requested', 'pending_approval');
      expect(typeof result.allowed).toBe('boolean');
      expect(Array.isArray(result.blockingRequirements)).toBe(true);
    });
  });
});
