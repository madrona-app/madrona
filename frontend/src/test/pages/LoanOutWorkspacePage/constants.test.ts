import { describe, it, expect } from 'vitest';
import {
  STATUS_CONFIG,
  WORKFLOW_STEPS,
  STATUS_TRANSITIONS,
  LOAN_OUT_SECTION_GROUPS,
  SECTION_GROUPS,
  DEFAULT_SECTION_ORDER,
  ALL_SECTION_IDS,
  GROUP_ORDER,
  defaultFormData,
  CREATE_MODE_EXCLUDE,
} from '../../../pages/collections/LoanOutWorkspacePage/constants';

describe('LoanOutWorkspacePage constants', () => {
  describe('STATUS_CONFIG', () => {
    it('contains all the procedure statuses', () => {
      [
        'requested', 'pending_approval', 'approved', 'agreement_sent',
        'agreement_signed', 'in_transit', 'on_loan', 'return_scheduled',
        'returned', 'closed', 'declined', 'cancelled',
      ].forEach(s => expect(STATUS_CONFIG).toHaveProperty(s));
    });

    it('every status has a label, color, icon', () => {
      Object.values(STATUS_CONFIG).forEach(cfg => {
        expect(typeof cfg.label).toBe('string');
        expect(typeof cfg.color).toBe('string');
        expect(cfg.icon).toBeTruthy();
      });
    });

    it('uses semantic-error styling for cancelled / declined', () => {
      expect(STATUS_CONFIG.cancelled.color).toContain('semantic-error');
      expect(STATUS_CONFIG.declined.color).toContain('semantic-error');
    });

    it('uses semantic-success styling for on_loan (active)', () => {
      expect(STATUS_CONFIG.on_loan.color).toContain('semantic-success');
    });
  });

  describe('WORKFLOW_STEPS', () => {
    it('has 9 linear steps in execution order', () => {
      expect(WORKFLOW_STEPS).toHaveLength(9);
      expect(WORKFLOW_STEPS[0].key).toBe('requested');
      expect(WORKFLOW_STEPS[WORKFLOW_STEPS.length - 1].key).toBe('closed');
    });

    it('does not include side statuses (declined, cancelled)', () => {
      const keys = WORKFLOW_STEPS.map(s => s.key);
      expect(keys).not.toContain('declined');
      expect(keys).not.toContain('cancelled');
    });

    it('orders dispatch -> on_loan -> return correctly', () => {
      const keys = WORKFLOW_STEPS.map(s => s.key);
      const transitIdx = keys.indexOf('in_transit');
      const onLoanIdx = keys.indexOf('on_loan');
      const returnedIdx = keys.indexOf('returned');
      expect(transitIdx).toBeLessThan(onLoanIdx);
      expect(onLoanIdx).toBeLessThan(returnedIdx);
    });
  });

  describe('STATUS_TRANSITIONS', () => {
    it('requested permits approve and decline', () => {
      const targets = STATUS_TRANSITIONS.requested.map(t => t.targetStatus);
      expect(targets).toContain('approved');
      expect(targets).toContain('declined');
    });

    it('agreement_signed transitions to in_transit', () => {
      expect(STATUS_TRANSITIONS.agreement_signed[0].targetStatus).toBe('in_transit');
    });

    it('on_loan transitions to return_scheduled', () => {
      expect(STATUS_TRANSITIONS.on_loan[0].targetStatus).toBe('return_scheduled');
    });

    it('returned transitions to closed', () => {
      expect(STATUS_TRANSITIONS.returned[0].targetStatus).toBe('closed');
    });
  });

  describe('section groups', () => {
    it('LOAN_OUT_SECTION_GROUPS lists expected ordered groups', () => {
      const ids = LOAN_OUT_SECTION_GROUPS.map(g => g.id);
      expect(ids).toEqual([
        'overview', 'objects', 'dates', 'logistics',
        'documentation', 'monitoring', 'closing', 'collaboration', 'history',
      ]);
    });

    it('overview & objects default to expanded', () => {
      const overview = LOAN_OUT_SECTION_GROUPS.find(g => g.id === 'overview');
      const objects = LOAN_OUT_SECTION_GROUPS.find(g => g.id === 'objects');
      expect(overview?.defaultExpanded).toBe(true);
      expect(objects?.defaultExpanded).toBe(true);
    });

    it('GROUP_ORDER matches LOAN_OUT_SECTION_GROUPS', () => {
      expect(GROUP_ORDER).toEqual(LOAN_OUT_SECTION_GROUPS.map(g => g.id));
    });

    it('every entry in SECTION_GROUPS resolves to a known group', () => {
      Object.values(SECTION_GROUPS).forEach(g => {
        expect(GROUP_ORDER).toContain(g);
      });
    });

    it('DEFAULT_SECTION_ORDER covers every group', () => {
      GROUP_ORDER.forEach(group => {
        expect(DEFAULT_SECTION_ORDER[group]).toBeDefined();
        expect(DEFAULT_SECTION_ORDER[group].length).toBeGreaterThan(0);
      });
    });

    it('ALL_SECTION_IDS lists 15 sections', () => {
      expect(ALL_SECTION_IDS).toHaveLength(15);
    });

    it('CREATE_MODE_EXCLUDE hides post-creation sections', () => {
      expect(CREATE_MODE_EXCLUDE).toContain('renewals');
      expect(CREATE_MODE_EXCLUDE).toContain('monitoring');
      expect(CREATE_MODE_EXCLUDE).toContain('closing');
      expect(CREATE_MODE_EXCLUDE).toContain('discussion');
      expect(CREATE_MODE_EXCLUDE).toContain('history');
    });
  });

  describe('defaultFormData', () => {
    it('defaults loan_purpose to exhibition', () => {
      expect(defaultFormData.loan_purpose).toBe('exhibition');
    });

    it('defaults insurance currency to USD and coverage type to wall_to_wall', () => {
      expect(defaultFormData.insurance_currency).toBe('USD');
      expect(defaultFormData.insurance_coverage_type).toBe('wall_to_wall');
    });

    it('defaults boolean fields to false', () => {
      expect(defaultFormData.certificate_of_insurance_received).toBe(false);
      expect(defaultFormData.facility_report_received).toBe(false);
      expect(defaultFormData.facility_report_approved).toBe(false);
      expect(defaultFormData.security_conditions_confirmed).toBe(false);
      expect(defaultFormData.closing_invoice_sent).toBe(false);
      expect(defaultFormData.receipt_acknowledged).toBe(false);
      expect(defaultFormData.conditions_met_confirmed).toBe(false);
    });

    it('photography_permitted is null by default (tri-state)', () => {
      expect(defaultFormData.photography_permitted).toBeNull();
    });

    it('starts with todays date for request_date', () => {
      expect(defaultFormData.request_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
