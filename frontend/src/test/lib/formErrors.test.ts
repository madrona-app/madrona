import { describe, it, expect } from 'vitest';
import { formatErrorMessage, FIELD_LABELS } from '../../lib/formErrors';

describe('formErrors', () => {
  describe('FIELD_LABELS', () => {
    it('exposes common form types', () => {
      expect(FIELD_LABELS.deaccession).toBeDefined();
      expect(FIELD_LABELS.movement).toBeDefined();
      expect(FIELD_LABELS.acquisition).toBeDefined();
      expect(FIELD_LABELS.loan_in).toBeDefined();
      expect(FIELD_LABELS.loan_out).toBeDefined();
    });

    it('includes contextual field names for specific forms', () => {
      expect(FIELD_LABELS.deaccession.reason).toBe('Reason for Deaccession');
      expect(FIELD_LABELS.movement.reason).toBe('Movement Reason');
      expect(FIELD_LABELS.loan_in.lender_name).toBe('Lender');
      expect(FIELD_LABELS.loan_out.borrower_name).toBe('Borrower');
    });
  });

  describe('formatErrorMessage', () => {
    it('passes through unrelated messages', () => {
      expect(formatErrorMessage('Something unexpected happened')).toBe(
        'Something unexpected happened'
      );
    });

    it('handles "Missing: field1, field2" messages', () => {
      const result = formatErrorMessage('Missing: object_id, name');
      expect(result).toBe('Please fill in the required fields: Object, Name');
    });

    it('handles "Missing required fields:" prefix variant', () => {
      const result = formatErrorMessage('Missing required fields: name, title');
      expect(result).toBe('Please fill in the required fields: Name, Title');
    });

    it('maps form-specific fields when form type is supplied', () => {
      const result = formatErrorMessage('Missing: reason', 'deaccession');
      expect(result).toBe(
        'Please fill in the required fields: Reason for Deaccession'
      );
    });

    it('falls back to common labels when a form-specific label is missing', () => {
      // object_id is only in COMMON_FIELD_LABELS (indirectly via spread)
      const result = formatErrorMessage('Missing: object_id', 'acquisition');
      expect(result).toBe('Please fill in the required fields: Object');
    });

    it('humanizes unknown field names by replacing underscores with spaces', () => {
      const result = formatErrorMessage('Missing: totally_unknown_field');
      expect(result).toBe(
        'Please fill in the required fields: totally unknown field'
      );
    });

    it('handles "X is required" messages', () => {
      const result = formatErrorMessage('name is required');
      expect(result).toBe('Please fill in the required field: Name');
    });

    it('handles "X is required" with form-specific label', () => {
      const result = formatErrorMessage('reason is required', 'movement');
      expect(result).toBe('Please fill in the required field: Movement Reason');
    });

    it('humanizes unknown fields in "is required" messages', () => {
      const result = formatErrorMessage('weird_field is required');
      expect(result).toBe('Please fill in the required field: weird field');
    });

    it('is case-insensitive for the Missing prefix', () => {
      const result = formatErrorMessage('missing: name');
      expect(result).toBe('Please fill in the required fields: Name');
    });

    it('trims whitespace around field names', () => {
      const result = formatErrorMessage('Missing:   name  ,  title  ');
      expect(result).toBe('Please fill in the required fields: Name, Title');
    });
  });
});
