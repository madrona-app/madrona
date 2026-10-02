import { describe, it, expect } from 'vitest';
import {
  validateCanonicalPayload,
  isCanonicalPayload,
  CANONICAL_ALLOWED_KEYS,
  CanonicalPayloadEnvelopeSchema,
} from '../lib/schemas';

describe('Canonical Payload Validation', () => {
  describe('CANONICAL_ALLOWED_KEYS', () => {
    it('includes all required canonical fields', () => {
      expect(CANONICAL_ALLOWED_KEYS.has('id')).toBe(true);
      expect(CANONICAL_ALLOWED_KEYS.has('type')).toBe(true);
      expect(CANONICAL_ALLOWED_KEYS.has('label')).toBe(true);
      expect(CANONICAL_ALLOWED_KEYS.has('provenance')).toBe(true);
      expect(CANONICAL_ALLOWED_KEYS.has('meta')).toBe(true);
    });

    it('includes optional canonical fields', () => {
      expect(CANONICAL_ALLOWED_KEYS.has('description')).toBe(true);
      expect(CANONICAL_ALLOWED_KEYS.has('identifiers')).toBe(true);
      expect(CANONICAL_ALLOWED_KEYS.has('classifications')).toBe(true);
      expect(CANONICAL_ALLOWED_KEYS.has('properties')).toBe(true);
      expect(CANONICAL_ALLOWED_KEYS.has('relationships')).toBe(true);
      expect(CANONICAL_ALLOWED_KEYS.has('media')).toBe(true);
      expect(CANONICAL_ALLOWED_KEYS.has('rights')).toBe(true);
      expect(CANONICAL_ALLOWED_KEYS.has('extensions')).toBe(true);
    });

    it('does not include source-specific keys', () => {
      expect(CANONICAL_ALLOWED_KEYS.has('accessionNumber')).toBe(false);
      expect(CANONICAL_ALLOWED_KEYS.has('objectName')).toBe(false);
      expect(CANONICAL_ALLOWED_KEYS.has('title')).toBe(false);
      expect(CANONICAL_ALLOWED_KEYS.has('source_data')).toBe(false);
    });
  });

  describe('CanonicalPayloadEnvelopeSchema', () => {
    it('validates minimal canonical payload', () => {
      const minimal = {
        id: 'entity_123',
        type: 'Object',
        label: 'Test Object',
      };
      const result = CanonicalPayloadEnvelopeSchema.safeParse(minimal);
      expect(result.success).toBe(true);
    });

    it('validates full canonical payload', () => {
      const full = {
        id: 'entity_123',
        type: 'Object',
        label: 'Test Object',
        provenance: {
          source: {
            system: 'test-system',
            recordId: 'rec_123',
          },
          ingestedAt: '2024-01-01T00:00:00Z',
        },
        meta: {
          schemaVersion: '1.0.0',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        description: 'A test object',
        identifiers: [
          { scheme: 'accession', value: '2024.1.1' },
        ],
        properties: {
          material: 'Bronze',
        },
      };
      const result = CanonicalPayloadEnvelopeSchema.safeParse(full);
      expect(result.success).toBe(true);
    });

    it('allows extra keys (for detection)', () => {
      const withExtra = {
        id: 'entity_123',
        type: 'Object',
        label: 'Test Object',
        unknownField: 'should not fail',
        sourceData: { raw: 'data' },
      };
      // Schema uses passthrough(), so it allows extra keys
      const result = CanonicalPayloadEnvelopeSchema.safeParse(withExtra);
      expect(result.success).toBe(true);
    });

    it('rejects missing required fields', () => {
      const missingId = {
        type: 'Object',
        label: 'Test Object',
      };
      const result = CanonicalPayloadEnvelopeSchema.safeParse(missingId);
      expect(result.success).toBe(false);
    });
  });

  describe('validateCanonicalPayload', () => {
    it('validates canonical payload and returns success', () => {
      const payload = {
        id: 'entity_123',
        type: 'Object',
        label: 'Test Object',
        provenance: {
          source: { system: 'test', recordId: 'rec_1' },
          ingestedAt: '2024-01-01T00:00:00Z',
        },
        meta: {
          schemaVersion: '1.0.0',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      };
      const result = validateCanonicalPayload(payload);
      expect(result.isValid).toBe(true);
      expect(result.isLegacy).toBe(false);
      expect(result.unknownKeys).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('detects unknown top-level keys', () => {
      const payload = {
        id: 'entity_123',
        type: 'Object',
        label: 'Test Object',
        provenance: { source: { system: 'test', recordId: 'rec_1' } },
        meta: { schemaVersion: '1.0.0' },
        // Unknown keys
        accessionNumber: '2024.1.1',
        sourceData: { raw: 'leak' },
      };
      const result = validateCanonicalPayload(payload);
      expect(result.isValid).toBe(true);
      expect(result.unknownKeys).toContain('accessionNumber');
      expect(result.unknownKeys).toContain('sourceData');
      expect(result.warnings.some(w => w.includes('Unknown top-level keys'))).toBe(true);
    });

    it('detects legacy payload by schemaVersion', () => {
      const payload = {
        id: 'entity_123',
        type: 'Object',
        label: 'Test Object',
        provenance: { source: { system: 'test', recordId: 'rec_1' } },
        meta: {
          schemaVersion: 'legacy',
          validationStatus: 'legacy',
        },
      };
      const result = validateCanonicalPayload(payload);
      expect(result.isValid).toBe(true);
      expect(result.isLegacy).toBe(true);
      expect(result.warnings.some(w => w.includes('Legacy payload'))).toBe(true);
    });

    it('detects legacy payload by missing provenance', () => {
      const payload = {
        id: 'entity_123',
        type: 'Object',
        label: 'Test Object',
        meta: { schemaVersion: '1.0.0' },
      };
      const result = validateCanonicalPayload(payload);
      expect(result.isValid).toBe(true);
      expect(result.isLegacy).toBe(true);
    });

    it('detects legacy payload by missing meta', () => {
      const payload = {
        id: 'entity_123',
        type: 'Object',
        label: 'Test Object',
        provenance: { source: { system: 'test', recordId: 'rec_1' } },
      };
      const result = validateCanonicalPayload(payload);
      expect(result.isValid).toBe(true);
      expect(result.isLegacy).toBe(true);
    });

    it('returns errors for missing required fields', () => {
      const payload = {
        type: 'Object',
        // Missing id and label
      };
      const result = validateCanonicalPayload(payload);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('handles non-object payloads', () => {
      expect(validateCanonicalPayload(null).isValid).toBe(false);
      expect(validateCanonicalPayload(undefined).isValid).toBe(false);
      expect(validateCanonicalPayload('string').isValid).toBe(false);
      expect(validateCanonicalPayload([]).isValid).toBe(false);
      expect(validateCanonicalPayload(123).isValid).toBe(false);
    });
  });

  describe('isCanonicalPayload', () => {
    it('returns true for valid canonical payloads', () => {
      const payload = {
        id: 'entity_123',
        type: 'Object',
        label: 'Test Object',
        provenance: { source: { system: 'test', recordId: 'rec_1' } },
        meta: { schemaVersion: '1.0.0' },
      };
      expect(isCanonicalPayload(payload)).toBe(true);
    });

    it('returns false for legacy payloads', () => {
      const payload = {
        id: 'entity_123',
        type: 'Object',
        label: 'Test Object',
        provenance: { source: { system: 'test', recordId: 'rec_1' } },
        meta: { schemaVersion: 'legacy' },
      };
      expect(isCanonicalPayload(payload)).toBe(false);
    });

    it('returns false for missing required fields', () => {
      expect(isCanonicalPayload({ type: 'Object', label: 'Test' })).toBe(false);
      expect(isCanonicalPayload({ id: '123', label: 'Test' })).toBe(false);
      expect(isCanonicalPayload({ id: '123', type: 'Object' })).toBe(false);
    });

    it('returns false for missing provenance or meta', () => {
      expect(isCanonicalPayload({
        id: '123', type: 'Object', label: 'Test',
        provenance: {},
      })).toBe(false);
      expect(isCanonicalPayload({
        id: '123', type: 'Object', label: 'Test',
        meta: {},
      })).toBe(false);
    });

    it('returns false for non-objects', () => {
      expect(isCanonicalPayload(null)).toBe(false);
      expect(isCanonicalPayload(undefined)).toBe(false);
      expect(isCanonicalPayload('string')).toBe(false);
      expect(isCanonicalPayload([])).toBe(false);
    });
  });
});
