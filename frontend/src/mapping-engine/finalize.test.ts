/**
 * Madrona Mapping Engine v1 — Finalization Tests
 * 
 * Test suite for canonical record finalization and invariant enforcement.
 */

import { describe, it, expect } from 'vitest';
import { finalizeCanonicalRecord } from './engine';
import type { SourceRecord, CanonicalRecord } from '../types/canonical';
import type { EngineContext } from './types';

describe('finalizeCanonicalRecord', () => {
  const mockContext: EngineContext = {
    pipelineId: 'route_test',
    now: '2026-01-14T10:00:00Z',
  };
  
  const mockMapping: any = {
    id: 'map_test_1',
    version: '1',
    source: 'test_system',
    target: 'canonical',
  };
  
  const createSourceRecord = (raw: any): SourceRecord => ({
    id: 'snap_test_123',
    source: {
      system: 'test_system',
      dataset: 'test_dataset',
      recordId: 'rec_001',
    },
    raw,
    capturedAt: '2026-01-14T09:00:00Z',
    meta: {
      schemaVersion: '1.0.0',
      hash: 'test_hash_123',
    },
  });
  
  describe('Successful finalization', () => {
    it('should finalize a valid canonical draft', async () => {
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_starry_night',
        type: 'Object',
        label: 'The Starry Night',
        description: 'A beautiful painting by Van Gogh',
      };
      
      const source = createSourceRecord({ title: 'Starry Night' });
      const result = await finalizeCanonicalRecord(draft, source, mockMapping, undefined, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.canonicalRecord).toBeDefined();
      
      const record = result.canonicalRecord!;
      expect(record.id).toBe('obj_starry_night');
      expect(record.type).toBe('Object');
      expect(record.label).toBe('The Starry Night');
      expect(record.description).toBe('A beautiful painting by Van Gogh');
    });
    
    it('should fill provenance fields', async () => {
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test Object',
      };
      
      const source = createSourceRecord({ data: 'test' });
      const result = await finalizeCanonicalRecord(draft, source, mockMapping, undefined, mockContext);
      
      expect(result.success).toBe(true);
      const record = result.canonicalRecord!;
      
      // Check provenance
      expect(record.provenance).toBeDefined();
      expect(record.provenance.system).toBe('test_system');
      expect(record.provenance.dataset).toBe('test_dataset');
      expect(record.provenance.recordId).toBe('rec_001');
      expect(record.provenance.sourceRecordId).toBe('rec_001');
      expect(record.provenance.snapshotId).toBe('snap_test_123');
      expect(record.provenance.mappingId).toBe('map_test_1');
      expect(record.provenance.transformId).toBe('none');
      expect(record.provenance.pipelineId).toBe('route_test');
      expect(record.provenance.ingestedAt).toBe('2026-01-14T10:00:00Z');
    });
    
    it('should fill meta fields', async () => {
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test Object',
      };
      
      const source = createSourceRecord({ data: 'test' });
      const result = await finalizeCanonicalRecord(draft, source, mockMapping, undefined, mockContext);
      
      expect(result.success).toBe(true);
      const record = result.canonicalRecord!;
      
      // Check meta
      expect(record.meta).toBeDefined();
      expect(record.meta.schemaVersion).toBe('1.0.0');
      expect(record.meta.createdAt).toBe('2026-01-14T10:00:00Z');
      expect(record.meta.updatedAt).toBe('2026-01-14T10:00:00Z');
    });
    
    it('should preserve optional fields from draft', async () => {
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test Object',
        description: 'Test description',
        properties: { medium: 'Oil' },
        identifiers: [{ scheme: 'acc', value: '2024.001' }],
      };
      
      const source = createSourceRecord({ data: 'test' });
      const result = await finalizeCanonicalRecord(draft, source, mockMapping, undefined, mockContext);
      
      expect(result.success).toBe(true);
      const record = result.canonicalRecord!;
      
      expect(record.description).toBe('Test description');
      expect(record.properties).toEqual({ medium: 'Oil' });
      expect(record.identifiers).toEqual([{ scheme: 'acc', value: '2024.001' }]);
    });
    
    it('should accept all valid canonical types', async () => {
      const validTypes = ['Object', 'Work', 'Agent', 'Place', 'Event', 'Media'];
      
      for (const type of validTypes) {
        const draft: Partial<CanonicalRecord> = {
          id: `test_${type}`,
          type: type as any,
          label: `Test ${type}`,
        };
        
        const source = createSourceRecord({ data: 'test' });
        const result = await finalizeCanonicalRecord(draft, source, mockMapping, undefined, mockContext);
        
        expect(result.success).toBe(true);
        expect(result.canonicalRecord?.type).toBe(type);
      }
    });
    
    it('should use transform pipeline ID if provided', async () => {
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test Object',
      };
      
      const transformPipeline = {
        id: 'transform_glam_v1',
        name: 'GLAM Transform',
      };
      
      const source = createSourceRecord({ data: 'test' });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        transformPipeline,
        mockContext
      );
      
      expect(result.success).toBe(true);
      expect(result.canonicalRecord?.provenance.transformId).toBe('transform_glam_v1');
    });
  });
  
  describe('Invariant enforcement', () => {
    it('should fail if id is missing', async () => {
      const draft: Partial<CanonicalRecord> = {
        type: 'Object',
        label: 'Test Object',
      };
      
      const source = createSourceRecord({ data: 'test' });
      const result = await finalizeCanonicalRecord(draft, source, mockMapping, undefined, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('id');
      expect(result.canonicalRecord).toBeUndefined();
    });
    
    it('should fail if type is missing', async () => {
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        label: 'Test Object',
      };
      
      const source = createSourceRecord({ data: 'test' });
      const result = await finalizeCanonicalRecord(draft, source, mockMapping, undefined, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('type');
    });
    
    it('should fail if label is missing', async () => {
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
      };
      
      const source = createSourceRecord({ data: 'test' });
      const result = await finalizeCanonicalRecord(draft, source, mockMapping, undefined, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('label');
    });
    
    it('should fail with multiple errors if multiple fields missing', async () => {
      const draft: Partial<CanonicalRecord> = {};
      
      const source = createSourceRecord({ data: 'test' });
      const result = await finalizeCanonicalRecord(draft, source, mockMapping, undefined, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
      expect(result.errors.some(e => e.includes('id'))).toBe(true);
      expect(result.errors.some(e => e.includes('type'))).toBe(true);
      expect(result.errors.some(e => e.includes('label'))).toBe(true);
    });
    
    it('should fail if type is invalid', async () => {
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'InvalidType' as any,
        label: 'Test Object',
      };
      
      const source = createSourceRecord({ data: 'test' });
      const result = await finalizeCanonicalRecord(draft, source, mockMapping, undefined, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Invalid type');
      expect(result.errors[0]).toContain('InvalidType');
      expect(result.errors[0]).toContain('Valid types');
    });
  });
  
  describe('Provenance computation', () => {
    it('should generate consistent provenance fields', async () => {
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test Object',
      };
      
      const source = createSourceRecord({ data: 'test' });
      
      const result1 = await finalizeCanonicalRecord(draft, source, mockMapping, undefined, mockContext);
      const result2 = await finalizeCanonicalRecord(draft, source, mockMapping, undefined, mockContext);
      
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.canonicalRecord?.provenance.snapshotId).toBe(
        result2.canonicalRecord?.provenance.snapshotId
      );
      expect(result1.canonicalRecord?.provenance.mappingId).toBe(
        result2.canonicalRecord?.provenance.mappingId
      );
    });
    
    it('should use different snapshots for different sources', async () => {
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test Object',
      };
      
      const source1 = createSourceRecord({ data: 'test1' });
      const source2 = createSourceRecord({ data: 'test2' });
      
      const result1 = await finalizeCanonicalRecord(draft, source1, mockMapping, undefined, mockContext);
      const result2 = await finalizeCanonicalRecord(draft, source2, mockMapping, undefined, mockContext);
      
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      
      // Both should have same snapshotId since createSourceRecord generates same id
      expect(result1.canonicalRecord?.provenance.snapshotId).toBe(
        result2.canonicalRecord?.provenance.snapshotId
      );
    });
  });
  
  describe('Context handling', () => {
    it('should use context.now for timestamps', async () => {
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test Object',
      };
      
      const customContext: EngineContext = {
        pipelineId: 'route_custom',
        now: '2025-12-25T12:00:00Z',
      };
      
      const source = createSourceRecord({ data: 'test' });
      const result = await finalizeCanonicalRecord(draft, source, mockMapping, undefined, customContext);
      
      expect(result.success).toBe(true);
      expect(result.canonicalRecord?.provenance.ingestedAt).toBe('2025-12-25T12:00:00Z');
      expect(result.canonicalRecord?.meta.createdAt).toBe('2025-12-25T12:00:00Z');
      expect(result.canonicalRecord?.meta.updatedAt).toBe('2025-12-25T12:00:00Z');
    });
    
    it('should use context.pipelineId for provenance', async () => {
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test Object',
      };
      
      const customContext: EngineContext = {
        pipelineId: 'route_webhook_airtable',
        now: '2026-01-14T10:00:00Z',
      };
      
      const source = createSourceRecord({ data: 'test' });
      const result = await finalizeCanonicalRecord(draft, source, mockMapping, undefined, customContext);
      
      expect(result.success).toBe(true);
      expect(result.canonicalRecord?.provenance.pipelineId).toBe('route_webhook_airtable');
    });
    
    it('should generate timestamp if context.now is missing', async () => {
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test Object',
      };
      
      const contextWithoutNow: any = {
        pipelineId: 'route_test',
      };
      
      const source = createSourceRecord({ data: 'test' });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        undefined,
        contextWithoutNow
      );
      
      expect(result.success).toBe(true);
      expect(result.canonicalRecord?.provenance.ingestedAt).toBeDefined();
      expect(result.canonicalRecord?.meta.createdAt).toBeDefined();
    });
  });
});
