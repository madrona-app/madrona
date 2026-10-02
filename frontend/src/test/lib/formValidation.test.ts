import { validateCreateForm } from '../../lib/formValidation';
import type { ValidationRule } from '../../lib/formValidation';

describe('validateCreateForm', () => {
  const requiredRules: ValidationRule[] = [
    { field: 'title', label: 'Title', check: 'required' },
    { field: 'name', label: 'Name', check: 'required' },
  ];

  it('returns null when all required fields are present', () => {
    const result = validateCreateForm(
      { title: 'My Title', name: 'John' },
      requiredRules
    );
    expect(result).toBeNull();
  });

  it('returns error message for missing required field (empty string)', () => {
    const result = validateCreateForm(
      { title: '', name: 'John' },
      requiredRules
    );
    expect(result).toBe('Title is required');
  });

  it('returns error message for missing required field (undefined)', () => {
    const result = validateCreateForm(
      { title: undefined, name: 'John' },
      requiredRules
    );
    expect(result).toBe('Title is required');
  });

  it('returns error message for missing required field (null)', () => {
    const result = validateCreateForm(
      { title: null, name: 'John' },
      requiredRules
    );
    expect(result).toBe('Title is required');
  });

  it('returns combined error when multiple fields are invalid', () => {
    const result = validateCreateForm(
      { title: '', name: '' },
      requiredRules
    );
    expect(result).toBe('The following fields are required: Title, Name');
  });

  it('positive_number check: passes for positive numbers', () => {
    const rules: ValidationRule[] = [
      { field: 'quantity', label: 'Quantity', check: 'positive_number' },
    ];
    const result = validateCreateForm({ quantity: 5 }, rules);
    expect(result).toBeNull();
  });

  it('positive_number check: fails for zero', () => {
    const rules: ValidationRule[] = [
      { field: 'quantity', label: 'Quantity', check: 'positive_number' },
    ];
    const result = validateCreateForm({ quantity: 0 }, rules);
    expect(result).toBe('Quantity must be a positive number');
  });

  it('positive_number check: fails for negative numbers', () => {
    const rules: ValidationRule[] = [
      { field: 'quantity', label: 'Quantity', check: 'positive_number' },
    ];
    const result = validateCreateForm({ quantity: -3 }, rules);
    expect(result).toBe('Quantity must be a positive number');
  });

  it('positive_number check: fails for non-number values', () => {
    const rules: ValidationRule[] = [
      { field: 'quantity', label: 'Quantity', check: 'positive_number' },
    ];
    const result = validateCreateForm({ quantity: 'abc' }, rules);
    expect(result).toBe('Quantity must be a positive number');
  });

  it('works with no rules (returns null)', () => {
    const result = validateCreateForm({ anything: 'value' }, []);
    expect(result).toBeNull();
  });
});
