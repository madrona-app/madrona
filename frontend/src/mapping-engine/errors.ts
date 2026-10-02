/**
 * Madrona Mapping Engine v1 — Error Types
 * 
 * Typed errors for mapping and transformation operations.
 */

/**
 * Base error for all mapping engine errors.
 */
export class MappingEngineError extends Error {
  code: string;
  details?: Record<string, any>;
  
  constructor(message: string, code: string, details?: Record<string, any>) {
    super(message);
    this.name = 'MappingEngineError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Error thrown when a mapping rule fails to execute.
 */
export class RuleExecutionError extends MappingEngineError {
  ruleId: string;
  
  constructor(ruleId: string, message: string, details?: Record<string, any>) {
    super(`Rule ${ruleId} failed: ${message}`, 'RULE_EXECUTION_ERROR', details);
    this.name = 'RuleExecutionError';
    this.ruleId = ruleId;
  }
}

/**
 * Error thrown when source data cannot be extracted.
 */
export class ExtractionError extends MappingEngineError {
  sourcePath: string;
  
  constructor(sourcePath: string, message: string, details?: Record<string, any>) {
    super(`Failed to extract from ${sourcePath}: ${message}`, 'EXTRACTION_ERROR', details);
    this.name = 'ExtractionError';
    this.sourcePath = sourcePath;
  }
}

/**
 * Error thrown when a transform function fails.
 */
export class TransformError extends MappingEngineError {
  transformName: string;
  
  constructor(transformName: string, message: string, details?: Record<string, any>) {
    super(`Transform ${transformName} failed: ${message}`, 'TRANSFORM_ERROR', details);
    this.name = 'TransformError';
    this.transformName = transformName;
  }
}

/**
 * Error thrown when mapping validation fails.
 */
export class MappingValidationError extends MappingEngineError {
  violations: string[];
  
  constructor(violations: string[], details?: Record<string, any>) {
    super(`Mapping validation failed: ${violations.join('; ')}`, 'MAPPING_VALIDATION_ERROR', details);
    this.name = 'MappingValidationError';
    this.violations = violations;
  }
}

/**
 * Error thrown when canonical record validation fails.
 */
export class CanonicalValidationError extends MappingEngineError {
  violations: string[];
  
  constructor(violations: string[], details?: Record<string, any>) {
    super(`Canonical validation failed: ${violations.join('; ')}`, 'CANONICAL_VALIDATION_ERROR', details);
    this.name = 'CanonicalValidationError';
    this.violations = violations;
  }
}

/**
 * Error thrown when mapping compilation fails.
 */
export class MappingCompileError extends MappingEngineError {
  mappingId: string;
  
  constructor(mappingId: string, message: string, details?: Record<string, any>) {
    super(`Failed to compile mapping ${mappingId}: ${message}`, 'MAPPING_COMPILE_ERROR', details);
    this.name = 'MappingCompileError';
    this.mappingId = mappingId;
  }
}

/**
 * Error thrown when applying mapping to source record fails.
 */
export class MappingApplyError extends MappingEngineError {
  mappingId: string;
  sourceRecordId: string;
  
  constructor(mappingId: string, sourceRecordId: string, message: string, details?: Record<string, any>) {
    super(`Failed to apply mapping ${mappingId} to source record ${sourceRecordId}: ${message}`, 'MAPPING_APPLY_ERROR', details);
    this.name = 'MappingApplyError';
    this.mappingId = mappingId;
    this.sourceRecordId = sourceRecordId;
  }
}

/**
 * Error thrown when canonical record invariants are violated.
 */
export class CanonicalInvariantError extends MappingEngineError {
  violations: string[];
  
  constructor(violations: string[], details?: Record<string, any>) {
    super(`Canonical invariant violations: ${violations.join('; ')}`, 'CANONICAL_INVARIANT_ERROR', details);
    this.name = 'CanonicalInvariantError';
    this.violations = violations;
  }
}

