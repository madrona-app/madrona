/**
 * Madrona Mapping Engine v1 — Comprehensive Fixture Tests
 * 
 * Tests the complete mapping engine workflow using realistic fixtures.
 * Covers ingestion, transformation, projection, and error handling.
 */

import { describe, test, expect } from 'vitest';
import { ingest, project } from './engine';
import { compileMappingDSL } from './mapping';
import type { 
  SourceRecord, 
  Mapping, 
  CanonicalRecord,
  TransformPipeline,
} from '../types/canonical';
import type { 
  IngestRequest,
  SetFieldRule,
  MapArrayRule,
  EngineContext,
  ProjectRequest,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a test source record from raw data.
 */
function createSourceRecord(raw: any, system = 'test-system'): SourceRecord {
  return {
    id: `source_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    source: {
      system,
      dataset: 'test-dataset',
      recordId: `rec_${Math.random().toString(36).substr(2, 9)}`,
    },
    raw,
    capturedAt: new Date().toISOString(),
    meta: {
      schemaVersion: '1.0.0',
      hash: `hash_${Math.random().toString(36).substr(2, 16)}`,
    },
  };
}

/**
 * Create a unique test mapping configuration.
 * Each test gets a unique ID to avoid cache collisions.
 */
function createTestMapping(suffix: string = ''): Mapping {
  return {
    id: `mapping_test_${suffix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    version: '1.0.0',
    source: 'test-system',
    target: 'canonical',
    createdAt: '2026-01-14T00:00:00Z',
  };
}

/**
 * Test engine context.
 */
const TEST_CONTEXT: EngineContext = {
  pipelineId: 'route_test_ingestion',
  now: '2026-01-14T10:00:00Z',
};

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: Basic Ingestion
// ═══════════════════════════════════════════════════════════════════════════

describe('Mapping Engine — Basic Ingestion', () => {
  test('transforms JSON SourceRecord to CanonicalRecord (Object type)', async () => {
    // Source data: simple artwork record
    const sourceData = {
      object_id: 'OBJ_12345',
      title: 'The Starry Night',
      description: 'Oil painting by Vincent van Gogh depicting a swirling night sky',
      artist: 'Vincent van Gogh',
      date_created: '1889',
      medium: 'Oil on canvas',
      dimensions: '73.7 cm × 92.1 cm',
    };

    const sourceRecord = createSourceRecord(sourceData);

    // Debug: verify sourceRecord structure
    console.log('Raw data:', JSON.stringify(sourceRecord.raw, null, 2));

    // Mapping rules: extract fields from source
    const rules: SetFieldRule[] = [
      {
        id: 'set_id',
        name: 'Set canonical ID',
        type: 'SetField',
        from: 'object_id',
        toPath: 'id',
      },
      {
        id: 'set_type',
        name: 'Set type',
        type: 'SetField',
        from: 'type', // Try to read from source, will use default if missing
        toPath: 'type',
        default: 'Object', // Default to Object type
      },
      {
        id: 'set_label',
        name: 'Set label',
        type: 'SetField',
        from: 'title',
        toPath: 'label',
      },
      {
        id: 'set_description',
        name: 'Set description',
        type: 'SetField',
        from: 'description',
        toPath: 'description',
      },
    ];

    // Create unique mapping for this test
    const testMapping = createTestMapping('basic_ingestion');

    // Compile the mapping using compileMappingDSL
    const compiledMapping = compileMappingDSL(testMapping, rules);
    console.log('Compiled rules count:', compiledMapping.compiledRules.length);

    const request: IngestRequest = {
      sourceRecord,
      mapping: testMapping,
      context: TEST_CONTEXT,
    };

    // Manually set the rules on the mapping for internal extraction
    (request.mapping as any).rules = rules;
    
    const result = await ingest(request);
    
    // Verify canonical record structure
    expect(result.canonicalRecord).toBeDefined();
    expect(result.canonicalRecord.id).toBe('OBJ_12345'); // Without transform, ID is used as-is
    expect(result.canonicalRecord.type).toBeDefined(); // Should have a type
    expect(result.canonicalRecord.label).toBe('The Starry Night');
    expect(result.canonicalRecord.description).toContain('Vincent van Gogh');
    
    // Verify provenance
    expect(result.canonicalRecord.provenance).toBeDefined();
    expect(result.canonicalRecord.provenance.system).toBe('test-system');
    expect(result.canonicalRecord.provenance.snapshotId).toBe(sourceRecord.id);
    expect(result.canonicalRecord.provenance.mappingId).toBe(testMapping.id);
    
    // Verify metadata
    expect(result.canonicalRecord.meta).toBeDefined();
    expect(result.canonicalRecord.meta.schemaVersion).toBe('1.0.0');
    expect(result.canonicalRecord.meta.createdAt).toBe('2026-01-14T10:00:00Z');
    
    // Verify mapping report
    expect(result.mappingReport).toBeDefined();
    expect(result.mappingReport.status).toBe('success');
    expect(result.mappingReport.ruleExecution.totalRules).toBe(4); // 4 rules defined
    expect(result.mappingReport.ruleExecution.executedRules).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: Missing Fields
// ═══════════════════════════════════════════════════════════════════════════

describe('Mapping Engine — Missing Fields', () => {
  test('missing optional fields produces warnings, not failure', async () => {
    // Source with minimal required data only
    const sourceData = {
      object_id: 'OBJ_MIN',
      title: 'Minimal Object',
      // No description, properties, dates, etc.
    };

    const sourceRecord = createSourceRecord(sourceData);

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
      {
        id: 'set_description',
        name: 'Set description (optional)',
        type: 'SetField',
        from: 'description', // Missing in source
        toPath: 'description',
      },
    ];

    const mapping = { ...createTestMapping('missing_optional'), rules } as any;
    
    const request: IngestRequest = {
      sourceRecord,
      mapping,
      context: TEST_CONTEXT,
    };
    
    const result = await ingest(request);
    
    // Should succeed despite missing optional field
    expect(result.canonicalRecord).toBeDefined();
    expect(result.canonicalRecord.id).toBe('OBJ_MIN');
    expect(result.canonicalRecord.label).toBe('Minimal Object');
    expect(result.canonicalRecord.description).toBeUndefined();
    
    // Report should show partial status since some rules are skipped
    expect(['success', 'partial']).toContain(result.mappingReport.status);
    expect(result.mappingReport.ruleExecution.skippedRules).toBeGreaterThan(0);
  });
  
  test('missing required id/type/label fails with status=failed', async () => {
    // Source missing required field
    const sourceData = {
      // No object_id!
      title: 'Object Without ID',
      description: 'This should fail',
    };

    const sourceRecord = createSourceRecord(sourceData);

    const rules: SetFieldRule[] = [
      {
        id: 'set_id',
        name: 'Set ID',
        type: 'SetField',
        from: 'object_id', // Missing!
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

    const mapping = { ...createTestMapping('missing_required'), rules } as any;
    
    const request: IngestRequest = {
      sourceRecord,
      mapping,
      context: TEST_CONTEXT,
    };
    
    // Should throw CanonicalInvariantError
    await expect(ingest(request)).rejects.toThrow();
    
    try {
      await ingest(request);
    } catch (error: any) {
      expect(error.name).toBe('CanonicalInvariantError');
      expect(error.message).toContain('id');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: Transform Pipeline
// ═══════════════════════════════════════════════════════════════════════════

describe('Mapping Engine — Transform Pipeline', () => {
  test('transform pipeline modifies output and logs warnings', async () => {
    const sourceData = {
      object_id: 'OBJ_TRANS',
      title: '  Untrimmed Title  ',
      description: 'Description with    extra    spaces',
    };

    const sourceRecord = createSourceRecord(sourceData);

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
      {
        id: 'set_description',
        name: 'Set description',
        type: 'SetField',
        from: 'description',
        toPath: 'description',
      },
    ];

    const mapping = { ...createTestMapping('transform_pipeline'), rules } as any;
    
    // Transform pipeline to normalize whitespace
    const transformPipeline: TransformPipeline = {
      id: 'transform_normalize_v1',
      version: '1.0.0',
      steps: [
        {
          id: 'normalize-whitespace',
          type: 'normalize-whitespace',
          name: 'Normalize whitespace',
          params: {},
        },
      ],
    };
    
    const request: IngestRequest = {
      sourceRecord,
      mapping,
      transformPipeline,
      context: TEST_CONTEXT,
    };
    
    const result = await ingest(request);

    // Verify whitespace normalization was applied
    expect(result.canonicalRecord.label).toBe('Untrimmed Title');
    expect(result.canonicalRecord.description).toBe('Description with extra spaces');

    // Verify transform was applied (id is recorded even if transform is stubbed)
    expect(result.canonicalRecord.provenance.transformId).toBe('transform_normalize_v1');
    expect(result.mappingReport.references.transformId).toBe('transform_normalize_v1');

    // Report should show success or partial
    expect(result.mappingReport.status).toMatch(/success|partial/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: Projection & Deterministic Hashing
// ═══════════════════════════════════════════════════════════════════════════

describe('Mapping Engine — Projection', () => {
  test('projection produces deterministic hash for same inputs', async () => {
    const projectionMapping = createTestMapping('projection_deterministic');

    // Create canonical record
    const canonicalRecord: CanonicalRecord = {
      id: 'obj_hash_test',
      type: 'Object',
      label: 'Test Object for Hashing',
      provenance: {
        system: 'test-system',
        dataset: 'test-dataset',
        recordId: 'rec_123',
        sourceRecordId: 'rec_123',
        snapshotId: 'snap_fixed_id',
        mappingId: projectionMapping.id,
        transformId: 'none',
        pipelineId: 'route_test',
        ingestedAt: '2026-01-14T10:00:00Z',
      },
      meta: {
        schemaVersion: '1.0.0',
        createdAt: '2026-01-14T10:00:00Z',
        updatedAt: '2026-01-14T10:00:00Z',
      },
    };

    // Simple projection rules: canonical → destination
    const projectionRules: SetFieldRule[] = [
      {
        id: 'proj_title',
        name: 'Project title',
        type: 'SetField',
        from: 'label',
        toPath: 'title',
      },
    ];

    // Attach rules to mapping
    (projectionMapping as any).rules = projectionRules;
    
    const request1: ProjectRequest = {
      canonicalRecord,
      mapping: projectionMapping,
      snapshotId: 'snap_fixed_id',
      mode: 'destination',
    };
    
    const request2: ProjectRequest = {
      canonicalRecord,
      mapping: projectionMapping,
      snapshotId: 'snap_fixed_id',
      mode: 'destination',
    };
    
    const result1 = await project(request1);
    const result2 = await project(request2);
    
    // Same inputs should produce same hash
    expect(result1.meta.hash).toBe(result2.meta.hash);
    expect(result1.meta.hash).toBeDefined();
    expect(result1.meta.hash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    
    // Payloads should be identical
    expect(result1.projectionPayload).toEqual(result2.projectionPayload);
  });
  
  test('different inputs produce different hashes', async () => {
    const projectionMapping = createTestMapping('projection_different_hash');

    const canonicalRecord1: CanonicalRecord = {
      id: 'obj_1',
      type: 'Object',
      label: 'Object One',
      provenance: {
        system: 'test-system',
        dataset: 'test-dataset',
        recordId: 'rec_1',
        sourceRecordId: 'rec_1',
        snapshotId: 'snap_1',
        mappingId: projectionMapping.id,
        transformId: 'none',
        pipelineId: 'route_test',
        ingestedAt: '2026-01-14T10:00:00Z',
      },
      meta: {
        schemaVersion: '1.0.0',
        createdAt: '2026-01-14T10:00:00Z',
        updatedAt: '2026-01-14T10:00:00Z',
      },
    };

    const canonicalRecord2: CanonicalRecord = {
      ...canonicalRecord1,
      id: 'obj_2',
      label: 'Object Two', // Different content
    };

    const projectionRules: SetFieldRule[] = [
      {
        id: 'proj_title',
        name: 'Project title',
        type: 'SetField',
        from: 'label',
        toPath: 'title',
      },
    ];

    // Attach rules to mapping
    (projectionMapping as any).rules = projectionRules;
    
    const request1: ProjectRequest = {
      canonicalRecord: canonicalRecord1,
      mapping: projectionMapping,
      snapshotId: 'snap_1',
      mode: 'destination',
    };
    
    const request2: ProjectRequest = {
      canonicalRecord: canonicalRecord2,
      mapping: projectionMapping,
      snapshotId: 'snap_1',
      mode: 'destination',
    };
    
    const result1 = await project(request1);
    const result2 = await project(request2);
    
    // Different content should produce different hashes
    expect(result1.meta.hash).not.toBe(result2.meta.hash);
    expect(result1.projectionPayload).not.toEqual(result2.projectionPayload);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: Array Mapping
// ═══════════════════════════════════════════════════════════════════════════

describe('Mapping Engine — Array Mapping', () => {
  test('maps array fields with MapArray rule', async () => {
    const sourceData = {
      object_id: 'OBJ_ARRAY',
      title: 'Object with Identifiers',
      accession_numbers: ['2024.001', '2024.002', '2024.003'],
    };

    const sourceRecord = createSourceRecord(sourceData);

    const rules: (SetFieldRule | MapArrayRule)[] = [
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
      {
        id: 'map_identifiers',
        name: 'Map identifiers',
        type: 'MapArray',
        fromMany: 'accession_numbers', // Use fromMany for array sources
        toPath: 'identifiers',
        itemTemplate: {
          type: 'accession',
          value: '{{item}}',
          system: 'test-system',
        },
      },
    ];

    const mapping = { ...createTestMapping('array_mapping'), rules } as any;
    
    const request: IngestRequest = {
      sourceRecord,
      mapping,
      context: TEST_CONTEXT,
    };
    
    const result = await ingest(request);
    
    // Verify identifiers were mapped
    expect(result.canonicalRecord.identifiers).toBeDefined();
    expect(result.canonicalRecord.identifiers).toHaveLength(3);
    expect(result.canonicalRecord.identifiers?.[0]).toEqual({
      type: 'accession',
      value: '2024.001',
      system: 'test-system',
    });
    
    // Report should show array mapping stats
    expect(result.mappingReport.ruleExecution.fieldsMapped).toBeGreaterThan(0);
  });
});
