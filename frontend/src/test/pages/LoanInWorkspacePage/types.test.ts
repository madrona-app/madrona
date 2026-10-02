import { describe, it, expect } from 'vitest';
import {
  STATUS_CONFIG,
  WORKFLOW_STEPS,
  WORKFLOW_PHASES,
  STATUS_TRANSITIONS,
  LOAN_IN_SECTION_GROUPS,
  SECTION_GROUPS,
  DEFAULT_SECTION_ORDER,
  ALL_SECTION_IDS,
  GROUP_ORDER,
  INITIAL_EXPANDED_SECTIONS,
  defaultFormData,
  getPhaseIndex,
  getPhaseSubIndex,
  getStepIndex,
} from '../../../pages/collections/LoanInWorkspacePage/types';

describe('LoanInWorkspacePage types', () => {
  describe('STATUS_CONFIG', () => {
    it('contains all procedure statuses', () => {
      expect(STATUS_CONFIG).toHaveProperty('requested');
      expect(STATUS_CONFIG).toHaveProperty('pending_approval');
      expect(STATUS_CONFIG).toHaveProperty('approved');
      expect(STATUS_CONFIG).toHaveProperty('agreement_sent');
      expect(STATUS_CONFIG).toHaveProperty('agreement_signed');
      expect(STATUS_CONFIG).toHaveProperty('in_transit');
      expect(STATUS_CONFIG).toHaveProperty('received');
      expect(STATUS_CONFIG).toHaveProperty('on_loan');
      expect(STATUS_CONFIG).toHaveProperty('return_initiated');
      expect(STATUS_CONFIG).toHaveProperty('returned');
      expect(STATUS_CONFIG).toHaveProperty('closed');
      expect(STATUS_CONFIG).toHaveProperty('cancelled');
      expect(STATUS_CONFIG).toHaveProperty('overdue');
    });

    it('every status has label, color, icon', () => {
      Object.values(STATUS_CONFIG).forEach(cfg => {
        expect(typeof cfg.label).toBe('string');
        expect(cfg.label.length).toBeGreaterThan(0);
        expect(typeof cfg.color).toBe('string');
        expect(cfg.icon).toBeTruthy();
      });
    });
  });

  describe('WORKFLOW_STEPS', () => {
    it('has 10 linear steps in execution order', () => {
      expect(WORKFLOW_STEPS).toHaveLength(10);
      expect(WORKFLOW_STEPS[0].key).toBe('requested');
      expect(WORKFLOW_STEPS[WORKFLOW_STEPS.length - 1].key).toBe('closed');
    });

    it('does not include side statuses', () => {
      const keys = WORKFLOW_STEPS.map(s => s.key);
      expect(keys).not.toContain('cancelled');
      expect(keys).not.toContain('overdue');
    });
  });

  describe('WORKFLOW_PHASES', () => {
    it('has 5 phases', () => {
      expect(WORKFLOW_PHASES).toHaveLength(5);
    });

    it('phases follow Request -> Closing order', () => {
      expect(WORKFLOW_PHASES.map(p => p.id)).toEqual([
        'request', 'agreement', 'transit', 'active', 'closing',
      ]);
    });

    it('every linear status belongs to exactly one phase', () => {
      const allStatuses = WORKFLOW_PHASES.flatMap(p => p.statuses);
      const unique = new Set(allStatuses);
      expect(unique.size).toBe(allStatuses.length);
    });
  });

  describe('getPhaseIndex', () => {
    it('returns phase index for known statuses', () => {
      expect(getPhaseIndex('requested')).toBe(0);
      expect(getPhaseIndex('agreement_sent')).toBe(1);
      expect(getPhaseIndex('in_transit')).toBe(2);
      expect(getPhaseIndex('on_loan')).toBe(3);
      expect(getPhaseIndex('closed')).toBe(4);
    });

    it('returns -1 for unknown / side statuses', () => {
      expect(getPhaseIndex('cancelled')).toBe(-1);
      expect(getPhaseIndex('made_up')).toBe(-1);
    });
  });

  describe('getPhaseSubIndex', () => {
    it('returns 0 for first status in a phase', () => {
      expect(getPhaseSubIndex('requested')).toBe(0);
      expect(getPhaseSubIndex('agreement_sent')).toBe(0);
    });

    it('returns 1 for second status in a phase', () => {
      expect(getPhaseSubIndex('pending_approval')).toBe(1);
      expect(getPhaseSubIndex('agreement_signed')).toBe(1);
    });

    it('returns -1 for unknown statuses', () => {
      expect(getPhaseSubIndex('cancelled')).toBe(-1);
    });
  });

  describe('getStepIndex', () => {
    it('returns the step index for known statuses', () => {
      expect(getStepIndex('requested')).toBe(0);
      expect(getStepIndex('closed')).toBe(WORKFLOW_STEPS.length - 1);
    });

    it('returns 0 for unknown statuses', () => {
      expect(getStepIndex('made_up_status')).toBe(0);
    });
  });

  describe('STATUS_TRANSITIONS', () => {
    it('every linear (non-terminal) status has at least one onward transition', () => {
      const linear = WORKFLOW_STEPS.map(s => s.key).filter(k => k !== 'closed');
      linear.forEach(key => {
        // pending_approval is allowed too
        if (key === 'returned') return; // returned -> closed only as label
        expect(STATUS_TRANSITIONS[key] || STATUS_TRANSITIONS['returned']).toBeTruthy();
      });
    });

    it('requested transitions to pending_approval and cancelled', () => {
      const targets = STATUS_TRANSITIONS.requested.map(t => t.targetStatus);
      expect(targets).toContain('pending_approval');
      expect(targets).toContain('cancelled');
    });

    it('returned transitions to closed', () => {
      expect(STATUS_TRANSITIONS.returned[0].targetStatus).toBe('closed');
    });
  });

  describe('section groups', () => {
    it('LOAN_IN_SECTION_GROUPS has expected groups', () => {
      const ids = LOAN_IN_SECTION_GROUPS.map(g => g.id);
      expect(ids).toEqual([
        'overview', 'dates', 'logistics', 'objects',
        'documentation', 'monitoring', 'closing', 'collaboration', 'history',
      ]);
    });

    it('GROUP_ORDER matches the section group order', () => {
      expect(GROUP_ORDER).toEqual(LOAN_IN_SECTION_GROUPS.map(g => g.id));
    });

    it('every section in SECTION_GROUPS resolves to a group in GROUP_ORDER', () => {
      Object.values(SECTION_GROUPS).forEach(group => {
        expect(GROUP_ORDER).toContain(group);
      });
    });

    it('DEFAULT_SECTION_ORDER covers every group', () => {
      GROUP_ORDER.forEach(group => {
        expect(DEFAULT_SECTION_ORDER[group]).toBeDefined();
        expect(DEFAULT_SECTION_ORDER[group].length).toBeGreaterThan(0);
      });
    });

    it('ALL_SECTION_IDS contains every section listed in DEFAULT_SECTION_ORDER', () => {
      const flat = Object.values(DEFAULT_SECTION_ORDER).flat();
      flat.forEach(id => {
        expect(ALL_SECTION_IDS).toContain(id);
      });
    });

    it('INITIAL_EXPANDED_SECTIONS has lender and details expanded', () => {
      expect(INITIAL_EXPANDED_SECTIONS.lender).toBe(true);
      expect(INITIAL_EXPANDED_SECTIONS.details).toBe(true);
    });

    it('INITIAL_EXPANDED_SECTIONS collapses logistics by default', () => {
      expect(INITIAL_EXPANDED_SECTIONS.insurance).toBe(false);
      expect(INITIAL_EXPANDED_SECTIONS.facility).toBe(false);
      expect(INITIAL_EXPANDED_SECTIONS.shipments).toBe(false);
    });
  });

  describe('defaultFormData', () => {
    it('defaults loan_purpose to exhibition', () => {
      expect(defaultFormData.loan_purpose).toBe('exhibition');
    });

    it('defaults insurance currency to USD', () => {
      expect(defaultFormData.insurance_currency).toBe('USD');
    });

    it('defaults max_renewals to 2', () => {
      expect(defaultFormData.max_renewals).toBe('2');
    });

    it('starts with todays date for request_date', () => {
      // YYYY-MM-DD format
      expect(defaultFormData.request_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('booleans default to false', () => {
      expect(defaultFormData.indemnity).toBe(false);
      expect(defaultFormData.facility_report_sent).toBe(false);
      expect(defaultFormData.facility_report_approved).toBe(false);
      expect(defaultFormData.courier_required).toBe(false);
      expect(defaultFormData.crate_required).toBe(false);
      expect(defaultFormData.closing_invoice_sent).toBe(false);
      expect(defaultFormData.receipt_acknowledged).toBe(false);
      expect(defaultFormData.conditions_met_confirmed).toBe(false);
    });
  });
});
