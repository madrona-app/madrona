import { describe, it, expect } from 'vitest';
import {
  DEACCESSION_REQUIREMENT_GROUPS,
  computeDeaccessionCompliance,
  canTransitionTo,
  getNextStatus,
  type DeaccessionStatus,
} from '../../lib/procedureDeaccessionRequirements';

describe('procedureDeaccessionRequirements', () => {
  describe('DEACCESSION_REQUIREMENT_GROUPS', () => {
    it('has the expected groups', () => {
      const ids = DEACCESSION_REQUIREMENT_GROUPS.map((g) => g.id);
      expect(ids).toContain('linkedObject');
      expect(ids).toContain('info');
      expect(ids).toContain('disposal');
    });

    it('every requirement has at least one fieldPath', () => {
      for (const group of DEACCESSION_REQUIREMENT_GROUPS) {
        for (const req of group.requirements) {
          expect(req.fieldPaths.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('computeDeaccessionCompliance', () => {
    it('computes compliance for an empty record', () => {
      const result = computeDeaccessionCompliance({}, 'proposed');
      expect(result).toBeDefined();
      expect(result.requiredTotal).toBeGreaterThan(0);
    });

    it('considers proposal_date and reason missing for under_review target', () => {
      const result = computeDeaccessionCompliance({}, 'proposed', 'under_review');
      expect(result.blockingMissing.some((r) => r.requirement.id === 'proposal_date')).toBe(true);
      expect(result.blockingMissing.some((r) => r.requirement.id === 'reason')).toBe(true);
    });

    it('clears blocking when required fields are filled', () => {
      const result = computeDeaccessionCompliance(
        {
          object_id: 'O-1',
          proposal_date: '2026-01-01',
          reason: 'duplicate',
        },
        'proposed',
        'under_review',
      );
      expect(result.blockingMissing).toHaveLength(0);
    });

    it('skips board_approval requirements when not required', () => {
      const result = computeDeaccessionCompliance(
        {
          object_id: 'O-1',
          proposal_date: '2026-01-01',
          reason: 'duplicate',
          board_approval_required: false,
          committee_review_date: '2026-02-01',
          committee_recommendation: 'approve',
          legal_review_date: '2026-02-02',
          disposal_method: 'sale',
        },
        'pending_board',
        'approved',
      );
      // board_approval_date/reference should not block since required=false
      expect(result.blockingMissing.some((r) => r.requirement.id === 'board_approval_date')).toBe(false);
    });

    it('flags board_approval_date when board_approval_required is true', () => {
      const result = computeDeaccessionCompliance(
        {
          object_id: 'O-1',
          proposal_date: '2026-01-01',
          reason: 'duplicate',
          board_approval_required: true,
        },
        'pending_board',
        'approved',
      );
      expect(result.blockingMissing.some((r) => r.requirement.id === 'board_approval_date')).toBe(true);
    });
  });

  describe('canTransitionTo', () => {
    it('disallows transition when blocking fields are missing', () => {
      const result = canTransitionTo({}, 'proposed', 'under_review');
      expect(result.allowed).toBe(false);
      expect(result.blockingRequirements.length).toBeGreaterThan(0);
    });

    it('allows transition when fields are present', () => {
      const result = canTransitionTo(
        {
          object_id: 'O-1',
          proposal_date: '2026-01-01',
          reason: 'duplicate',
        },
        'proposed',
        'under_review',
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe('getNextStatus', () => {
    it('returns the next status in the workflow', () => {
      expect(getNextStatus('proposed')).toBe('under_review');
      expect(getNextStatus('under_review')).toBe('committee_reviewed');
      expect(getNextStatus('approved')).toBe('in_progress');
    });

    it('returns null for terminal statuses', () => {
      expect(getNextStatus('completed' as DeaccessionStatus)).toBeNull();
      expect(getNextStatus('cancelled' as DeaccessionStatus)).toBeNull();
      expect(getNextStatus('rejected' as DeaccessionStatus)).toBeNull();
    });
  });
});
