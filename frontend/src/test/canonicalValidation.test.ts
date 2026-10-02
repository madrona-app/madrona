import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseCanonicalRecordSafe,
  parseCanonicalRecord,
  isLegacyPayload,
  getRecordDisplayProps,
  CanonicalPayloadError,
  CanonicalRecordEnvelopeSchema,
} from '../lib/canonicalValidation';

describe('Canonical Validation', () => {
  // Suppress console.error during tests
  const originalError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalError;
  });

  describe('CanonicalRecordEnvelopeSchema', () => {
    const validRecord = {
      id: 'mdrn:test:123',
      type: 'Object',
      label: 'Test Object',
      provenance: {
        source: {
          system: 'test-system',
          recordId: 'rec-123',
        },
        ingestedAt: '2024-01-15T10:00:00Z',
      },
      meta: {
        schemaVersion: '1.0.0',
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z',
      },
    };

    it('validates a minimal valid record', () => {
      const result = CanonicalRecordEnvelopeSchema.safeParse(validRecord);
      expect(result.success).toBe(true);
    });

    it('validates a full record with all optional fields', () => {
      const fullRecord = {
        ...validRecord,
        description: 'A test object for validation',
        status: 'active',
        identifiers: [
          { scheme: 'accession', value: '2024.001' },
          { scheme: 'doi', value: '10.1234/test' },
        ],
        classifications: [
          { scheme: 'aat', id: '300033618', label: 'paintings' },
        ],
        properties: {
          material: 'Bronze',
          dimensions: { height: '50cm', width: '30cm' },
        },
        relationships: [
          { type: 'creator', target: 'agent:123', label: 'John Smith' },
        ],
        media: [
          { id: 'media:1', type: 'image', url: 'https://example.com/img.jpg' },
        ],
        extensions: [
          { namespace: 'source.test', type: 'raw', data: { original: true } },
        ],
      };

      const result = CanonicalRecordEnvelopeSchema.safeParse(fullRecord);
      expect(result.success).toBe(true);
    });

    it('rejects record missing id', () => {
      const { id: _id, ...withoutId } = validRecord;
      const result = CanonicalRecordEnvelopeSchema.safeParse(withoutId);
      expect(result.success).toBe(false);
    });

    it('rejects record missing type', () => {
      const { type: _type, ...withoutType } = validRecord;
      const result = CanonicalRecordEnvelopeSchema.safeParse(withoutType);
      expect(result.success).toBe(false);
    });

    it('rejects record with invalid type', () => {
      const withBadType = { ...validRecord, type: 'InvalidType' };
      const result = CanonicalRecordEnvelopeSchema.safeParse(withBadType);
      expect(result.success).toBe(false);
    });

    it('rejects record missing label', () => {
      const { label: _label, ...withoutLabel } = validRecord;
      const result = CanonicalRecordEnvelopeSchema.safeParse(withoutLabel);
      expect(result.success).toBe(false);
    });

    it('rejects record missing provenance', () => {
      const { provenance: _provenance, ...withoutProvenance } = validRecord;
      const result = CanonicalRecordEnvelopeSchema.safeParse(withoutProvenance);
      expect(result.success).toBe(false);
    });

    it('rejects record missing meta', () => {
      const { meta: _meta, ...withoutMeta } = validRecord;
      const result = CanonicalRecordEnvelopeSchema.safeParse(withoutMeta);
      expect(result.success).toBe(false);
    });

    it('validates all canonical record types', () => {
      const types = ['Object', 'Work', 'Agent', 'Place', 'Event', 'Media'];
      for (const type of types) {
        const record = { ...validRecord, type };
        const result = CanonicalRecordEnvelopeSchema.safeParse(record);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('isLegacyPayload', () => {
    it('returns true for null/undefined', () => {
      expect(isLegacyPayload(null)).toBe(true);
      expect(isLegacyPayload(undefined)).toBe(true);
    });

    it('returns true for non-objects', () => {
      expect(isLegacyPayload('string')).toBe(true);
      expect(isLegacyPayload(123)).toBe(true);
      expect(isLegacyPayload([])).toBe(true);
    });

    it('returns true for explicit legacy markers', () => {
      expect(isLegacyPayload({
        id: '123',
        type: 'Object',
        label: 'Test',
        meta: { schemaVersion: 'legacy' },
        provenance: { source: { system: 'test', recordId: '123' } },
      })).toBe(true);

      expect(isLegacyPayload({
        id: '123',
        type: 'Object',
        label: 'Test',
        meta: { validationStatus: 'legacy' },
        provenance: { source: { system: 'test', recordId: '123' } },
      })).toBe(true);
    });

    it('returns true for missing required fields', () => {
      // Missing id
      expect(isLegacyPayload({ type: 'Object', label: 'Test' })).toBe(true);
      // Missing type
      expect(isLegacyPayload({ id: '123', label: 'Test' })).toBe(true);
      // Missing label
      expect(isLegacyPayload({ id: '123', type: 'Object' })).toBe(true);
    });

    it('returns true for missing provenance/meta', () => {
      expect(isLegacyPayload({
        id: '123', type: 'Object', label: 'Test',
        meta: { schemaVersion: '1.0.0' },
      })).toBe(true);

      expect(isLegacyPayload({
        id: '123', type: 'Object', label: 'Test',
        provenance: { source: { system: 'test', recordId: '123' } },
      })).toBe(true);
    });

    it('returns true for provenance without nested source', () => {
      expect(isLegacyPayload({
        id: '123', type: 'Object', label: 'Test',
        meta: { schemaVersion: '1.0.0' },
        provenance: { system: 'test', recordId: '123' }, // Flat, not nested
      })).toBe(true);
    });

    it('returns false for valid canonical record', () => {
      expect(isLegacyPayload({
        id: '123',
        type: 'Object',
        label: 'Test',
        meta: { schemaVersion: '1.0.0' },
        provenance: { source: { system: 'test', recordId: '123' } },
      })).toBe(false);
    });
  });

  describe('parseCanonicalRecordSafe', () => {
    const validRecord = {
      id: 'mdrn:test:123',
      type: 'Object',
      label: 'Test Object',
      provenance: {
        source: { system: 'test', recordId: 'rec-123' },
        ingestedAt: '2024-01-15T10:00:00Z',
      },
      meta: {
        schemaVersion: '1.0.0',
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z',
      },
    };

    it('returns valid result for valid record', () => {
      const result = parseCanonicalRecordSafe(validRecord);
      expect(result.type).toBe('valid');
      if (result.type === 'valid') {
        expect(result.record.id).toBe('mdrn:test:123');
        expect(result.record.type).toBe('Object');
        expect(result.record.label).toBe('Test Object');
      }
    });

    it('returns legacy result for legacy payload', () => {
      const legacy = { title: 'Old Record', data: { foo: 'bar' } };
      const result = parseCanonicalRecordSafe(legacy);

      expect(result.type).toBe('legacy');
      if (result.type === 'legacy') {
        expect(result.displayLabel).toBe('Old Record');
        expect(result.payload).toBe(legacy);
      }
    });

    it('returns invalid result for malformed record', () => {
      const malformed = {
        id: 'test',
        type: 'InvalidType', // Invalid enum value
        label: 'Test',
        provenance: { source: { system: 'test', recordId: '123' } },
        meta: { schemaVersion: '1.0.0', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      };

      const result = parseCanonicalRecordSafe(malformed);
      expect(result.type).toBe('invalid');
      if (result.type === 'invalid') {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.message).toContain('Invalid');
      }
    });

    it('logs validation failures', () => {
      parseCanonicalRecordSafe({ invalid: true }, { endpoint: '/api/test' });
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('parseCanonicalRecord', () => {
    const validRecord = {
      id: 'mdrn:test:123',
      type: 'Object',
      label: 'Test Object',
      provenance: {
        source: { system: 'test', recordId: 'rec-123' },
        ingestedAt: '2024-01-15T10:00:00Z',
      },
      meta: {
        schemaVersion: '1.0.0',
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z',
      },
    };

    it('returns validated record for valid input', () => {
      const result = parseCanonicalRecord(validRecord);
      expect(result).toMatchObject({
        id: 'mdrn:test:123',
        type: 'Object',
        label: 'Test Object',
      });
    });

    it('returns legacy payload unchanged', () => {
      const legacy = { title: 'Old Record', data: { foo: 'bar' } };
      const result = parseCanonicalRecord(legacy);
      expect(result).toBe(legacy); // Same reference
    });

    it('throws CanonicalPayloadError for invalid input', () => {
      const invalid = {
        id: 'test',
        type: 'BadType',
        label: 'Test',
        provenance: { source: { system: 'test', recordId: '123' } },
        meta: { schemaVersion: '1.0.0', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      };

      expect(() => parseCanonicalRecord(invalid)).toThrow(CanonicalPayloadError);
    });
  });

  describe('getRecordDisplayProps', () => {
    it('returns correct props for valid record', () => {
      const result = {
        type: 'valid' as const,
        record: {
          id: 'test-123',
          type: 'Object' as const,
          label: 'Test Object',
          provenance: {
            source: { system: 'test', recordId: '123' },
            ingestedAt: '2024-01-01T00:00:00Z',
          },
          meta: {
            schemaVersion: '1.0.0',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        },
      };

      const props = getRecordDisplayProps(result);
      expect(props.label).toBe('Test Object');
      expect(props.id).toBe('test-123');
      expect(props.type).toBe('Object');
      expect(props.isLegacy).toBe(false);
      expect(props.isInvalid).toBe(false);
    });

    it('returns correct props for legacy record', () => {
      const result = {
        type: 'legacy' as const,
        payload: { title: 'Old Item' },
        displayLabel: 'Old Item',
        displayId: null,
      };

      const props = getRecordDisplayProps(result);
      expect(props.label).toBe('Old Item');
      expect(props.isLegacy).toBe(true);
      expect(props.isInvalid).toBe(false);
    });

    it('returns correct props for invalid record', () => {
      const result = {
        type: 'invalid' as const,
        payload: { broken: true },
        errors: [{ path: ['id'], message: 'Required', code: 'invalid_type' as const, expected: 'string', received: 'undefined' }],
        message: 'Invalid record payload: id: Required',
      };

      const props = getRecordDisplayProps(result);
      expect(props.label).toBe('(Invalid record)');
      expect(props.isInvalid).toBe(true);
      expect(props.errorMessage).toContain('Invalid');
    });
  });
});
