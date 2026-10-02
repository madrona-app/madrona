export type ValidationCheck = 'required' | 'positive_number';

export interface ValidationRule {
  field: string;
  label: string;
  check: ValidationCheck;
}

/**
 * Validates form data against a set of rules.
 * Returns null if valid, or a human-readable error message listing missing fields.
 */
export function validateCreateForm(
  formData: Record<string, unknown>,
  rules: ValidationRule[]
): string | null {
  const errors: string[] = [];
  for (const rule of rules) {
    const value = formData[rule.field];
    switch (rule.check) {
      case 'required':
        if (
          value === undefined ||
          value === null ||
          value === '' ||
          (Array.isArray(value) && value.length === 0)
        ) {
          errors.push(rule.label);
        }
        break;
      case 'positive_number':
        if (typeof value !== 'number' || value <= 0) {
          errors.push(`${rule.label} must be a positive number`);
        }
        break;
    }
  }
  if (errors.length === 0) return null;
  if (errors.length === 1) {
    // If the error already contains a full message (e.g., "X must be a positive number"),
    // return it as-is. Otherwise, append "is required".
    return errors[0].includes(' ') ? errors[0] : `${errors[0]} is required`;
  }
  return `The following fields are required: ${errors.join(', ')}`;
}
