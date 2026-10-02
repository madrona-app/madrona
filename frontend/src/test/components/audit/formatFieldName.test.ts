import { describe, it, expect } from 'vitest';
import { formatFieldName } from '../../../components/audit/formatFieldName';

describe('formatFieldName', () => {
  it('title-cases a single snake_case word', () => {
    expect(formatFieldName('title')).toBe('Title');
  });

  it('replaces underscores with spaces and title-cases', () => {
    expect(formatFieldName('object_title')).toBe('Object Title');
  });

  it('handles multiple underscores', () => {
    expect(formatFieldName('legal_status_note')).toBe('Legal Status Note');
  });

  it('preserves already-capitalized first letters', () => {
    expect(formatFieldName('Object_Title')).toBe('Object Title');
  });

  it('returns empty string for empty input', () => {
    expect(formatFieldName('')).toBe('');
  });

  it('handles a string with no underscores', () => {
    expect(formatFieldName('foo')).toBe('Foo');
  });

  it('does not collapse trailing/leading underscores into nothing', () => {
    // The regex replaces "_" with " " — the test makes the implementation explicit
    expect(formatFieldName('_leading')).toBe(' Leading');
  });
});
