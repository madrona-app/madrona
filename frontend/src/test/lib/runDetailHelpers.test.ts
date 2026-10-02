import { describe, it, expect } from 'vitest';
import {
  getFieldDiffType,
  isFieldVisibleByDefault,
  diffObjectKeys,
  isObject,
  formatDiffValue,
  normalizeCanonicalType,
  resolveChangeSource,
  diffMediaArray,
  summarizeMediaChanges,
  getMediaEntryLabel,
  METADATA_FIELDS,
  STRUCTURED_FIELDS,
  MEDIA_FIELDS,
  SCALAR_FIELDS,
} from '../../lib/runDetailHelpers';

describe('runDetailHelpers', () => {
  describe('field-name sets', () => {
    it('classifies known field names into the right sets', () => {
      expect(METADATA_FIELDS.has('meta')).toBe(true);
      expect(STRUCTURED_FIELDS.has('properties')).toBe(true);
      expect(MEDIA_FIELDS.has('media')).toBe(true);
      expect(SCALAR_FIELDS.has('label')).toBe(true);
    });
  });

  describe('getFieldDiffType', () => {
    it('returns metadata for metadata fields', () => {
      expect(getFieldDiffType('meta')).toBe('metadata');
      expect(getFieldDiffType('provenance')).toBe('metadata');
    });
    it('returns media for media fields', () => {
      expect(getFieldDiffType('media')).toBe('media');
    });
    it('returns structured for structured fields', () => {
      expect(getFieldDiffType('properties')).toBe('structured');
      expect(getFieldDiffType('classifications')).toBe('structured');
    });
    it('returns scalar for unknown field names', () => {
      expect(getFieldDiffType('unknownField')).toBe('scalar');
      expect(getFieldDiffType('label')).toBe('scalar');
    });
  });

  describe('isFieldVisibleByDefault', () => {
    it('hides metadata fields', () => {
      expect(isFieldVisibleByDefault('meta')).toBe(false);
    });
    it('shows non-metadata fields', () => {
      expect(isFieldVisibleByDefault('label')).toBe(true);
      expect(isFieldVisibleByDefault('properties')).toBe(true);
    });
  });

  describe('diffObjectKeys', () => {
    it('returns empty diffs for identical objects', () => {
      const result = diffObjectKeys({ a: 1 }, { a: 1 });
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.changed).toEqual([]);
    });

    it('detects added keys', () => {
      const result = diffObjectKeys({}, { a: 1 });
      expect(result.added).toEqual(['a']);
    });

    it('detects removed keys', () => {
      const result = diffObjectKeys({ a: 1 }, {});
      expect(result.removed).toEqual(['a']);
    });

    it('detects changed values', () => {
      const result = diffObjectKeys({ a: 1 }, { a: 2 });
      expect(result.changed).toHaveLength(1);
      expect(result.changed[0]).toEqual({ key: 'a', oldVal: 1, newVal: 2 });
    });

    it('detects deep changes via JSON.stringify', () => {
      const result = diffObjectKeys({ a: { x: 1 } }, { a: { x: 2 } });
      expect(result.changed).toHaveLength(1);
    });

    it('treats null/undefined as empty objects', () => {
      const r1 = diffObjectKeys(null, { a: 1 });
      const r2 = diffObjectKeys({ a: 1 }, undefined);
      expect(r1.added).toEqual(['a']);
      expect(r2.removed).toEqual(['a']);
    });
  });

  describe('isObject', () => {
    it('returns true for plain objects', () => {
      expect(isObject({})).toBe(true);
      expect(isObject({ a: 1 })).toBe(true);
    });
    it('returns false for null', () => {
      expect(isObject(null)).toBe(false);
    });
    it('returns false for arrays', () => {
      expect(isObject([])).toBe(false);
    });
    it('returns false for primitives', () => {
      expect(isObject(1)).toBe(false);
      expect(isObject('s')).toBe(false);
      expect(isObject(undefined)).toBe(false);
    });
  });

  describe('formatDiffValue', () => {
    it('formats null and undefined', () => {
      expect(formatDiffValue(null)).toBe('null');
      expect(formatDiffValue(undefined)).toBe('undefined');
    });
    it('quotes strings', () => {
      expect(formatDiffValue('hi')).toBe('"hi"');
    });
    it('JSON-stringifies objects and arrays', () => {
      expect(formatDiffValue({ a: 1 })).toBe('{"a":1}');
      expect(formatDiffValue([1, 2])).toBe('[1,2]');
    });
    it('stringifies numbers and booleans', () => {
      expect(formatDiffValue(42)).toBe('42');
      expect(formatDiffValue(true)).toBe('true');
    });
  });

  describe('normalizeCanonicalType', () => {
    it('returns Unknown for null/undefined/empty', () => {
      expect(normalizeCanonicalType(null)).toBe('Unknown');
      expect(normalizeCanonicalType(undefined)).toBe('Unknown');
      expect(normalizeCanonicalType('')).toBe('Unknown');
    });
    it('maps known canonical types', () => {
      expect(normalizeCanonicalType('object')).toBe('Object');
      expect(normalizeCanonicalType('AGENT')).toBe('Agent');
      expect(normalizeCanonicalType('Place')).toBe('Place');
    });
    it('title-cases unknown strings', () => {
      expect(normalizeCanonicalType('mystery')).toBe('Mystery');
      expect(normalizeCanonicalType('FOO')).toBe('Foo');
    });
  });

  describe('resolveChangeSource', () => {
    it('returns Pipeline run when pipeline_name set', () => {
      expect(resolveChangeSource({ pipeline_name: 'Daily' })).toBe('Pipeline run');
    });
    it('returns Source-triggered when only dataset_name set', () => {
      expect(resolveChangeSource({ dataset_name: 'Inv' })).toBe('Source-triggered');
    });
    it('falls back to System update', () => {
      expect(resolveChangeSource({})).toBe('System update');
      expect(resolveChangeSource({ pipeline_name: null, dataset_name: null })).toBe(
        'System update',
      );
    });
    it('prefers pipeline over dataset', () => {
      expect(
        resolveChangeSource({ pipeline_name: 'Daily', dataset_name: 'Inv' }),
      ).toBe('Pipeline run');
    });
  });

  describe('diffMediaArray', () => {
    it('returns empty diffs for identical arrays', () => {
      const a = [{ url: 'a', role: 'main' }];
      const result = diffMediaArray(a, a);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.changed).toEqual([]);
    });

    it('detects added entries', () => {
      const result = diffMediaArray([], [{ url: 'a' }]);
      expect(result.added).toHaveLength(1);
    });

    it('detects removed entries', () => {
      const result = diffMediaArray([{ url: 'a' }], []);
      expect(result.removed).toHaveLength(1);
    });

    it('detects changed entries by URL', () => {
      const before = [{ url: 'a', role: 'main' }];
      const after = [{ url: 'a', role: 'thumb' }];
      const result = diffMediaArray(before, after);
      expect(result.changed).toHaveLength(1);
      expect(result.changed[0].changedFields).toContain('role');
    });

    it('handles null/undefined inputs', () => {
      const result = diffMediaArray(null, [{ url: 'a' }]);
      expect(result.added).toHaveLength(1);
    });

    it('ignores entries without url for matching', () => {
      const result = diffMediaArray([{ role: 'orphan' }], [{ role: 'orphan' }]);
      // No urls -> no matches -> no diffs reported
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.changed).toEqual([]);
    });
  });

  describe('summarizeMediaChanges', () => {
    it('returns "No changes" for empty diff', () => {
      expect(
        summarizeMediaChanges({ added: [], removed: [], changed: [] }),
      ).toBe('No changes');
    });

    it('summarizes additions, removals, modifications', () => {
      const result = summarizeMediaChanges({
        added: [{ url: 'a' }],
        removed: [{ url: 'b' }, { url: 'c' }],
        changed: [{ before: { url: 'd' }, after: { url: 'd' }, changedFields: [] }],
      });
      expect(result).toContain('+1 added');
      expect(result).toContain('−2 removed');
      expect(result).toContain('~1 modified');
    });
  });

  describe('getMediaEntryLabel', () => {
    it('prefers role', () => {
      expect(getMediaEntryLabel({ role: 'main', type: 'image', url: 'http://x' })).toBe('main');
    });
    it('falls back to type when role missing', () => {
      expect(getMediaEntryLabel({ type: 'video' })).toBe('video');
    });
    it('falls back to filename from URL', () => {
      expect(getMediaEntryLabel({ url: 'http://example.com/path/file.jpg' })).toBe('file.jpg');
    });
    it('truncates long unparseable URLs', () => {
      const longUrl = 'not-a-url-' + 'x'.repeat(60);
      const label = getMediaEntryLabel({ url: longUrl });
      expect(label.endsWith('...')).toBe(true);
    });
    it('returns "media" when no identifying fields', () => {
      expect(getMediaEntryLabel({})).toBe('media');
    });
  });
});
