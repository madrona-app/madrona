import { describe, it, expect } from 'vitest';
import {
  ACQUISITION_REQUIREMENT_GROUPS,
  computeAcquisitionCompliance,
  canTransitionTo,
  getNextStatus,
  type AcquisitionStatus,
} from '../../lib/procedureAcquisitionRequirements';

describe('procedureAcquisitionRequirements', () => {
  describe('ACQUISITION_REQUIREMENT_GROUPS', () => {
    it('exposes at least one requirement group', () => {
      expect(ACQUISITION_REQUIREMENT_GROUPS.length).toBeGreaterThan(0);
    });

    it('every group has a non-empty requirements list', () => {
      for (const group of ACQUISITION_REQUIREMENT_GROUPS) {
        expect(group.requirements.length).toBeGreaterThan(0);
      }
    });

    it('every requirement has matching groupId', () => {
      for (const group of ACQUISITION_REQUIREMENT_GROUPS) {
        for (const req of group.requirements) {
          expect(req.groupId).toBe(group.id);
        }
      }
    });
  });

  describe('computeAcquisitionCompliance', () => {
    it('returns a compliance result', () => {
      const result = computeAcquisitionCompliance({}, 'proposed');
      expect(result.percentComplete).toBeGreaterThanOrEqual(0);
      expect(result.percentComplete).toBeLessThanOrEqual(100);
    });

    it('flags blocking missing for approved target', () => {
      const result = computeAcquisitionCompliance({}, 'proposed', 'approved');
      expect(result.blockingMissing.length).toBeGreaterThan(0);
    });

    it('reports 100% when required fields are present', () => {
      // Provide acquisition_method which is blocking for approved
      const result = computeAcquisitionCompliance(
        { acquisition_method: 'gift', acquisition_date: '2026-01-01' },
        'proposed',
        'approved',
      );
      // acquisition_method should not be in blocking
      expect(result.blockingMissing.some((r) => r.requirement.id === 'acquisition_method')).toBe(false);
    });
  });

  describe('canTransitionTo', () => {
    it('disallows transition with empty record to approved', () => {
      const result = canTransitionTo({}, 'proposed', 'approved');
      expect(result.allowed).toBe(false);
    });
  });

  describe('getNextStatus', () => {
    it('returns next status in linear workflow', () => {
      expect(getNextStatus('proposed')).toBe('approved');
      expect(getNextStatus('approved')).toBe('completed');
    });

    it('returns null for terminal statuses', () => {
      expect(getNextStatus('completed' as AcquisitionStatus)).toBeNull();
      expect(getNextStatus('cancelled' as AcquisitionStatus)).toBeNull();
    });
  });
});
