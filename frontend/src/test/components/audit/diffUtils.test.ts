import { describe, it, expect } from 'vitest';
import {
  classifyDiff,
  computeListDiff,
  summarizeListDiff,
  formatScalarValue,
  formatEmpty,
  isEmptyValue,
  itemLabel,
  hasReadableLabel,
  formatListDiffAsText,
  buildFieldSummaryLine,
  toTitleCase,
  getFieldLabelFn,
  formatEnumValue,
} from '../../../components/audit/diffUtils';

describe('diffUtils', () => {
  // =========================================================================
  // classifyDiff
  // =========================================================================
  describe('classifyDiff', () => {
    it('classifies string→string as scalar', () => {
      expect(classifyDiff({ field_name: 'title', old_value: 'A', new_value: 'B' })).toBe('scalar');
    });

    it('classifies null→string as scalar', () => {
      expect(classifyDiff({ field_name: 'title', old_value: null, new_value: 'B' })).toBe('scalar');
    });

    it('classifies number→number as scalar', () => {
      expect(classifyDiff({ field_name: 'count', old_value: 1, new_value: 2 })).toBe('scalar');
    });

    it('classifies array→array as list', () => {
      expect(classifyDiff({ field_name: 'tags', old_value: ['a'], new_value: ['b'] })).toBe('list');
    });

    it('classifies null→array as list', () => {
      expect(classifyDiff({ field_name: 'tags', old_value: null, new_value: ['a'] })).toBe('list');
    });

    it('classifies object→object as object', () => {
      expect(classifyDiff({ field_name: 'meta', old_value: { a: 1 }, new_value: { b: 2 } })).toBe('object');
    });

    it('classifies null→object as object', () => {
      expect(classifyDiff({ field_name: 'meta', old_value: null, new_value: { a: 1 } })).toBe('object');
    });
  });

  // =========================================================================
  // computeListDiff
  // =========================================================================
  describe('computeListDiff', () => {
    it('detects added items', () => {
      const result = computeListDiff(['a', 'b'], ['a', 'b', 'c']);
      expect(result.added).toEqual(['c']);
      expect(result.removed).toEqual([]);
    });

    it('detects removed items', () => {
      const result = computeListDiff(['a', 'b', 'c'], ['a', 'b']);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual(['c']);
    });

    it('handles complete replacement', () => {
      const result = computeListDiff(['a', 'b'], ['c', 'd']);
      expect(result.added.sort()).toEqual(['c', 'd']);
      expect(result.removed.sort()).toEqual(['a', 'b']);
    });

    it('handles duplicates correctly', () => {
      const result = computeListDiff(['a', 'a', 'b'], ['a', 'b', 'b']);
      expect(result.added).toEqual(['b']);
      expect(result.removed).toEqual(['a']);
    });

    it('returns empty for identical arrays', () => {
      const result = computeListDiff(['a', 'b'], ['a', 'b']);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
    });

    it('handles null→array', () => {
      const result = computeListDiff(null, ['a', 'b']);
      expect(result.added).toEqual(['a', 'b']);
      expect(result.removed).toEqual([]);
    });

    it('handles array→null', () => {
      const result = computeListDiff(['a', 'b'], null);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual(['a', 'b']);
    });

    it('detects complex items', () => {
      const result = computeListDiff([], [{ name: 'X' }]);
      expect(result.hasComplexItems).toBe(true);
    });

    it('marks scalar-only as non-complex', () => {
      const result = computeListDiff(['a'], ['b']);
      expect(result.hasComplexItems).toBe(false);
    });
  });

  // =========================================================================
  // summarizeListDiff
  // =========================================================================
  describe('summarizeListDiff', () => {
    it('shows all items when total <= maxPreview', () => {
      const result = summarizeListDiff(['Impasto'], [], 3);
      expect(result.previewAdded).toEqual(['Impasto']);
      expect(result.previewRemoved).toEqual([]);
      expect(result.remainingCount).toBe(0);
      expect(result.addedCount).toBe(1);
      expect(result.removedCount).toBe(0);
    });

    it('shows both added and removed in preview', () => {
      const result = summarizeListDiff(['new-item'], ['old-item'], 3);
      expect(result.previewRemoved).toEqual(['old-item']);
      expect(result.previewAdded).toEqual(['new-item']);
      expect(result.remainingCount).toBe(0);
    });

    it('truncates when total > maxPreview', () => {
      const result = summarizeListDiff(['alpha', 'bravo', 'charlie'], ['x-ray', 'yankee'], 3);
      // removed first, then added: x-ray, yankee, alpha → remaining = 2 (bravo, charlie)
      expect(result.previewRemoved).toEqual(['x-ray', 'yankee']);
      expect(result.previewAdded).toEqual(['alpha']);
      expect(result.remainingCount).toBe(2);
      expect(result.addedCount).toBe(3);
      expect(result.removedCount).toBe(2);
    });

    it('returns remainingCount=0 when exact fit', () => {
      const result = summarizeListDiff(['alpha'], ['x-ray', 'yankee'], 3);
      expect(result.remainingCount).toBe(0);
    });

    it('marks complex items and extracts readable label', () => {
      const result = summarizeListDiff([{ name: 'Marble' }], [], 3);
      expect(result.hasComplexItems).toBe(true);
      expect(result.previewAdded).toEqual(['Marble']);
    });

    it('skips unlabelable items in preview (objects without known keys)', () => {
      // Objects without known keys produce no label — they count towards remaining
      const result = summarizeListDiff([{ foo: 1 }], [], 3);
      expect(result.hasComplexItems).toBe(true);
      expect(result.previewAdded).toEqual([]);
      expect(result.remainingCount).toBe(1);
      expect(result.addedCount).toBe(1);
    });

    it('shows "?" and other short values neutrally in preview', () => {
      const result = summarizeListDiff(['?', 'N/A'], ['d'], 3);
      expect(result.previewRemoved).toEqual(['d']);
      expect(result.previewAdded).toEqual(['?', 'N/A']);
      expect(result.remainingCount).toBe(0);
    });

    it('shows object with type+value including "?" neutrally', () => {
      const result = summarizeListDiff(
        [{ type: 'alternate', value: '?' }],
        [],
        3,
      );
      expect(result.previewAdded).toEqual(['alternate: ?']);
    });

    it('handles empty arrays', () => {
      const result = summarizeListDiff([], [], 3);
      expect(result.addedCount).toBe(0);
      expect(result.removedCount).toBe(0);
      expect(result.remainingCount).toBe(0);
    });
  });

  // =========================================================================
  // formatScalarValue
  // =========================================================================
  describe('formatScalarValue', () => {
    it('formats null as empty string', () => {
      expect(formatScalarValue(null)).toBe('');
    });

    it('formats undefined as empty string', () => {
      expect(formatScalarValue(undefined as any)).toBe('');
    });

    it('formats booleans', () => {
      expect(formatScalarValue(true)).toBe('true');
      expect(formatScalarValue(false)).toBe('false');
    });

    it('formats numbers', () => {
      expect(formatScalarValue(42)).toBe('42');
      expect(formatScalarValue(3.14)).toBe('3.14');
    });

    it('formats short strings unchanged', () => {
      expect(formatScalarValue('hello')).toBe('hello');
    });

    it('truncates long strings', () => {
      const long = 'a'.repeat(100);
      const result = formatScalarValue(long, 20);
      expect(result).toBe('a'.repeat(20) + '\u2026');
    });

    it('formats ISO dates as locale strings', () => {
      const result = formatScalarValue('2024-03-15T14:30:00Z');
      expect(result).toContain('Mar');
      expect(result).toContain('15');
      expect(result).toContain('2024');
    });

    it('passes through non-ISO strings', () => {
      expect(formatScalarValue('just a string')).toBe('just a string');
    });
  });

  // =========================================================================
  // formatEmpty
  // =========================================================================
  describe('formatEmpty', () => {
    it('returns (empty) for null in old context', () => {
      expect(formatEmpty(null, 'old')).toBe('(empty)');
    });

    it('returns (cleared) for null in new context', () => {
      expect(formatEmpty(null, 'new')).toBe('(cleared)');
    });

    it('returns (empty) for empty string', () => {
      expect(formatEmpty('', 'old')).toBe('(empty)');
    });

    it('returns (cleared) for empty array in new context', () => {
      expect(formatEmpty([], 'new')).toBe('(cleared)');
    });

    it('returns formatted value for non-empty', () => {
      expect(formatEmpty('hello', 'old')).toBe('hello');
    });

    it('defaults to old context', () => {
      expect(formatEmpty(null)).toBe('(empty)');
    });
  });

  // =========================================================================
  // isEmptyValue
  // =========================================================================
  describe('isEmptyValue', () => {
    it('returns true for null', () => expect(isEmptyValue(null)).toBe(true));
    it('returns true for empty string', () => expect(isEmptyValue('')).toBe(true));
    it('returns true for empty array', () => expect(isEmptyValue([])).toBe(true));
    it('returns false for non-empty string', () => expect(isEmptyValue('x')).toBe(false));
    it('returns false for number', () => expect(isEmptyValue(0)).toBe(false));
    it('returns false for false', () => expect(isEmptyValue(false)).toBe(false));
    it('returns false for non-empty array', () => expect(isEmptyValue(['a'])).toBe(false));
  });

  // =========================================================================
  // itemLabel — all values shown exactly as stored, no content filtering
  // =========================================================================
  describe('itemLabel', () => {
    it('labels a readable string', () => {
      expect(itemLabel('Impasto')).toBe('Impasto');
    });

    it('returns empty for null', () => {
      expect(itemLabel(null)).toBe('');
    });

    it('labels single-char strings neutrally', () => {
      expect(itemLabel('d')).toBe('d');
      expect(itemLabel('?')).toBe('?');
    });

    it('labels "N/A" neutrally', () => {
      expect(itemLabel('N/A')).toBe('N/A');
    });

    it('labels a number', () => {
      expect(itemLabel(42)).toBe('42');
    });

    it('labels booleans', () => {
      expect(itemLabel(true)).toBe('true');
      expect(itemLabel(false)).toBe('false');
    });

    it('returns empty for arrays', () => {
      expect(itemLabel([1, 2, 3])).toBe('');
    });

    it('labels an object with name key', () => {
      expect(itemLabel({ name: 'Monet', id: '123' })).toBe('Monet');
    });

    it('labels an object with short name key neutrally', () => {
      expect(itemLabel({ name: 'X' })).toBe('X');
    });

    it('labels an object with title key', () => {
      expect(itemLabel({ title: 'Landscape', other: 'x' })).toBe('Landscape');
    });

    it('shows structured "type: value" for typed objects', () => {
      expect(itemLabel({ type: 'Accession', number: '95.PA.12' })).toBe('Accession: 95.PA.12');
    });

    it('shows "type: ?" neutrally when value is "?"', () => {
      expect(itemLabel({ type: 'alternate', value: '?' })).toBe('alternate: ?');
    });

    it('shows "type: d" neutrally when value is single char', () => {
      expect(itemLabel({ type: 'alternate', number: 'd' })).toBe('alternate: d');
    });

    it('shows type alone if no companion value', () => {
      expect(itemLabel({ type: 'Accession' })).toBe('Accession');
    });

    it('falls back to value/number/id keys', () => {
      expect(itemLabel({ number: '95.PA.12', source: 'catalog' })).toBe('95.PA.12');
    });

    it('returns empty for objects without known keys', () => {
      expect(itemLabel({ foo: 1, bar: 2 })).toBe('');
    });

    it('truncates long labels', () => {
      const long = 'a'.repeat(100);
      const result = itemLabel(long, 20);
      expect(result.length).toBeLessThanOrEqual(21); // 20 + ellipsis
    });

    it('returns empty for empty string value', () => {
      expect(itemLabel('')).toBe('');
    });
  });

  // =========================================================================
  // hasReadableLabel
  // =========================================================================
  describe('hasReadableLabel', () => {
    it('returns true for readable strings', () => {
      expect(hasReadableLabel('Impasto')).toBe(true);
    });

    it('returns false for null', () => {
      expect(hasReadableLabel(null)).toBe(false);
    });

    it('returns true for single-char strings', () => {
      expect(hasReadableLabel('d')).toBe(true);
      expect(hasReadableLabel('?')).toBe(true);
    });

    it('returns true for numbers', () => {
      expect(hasReadableLabel(42)).toBe(true);
    });

    it('returns false for arrays', () => {
      expect(hasReadableLabel([1, 2])).toBe(false);
    });

    it('returns true for objects with readable keys', () => {
      expect(hasReadableLabel({ name: 'Monet' })).toBe(true);
    });

    it('returns false for objects without readable keys', () => {
      expect(hasReadableLabel({ foo: 1 })).toBe(false);
    });
  });

  // =========================================================================
  // toTitleCase
  // =========================================================================
  describe('toTitleCase', () => {
    it('capitalizes a single word', () => {
      expect(toTitleCase('impasto')).toBe('Impasto');
    });

    it('capitalizes multiple words', () => {
      expect(toTitleCase('oil on canvas')).toBe('Oil On Canvas');
    });

    it('leaves already-capitalized words unchanged', () => {
      expect(toTitleCase('Painting')).toBe('Painting');
    });

    it('returns empty string for empty input', () => {
      expect(toTitleCase('')).toBe('');
    });
  });

  // =========================================================================
  // getFieldLabelFn
  // =========================================================================
  describe('getFieldLabelFn', () => {
    it('title-cases technique strings', () => {
      const fn = getFieldLabelFn('techniques');
      expect(fn('impasto')).toBe('Impasto');
    });

    it('title-cases material objects with name key', () => {
      const fn = getFieldLabelFn('materials');
      expect(fn({ name: 'oil on canvas' })).toBe('Oil On Canvas');
    });

    it('extracts and title-cases classification term', () => {
      const fn = getFieldLabelFn('classifications');
      expect(fn({ term: 'painting' })).toBe('Painting');
    });

    it('title-cases other_numbers type label with value as-is', () => {
      const fn = getFieldLabelFn('other_numbers');
      expect(fn({ type: 'alternate', value: '?' })).toBe('Alternate: ?');
    });

    it('title-cases other_numbers accession type', () => {
      const fn = getFieldLabelFn('other_numbers');
      expect(fn({ type: 'accession', value: '95.PA.12' })).toBe('Accession: 95.PA.12');
    });

    it('falls back to generic itemLabel for undefined fieldName', () => {
      const fn = getFieldLabelFn(undefined);
      expect(fn('impasto')).toBe('impasto');
    });

    it('falls back to generic itemLabel for unknown fields', () => {
      const fn = getFieldLabelFn('tags');
      expect(fn('impasto')).toBe('impasto');
    });

    it('classifications falls back to itemLabel for non-term objects', () => {
      const fn = getFieldLabelFn('classifications');
      expect(fn({ name: 'Painting' })).toBe('Painting');
    });

    it('other_numbers falls back to itemLabel for non-typed objects', () => {
      const fn = getFieldLabelFn('other_numbers');
      expect(fn({ name: 'Some Name' })).toBe('Some Name');
    });
  });

  // =========================================================================
  // summarizeListDiff with labelFn
  // =========================================================================
  describe('summarizeListDiff with labelFn', () => {
    it('applies field renderer to preview items', () => {
      const labelFn = getFieldLabelFn('other_numbers');
      const result = summarizeListDiff(
        [{ type: 'alternate', value: '?' }],
        [],
        3,
        labelFn,
      );
      expect(result.previewAdded).toEqual(['Alternate: ?']);
    });

    it('applies techniques renderer to preview items', () => {
      const labelFn = getFieldLabelFn('techniques');
      const result = summarizeListDiff(['impasto'], [], 3, labelFn);
      expect(result.previewAdded).toEqual(['Impasto']);
    });
  });

  // =========================================================================
  // formatListDiffAsText with labelFn
  // =========================================================================
  describe('formatListDiffAsText with labelFn', () => {
    it('applies field renderer to text output', () => {
      const labelFn = getFieldLabelFn('other_numbers');
      const text = formatListDiffAsText(
        'Other Numbers',
        [{ type: 'alternate', value: '?' }],
        [],
        labelFn,
      );
      expect(text).toBe('Other Numbers:\n  + Alternate: ?');
    });

    it('applies techniques renderer to text output', () => {
      const labelFn = getFieldLabelFn('techniques');
      const text = formatListDiffAsText(
        'Techniques',
        ['impasto'],
        ['stippling'],
        labelFn,
      );
      expect(text).toBe('Techniques:\n  - Stippling\n  + Impasto');
    });
  });

  // =========================================================================
  // formatEnumValue
  // =========================================================================
  describe('formatEnumValue', () => {
    it('maps object_status on_loan to On Loan', () => {
      expect(formatEnumValue('object_status', 'on_loan')).toBe('On Loan');
    });

    it('maps object_status pending to Pending', () => {
      expect(formatEnumValue('object_status', 'pending')).toBe('Pending');
    });

    it('passes through unknown values for known fields', () => {
      expect(formatEnumValue('object_status', 'unknown_value')).toBe('unknown_value');
    });

    it('passes through values for unknown fields', () => {
      expect(formatEnumValue('unknown_field', 'on_loan')).toBe('on_loan');
    });
  });

  // =========================================================================
  // otherNumbersRenderer with kind key
  // =========================================================================
  describe('otherNumbersRenderer with kind key', () => {
    it('renders kind+value with title-cased kind label', () => {
      const fn = getFieldLabelFn('other_numbers');
      expect(fn({ kind: 'alternate', value: '?' })).toBe('Alternate: ?');
    });

    it('renders kind+value for accession', () => {
      const fn = getFieldLabelFn('other_numbers');
      expect(fn({ kind: 'accession', value: '95.PA.12' })).toBe('Accession: 95.PA.12');
    });

    it('still renders type+value when type is present', () => {
      const fn = getFieldLabelFn('other_numbers');
      expect(fn({ type: 'catalog', value: 'Z-200' })).toBe('Catalog: Z-200');
    });

    it('prefers type over kind when both present', () => {
      const fn = getFieldLabelFn('other_numbers');
      expect(fn({ type: 'catalog', kind: 'alternate', value: 'X' })).toBe('Catalog: X');
    });
  });

  // =========================================================================
  // formatListDiffAsText
  // =========================================================================
  describe('formatListDiffAsText', () => {
    it('formats a simple diff for clipboard', () => {
      const text = formatListDiffAsText('Techniques', ['Impasto'], ['Stippling']);
      expect(text).toBe('Techniques:\n  - Stippling\n  + Impasto');
    });

    it('handles adds only', () => {
      const text = formatListDiffAsText('Materials', ['Oil on canvas'], []);
      expect(text).toBe('Materials:\n  + Oil on canvas');
    });

    it('handles removes only', () => {
      const text = formatListDiffAsText('Tags', [], ['old-tag']);
      expect(text).toBe('Tags:\n  - old-tag');
    });

    it('falls back to JSON for objects without display keys', () => {
      const text = formatListDiffAsText('Meta', [{ foo: 1 }], []);
      expect(text).toBe('Meta:\n  + {"foo":1}');
    });

    it('shows values like "?" neutrally in clipboard text', () => {
      const text = formatListDiffAsText('Tags', ['?'], []);
      expect(text).toBe('Tags:\n  + ?');
    });

    it('shows structured object values as stored', () => {
      const text = formatListDiffAsText(
        'Other Numbers',
        [{ type: 'alternate', value: '?' }],
        [],
      );
      expect(text).toBe('Other Numbers:\n  + alternate: ?');
    });
  });

  // =========================================================================
  // buildFieldSummaryLine
  // =========================================================================
  describe('buildFieldSummaryLine', () => {
    it('builds a summary with list diffs', () => {
      const diffs = [
        { field_name: 'techniques', old_value: ['Watercolor'], new_value: ['Watercolor', 'Impasto'] },
        { field_name: 'materials', old_value: ['Wood'], new_value: ['Wood', 'Oil on canvas'] },
      ];
      expect(buildFieldSummaryLine(diffs)).toBe('Techniques +1 \u2022 Materials +1');
    });

    it('shows both added and removed counts', () => {
      const diffs = [
        { field_name: 'other_numbers', old_value: ['A-1', 'B-2'], new_value: ['B-2', 'C-3'] },
      ];
      expect(buildFieldSummaryLine(diffs)).toBe('Other Numbers +1/\u22121');
    });

    it('includes scalar diffs by name only', () => {
      const diffs = [
        { field_name: 'object_title', old_value: 'Untitled', new_value: 'Landscape' },
      ];
      expect(buildFieldSummaryLine(diffs)).toBe('Object Title');
    });

    it('skips no-op list diffs', () => {
      const diffs = [
        { field_name: 'tags', old_value: ['a', 'b'], new_value: ['a', 'b'] },
        { field_name: 'title', old_value: 'A', new_value: 'B' },
      ];
      expect(buildFieldSummaryLine(diffs)).toBe('Title');
    });

    it('joins multiple fields with bullet separator', () => {
      const diffs = [
        { field_name: 'techniques', old_value: [] as string[], new_value: ['Impasto'] },
        { field_name: 'materials', old_value: ['Wood'], new_value: [] as string[] },
        { field_name: 'title', old_value: 'A', new_value: 'B' },
      ];
      expect(buildFieldSummaryLine(diffs)).toBe('Techniques +1 \u2022 Materials \u22121 \u2022 Title');
    });
  });
});
