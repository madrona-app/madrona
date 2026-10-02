import { describe, it, expect } from 'vitest';
import {
  extractDotPath,
  extractJSONPath,
  extractCSVColumn,
  extractDBRow,
  extract,
  extractSafe,
  extractRequired,
  createExtractor,
} from './extractors';
import { ExtractionError } from './errors';

describe('extractDotPath', () => {
  describe('simple paths', () => {
    it('extracts top-level property', () => {
      expect(extractDotPath({ title: 'Test' }, 'title')).toBe('Test');
    });

    it('returns undefined for missing property', () => {
      expect(extractDotPath({ title: 'Test' }, 'missing')).toBeUndefined();
    });

    it('returns entire source when path is empty', () => {
      const source = { title: 'Test' };
      expect(extractDotPath(source, '')).toBe(source);
    });
  });

  describe('nested paths', () => {
    it('extracts nested property', () => {
      const source = { fields: { title: 'Test' } };
      expect(extractDotPath(source, 'fields.title')).toBe('Test');
    });

    it('extracts deeply nested property', () => {
      const source = { a: { b: { c: { d: 'deep' } } } };
      expect(extractDotPath(source, 'a.b.c.d')).toBe('deep');
    });

    it('returns undefined when intermediate is missing', () => {
      const source = { fields: {} };
      expect(extractDotPath(source, 'fields.title.text')).toBeUndefined();
    });

    it('returns undefined when intermediate is null', () => {
      const source = { fields: null };
      expect(extractDotPath(source, 'fields.title')).toBeUndefined();
    });
  });

  describe('array access', () => {
    it('extracts array element by index', () => {
      const source = { items: ['a', 'b', 'c'] };
      expect(extractDotPath(source, 'items[0]')).toBe('a');
      expect(extractDotPath(source, 'items[1]')).toBe('b');
    });

    it('extracts nested property from array element', () => {
      const source = { authors: [{ name: 'John' }, { name: 'Jane' }] };
      expect(extractDotPath(source, 'authors[0].name')).toBe('John');
      expect(extractDotPath(source, 'authors[1].name')).toBe('Jane');
    });

    it('returns undefined for out of bounds index', () => {
      const source = { items: ['a'] };
      expect(extractDotPath(source, 'items[5]')).toBeUndefined();
    });

    it('handles nested array access', () => {
      const source = { data: { rows: [{ value: 42 }] } };
      expect(extractDotPath(source, 'data.rows[0].value')).toBe(42);
    });
  });

  describe('edge cases', () => {
    it('handles null source', () => {
      expect(extractDotPath(null, 'title')).toBeUndefined();
    });

    it('handles undefined source', () => {
      expect(extractDotPath(undefined, 'title')).toBeUndefined();
    });

    it('handles numeric values', () => {
      expect(extractDotPath({ count: 42 }, 'count')).toBe(42);
    });

    it('handles boolean values', () => {
      expect(extractDotPath({ active: false }, 'active')).toBe(false);
    });

    it('handles empty string values', () => {
      expect(extractDotPath({ name: '' }, 'name')).toBe('');
    });
  });
});

describe('extractJSONPath', () => {
  describe('with $ prefix', () => {
    it('extracts with $. prefix', () => {
      const source = { title: 'Test' };
      expect(extractJSONPath(source, '$.title')).toBe('Test');
    });

    it('extracts nested with $. prefix', () => {
      const source = { data: { title: 'Test' } };
      expect(extractJSONPath(source, '$.data.title')).toBe('Test');
    });

    it('returns source for $ only', () => {
      const source = { title: 'Test' };
      expect(extractJSONPath(source, '$')).toEqual(source);
    });

    it('returns source for $. only', () => {
      const source = { title: 'Test' };
      expect(extractJSONPath(source, '$.')).toEqual(source);
    });
  });

  describe('array access', () => {
    it('extracts array element', () => {
      const source = { items: [{ name: 'Test' }] };
      expect(extractJSONPath(source, '$.items[0].name')).toBe('Test');
    });
  });

  describe('without prefix', () => {
    it('works without $ prefix', () => {
      const source = { title: 'Test' };
      expect(extractJSONPath(source, 'title')).toBe('Test');
    });
  });
});

describe('extractCSVColumn', () => {
  it('extracts column by name', () => {
    const row = { Title: 'Test', Artist: 'Unknown' };
    expect(extractCSVColumn(row, 'Title')).toBe('Test');
  });

  it('returns undefined for missing column', () => {
    const row = { Title: 'Test' };
    expect(extractCSVColumn(row, 'Missing')).toBeUndefined();
  });

  it('handles empty values', () => {
    const row = { Title: '' };
    expect(extractCSVColumn(row, 'Title')).toBe('');
  });

  it('handles numeric values', () => {
    const row = { Year: 2024 };
    expect(extractCSVColumn(row, 'Year')).toBe(2024);
  });
});

describe('extractDBRow', () => {
  it('extracts from flat row', () => {
    const bundle = { title: 'Test', artist: 'Artist' };
    expect(extractDBRow(bundle, 'title')).toBe('Test');
  });

  it('extracts from table-prefixed path', () => {
    const bundle = {
      objects: { title: 'Test' },
      artists: { name: 'Artist' },
    };
    expect(extractDBRow(bundle, 'objects.title')).toBe('Test');
    expect(extractDBRow(bundle, 'artists.name')).toBe('Artist');
  });

  it('returns undefined for missing table', () => {
    const bundle = { objects: { title: 'Test' } };
    expect(extractDBRow(bundle, 'missing.field')).toBeUndefined();
  });
});

describe('extract', () => {
  describe('JSONPath detection', () => {
    it('uses JSONPath for paths starting with $', () => {
      const source = { title: 'Test' };
      expect(extract(source, '$.title')).toBe('Test');
    });

    it('uses JSONPath for complex $ paths', () => {
      const source = { data: { items: [{ name: 'Test' }] } };
      expect(extract(source, '$.data.items[0].name')).toBe('Test');
    });
  });

  describe('dot notation', () => {
    it('uses dot notation for regular paths', () => {
      const source = { fields: { title: 'Test' } };
      expect(extract(source, 'fields.title')).toBe('Test');
    });

    it('uses dot notation for simple paths', () => {
      const source = { title: 'Test' };
      expect(extract(source, 'title')).toBe('Test');
    });
  });
});

describe('extractSafe', () => {
  it('returns extracted value when present', () => {
    const source = { title: 'Test' };
    expect(extractSafe(source, 'title', 'Default')).toBe('Test');
  });

  it('returns default when value is undefined', () => {
    const source = {};
    expect(extractSafe(source, 'missing', 'Default')).toBe('Default');
  });

  it('returns undefined as default when not specified', () => {
    const source = {};
    expect(extractSafe(source, 'missing')).toBeUndefined();
  });

  it('returns default on error', () => {
    // This tests the catch block
    expect(extractSafe(null, 'title', 'Default')).toBe('Default');
  });

  it('returns value even when default is provided', () => {
    const source = { count: 0 };
    expect(extractSafe(source, 'count', 100)).toBe(0);
  });

  it('returns null when value is explicitly null (default applies only to undefined)', () => {
    const source = { title: null };
    expect(extractSafe(source, 'title', 'Default')).toBeNull();
  });
});

describe('extractRequired', () => {
  it('returns value when present', () => {
    const source = { title: 'Test' };
    expect(extractRequired(source, 'title')).toBe('Test');
  });

  it('returns falsy values if not undefined/null', () => {
    expect(extractRequired({ count: 0 }, 'count')).toBe(0);
    expect(extractRequired({ flag: false }, 'flag')).toBe(false);
    expect(extractRequired({ text: '' }, 'text')).toBe('');
  });

  it('throws ExtractionError when value is undefined', () => {
    const source = {};
    expect(() => extractRequired(source, 'missing')).toThrow(ExtractionError);
  });

  it('throws ExtractionError when value is null', () => {
    const source = { title: null };
    expect(() => extractRequired(source, 'title')).toThrow(ExtractionError);
  });

  it('includes path in error', () => {
    const source = {};
    try {
      extractRequired(source, 'my.nested.path');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExtractionError);
      expect((error as ExtractionError).sourcePath).toBe('my.nested.path');
    }
  });

  it('includes message in error', () => {
    const source = {};
    try {
      extractRequired(source, 'title');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExtractionError);
      expect((error as ExtractionError).message).toContain('missing or null');
    }
  });
});

describe('createExtractor', () => {
  it('returns the same function', () => {
    const customFn = (source: any, path: string) => source[path];
    const extractor = createExtractor(customFn);
    expect(extractor).toBe(customFn);
  });

  it('created extractor works correctly', () => {
    const uppercaseFn = (source: any, path: string) => {
      const value = source[path];
      return typeof value === 'string' ? value.toUpperCase() : value;
    };
    const extractor = createExtractor(uppercaseFn);
    expect(extractor({ title: 'test' }, 'title')).toBe('TEST');
  });
});
