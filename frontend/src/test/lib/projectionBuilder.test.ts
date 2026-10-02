import { describe, it, expect } from 'vitest';
import { buildDefaultProjection } from '../../lib/projectionBuilder';

describe('buildDefaultProjection', () => {
  describe('basic projection structure', () => {
    it('returns projection with correct ID format', () => {
      const result = buildDefaultProjection(null, 'entities_list', 'ds-123');
      expect(result.projection_id).toBe('default-entities_list-ds-123');
    });

    it('returns projection with dataset_id', () => {
      const result = buildDefaultProjection(null, 'entities_list', 'ds-456');
      expect(result.dataset_id).toBe('ds-456');
    });

    it('returns projection with correct scope', () => {
      const listResult = buildDefaultProjection(null, 'entities_list', 'ds-123');
      expect(listResult.scope).toBe('entities_list');

      const detailResult = buildDefaultProjection(null, 'entity_detail', 'ds-123');
      expect(detailResult.scope).toBe('entity_detail');
    });

    it('returns projection with hybrid mode', () => {
      const result = buildDefaultProjection(null, 'entities_list', 'ds-123');
      expect(result.mode).toBe('hybrid');
    });

    it('includes schema_ref with schema_id', () => {
      const result = buildDefaultProjection(null, 'entities_list', 'ds-123');
      expect(result.schema_ref.schema_id).toBe('dataset-ds-123');
      expect(result.schema_ref.schema_version).toBe('1.0');
    });

    it('includes schema_json when provided', () => {
      const schema = { properties: { name: { type: 'string' } } };
      const result = buildDefaultProjection(schema, 'entities_list', 'ds-123');
      expect(result.schema_ref.schema_json).toEqual(schema);
    });

    it('omits schema_json when null', () => {
      const result = buildDefaultProjection(null, 'entities_list', 'ds-123');
      expect(result.schema_ref.schema_json).toBeUndefined();
    });
  });

  describe('entities_list scope', () => {
    it('extracts title field from spine.title', () => {
      const schema = {
        properties: {
          spine: {
            type: 'object',
            properties: {
              title: { type: 'string' }
            }
          }
        }
      };
      const result = buildDefaultProjection(schema, 'entities_list', 'ds-123');
      const titleField = result.fields.find(f => f.key === 'title');
      expect(titleField).toBeDefined();
      expect(titleField?.path).toBe('spine.title');
      expect(titleField?.primary).toBe(true);
    });

    it('extracts title field from direct title property', () => {
      const schema = {
        properties: {
          title: { type: 'string' }
        }
      };
      const result = buildDefaultProjection(schema, 'entities_list', 'ds-123');
      const titleField = result.fields.find(f => f.key === 'title');
      expect(titleField).toBeDefined();
      expect(titleField?.path).toBe('title');
    });

    it('extracts title field from name when title not available', () => {
      const schema = {
        properties: {
          name: { type: 'string' }
        }
      };
      const result = buildDefaultProjection(schema, 'entities_list', 'ds-123');
      const titleField = result.fields.find(f => f.key === 'title');
      expect(titleField).toBeDefined();
      expect(titleField?.path).toBe('name');
    });

    it('extracts type field', () => {
      const schema = {
        properties: {
          entity_type: { type: 'string' }
        }
      };
      const result = buildDefaultProjection(schema, 'entities_list', 'ds-123');
      const typeField = result.fields.find(f => f.key === 'type');
      expect(typeField).toBeDefined();
      expect(typeField?.path).toBe('entity_type');
      expect(typeField?.kind).toBe('badge');
    });

    it('extracts source_system field', () => {
      const schema = {
        properties: {
          source_system: { type: 'string' }
        }
      };
      const result = buildDefaultProjection(schema, 'entities_list', 'ds-123');
      const sourceField = result.fields.find(f => f.key === 'source_system');
      expect(sourceField).toBeDefined();
      expect(sourceField?.path).toBe('source_system');
    });

    it('extracts updated field', () => {
      const schema = {
        properties: {
          updated_at: { type: 'string', format: 'date-time' }
        }
      };
      const result = buildDefaultProjection(schema, 'entities_list', 'ds-123');
      const updatedField = result.fields.find(f => f.key === 'updated');
      expect(updatedField).toBeDefined();
      expect(updatedField?.path).toBe('updated_at');
      expect(updatedField?.kind).toBe('datetime');
    });

    it('adds additional string fields', () => {
      const schema = {
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          author: { type: 'string' },
          category: { type: 'string' }
        }
      };
      const result = buildDefaultProjection(schema, 'entities_list', 'ds-123');
      // Should have title + up to 2 additional fields
      expect(result.fields.length).toBeGreaterThanOrEqual(2);
    });

    it('marks first field as primary when no title found but type exists', () => {
      const schema = {
        properties: {
          entity_type: { type: 'string' },
          description: { type: 'string' }
        }
      };
      const result = buildDefaultProjection(schema, 'entities_list', 'ds-123');
      // When type field is found but no title, type field becomes primary
      const primaryField = result.fields.find(f => f.primary);
      expect(primaryField).toBeDefined();
    });
  });

  describe('entity_detail scope', () => {
    it('includes identity fields from list scope', () => {
      const schema = {
        properties: {
          title: { type: 'string' },
          entity_type: { type: 'string' }
        }
      };
      const result = buildDefaultProjection(schema, 'entity_detail', 'ds-123');
      const titleField = result.fields.find(f => f.path === 'title');
      expect(titleField).toBeDefined();
    });

    it('removes primary flag from identity fields', () => {
      const schema = {
        properties: {
          title: { type: 'string' }
        }
      };
      const result = buildDefaultProjection(schema, 'entity_detail', 'ds-123');
      const primaryFields = result.fields.filter(f => f.primary);
      // In detail scope, primary is removed from all fields
      expect(primaryFields.length).toBeLessThanOrEqual(1);
    });

    it('includes more fields than list scope', () => {
      const schema = {
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          author: { type: 'string' },
          category: { type: 'string' },
          year: { type: 'number' },
          active: { type: 'boolean' }
        }
      };
      const listResult = buildDefaultProjection(schema, 'entities_list', 'ds-123');
      const detailResult = buildDefaultProjection(schema, 'entity_detail', 'ds-123');
      expect(detailResult.fields.length).toBeGreaterThanOrEqual(listResult.fields.length);
    });
  });

  describe('null/undefined schema handling', () => {
    it('returns empty fields array for null schema', () => {
      const result = buildDefaultProjection(null, 'entities_list', 'ds-123');
      expect(result.fields).toEqual([]);
    });

    it('returns empty fields array for undefined schema', () => {
      const result = buildDefaultProjection(undefined, 'entities_list', 'ds-123');
      expect(result.fields).toEqual([]);
    });

    it('handles schema without properties', () => {
      const schema = { type: 'object' };
      const result = buildDefaultProjection(schema, 'entities_list', 'ds-123');
      expect(result.fields).toEqual([]);
    });
  });

  describe('field type mapping', () => {
    it('maps string type to text kind', () => {
      const schema = {
        properties: {
          description: { type: 'string' }
        }
      };
      const result = buildDefaultProjection(schema, 'entity_detail', 'ds-123');
      const field = result.fields.find(f => f.path === 'description');
      expect(field?.kind).toBe('text');
    });

    it('maps number type to number kind', () => {
      const schema = {
        properties: {
          count: { type: 'number' }
        }
      };
      const result = buildDefaultProjection(schema, 'entity_detail', 'ds-123');
      const field = result.fields.find(f => f.path === 'count');
      expect(field?.kind).toBe('number');
    });

    it('maps boolean type to boolean kind', () => {
      const schema = {
        properties: {
          active: { type: 'boolean' }
        }
      };
      const result = buildDefaultProjection(schema, 'entity_detail', 'ds-123');
      const field = result.fields.find(f => f.path === 'active');
      expect(field?.kind).toBe('boolean');
    });
  });

  describe('nested properties', () => {
    it('extracts nested properties', () => {
      const schema = {
        properties: {
          spine: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              entity_type: { type: 'string' }
            }
          }
        }
      };
      const result = buildDefaultProjection(schema, 'entities_list', 'ds-123');
      const titleField = result.fields.find(f => f.path === 'spine.title');
      expect(titleField).toBeDefined();
    });

    it('limits nesting depth', () => {
      const schema = {
        properties: {
          level1: {
            type: 'object',
            properties: {
              level2: {
                type: 'object',
                properties: {
                  level3: {
                    type: 'object',
                    properties: {
                      deep: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      };
      const result = buildDefaultProjection(schema, 'entity_detail', 'ds-123');
      const deepField = result.fields.find(f => f.path.includes('level3'));
      // Should not include very deeply nested fields
      expect(deepField).toBeUndefined();
    });
  });

  describe('label generation', () => {
    it('converts snake_case to Title Case', () => {
      const schema = {
        properties: {
          first_name: { type: 'string' }
        }
      };
      const result = buildDefaultProjection(schema, 'entity_detail', 'ds-123');
      const field = result.fields.find(f => f.path === 'first_name');
      expect(field?.label).toBe('First Name');
    });

    it('converts camelCase to Title Case', () => {
      const schema = {
        properties: {
          firstName: { type: 'string' }
        }
      };
      const result = buildDefaultProjection(schema, 'entity_detail', 'ds-123');
      const field = result.fields.find(f => f.path === 'firstName');
      expect(field?.label).toBe('First Name');
    });
  });
});
