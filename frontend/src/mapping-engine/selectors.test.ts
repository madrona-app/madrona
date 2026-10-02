/**
 * Madrona Mapping Engine v1 — Source Selector Tests
 * 
 * Tests for safe value extraction from SourceRecord.raw.
 */

import { describe, test, expect } from 'vitest';
import {
  selectOne,
  selectMany,
  selectByPath,
  selectByJSONPath,
  selectByTemplate,
  createSelector,
  selectWithFallback,
} from './selectors';

describe('Source Selectors', () => {
  const sampleSource = {
    fields: {
      Title: 'The Starry Night',
      Artist: 'Vincent van Gogh',
      Year: 1889,
      AccessionNumbers: ['2001.123', '2001.124'],
      Medium: null,
      Keywords: ['landscape', 'night', 'stars'],
    },
    nested: {
      deep: {
        value: 'Found it!',
      },
    },
    items: [
      { id: 1, name: 'Item One' },
      { id: 2, name: 'Item Two' },
    ],
  };
  
  describe('selectOne()', () => {
    test('extracts value with string path', () => {
      expect(selectOne(sampleSource, 'fields.Title')).toBe('The Starry Night');
      expect(selectOne(sampleSource, 'fields.Year')).toBe(1889);
    });
    
    test('returns undefined for missing paths', () => {
      expect(selectOne(sampleSource, 'fields.Missing')).toBeUndefined();
      expect(selectOne(sampleSource, 'deeply.nested.missing')).toBeUndefined();
    });
    
    test('handles null values', () => {
      expect(selectOne(sampleSource, 'fields.Medium')).toBeNull();
    });
    
    test('extracts from arrays', () => {
      expect(selectOne(sampleSource, 'items[0].name')).toBe('Item One');
      expect(selectOne(sampleSource, 'fields.AccessionNumbers[1]')).toBe('2001.124');
    });
    
    test('works with path selector object', () => {
      const result = selectOne(sampleSource, {
        type: 'path',
        path: 'fields.Title',
      });
      expect(result).toBe('The Starry Night');
    });
    
    test('works with constant selector', () => {
      const result = selectOne(sampleSource, {
        type: 'constant',
        value: 'Fixed Value',
      });
      expect(result).toBe('Fixed Value');
    });
    
    test('fails safely on invalid input', () => {
      expect(selectOne({}, '')).toBeUndefined();
      expect(selectOne(null as any, 'path')).toBeUndefined();
    });
  });
  
  describe('selectMany()', () => {
    test('returns array values', () => {
      const result = selectMany(sampleSource, 'fields.AccessionNumbers');
      expect(result).toEqual(['2001.123', '2001.124']);
    });
    
    test('wraps single values in array', () => {
      const result = selectMany(sampleSource, 'fields.Title');
      expect(result).toEqual(['The Starry Night']);
    });
    
    test('returns empty array for missing values', () => {
      expect(selectMany(sampleSource, 'fields.Missing')).toEqual([]);
    });
    
    test('returns empty array for null values', () => {
      expect(selectMany(sampleSource, 'fields.Medium')).toEqual([]);
    });
    
    test('extracts nested arrays', () => {
      const result = selectMany(sampleSource, 'fields.Keywords');
      expect(result).toEqual(['landscape', 'night', 'stars']);
    });
  });
  
  describe('selectByPath()', () => {
    test('handles dot notation', () => {
      expect(selectByPath(sampleSource, 'fields.Title')).toBe('The Starry Night');
      expect(selectByPath(sampleSource, 'nested.deep.value')).toBe('Found it!');
    });
    
    test('handles bracket notation', () => {
      expect(selectByPath(sampleSource, 'items[0].name')).toBe('Item One');
      expect(selectByPath(sampleSource, 'fields.AccessionNumbers[0]')).toBe('2001.123');
    });
    
    test('handles mixed notation', () => {
      expect(selectByPath(sampleSource, 'items[1].name')).toBe('Item Two');
    });
    
    test('returns undefined for invalid paths', () => {
      expect(selectByPath(sampleSource, 'missing.path')).toBeUndefined();
      expect(selectByPath(sampleSource, 'items[99]')).toBeUndefined();
    });
  });
  
  describe('selectByJSONPath()', () => {
    test('handles basic JSONPath', () => {
      expect(selectByJSONPath(sampleSource, '$.fields.Title')).toBe('The Starry Night');
      expect(selectByJSONPath(sampleSource, '$.nested.deep.value')).toBe('Found it!');
    });
    
    test('handles array indexing', () => {
      expect(selectByJSONPath(sampleSource, '$.items[0].name')).toBe('Item One');
    });
    
    test('handles array wildcard', () => {
      const result = selectByJSONPath(sampleSource, '$.items[*].name');
      expect(result).toEqual(['Item One', 'Item Two']);
    });
    
    test('returns all items with [*]', () => {
      const result = selectByJSONPath(sampleSource, '$.fields.AccessionNumbers[*]');
      expect(result).toEqual(['2001.123', '2001.124']);
    });
  });
  
  describe('selectByTemplate()', () => {
    test('interpolates single placeholder', () => {
      const result = selectByTemplate(sampleSource, 'Title: {{fields.Title}}');
      expect(result).toBe('Title: The Starry Night');
    });
    
    test('interpolates multiple placeholders', () => {
      const result = selectByTemplate(
        sampleSource,
        '{{fields.Title}} by {{fields.Artist}} ({{fields.Year}})'
      );
      expect(result).toBe('The Starry Night by Vincent van Gogh (1889)');
    });
    
    test('returns undefined if any placeholder fails', () => {
      const result = selectByTemplate(
        sampleSource,
        '{{fields.Title}} - {{fields.Missing}}'
      );
      expect(result).toBeUndefined();
    });
    
    test('returns template as-is if no placeholders', () => {
      const result = selectByTemplate(sampleSource, 'Static text');
      expect(result).toBe('Static text');
    });
  });
  
  describe('createSelector()', () => {
    test('creates path selector from string', () => {
      const selector = createSelector('fields.Title');
      expect(selector).toEqual({ type: 'path', path: 'fields.Title' });
    });
    
    test('detects JSONPath', () => {
      const selector = createSelector('$.data.title');
      expect(selector).toEqual({ type: 'jsonpath', expression: '$.data.title' });
    });
    
    test('detects template', () => {
      const selector = createSelector('{{fields.Title}} - {{fields.Year}}');
      expect(selector).toEqual({
        type: 'template',
        template: '{{fields.Title}} - {{fields.Year}}',
      });
    });
    
    test('passes through existing selector', () => {
      const selector = { type: 'constant' as const, value: 'test' };
      expect(createSelector(selector)).toBe(selector);
    });
  });
  
  describe('selectWithFallback()', () => {
    test('returns first non-undefined value', () => {
      const result = selectWithFallback(sampleSource, [
        'fields.Missing',
        'fields.Title',
        'fields.Artist',
      ]);
      expect(result).toBe('The Starry Night');
    });
    
    test('skips null values and continues', () => {
      const result = selectWithFallback(sampleSource, [
        'fields.Missing',
        'fields.Medium',
        'fields.Title',
      ]);
      expect(result).toBe('The Starry Night');
    });
    
    test('returns undefined if all fail', () => {
      const result = selectWithFallback(sampleSource, [
        'fields.Missing1',
        'fields.Missing2',
        'fields.Missing3',
      ]);
      expect(result).toBeUndefined();
    });
    
    test('works with selector objects', () => {
      const result = selectWithFallback(sampleSource, [
        { type: 'path', path: 'fields.Missing' },
        { type: 'path', path: 'fields.Title' },
      ]);
      expect(result).toBe('The Starry Night');
    });
  });
  
  describe('Safe Failure Behavior', () => {
    test('selectOne never throws', () => {
      expect(() => selectOne(null as any, 'path')).not.toThrow();
      expect(() => selectOne({}, '')).not.toThrow();
      expect(() => selectOne({}, 'deeply[nested][path]')).not.toThrow();
    });
    
    test('selectMany never throws', () => {
      expect(() => selectMany(null as any, 'path')).not.toThrow();
      expect(() => selectMany({}, '')).not.toThrow();
      expect(selectMany({}, 'missing')).toEqual([]);
    });
    
    test('selectByPath handles malformed paths', () => {
      expect(selectByPath(sampleSource, '')).toBeUndefined();
      expect(selectByPath(sampleSource, '...')).toBeUndefined();
    });
  });
});
