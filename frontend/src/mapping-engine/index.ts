/**
 * Madrona Mapping Engine v1 — Public API
 * 
 * Barrel exports for the mapping engine module.
 * 
 * USAGE:
 * ```typescript
 * import { ingest, project, registerTransform } from './mapping-engine';
 * ```
 * 
 * CONVENTIONS:
 * See DSL_CONVENTIONS.md for canonical mapping DSL patterns:
 * - Write paths use $.foo.bar[0] format
 * - Read selectors: path, jsonPath, const, template
 * - Rules execute in order; later rules may append to arrays
 */

// Main engine entrypoints
export { ingest, project, applyMappingToCanonical, finalizeCanonicalRecord } from './engine';

// Hash utilities
export { stableHash, hashProvenance, hashProjection } from './hash';

// Type definitions
export type {
  MappingRule,
  CompiledMapping,
  TransformContext,
  MappingEngineOptions,
  MappingEngineResult,
  RuleExecutionResult,
  // Compilation types
  CompilationDiagnostic,
  CompiledDSLRule,
  CompiledExtractor,
  // Engine input/output types
  JsonValue,
  EngineContext,
  IngestRequest,
  IngestResult,
  ProjectRequest,
  ProjectResult,
  SafetyLimits,
  // Mapping DSL rule types
  BaseRule,
  SetFieldRule,
  MapArrayRule,
  EmitRelationshipRule,
  EmitWarningRule,
  SetExtensionRule,
  MappingDSLRule,
} from './types';

// Mapping utilities
export {
  validateMappingRule,
  validateDSLRule,
  compileMapping,
  compileMappingDSL,
  createMappingRule,
  EXAMPLE_MAPPING_RULES,
  EXAMPLE_DSL_RULES,
} from './mapping';

// Constants
export { DEFAULT_SAFETY_LIMITS } from './types';

// Developer ergonomics helpers
export {
  explainMapping,
  dryRunMapping,
  validateMapping,
} from './helpers';
export type {
  MappingExplanation,
  RuleExplanation,
  DryRunResult,
  ValidationResult,
  ValidationDiagnostic,
} from './helpers';

// Transform utilities
export {
  registerTransform,
  getTransform,
  executeRule,
  executeRules,
  runTransformPipeline,
} from './transforms';

export type { TransformStepResult } from './transforms';

// Extractor utilities
export {
  extractDotPath,
  extractJSONPath,
  extractCSVColumn,
  extractDBRow,
  extract,
  extractSafe,
  extractRequired,
} from './extractors';

// Source selector utilities
export type { SourceSelector, SelectorType } from './selectors';
export {
  selectOne,
  selectMany,
  selectByPath,
  selectByJSONPath,
  selectByTemplate,
  createSelector,
  selectWithFallback,
} from './selectors';

// Report builders
export { 
  buildMappingReport, 
  MappingReportBuilder, 
  createReportBuilder,
  summarizeRuleResults,
} from './report';

export type { 
  WarningEntry, 
  RuleStats, 
  PhaseTimings 
} from './report';

// Builder utilities (safe writes to CanonicalRecord)
export {
  setPath,
  appendPath,
  ensureArray,
  isReservedPath,
  getReservedKeys,
  safeMerge,
  CanonicalBuilderError,
} from './builder';

// Error classes
export {
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
