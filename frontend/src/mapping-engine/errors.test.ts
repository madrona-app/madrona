import { describe, it, expect } from 'vitest';
import {
  MappingEngineError,
  RuleExecutionError,
  ExtractionError,
  TransformError,
  MappingValidationError,
  CanonicalValidationError,
  MappingCompileError,
  MappingApplyError,
  CanonicalInvariantError,
} from './errors';

describe('MappingEngineError', () => {
  it('sets message, code, and details', () => {
    const error = new MappingEngineError('Test message', 'TEST_CODE', { key: 'value' });

    expect(error.message).toBe('Test message');
    expect(error.code).toBe('TEST_CODE');
    expect(error.details).toEqual({ key: 'value' });
  });

  it('sets name to MappingEngineError', () => {
    const error = new MappingEngineError('Test', 'TEST');
    expect(error.name).toBe('MappingEngineError');
  });

  it('extends Error', () => {
    const error = new MappingEngineError('Test', 'TEST');
    expect(error instanceof Error).toBe(true);
  });

  it('details is optional', () => {
    const error = new MappingEngineError('Test', 'TEST');
    expect(error.details).toBeUndefined();
  });
});

describe('RuleExecutionError', () => {
  it('formats message with rule ID', () => {
    const error = new RuleExecutionError('rule-123', 'value is null');
    expect(error.message).toBe('Rule rule-123 failed: value is null');
  });

  it('sets ruleId property', () => {
    const error = new RuleExecutionError('rule-456', 'test error');
    expect(error.ruleId).toBe('rule-456');
  });

  it('sets code to RULE_EXECUTION_ERROR', () => {
    const error = new RuleExecutionError('rule-1', 'test');
    expect(error.code).toBe('RULE_EXECUTION_ERROR');
  });

  it('sets name to RuleExecutionError', () => {
    const error = new RuleExecutionError('rule-1', 'test');
    expect(error.name).toBe('RuleExecutionError');
  });

  it('includes details when provided', () => {
    const error = new RuleExecutionError('rule-1', 'test', { input: 'bad value' });
    expect(error.details).toEqual({ input: 'bad value' });
  });
});

describe('ExtractionError', () => {
  it('formats message with source path', () => {
    const error = new ExtractionError('data.items[0].name', 'path not found');
    expect(error.message).toBe('Failed to extract from data.items[0].name: path not found');
  });

  it('sets sourcePath property', () => {
    const error = new ExtractionError('root.child', 'test');
    expect(error.sourcePath).toBe('root.child');
  });

  it('sets code to EXTRACTION_ERROR', () => {
    const error = new ExtractionError('path', 'test');
    expect(error.code).toBe('EXTRACTION_ERROR');
  });

  it('sets name to ExtractionError', () => {
    const error = new ExtractionError('path', 'test');
    expect(error.name).toBe('ExtractionError');
  });
});

describe('TransformError', () => {
  it('formats message with transform name', () => {
    const error = new TransformError('toUpperCase', 'input is not a string');
    expect(error.message).toBe('Transform toUpperCase failed: input is not a string');
  });

  it('sets transformName property', () => {
    const error = new TransformError('toLowerCase', 'test');
    expect(error.transformName).toBe('toLowerCase');
  });

  it('sets code to TRANSFORM_ERROR', () => {
    const error = new TransformError('transform', 'test');
    expect(error.code).toBe('TRANSFORM_ERROR');
  });

  it('sets name to TransformError', () => {
    const error = new TransformError('transform', 'test');
    expect(error.name).toBe('TransformError');
  });
});

describe('MappingValidationError', () => {
  it('formats message with violations', () => {
    const error = new MappingValidationError(['missing required field', 'invalid type']);
    expect(error.message).toBe('Mapping validation failed: missing required field; invalid type');
  });

  it('sets violations property', () => {
    const violations = ['error 1', 'error 2'];
    const error = new MappingValidationError(violations);
    expect(error.violations).toEqual(violations);
  });

  it('sets code to MAPPING_VALIDATION_ERROR', () => {
    const error = new MappingValidationError(['error']);
    expect(error.code).toBe('MAPPING_VALIDATION_ERROR');
  });

  it('sets name to MappingValidationError', () => {
    const error = new MappingValidationError(['error']);
    expect(error.name).toBe('MappingValidationError');
  });

  it('handles single violation', () => {
    const error = new MappingValidationError(['single error']);
    expect(error.message).toBe('Mapping validation failed: single error');
  });

  it('handles empty violations array', () => {
    const error = new MappingValidationError([]);
    expect(error.message).toBe('Mapping validation failed: ');
  });
});

describe('CanonicalValidationError', () => {
  it('formats message with violations', () => {
    const error = new CanonicalValidationError(['invalid date format', 'missing ID']);
    expect(error.message).toBe('Canonical validation failed: invalid date format; missing ID');
  });

  it('sets violations property', () => {
    const violations = ['v1', 'v2', 'v3'];
    const error = new CanonicalValidationError(violations);
    expect(error.violations).toEqual(violations);
  });

  it('sets code to CANONICAL_VALIDATION_ERROR', () => {
    const error = new CanonicalValidationError(['error']);
    expect(error.code).toBe('CANONICAL_VALIDATION_ERROR');
  });

  it('sets name to CanonicalValidationError', () => {
    const error = new CanonicalValidationError(['error']);
    expect(error.name).toBe('CanonicalValidationError');
  });
});

describe('MappingCompileError', () => {
  it('formats message with mapping ID', () => {
    const error = new MappingCompileError('map-001', 'syntax error in expression');
    expect(error.message).toBe('Failed to compile mapping map-001: syntax error in expression');
  });

  it('sets mappingId property', () => {
    const error = new MappingCompileError('map-xyz', 'test');
    expect(error.mappingId).toBe('map-xyz');
  });

  it('sets code to MAPPING_COMPILE_ERROR', () => {
    const error = new MappingCompileError('map', 'test');
    expect(error.code).toBe('MAPPING_COMPILE_ERROR');
  });

  it('sets name to MappingCompileError', () => {
    const error = new MappingCompileError('map', 'test');
    expect(error.name).toBe('MappingCompileError');
  });
});

describe('MappingApplyError', () => {
  it('formats message with mapping ID and source record ID', () => {
    const error = new MappingApplyError('map-123', 'rec-456', 'field type mismatch');
    expect(error.message).toBe(
      'Failed to apply mapping map-123 to source record rec-456: field type mismatch'
    );
  });

  it('sets mappingId property', () => {
    const error = new MappingApplyError('mapping-1', 'record-1', 'test');
    expect(error.mappingId).toBe('mapping-1');
  });

  it('sets sourceRecordId property', () => {
    const error = new MappingApplyError('mapping-1', 'record-123', 'test');
    expect(error.sourceRecordId).toBe('record-123');
  });

  it('sets code to MAPPING_APPLY_ERROR', () => {
    const error = new MappingApplyError('map', 'rec', 'test');
    expect(error.code).toBe('MAPPING_APPLY_ERROR');
  });

  it('sets name to MappingApplyError', () => {
    const error = new MappingApplyError('map', 'rec', 'test');
    expect(error.name).toBe('MappingApplyError');
  });

  it('includes details when provided', () => {
    const error = new MappingApplyError('map', 'rec', 'test', { field: 'name' });
    expect(error.details).toEqual({ field: 'name' });
  });
});

describe('CanonicalInvariantError', () => {
  it('formats message with violations', () => {
    const error = new CanonicalInvariantError(['uniqueness violated', 'reference invalid']);
    expect(error.message).toBe('Canonical invariant violations: uniqueness violated; reference invalid');
  });

  it('sets violations property', () => {
    const violations = ['invariant 1', 'invariant 2'];
    const error = new CanonicalInvariantError(violations);
    expect(error.violations).toEqual(violations);
  });

  it('sets code to CANONICAL_INVARIANT_ERROR', () => {
    const error = new CanonicalInvariantError(['error']);
    expect(error.code).toBe('CANONICAL_INVARIANT_ERROR');
  });

  it('sets name to CanonicalInvariantError', () => {
    const error = new CanonicalInvariantError(['error']);
    expect(error.name).toBe('CanonicalInvariantError');
  });
});

describe('error hierarchy', () => {
  it('all errors extend MappingEngineError', () => {
    expect(new RuleExecutionError('r', 'm') instanceof MappingEngineError).toBe(true);
    expect(new ExtractionError('p', 'm') instanceof MappingEngineError).toBe(true);
    expect(new TransformError('t', 'm') instanceof MappingEngineError).toBe(true);
    expect(new MappingValidationError(['v']) instanceof MappingEngineError).toBe(true);
    expect(new CanonicalValidationError(['v']) instanceof MappingEngineError).toBe(true);
    expect(new MappingCompileError('id', 'm') instanceof MappingEngineError).toBe(true);
    expect(new MappingApplyError('m', 'r', 'msg') instanceof MappingEngineError).toBe(true);
    expect(new CanonicalInvariantError(['v']) instanceof MappingEngineError).toBe(true);
  });

  it('all errors extend Error', () => {
    expect(new RuleExecutionError('r', 'm') instanceof Error).toBe(true);
    expect(new ExtractionError('p', 'm') instanceof Error).toBe(true);
    expect(new TransformError('t', 'm') instanceof Error).toBe(true);
    expect(new MappingValidationError(['v']) instanceof Error).toBe(true);
    expect(new CanonicalValidationError(['v']) instanceof Error).toBe(true);
    expect(new MappingCompileError('id', 'm') instanceof Error).toBe(true);
    expect(new MappingApplyError('m', 'r', 'msg') instanceof Error).toBe(true);
    expect(new CanonicalInvariantError(['v']) instanceof Error).toBe(true);
  });
});
