import { describe, it, expect } from 'vitest';
import { finalizeCanonicalRecord } from './engine';
import { DEFAULT_SAFETY_LIMITS } from './types';
import type { CanonicalRecord, SourceRecord, Mapping } from '../types/canonical';
import type { EngineContext, SafetyLimits } from './types';

// Helper to create test source record
function createSourceRecord(raw: any): SourceRecord {
  return {
    id: `source_${Date.now()}_${Math.random()}`,
    source: {
      system: 'test-system',
      dataset: 'test-dataset',
      recordId: 'test-001',
    },
    raw,
    capturedAt: new Date().toISOString(),
    meta: {
      schemaVersion: '1.0.0',
      hash: 'test_hash',
    },
  };
}

const mockMapping: Mapping = {
  id: 'test-mapping',
  version: '1.0.0',
  source: 'test',
  target: 'canonical',
  createdAt: new Date().toISOString(),
};

const mockContext: EngineContext = {
  pipelineId: 'test-route',
  now: '2026-01-14T10:00:00Z',
};

describe('Safety Limits', () => {
  describe('Label truncation', () => {
    it('should truncate label exceeding max length', async () => {
      const longLabel = 'A'.repeat(600);
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: longLabel,
      };
      
      const source = createSourceRecord({ title: longLabel });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        undefined,
        mockContext
      );
      
      expect(result.success).toBe(true);
      expect(result.canonicalRecord?.label).toHaveLength(DEFAULT_SAFETY_LIMITS.maxLabelLength);
      expect(result.canonicalRecord?.label.endsWith('...')).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Label truncated');
    });
    
    it('should not truncate label within limit', async () => {
      const normalLabel = 'A'.repeat(100);
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: normalLabel,
      };
      
      const source = createSourceRecord({ title: normalLabel });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        undefined,
        mockContext
      );
      
      expect(result.success).toBe(true);
      expect(result.canonicalRecord?.label).toBe(normalLabel);
      expect(result.warnings).toHaveLength(0);
    });
    
    it('should respect custom max label length', async () => {
      const label = 'A'.repeat(150);
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label,
      };
      
      const customLimits: SafetyLimits = {
        maxLabelLength: 100,
      };
      
      const source = createSourceRecord({ title: label });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        undefined,
        mockContext,
        customLimits
      );
      
      expect(result.success).toBe(true);
      expect(result.canonicalRecord?.label).toHaveLength(100);
      expect(result.warnings).toHaveLength(1);
    });
  });
  
  describe('Description truncation', () => {
    it('should truncate description exceeding max length', async () => {
      const longDescription = 'B'.repeat(12000);
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test',
        description: longDescription,
      };
      
      const source = createSourceRecord({ desc: longDescription });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        undefined,
        mockContext
      );
      
      expect(result.success).toBe(true);
      expect(result.canonicalRecord?.description).toHaveLength(DEFAULT_SAFETY_LIMITS.maxDescriptionLength);
      expect(result.canonicalRecord?.description?.endsWith('...')).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Description truncated');
    });
    
    it('should not truncate description within limit', async () => {
      const normalDescription = 'B'.repeat(1000);
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test',
        description: normalDescription,
      };
      
      const source = createSourceRecord({ desc: normalDescription });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        undefined,
        mockContext
      );
      
      expect(result.success).toBe(true);
      expect(result.canonicalRecord?.description).toBe(normalDescription);
      expect(result.warnings).toHaveLength(0);
    });
  });
  
  describe('Relationships limit', () => {
    it('should truncate relationships exceeding max count', async () => {
      const relationships = Array.from({ length: 150 }, (_, i) => ({
        type: 'related_to',
        target: `obj_${i}`,
      }));
      
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test',
        relationships,
      };
      
      const source = createSourceRecord({ relationships });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        undefined,
        mockContext
      );
      
      expect(result.success).toBe(true);
      expect(result.canonicalRecord?.relationships).toHaveLength(DEFAULT_SAFETY_LIMITS.maxRelationships);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Relationships truncated');
      expect(result.warnings[0]).toContain('150');
      expect(result.warnings[0]).toContain('100');
    });
    
    it('should not truncate relationships within limit', async () => {
      const relationships = Array.from({ length: 50 }, (_, i) => ({
        type: 'related_to',
        target: `obj_${i}`,
      }));
      
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test',
        relationships,
      };
      
      const source = createSourceRecord({ relationships });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        undefined,
        mockContext
      );
      
      expect(result.success).toBe(true);
      expect(result.canonicalRecord?.relationships).toHaveLength(50);
      expect(result.warnings).toHaveLength(0);
    });
    
    it('should respect custom max relationships', async () => {
      const relationships = Array.from({ length: 75 }, (_, i) => ({
        type: 'related_to',
        target: `obj_${i}`,
      }));
      
      const customLimits: SafetyLimits = {
        maxRelationships: 50,
      };
      
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test',
        relationships,
      };
      
      const source = createSourceRecord({ relationships });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        undefined,
        mockContext,
        customLimits
      );
      
      expect(result.success).toBe(true);
      expect(result.canonicalRecord?.relationships).toHaveLength(50);
      expect(result.warnings).toHaveLength(1);
    });
  });
  
  describe('Extensions size limit', () => {
    it('should drop extensions exceeding max size', async () => {
      const largeExtensions: any[] = [
        {
          namespace: 'test:large',
          type: 'bulk-data',
          data: { payload: 'X'.repeat(150000) }, // 150KB
        },
      ];
      
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test',
        extensions: largeExtensions,
      };
      
      const source = createSourceRecord({ ext: largeExtensions });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        undefined,
        mockContext
      );
      
      expect(result.success).toBe(true);
      expect(result.canonicalRecord?.extensions).toBeUndefined();
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Extensions object');
      expect(result.warnings[0]).toContain('bytes');
      expect(result.warnings[0]).toContain('dropped');
    });
    
    it('should keep extensions within limit', async () => {
      const normalExtensions: any[] = [
        {
          namespace: 'test:normal',
          type: 'metadata',
          data: { customField: 'value', key: 'value' },
        },
      ];
      
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test',
        extensions: normalExtensions,
      };
      
      const source = createSourceRecord({ ext: normalExtensions });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        undefined,
        mockContext
      );
      
      expect(result.success).toBe(true);
      expect(result.canonicalRecord?.extensions).toEqual(normalExtensions);
      expect(result.warnings).toHaveLength(0);
    });
    
    it('should respect custom max extension size', async () => {
      const extensions: any[] = [
        {
          namespace: 'test:custom',
          type: 'data',
          data: { payload: 'Y'.repeat(2000) }, // 2KB
        },
      ];
      
      const customLimits: SafetyLimits = {
        maxExtensionSizeBytes: 1024, // 1KB
      };
      
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test',
        extensions,
      };
      
      const source = createSourceRecord({ ext: extensions });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        undefined,
        mockContext,
        customLimits
      );
      
      expect(result.success).toBe(true);
      expect(result.canonicalRecord?.extensions).toBeUndefined();
      expect(result.warnings).toHaveLength(1);
    });
  });
  
  describe('Multiple violations', () => {
    it('should handle multiple safety violations at once', async () => {
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'A'.repeat(600),
        description: 'B'.repeat(12000),
        relationships: Array.from({ length: 150 }, (_, i) => ({
          type: 'related_to',
          target: `obj_${i}`,
        })),
        extensions: [
          {
            namespace: 'test:multi',
            type: 'large',
            data: { payload: 'X'.repeat(150000) },
          },
        ],
      };
      
      const source = createSourceRecord({ data: 'test' });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        undefined,
        mockContext
      );
      
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(4);
      expect(result.warnings.some(w => w.includes('Label'))).toBe(true);
      expect(result.warnings.some(w => w.includes('Description'))).toBe(true);
      expect(result.warnings.some(w => w.includes('Relationships'))).toBe(true);
      expect(result.warnings.some(w => w.includes('Extensions'))).toBe(true);
    });
  });
  
  describe('Default limits', () => {
    it('should use default limits when none provided', async () => {
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'Test',
      };
      
      const source = createSourceRecord({ data: 'test' });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        undefined,
        mockContext
        // No safetyLimits provided
      );
      
      expect(result.success).toBe(true);
      // Should not fail, just use defaults
    });
    
    it('should allow partial limit overrides', async () => {
      const draft: Partial<CanonicalRecord> = {
        id: 'obj_test',
        type: 'Object',
        label: 'A'.repeat(600),
        relationships: Array.from({ length: 150 }, (_, i) => ({
          type: 'related_to',
          target: `obj_${i}`,
        })),
      };
      
      const partialLimits: SafetyLimits = {
        maxLabelLength: 1000, // Override just label, others use defaults
      };
      
      const source = createSourceRecord({ data: 'test' });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        undefined,
        mockContext,
        partialLimits
      );
      
      expect(result.success).toBe(true);
      expect(result.canonicalRecord?.label).toHaveLength(600); // Not truncated
      expect(result.canonicalRecord?.relationships).toHaveLength(100); // Default applied
      expect(result.warnings).toHaveLength(1); // Only relationships warning
    });
  });
  
  describe('Invariants still enforced', () => {
    it('should still fail on missing required fields despite safety limits', async () => {
      const draft: Partial<CanonicalRecord> = {
        type: 'Object',
        // Missing id and label
      };
      
      const source = createSourceRecord({ data: 'test' });
      const result = await finalizeCanonicalRecord(
        draft,
        source,
        mockMapping,
        undefined,
        mockContext
      );
      
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('id'))).toBe(true);
      expect(result.errors.some(e => e.includes('label'))).toBe(true);
    });
  });
});
