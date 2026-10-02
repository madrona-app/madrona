import { describe, it, expect } from 'vitest';
import {
  OBJECT_EXIT_REQUIREMENT_GROUPS,
  computeObjectExitCompliance,
  canTransitionTo,
  getNextStatus,
  type ObjectExitStatus,
} from '../../lib/procedureObjectExitRequirements';

describe('procedureObjectExitRequirements', () => {
  describe('OBJECT_EXIT_REQUIREMENT_GROUPS', () => {
    it('exposes at least one requirement group', () => {
      expect(OBJECT_EXIT_REQUIREMENT_GROUPS.length).toBeGreaterThan(0);
    });
  });

  describe('computeObjectExitCompliance', () => {
    it('reports missing for empty record', () => {
      const result = computeObjectExitCompliance({}, 'pending', 'preparing');
      expect(result.blockingMissing.length).toBeGreaterThan(0);
    });

    it('reduces missing when fields populated', () => {
      const filled = computeObjectExitCompliance(
        {
          exit_date: '2026-01-01',
          exit_reason: 'return',
          recipient_name: 'Owner',
        },
        'pending',
        'preparing',
      );
      const empty = computeObjectExitCompliance({}, 'pending', 'preparing');
      expect(filled.blockingMissing.length).toBeLessThan(empty.blockingMissing.length);
    });
  });

  describe('canTransitionTo', () => {
    it('returns object with allowed and blockingRequirements', () => {
      const result = canTransitionTo({}, 'pending', 'preparing');
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('blockingRequirements');
    });
  });

  describe('getNextStatus', () => {
    it('returns the next status in workflow', () => {
      expect(getNextStatus('pending')).toBe('preparing');
      expect(getNextStatus('preparing')).toBe('dispatched');
    });

    it('returns null for terminal statuses', () => {
      expect(getNextStatus('acknowledged' as ObjectExitStatus)).toBeNull();
      expect(getNextStatus('cancelled' as ObjectExitStatus)).toBeNull();
    });
  });
});
