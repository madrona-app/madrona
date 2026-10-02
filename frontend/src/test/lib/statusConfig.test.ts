import { describe, it, expect } from 'vitest';
import {
  getStatusConfig,
  getStatusLabel,
  getStatusOptions,
  isTerminalStatus,
} from '../../lib/statusConfig';

describe('statusConfig', () => {
  describe('getStatusConfig', () => {
    it('returns configured status for object_entry pending', () => {
      const cfg = getStatusConfig('object_entry', 'pending');
      expect(cfg.label).toBe('Pending');
      expect(cfg.className).toContain('semantic-warning');
      expect(cfg.icon).toBeDefined();
    });

    it('returns configured status for loan_in on_loan', () => {
      const cfg = getStatusConfig('loan_in', 'on_loan');
      expect(cfg.label).toBe('On Loan');
      expect(cfg.className).toContain('semantic-success');
    });

    it('returns a fallback with humanized label for unknown status within known entity', () => {
      const cfg = getStatusConfig('object_entry', 'some_unknown_state');
      expect(cfg.label).toBe('Some Unknown State');
      expect(cfg.className).toContain('archive');
    });

    it('returns raw status label for unknown entity type', () => {
      const cfg = getStatusConfig('not_a_real_entity' as never, 'whatever');
      expect(cfg.label).toBe('whatever');
      expect(cfg.icon).toBeDefined();
    });

    it('covers all documented entity types with at least one status', () => {
      const entities = [
        'object_entry', 'object_exit', 'loan_in', 'loan_out',
        'acquisition', 'deaccession', 'condition_report', 'conservation',
        'movement', 'use_request', 'valuation', 'insurance_claim', 'exhibition',
      ] as const;
      for (const et of entities) {
        const opts = getStatusOptions(et);
        expect(opts.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getStatusLabel', () => {
    it('returns the label for a valid status', () => {
      expect(getStatusLabel('loan_out', 'returned')).toBe('Returned');
    });

    it('returns a humanized label for unknown status', () => {
      expect(getStatusLabel('acquisition', 'unheard_of')).toBe('Unheard Of');
    });
  });

  describe('getStatusOptions', () => {
    it('returns array of {value, label} for an entity type', () => {
      const opts = getStatusOptions('acquisition');
      expect(Array.isArray(opts)).toBe(true);
      expect(opts.length).toBeGreaterThan(0);
      for (const opt of opts) {
        expect(typeof opt.value).toBe('string');
        expect(typeof opt.label).toBe('string');
      }
    });

    it('returns empty array for unknown entity type', () => {
      expect(getStatusOptions('fake_entity' as never)).toEqual([]);
    });

    it('includes the "proposed" status for acquisitions', () => {
      const opts = getStatusOptions('acquisition');
      expect(opts.some(o => o.value === 'proposed')).toBe(true);
    });
  });

  describe('isTerminalStatus', () => {
    it('returns true for acquisition accessioned and cancelled', () => {
      expect(isTerminalStatus('acquisition', 'accessioned')).toBe(true);
      expect(isTerminalStatus('acquisition', 'cancelled')).toBe(true);
    });

    it('returns false for in-progress statuses', () => {
      expect(isTerminalStatus('acquisition', 'proposed')).toBe(false);
      expect(isTerminalStatus('acquisition', 'approved')).toBe(false);
    });

    it('returns true for loan_in terminal states', () => {
      expect(isTerminalStatus('loan_in', 'returned')).toBe(true);
      expect(isTerminalStatus('loan_in', 'closed')).toBe(true);
      expect(isTerminalStatus('loan_in', 'declined')).toBe(true);
      expect(isTerminalStatus('loan_in', 'cancelled')).toBe(true);
    });

    it('returns false for unknown entity type', () => {
      expect(isTerminalStatus('mystery' as never, 'closed')).toBe(false);
    });

    it('returns false for unknown status on known entity type', () => {
      expect(isTerminalStatus('movement', 'bogus')).toBe(false);
    });
  });
});
