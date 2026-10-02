import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isLegacyPayload,
  parseCanonicalRecordSafe,
  parseCanonicalRecord,
  parseCanonicalRecordListSafe,
  CanonicalPayloadError,
  CanonicalRecordEnvelopeSchema,
  getRecordDisplayProps,
} from '../../lib/canonicalValidation';

const validRecord = {
  id: 'rec-1',
  type: 'Object',
  label: 'Test Object',
  provenance: {
    source: { system: 'sys-a', recordId: 'src-1' },
    ingestedAt: '2026-01-01T00:00:00Z',
  },
  meta: {
    schemaVersion: '1.0',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
};

describe('canonicalValidation', () => {
  beforeEach(() => {
    // Silence logger noise; logger writes to console.error.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('CanonicalRecordEnvelopeSchema', () => {
    it('parses a valid record', () => {
      const result = CanonicalRecordEnvelopeSchema.parse(validRecord);
      expect(result.id).toBe('rec-1');
    });

    it('rejects missing required fields', () => {
      expect(() =>
        CanonicalRecordEnvelopeSchema.parse({ id: '', type: 'Object', label: 'x' }),
      ).toThrow();
    });
  });

  describe('isLegacyPayload', () => {
    it('returns true for non-objects', () => {
      expect(isLegacyPayload(null)).toBe(true);
      expect(isLegacyPayload('string')).toBe(true);
      expect(isLegacyPayload([])).toBe(true);
    });

    it('returns true when meta.schemaVersion === legacy', () => {
      expect(isLegacyPayload({ ...validRecord, meta: { schemaVersion: 'legacy' } })).toBe(
        true,
      );
    });

    it('returns true when meta.validationStatus === legacy', () => {
      expect(
        isLegacyPayload({ ...validRecord, meta: { validationStatus: 'legacy' } }),
      ).toBe(true);
    });

    it('returns true when required fields missing', () => {
      expect(isLegacyPayload({ type: 'Object', label: 'x' })).toBe(true);
      expect(isLegacyPayload({ id: 'a', label: 'x' })).toBe(true);
      expect(isLegacyPayload({ id: 'a', type: 'Object' })).toBe(true);
    });

    it('returns true when provenance missing or wrong type', () => {
      const noprov = { ...validRecord, provenance: undefined };
      expect(isLegacyPayload(noprov)).toBe(true);
    });

    it('returns true when provenance.source missing', () => {
      const broken = {
        ...validRecord,
        provenance: { ingestedAt: '2026-01-01T00:00:00Z' },
      };
      expect(isLegacyPayload(broken)).toBe(true);
    });

    it('returns false for a clean canonical record', () => {
      expect(isLegacyPayload(validRecord)).toBe(false);
    });
  });

  describe('parseCanonicalRecordSafe', () => {
    it('returns valid result for clean record', () => {
      const result = parseCanonicalRecordSafe(validRecord);
      expect(result.type).toBe('valid');
      if (result.type === 'valid') {
        expect(result.record.id).toBe('rec-1');
      }
    });

    it('returns legacy result for legacy payload', () => {
      const result = parseCanonicalRecordSafe({ title: 'Old', id: null });
      expect(result.type).toBe('legacy');
      if (result.type === 'legacy') {
        expect(result.displayLabel).toBe('Old');
      }
    });

    it('extracts displayId from legacy payload', () => {
      const result = parseCanonicalRecordSafe({ entity_key: 'ek-1', name: 'n' });
      if (result.type === 'legacy') {
        expect(result.displayId).toBe('ek-1');
      }
    });

    it('returns invalid result when schema parse fails', () => {
      // Has all fields but type is invalid
      const bad = { ...validRecord, type: 'NotARealType' };
      const result = parseCanonicalRecordSafe(bad);
      expect(result.type).toBe('invalid');
      if (result.type === 'invalid') {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.message).toContain('Invalid record payload');
      }
    });
  });

  describe('parseCanonicalRecord', () => {
    it('returns the parsed record for valid payloads', () => {
      const result = parseCanonicalRecord(validRecord);
      expect((result as { id: string }).id).toBe('rec-1');
    });

    it('returns the original payload for legacy', () => {
      const legacy = { name: 'Legacy' };
      const result = parseCanonicalRecord(legacy);
      expect(result).toBe(legacy);
    });

    it('throws CanonicalPayloadError on invalid', () => {
      const bad = { ...validRecord, type: 'Bad' };
      expect(() => parseCanonicalRecord(bad)).toThrow(CanonicalPayloadError);
    });

    it('attached error preserves issues and payload', () => {
      const bad = { ...validRecord, type: 'Bad' };
      try {
        parseCanonicalRecord(bad);
        throw new Error('should not reach');
      } catch (err) {
        expect(err).toBeInstanceOf(CanonicalPayloadError);
        const e = err as CanonicalPayloadError;
        expect(e.issues.length).toBeGreaterThan(0);
        expect(e.payload).toBe(bad);
        expect(e.name).toBe('CanonicalPayloadError');
      }
    });
  });

  describe('parseCanonicalRecordListSafe', () => {
    it('parses an array of payloads independently', () => {
      const results = parseCanonicalRecordListSafe([
        validRecord,
        { name: 'legacy' },
      ]);
      expect(results).toHaveLength(2);
      expect(results[0].type).toBe('valid');
      expect(results[1].type).toBe('legacy');
    });

    it('annotates endpoint with index', () => {
      // Just verify it doesn't throw and produces correct count
      const results = parseCanonicalRecordListSafe([validRecord], {
        endpoint: '/api/x',
      });
      expect(results).toHaveLength(1);
    });
  });

  describe('getRecordDisplayProps', () => {
    it('formats valid result', () => {
      const props = getRecordDisplayProps({ type: 'valid', record: validRecord as never });
      expect(props.label).toBe('Test Object');
      expect(props.isLegacy).toBe(false);
      expect(props.isInvalid).toBe(false);
    });

    it('formats legacy result', () => {
      const props = getRecordDisplayProps({
        type: 'legacy',
        payload: {},
        displayLabel: 'Old',
        displayId: 'id-1',
      });
      expect(props.isLegacy).toBe(true);
      expect(props.label).toBe('Old');
    });

    it('formats invalid result', () => {
      const props = getRecordDisplayProps({
        type: 'invalid',
        payload: { id: 'p-1' },
        errors: [],
        message: 'broken',
      });
      expect(props.isInvalid).toBe(true);
      expect(props.label).toBe('(Invalid record)');
      expect(props.id).toBe('p-1');
      expect(props.errorMessage).toBe('broken');
    });
  });
});
