import { describe, it, expect } from 'vitest';
import {
  isCanonicalRecord,
  createCanonicalRecord,
  formatValidationErrors,
} from '../../types/canonical';
import { z } from 'zod';

describe('canonical', () => {
  describe('isCanonicalRecord', () => {
    it('returns true for valid canonical record', () => {
      const record = {
        id: 'object:test:123',
        type: 'Object',
        label: 'Test Object',
        provenance: {
          system: 'test',
          recordId: '123',
        },
        meta: {
          schemaVersion: '1.0.0',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      };

      expect(isCanonicalRecord(record)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isCanonicalRecord(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isCanonicalRecord(undefined)).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(isCanonicalRecord('string')).toBe(false);
      expect(isCanonicalRecord(123)).toBe(false);
      expect(isCanonicalRecord([])).toBe(false);
    });

    it('returns false when id is missing', () => {
      const record = {
        type: 'Object',
        label: 'Test',
        provenance: {},
        meta: {},
      };

      expect(isCanonicalRecord(record)).toBe(false);
    });

    it('returns false when type is missing', () => {
      const record = {
        id: 'test:123',
        label: 'Test',
        provenance: {},
        meta: {},
      };

      expect(isCanonicalRecord(record)).toBe(false);
    });

    it('returns false when label is missing', () => {
      const record = {
        id: 'test:123',
        type: 'Object',
        provenance: {},
        meta: {},
      };

      expect(isCanonicalRecord(record)).toBe(false);
    });

    it('returns false when provenance is missing', () => {
      const record = {
        id: 'test:123',
        type: 'Object',
        label: 'Test',
        meta: {},
      };

      expect(isCanonicalRecord(record)).toBe(false);
    });

    it('returns false when meta is missing', () => {
      const record = {
        id: 'test:123',
        type: 'Object',
        label: 'Test',
        provenance: {},
      };

      expect(isCanonicalRecord(record)).toBe(false);
    });

    it('returns false when id is not a string', () => {
      const record = {
        id: 123,
        type: 'Object',
        label: 'Test',
        provenance: {},
        meta: {},
      };

      expect(isCanonicalRecord(record)).toBe(false);
    });

    it('returns false when provenance is not an object', () => {
      const record = {
        id: 'test:123',
        type: 'Object',
        label: 'Test',
        provenance: 'not-object',
        meta: {},
      };

      expect(isCanonicalRecord(record)).toBe(false);
    });
  });

  describe('createCanonicalRecord', () => {
    it('creates a record with defaults', () => {
      const record = createCanonicalRecord();

      expect(record.id).toBe('unknown:000000-0000-0000-0000-000000000000:unknown');
      expect(record.type).toBe('Object');
      expect(record.label).toBe('Untitled');
      expect(record.provenance.system).toBe('unknown');
      expect(record.meta.schemaVersion).toBe('1.0.0');
    });

    it('creates a record with custom id', () => {
      const record = createCanonicalRecord({ id: 'custom:id:123' });

      expect(record.id).toBe('custom:id:123');
    });

    it('creates a record with custom type', () => {
      const record = createCanonicalRecord({ type: 'Artwork' });

      expect(record.type).toBe('Artwork');
    });

    it('creates a record with custom label', () => {
      const record = createCanonicalRecord({ label: 'My Custom Label' });

      expect(record.label).toBe('My Custom Label');
    });

    it('creates a record with custom provenance', () => {
      const provenance = {
        system: 'museum-api',
        recordId: 'MUS-001',
        sourceRecordId: 'src-001',
        snapshotId: 'snap_1',
        mappingId: 'map_1',
        transformId: 'transform_1',
        ingestedAt: '2024-06-01T00:00:00Z',
      };
      const record = createCanonicalRecord({ provenance });

      expect(record.provenance.system).toBe('museum-api');
      expect(record.provenance.recordId).toBe('MUS-001');
    });

    it('creates a record with custom meta', () => {
      const meta = {
        schemaVersion: '2.0.0',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-06-01T00:00:00Z',
      };
      const record = createCanonicalRecord({ meta });

      expect(record.meta.schemaVersion).toBe('2.0.0');
    });

    it('creates a record with additional optional fields', () => {
      const record = createCanonicalRecord({
        description: 'A test description',
        properties: { creator: 'Test Artist' },
      });

      expect(record.description).toBe('A test description');
      expect(record.properties?.creator).toBe('Test Artist');
    });

    it('returns a valid canonical record', () => {
      const record = createCanonicalRecord();

      expect(isCanonicalRecord(record)).toBe(true);
    });
  });

  describe('formatValidationErrors', () => {
    it('formats simple error path', () => {
      const issues: z.ZodIssue[] = [
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'undefined',
          path: ['name'],
          message: 'Required',
        },
      ];

      const formatted = formatValidationErrors(issues);

      expect(formatted[0]).toContain('name');
    });

    it('formats nested error path', () => {
      const issues: z.ZodIssue[] = [
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'undefined',
          path: ['provenance', 'system'],
          message: 'Required',
        },
      ];

      const formatted = formatValidationErrors(issues);

      expect(formatted[0]).toContain('provenance.system');
    });

    it('handles empty issues array', () => {
      const formatted = formatValidationErrors([]);

      expect(formatted).toHaveLength(0);
    });

    it('handles multiple issues', () => {
      const issues: z.ZodIssue[] = [
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'undefined',
          path: ['id'],
          message: 'Required',
        },
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'number',
          path: ['type'],
          message: 'Expected string, received number',
        },
      ];

      const formatted = formatValidationErrors(issues);

      expect(formatted.length).toBe(2);
    });
  });
});
