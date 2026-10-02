import { describe, it, expect } from 'vitest';
import {
  MOVEMENT_REQUIREMENT_GROUPS,
  computeMovementCompliance,
  canTransitionTo,
  getNextStatus,
  type MovementStatus,
} from '../../lib/procedureMovementRequirements';

describe('procedureMovementRequirements', () => {
  describe('MOVEMENT_REQUIREMENT_GROUPS', () => {
    it('exposes at least one group', () => {
      expect(MOVEMENT_REQUIREMENT_GROUPS.length).toBeGreaterThan(0);
    });

    it('every requirement references at least one fieldPath', () => {
      for (const g of MOVEMENT_REQUIREMENT_GROUPS) {
        for (const r of g.requirements) {
          expect(r.fieldPaths.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('computeMovementCompliance', () => {
    it('flags missing required fields for in_transit transition', () => {
      const result = computeMovementCompliance({}, 'pending', 'in_transit');
      expect(result.blockingMissing.length).toBeGreaterThan(0);
    });

    it('reduces blocking when fields are populated', () => {
      const baseline = computeMovementCompliance({}, 'pending', 'in_transit');
      const filled = computeMovementCompliance(
        {
          object_id: 'O-1',
          to_location_id: 'L-2',
          movement_date: '2026-01-01',
          reason: 'storage',
        },
        'pending',
        'in_transit',
      );
      expect(filled.blockingMissing.length).toBeLessThan(baseline.blockingMissing.length);
    });
  });

  describe('canTransitionTo', () => {
    it('returns false when blocking fields missing', () => {
      const result = canTransitionTo({}, 'pending', 'in_transit');
      expect(result.allowed).toBe(false);
    });
  });

  describe('getNextStatus', () => {
    it('returns next status in workflow', () => {
      expect(getNextStatus('pending')).toBe('in_transit');
      expect(getNextStatus('in_transit')).toBe('completed');
    });

    it('returns null for terminal statuses', () => {
      expect(getNextStatus('completed' as MovementStatus)).toBeNull();
      expect(getNextStatus('cancelled' as MovementStatus)).toBeNull();
    });
  });
});
