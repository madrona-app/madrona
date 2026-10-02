import { describe, it, expect } from 'vitest';
import {
  OBJECT_ENTRY_SECTIONS,
  LOAN_IN_SECTIONS,
  MOVEMENT_SECTIONS,
  OBJECT_EXIT_SECTIONS,
  calculateSectionCompletion,
  calculateAllSectionCompletions,
  validateStatusTransition,
  getOverallCompletion,
} from '../../lib/procedureValidation';

describe('procedureValidation', () => {
  describe('section definitions', () => {
    it('OBJECT_ENTRY_SECTIONS exposes core sections', () => {
      const ids = OBJECT_ENTRY_SECTIONS.map((s) => s.id);
      expect(ids).toContain('entry');
      expect(ids).toContain('depositor');
      expect(ids).toContain('objects');
    });

    it('LOAN_IN_SECTIONS exposes loan sections', () => {
      const ids = LOAN_IN_SECTIONS.map((s) => s.id);
      expect(ids).toContain('lender');
      expect(ids).toContain('details');
    });

    it('MOVEMENT_SECTIONS exposes movement sections', () => {
      const ids = MOVEMENT_SECTIONS.map((s) => s.id);
      expect(ids).toContain('object');
      expect(ids).toContain('movement');
    });

    it('OBJECT_EXIT_SECTIONS exposes exit sections', () => {
      const ids = OBJECT_EXIT_SECTIONS.map((s) => s.id);
      expect(ids).toContain('exit');
      expect(ids).toContain('recipient');
    });
  });

  describe('calculateSectionCompletion', () => {
    it('reports 0% completion for empty record', () => {
      const sectionDef = OBJECT_ENTRY_SECTIONS[0]; // entry: 3 required fields
      const result = calculateSectionCompletion(sectionDef, {});
      expect(result.completedCount).toBe(0);
      expect(result.percentage).toBe(0);
      expect(result.requiredComplete).toBe(false);
      expect(result.missingRequired.length).toBeGreaterThan(0);
    });

    it('reports 100% when all fields present', () => {
      const sectionDef = OBJECT_ENTRY_SECTIONS[0];
      const result = calculateSectionCompletion(sectionDef, {
        entry_number: 'E-001',
        entry_date: '2026-01-01',
        reason: 'loan_consideration',
      });
      expect(result.completedCount).toBe(3);
      expect(result.percentage).toBe(100);
      expect(result.requiredComplete).toBe(true);
    });

    it('separates missingRequired from missingOptional', () => {
      const sectionDef = OBJECT_ENTRY_SECTIONS.find((s) => s.id === 'duration')!;
      const result = calculateSectionCompletion(sectionDef, {});
      expect(result.requiredComplete).toBe(true);
      expect(result.missingOptional.length).toBeGreaterThan(0);
      expect(result.missingRequired).toHaveLength(0);
    });

    it('treats whitespace-only string as missing', () => {
      const sectionDef = OBJECT_ENTRY_SECTIONS[0];
      const result = calculateSectionCompletion(sectionDef, {
        entry_number: '   ',
        entry_date: '',
        reason: '\t\n',
      });
      expect(result.completedCount).toBe(0);
    });

    it('uses custom validate function when provided', () => {
      const sectionDef = OBJECT_ENTRY_SECTIONS.find((s) => s.id === 'objects')!;
      // items field requires array length >= 1
      const passing = calculateSectionCompletion(sectionDef, {
        objects_description: 'some',
        items: [{ id: 'x' }],
      });
      expect(passing.requiredComplete).toBe(true);

      const failing = calculateSectionCompletion(sectionDef, {
        objects_description: 'some',
        items: [],
      });
      expect(failing.requiredComplete).toBe(false);
    });

    it('returns sectionId and title in result', () => {
      const sectionDef = OBJECT_ENTRY_SECTIONS[0];
      const result = calculateSectionCompletion(sectionDef, {});
      expect(result.sectionId).toBe(sectionDef.id);
      expect(result.title).toBe(sectionDef.title);
    });
  });

  describe('calculateAllSectionCompletions', () => {
    it('returns one entry per section', () => {
      const result = calculateAllSectionCompletions(OBJECT_ENTRY_SECTIONS, {});
      expect(result).toHaveLength(OBJECT_ENTRY_SECTIONS.length);
    });

    it('preserves section ids', () => {
      const result = calculateAllSectionCompletions(OBJECT_ENTRY_SECTIONS, {});
      expect(result.map((r) => r.sectionId)).toEqual(OBJECT_ENTRY_SECTIONS.map((s) => s.id));
    });
  });

  describe('validateStatusTransition', () => {
    it('returns valid: true even with errors (advisory)', () => {
      const result = validateStatusTransition('object_entry', 'received', {});
      expect(result.valid).toBe(true);
    });

    it('reports errors for missing fields when advancing to received', () => {
      const result = validateStatusTransition('object_entry', 'received', {});
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns no errors when all required fields present', () => {
      const result = validateStatusTransition('object_entry', 'received', {
        entry_number: 'E-001',
        entry_date: '2026-01-01',
        reason: 'loan',
        depositor_id: 'D-1',
        objects_description: 'some objects',
      });
      expect(result.errors).toHaveLength(0);
    });

    it('returns no errors for unknown status', () => {
      const result = validateStatusTransition('object_entry', 'no-such-status', {});
      expect(result.errors).toHaveLength(0);
    });

    it('uses field labels in error messages', () => {
      const result = validateStatusTransition('object_entry', 'received', {});
      // Should contain "Entry number", not "entry_number"
      expect(result.errors.some((e) => e.includes('Entry number'))).toBe(true);
    });

    it('handles loan_in procedure', () => {
      const result = validateStatusTransition('loan_in', 'approved', {
        lender_id: 'L-1',
        loan_purpose: 'exhibit',
        request_date: '2026-01-01',
        loan_start_date: '2026-02-01',
        loan_end_date: '2026-06-01',
        insurance_value: 10000,
      });
      expect(result.errors).toHaveLength(0);
    });

    it('handles movement procedure', () => {
      const result = validateStatusTransition('movement', 'in_transit', {
        object_id: 'O-1',
        reason: 'storage_change',
        to_location_id: 'L-2',
        movement_date: '2026-01-01',
      });
      expect(result.errors).toHaveLength(0);
    });

    it('handles object_exit procedure', () => {
      const result = validateStatusTransition('object_exit', 'preparing', {
        exit_number: 'X-1',
        exit_date: '2026-01-01',
        exit_reason: 'return',
        recipient_name: 'Owner',
      });
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('getOverallCompletion', () => {

    it('counts all fields across sections', () => {
      const result = getOverallCompletion('object_entry', {});
      const expected = OBJECT_ENTRY_SECTIONS.reduce(
        (sum, s) => sum + s.fields.length,
        0,
      );
      expect(result.totalFields).toBe(expected);
    });

    it('reports requiredComplete: true when all required fields filled', () => {
      const result = getOverallCompletion('object_entry', {
        entry_number: 'E-001',
        entry_date: '2026-01-01',
        reason: 'loan',
        depositor_id: 'D-1',
        objects_description: 'some',
        items: [{ id: 'x' }],
        terms_accepted: true,
      });
      expect(result.requiredComplete).toBe(true);
    });

    it('returns valid percentage between 0 and 100', () => {
      const result = getOverallCompletion('movement', { object_id: 'O-1' });
      expect(result.percentage).toBeGreaterThanOrEqual(0);
      expect(result.percentage).toBeLessThanOrEqual(100);
    });

    it('handles loan_in procedure', () => {
      const result = getOverallCompletion('loan_in', {});
      expect(result.totalFields).toBeGreaterThan(0);
    });

    it('handles object_exit procedure', () => {
      const result = getOverallCompletion('object_exit', {});
      expect(result.totalFields).toBeGreaterThan(0);
    });
  });
});
