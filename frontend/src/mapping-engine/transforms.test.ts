import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerTransform,
  getTransform,
  executeRule,
  executeRules,
  setNestedValue,
} from './transforms';
import type { MappingRule, TransformContext } from './types';

// Helper to create a test context
function createTestContext(sourceData: Record<string, any> = {}): TransformContext {
  return {
    sourceRecord: {
      id: 'snap-test-123',
      source: {
        system: 'test-system',
        recordId: 'rec-123',
      },
      capturedAt: new Date().toISOString(),
      raw: sourceData,
      meta: {},
    },
    canonicalRecord: {} as any,
    warnings: [],
    ruleStats: {
      totalRules: 0,
      executedRules: 0,
      failedRules: 0,
      skippedRules: 0,
    },
  };
}

describe('registerTransform and getTransform', () => {
  it('registers and retrieves a transform', () => {
    const myTransform = (value: any) => value.toUpperCase();
    registerTransform('testUpperCase', myTransform);
    expect(getTransform('testUpperCase')).toBe(myTransform);
  });

  it('returns undefined for unregistered transform', () => {
    expect(getTransform('nonexistent')).toBeUndefined();
  });

  it('allows overwriting existing transform', () => {
    const firstFn = () => 'first';
    const secondFn = () => 'second';
    registerTransform('overwrite', firstFn);
    registerTransform('overwrite', secondFn);
    expect(getTransform('overwrite')).toBe(secondFn);
  });
});

describe('setNestedValue', () => {
  it('sets top-level property', () => {
    const obj: any = {};
    setNestedValue(obj, 'name', 'Test');
    expect(obj.name).toBe('Test');
  });

  it('sets nested property', () => {
    const obj: any = {};
    setNestedValue(obj, 'properties.title', 'My Title');
    expect(obj.properties.title).toBe('My Title');
  });

  it('sets deeply nested property', () => {
    const obj: any = {};
    setNestedValue(obj, 'a.b.c.d', 'deep');
    expect(obj.a.b.c.d).toBe('deep');
  });

  it('creates intermediate objects', () => {
    const obj: any = {};
    setNestedValue(obj, 'nested.path', 'value');
    expect(obj.nested).toBeDefined();
    expect(typeof obj.nested).toBe('object');
  });

  it('overwrites existing value', () => {
    const obj: any = { name: 'old' };
    setNestedValue(obj, 'name', 'new');
    expect(obj.name).toBe('new');
  });

  it('handles numeric values', () => {
    const obj: any = {};
    setNestedValue(obj, 'count', 42);
    expect(obj.count).toBe(42);
  });

  it('handles null values', () => {
    const obj: any = {};
    setNestedValue(obj, 'nullable', null);
    expect(obj.nullable).toBeNull();
  });

  it('handles array values', () => {
    const obj: any = {};
    setNestedValue(obj, 'items', [1, 2, 3]);
    expect(obj.items).toEqual([1, 2, 3]);
  });
});

describe('executeRule', () => {
  describe('basic extraction', () => {
    it('extracts value from source', () => {
      const rule: MappingRule = {
        id: 'rule-1',
        sourcePath: 'title',
        targetPath: 'label',
      };
      const context = createTestContext({ title: 'Test Title' });

      const result = executeRule(rule, context);

      expect(result.success).toBe(true);
      expect(result.sourceValue).toBe('Test Title');
      expect(result.targetValue).toBe('Test Title');
      expect(context.canonicalRecord.label).toBe('Test Title');
    });

    it('extracts nested value', () => {
      const rule: MappingRule = {
        id: 'rule-2',
        sourcePath: 'fields.title',
        targetPath: 'label',
      };
      const context = createTestContext({ fields: { title: 'Nested Title' } });

      const result = executeRule(rule, context);

      expect(result.success).toBe(true);
      expect(result.sourceValue).toBe('Nested Title');
    });
  });

  describe('default values', () => {
    it('uses default value when source is missing', () => {
      const rule: MappingRule = {
        id: 'rule-3',
        sourcePath: 'missing',
        targetPath: 'label',
        defaultValue: 'Default',
      };
      const context = createTestContext({});

      const result = executeRule(rule, context);

      expect(result.success).toBe(true);
      expect(result.targetValue).toBe('Default');
    });
  });

  describe('skipping rules', () => {
    it('skips when value is missing and not required', () => {
      const rule: MappingRule = {
        id: 'rule-4',
        sourcePath: 'missing',
        targetPath: 'label',
        required: false,
      };
      const context = createTestContext({});

      const result = executeRule(rule, context);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('skips when value is null and not required', () => {
      const rule: MappingRule = {
        id: 'rule-5',
        sourcePath: 'nullable',
        targetPath: 'label',
        required: false,
      };
      const context = createTestContext({ nullable: null });

      const result = executeRule(rule, context);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });
  });

  describe('required fields', () => {
    it('fails when required field is missing', () => {
      const rule: MappingRule = {
        id: 'rule-6',
        sourcePath: 'missing',
        targetPath: 'label',
        required: true,
      };
      const context = createTestContext({});

      const result = executeRule(rule, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Required field');
      expect(result.skipped).toBe(false);
    });

    it('adds warning for missing required field', () => {
      const rule: MappingRule = {
        id: 'rule-7',
        sourcePath: 'missing',
        targetPath: 'label',
        required: true,
      };
      const context = createTestContext({});

      executeRule(rule, context);

      expect(context.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('transforms', () => {
    beforeEach(() => {
      registerTransform('testTrim', (value: any) => String(value).trim());
      registerTransform('testError', () => { throw new Error('Transform failed'); });
    });

    it('applies transform to value', () => {
      const rule: MappingRule = {
        id: 'rule-8',
        sourcePath: 'title',
        targetPath: 'label',
        transform: 'testTrim',
      };
      const context = createTestContext({ title: '  Test  ' });

      const result = executeRule(rule, context);

      expect(result.success).toBe(true);
      expect(result.targetValue).toBe('Test');
    });

    it('adds warning for unknown transform', () => {
      const rule: MappingRule = {
        id: 'rule-9',
        sourcePath: 'title',
        targetPath: 'label',
        transform: 'unknownTransform',
      };
      const context = createTestContext({ title: 'Test' });

      const result = executeRule(rule, context);

      expect(result.success).toBe(true);
      expect(result.targetValue).toBe('Test'); // Uses raw value
      expect(context.warnings.some(w => w.includes('not found'))).toBe(true);
    });

    it('handles transform error', () => {
      const rule: MappingRule = {
        id: 'rule-10',
        sourcePath: 'title',
        targetPath: 'label',
        transform: 'testError',
      };
      const context = createTestContext({ title: 'Test' });

      const result = executeRule(rule, context);

      expect(result.success).toBe(false);
      expect(context.warnings.length).toBeGreaterThan(0);
    });
  });
});

describe('executeRules', () => {
  it('executes all rules', () => {
    const rules: MappingRule[] = [
      { id: 'r1', sourcePath: 'title', targetPath: 'label' },
      { id: 'r2', sourcePath: 'desc', targetPath: 'description' },
    ];
    const context = createTestContext({ title: 'Title', desc: 'Description' });

    const results = executeRules(rules, context);

    expect(results.length).toBe(2);
    expect(results.every(r => r.success)).toBe(true);
  });

  it('updates rule stats for executed rules', () => {
    const rules: MappingRule[] = [
      { id: 'r1', sourcePath: 'title', targetPath: 'label' },
    ];
    const context = createTestContext({ title: 'Test' });

    executeRules(rules, context);

    expect(context.ruleStats.totalRules).toBe(1);
    expect(context.ruleStats.executedRules).toBe(1);
  });

  it('updates rule stats for skipped rules', () => {
    const rules: MappingRule[] = [
      { id: 'r1', sourcePath: 'missing', targetPath: 'label', required: false },
    ];
    const context = createTestContext({});

    executeRules(rules, context);

    expect(context.ruleStats.totalRules).toBe(1);
    expect(context.ruleStats.skippedRules).toBe(1);
  });

  it('updates rule stats for failed rules', () => {
    const rules: MappingRule[] = [
      { id: 'r1', sourcePath: 'missing', targetPath: 'label', required: true },
    ];
    const context = createTestContext({});

    executeRules(rules, context);

    expect(context.ruleStats.totalRules).toBe(1);
    expect(context.ruleStats.failedRules).toBe(1);
  });
});

describe('built-in transforms', () => {
  describe('trim', () => {
    it('trims whitespace from string', () => {
      const trim = getTransform('trim');
      expect(trim).toBeDefined();
      expect(trim!('  hello  ', createTestContext())).toBe('hello');
    });

    it('converts non-string to string', () => {
      const trim = getTransform('trim');
      expect(trim!(123, createTestContext())).toBe('123');
    });
  });

  describe('normalizeDate', () => {
    it('normalizes date string to ISO format', () => {
      const normalizeDate = getTransform('normalizeDate');
      expect(normalizeDate).toBeDefined();
      const result = normalizeDate!('2024-01-15T10:30:00Z', createTestContext());
      expect(result).toBe('2024-01-15');
    });

    it('handles invalid date by returning string', () => {
      const normalizeDate = getTransform('normalizeDate');
      const result = normalizeDate!('not-a-date', createTestContext());
      expect(result).toBe('not-a-date');
    });
  });

  describe('formatCanonicalId', () => {
    it('formats canonical ID with system and recordId', () => {
      const formatCanonicalId = getTransform('formatCanonicalId');
      expect(formatCanonicalId).toBeDefined();
      const context = createTestContext();
      const result = formatCanonicalId!('my-id', context);
      expect(result).toBe('object:test-system:my-id');
    });

    it('uses context recordId if value is empty', () => {
      const formatCanonicalId = getTransform('formatCanonicalId');
      const context = createTestContext();
      const result = formatCanonicalId!(null, context);
      expect(result).toBe('object:test-system:rec-123');
    });
  });

  describe('createIdentifier', () => {
    it('creates identifier object', () => {
      const createIdentifier = getTransform('createIdentifier');
      expect(createIdentifier).toBeDefined();
      const result = createIdentifier!('ACC-001', createTestContext());
      expect(result).toEqual([{ scheme: 'accession-number', value: 'ACC-001' }]);
    });
  });

  describe('formatDimensions', () => {
    it('formats dimensions object', () => {
      const formatDimensions = getTransform('formatDimensions');
      expect(formatDimensions).toBeDefined();
      const result = formatDimensions!({ height: 100, width: 50, unit: 'cm' }, createTestContext());
      expect(result).toBe('100 × 50 cm');
    });

    it('uses default unit', () => {
      const formatDimensions = getTransform('formatDimensions');
      const result = formatDimensions!({ height: 100, width: 50 }, createTestContext());
      expect(result).toBe('100 × 50 cm');
    });

    it('returns string for non-object', () => {
      const formatDimensions = getTransform('formatDimensions');
      const result = formatDimensions!('100x50', createTestContext());
      expect(result).toBe('100x50');
    });

    it('returns string for missing dimensions', () => {
      const formatDimensions = getTransform('formatDimensions');
      const result = formatDimensions!({ height: 100 }, createTestContext());
      expect(result).toBe('[object Object]');
    });
  });
});
