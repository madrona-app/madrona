/**
 * Madrona Mapping Engine v1 — Mapping Rule Model & Compiler
 * 
 * Defines mapping rules and compiles mapping configurations for execution.
 */

import type { Mapping, SourceRecord, CanonicalRecord, Relationship } from '../types/canonical';
import type {
  MappingRule,
  CompiledMapping,
  MappingDSLRule,
  CompilationDiagnostic,
  CompiledDSLRule,
  CompiledExtractor,
  TransformContext,
  JsonValue,
} from './types';
import { MappingValidationError } from './errors';
import { selectOne, selectMany, createSelector } from './selectors';

/**
 * Validate a legacy mapping rule.
 * 
 * @param rule - Rule to validate
 * @returns Validation errors (empty if valid)
 */
export function validateMappingRule(rule: MappingRule): string[] {
  const errors: string[] = [];
  
  if (!rule.id) {
    errors.push('Rule must have an id');
  }
  
  if (!rule.sourcePath) {
    errors.push(`Rule ${rule.id}: sourcePath is required`);
  }
  
  if (!rule.targetPath) {
    errors.push(`Rule ${rule.id}: targetPath is required`);
  }
  
  return errors;
}

/**
 * Validate a DSL mapping rule.
 * 
 * Performs type-specific validation based on rule type.
 * 
 * @param rule - DSL rule to validate
 * @returns Validation errors (empty if valid)
 * 
 * @example
 * ```typescript
 * const rule: SetFieldRule = {
 *   id: 'set_label',
 *   name: 'Set label',
 *   type: 'SetField',
 *   toPath: 'label',
 *   from: 'fields.Title',
 * };
 * 
 * const errors = validateDSLRule(rule);
 * if (errors.length > 0) {
 *   console.error('Validation failed:', errors);
 * }
 * ```
 */
export function validateDSLRule(rule: MappingDSLRule): string[] {
  const errors: string[] = [];
  const ruleId = 'id' in rule ? rule.id : 'unknown';
  
  // Base validation
  if (!('id' in rule) || !rule.id) {
    errors.push('Rule must have an id');
  }
  
  if (!('name' in rule) || !rule.name) {
    errors.push(`Rule ${ruleId}: name is required`);
  }
  
  if (!('type' in rule)) {
    errors.push(`Rule ${ruleId}: type is required`);
    return errors; // Cannot proceed without type
  }
  
  // Type-specific validation
  switch (rule.type) {
    case 'SetField':
      if (!rule.toPath) {
        errors.push(`Rule ${rule.id}: toPath is required for SetField`);
      }
      if (!rule.from) {
        errors.push(`Rule ${rule.id}: from is required for SetField`);
      }
      break;
      
    case 'MapArray':
      if (!rule.toPath) {
        errors.push(`Rule ${rule.id}: toPath is required for MapArray`);
      }
      if (!rule.fromMany) {
        errors.push(`Rule ${rule.id}: fromMany is required for MapArray`);
      }
      // itemTemplate and mapperFn are optional - arrays can be passed through directly
      break;
      
    case 'EmitRelationship':
      if (!rule.relationshipType) {
        errors.push(`Rule ${rule.id}: relationshipType is required for EmitRelationship`);
      }
      if (!rule.targetFrom) {
        errors.push(`Rule ${rule.id}: targetFrom is required for EmitRelationship`);
      }
      break;
      
    case 'EmitWarning':
      if (!rule.whenMissing || rule.whenMissing.length === 0) {
        errors.push(`Rule ${rule.id}: whenMissing is required for EmitWarning`);
      }
      if (!rule.message) {
        errors.push(`Rule ${rule.id}: message is required for EmitWarning`);
      }
      break;
      
    case 'SetExtension':
      if (!rule.namespace) {
        errors.push(`Rule ${rule.id}: namespace is required for SetExtension`);
      }
      if (!rule.extensionType) {
        errors.push(`Rule ${rule.id}: extensionType is required for SetExtension`);
      }
      if (!rule.dataFrom) {
        errors.push(`Rule ${rule.id}: dataFrom is required for SetExtension`);
      }
      break;
  }
  
  return errors;
}

/**
 * Compile a mapping configuration into executable form.
 * 
 * Compiling performs:
 * - Validation of all rules (shapes, required keys)
 * - Pre-parsing of selectors into executable extractors
 * - Optimization of rule dependencies
 * - Generation of apply() method for efficient execution
 * 
 * @param mapping - Mapping configuration metadata
 * @param rules - DSL rules to compile
 * @returns Compiled mapping with diagnostics and apply() method
 * 
 * @example
 * ```typescript
 * const compiled = compileMapping(mapping, dslRules);
 * 
 * if (!compiled.valid) {
 *   console.error('Compilation errors:', compiled.diagnostics);
 *   return;
 * }
 * 
 * // Apply to source record
 * const result = compiled.apply(sourceRecord, context);
 * ```
 */
export function compileMappingDSL(
  mapping: Mapping,
  rules: MappingDSLRule[]
): CompiledMapping {
  const diagnostics: CompilationDiagnostic[] = [];
  const compiledRules: CompiledDSLRule[] = [];
  
  // Validate and compile each rule
  for (const rule of rules) {
    // Track disabled rules but don't validate/compile them
    // They will be marked as 'skipped' during execution
    if (rule.enabled === false) {
      diagnostics.push({
        severity: 'info',
        ruleId: rule.id,
        message: `Rule "${rule.name}" is disabled and will be skipped`,
        code: 'RULE_DISABLED',
      });
      // Add disabled rule to compiledRules with a no-op extractor
      // so it can be tracked in ruleExecutions
      compiledRules.push({
        rule,
        extractor: () => undefined,
      });
      continue;
    }

    // Validate rule structure
    const validationErrors = validateDSLRule(rule);
    if (validationErrors.length > 0) {
      validationErrors.forEach(error => {
        diagnostics.push({
          severity: 'error',
          ruleId: rule.id,
          message: error,
          code: 'VALIDATION_ERROR',
        });
      });
      continue;
    }
    
    // Compile rule based on type
    try {
      const compiled = compileRule(rule, diagnostics);
      compiledRules.push(compiled);
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        ruleId: rule.id,
        message: error instanceof Error ? error.message : String(error),
        code: 'COMPILATION_ERROR',
      });
    }
  }
  
  // Determine execution order
  const executionOrder = compiledRules.map(cr => cr.rule.id);
  
  // Check if compilation succeeded
  const hasErrors = diagnostics.some(d => d.severity === 'error');
  
  // Create apply function
  const apply = createApplyFunction(compiledRules);
  
  return {
    mapping,
    compiledRules,
    executionOrder,
    diagnostics,
    valid: !hasErrors,
    apply,
  };
}

/**
 * Compile a single DSL rule into executable form.
 * 
 * @param rule - DSL rule to compile
 * @param diagnostics - Diagnostic collector
 * @returns Compiled rule with extractors
 */
function compileRule(
  rule: MappingDSLRule,
  diagnostics: CompilationDiagnostic[]
): CompiledDSLRule {
  switch (rule.type) {
    case 'SetField':
      return compileSetFieldRule(rule, diagnostics);

    case 'MapArray':
      return compileMapArrayRule(rule, diagnostics);

    case 'EmitRelationship':
      return compileEmitRelationshipRule(rule, diagnostics);

    case 'EmitWarning':
      return compileEmitWarningRule(rule, diagnostics);

    case 'SetExtension':
      return compileSetExtensionRule(rule, diagnostics);
    
    default:
      throw new Error(`Unknown rule type: ${(rule as any).type}`);
  }
}

/**
 * Compile SetField rule.
 */
function compileSetFieldRule(
  rule: Extract<MappingDSLRule, { type: 'SetField' }>,
  _diagnostics: CompilationDiagnostic[]
): CompiledDSLRule {
  // Pre-compile primary selector
  const selector = createSelector(rule.from);
  const extractor: CompiledExtractor = (source) => selectOne(source, selector);
  
  // Pre-compile fallback selectors
  const fallbackExtractors: CompiledExtractor[] | undefined = rule.coalesce
    ? rule.coalesce.map(path => {
        const sel = createSelector(path);
        return (source: Record<string, any>) => selectOne(source, sel);
      })
    : undefined;
  
  return {
    rule,
    extractor,
    fallbackExtractors,
  };
}

/**
 * Compile MapArray rule.
 */
function compileMapArrayRule(
  rule: Extract<MappingDSLRule, { type: 'MapArray' }>,
  _diagnostics: CompilationDiagnostic[]
): CompiledDSLRule {
  const selector = createSelector(rule.fromMany);
  
  // Array extractor using selectMany
  const arrayExtractor = (source: Record<string, any>) => selectMany(source, selector);
  
  return {
    rule,
    extractor: arrayExtractor,
    arrayExtractor,
  };
}

/**
 * Compile EmitRelationship rule.
 */
function compileEmitRelationshipRule(
  rule: Extract<MappingDSLRule, { type: 'EmitRelationship' }>,
  _diagnostics: CompilationDiagnostic[]
): CompiledDSLRule {
  const targetSelector = createSelector(rule.targetFrom);
  const extractor: CompiledExtractor = (source) => selectOne(source, targetSelector);
  
  // Pre-compile optional context selectors
  const fallbackExtractors: CompiledExtractor[] = [];
  
  if (rule.roleFrom) {
    const sel = createSelector(rule.roleFrom);
    fallbackExtractors.push((source) => selectOne(source, sel));
  }
  
  if (rule.whenFrom) {
    const sel = createSelector(rule.whenFrom);
    fallbackExtractors.push((source) => selectOne(source, sel));
  }
  
  if (rule.whereFrom) {
    const sel = createSelector(rule.whereFrom);
    fallbackExtractors.push((source) => selectOne(source, sel));
  }
  
  return {
    rule,
    extractor,
    fallbackExtractors: fallbackExtractors.length > 0 ? fallbackExtractors : undefined,
  };
}

/**
 * Compile EmitWarning rule.
 */
function compileEmitWarningRule(
  rule: Extract<MappingDSLRule, { type: 'EmitWarning' }>,
  _diagnostics: CompilationDiagnostic[]
): CompiledDSLRule {
  // Pre-compile all check selectors
  const fallbackExtractors = rule.whenMissing.map(path => {
    const sel = createSelector(path);
    return (source: Record<string, any>) => selectOne(source, sel);
  });
  
  // Primary extractor checks if all are missing
  const extractor: CompiledExtractor = (source) => {
    const allMissing = fallbackExtractors.every(
      extract => extract(source) === undefined || extract(source) === null
    );
    return allMissing ? true : undefined;
  };
  
  return {
    rule,
    extractor,
    fallbackExtractors,
  };
}

/**
 * Compile SetExtension rule.
 */
function compileSetExtensionRule(
  rule: Extract<MappingDSLRule, { type: 'SetExtension' }>,
  _diagnostics: CompilationDiagnostic[]
): CompiledDSLRule {
  const selector = createSelector(rule.dataFrom);
  const extractor: CompiledExtractor = (source) => selectOne(source, selector);
  
  return {
    rule,
    extractor,
  };
}

/**
 * Create apply function for compiled mapping.
 * 
 * Returns a function that executes all compiled rules against a source record.
 */
function createApplyFunction(
  compiledRules: CompiledDSLRule[]
): (sourceRecord: SourceRecord, context: TransformContext) => Partial<CanonicalRecord> {
  return (sourceRecord, context) => {
    const result: Partial<CanonicalRecord> = {};
    const source = sourceRecord.raw;
    
    for (const compiled of compiledRules) {
      const { rule, extractor, fallbackExtractors, arrayExtractor } = compiled;
      
      try {
        switch (rule.type) {
          case 'SetField': {
            // Try primary extractor
            let value = extractor(source);
            
            // Try fallbacks if primary failed
            if ((value === undefined || value === null) && fallbackExtractors) {
              for (const fallback of fallbackExtractors) {
                value = fallback(source);
                if (value !== undefined && value !== null) {
                  break;
                }
              }
            }
            
            // Use default if all failed
            if ((value === undefined || value === null) && 'default' in rule) {
              value = rule.default;
            }
            
            // Set value in result
            if (value !== undefined) {
              setNestedValue(result, rule.toPath, value);
            }
            break;
          }
          
          case 'MapArray': {
            if (arrayExtractor) {
              const items = arrayExtractor(source);
              
              // Apply template to each item
              if (rule.itemTemplate && items.length > 0) {
                const mapped = items.map((item, index) => {
                  return applyTemplate(rule.itemTemplate!, item, index, source);
                });
                setNestedValue(result, rule.toPath, mapped);
              } else {
                setNestedValue(result, rule.toPath, items);
              }
            }
            break;
          }
          
          case 'EmitRelationship': {
            const targetId = extractor(source);

            if (targetId !== undefined && targetId !== null) {
              const relationship: Relationship = {
                type: rule.relationshipType,
                target: String(targetId),
              };

              // Add optional role from fallback extractor
              if (fallbackExtractors && fallbackExtractors[0]) {
                const role = fallbackExtractors[0](source);
                if (role !== undefined) relationship.role = String(role);
              }

              // Add to relationships array
              if (!result.relationships) {
                result.relationships = [];
              }
              result.relationships.push(relationship);
            }
            break;
          }
          
          case 'EmitWarning': {
            const shouldWarn = extractor(source);
            
            if (shouldWarn) {
              context.warnings.push(rule.message);
            }
            break;
          }
          
          case 'SetExtension': {
            const data = extractor(source);
            
            if (data !== undefined && data !== null) {
              if (!result.extensions) {
                result.extensions = [];
              }
              
              result.extensions.push({
                namespace: rule.namespace,
                type: rule.extensionType,
                data: data as Record<string, any>,
              });
            }
            break;
          }
        }
      } catch (error) {
        context.warnings.push(
          `Rule "${rule.name}" failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    
    return result;
  };
}

/**
 * Set a nested value in an object using dot notation.
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Apply item template with placeholder substitution.
 */
function applyTemplate(
  template: Record<string, unknown>,
  item: unknown,
  index: number,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(template)) {
    if (typeof value === 'string') {
      // Replace {{item}} with current item
      let replaced = value.replace(/\{\{item\}\}/g, String(item));

      // Replace {{index}} with current index
      replaced = replaced.replace(/\{\{index\}\}/g, String(index));

      // Replace {{parent.path}} with source values
      const parentMatch = replaced.match(/\{\{parent\.([^}]+)\}\}/g);
      if (parentMatch) {
        for (const match of parentMatch) {
          const path = match.replace(/\{\{parent\.|}\}/g, '');
          const parentValue = selectOne(source, path);
          if (parentValue !== undefined) {
            replaced = replaced.replace(match, String(parentValue));
          }
        }
      }

      result[key] = replaced;
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Compile a legacy mapping configuration (deprecated).
 * 
 * @deprecated Use compileMappingDSL with MappingDSLRule[] instead
 */
export function compileMapping(
  mapping: Mapping,
  rules: MappingRule[]
): Omit<CompiledMapping, 'apply' | 'compiledRules'> & { rules: MappingRule[] } {
  // Validate all rules
  const allErrors: string[] = [];
  
  for (const rule of rules) {
    const ruleErrors = validateMappingRule(rule);
    allErrors.push(...ruleErrors);
  }
  
  if (allErrors.length > 0) {
    throw new MappingValidationError(allErrors, { mapping, rules });
  }
  
  // Filter out disabled rules
  const enabledRules = rules.filter(rule => !rule.disabled);
  
  // Determine execution order
  const executionOrder = enabledRules.map(rule => rule.id);
  
  const diagnostics: CompilationDiagnostic[] = [];
  if (enabledRules.length < rules.length) {
    diagnostics.push({
      severity: 'info',
      message: `${rules.length - enabledRules.length} rule(s) disabled`,
    });
  }
  
  return {
    mapping,
    rules: enabledRules,
    executionOrder,
    diagnostics,
    valid: true,
  };
}

/**
 * Create a simple mapping rule.
 * 
 * Helper for programmatically building mapping rules.
 * 
 * @param config - Rule configuration
 * @returns Mapping rule
 * 
 * @example
 * ```typescript
 * const rule = createMappingRule({
 *   id: "title_to_label",
 *   sourcePath: "fields.Title",
 *   targetPath: "label",
 *   required: true
 * });
 * ```
 */
export function createMappingRule(config: {
  id: string;
  sourcePath: string;
  targetPath: string;
  transform?: string;
  defaultValue?: JsonValue;
  required?: boolean;
}): MappingRule {
  return {
    id: config.id,
    sourcePath: config.sourcePath,
    targetPath: config.targetPath,
    transform: config.transform,
    defaultValue: config.defaultValue,
    required: config.required,
    disabled: false,
  };
}

/**
 * Example mapping rules for common transformations.
 */
export const EXAMPLE_MAPPING_RULES: MappingRule[] = [
  {
    id: 'extract_id',
    sourcePath: 'object_id',
    targetPath: 'id',
    transform: 'formatCanonicalId',
    required: true,
  },
  {
    id: 'extract_title',
    sourcePath: 'title',
    targetPath: 'label',
    required: true,
  },
  {
    id: 'extract_description',
    sourcePath: 'description',
    targetPath: 'description',
  },
  {
    id: 'extract_creator',
    sourcePath: 'artist_name',
    targetPath: 'properties.creator',
  },
  {
    id: 'extract_creation_date',
    sourcePath: 'date_created',
    targetPath: 'dates.created',
    transform: 'normalizeDate',
  },
  {
    id: 'extract_medium',
    sourcePath: 'medium',
    targetPath: 'properties.medium',
  },
  {
    id: 'extract_dimensions',
    sourcePath: 'dimensions_cm',
    targetPath: 'properties.dimensions',
    transform: 'formatDimensions',
  },
  {
    id: 'extract_accession_number',
    sourcePath: 'accession_number',
    targetPath: 'identifiers',
    transform: 'createIdentifier',
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// EXAMPLE DSL RULES (Declarative Mapping)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Example DSL mapping rules demonstrating all rule types.
 * 
 * These rules show how to use the declarative mapping DSL for common
 * transformation patterns in museum/GLAM contexts.
 */
export const EXAMPLE_DSL_RULES: import('./types').MappingDSLRule[] = [
  // Scalar field mapping with fallbacks
  {
    id: 'set_label',
    name: 'Set artwork label',
    type: 'SetField',
    toPath: 'label',
    from: 'fields.Title',
    coalesce: ['fields.ObjectName', 'fields.DisplayName'],
    default: 'Untitled',
    enabled: true,
  },
  
  // Scalar field with transform
  {
    id: 'set_description',
    name: 'Set artwork description',
    type: 'SetField',
    toPath: 'description',
    from: 'fields.Description',
    transform: 'trim',
    enabled: true,
  },
  
  // Nested property
  {
    id: 'set_medium',
    name: 'Set medium property',
    type: 'SetField',
    toPath: 'properties.medium',
    from: 'fields.Medium',
    transform: 'trim',
    enabled: true,
  },
  
  // Array mapping with template
  {
    id: 'map_identifiers',
    name: 'Map identifier array',
    type: 'MapArray',
    toPath: 'identifiers',
    fromMany: 'fields.AccessionNumbers',
    itemTemplate: {
      type: 'accession_number',
      value: '{{item}}',
      system: 'tms',
    },
    enabled: true,
  },
  
  // Classifications array
  {
    id: 'map_classifications',
    name: 'Map classification array',
    type: 'MapArray',
    toPath: 'classifications',
    fromMany: 'fields.ObjectTypes',
    itemTemplate: {
      type: 'object_type',
      value: '{{item}}',
      scheme: 'aat',
    },
    enabled: true,
  },
  
  // Relationship with all contexts
  {
    id: 'emit_creator_relationship',
    name: 'Emit creator relationship',
    type: 'EmitRelationship',
    relationshipType: 'created_by',
    targetFrom: 'fields.ArtistID',
    roleFrom: 'fields.ArtistRole',
    whenFrom: 'fields.CreationDate',
    whereFrom: 'fields.CreationLocation',
    condition: '{{targetFrom}} !== null',
    enabled: true,
  },
  
  // Simple relationship
  {
    id: 'emit_collection_relationship',
    name: 'Emit collection membership',
    type: 'EmitRelationship',
    relationshipType: 'part_of',
    targetFrom: 'fields.CollectionID',
    enabled: true,
  },
  
  // Warning for missing required field
  {
    id: 'warn_missing_label',
    name: 'Warn if label is missing',
    type: 'EmitWarning',
    whenMissing: ['fields.Title', 'fields.ObjectName'],
    message: 'No label found in Title or ObjectName fields',
    severity: 'error',
    enabled: true,
  },
  
  // Warning for data quality
  {
    id: 'warn_missing_identifier',
    name: 'Warn if identifier is missing',
    type: 'EmitWarning',
    whenMissing: ['fields.AccessionNumber'],
    message: 'Missing accession number - record may not be uniquely identifiable',
    severity: 'warning',
    enabled: true,
  },
  
  // Extension for domain-specific data
  {
    id: 'set_tms_extension',
    name: 'Set TMS conservation metadata',
    type: 'SetExtension',
    namespace: 'org.tms',
    extensionType: 'conservation_status',
    dataFrom: 'fields.ConservationData',
    enabled: true,
  },
  
  // Extension for custom metadata
  {
    id: 'set_exhibition_extension',
    name: 'Set exhibition history',
    type: 'SetExtension',
    namespace: 'org.museum',
    extensionType: 'exhibition_history',
    dataFrom: 'fields.ExhibitionHistory',
    transform: 'parseJSON',
    enabled: true,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE SELECTOR USAGE EXAMPLES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Example DSL rules demonstrating SourceSelector integration.
 * 
 * These examples show how to use different selector types in DSL rules:
 * - Simple string paths (converted to path selectors)
 * - JSONPath expressions (detected by $ prefix)
 * - Template strings (detected by {{...}} syntax)
 * - Explicit selector objects
 * 
 * The mapping engine automatically uses selectOne() and selectMany()
 * with safe failure behavior (returns undefined/[] instead of throwing).
 */
export const SELECTOR_USAGE_EXAMPLES: import('./types').MappingDSLRule[] = [
  // Simple path selector (string shorthand)
  {
    id: 'simple_path',
    name: 'Simple path extraction',
    type: 'SetField',
    toPath: 'label',
    from: 'fields.Title',  // → selectOne(source, 'fields.Title')
    enabled: true,
  },
  
  // JSONPath selector (auto-detected by $ prefix)
  {
    id: 'jsonpath_selector',
    name: 'JSONPath extraction',
    type: 'SetField',
    toPath: 'description',
    from: '$.data.artwork.description',  // → selectOne(source, { type: 'jsonpath', expression: '...' })
    enabled: true,
  },
  
  // Template selector (auto-detected by {{...}})
  {
    id: 'template_selector',
    name: 'Template interpolation',
    type: 'SetField',
    toPath: 'properties.display_name',
    from: '{{fields.Title}} by {{fields.Artist}} ({{fields.Year}})',
    enabled: true,
  },
  
  // Array selector with JSONPath wildcard
  {
    id: 'array_wildcard',
    name: 'Extract all IDs from array',
    type: 'MapArray',
    toPath: 'identifiers',
    fromMany: '$.items[*].id',  // → selectMany(source, '$.items[*].id')
    itemTemplate: {
      type: 'identifier',
      value: '{{item}}',
    },
    enabled: true,
  },
  
  // Fallback paths using coalesce
  {
    id: 'coalesce_selector',
    name: 'Fallback value extraction',
    type: 'SetField',
    toPath: 'label',
    from: 'fields.Title',
    coalesce: [
      'fields.ObjectName',        // Try these in order
      'fields.DisplayName',
      '$.data.name',
    ],
    default: 'Untitled',           // Final fallback
    enabled: true,
  },
];
