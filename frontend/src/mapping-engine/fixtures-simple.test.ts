/**
 * Madrona Mapping Engine v1 — Simple Fixture Tests
 * 
 * Simplified tests focusing on core mapping engine functionality.
 */

import { describe, test, expect } from 'vitest';
import { applyMappingToCanonical, ingest } from './engine';
import { compileMappingDSL } from './mapping';
import type { SourceRecord, Mapping } from '../types/canonical';
import type { EngineContext, SetFieldRule, IngestRequest } from './types';

const TEST_MAPPING: Mapping = {
  id: 'map_test',
  version: '1.0.0',
  source: 'test-system',
  target: 'canonical',
  createdAt: '2026-01-14T00:00:00Z',
};

const TEST_CONTEXT: EngineContext = {
  pipelineId: 'route_test',
  now: '2026-01-14T10:00:00Z',
};

function createSourceRecord(raw: any): SourceRecord {
  return {
    id: `snap_${Date.now()}`,
    source: {
      system: 'test-system',
      dataset: 'test-dataset',
      recordId: 'rec_001',
    },
    raw,
    capturedAt: '2026-01-14T09:00:00Z',
    meta: {
      schemaVersion: '1.0.0',
      hash: 'test_hash',
    },
  };
}

describe('Mapping Engine — Fixture Tests', () => {
  test('applyMapping works correctly', () => {
    const sourceRecord = createSourceRecord({
      object_id: 'OBJ_123',
      title: 'Test Object',
      description: 'Test description',
    });
    
    const rules: SetFieldRule[] = [
      {
        id: 'set_id',
        name: 'Set ID',
        type: 'SetField',
        from: 'object_id',
        toPath: 'id',
      },
      {
        id: 'set_type',
        name: 'Set type',
        type: 'SetField',
        from: 'type',
        toPath: 'type',
        default: 'Object',
      },
      {
        id: 'set_label',
        name: 'Set label',
        type: 'SetField',
        from: 'title',
        toPath: 'label',
      },
    ];
    
    const compiled = compileMappingDSL(TEST_MAPPING, rules);
    const result = applyMappingToCanonical(sourceRecord, compiled, TEST_CONTEXT);
    
    expect(result.canonicalDraft.id).toBe('OBJ_123');
    expect(result.canonicalDraft.type).toBe('Object');
    expect(result.canonicalDraft.label).toBe('Test Object');
  });
  
  test('end-to-end ingest works', async () => {
    const sourceRecord = createSourceRecord({
      object_id: 'OBJ_456',
      title: 'Complete Object',
      description: 'Complete description',
    });
    
    const rules: SetFieldRule[] = [
      {
        id: 'set_id',
        name: 'Set ID',
        type: 'SetField',
        from: 'object_id',
        toPath: 'id',
      },
      {
        id: 'set_type',
        name: 'Set type',
        type: 'SetField',
        from: 'type',
        toPath: 'type',
        default: 'Object',
      },
      {
        id: 'set_label',
        name: 'Set label',
        type: 'SetField',
        from: 'title',
        toPath: 'label',
      },
    ];
    
    const mappingWithRules = { ...TEST_MAPPING, rules } as any;
    
    const request: IngestRequest = {
      sourceRecord,
      mapping: mappingWithRules,
      context: TEST_CONTEXT,
    };
    
    const result = await ingest(request);
    
    expect(result.canonicalRecord.id).toBe('OBJ_456');
    expect(result.canonicalRecord.type).toBe('Object');
    expect(result.canonicalRecord.label).toBe('Complete Object');
    expect(result.mappingReport.status).toBe('success');
  });
});
