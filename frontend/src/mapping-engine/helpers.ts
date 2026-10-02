/**
 * Madrona Mapping Engine v1 — Developer Ergonomics Helpers
 * 
 * Utilities for explaining, validating, and dry-running mappings.
 * Designed for debugging, testing, and future UI integration.
 */

import type { Mapping, SourceRecord, CanonicalRecord, TransformPipeline } from '../types/canonical';
import type {
  MappingDSLRule,
  MappingReport,
  EngineContext,
  IngestRequest,
  IngestResult,
} from './types';
import { compileMappingDSL } from './mapping';
import { ingest } from './engine';

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * High-level explanation of a mapping configuration.
 */
export interface MappingExplanation {
  /**
   * Mapping metadata.
   */
  mapping: {
    id: string;
    version: string;
    source: string;
    target: string;
    description?: string;
  };
  
  /**
   * Summary statistics.
   */
  summary: {
    totalRules: number;
    enabledRules: number;
    disabledRules: number;
    rulesByType: Record<string, number>;
  };
  
  /**
   * Human-readable rule explanations.
   */
  rules: RuleExplanation[];
  
  /**
   * Fields that will be populated in output.
   */
  outputFields: string[];
  
  /**
   * Required source fields (no defaults or fallbacks).
   */
  requiredSourceFields: string[];
  
  /**
   * Optional source fields (with defaults or fallbacks).
   */
  optionalSourceFields: string[];
  
  /**
   * Relationships that will be created.
   */
  relationships: string[];
  
  /**
   * Extensions that will be populated.
   */
  extensions: Array<{
    namespace: string;
    type: string;
  }>;
  
  /**
   * Warnings that may be emitted.
   */
  warnings: Array<{
    ruleId: string;
    condition: string;
    message: string;
    severity: string;
  }>;
}

/**
 * Explanation of a single mapping rule.
 */
export interface RuleExplanation {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  description: string;
  sourceFields: string[];
  outputFields: string[];
  hasDefault: boolean;
  hasFallbacks: boolean;
  hasTransform: boolean;
}

/**
 * Result of a dry-run mapping operation.
 */
export interface DryRunResult {
  /**
   * Whether the dry-run succeeded.
   */
  success: boolean;
  
  /**
   * Preview of the canonical record that would be created.
   * 
   * Note: This is NOT persisted. Provenance and meta fields are synthetic.
   */
  preview?: CanonicalRecord;
  
  /**
   * Mapping report with diagnostics.
   */
  report: MappingReport;
  
  /**
   * Error if dry-run failed.
   */
  error?: {
    type: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Result of mapping validation.
 */
export interface ValidationResult {
  /**
   * Whether the mapping is valid.
   */
  valid: boolean;
  
  /**
   * Validation errors (blocking issues).
   */
  errors: ValidationDiagnostic[];
  
  /**
   * Validation warnings (non-blocking issues).
   */
  warnings: ValidationDiagnostic[];
  
  /**
   * Informational messages.
   */
  info: ValidationDiagnostic[];
  
  /**
   * Summary of validation results.
   */
  summary: {
    totalRules: number;
    validRules: number;
    invalidRules: number;
    rulesByType: Record<string, number>;
  };
}

/**
 * A validation diagnostic message.
 */
export interface ValidationDiagnostic {
  ruleId?: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  code: string;
  context?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPLAIN MAPPING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a high-level explanation of a mapping configuration.
 * 
 * Analyzes the mapping rules and produces human-readable documentation
 * about what the mapping does, what fields it requires, and what output
 * it will produce.
 * 
 * @param mapping - Mapping metadata
 * @param rules - Mapping rules to explain
 * @returns Comprehensive mapping explanation
 * 
 * @example
 * ```typescript
 * const explanation = explainMapping(tmsMapping, tmsRules);
 * 
 * console.log(`Mapping: ${explanation.mapping.id}`);
 * console.log(`Total rules: ${explanation.summary.totalRules}`);
 * console.log(`Output fields: ${explanation.outputFields.join(', ')}`);
 * console.log(`Required fields: ${explanation.requiredSourceFields.join(', ')}`);
 * 
 * explanation.rules.forEach(rule => {
 *   console.log(`- ${rule.name}: ${rule.description}`);
 * });
 * ```
 */
export function explainMapping(
  mapping: Mapping,
  rules: MappingDSLRule[]
): MappingExplanation {
  const rulesByType: Record<string, number> = {};
  const outputFieldsSet = new Set<string>();
  const requiredSourceFieldsSet = new Set<string>();
  const optionalSourceFieldsSet = new Set<string>();
  const relationshipsSet = new Set<string>();
  const extensionsMap = new Map<string, Set<string>>();
  const warningsList: MappingExplanation['warnings'] = [];
  
  const ruleExplanations: RuleExplanation[] = [];
  
  let enabledCount = 0;
  let disabledCount = 0;
  
  for (const rule of rules) {
    // Count by type
    rulesByType[rule.type] = (rulesByType[rule.type] || 0) + 1;
    
    // Count enabled/disabled
    if (rule.enabled === false) {
      disabledCount++;
    } else {
      enabledCount++;
    }
    
    const explanation = explainRule(rule);
    ruleExplanations.push(explanation);
    
    // Track output fields
    explanation.outputFields.forEach(f => outputFieldsSet.add(f));
    
    // Track source fields
    if (explanation.hasDefault || explanation.hasFallbacks) {
      explanation.sourceFields.forEach(f => optionalSourceFieldsSet.add(f));
    } else {
      explanation.sourceFields.forEach(f => requiredSourceFieldsSet.add(f));
    }
    
    // Track relationships
    if (rule.type === 'EmitRelationship') {
      relationshipsSet.add(rule.relationshipType);
    }
    
    // Track extensions
    if (rule.type === 'SetExtension') {
      if (!extensionsMap.has(rule.namespace)) {
        extensionsMap.set(rule.namespace, new Set());
      }
      extensionsMap.get(rule.namespace)!.add(rule.extensionType);
    }
    
    // Track warnings
    if (rule.type === 'EmitWarning') {
      warningsList.push({
        ruleId: rule.id,
        condition: rule.whenMissing ? `Missing: ${rule.whenMissing.join(', ')}` : 'Custom condition',
        message: rule.message,
        severity: rule.severity || 'warning',
      });
    }
  }
  
  const extensions = Array.from(extensionsMap.entries()).flatMap(([namespace, types]) =>
    Array.from(types).map(type => ({ namespace, type }))
  );
  
  return {
    mapping: {
      id: mapping.id,
      version: mapping.version,
      source: mapping.source,
      target: mapping.target,
      description: (mapping as any).description,
    },
    summary: {
      totalRules: rules.length,
      enabledRules: enabledCount,
      disabledRules: disabledCount,
      rulesByType,
    },
    rules: ruleExplanations,
    outputFields: Array.from(outputFieldsSet).sort(),
    requiredSourceFields: Array.from(requiredSourceFieldsSet).sort(),
    optionalSourceFields: Array.from(optionalSourceFieldsSet).sort(),
    relationships: Array.from(relationshipsSet).sort(),
    extensions,
    warnings: warningsList,
  };
}

/**
 * Explain a single mapping rule.
 */
function explainRule(rule: MappingDSLRule): RuleExplanation {
  const sourceFields: string[] = [];
  const outputFields: string[] = [];
  let description = '';
  let hasDefault = false;
  let hasFallbacks = false;
  let hasTransform = false;
  
  // Store base fields before switch narrows type
  const id = rule.id;
  const name = rule.name;
  const type = rule.type;
  const enabled = rule.enabled !== false;
  
  switch (rule.type) {
    case 'SetField': {
      sourceFields.push(rule.from);
      outputFields.push(rule.toPath);
      
      if (rule.coalesce && rule.coalesce.length > 0) {
        sourceFields.push(...rule.coalesce);
        hasFallbacks = true;
        description = `Maps ${rule.from} to ${rule.toPath} (with ${rule.coalesce.length} fallbacks)`;
      } else {
        description = `Maps ${rule.from} to ${rule.toPath}`;
      }
      
      if (rule.default !== undefined) {
        hasDefault = true;
        description += ` [default: ${JSON.stringify(rule.default)}]`;
      }
      
      if (rule.transform) {
        hasTransform = true;
        description += ` [transform: ${rule.transform}]`;
      }
      break;
    }
    
    case 'MapArray': {
      sourceFields.push(rule.fromMany);
      outputFields.push(rule.toPath);
      description = `Maps array ${rule.fromMany} to ${rule.toPath}`;
      
      if (rule.mapperFn) {
        hasTransform = true;
        description += ` [mapper: ${rule.mapperFn}]`;
      }
      
      if (rule.filter) {
        description += ` [filtered]`;
      }
      break;
    }
    
    case 'EmitRelationship': {
      sourceFields.push(rule.targetFrom);
      if (rule.roleFrom) sourceFields.push(rule.roleFrom);
      if (rule.whenFrom) sourceFields.push(rule.whenFrom);
      if (rule.whereFrom) sourceFields.push(rule.whereFrom);
      
      outputFields.push('relationships');
      description = `Creates ${rule.relationshipType} relationship from ${rule.targetFrom}`;
      break;
    }
    
    case 'EmitWarning': {
      if (rule.whenMissing) {
        sourceFields.push(...rule.whenMissing);
        description = `Warns if ${rule.whenMissing.join(' or ')} is missing`;
      } else {
        description = `Emits validation warning`;
      }
      break;
    }
    
    case 'SetExtension': {
      sourceFields.push(rule.dataFrom);
      outputFields.push(`extensions[${rule.namespace}/${rule.extensionType}]`);
      description = `Stores ${rule.dataFrom} in extension ${rule.namespace}/${rule.extensionType}`;
      break;
    }
    
    default:
      description = `${type} rule`;
  }
  
  return {
    id,
    name,
    type,
    enabled,
    description,
    sourceFields,
    outputFields,
    hasDefault,
    hasFallbacks,
    hasTransform,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DRY-RUN MAPPING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Perform a dry-run of a mapping without persisting results.
 * 
 * Executes the full mapping pipeline (compilation, application, transformation,
 * finalization) but returns a preview of what would be created rather than
 * persisting to a database.
 * 
 * Useful for:
 * - Testing mappings with sample data
 * - Previewing results before bulk import
 * - Debugging mapping configurations
 * - UI preview functionality
 * 
 * @param sourceRecord - Source record to transform
 * @param mapping - Mapping configuration
 * @param rules - Mapping rules (embedded in mapping or passed separately)
 * @param options - Optional transform pipeline and context
 * @returns Dry-run result with preview and diagnostics
 * 
 * @example
 * ```typescript
 * const result = await dryRunMapping(
 *   mySourceRecord,
 *   tmsMapping,
 *   tmsRules
 * );
 * 
 * if (result.success) {
 *   console.log('Preview:', result.preview);
 *   console.log('Report:', result.report);
 *   console.log('Fields mapped:', result.report.ruleExecution.fieldsMapped);
 *   console.log('Warnings:', result.report.warnings);
 * } else {
 *   console.error('Dry-run failed:', result.error);
 * }
 * ```
 */
export async function dryRunMapping(
  sourceRecord: SourceRecord,
  mapping: Mapping,
  rules?: MappingDSLRule[],
  options?: {
    transformPipeline?: TransformPipeline;
    context?: Partial<EngineContext>;
  }
): Promise<DryRunResult> {
  try {
    // Prepare context with defaults
    const context: EngineContext = {
      pipelineId: options?.context?.pipelineId || 'dry_run',
      now: options?.context?.now || new Date().toISOString(),
    };
    
    // Rules must be embedded in mapping object for ingest() to work
    // If rules are provided separately, create a new mapping object with them embedded
    type MappingWithRules = Mapping & { rules?: MappingDSLRule[] };
    const mappingWithRules: MappingWithRules = rules
      ? {
          ...mapping,
          rules: rules,
        }
      : mapping;

    // Verify rules exist (either embedded or passed)
    const actualRules = mappingWithRules.rules;
    if (!actualRules || actualRules.length === 0) {
      throw new Error('Mapping has no rules defined. Pass rules parameter or embed them in mapping object.');
    }
    
    // Build ingest request
    const request: IngestRequest = {
      sourceRecord,
      mapping: mappingWithRules,
      transformPipeline: options?.transformPipeline,
      context,
    };
    
    // Run full ingestion pipeline
    const result: IngestResult = await ingest(request);
    
    return {
      success: true,
      preview: result.canonicalRecord,
      report: result.mappingReport,
    };
  } catch (err) {
    // Capture error details
    const error = err instanceof Error ? err : new Error(String(err));
    const errorContext = (err as { context?: Record<string, unknown> })?.context;
    return {
      success: false,
      preview: undefined,
      report: {
        status: 'failed',
        references: {
          snapshotId: sourceRecord.id,
          mappingId: mapping.id,
          transformId: 'transform_unknown',
        },
        ruleExecution: {
          totalRules: 0,
          executedRules: 0,
          skippedRules: 0,
          failedRules: 0,
          fieldsMapped: 0,
          fieldsDropped: 0,
        },
        warnings: [error.message],
        diffSummary: {
          sourceFieldCount: 0,
          canonicalFieldCount: 0,
          fieldsAdded: [],
          fieldsTransformed: 0,
          fieldsDropped: 0,
          enrichmentsApplied: 0,
        },
      },
      error: {
        type: error.name || 'UnknownError',
        message: error.message,
        details: errorContext,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATE MAPPING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate a mapping configuration without executing it.
 * 
 * Performs static analysis of the mapping rules to detect:
 * - Syntax errors
 * - Invalid rule configurations
 * - Missing required fields
 * - Type mismatches
 * - Circular dependencies
 * - Best practice violations
 * 
 * Does NOT execute the mapping or transform any data.
 * 
 * @param mapping - Mapping metadata
 * @param rules - Mapping rules to validate
 * @returns Validation result with diagnostics
 * 
 * @example
 * ```typescript
 * const validation = validateMapping(myMapping, myRules);
 * 
 * if (validation.valid) {
 *   console.log('Mapping is valid!');
 * } else {
 *   console.error('Validation errors:', validation.errors);
 * }
 * 
 * if (validation.warnings.length > 0) {
 *   console.warn('Warnings:', validation.warnings);
 * }
 * ```
 */
export function validateMapping(
  mapping: Mapping,
  rules: MappingDSLRule[]
): ValidationResult {
  const errors: ValidationDiagnostic[] = [];
  const warnings: ValidationDiagnostic[] = [];
  const info: ValidationDiagnostic[] = [];
  
  const ruleIds = new Set<string>();
  const rulesByType: Record<string, number> = {};
  let validRules = 0;
  let invalidRules = 0;
  
  // Validate mapping metadata
  if (!mapping.id || mapping.id.trim() === '') {
    errors.push({
      severity: 'error',
      message: 'Mapping ID is required',
      code: 'MISSING_MAPPING_ID',
    });
  }
  
  if (!mapping.version || mapping.version.trim() === '') {
    errors.push({
      severity: 'error',
      message: 'Mapping version is required',
      code: 'MISSING_MAPPING_VERSION',
    });
  }
  
  if (!mapping.source || mapping.source.trim() === '') {
    errors.push({
      severity: 'error',
      message: 'Mapping source is required',
      code: 'MISSING_MAPPING_SOURCE',
    });
  }
  
  if (!mapping.target || mapping.target.trim() === '') {
    errors.push({
      severity: 'error',
      message: 'Mapping target is required',
      code: 'MISSING_MAPPING_TARGET',
    });
  }
  
  // Validate rules exist
  if (!rules || rules.length === 0) {
    errors.push({
      severity: 'error',
      message: 'Mapping must have at least one rule',
      code: 'NO_RULES',
    });
    
    return {
      valid: false,
      errors,
      warnings,
      info,
      summary: {
        totalRules: 0,
        validRules: 0,
        invalidRules: 0,
        rulesByType: {},
      },
    };
  }
  
  // Validate each rule
  for (const rule of rules) {
    const ruleErrors = validateRule(rule, ruleIds);
    
    if (ruleErrors.length > 0) {
      errors.push(...ruleErrors);
      invalidRules++;
    } else {
      validRules++;
    }
    
    // Count by type
    rulesByType[rule.type] = (rulesByType[rule.type] || 0) + 1;
    
    // Check for best practices
    const ruleWarnings = checkRuleBestPractices(rule);
    warnings.push(...ruleWarnings);
  }
  
  // Try to compile mapping to catch compilation errors
  try {
    compileMappingDSL(mapping, rules);
    info.push({
      severity: 'info',
      message: 'Mapping compiled successfully',
      code: 'COMPILATION_SUCCESS',
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    errors.push({
      severity: 'error',
      message: `Compilation failed: ${error.message}`,
      code: 'COMPILATION_ERROR',
      context: { error: error.message },
    });
  }
  
  // Summary statistics
  info.push({
    severity: 'info',
    message: `Validated ${rules.length} rules (${validRules} valid, ${invalidRules} invalid)`,
    code: 'VALIDATION_COMPLETE',
  });
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    info,
    summary: {
      totalRules: rules.length,
      validRules,
      invalidRules,
      rulesByType,
    },
  };
}

/**
 * Validate a single rule.
 */
function validateRule(rule: MappingDSLRule, existingIds: Set<string>): ValidationDiagnostic[] {
  const errors: ValidationDiagnostic[] = [];
  const ruleId = rule.id; // Store before type narrowing
  
  // Check required base fields
  if (!rule.id || rule.id.trim() === '') {
    errors.push({
      ruleId: rule.id,
      severity: 'error',
      message: 'Rule ID is required',
      code: 'MISSING_RULE_ID',
    });
  } else {
    // Check for duplicate IDs
    if (existingIds.has(rule.id)) {
      errors.push({
        ruleId: rule.id,
        severity: 'error',
        message: `Duplicate rule ID: ${rule.id}`,
        code: 'DUPLICATE_RULE_ID',
      });
    }
    existingIds.add(rule.id);
  }
  
  if (!rule.name || rule.name.trim() === '') {
    errors.push({
      ruleId,
      severity: 'error',
      message: 'Rule name is required',
      code: 'MISSING_RULE_NAME',
    });
  }
  
  if (!rule.type) {
    errors.push({
      ruleId,
      severity: 'error',
      message: 'Rule type is required',
      code: 'MISSING_RULE_TYPE',
    });
  }
  
  // Validate rule-specific fields
  switch (rule.type) {
    case 'SetField':
      if (!rule.toPath) {
        errors.push({
          ruleId,
          severity: 'error',
          message: 'SetField rule missing toPath',
          code: 'MISSING_TO_PATH',
        });
      }
      if (!rule.from) {
        errors.push({
          ruleId,
          severity: 'error',
          message: 'SetField rule missing from',
          code: 'MISSING_FROM',
        });
      }
      break;
      
    case 'MapArray':
      if (!rule.toPath) {
        errors.push({
          ruleId,
          severity: 'error',
          message: 'MapArray rule missing toPath',
          code: 'MISSING_TO_PATH',
        });
      }
      if (!rule.fromMany) {
        errors.push({
          ruleId,
          severity: 'error',
          message: 'MapArray rule missing fromMany',
          code: 'MISSING_FROM_MANY',
        });
      }
      break;
      
    case 'EmitRelationship':
      if (!rule.relationshipType) {
        errors.push({
          ruleId,
          severity: 'error',
          message: 'EmitRelationship rule missing relationshipType',
          code: 'MISSING_RELATIONSHIP_TYPE',
        });
      }
      if (!rule.targetFrom) {
        errors.push({
          ruleId,
          severity: 'error',
          message: 'EmitRelationship rule missing targetFrom',
          code: 'MISSING_TARGET_FROM',
        });
      }
      break;
      
    case 'EmitWarning':
      if (!rule.message) {
        errors.push({
          ruleId,
          severity: 'error',
          message: 'EmitWarning rule missing message',
          code: 'MISSING_MESSAGE',
        });
      }
      if (!rule.whenMissing || rule.whenMissing.length === 0) {
        errors.push({
          ruleId,
          severity: 'error',
          message: 'EmitWarning rule must have whenMissing array',
          code: 'MISSING_WARNING_CONDITION',
        });
      }
      break;
      
    case 'SetExtension':
      if (!rule.namespace) {
        errors.push({
          ruleId,
          severity: 'error',
          message: 'SetExtension rule missing namespace',
          code: 'MISSING_NAMESPACE',
        });
      }
      if (!rule.extensionType) {
        errors.push({
          ruleId,
          severity: 'error',
          message: 'SetExtension rule missing extensionType',
          code: 'MISSING_EXTENSION_TYPE',
        });
      }
      if (!rule.dataFrom) {
        errors.push({
          ruleId,
          severity: 'error',
          message: 'SetExtension rule missing dataFrom',
          code: 'MISSING_DATA_FROM',
        });
      }
      break;
  }
  
  return errors;
}

/**
 * Check for best practice violations.
 */
function checkRuleBestPractices(rule: MappingDSLRule): ValidationDiagnostic[] {
  const warnings: ValidationDiagnostic[] = [];
  
  // Check for overly long rule names
  if (rule.name && rule.name.length > 100) {
    warnings.push({
      ruleId: rule.id,
      severity: 'warning',
      message: 'Rule name is very long (>100 chars)',
      code: 'LONG_RULE_NAME',
    });
  }
  
  // Check for non-descriptive names
  if (rule.name && (rule.name === 'rule' || rule.name === 'mapping' || rule.name === 'test')) {
    warnings.push({
      ruleId: rule.id,
      severity: 'warning',
      message: 'Rule name is not descriptive',
      code: 'NON_DESCRIPTIVE_NAME',
    });
  }
  
  // Check for SetField without fallbacks for optional fields
  if (rule.type === 'SetField') {
    if (!rule.default && (!rule.coalesce || rule.coalesce.length === 0)) {
      const isRequiredField = ['id', 'type', 'label'].includes(rule.toPath);
      if (!isRequiredField) {
        warnings.push({
          ruleId: rule.id,
          severity: 'info',
          message: 'Optional field has no default or fallbacks',
          code: 'NO_FALLBACK',
          context: { field: rule.toPath },
        });
      }
    }
  }
  
  return warnings;
}
