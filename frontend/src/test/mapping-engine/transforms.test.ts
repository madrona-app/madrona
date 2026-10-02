import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerTransform,
  getTransform,
  setNestedValue,
  executeRule,
  executeRules,
  runTransformPipeline,
} from '../../mapping-engine/transforms';
import type { TransformContext, MappingRule } from '../../mapping-engine/types';

describe('transforms', () => {
  describe('registerTransform and getTransform', () => {
    beforeEach(() => {
      // Register a test transform
      registerTransform('testTransform', (value) => `transformed:${value}`);
    });

    it('registers and retrieves a transform', () => {
      const transform = getTransform('testTransform');
      expect(transform).toBeDefined();
      expect(transform?.('input', {} as TransformContext)).toBe('transformed:input');
    });

    it('returns undefined for unregistered transform', () => {
      const transform = getTransform('nonexistent');
      expect(transform).toBeUndefined();
    });

    it('overwrites existing transform with same name', () => {
      registerTransform('testTransform', (value) => `new:${value}`);
      const transform = getTransform('testTransform');
      expect(transform?.('input', {} as TransformContext)).toBe('new:input');
    });

    it('handles string transform', () => {
      registerTransform('toUpper', (value) =>
        typeof value === 'string' ? value.toUpperCase() : value
      );
      const transform = getTransform('toUpper');
      expect(transform?.('hello', {} as TransformContext)).toBe('HELLO');
    });

    it('handles number transform', () => {
      registerTransform('double', (value) =>
        typeof value === 'number' ? value * 2 : value
      );
      const transform = getTransform('double');
      expect(transform?.(5, {} as TransformContext)).toBe(10);
    });

    it('handles transform that returns null', () => {
      registerTransform('nullify', () => null);
      const transform = getTransform('nullify');
      expect(transform?.('anything', {} as TransformContext)).toBeNull();
    });
  });

  describe('setNestedValue', () => {
    it('sets a simple value', () => {
      const obj: Record<string, any> = {};
      setNestedValue(obj, 'name', 'Test');
      expect(obj.name).toBe('Test');
    });

    it('sets a nested value', () => {
      const obj: Record<string, any> = {};
      setNestedValue(obj, 'properties.creator', 'Artist');
      expect(obj.properties.creator).toBe('Artist');
    });

    it('sets a deeply nested value', () => {
      const obj: Record<string, any> = {};
      setNestedValue(obj, 'a.b.c.d', 'deep');
      expect(obj.a.b.c.d).toBe('deep');
    });

    it('overwrites existing value', () => {
      const obj: Record<string, any> = { name: 'Old' };
      setNestedValue(obj, 'name', 'New');
      expect(obj.name).toBe('New');
    });

    it('overwrites existing nested value', () => {
      const obj: Record<string, any> = { properties: { creator: 'Old' } };
      setNestedValue(obj, 'properties.creator', 'New');
      expect(obj.properties.creator).toBe('New');
    });

    it('preserves existing siblings', () => {
      const obj: Record<string, any> = { properties: { title: 'Title' } };
      setNestedValue(obj, 'properties.creator', 'Artist');
      expect(obj.properties.title).toBe('Title');
      expect(obj.properties.creator).toBe('Artist');
    });

    it('handles numeric values', () => {
      const obj: Record<string, any> = {};
      setNestedValue(obj, 'count', 42);
      expect(obj.count).toBe(42);
    });

    it('handles boolean values', () => {
      const obj: Record<string, any> = {};
      setNestedValue(obj, 'active', true);
      expect(obj.active).toBe(true);
    });

    it('handles array values', () => {
      const obj: Record<string, any> = {};
      setNestedValue(obj, 'items', [1, 2, 3]);
      expect(obj.items).toEqual([1, 2, 3]);
    });

    it('handles object values', () => {
      const obj: Record<string, any> = {};
      setNestedValue(obj, 'nested', { foo: 'bar' });
      expect(obj.nested).toEqual({ foo: 'bar' });
    });
  });

  describe('built-in transforms', () => {
    it('trim transform is registered', () => {
      const transform = getTransform('trim');
      expect(transform).toBeDefined();
    });

    it('trim transform trims whitespace', () => {
      const transform = getTransform('trim');
      expect(transform?.('  hello  ', {} as TransformContext)).toBe('hello');
    });

    it('trim transform handles non-string values', () => {
      const transform = getTransform('trim');
      expect(transform?.(123, {} as TransformContext)).toBe('123');
    });

    it('normalizeDate transform is registered', () => {
      const transform = getTransform('normalizeDate');
      expect(transform).toBeDefined();
    });

    it('normalizeDate handles ISO date string', () => {
      const transform = getTransform('normalizeDate');
      const result = transform?.('2024-01-15T10:30:00Z', {} as TransformContext);
      expect(result).toBe('2024-01-15');
    });

    it('normalizeDate handles simple date string', () => {
      const transform = getTransform('normalizeDate');
      const result = transform?.('January 15, 2024', {} as TransformContext);
      expect(result).toBe('2024-01-15');
    });

    it('formatDimensions transform is registered', () => {
      const transform = getTransform('formatDimensions');
      expect(transform).toBeDefined();
    });

    it('formatDimensions formats dimensions object', () => {
      const transform = getTransform('formatDimensions');
      const result = transform?.({ height: 100, width: 80, unit: 'cm' }, {} as TransformContext);
      expect(result).toBe('100 × 80 cm');
    });

    it('formatDimensions uses default unit', () => {
      const transform = getTransform('formatDimensions');
      const result = transform?.({ height: 100, width: 80 }, {} as TransformContext);
      expect(result).toBe('100 × 80 cm');
    });

    it('formatDimensions handles non-object values', () => {
      const transform = getTransform('formatDimensions');
      const result = transform?.('some string', {} as TransformContext);
      expect(result).toBe('some string');
    });

    it('createIdentifier transform is registered', () => {
      const transform = getTransform('createIdentifier');
      expect(transform).toBeDefined();
    });

    it('createIdentifier creates identifier array', () => {
      const transform = getTransform('createIdentifier');
      const result = transform?.('ACC-001', {} as TransformContext);
      expect(result).toEqual([{ scheme: 'accession-number', value: 'ACC-001' }]);
    });
  });

  describe('executeRule', () => {
    function createContext(): TransformContext {
      return {
        sourceRecord: {
          id: 'src-1',
          snapshotId: 'snap-1',
          connectorId: 'conn-1',
          externalId: 'ext-1',
          raw: { title: 'Test Title', description: 'Test Desc' },
          rawHash: 'hash-1',
          fetchedAt: '2024-01-01T00:00:00Z',
        },
        canonicalRecord: {},
        warnings: [],
        ruleStats: {
          totalRules: 0,
          executedRules: 0,
          skippedRules: 0,
          failedRules: 0,
        },
      };
    }

    it('extracts and sets value from source', () => {
      const rule: MappingRule = {
        id: 'rule-1',
        sourcePath: 'title',
        targetPath: 'label',
      };
      const context = createContext();

      const result = executeRule(rule, context);

      expect(result.success).toBe(true);
      expect(result.sourceValue).toBe('Test Title');
      expect(context.canonicalRecord.label).toBe('Test Title');
    });

    it('skips when source value is missing and not required', () => {
      const rule: MappingRule = {
        id: 'rule-2',
        sourcePath: 'nonexistent',
        targetPath: 'label',
        required: false,
      };
      const context = createContext();

      const result = executeRule(rule, context);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('fails when required field is missing', () => {
      const rule: MappingRule = {
        id: 'rule-3',
        sourcePath: 'nonexistent',
        targetPath: 'label',
        required: true,
      };
      const context = createContext();

      const result = executeRule(rule, context);

      expect(result.success).toBe(false);
      expect(result.skipped).toBe(false);
      expect(result.error).toContain('Required field');
    });

    it('uses default value when source is missing', () => {
      const rule: MappingRule = {
        id: 'rule-4',
        sourcePath: 'nonexistent',
        targetPath: 'label',
        defaultValue: 'Default Label',
      };
      const context = createContext();

      const result = executeRule(rule, context);

      expect(result.success).toBe(true);
      expect(context.canonicalRecord.label).toBe('Default Label');
    });

    it('applies transform to value', () => {
      registerTransform('uppercase', (value) =>
        typeof value === 'string' ? value.toUpperCase() : value
      );
      const rule: MappingRule = {
        id: 'rule-5',
        sourcePath: 'title',
        targetPath: 'label',
        transform: 'uppercase',
      };
      const context = createContext();

      const result = executeRule(rule, context);

      expect(result.success).toBe(true);
      expect(result.targetValue).toBe('TEST TITLE');
    });

    it('warns when transform is not found', () => {
      const rule: MappingRule = {
        id: 'rule-6',
        sourcePath: 'title',
        targetPath: 'label',
        transform: 'unknownTransform',
      };
      const context = createContext();

      const result = executeRule(rule, context);

      expect(result.success).toBe(true);
      expect(context.warnings).toContain('Transform unknownTransform not found, using raw value');
    });
  });

  describe('executeRules', () => {
    function createContext(): TransformContext {
      return {
        sourceRecord: {
          id: 'src-1',
          snapshotId: 'snap-1',
          connectorId: 'conn-1',
          externalId: 'ext-1',
          raw: { title: 'Test Title', description: 'Test Desc' },
          rawHash: 'hash-1',
          fetchedAt: '2024-01-01T00:00:00Z',
        },
        canonicalRecord: {},
        warnings: [],
        ruleStats: {
          totalRules: 0,
          executedRules: 0,
          skippedRules: 0,
          failedRules: 0,
        },
      };
    }

    it('executes multiple rules', () => {
      const rules: MappingRule[] = [
        { id: 'rule-1', sourcePath: 'title', targetPath: 'label' },
        { id: 'rule-2', sourcePath: 'description', targetPath: 'description' },
      ];
      const context = createContext();

      const results = executeRules(rules, context);

      expect(results).toHaveLength(2);
      expect(context.canonicalRecord.label).toBe('Test Title');
      expect(context.canonicalRecord.description).toBe('Test Desc');
    });

    it('tracks rule statistics', () => {
      const rules: MappingRule[] = [
        { id: 'rule-1', sourcePath: 'title', targetPath: 'label' },
        { id: 'rule-2', sourcePath: 'nonexistent', targetPath: 'other' },
        { id: 'rule-3', sourcePath: 'missing', targetPath: 'another', required: true },
      ];
      const context = createContext();

      executeRules(rules, context);

      expect(context.ruleStats.totalRules).toBe(3);
      expect(context.ruleStats.executedRules).toBe(1);
      expect(context.ruleStats.skippedRules).toBe(1);
      expect(context.ruleStats.failedRules).toBe(1);
    });

    it('returns results for all rules', () => {
      const rules: MappingRule[] = [
        { id: 'rule-1', sourcePath: 'title', targetPath: 'label' },
      ];
      const context = createContext();

      const results = executeRules(rules, context);

      expect(results[0].rule.id).toBe('rule-1');
      expect(results[0].success).toBe(true);
    });
  });

  describe('runTransformPipeline', () => {
    function createContext(): TransformContext {
      return {
        sourceRecord: {
          id: 'src-1',
          snapshotId: 'snap-1',
          connectorId: 'conn-1',
          externalId: 'ext-1',
          raw: {},
          rawHash: 'hash-1',
          fetchedAt: '2024-01-01T00:00:00Z',
        },
        canonicalRecord: {},
        warnings: [],
        ruleStats: {
          totalRules: 0,
          executedRules: 0,
          skippedRules: 0,
          failedRules: 0,
        },
      };
    }

    it('runs empty pipeline', () => {
      const record = { label: 'Test' };
      const pipeline = { steps: [] };
      const context = createContext();

      const result = runTransformPipeline(record, pipeline, context);

      expect(result.record).toEqual({ label: 'Test' });
      expect(result.warnings).toBeUndefined();
    });

    it('runs normalize-whitespace step', () => {
      const record = { label: '  spaced label  ', description: '  spaced desc  ' };
      const pipeline = { steps: [{ type: 'normalize-whitespace' }] };
      const context = createContext();

      const result = runTransformPipeline(record, pipeline, context);

      expect(result.record.label).toBe('spaced label');
      expect(result.record.description).toBe('spaced desc');
    });

    it('runs normalize-identifiers step', () => {
      const record = {
        identifiers: [
          { scheme: 'accession', value: '  ABC-123  ' },
          { scheme: 'legacy', value: 'XYZ ' },
        ],
      };
      const pipeline = { steps: [{ type: 'normalize-identifiers' }] };
      const context = createContext();

      const result = runTransformPipeline(record, pipeline, context);

      expect(result.record.identifiers?.[0]?.value).toBe('ABC-123');
      expect(result.record.identifiers?.[1]?.value).toBe('XYZ');
    });

    it('runs normalize-dates step', () => {
      const record = {
        date_created: '2024-06-15',
        properties: {
          acquisition_date: '2024-06-15',
        },
      };
      const pipeline = { steps: [{ type: 'normalize-dates' }] };
      const context = createContext();

      const result = runTransformPipeline(record, pipeline, context);

      // The dates should be normalized (no change needed for ISO dates)
      expect(result.record.date_created).toBeDefined();
    });

    it('runs multiple steps in sequence', () => {
      const record = {
        label: '  Test Label  ',
        identifiers: [{ scheme: 'id', value: '  ABC  ' }],
      };
      const pipeline = {
        steps: [
          { type: 'normalize-whitespace' },
          { type: 'normalize-identifiers' },
        ],
      };
      const context = createContext();

      const result = runTransformPipeline(record, pipeline, context);

      expect(result.record.label).toBe('Test Label');
      expect(result.record.identifiers?.[0]?.value).toBe('ABC');
    });

    it('handles unknown step type', () => {
      const record = { label: 'Test' };
      const pipeline = { steps: [{ type: 'unknown-step' }] };
      const context = createContext();

      const result = runTransformPipeline(record, pipeline, context);

      expect(result.warnings).toBeDefined();
      expect(result.warnings?.some(w => w.includes('unknown-step'))).toBe(true);
    });

    it('continues after step error', () => {
      const record = { label: '  Test  ' };
      const pipeline = {
        steps: [
          { type: 'unknown-step' }, // Will fail
          { type: 'normalize-whitespace' }, // Should still run
        ],
      };
      const context = createContext();

      const result = runTransformPipeline(record, pipeline, context);

      // Should still normalize whitespace despite first step failing
      expect(result.record.label).toBe('Test');
    });

    it('collects warnings from multiple steps', () => {
      const record = { label: '  test  ' };
      const pipeline = {
        steps: [
          { type: 'unknown-step-1' },
          { type: 'unknown-step-2' },
        ],
      };
      const context = createContext();

      const result = runTransformPipeline(record, pipeline, context);

      expect(result.warnings?.length).toBe(2);
    });

    it('preserves record fields not modified by steps', () => {
      const record = {
        label: '  Test  ',
        id: 'record-id',
        type: 'artwork',
      };
      const pipeline = { steps: [{ type: 'normalize-whitespace' }] };
      const context = createContext();

      const result = runTransformPipeline(record, pipeline, context);

      expect(result.record.id).toBe('record-id');
      expect(result.record.type).toBe('artwork');
    });

    it('runs normalize-dimensions step', () => {
      const record = {
        properties: {
          height: '100 cm',
          width: '  50  ',
          depth: 25,
        },
      };
      const pipeline = { steps: [{ type: 'normalize-dimensions' }] };
      const context = createContext();

      const result = runTransformPipeline(record, pipeline, context);

      expect(result.record.properties).toBeDefined();
    });

    it('normalizes description whitespace with warning', () => {
      const record = {
        description: '   Multiple    spaces    here   ',
      };
      const pipeline = { steps: [{ type: 'normalize-whitespace' }] };
      const context = createContext();

      const result = runTransformPipeline(record, pipeline, context);

      expect(result.record.description).toBe('Multiple spaces here');
    });

    it('removes empty identifiers', () => {
      const record = {
        identifiers: [
          { scheme: 'id', value: 'valid' },
          { scheme: 'empty', value: '' },
          { scheme: 'whitespace', value: '   ' },
        ],
      };
      const pipeline = { steps: [{ type: 'normalize-identifiers' }] };
      const context = createContext();

      const result = runTransformPipeline(record, pipeline, context);

      expect(result.record.identifiers?.length).toBe(1);
      expect(result.warnings).toBeDefined();
    });

    it('deduplicates identifiers', () => {
      const record = {
        identifiers: [
          { scheme: 'id', value: 'ABC' },
          { scheme: 'id', value: 'ABC' },
          { scheme: 'other', value: 'DEF' },
        ],
      };
      const pipeline = { steps: [{ type: 'normalize-identifiers' }] };
      const context = createContext();

      const result = runTransformPipeline(record, pipeline, context);

      expect(result.record.identifiers?.length).toBe(2);
    });

    it('handles string identifiers', () => {
      const record = {
        identifiers: ['  ABC  ', 'DEF', '  ABC  '] as any,
      };
      const pipeline = { steps: [{ type: 'normalize-identifiers' }] };
      const context = createContext();

      const result = runTransformPipeline(record, pipeline, context);

      expect(result.record.identifiers?.[0]).toBe('ABC');
      expect(result.record.identifiers?.[1]).toBe('DEF');
    });
  });
});
