/**
 * Madrona Mapping Engine v1 — Compilation Tests
 * 
 * Tests for mapping compilation, validation, and optimization.
 */

import { describe, test, expect } from 'vitest';
import { compileMappingDSL, validateDSLRule } from './mapping';
import type { Mapping, SourceRecord } from '../types/canonical';
import type { MappingDSLRule, TransformContext } from './types';

describe('Mapping Compilation', () => {
  const testMapping: Mapping = {
    id: 'test_mapping_v1',
    version: '1.0.0',
    source: 'test',
    target: 'canonical',
    createdAt: new Date().toISOString(),
  };
  
  const sampleSource: SourceRecord = {
    id: 'snap_123',
    source: {
      system: 'test',
      dataset: 'objects',
      recordId: 'obj_123',
    },
    raw: {
      fields: {
        Title: 'Test Artwork',
        Artist: 'Test Artist',
        Year: 2024,
        AccessionNumbers: ['2024.001', '2024.002'],
        Medium: 'Oil on canvas',
      },
    },
    capturedAt: new Date().toISOString(),
    meta: {},
  };
  
  const sampleContext: TransformContext = {
    sourceRecord: sampleSource,
    canonicalRecord: {},
    warnings: [],
    ruleStats: {
      totalRules: 0,
      executedRules: 0,
      skippedRules: 0,
      failedRules: 0,
    },
  };
  
  describe('compileMappingDSL()', () => {
    test('compiles valid rules successfully', () => {
      const rules: MappingDSLRule[] = [
        {
          id: 'set_label',
          name: 'Set label',
          type: 'SetField',
          toPath: 'label',
          from: 'fields.Title',
          enabled: true,
        },
        {
          id: 'set_description',
          name: 'Set description',
          type: 'SetField',
          toPath: 'description',
          from: 'fields.Artist',
          enabled: true,
        },
      ];
      
      const compiled = compileMappingDSL(testMapping, rules);
      
      expect(compiled.valid).toBe(true);
      expect(compiled.diagnostics).toHaveLength(0);
      expect(compiled.compiledRules).toHaveLength(2);
      expect(compiled.executionOrder).toEqual(['set_label', 'set_description']);
    });
    
    test('reports disabled rules', () => {
      const rules: MappingDSLRule[] = [
        {
          id: 'enabled_rule',
          name: 'Enabled',
          type: 'SetField',
          toPath: 'label',
          from: 'fields.Title',
          enabled: true,
        },
        {
          id: 'disabled_rule',
          name: 'Disabled',
          type: 'SetField',
          toPath: 'description',
          from: 'fields.Artist',
          enabled: false,
        },
      ];
      
      const compiled = compileMappingDSL(testMapping, rules);

      expect(compiled.valid).toBe(true);
      // Disabled rules are included in compiledRules for tracking but skipped during execution
      expect(compiled.compiledRules).toHaveLength(2);
      expect(compiled.compiledRules[1].rule.enabled).toBe(false);
      expect(compiled.diagnostics).toHaveLength(1);
      expect(compiled.diagnostics[0].severity).toBe('info');
      expect(compiled.diagnostics[0].ruleId).toBe('disabled_rule');
      expect(compiled.diagnostics[0].code).toBe('RULE_DISABLED');
    });
    
    test('reports validation errors', () => {
      const rules: MappingDSLRule[] = [
        {
          id: 'invalid_rule',
          name: 'Invalid',
          type: 'SetField',
          toPath: 'label',
          from: '', // Invalid: empty path
          enabled: true,
        },
      ];
      
      const compiled = compileMappingDSL(testMapping, rules);
      
      expect(compiled.valid).toBe(false);
      expect(compiled.diagnostics.length).toBeGreaterThan(0);
      expect(compiled.diagnostics[0].severity).toBe('error');
      expect(compiled.diagnostics[0].ruleId).toBe('invalid_rule');
    });
    
    test('provides apply() method', () => {
      const rules: MappingDSLRule[] = [
        {
          id: 'set_label',
          name: 'Set label',
          type: 'SetField',
          toPath: 'label',
          from: 'fields.Title',
          enabled: true,
        },
      ];
      
      const compiled = compileMappingDSL(testMapping, rules);
      
      expect(typeof compiled.apply).toBe('function');
    });
  });
  
  describe('Compiled mapping apply()', () => {
    test('applies SetField rules', () => {
      const rules: MappingDSLRule[] = [
        {
          id: 'set_label',
          name: 'Set label',
          type: 'SetField',
          toPath: 'label',
          from: 'fields.Title',
          enabled: true,
        },
        {
          id: 'set_nested',
          name: 'Set nested property',
          type: 'SetField',
          toPath: 'properties.medium',
          from: 'fields.Medium',
          enabled: true,
        },
      ];
      
      const compiled = compileMappingDSL(testMapping, rules);
      const result = compiled.apply(sampleSource, sampleContext);
      
      expect(result.label).toBe('Test Artwork');
      expect(result.properties?.medium).toBe('Oil on canvas');
    });
    
    test('applies fallback values', () => {
      const rules: MappingDSLRule[] = [
        {
          id: 'set_with_fallback',
          name: 'Set with fallback',
          type: 'SetField',
          toPath: 'label',
          from: 'fields.Missing',
          coalesce: ['fields.AlsoMissing', 'fields.Title'],
          default: 'Untitled',
          enabled: true,
        },
      ];
      
      const compiled = compileMappingDSL(testMapping, rules);
      const result = compiled.apply(sampleSource, sampleContext);
      
      expect(result.label).toBe('Test Artwork');
    });
    
    test('applies default values', () => {
      const rules: MappingDSLRule[] = [
        {
          id: 'set_with_default',
          name: 'Set with default',
          type: 'SetField',
          toPath: 'label',
          from: 'fields.CompletelyMissing',
          default: 'Default Value',
          enabled: true,
        },
      ];
      
      const compiled = compileMappingDSL(testMapping, rules);
      const result = compiled.apply(sampleSource, sampleContext);
      
      expect(result.label).toBe('Default Value');
    });
    
    test('applies MapArray rules', () => {
      const rules: MappingDSLRule[] = [
        {
          id: 'map_identifiers',
          name: 'Map identifiers',
          type: 'MapArray',
          toPath: 'identifiers',
          fromMany: 'fields.AccessionNumbers',
          itemTemplate: {
            type: 'accession',
            value: '{{item}}',
            system: 'test',
          },
          enabled: true,
        },
      ];
      
      const compiled = compileMappingDSL(testMapping, rules);
      const result = compiled.apply(sampleSource, sampleContext);
      
      expect(result.identifiers).toHaveLength(2);
      expect(result.identifiers?.[0]).toEqual({
        type: 'accession',
        value: '2024.001',
        system: 'test',
      });
    });
    
    test('applies EmitRelationship rules', () => {
      const sourceWithRelation: SourceRecord = {
        ...sampleSource,
        raw: {
          ...sampleSource.raw,
          fields: {
            ...sampleSource.raw.fields,
            ArtistID: 'artist_123',
            ArtistRole: 'painter',
          },
        },
      };
      
      const rules: MappingDSLRule[] = [
        {
          id: 'emit_creator',
          name: 'Emit creator',
          type: 'EmitRelationship',
          relationshipType: 'created_by',
          targetFrom: 'fields.ArtistID',
          roleFrom: 'fields.ArtistRole',
          enabled: true,
        },
      ];
      
      const compiled = compileMappingDSL(testMapping, rules);
      const result = compiled.apply(sourceWithRelation, sampleContext);
      
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships?.[0]).toEqual({
        type: 'created_by',
        target: 'artist_123',
        role: 'painter',
      });
    });
    
    test('applies EmitWarning rules', () => {
      const sourceWithMissing: SourceRecord = {
        ...sampleSource,
        raw: {
          fields: {},
        },
      };
      
      const rules: MappingDSLRule[] = [
        {
          id: 'warn_missing',
          name: 'Warn missing',
          type: 'EmitWarning',
          whenMissing: ['fields.Title'],
          message: 'Title is missing',
          severity: 'error',
          enabled: true,
        },
      ];
      
      const context: TransformContext = {
        ...sampleContext,
        warnings: [],
      };
      
      const compiled = compileMappingDSL(testMapping, rules);
      compiled.apply(sourceWithMissing, context);
      
      expect(context.warnings).toContain('Title is missing');
    });
    
    test('applies SetExtension rules', () => {
      const rules: MappingDSLRule[] = [
        {
          id: 'set_extension',
          name: 'Set extension',
          type: 'SetExtension',
          namespace: 'org.test',
          extensionType: 'metadata',
          dataFrom: 'fields.Medium',
          enabled: true,
        },
      ];
      
      const compiled = compileMappingDSL(testMapping, rules);
      const result = compiled.apply(sampleSource, sampleContext);
      
      expect(result.extensions).toHaveLength(1);
      expect(result.extensions?.[0]).toEqual({
        namespace: 'org.test',
        type: 'metadata',
        data: 'Oil on canvas',
      });
    });
    
    test('handles rule failures gracefully', () => {
      const rules: MappingDSLRule[] = [
        {
          id: 'problematic_rule',
          name: 'Problematic',
          type: 'SetField',
          toPath: 'label',
          from: 'fields.Title',
          enabled: true,
        },
      ];
      
      const compiled = compileMappingDSL(testMapping, rules);
      
      // Apply with malformed source
      const context: TransformContext = {
        ...sampleContext,
        warnings: [],
      };
      
      const malformedSource: SourceRecord = {
        ...sampleSource,
        raw: null as any,
      };
      
      // Should not throw
      expect(() => compiled.apply(malformedSource, context)).not.toThrow();
    });
  });
  
  describe('Rule validation', () => {
    test('validates SetField rules', () => {
      const validRule: MappingDSLRule = {
        id: 'valid',
        name: 'Valid rule',
        type: 'SetField',
        toPath: 'label',
        from: 'fields.Title',
        enabled: true,
      };
      
      expect(validateDSLRule(validRule)).toHaveLength(0);
    });
    
    test('detects missing required fields', () => {
      const invalidRule: any = {
        id: 'invalid',
        name: 'Invalid rule',
        type: 'SetField',
        toPath: 'label',
        // Missing 'from'
      };
      
      const errors = validateDSLRule(invalidRule);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('from is required'))).toBe(true);
    });
  });
});
