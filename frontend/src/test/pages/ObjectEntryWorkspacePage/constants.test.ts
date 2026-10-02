import { describe, it, expect } from 'vitest';
import {
  STATUS_CONFIG,
  WORKFLOW_STEPS,
  SECTION_GROUPS,
  GROUP_ORDER,
  DEFAULT_SECTION_ORDER,
  ENTRY_SECTION_GROUPS,
  ALL_SECTION_IDS,
  getExcludedSections,
  DEFAULT_FORM_DATA,
  DEFAULT_EXPANDED_SECTIONS,
} from '../../../pages/collections/ObjectEntryWorkspacePage/constants';

describe('ObjectEntryWorkspacePage / constants', () => {
  describe('STATUS_CONFIG', () => {
    it('contains all six procedure entry statuses', () => {
      expect(Object.keys(STATUS_CONFIG).sort()).toEqual([
        'acquired',
        'pending',
        'processed',
        'processing',
        'received',
        'returned',
      ]);
    });

    it('every status has a label, color, and icon', () => {
      for (const cfg of Object.values(STATUS_CONFIG)) {
        expect(typeof cfg.label).toBe('string');
        expect(cfg.label.length).toBeGreaterThan(0);
        expect(typeof cfg.color).toBe('string');
        expect(cfg.icon).toBeDefined();
      }
    });

    it('uses Madrona semantic palette tokens (no generic Tailwind colors)', () => {
      for (const cfg of Object.values(STATUS_CONFIG)) {
        expect(cfg.color).not.toMatch(/(green|blue|amber|gray|yellow|red)-\d/);
      }
    });

    it('pending uses warning palette', () => {
      expect(STATUS_CONFIG.pending.color).toContain('semantic-warning');
    });

    it('acquired uses success palette', () => {
      expect(STATUS_CONFIG.acquired.color).toContain('semantic-success');
    });
  });

  describe('WORKFLOW_STEPS', () => {
    it('models the 4-stage entry workflow in order', () => {
      expect(WORKFLOW_STEPS.map((s) => s.key)).toEqual([
        'pending',
        'received',
        'processed',
        'linked',
      ]);
    });

    it('every step has a human label', () => {
      for (const step of WORKFLOW_STEPS) {
        expect(step.label.length).toBeGreaterThan(0);
      }
    });
  });

  describe('SECTION_GROUPS / GROUP_ORDER', () => {
    it('GROUP_ORDER lists overview, details, linked, admin', () => {
      expect(GROUP_ORDER).toEqual(['overview', 'details', 'linked', 'admin']);
    });

    it('every section_group value matches a known group id', () => {
      const groups = new Set(GROUP_ORDER);
      for (const groupId of Object.values(SECTION_GROUPS)) {
        expect(groups.has(groupId)).toBe(true);
      }
    });

    it('overview group contains entry/depositor/objects', () => {
      expect(SECTION_GROUPS.entry).toBe('overview');
      expect(SECTION_GROUPS.depositor).toBe('overview');
      expect(SECTION_GROUPS.objects).toBe('overview');
    });

    it('linked group contains acquisition/loan-in/exit', () => {
      expect(SECTION_GROUPS.acquisition).toBe('linked');
      expect(SECTION_GROUPS['loan-in']).toBe('linked');
      expect(SECTION_GROUPS.exit).toBe('linked');
    });
  });

  describe('DEFAULT_SECTION_ORDER', () => {
    it('contains an entry for each group', () => {
      for (const group of GROUP_ORDER) {
        expect(Array.isArray(DEFAULT_SECTION_ORDER[group])).toBe(true);
      }
    });

    it('every section listed in DEFAULT_SECTION_ORDER has a SECTION_GROUPS entry', () => {
      for (const [groupId, sections] of Object.entries(DEFAULT_SECTION_ORDER)) {
        for (const sectionId of sections) {
          expect(SECTION_GROUPS[sectionId]).toBe(groupId);
        }
      }
    });
  });

  describe('ENTRY_SECTION_GROUPS', () => {
    it('matches GROUP_ORDER ids 1-to-1', () => {
      expect(ENTRY_SECTION_GROUPS.map((g) => g.id)).toEqual(GROUP_ORDER);
    });

    it('overview group is expanded by default; admin group is collapsed', () => {
      const overview = ENTRY_SECTION_GROUPS.find((g) => g.id === 'overview');
      const admin = ENTRY_SECTION_GROUPS.find((g) => g.id === 'admin');
      expect(overview?.defaultExpanded).toBe(true);
      expect(admin?.defaultExpanded).toBe(false);
    });

    it('every section group has at least one section', () => {
      for (const group of ENTRY_SECTION_GROUPS) {
        expect(group.sections.length).toBeGreaterThan(0);
      }
    });
  });

  describe('ALL_SECTION_IDS', () => {
    it('flattens every section from ENTRY_SECTION_GROUPS', () => {
      const expectedCount = ENTRY_SECTION_GROUPS.reduce(
        (sum, g) => sum + g.sections.length,
        0,
      );
      expect(ALL_SECTION_IDS.length).toBe(expectedCount);
    });

    it('contains the core entry sections', () => {
      expect(ALL_SECTION_IDS).toContain('entry');
      expect(ALL_SECTION_IDS).toContain('depositor');
      expect(ALL_SECTION_IDS).toContain('objects');
      expect(ALL_SECTION_IDS).toContain('terms-acceptance');
      expect(ALL_SECTION_IDS).toContain('exit');
    });

    it('has no duplicates', () => {
      expect(new Set(ALL_SECTION_IDS).size).toBe(ALL_SECTION_IDS.length);
    });
  });

  describe('getExcludedSections', () => {
    it('hides acquisition and loan-in for an empty/unknown reason', () => {
      const excluded = getExcludedSections('');
      expect(excluded).toContain('acquisition');
      expect(excluded).toContain('loan-in');
    });

    it('shows acquisition for gift_offer (and hides loan-in)', () => {
      const excluded = getExcludedSections('gift_offer');
      expect(excluded).not.toContain('acquisition');
      expect(excluded).toContain('loan-in');
    });

    it('shows acquisition for purchase_consideration', () => {
      const excluded = getExcludedSections('purchase_consideration');
      expect(excluded).not.toContain('acquisition');
      expect(excluded).toContain('loan-in');
    });

    it('shows loan-in for loan_consideration (and hides acquisition)', () => {
      const excluded = getExcludedSections('loan_consideration');
      expect(excluded).toContain('acquisition');
      expect(excluded).not.toContain('loan-in');
    });

    it('never excludes the exit section regardless of reason', () => {
      for (const reason of [
        '',
        'identification',
        'gift_offer',
        'purchase_consideration',
        'loan_consideration',
        'conservation',
        'photography',
      ]) {
        expect(getExcludedSections(reason)).not.toContain('exit');
      }
    });
  });

  describe('DEFAULT_FORM_DATA', () => {
    it('starts with USD currency and signature acceptance method', () => {
      expect(DEFAULT_FORM_DATA.insurance_currency).toBe('USD');
      expect(DEFAULT_FORM_DATA.acceptance_method).toBe('signature');
    });

    it('starts with terms_accepted = false', () => {
      expect(DEFAULT_FORM_DATA.terms_accepted).toBe(false);
    });

    it('starts with empty contact ids', () => {
      expect(DEFAULT_FORM_DATA.depositor_id).toBe('');
      expect(DEFAULT_FORM_DATA.current_owner_id).toBe('');
      expect(DEFAULT_FORM_DATA.authorizer_id).toBe('');
      expect(DEFAULT_FORM_DATA.terms_accepted_by_id).toBe('');
    });
  });

  describe('DEFAULT_EXPANDED_SECTIONS', () => {
    it('expands entry + depositor by default and collapses everything else', () => {
      expect(DEFAULT_EXPANDED_SECTIONS.entry).toBe(true);
      expect(DEFAULT_EXPANDED_SECTIONS.depositor).toBe(true);
      expect(DEFAULT_EXPANDED_SECTIONS.objects).toBe(false);
      expect(DEFAULT_EXPANDED_SECTIONS.history).toBe(false);
      expect(DEFAULT_EXPANDED_SECTIONS.discussion).toBe(false);
    });

    it('lists admin/linked groups as collapsed', () => {
      expect(DEFAULT_EXPANDED_SECTIONS.acquisition).toBe(false);
      expect(DEFAULT_EXPANDED_SECTIONS['loan-in']).toBe(false);
      expect(DEFAULT_EXPANDED_SECTIONS.exit).toBe(false);
    });
  });
});
