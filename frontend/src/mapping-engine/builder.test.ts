/**
 * Madrona Mapping Engine v1 — CanonicalRecord Builder Tests
 * 
 * Test suite for safe builder utilities.
 */

import { describe, it, expect } from 'vitest';
import type { CanonicalRecord } from '../types/canonical';
import {
  setPath,
  appendPath,
  ensureArray,
  isReservedPath,
  getReservedKeys,
  safeMerge,
  CanonicalBuilderError,
} from './builder';

describe('CanonicalRecord Builder Utilities', () => {
  
  describe('setPath', () => {
    it('should set simple top-level field', () => {
      const record: Partial<CanonicalRecord> = {};
      
      setPath(record, 'description', 'A beautiful painting');
      
      expect(record.description).toBe('A beautiful painting');
    });
    
    it('should set nested field', () => {
      const record: Partial<CanonicalRecord> = {};
      
      setPath(record, 'properties.medium', 'Oil on canvas');
      
      expect(record.properties).toEqual({ medium: 'Oil on canvas' });
    });
    
    it('should set deeply nested field', () => {
      const record: Partial<CanonicalRecord> = {};
      
      setPath(record, 'properties.dimensions.height', 100);
      
      expect(record.properties).toEqual({
        dimensions: { height: 100 }
      });
    });
    
    it('should overwrite existing values', () => {
      const record: Partial<CanonicalRecord> = {
        description: 'Old description',
      };
      
      setPath(record, 'description', 'New description');
      
      expect(record.description).toBe('New description');
    });
    
    it('should support $. prefix in path', () => {
      const record: Partial<CanonicalRecord> = {};
      
      setPath(record, '$.description', 'Test');
      
      expect(record.description).toBe('Test');
    });
    
    it('should set array element by index', () => {
      const record: any = {
        tags: ['Tag 1', 'Tag 2', 'Tag 3'],
      };
      
      setPath(record, 'tags[1]', 'Updated Tag 2');
      
      expect(record.tags).toEqual([
        'Tag 1',
        'Updated Tag 2',
        'Tag 3',
      ]);
    });
    
    it('should throw error for reserved top-level key', () => {
      const record: Partial<CanonicalRecord> = {};
      
      expect(() => {
        setPath(record, 'id', 'obj_123');
      }).toThrow(CanonicalBuilderError);
      
      expect(() => {
        setPath(record, 'type', 'Object');
      }).toThrow(CanonicalBuilderError);
      
      expect(() => {
        setPath(record, 'provenance', {});
      }).toThrow(CanonicalBuilderError);
    });
    
    it('should allow reserved keys with force flag', () => {
      const record: Partial<CanonicalRecord> = {};
      
      setPath(record, 'id', 'obj_123', { force: true });
      
      expect(record.id).toBe('obj_123');
    });
    
    it('should throw error for extensions namespace', () => {
      const record: Partial<CanonicalRecord> = {};
      
      expect(() => {
        setPath(record, 'extensions.custom', { value: 123 });
      }).toThrow(CanonicalBuilderError);
    });
    
    it('should throw error for empty path', () => {
      const record: Partial<CanonicalRecord> = {};
      
      expect(() => {
        setPath(record, '', 'value');
      }).toThrow(CanonicalBuilderError);
    });
    
    it('should throw error for out of bounds array index', () => {
      const record: any = {
        tags: ['Tag 1'],
      };
      
      expect(() => {
        setPath(record, 'tags[5]', 'Out of bounds');
      }).toThrow(CanonicalBuilderError);
    });
    
    it('should throw error for array index on non-array', () => {
      const record: Partial<CanonicalRecord> = {
        description: 'Not an array',
      };
      
      expect(() => {
        setPath(record, 'description[0]', 'value');
      }).toThrow(CanonicalBuilderError);
    });
  });
  
  describe('appendPath', () => {
    it('should create array and append item', () => {
      const record: Partial<CanonicalRecord> = {};
      
      appendPath(record, 'identifiers', { scheme: 'acc', value: '2024.001' });
      
      expect(record.identifiers).toEqual([
        { scheme: 'acc', value: '2024.001' }
      ]);
    });
    
    it('should append to existing array', () => {
      const record: Partial<CanonicalRecord> = {
        identifiers: [{ scheme: 'acc', value: '2024.001' }],
      };
      
      appendPath(record, 'identifiers', { scheme: 'acc', value: '2024.002' });
      
      expect(record.identifiers).toEqual([
        { scheme: 'acc', value: '2024.001' },
        { scheme: 'acc', value: '2024.002' },
      ]);
    });
    
    it('should append to nested array', () => {
      const record: Partial<CanonicalRecord> = {};
      
      appendPath(record, 'properties.keywords', 'landscape');
      appendPath(record, 'properties.keywords', 'night');
      
      expect(record.properties).toEqual({
        keywords: ['landscape', 'night']
      });
    });
    
    it('should support $. prefix in path', () => {
      const record: any = {};
      
      appendPath(record, '$.tags', 'Tag 1');
      
      expect(record.tags).toEqual(['Tag 1']);
    });
    
    it('should throw error if path exists but is not array', () => {
      const record: Partial<CanonicalRecord> = {
        description: 'Not an array',
      };
      
      expect(() => {
        appendPath(record, 'description', 'item');
      }).toThrow(CanonicalBuilderError);
    });
    
    it('should throw error for reserved top-level key', () => {
      const record: Partial<CanonicalRecord> = {};
      
      expect(() => {
        appendPath(record, 'provenance', { source: 'test' });
      }).toThrow(CanonicalBuilderError);
    });
    
    it('should throw error for array index notation', () => {
      const record: Partial<CanonicalRecord> = {};
      
      expect(() => {
        appendPath(record, 'identifiers[0]', { scheme: 'acc', value: '123' });
      }).toThrow(CanonicalBuilderError);
    });
    
    it('should throw error for empty path', () => {
      const record: Partial<CanonicalRecord> = {};
      
      expect(() => {
        appendPath(record, '', 'value');
      }).toThrow(CanonicalBuilderError);
    });
  });
  
  describe('ensureArray', () => {
    it('should create empty array if path does not exist', () => {
      const record: Partial<CanonicalRecord> = {};
      
      const arr = ensureArray(record, 'identifiers');
      
      expect(arr).toEqual([]);
      expect(record.identifiers).toEqual([]);
    });
    
    it('should return existing array if already exists', () => {
      const record: Partial<CanonicalRecord> = {
        identifiers: [{ scheme: 'acc', value: '123' }],
      };
      
      const arr = ensureArray(record, 'identifiers');
      
      expect(arr).toBe(record.identifiers);
      expect(arr).toEqual([{ scheme: 'acc', value: '123' }]);
    });
    
    it('should be idempotent', () => {
      const record: Partial<CanonicalRecord> = {};
      
      ensureArray(record, 'identifiers');
      ensureArray(record, 'identifiers');
      ensureArray(record, 'identifiers');
      
      expect(record.identifiers).toEqual([]);
    });
    
    it('should create nested arrays', () => {
      const record: Partial<CanonicalRecord> = {};
      
      ensureArray(record, 'properties.keywords');
      
      expect(record.properties).toEqual({ keywords: [] });
    });
    
    it('should support $. prefix in path', () => {
      const record: any = {};
      
      ensureArray(record, '$.tags');
      
      expect(record.tags).toEqual([]);
    });
    
    it('should throw error if path exists but is not array', () => {
      const record: Partial<CanonicalRecord> = {
        description: 'Not an array',
      };
      
      expect(() => {
        ensureArray(record, 'description');
      }).toThrow(CanonicalBuilderError);
    });
    
    it('should throw error for reserved top-level key', () => {
      const record: Partial<CanonicalRecord> = {};
      
      expect(() => {
        ensureArray(record, 'id');
      }).toThrow(CanonicalBuilderError);
    });
    
    it('should throw error for array index notation', () => {
      const record: Partial<CanonicalRecord> = {};
      
      expect(() => {
        ensureArray(record, 'identifiers[0]');
      }).toThrow(CanonicalBuilderError);
    });
    
    it('should throw error for empty path', () => {
      const record: Partial<CanonicalRecord> = {};
      
      expect(() => {
        ensureArray(record, '');
      }).toThrow(CanonicalBuilderError);
    });
  });
  
  describe('isReservedPath', () => {
    it('should return true for reserved top-level keys', () => {
      expect(isReservedPath('id')).toBe(true);
      expect(isReservedPath('type')).toBe(true);
      expect(isReservedPath('label')).toBe(true);
      expect(isReservedPath('provenance')).toBe(true);
      expect(isReservedPath('meta')).toBe(true);
    });
    
    it('should return false for non-reserved keys', () => {
      expect(isReservedPath('description')).toBe(false);
      expect(isReservedPath('properties')).toBe(false);
      expect(isReservedPath('identifiers')).toBe(false);
      expect(isReservedPath('dates')).toBe(false);
    });
    
    it('should return false for nested paths under non-reserved keys', () => {
      expect(isReservedPath('properties.medium')).toBe(false);
      expect(isReservedPath('dates.created')).toBe(false);
    });
    
    it('should support $. prefix', () => {
      expect(isReservedPath('$.id')).toBe(true);
      expect(isReservedPath('$.description')).toBe(false);
    });
  });
  
  describe('getReservedKeys', () => {
    it('should return array of reserved keys', () => {
      const keys = getReservedKeys();
      
      expect(keys).toContain('id');
      expect(keys).toContain('type');
      expect(keys).toContain('label');
      expect(keys).toContain('provenance');
      expect(keys).toContain('meta');
    });
  });
  
  describe('safeMerge', () => {
    it('should merge non-reserved fields', () => {
      const record: Partial<CanonicalRecord> = {};
      const source = {
        description: 'A painting',
        properties: { medium: 'Oil' },
      };
      
      const warnings = safeMerge(record, source);
      
      expect(record.description).toBe('A painting');
      expect(record.properties).toEqual({ medium: 'Oil' });
      expect(warnings).toEqual([]);
    });
    
    it('should skip reserved fields and return warnings', () => {
      const record: Partial<CanonicalRecord> = {};
      const source = {
        description: 'A painting',
        id: 'obj_123',  // Reserved
        type: 'Object',  // Reserved
      };
      
      const warnings = safeMerge(record, source);
      
      expect(record.description).toBe('A painting');
      expect(record.id).toBeUndefined();
      expect(record.type).toBeUndefined();
      expect(warnings).toEqual([
        'Skipped reserved field: id',
        'Skipped reserved field: type',
      ]);
    });
    
    it('should merge reserved fields with force flag', () => {
      const record: Partial<CanonicalRecord> = {};
      const source = {
        description: 'A painting',
        id: 'obj_123',
      };
      
      const warnings = safeMerge(record, source, { force: true });
      
      expect(record.description).toBe('A painting');
      expect(record.id).toBe('obj_123');
      expect(warnings).toEqual([]);
    });
    
    it('should overwrite existing values', () => {
      const record: Partial<CanonicalRecord> = {
        description: 'Old description',
      };
      const source = {
        description: 'New description',
      };
      
      safeMerge(record, source);
      
      expect(record.description).toBe('New description');
    });
  });
  
  describe('CanonicalBuilderError', () => {
    it('should include path and reason', () => {
      const error = new CanonicalBuilderError(
        'Test error',
        'id',
        'Cannot modify reserved key'
      );
      
      expect(error.name).toBe('CanonicalBuilderError');
      expect(error.path).toBe('id');
      expect(error.reason).toBe('Cannot modify reserved key');
      expect(error.message).toBe('Test error: Cannot modify reserved key');
    });
  });
  
  describe('Integration scenarios', () => {
    it('should build a complete record safely', () => {
      const record: any = {};
      
      // Set basic fields
      setPath(record, 'description', 'Starry Night by Van Gogh');
      setPath(record, 'properties.medium', 'Oil on canvas');
      setPath(record, 'properties.dimensions.width', 73.7);
      setPath(record, 'properties.dimensions.height', 92.1);
      
      // Add identifiers
      appendPath(record, 'identifiers', { scheme: 'acc', value: '1962.116' });
      appendPath(record, 'identifiers', { scheme: 'uri', value: 'https://example.org/obj/1' });
      
      // Add tags (custom field)
      ensureArray(record, 'tags');
      appendPath(record, 'tags', 'Dutch Art');
      appendPath(record, 'tags', 'Post-Impressionism');
      
      expect(record).toEqual({
        description: 'Starry Night by Van Gogh',
        properties: {
          medium: 'Oil on canvas',
          dimensions: {
            width: 73.7,
            height: 92.1,
          },
        },
        identifiers: [
          { scheme: 'acc', value: '1962.116' },
          { scheme: 'uri', value: 'https://example.org/obj/1' },
        ],
        tags: [
          'Dutch Art',
          'Post-Impressionism',
        ],
      });
    });
    
    it('should prevent accidental overwrites of system fields', () => {
      const record: Partial<CanonicalRecord> = {};
      
      // Attempt to set system fields (should fail)
      expect(() => setPath(record, 'id', 'obj_123')).toThrow();
      expect(() => setPath(record, 'provenance', {})).toThrow();
      expect(() => setPath(record, 'meta', {})).toThrow();
      
      // Set allowed fields (should succeed)
      setPath(record, 'description', 'Safe description');
      setPath(record, 'properties.medium', 'Oil');
      
      expect(record.id).toBeUndefined();
      expect(record.provenance).toBeUndefined();
      expect(record.meta).toBeUndefined();
      expect(record.description).toBe('Safe description');
    });
  });
});
