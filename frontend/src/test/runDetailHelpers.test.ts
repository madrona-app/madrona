import { describe, it, expect } from 'vitest';
import {
  diffObjectKeys,
  isObject,
  formatDiffValue,
  normalizeCanonicalType,
  resolveChangeSource,
  getFieldDiffType,
  isFieldVisibleByDefault,
  diffMediaArray,
  summarizeMediaChanges,
  getMediaEntryLabel,
  METADATA_FIELDS,
  STRUCTURED_FIELDS,
  MEDIA_FIELDS,
  SCALAR_FIELDS,
} from '../lib/runDetailHelpers';

describe('runDetailHelpers', () => {
  describe('diffObjectKeys', () => {
    it('detects added keys', () => {
      const before = { a: 1 };
      const after = { a: 1, b: 2 };
      const result = diffObjectKeys(before, after);
      expect(result.added).toEqual(['b']);
      expect(result.removed).toEqual([]);
      expect(result.changed).toEqual([]);
    });

    it('detects removed keys', () => {
      const before = { a: 1, b: 2 };
      const after = { a: 1 };
      const result = diffObjectKeys(before, after);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual(['b']);
      expect(result.changed).toEqual([]);
    });

    it('detects changed keys', () => {
      const before = { a: 1, b: 'old' };
      const after = { a: 1, b: 'new' };
      const result = diffObjectKeys(before, after);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.changed).toEqual([{ key: 'b', oldVal: 'old', newVal: 'new' }]);
    });

    it('handles complex nested changes', () => {
      const before = { props: { color: 'blue' } };
      const after = { props: { color: 'red' } };
      const result = diffObjectKeys(before, after);
      expect(result.changed).toEqual([
        { key: 'props', oldVal: { color: 'blue' }, newVal: { color: 'red' } },
      ]);
    });

    it('handles null/undefined inputs gracefully', () => {
      expect(diffObjectKeys(null, { a: 1 })).toEqual({
        added: ['a'],
        removed: [],
        changed: [],
      });
      expect(diffObjectKeys({ a: 1 }, null)).toEqual({
        added: [],
        removed: ['a'],
        changed: [],
      });
      expect(diffObjectKeys(undefined, undefined)).toEqual({
        added: [],
        removed: [],
        changed: [],
      });
    });

    it('detects added property "location" (per spec example)', () => {
      const before = { artist: 'Van Gogh', year: 1889 };
      const after = { artist: 'Van Gogh', year: 1889, location: 'MoMA, New York' };
      const result = diffObjectKeys(before, after);
      expect(result.added).toContain('location');
      expect(result.removed).toEqual([]);
      expect(result.changed).toEqual([]);
    });
  });

  describe('isObject', () => {
    it('returns true for plain objects', () => {
      expect(isObject({})).toBe(true);
      expect(isObject({ a: 1 })).toBe(true);
    });

    it('returns false for arrays', () => {
      expect(isObject([])).toBe(false);
      expect(isObject([1, 2, 3])).toBe(false);
    });

    it('returns false for null', () => {
      expect(isObject(null)).toBe(false);
    });

    it('returns false for primitives', () => {
      expect(isObject('string')).toBe(false);
      expect(isObject(123)).toBe(false);
      expect(isObject(true)).toBe(false);
      expect(isObject(undefined)).toBe(false);
    });
  });

  describe('formatDiffValue', () => {
    it('formats null', () => {
      expect(formatDiffValue(null)).toBe('null');
    });

    it('formats undefined', () => {
      expect(formatDiffValue(undefined)).toBe('undefined');
    });

    it('formats strings with quotes', () => {
      expect(formatDiffValue('hello')).toBe('"hello"');
    });

    it('formats numbers', () => {
      expect(formatDiffValue(42)).toBe('42');
    });

    it('formats objects as JSON', () => {
      expect(formatDiffValue({ a: 1 })).toBe('{"a":1}');
    });
  });

  describe('normalizeCanonicalType', () => {
    it('normalizes "object" to "Object"', () => {
      expect(normalizeCanonicalType('object')).toBe('Object');
    });

    it('normalizes "WORK" to "Work"', () => {
      expect(normalizeCanonicalType('WORK')).toBe('Work');
    });

    it('normalizes "collection" to "Collection"', () => {
      expect(normalizeCanonicalType('collection')).toBe('Collection');
    });

    it('handles unknown types with title case', () => {
      expect(normalizeCanonicalType('customtype')).toBe('Customtype');
    });

    it('returns "Unknown" for null/undefined', () => {
      expect(normalizeCanonicalType(null)).toBe('Unknown');
      expect(normalizeCanonicalType(undefined)).toBe('Unknown');
    });

    it('handles all known canonical types', () => {
      expect(normalizeCanonicalType('agent')).toBe('Agent');
      expect(normalizeCanonicalType('place')).toBe('Place');
      expect(normalizeCanonicalType('concept')).toBe('Concept');
      expect(normalizeCanonicalType('event')).toBe('Event');
      expect(normalizeCanonicalType('record')).toBe('Record');
      expect(normalizeCanonicalType('asset')).toBe('Asset');
    });
  });

  describe('resolveChangeSource', () => {
    it('returns "Pipeline run" when pipeline_name is present', () => {
      expect(resolveChangeSource({ pipeline_name: 'My Pipeline' })).toBe('Pipeline run');
    });

    it('returns "Source-triggered" when only dataset_name is present', () => {
      expect(resolveChangeSource({ dataset_name: 'My Dataset' })).toBe('Source-triggered');
    });

    it('returns "System update" as fallback', () => {
      expect(resolveChangeSource({})).toBe('System update');
    });

    it('prefers pipeline_name over dataset_name', () => {
      expect(
        resolveChangeSource({ pipeline_name: 'Pipeline', dataset_name: 'Dataset' })
      ).toBe('Pipeline run');
    });

    it('handles null values gracefully', () => {
      expect(resolveChangeSource({ pipeline_name: null, dataset_name: null })).toBe(
        'System update'
      );
    });

    // Test fixture for when mappingId is present (future feature)
    // it('returns "Mapping rule" when mappingId is present', () => {
    //   expect(resolveChangeSource({ mappingId: 'mapping-123' })).toBe('Mapping rule');
    // });
  });

  describe('getFieldDiffType', () => {
    it('classifies metadata fields correctly', () => {
      expect(getFieldDiffType('meta')).toBe('metadata');
      expect(getFieldDiffType('provenance')).toBe('metadata');
      expect(getFieldDiffType('ingestedAt')).toBe('metadata');
      expect(getFieldDiffType('createdAt')).toBe('metadata');
      expect(getFieldDiffType('updatedAt')).toBe('metadata');
    });

    it('classifies structured fields correctly', () => {
      expect(getFieldDiffType('properties')).toBe('structured');
      expect(getFieldDiffType('classifications')).toBe('structured');
      expect(getFieldDiffType('relationships')).toBe('structured');
      expect(getFieldDiffType('identifiers')).toBe('structured');
      expect(getFieldDiffType('extensions')).toBe('structured');
    });

    it('classifies media fields correctly', () => {
      expect(getFieldDiffType('media')).toBe('media');
    });

    it('classifies scalar fields correctly', () => {
      expect(getFieldDiffType('label')).toBe('scalar');
      expect(getFieldDiffType('description')).toBe('scalar');
      expect(getFieldDiffType('rights')).toBe('scalar');
      expect(getFieldDiffType('status')).toBe('scalar');
      expect(getFieldDiffType('type')).toBe('scalar');
      expect(getFieldDiffType('id')).toBe('scalar');
    });

    it('defaults unknown fields to scalar', () => {
      expect(getFieldDiffType('unknownField')).toBe('scalar');
      expect(getFieldDiffType('customAttribute')).toBe('scalar');
    });
  });

  describe('isFieldVisibleByDefault', () => {
    it('returns false for metadata fields', () => {
      expect(isFieldVisibleByDefault('meta')).toBe(false);
      expect(isFieldVisibleByDefault('provenance')).toBe(false);
      expect(isFieldVisibleByDefault('ingestedAt')).toBe(false);
    });

    it('returns true for non-metadata fields', () => {
      expect(isFieldVisibleByDefault('label')).toBe(true);
      expect(isFieldVisibleByDefault('properties')).toBe(true);
      expect(isFieldVisibleByDefault('media')).toBe(true);
      expect(isFieldVisibleByDefault('customField')).toBe(true);
    });
  });

  describe('diffMediaArray', () => {
    it('detects added media entries', () => {
      const before = [{ url: 'https://example.com/a.jpg', role: 'primary' }];
      const after = [
        { url: 'https://example.com/a.jpg', role: 'primary' },
        { url: 'https://example.com/b.jpg', role: 'secondary' },
      ];
      const result = diffMediaArray(before, after);
      expect(result.added).toHaveLength(1);
      expect(result.added[0].url).toBe('https://example.com/b.jpg');
      expect(result.removed).toHaveLength(0);
      expect(result.changed).toHaveLength(0);
    });

    it('detects removed media entries', () => {
      const before = [
        { url: 'https://example.com/a.jpg', role: 'primary' },
        { url: 'https://example.com/b.jpg', role: 'secondary' },
      ];
      const after = [{ url: 'https://example.com/a.jpg', role: 'primary' }];
      const result = diffMediaArray(before, after);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(1);
      expect(result.removed[0].url).toBe('https://example.com/b.jpg');
      expect(result.changed).toHaveLength(0);
    });

    it('detects changed media entries (same URL, different fields)', () => {
      const before = [{ url: 'https://example.com/a.jpg', role: 'primary', type: 'image' }];
      const after = [{ url: 'https://example.com/a.jpg', role: 'thumbnail', type: 'image' }];
      const result = diffMediaArray(before, after);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.changed).toHaveLength(1);
      expect(result.changed[0].changedFields).toContain('role');
    });

    it('handles null/undefined inputs gracefully', () => {
      expect(diffMediaArray(null, [])).toEqual({ added: [], removed: [], changed: [] });
      expect(diffMediaArray([], null)).toEqual({ added: [], removed: [], changed: [] });
      expect(diffMediaArray(undefined, undefined)).toEqual({ added: [], removed: [], changed: [] });
    });

    it('handles entries without URL by ignoring them', () => {
      const before = [{ role: 'primary' }]; // No URL
      const after = [{ url: 'https://example.com/a.jpg', role: 'primary' }];
      const result = diffMediaArray(before, after);
      // Entry without URL is not tracked
      expect(result.added).toHaveLength(1);
    });
  });

  describe('summarizeMediaChanges', () => {
    it('summarizes added media', () => {
      const diff = {
        added: [{ url: 'https://example.com/a.jpg' }],
        removed: [],
        changed: [],
      };
      expect(summarizeMediaChanges(diff)).toBe('+1 added');
    });

    it('summarizes removed media', () => {
      const diff = {
        added: [],
        removed: [{ url: 'https://example.com/a.jpg' }],
        changed: [],
      };
      expect(summarizeMediaChanges(diff)).toBe('−1 removed');
    });

    it('summarizes modified media', () => {
      const diff = {
        added: [],
        removed: [],
        changed: [{ before: { url: 'https://example.com/a.jpg' }, after: { url: 'https://example.com/a.jpg' }, changedFields: ['role'] }],
      };
      expect(summarizeMediaChanges(diff)).toBe('~1 modified');
    });

    it('combines multiple change types', () => {
      const diff = {
        added: [{ url: 'a' }, { url: 'b' }],
        removed: [{ url: 'c' }],
        changed: [{ before: { url: 'd' }, after: { url: 'd' }, changedFields: ['role'] }],
      };
      expect(summarizeMediaChanges(diff)).toBe('+2 added, −1 removed, ~1 modified');
    });

    it('returns "No changes" for empty diff', () => {
      const diff = { added: [], removed: [], changed: [] };
      expect(summarizeMediaChanges(diff)).toBe('No changes');
    });
  });

  describe('getMediaEntryLabel', () => {
    it('prefers role as label', () => {
      expect(getMediaEntryLabel({ role: 'primary', type: 'image', url: 'https://example.com/a.jpg' })).toBe('primary');
    });

    it('falls back to type when no role', () => {
      expect(getMediaEntryLabel({ type: 'image', url: 'https://example.com/a.jpg' })).toBe('image');
    });

    it('extracts filename from URL when no role or type', () => {
      expect(getMediaEntryLabel({ url: 'https://example.com/path/to/image.jpg' })).toBe('image.jpg');
    });

    it('truncates invalid URLs', () => {
      // Invalid URL triggers the catch block and truncates
      const invalidUrl = 'not-a-valid-url-' + 'a'.repeat(100);
      const label = getMediaEntryLabel({ url: invalidUrl });
      expect(label.length).toBeLessThanOrEqual(43); // 40 + '...'
      expect(label.endsWith('...')).toBe(true);
    });

    it('returns "media" as fallback', () => {
      expect(getMediaEntryLabel({})).toBe('media');
    });
  });

  describe('Field classification sets are mutually exclusive', () => {
    it('no field appears in multiple sets', () => {
      const allFields = [
        ...Array.from(METADATA_FIELDS),
        ...Array.from(STRUCTURED_FIELDS),
        ...Array.from(MEDIA_FIELDS),
        ...Array.from(SCALAR_FIELDS),
      ];
      const uniqueFields = new Set(allFields);
      expect(uniqueFields.size).toBe(allFields.length);
    });
  });
});
