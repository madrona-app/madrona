import { describe, it, expect } from 'vitest';
import {
  createEmptyExtractionObject,
  createEmptyExtractionConfig,
  createEmptyColumnMapping,
  CANONICAL_TARGET_FIELDS,
  COLUMN_TRANSFORMS,
  ENTITY_TYPES,
} from '../../types/extraction';

describe('extraction factories', () => {
  describe('createEmptyExtractionObject', () => {
    it('returns blank schema/table/idColumn and empty mappings', () => {
      const obj = createEmptyExtractionObject();
      expect(obj.schema).toBe('');
      expect(obj.table).toBe('');
      expect(obj.idColumn).toBe('');
      expect(obj.columnMappings).toEqual([]);
    });

    it('returns a new instance every call', () => {
      const a = createEmptyExtractionObject();
      const b = createEmptyExtractionObject();
      expect(a).not.toBe(b);
      expect(a.columnMappings).not.toBe(b.columnMappings);
    });
  });

  describe('createEmptyExtractionConfig', () => {
    it('defaults to full sync, Object entity, batch 1000, continueOnError false', () => {
      const cfg = createEmptyExtractionConfig();
      expect(cfg.syncMode).toBe('full');
      expect(cfg.entityType).toBe('Object');
      expect(cfg.batchSize).toBe(1000);
      expect(cfg.continueOnError).toBe(false);
    });

    it('seeds objects with one empty extraction object', () => {
      const cfg = createEmptyExtractionConfig();
      expect(cfg.objects).toHaveLength(1);
      expect(cfg.objects[0].schema).toBe('');
      expect(cfg.objects[0].columnMappings).toEqual([]);
    });
  });

  describe('createEmptyColumnMapping', () => {
    it('defaults to "none" transform with blank source/target', () => {
      const m = createEmptyColumnMapping();
      expect(m.sourceColumn).toBe('');
      expect(m.targetField).toBe('');
      expect(m.transform).toBe('none');
    });
  });
});

describe('extraction option lists', () => {
  it('CANONICAL_TARGET_FIELDS includes id and label entries', () => {
    const ids = CANONICAL_TARGET_FIELDS.map((f) => f.value);
    expect(ids).toContain('id');
    expect(ids).toContain('label');
    expect(ids).toContain('description');
  });

  it('every CANONICAL_TARGET_FIELDS entry has a label and description', () => {
    for (const f of CANONICAL_TARGET_FIELDS) {
      expect(typeof f.label).toBe('string');
      expect(f.label.length).toBeGreaterThan(0);
      expect(typeof f.description).toBe('string');
    }
  });

  it('COLUMN_TRANSFORMS covers each transform value', () => {
    const values = COLUMN_TRANSFORMS.map((t) => t.value);
    expect(values).toEqual(
      expect.arrayContaining([
        'none',
        'trim',
        'lowercase',
        'uppercase',
        'parse_date',
        'parse_json',
      ])
    );
  });

  it('ENTITY_TYPES covers the six canonical entity types', () => {
    const values = ENTITY_TYPES.map((t) => t.value);
    expect(values).toEqual(['Object', 'Work', 'Agent', 'Place', 'Event', 'Media']);
  });
});
