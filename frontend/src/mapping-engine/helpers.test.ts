/**
 * Madrona Mapping Engine v1 — Developer Helpers Tests
 * 
 * Test suite for mapping explanation, dry-run, and validation utilities.
 */

import { describe, test, expect } from 'vitest';
import { explainMapping, dryRunMapping, validateMapping } from './helpers';
import type { Mapping, SourceRecord } from '../types/canonical';
import type { SetFieldRule, MapArrayRule, EmitRelationshipRule, EmitWarningRule } from './types';

const TEST_MAPPING: Mapping = {
  id: 'mapping_test_v1',
  version: '1.0.0',
  source: 'test-system',
  target: 'canonical',
  createdAt: '2026-01-14T00:00:00Z',
};

const createSourceRecord = (raw: any): SourceRecord => ({
  id: 'snap_test_123',
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
});

describe('explainMapping', () => {
  test('explains basic SetField rules', () => {
    const rules: SetFieldRule[] = [
      {
        id: 'set_label',
        name: 'Set label',
        type: 'SetField',
        from: 'title',
        toPath: 'label',
      },
      {
        id: 'set_description',
        name: 'Set description with default',
        type: 'SetField',
        from: 'desc',
        toPath: 'description',
        default: 'No description',
      },
    ];
    
    const explanation = explainMapping(TEST_MAPPING, rules);
    
    expect(explanation.mapping.id).toBe('mapping_test_v1');
    expect(explanation.summary.totalRules).toBe(2);
    expect(explanation.summary.enabledRules).toBe(2);
    expect(explanation.summary.rulesByType.SetField).toBe(2);
    
    expect(explanation.outputFields).toContain('label');
    expect(explanation.outputFields).toContain('description');
    
    expect(explanation.requiredSourceFields).toContain('title');
    expect(explanation.optionalSourceFields).toContain('desc');
    
    expect(explanation.rules[0].description).toContain('Maps title to label');
    expect(explanation.rules[1].hasDefault).toBe(true);
  });
  
  test('explains array mapping rules', () => {
    const rules: MapArrayRule[] = [
      {
        id: 'map_ids',
        name: 'Map identifiers',
        type: 'MapArray',
        fromMany: 'accession_numbers',
        toPath: 'identifiers',
        itemTemplate: { type: 'accession', value: '{{item}}' },
      },
    ];
    
    const explanation = explainMapping(TEST_MAPPING, rules);
    
    expect(explanation.summary.rulesByType.MapArray).toBe(1);
    expect(explanation.outputFields).toContain('identifiers');
    expect(explanation.requiredSourceFields).toContain('accession_numbers');
  });
  
  test('tracks relationships', () => {
    const rules: EmitRelationshipRule[] = [
      {
        id: 'emit_creator',
        name: 'Emit creator relationship',
        type: 'EmitRelationship',
        relationshipType: 'created_by',
        targetFrom: 'artist_id',
      },
    ];
    
    const explanation = explainMapping(TEST_MAPPING, rules);
    
    expect(explanation.relationships).toContain('created_by');
    expect(explanation.outputFields).toContain('relationships');
  });
  
  test('tracks warnings', () => {
    const rules: EmitWarningRule[] = [
      {
        id: 'warn_missing',
        name: 'Warn if title missing',
        type: 'EmitWarning',
        whenMissing: ['title'],
        message: 'Title is required',
        severity: 'error',
      },
    ];
    
    const explanation = explainMapping(TEST_MAPPING, rules);
    
    expect(explanation.warnings).toHaveLength(1);
    expect(explanation.warnings[0].message).toBe('Title is required');
    expect(explanation.warnings[0].severity).toBe('error');
  });
  
  test('counts enabled and disabled rules', () => {
    const rules: SetFieldRule[] = [
      {
        id: 'enabled_rule',
        name: 'Enabled',
        type: 'SetField',
        from: 'a',
        toPath: 'b',
        enabled: true,
      },
      {
        id: 'disabled_rule',
        name: 'Disabled',
        type: 'SetField',
        from: 'c',
        toPath: 'd',
        enabled: false,
      },
    ];
    
    const explanation = explainMapping(TEST_MAPPING, rules);
    
    expect(explanation.summary.enabledRules).toBe(1);
    expect(explanation.summary.disabledRules).toBe(1);
  });
});

describe('dryRunMapping', () => {
  test('successfully dry-runs a simple mapping', async () => {
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
    
    const result = await dryRunMapping(sourceRecord, TEST_MAPPING, rules);
    
    expect(result).toBeDefined();
    expect(result.report).toBeDefined();
    expect(result.report.references.mappingId).toBe('mapping_test_v1');

    expect(result.success).toBe(true);
    expect(result.preview).toBeDefined();
    expect(result.preview?.id).toBe('OBJ_123');
  });
  
  test('captures errors in dry-run', async () => {
    const sourceRecord = createSourceRecord({
      // Missing required field
      description: 'Test',
    });
    
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
        from: 'title', // Missing!
        toPath: 'label',
      },
    ];
    
    const result = await dryRunMapping(sourceRecord, TEST_MAPPING, rules);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe('CanonicalInvariantError');
    expect(result.report.status).toBe('failed');
  });
  
  test('includes custom context in dry-run', async () => {
    const sourceRecord = createSourceRecord({
      object_id: 'OBJ_456',
      title: 'Context Test',
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
    
    const result = await dryRunMapping(sourceRecord, TEST_MAPPING, rules, {
      context: {
        pipelineId: 'custom_route',
        now: '2026-01-15T12:00:00Z',
      },
    });
    
    expect(result.report).toBeDefined();
    expect(result.report.references.mappingId).toBe('mapping_test_v1');

    expect(result.success).toBe(true);
    expect(result.preview?.provenance.pipelineId).toBe('custom_route');
    expect(result.preview?.meta.createdAt).toBe('2026-01-15T12:00:00Z');
  });
});

describe('validateMapping', () => {
  test('validates a correct mapping', () => {
    const rules: SetFieldRule[] = [
      {
        id: 'set_label',
        name: 'Set label',
        type: 'SetField',
        from: 'title',
        toPath: 'label',
      },
    ];
    
    const result = validateMapping(TEST_MAPPING, rules);
    
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.summary.totalRules).toBe(1);
    expect(result.summary.validRules).toBe(1);
  });
  
  test('detects missing mapping metadata', () => {
    const invalidMapping = {
      ...TEST_MAPPING,
      id: '',
    };
    
    const rules: SetFieldRule[] = [
      {
        id: 'set_label',
        name: 'Set label',
        type: 'SetField',
        from: 'title',
        toPath: 'label',
      },
    ];
    
    const result = validateMapping(invalidMapping, rules);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_MAPPING_ID')).toBe(true);
  });
  
  test('detects missing rules', () => {
    const result = validateMapping(TEST_MAPPING, []);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'NO_RULES')).toBe(true);
  });
  
  test('detects duplicate rule IDs', () => {
    const rules: SetFieldRule[] = [
      {
        id: 'duplicate',
        name: 'Rule 1',
        type: 'SetField',
        from: 'a',
        toPath: 'b',
      },
      {
        id: 'duplicate',
        name: 'Rule 2',
        type: 'SetField',
        from: 'c',
        toPath: 'd',
      },
    ];
    
    const result = validateMapping(TEST_MAPPING, rules);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'DUPLICATE_RULE_ID')).toBe(true);
  });
  
  test('detects missing required rule fields', () => {
    const rules: any[] = [
      {
        id: 'bad_rule',
        name: 'Missing toPath',
        type: 'SetField',
        from: 'title',
        // Missing toPath!
      },
    ];
    
    const result = validateMapping(TEST_MAPPING, rules);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_TO_PATH')).toBe(true);
  });
  
  test('warns about best practice violations', () => {
    const rules: SetFieldRule[] = [
      {
        id: 'test',
        name: 'test', // Non-descriptive name
        type: 'SetField',
        from: 'title',
        toPath: 'label',
      },
    ];
    
    const result = validateMapping(TEST_MAPPING, rules);
    
    expect(result.warnings.some(w => w.code === 'NON_DESCRIPTIVE_NAME')).toBe(true);
  });
  
  test('validates all rule types', () => {
    const rules: any[] = [
      {
        id: 'array_rule',
        name: 'Array',
        type: 'MapArray',
        // Missing fromMany and toPath
      },
      {
        id: 'rel_rule',
        name: 'Relationship',
        type: 'EmitRelationship',
        // Missing relationshipType and targetFrom
      },
      {
        id: 'warn_rule',
        name: 'Warning',
        type: 'EmitWarning',
        // Missing message and condition
      },
    ];
    
    const result = validateMapping(TEST_MAPPING, rules);
    
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.summary.invalidRules).toBe(3);
  });
});
