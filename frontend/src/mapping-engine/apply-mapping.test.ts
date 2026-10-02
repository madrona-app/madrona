/**
 * Madrona Mapping Engine v1 — applyMappingToCanonical Tests
 * 
 * Test suite for core runtime mapping application.
 */

import { describe, it, expect } from 'vitest';
import { applyMappingToCanonical } from './engine';
import { compileMappingDSL } from './mapping';
import type { SourceRecord, Mapping } from '../types/canonical';
import type { EngineContext, SetFieldRule, MapArrayRule } from './types';

describe('applyMappingToCanonical', () => {
  const mockContext: EngineContext = {
    pipelineId: 'route_test',
    now: '2026-01-14T10:00:00Z',
  };
  
  const mockMapping: Mapping = {
    id: 'map_test_1',
    version: '1',
    source: 'test_system',
    target: 'canonical',
    createdAt: '2026-01-01T00:00:00Z',
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
  
  describe('SetField rules', () => {
    it('should apply basic SetField rule', () => {
      const rules: SetFieldRule[] = [
        {
          id: 'set_label',
          name: 'Set label',
          type: 'SetField',
          toPath: 'label',
          from: 'title',
        },
      ];
      
      const compiled = compileMappingDSL(mockMapping, rules);
      const source = createSourceRecord({ title: 'The Starry Night' });
      
      const result = applyMappingToCanonical(source, compiled, mockContext);
      
      expect(result.canonicalDraft.label).toBe('The Starry Night');
      expect(result.reportDraft.ruleExecutions).toHaveLength(1);
      expect(result.reportDraft.ruleExecutions[0].status).toBe('applied');
      expect(result.reportDraft.totalOutputs).toBe(1);
    });
    
    it('should skip rule when source value is undefined', () => {
      const rules: SetFieldRule[] = [
        {
          id: 'set_description',
          name: 'Set description',
          type: 'SetField',
          toPath: 'description',
          from: 'missing_field',
        },
      ];
      
      const compiled = compileMappingDSL(mockMapping, rules);
      const source = createSourceRecord({ title: 'Test' });
      
      const result = applyMappingToCanonical(source, compiled, mockContext);
      
      expect(result.canonicalDraft.description).toBeUndefined();
      expect(result.reportDraft.ruleExecutions[0].status).toBe('skipped');
      expect(result.reportDraft.ruleExecutions[0].reason).toContain('undefined');
    });
    
    it('should use default value when source is undefined', () => {
      const rules: SetFieldRule[] = [
        {
          id: 'set_label',
          name: 'Set label with default',
          type: 'SetField',
          toPath: 'label',
          from: 'missing_field',
          default: 'Untitled',
        },
      ];
      
      const compiled = compileMappingDSL(mockMapping, rules);
      const source = createSourceRecord({ other: 'data' });
      
      const result = applyMappingToCanonical(source, compiled, mockContext);
      
      expect(result.canonicalDraft.label).toBe('Untitled');
      expect(result.reportDraft.ruleExecutions[0].status).toBe('applied');
    });
    
    it('should use fallback when primary source is undefined', () => {
      const rules: SetFieldRule[] = [
        {
          id: 'set_label',
          name: 'Set label with fallback',
          type: 'SetField',
          toPath: 'label',
          from: 'title',
          coalesce: ['object_name', 'display_name'],
        },
      ];
      
      const compiled = compileMappingDSL(mockMapping, rules);
      const source = createSourceRecord({ 
        object_name: 'Artwork Name',
        display_name: 'Display'
      });
      
      const result = applyMappingToCanonical(source, compiled, mockContext);
      
      expect(result.canonicalDraft.label).toBe('Artwork Name');
      expect(result.reportDraft.ruleExecutions[0].status).toBe('applied');
    });
    
    it('should set nested fields', () => {
      const rules: SetFieldRule[] = [
        {
          id: 'set_medium',
          name: 'Set medium property',
          type: 'SetField',
          toPath: 'properties.medium',
          from: 'medium',
        },
      ];
      
      const compiled = compileMappingDSL(mockMapping, rules);
      const source = createSourceRecord({ medium: 'Oil on canvas' });
      
      const result = applyMappingToCanonical(source, compiled, mockContext);
      
      expect(result.canonicalDraft.properties).toEqual({ medium: 'Oil on canvas' });
      expect(result.reportDraft.totalOutputs).toBe(1);
    });
    
    it('should skip disabled rules', () => {
      const rules: SetFieldRule[] = [
        {
          id: 'set_label',
          name: 'Set label',
          type: 'SetField',
          toPath: 'label',
          from: 'title',
          enabled: false,
        },
      ];
      
      const compiled = compileMappingDSL(mockMapping, rules);
      const source = createSourceRecord({ title: 'Test' });
      
      const result = applyMappingToCanonical(source, compiled, mockContext);
      
      expect(result.canonicalDraft.label).toBeUndefined();
      expect(result.reportDraft.ruleExecutions[0].status).toBe('skipped');
      expect(result.reportDraft.ruleExecutions[0].reason).toBe('Rule disabled');
    });
  });
  
  describe('MapArray rules', () => {
    it('should map array fields', () => {
      const rules: MapArrayRule[] = [
        {
          id: 'map_tags',
          name: 'Map tags array',
          type: 'MapArray',
          toPath: 'identifiers',
          fromMany: 'accession_numbers',
        },
      ];
      
      const compiled = compileMappingDSL(mockMapping, rules);
      const source = createSourceRecord({ 
        accession_numbers: ['2024.001', '2024.002']
      });
      
      const result = applyMappingToCanonical(source, compiled, mockContext);
      
      expect(result.canonicalDraft.identifiers).toEqual(['2024.001', '2024.002']);
      expect(result.reportDraft.ruleExecutions[0].status).toBe('applied');
      expect(result.reportDraft.ruleExecutions[0].outputCount).toBe(2);
      expect(result.reportDraft.totalOutputs).toBe(2);
    });
    
    it('should skip when array is empty', () => {
      const rules: MapArrayRule[] = [
        {
          id: 'map_tags',
          name: 'Map tags array',
          type: 'MapArray',
          toPath: 'identifiers',
          fromMany: 'accession_numbers',
        },
      ];
      
      const compiled = compileMappingDSL(mockMapping, rules);
      const source = createSourceRecord({ accession_numbers: [] });
      
      const result = applyMappingToCanonical(source, compiled, mockContext);
      
      expect(result.canonicalDraft.identifiers).toBeUndefined();
      expect(result.reportDraft.ruleExecutions[0].status).toBe('skipped');
      expect(result.reportDraft.ruleExecutions[0].reason).toContain('empty');
    });
  });
  
  describe('Multiple rules', () => {
    it('should apply multiple rules in order', () => {
      const rules: (SetFieldRule | MapArrayRule)[] = [
        {
          id: 'set_label',
          name: 'Set label',
          type: 'SetField',
          toPath: 'label',
          from: 'title',
        },
        {
          id: 'set_description',
          name: 'Set description',
          type: 'SetField',
          toPath: 'description',
          from: 'desc',
        },
        {
          id: 'set_medium',
          name: 'Set medium',
          type: 'SetField',
          toPath: 'properties.medium',
          from: 'medium',
        },
      ];
      
      const compiled = compileMappingDSL(mockMapping, rules);
      const source = createSourceRecord({ 
        title: 'Starry Night',
        desc: 'A beautiful painting',
        medium: 'Oil on canvas'
      });
      
      const result = applyMappingToCanonical(source, compiled, mockContext);
      
      expect(result.canonicalDraft.label).toBe('Starry Night');
      expect(result.canonicalDraft.description).toBe('A beautiful painting');
      expect(result.canonicalDraft.properties).toEqual({ medium: 'Oil on canvas' });
      expect(result.reportDraft.ruleExecutions).toHaveLength(3);
      expect(result.reportDraft.totalOutputs).toBe(3);
    });
    
    it('should track applied, skipped, and failed rules', () => {
      const rules: SetFieldRule[] = [
        {
          id: 'rule1',
          name: 'Applied rule',
          type: 'SetField',
          toPath: 'label',
          from: 'title',
        },
        {
          id: 'rule2',
          name: 'Skipped rule',
          type: 'SetField',
          toPath: 'description',
          from: 'missing',
        },
        {
          id: 'rule3',
          name: 'Disabled rule',
          type: 'SetField',
          toPath: 'other',
          from: 'other',
          enabled: false,
        },
      ];
      
      const compiled = compileMappingDSL(mockMapping, rules);
      const source = createSourceRecord({ title: 'Test' });
      
      const result = applyMappingToCanonical(source, compiled, mockContext);
      
      const statuses = result.reportDraft.ruleExecutions.map(r => r.status);
      expect(statuses).toEqual(['applied', 'skipped', 'skipped']);
    });
  });
  
  describe('Validation', () => {
    it('should create skeleton with type default', () => {
      const rules: SetFieldRule[] = [];
      
      const compiled = compileMappingDSL(mockMapping, rules);
      const source = createSourceRecord({});
      
      const result = applyMappingToCanonical(source, compiled, mockContext);
      
      expect(result.canonicalDraft.type).toBe('Object');
      expect(result.canonicalDraft.id).toBeUndefined();
      expect(result.canonicalDraft.label).toBeUndefined();
    });
    
    it('should warn about missing required fields', () => {
      const rules: SetFieldRule[] = [
        {
          id: 'set_description',
          name: 'Set description',
          type: 'SetField',
          toPath: 'description',
          from: 'desc',
        },
      ];
      
      const compiled = compileMappingDSL(mockMapping, rules);
      const source = createSourceRecord({ desc: 'Test' });
      
      const result = applyMappingToCanonical(source, compiled, mockContext);
      
      const warnings = result.reportDraft.totalWarnings;
      expect(warnings.some(w => w.includes('id'))).toBe(true);
      expect(warnings.some(w => w.includes('label'))).toBe(true);
    });
    
    it('should not warn when required fields are present', () => {
      const rules: SetFieldRule[] = [
        {
          id: 'set_id',
          name: 'Set ID',
          type: 'SetField',
          toPath: 'id',
          from: 'object_id',
        },
        {
          id: 'set_label',
          name: 'Set label',
          type: 'SetField',
          toPath: 'label',
          from: 'title',
        },
      ];
      
      const compiled = compileMappingDSL(mockMapping, rules);
      const source = createSourceRecord({ 
        object_id: 'obj_123',
        title: 'Artwork'
      });
      
      const result = applyMappingToCanonical(source, compiled, mockContext);
      
      const validationWarnings = result.reportDraft.totalWarnings.filter(w => 
        w.includes('VALIDATION')
      );
      expect(validationWarnings).toHaveLength(0);
    });
  });
  
  describe('Error handling', () => {
    it('should catch and report rule execution errors', () => {
      // Create a rule that will cause an error by trying to write to reserved key
      const rules: SetFieldRule[] = [
        {
          id: 'bad_rule',
          name: 'Bad rule',
          type: 'SetField',
          toPath: 'provenance', // Reserved key
          from: 'data',
        },
      ];
      
      const compiled = compileMappingDSL(mockMapping, rules);
      const source = createSourceRecord({ data: { test: 'value' } });
      
      const result = applyMappingToCanonical(source, compiled, mockContext);
      
      expect(result.reportDraft.ruleExecutions[0].status).toBe('failed');
      expect(result.reportDraft.ruleExecutions[0].reason).toBeDefined();
    });
  });
});
