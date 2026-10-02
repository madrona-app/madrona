/**
 * Madrona Mapping Engine v1 — Main Entry Points
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MINIMAL MAPPING PROBLEM
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * The mapping engine solves a focused transformation problem:
 * 
 * 1. INPUT: SourceRecord (immutable raw snapshot from external system)
 *    OUTPUT: CanonicalRecord (normalized, schema-compliant entity)
 * 
 * 2. TRANSFORMATION: Apply Mapping rules to extract/transform source fields
 *    ENRICHMENT: Optionally apply TransformPipeline to normalize values
 * 
 * 3. REPORTING: Produce MappingReport describing:
 *    - Rules applied/skipped/failed
 *    - Warnings/errors encountered
 *    - Field-level statistics (mapped, dropped, enriched)
 * 
 * 4. PROJECTIONS: Support destination-specific output formats:
 *    - Source mode: Return raw SourceRecord payload
 *    - Destination mode: Return transformed CanonicalRecord payload
 *    - Apply destination Mapping for format-specific transformations
 * 
 * 5. DETERMINISM: Given snapshotId + mappingId + transformId:
 *    - Same inputs → same canonical output
 *    - Reproducible transformations for audit/debugging
 * 
 * 6. NO LINEAGE: Does NOT track per-field provenance or transformation chains
 *    - MappingReport provides aggregate statistics only
 *    - Individual field transformations not traced
 *    - Simplifies implementation and reduces storage overhead
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Primary API for ingesting source records and projecting transformations.
 */

import type {
  SourceRecord,
  Mapping,
  CanonicalRecord,
  TransformPipeline,
} from '../types/canonical';
import type {
  CompiledMapping,
  EngineContext,
  IngestRequest,
  IngestResult,
  MappingDSLRule,
  ProjectRequest,
  ProjectResult,
  SafetyLimits,
  JsonValue,
} from './types';
import { DEFAULT_SAFETY_LIMITS } from './types';
import { compileMappingDSL } from './mapping';
import { MappingReportBuilder } from './report';
import { 
  MappingCompileError, 
  MappingApplyError, 
  CanonicalInvariantError 
} from './errors';
import { setPath, appendPath } from './builder';
import { runTransformPipeline } from './transforms';
import { hashProvenance, hashProjection } from './hash';

// ═══════════════════════════════════════════════════════════════════════════
// COMPILATION CACHE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simple LRU cache for compiled mappings.
 * 
 * Caches compiled mappings by key: `${mappingId}:${version}`
 * Prevents recompilation of the same mapping configuration.
 */
class CompilationCache {
  private cache: Map<string, CompiledMapping>;
  private maxSize: number;
  
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }
  
  get(key: string): CompiledMapping | undefined {
    const value = this.cache.get(key);
    if (value) {
      // Move to end (LRU)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }
  
  set(key: string, value: CompiledMapping): void {
    // Remove if exists (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    
    this.cache.set(key, value);
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  size(): number {
    return this.cache.size;
  }
}

// Global compilation cache instance
const compilationCache = new CompilationCache(100);

/**
 * Get cache key for a mapping configuration.
 * 
 * @param mappingId - Mapping identifier
 * @param version - Optional version string
 * @returns Cache key
 */
function getCacheKey(mappingId: string, version?: string): string {
  return version ? `${mappingId}:${version}` : mappingId;
}

// ═══════════════════════════════════════════════════════════════════════════
// INGEST ENTRYPOINT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ingest a source record and produce a canonical record.
 * 
 * This is the primary entrypoint for the mapping engine. It:
 * 1. Compiles the mapping (with caching by mappingId+version)
 * 2. Applies mapping to build canonical draft + report
 * 3. Runs transform pipeline if provided
 * 4. Finalizes canonical record invariants
 * 5. Returns canonical record + MappingReport
 * 
 * @param request - Ingest request containing source record, mapping, and context
 * @returns Ingest result with canonical record and mapping report
 * @throws {MappingCompileError} If mapping compilation fails
 * @throws {MappingApplyError} If mapping application fails
 * @throws {CanonicalInvariantError} If canonical invariants are violated
 * 
 * @example
 * ```typescript
 * const result = await ingest({
 *   sourceRecord: snapshot,
 *   mapping: mappingConfig,
 *   transformPipeline: enrichmentPipeline,
 *   context: {
 *     pipelineId: 'route_tms_sync',
 *     now: new Date().toISOString(),
 *   },
 * });
 * 
 * console.log('Canonical:', result.canonicalRecord);
 * console.log('Report:', result.mappingReport);
 * ```
 */
export async function ingest(request: IngestRequest): Promise<IngestResult> {
  const { sourceRecord, mapping, transformPipeline, context } = request;
  
  // Initialize report builder
  const reportBuilder = new MappingReportBuilder();
  reportBuilder
    .setReferences(
      context.pipelineId,
      sourceRecord.id,
      mapping.id,
      transformPipeline?.id || 'none'
    )
    .startTiming();
  
  try {
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Compile mapping (with caching)
    // ═══════════════════════════════════════════════════════════════════════
    
    reportBuilder.startPhase('compile');
    
    const cacheKey = getCacheKey(mapping.id, mapping.version);
    let compiled = compilationCache.get(cacheKey);
    
    if (!compiled) {
      try {
        // Mapping object is assumed to contain DSL rules as a property
        // or they should be passed in the request. For now, we'll try to
        // extract from mapping metadata or require them in request
        const rules = (mapping as any).rules as MappingDSLRule[];
        if (!rules || rules.length === 0) {
          throw new MappingCompileError(
            mapping.id,
            'Mapping has no rules defined',
            { mapping }
          );
        }
        
        compiled = compileMappingDSL(mapping, rules);
        compilationCache.set(cacheKey, compiled);
      } catch (error) {
        if (error instanceof MappingCompileError) {
          throw error;
        }
        throw new MappingCompileError(
          mapping.id,
          error instanceof Error ? error.message : String(error),
          { mapping, error }
        );
      }
    }
    
    reportBuilder.endPhase();
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Apply mapping to source record
    // ═══════════════════════════════════════════════════════════════════════
    
    reportBuilder.startPhase('apply');
    
    let applyResult: ApplyMappingResult;
    try {
      applyResult = applyMappingToCanonical(sourceRecord, compiled, context);
    } catch (error) {
      throw new MappingApplyError(
        mapping.id,
        sourceRecord.id,
        error instanceof Error ? error.message : String(error),
        { sourceRecord, mapping, error }
      );
    }
    
    // Add rule execution stats to report
    for (const ruleExec of applyResult.reportDraft.ruleExecutions) {
      reportBuilder.addRuleStats({
        ruleId: ruleExec.ruleId,
        status: ruleExec.status,
        outputs: ruleExec.outputCount || 0,
        reason: ruleExec.reason,
      });
    }
    
    // Add warnings from mapping application
    reportBuilder.addWarnings(applyResult.reportDraft.totalWarnings);
    
    reportBuilder.endPhase();
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Run transform pipeline (if provided)
    // ═══════════════════════════════════════════════════════════════════════
    
    let canonicalDraft = applyResult.canonicalDraft;
    
    if (transformPipeline && transformPipeline.steps && transformPipeline.steps.length > 0) {
      reportBuilder.startPhase('transform');
      
      try {
        const transformContext = {
          sourceRecord,
          mapping,
          canonicalRecord: canonicalDraft,
          warnings: [] as string[],
          ruleStats: {
            totalRules: compiled.compiledRules.length,
            executedRules: 0,
            skippedRules: 0,
            failedRules: 0,
          },
        };
        
        const transformResult = runTransformPipeline(
          canonicalDraft,
          transformPipeline,
          transformContext
        );
        
        canonicalDraft = transformResult.record;
        
        if (transformResult.warnings && transformResult.warnings.length > 0) {
          reportBuilder.addWarnings(transformResult.warnings);
        }
      } catch (error) {
        const warning = `Transform pipeline failed: ${
          error instanceof Error ? error.message : String(error)
        }`;
        reportBuilder.addWarning(warning);
      }
      
      reportBuilder.endPhase();
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Finalize canonical record (enforce invariants)
    // ═══════════════════════════════════════════════════════════════════════
    
    reportBuilder.startPhase('finalize');
    
    const finalizationResult = await finalizeCanonicalRecord(
      canonicalDraft,
      sourceRecord,
      mapping,
      transformPipeline,
      context,
      request.safetyLimits
    );
    
    if (!finalizationResult.success) {
      throw new CanonicalInvariantError(finalizationResult.errors, {
        canonicalDraft,
        sourceRecord,
        mapping,
      });
    }
    
    // Add safety warnings to report
    if (finalizationResult.warnings.length > 0) {
      reportBuilder.addWarnings(finalizationResult.warnings);
    }
    
    const canonicalRecord = finalizationResult.canonicalRecord!;

    
    reportBuilder.endPhase();
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: Build final report
    // ═══════════════════════════════════════════════════════════════════════
    
    reportBuilder.endTiming();
    
    // Set diff summary
    const sourceFieldCount = Object.keys(sourceRecord.raw || {}).length;
    const canonicalFieldCount = [
      canonicalRecord.label,
      canonicalRecord.description,
      canonicalRecord.identifiers,
      canonicalRecord.classifications,
      canonicalRecord.relationships,
      canonicalRecord.dates,
      canonicalRecord.properties,
      canonicalRecord.extensions,
    ].filter(field => field !== undefined && field !== null).length;
    
    reportBuilder.setDiffSummary({
      sourceFieldCount,
      canonicalFieldCount,
      fieldsTransformed: applyResult.reportDraft.totalOutputs,
    });
    
    // Determine status and finalize
    reportBuilder.determineStatus();
    const mappingReport = reportBuilder.finalize();
    
    return {
      canonicalRecord,
      mappingReport,
    };
    
  } catch (error) {
    // Build error report
    reportBuilder.endTiming();
    reportBuilder.setStatus('failed');
    
    if (error instanceof MappingCompileError ||
        error instanceof MappingApplyError ||
        error instanceof CanonicalInvariantError) {
      reportBuilder.addWarning({
        code: error.code,
        message: error.message,
        severity: 'error',
      });
    } else {
      reportBuilder.addWarning({
        code: 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : String(error),
        severity: 'error',
      });
    }
    
    // Re-throw the error
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CANONICAL RECORD FINALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Valid canonical record types.
 */
const VALID_CANONICAL_TYPES = new Set([
  'Object',
  'Work',
  'Agent',
  'Place',
  'Event',
  'Media',
]);

/**
 * Result of finalization with either success or failure.
 */
interface FinalizationResult {
  success: boolean;
  canonicalRecord?: CanonicalRecord;
  errors: string[];
  warnings: string[];
}

/**
 * Finalize a canonical record draft by enforcing all required invariants.
 * 
 * This function:
 * 1. Ensures required fields exist: id, type, label, provenance, meta
 * 2. Fills provenance fields: source descriptor, sourceRecordId, snapshotId,
 *    mappingId, transformId, pipelineId, ingestedAt, hash
 * 3. Fills meta fields: schemaVersion, createdAt/updatedAt
 * 4. Validates type against CanonicalRecordType union
 * 5. Returns CanonicalRecord or error list
 * 
 * If invariants fail, returns errors for inclusion in MappingReport.
 * 
 * @param canonicalDraft - Partial canonical record from rule execution
 * @param sourceRecord - Original source record
 * @param mapping - Mapping configuration used
 * @param transformPipeline - Optional transform pipeline (not yet implemented)
 * @param context - Engine context for provenance
 * @returns Finalization result with canonical record or errors
 * 
 * @example
 * ```typescript
 * const result = finalizeCanonicalRecord(
 *   canonicalDraft,
 *   sourceRecord,
 *   mapping,
 *   undefined,
 *   context
 * );
 * 
 * if (result.success) {
 *   console.log('Canonical record:', result.canonicalRecord);
 * } else {
 *   console.error('Invariant failures:', result.errors);
 * }
 * ```
 */
export async function finalizeCanonicalRecord(
  canonicalDraft: Partial<CanonicalRecord>,
  sourceRecord: SourceRecord,
  mapping: Mapping,
  transformPipeline: TransformPipeline | undefined,
  context: EngineContext,
  safetyLimits?: SafetyLimits
): Promise<FinalizationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Apply default safety limits
  const limits = {
    maxLabelLength: safetyLimits?.maxLabelLength ?? DEFAULT_SAFETY_LIMITS.maxLabelLength,
    maxDescriptionLength: safetyLimits?.maxDescriptionLength ?? DEFAULT_SAFETY_LIMITS.maxDescriptionLength,
    maxRelationships: safetyLimits?.maxRelationships ?? DEFAULT_SAFETY_LIMITS.maxRelationships,
    maxMediaCount: safetyLimits?.maxMediaCount ?? DEFAULT_SAFETY_LIMITS.maxMediaCount,
    maxExtensionSizeBytes: safetyLimits?.maxExtensionSizeBytes ?? DEFAULT_SAFETY_LIMITS.maxExtensionSizeBytes,
  };
  
  // 1. Validate required fields
  if (!canonicalDraft.id) {
    errors.push('INVARIANT ERROR: Required field "id" is missing');
  }
  
  if (!canonicalDraft.type) {
    errors.push('INVARIANT ERROR: Required field "type" is missing');
  } else if (!VALID_CANONICAL_TYPES.has(canonicalDraft.type)) {
    errors.push(
      `INVARIANT ERROR: Invalid type "${canonicalDraft.type}". ` +
      `Valid types: ${Array.from(VALID_CANONICAL_TYPES).join(', ')}`
    );
  }
  
  if (!canonicalDraft.label) {
    errors.push('INVARIANT ERROR: Required field "label" is missing');
  }
  
  // If critical fields are missing, fail early
  if (errors.length > 0) {
    return { success: false, errors, warnings: [] };
  }
  
  // 2. Fill provenance fields
  const now = context.now || new Date().toISOString();
  
  // Compute hash for reproducibility (deterministic, excludes timestamps)
  const hash = await hashProvenance(
    sourceRecord.id,
    mapping.id,
    transformPipeline?.id || 'none'
  );
  
  const provenance = {
    // Source descriptor
    system: sourceRecord.source.system,
    dataset: sourceRecord.source.dataset,
    recordId: sourceRecord.source.recordId,
    
    // Traceability
    sourceRecordId: sourceRecord.source.recordId,
    snapshotId: sourceRecord.id,
    mappingId: mapping.id,
    transformId: transformPipeline?.id || 'none',
    pipelineId: context.pipelineId,
    
    // Timestamps
    ingestedAt: now,
    
    // Hash for determinism
    hash,
  };
  
  // 3. Fill meta fields
  const meta = {
    schemaVersion: '1.0.0', // Current canonical schema version
    createdAt: now,
    updatedAt: now,
  };
  
  // 4. Apply safety limits and truncate where needed
  let label = canonicalDraft.label!;
  let description = canonicalDraft.description;
  let relationships = canonicalDraft.relationships;
  let extensions = canonicalDraft.extensions;
  
  // Truncate label if too long
  if (label.length > limits.maxLabelLength) {
    const truncated = label.substring(0, limits.maxLabelLength - 3) + '...';
    warnings.push(
      `SAFETY: Label truncated from ${label.length} to ${limits.maxLabelLength} characters`
    );
    label = truncated;
  }
  
  // Truncate description if too long
  if (description && description.length > limits.maxDescriptionLength) {
    const truncated = description.substring(0, limits.maxDescriptionLength - 3) + '...';
    warnings.push(
      `SAFETY: Description truncated from ${description.length} to ${limits.maxDescriptionLength} characters`
    );
    description = truncated;
  }
  
  // Limit relationships count
  if (relationships && relationships.length > limits.maxRelationships) {
    const originalCount = relationships.length;
    relationships = relationships.slice(0, limits.maxRelationships);
    warnings.push(
      `SAFETY: Relationships truncated from ${originalCount} to ${limits.maxRelationships} items`
    );
  }
  
  // Check extensions size
  if (extensions) {
    const extensionsJson = JSON.stringify(extensions);
    const extensionsSizeBytes = new TextEncoder().encode(extensionsJson).length;
    
    if (extensionsSizeBytes > limits.maxExtensionSizeBytes) {
      warnings.push(
        `SAFETY: Extensions object (${extensionsSizeBytes} bytes) exceeds limit (${limits.maxExtensionSizeBytes} bytes), dropped`
      );
      extensions = undefined;
    }
  }
  
  // 5. Construct complete canonical record
  const canonicalRecord: CanonicalRecord = {
    // Required fields (already validated)
    id: canonicalDraft.id!,
    type: canonicalDraft.type as any, // Already validated against union
    label,
    
    // System-managed fields
    provenance,
    meta,
    
    // Optional fields from draft (with safety limits applied)
    description,
    properties: canonicalDraft.properties,
    identifiers: canonicalDraft.identifiers,
    classifications: canonicalDraft.classifications,
    relationships,
    dates: canonicalDraft.dates,
    extensions,
  };
  
  return {
    success: true,
    canonicalRecord,
    errors: [],
    warnings,
  };
}

/**
 * Rule execution tracking for diagnostic reporting.
 */
interface RuleExecutionInfo {
  ruleId: string;
  ruleType: string;
  status: 'applied' | 'skipped' | 'failed';
  reason?: string;
  outputCount?: number;
  warnings: string[];
}

/**
 * Result of applying mapping to source record.
 */
interface ApplyMappingResult {
  canonicalDraft: Partial<CanonicalRecord>;
  reportDraft: {
    ruleExecutions: RuleExecutionInfo[];
    totalOutputs: number;
    totalWarnings: string[];
  };
}

/**
 * Apply a compiled mapping to a source record to produce a canonical record.
 * 
 * This is the core runtime function that:
 * 1. Creates a CanonicalRecord skeleton with id/type/label placeholders
 * 2. Applies rules in order
 * 3. Collects rule execution info for MappingReport:
 *    - applied/skipped/failed per rule
 *    - outputs count
 *    - warning messages
 * 4. Returns { canonicalDraft, reportDraft }
 * 
 * SKIP RULES:
 * - If source selector yields undefined and no default, skip (not fail)
 * - This is a soft failure - rule is marked as skipped
 * 
 * VALIDATION:
 * - If required target fields (id/type) missing at end, fail the ingest
 * - This is a hard failure - entire transformation fails
 * 
 * @param sourceRecord - Source record to transform
 * @param compiledMapping - Pre-compiled mapping with DSL rules
 * @param context - Engine context for provenance
 * @returns Canonical draft and execution report
 * 
 * @example
 * ```typescript
 * const compiled = compileMappingDSL(rules);
 * const result = applyMappingToCanonical(sourceRecord, compiled, context);
 * 
 * console.log('Canonical:', result.canonicalDraft);
 * console.log('Report:', result.reportDraft);
 * ```
 */
export function applyMappingToCanonical(
  sourceRecord: SourceRecord,
  compiledMapping: CompiledMapping,
  _context: EngineContext
): ApplyMappingResult {
  // Create canonical record skeleton with placeholders
  const canonicalDraft: Partial<CanonicalRecord> = {
    id: undefined,  // Will be set by rules or fail
    type: 'Object', // Default type, can be overridden
    label: undefined, // Will be set by rules or fail
  };
  
  const ruleExecutions: RuleExecutionInfo[] = [];
  const totalWarnings: string[] = [];
  let totalOutputs = 0;
  
  // Execute each compiled rule in order
  for (const compiledRule of compiledMapping.compiledRules) {
    const rule = compiledRule.rule;
    const ruleId = rule.id || `${rule.type}_${ruleExecutions.length}`;
    
    const executionInfo: RuleExecutionInfo = {
      ruleId,
      ruleType: rule.type,
      status: 'applied',
      warnings: [],
    };
    
    try {
      // Skip disabled rules
      if (rule.enabled === false) {
        executionInfo.status = 'skipped';
        executionInfo.reason = 'Rule disabled';
        ruleExecutions.push(executionInfo);
        continue;
      }
      
      // Execute rule based on type
      if (rule.type === 'SetField') {
        const value = compiledRule.extractor(sourceRecord.raw);
        
        if (value === undefined) {
          // Check for fallback
          if (compiledRule.fallbackExtractors && compiledRule.fallbackExtractors.length > 0) {
            let fallbackValue: JsonValue | undefined = undefined;
            for (const fallbackExtractor of compiledRule.fallbackExtractors) {
              fallbackValue = fallbackExtractor(sourceRecord.raw as Record<string, unknown>);
              if (fallbackValue !== undefined) break;
            }
            if (fallbackValue !== undefined) {
              setPath(canonicalDraft, rule.toPath, fallbackValue, { force: true });
              totalOutputs++;
            } else if ('default' in rule && rule.default !== undefined) {
              setPath(canonicalDraft, rule.toPath, rule.default, { force: true });
              totalOutputs++;
            } else {
              executionInfo.status = 'skipped';
              executionInfo.reason = 'Source value undefined, no fallback or default';
            }
          } else if ('default' in rule && rule.default !== undefined) {
            setPath(canonicalDraft, rule.toPath, rule.default, { force: true });
            totalOutputs++;
          } else {
            executionInfo.status = 'skipped';
            executionInfo.reason = 'Source value undefined, no default';
          }
        } else {
          // Apply transform if present
          const finalValue = compiledRule.transformFn
            ? compiledRule.transformFn(value, {
                sourceRecord,
                canonicalRecord: canonicalDraft,
                warnings: totalWarnings,
                ruleStats: {
                  totalRules: compiledMapping.compiledRules.length,
                  executedRules: ruleExecutions.filter(r => r.status === 'applied').length,
                  skippedRules: ruleExecutions.filter(r => r.status === 'skipped').length,
                  failedRules: ruleExecutions.filter(r => r.status === 'failed').length,
                },
              })
            : value;

          // Use force: true only for user-settable reserved keys (id, type, label)
          // System-managed keys (provenance, meta) should never be set by mapping rules
          const userSettableReservedKeys = ['id', 'type', 'label'];
          const topLevelKey = rule.toPath.split('.')[0];
          const forceWrite = userSettableReservedKeys.includes(topLevelKey);

          setPath(canonicalDraft, rule.toPath, finalValue, { force: forceWrite });
          totalOutputs++;
        }
      } else if (rule.type === 'MapArray') {
        if (!compiledRule.arrayExtractor) {
          executionInfo.status = 'failed';
          executionInfo.reason = 'Array extractor not compiled';
          executionInfo.warnings.push('MapArray rule missing array extractor');
        } else {
          const arrayItems = compiledRule.arrayExtractor(sourceRecord.raw);
          
          if (!arrayItems || arrayItems.length === 0) {
            executionInfo.status = 'skipped';
            executionInfo.reason = 'Source array empty or undefined';
          } else {
            let itemsProcessed = 0;

            for (let index = 0; index < arrayItems.length; index++) {
              const item = arrayItems[index];

              // Apply itemTemplate if present, otherwise use raw item
              const processedItem = rule.itemTemplate
                ? applyItemTemplate(rule.itemTemplate, item, index, sourceRecord.raw)
                : item;

              appendPath(canonicalDraft, rule.toPath, processedItem);
              itemsProcessed++;
            }

            executionInfo.outputCount = itemsProcessed;
            totalOutputs += itemsProcessed;
          }
        }
      } else if (rule.type === 'EmitRelationship') {
        const targetValue = compiledRule.extractor(sourceRecord.raw);
        
        if (targetValue === undefined) {
          executionInfo.status = 'skipped';
          executionInfo.reason = 'Target value undefined';
        } else {
          const relationship: Record<string, unknown> = {
            type: rule.relationshipType,
            target: String(targetValue),
          };
          
          // Add optional fields if present in rule
          if (rule.roleFrom) {
            // Extract role value
            // For now, we'll skip this - would need additional extractor
            executionInfo.warnings.push('Role extraction not yet implemented');
          }
          
          appendPath(canonicalDraft, 'relationships', relationship);
          totalOutputs++;
        }
      } else if (rule.type === 'EmitWarning') {
        // Check if any of the whenMissing paths have values
        const hasValue = rule.whenMissing.some(_path => {
          // Would need a proper path evaluator here
          return false; // Simplified - always emit warning for now
        });
        
        if (!hasValue) {
          const message = rule.message || 'Warning emitted by rule';
          executionInfo.warnings.push(message);
          totalWarnings.push(`[${ruleId}] ${message}`);
        } else {
          executionInfo.status = 'skipped';
          executionInfo.reason = 'Condition not met - values found';
        }
      } else if (rule.type === 'SetExtension') {
        const value = compiledRule.extractor(sourceRecord.raw);
        
        if (value === undefined) {
          executionInfo.status = 'skipped';
          executionInfo.reason = 'Extension value undefined';
        } else {
          const extension = {
            namespace: rule.namespace,
            extensionType: rule.extensionType,
            data: value,
          };
          
          appendPath(canonicalDraft, 'extensions', extension);
          totalOutputs++;
        }
      } else {
        executionInfo.status = 'failed';
        executionInfo.reason = `Unknown rule type: ${(rule as any).type}`;
        executionInfo.warnings.push(`Unknown rule type: ${(rule as any).type}`);
      }
    } catch (error) {
      executionInfo.status = 'failed';
      executionInfo.reason = error instanceof Error ? error.message : String(error);
      executionInfo.warnings.push(`Rule execution failed: ${executionInfo.reason}`);
      totalWarnings.push(`[${ruleId}] ${executionInfo.reason}`);
    }
    
    // Collect warnings
    if (executionInfo.warnings.length > 0) {
      totalWarnings.push(...executionInfo.warnings);
    }
    
    ruleExecutions.push(executionInfo);
  }
  
  // Validate required fields
  // Required: id and type must be present
  if (!canonicalDraft.id) {
    totalWarnings.push('VALIDATION ERROR: Required field "id" is missing');
  }
  if (!canonicalDraft.type) {
    totalWarnings.push('VALIDATION ERROR: Required field "type" is missing (defaulted to "Object")');
  }
  
  // Recommended: label should be present
  if (!canonicalDraft.label) {
    totalWarnings.push('VALIDATION WARNING: Recommended field "label" is missing');
  }
  
  return {
    canonicalDraft,
    reportDraft: {
      ruleExecutions,
      totalOutputs,
      totalWarnings,
    },
  };
}

/**
 * Apply an item template to transform an array item.
 *
 * Supports the following placeholders:
 * - {{item}} - The entire item value (for primitive arrays)
 * - {{item.path}} - A nested path within the item (for object arrays)
 * - {{index}} - The current array index
 * - {{parent.path}} - A path from the source record root
 *
 * @param template - Item template with placeholder keys and values
 * @param item - Current array item
 * @param index - Current array index
 * @param source - Source record for parent references
 * @returns Processed item with placeholders replaced
 */
function applyItemTemplate(
  template: Record<string, unknown>,
  item: unknown,
  index: number,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(template)) {
    if (typeof value === 'string') {
      result[key] = interpolateTemplateValue(value, item, index, source);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively process nested templates
      result[key] = applyItemTemplate(value as Record<string, unknown>, item, index, source);
    } else {
      // Pass through non-string, non-object values (numbers, booleans, arrays, null)
      result[key] = value;
    }
  }

  return result;
}

/**
 * Interpolate a single template string value.
 *
 * @param value - Template string with placeholders
 * @param item - Current array item
 * @param index - Current array index
 * @param source - Source record for parent references
 * @returns Interpolated string value
 */
function interpolateTemplateValue(
  value: string,
  item: unknown,
  index: number,
  source: Record<string, unknown>
): unknown {
  // If the entire value is just {{item}}, return the item directly (preserve type)
  if (value === '{{item}}') {
    return item;
  }

  // If the entire value is just {{index}}, return the index as number
  if (value === '{{index}}') {
    return index;
  }

  // Check for {{item.path}} pattern (return typed value if entire match)
  const itemPathMatch = value.match(/^\{\{item\.([^}]+)\}\}$/);
  if (itemPathMatch && typeof item === 'object' && item !== null) {
    return getNestedValue(item, itemPathMatch[1]);
  }

  // Check for {{parent.path}} pattern (return typed value if entire match)
  const parentPathMatch = value.match(/^\{\{parent\.([^}]+)\}\}$/);
  if (parentPathMatch) {
    return getNestedValue(source, parentPathMatch[1]);
  }

  // For composite templates, do string replacement
  let result = value;

  // Replace {{item}} with stringified item
  result = result.replace(/\{\{item\}\}/g, stringifyValue(item));

  // Replace {{index}} with index
  result = result.replace(/\{\{index\}\}/g, String(index));

  // Replace {{item.path}} with nested item values
  const itemMatches = result.matchAll(/\{\{item\.([^}]+)\}\}/g);
  for (const match of itemMatches) {
    const path = match[1];
    const nestedValue = typeof item === 'object' && item !== null
      ? getNestedValue(item, path)
      : undefined;
    result = result.replace(match[0], stringifyValue(nestedValue));
  }

  // Replace {{parent.path}} with source values
  const parentMatches = result.matchAll(/\{\{parent\.([^}]+)\}\}/g);
  for (const match of parentMatches) {
    const path = match[1];
    const parentValue = getNestedValue(source, path);
    result = result.replace(match[0], stringifyValue(parentValue));
  }

  return result;
}

/**
 * Get a nested value from an object using dot notation path.
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }

  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    const record = current as Record<string, unknown>;
    current = record[part];
  }

  return current;
}

/**
 * Convert a value to string for template interpolation.
 */
function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Apply a mapping from canonical record to destination payload.
 *
 * This is the inverse operation of applyMappingToCanonical.
 * It takes a canonical record and applies destination mapping rules
 * to produce a format-specific output payload.
 *
 * @param canonicalRecord - Canonical record to project
 * @param compiled - Compiled destination mapping
 * @param context - Engine context
 * @returns Projection draft and rule execution info
 */
function applyMappingToDestination(
  canonicalRecord: CanonicalRecord,
  compiled: CompiledMapping,
  _context: EngineContext
): {
  destinationPayload: Record<string, any>;
  reportDraft: {
    ruleExecutions: Array<{
      ruleId: string;
      ruleType: string;
      status: 'applied' | 'skipped' | 'failed';
      reason?: string;
      outputCount?: number;
      warnings: string[];
    }>;
    totalOutputs: number;
    totalWarnings: string[];
  };
} {
  const destinationPayload: Record<string, any> = {};
  const ruleExecutions: Array<{
    ruleId: string;
    ruleType: string;
    status: 'applied' | 'skipped' | 'failed';
    reason?: string;
    outputCount?: number;
    warnings: string[];
  }> = [];
  const totalWarnings: string[] = [];
  let totalOutputs = 0;
  
  // Execute each compiled rule in order
  for (const compiledRule of compiled.compiledRules) {
    const rule = compiledRule.rule;
    const ruleId = rule.id || `${rule.type}_${ruleExecutions.length}`;
    
    const executionInfo = {
      ruleId,
      ruleType: rule.type,
      status: 'skipped' as 'skipped' | 'applied' | 'failed',
      reason: undefined as string | undefined,
      outputCount: 0,
      warnings: [] as string[],
    };
    
    // Skip disabled rules
    if ('disabled' in rule && rule.disabled) {
      executionInfo.status = 'skipped';
      executionInfo.reason = 'Rule disabled';
      ruleExecutions.push(executionInfo);
      continue;
    }
    
    try {
      // For destination mapping, we extract from canonical record
      // and write to destination payload
      
      if (rule.type === 'SetField') {
        // Extract value from canonical record using 'from' path
        const fromPath = (rule as any).from as string;
        const toPath = (rule as any).toPath as string;
        
        if (!fromPath || !toPath) {
          executionInfo.status = 'failed';
          executionInfo.reason = 'Missing from or toPath';
          ruleExecutions.push(executionInfo);
          continue;
        }
        
        // Simple path extraction from canonical record
        const value = extractFromCanonical(canonicalRecord, fromPath);
        
        if (value === undefined) {
          // Check for default value
          const defaultValue = (rule as any).default;
          if (defaultValue !== undefined) {
            setPathInObject(destinationPayload, toPath, defaultValue);
            executionInfo.status = 'applied';
            executionInfo.outputCount = 1;
            totalOutputs += 1;
          } else {
            executionInfo.status = 'skipped';
            executionInfo.reason = 'Source value undefined, no default';
          }
        } else {
          setPathInObject(destinationPayload, toPath, value);
          executionInfo.status = 'applied';
          executionInfo.outputCount = 1;
          totalOutputs += 1;
        }
      } else if (rule.type === 'MapArray') {
        // Extract array from canonical and map to destination
        const fromPath = (rule as any).fromMany as string;
        const toPath = (rule as any).toPath as string;
        
        if (!fromPath || !toPath) {
          executionInfo.status = 'failed';
          executionInfo.reason = 'Missing fromMany or toPath';
          ruleExecutions.push(executionInfo);
          continue;
        }
        
        const arrayValue = extractFromCanonical(canonicalRecord, fromPath);
        
        if (Array.isArray(arrayValue) && arrayValue.length > 0) {
          setPathInObject(destinationPayload, toPath, arrayValue);
          executionInfo.status = 'applied';
          executionInfo.outputCount = arrayValue.length;
          totalOutputs += arrayValue.length;
        } else {
          executionInfo.status = 'skipped';
          executionInfo.reason = 'Source array empty or undefined';
        }
      } else {
        // Other rule types not yet implemented for destination projection
        executionInfo.status = 'skipped';
        executionInfo.reason = `Rule type ${rule.type} not supported for projection`;
      }
      
      ruleExecutions.push(executionInfo);
    } catch (error) {
      executionInfo.status = 'failed';
      executionInfo.reason = error instanceof Error ? error.message : String(error);
      const warning = `Rule ${ruleId} failed: ${executionInfo.reason}`;
      executionInfo.warnings.push(warning);
      totalWarnings.push(warning);
      ruleExecutions.push(executionInfo);
    }
  }
  
  return {
    destinationPayload,
    reportDraft: {
      ruleExecutions,
      totalOutputs,
      totalWarnings,
    },
  };
}

/**
 * Extract a value from canonical record by path.
 * 
 * @param canonical - Canonical record
 * @param path - Dot-notation path (e.g., "label", "properties.medium")
 * @returns Extracted value or undefined
 */
function extractFromCanonical(canonical: CanonicalRecord, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = canonical;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    const record = current as Record<string, unknown>;
    current = record[part];
  }

  return current;
}

/**
 * Set a value in an object by path, creating nested objects as needed.
 *
 * @param obj - Target object
 * @param path - Dot-notation path
 * @param value - Value to set
 */
function setPathInObject(obj: Record<string, unknown>, path: string, value: unknown): void {
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
 * Project a canonical record to a destination format.
 * 
 * This function takes an existing canonical record and applies a destination
 * mapping to produce a format-specific payload (e.g., Dublin Core, CIDOC-CRM, JSON-LD).
 * 
 * The projection is deterministic when snapshotId is provided - the same canonical
 * record and mapping will always produce the same output payload and hash.
 * 
 * @param request - Projection request
 * @returns Projection result with payload, report, and metadata
 * @throws {MappingCompileError} If mapping compilation fails
 * @throws {MappingApplyError} If projection fails
 * 
 * @example
 * ```typescript
 * const result = await project({
 *   canonicalRecord: record,
 *   mapping: dublinCoreMapping,
 *   snapshotId: 'snap_abc123',
 *   mode: 'destination',
 * });
 * 
 * console.log('Payload:', result.projectionPayload);
 * console.log('Report:', result.mappingReport);
 * console.log('Hash:', result.meta.hash);
 * ```
 */
export async function project(
  request: ProjectRequest
): Promise<ProjectResult> {
  const { canonicalRecord, mapping, snapshotId, mode } = request;
  
  // Stub for source mode (return empty payload)
  if (mode === 'source') {
    const now = new Date().toISOString();
    const stubPayload = { mode: 'source', message: 'Source mode not yet implemented' };
    
    return {
      projectionPayload: stubPayload,
      mappingReport: {
        references: {
          snapshotId,
          mappingId: mapping.id,
          transformId: 'none',
        },
        status: 'success',
        warnings: [],
        ruleExecution: {
          totalRules: 0,
          executedRules: 0,
          skippedRules: 0,
          failedRules: 0,
          fieldsMapped: 0,
          fieldsDropped: 0,
        },
        diffSummary: {
          sourceFieldCount: 0,
          canonicalFieldCount: 0,
          fieldsAdded: [],
          fieldsTransformed: 0,
          fieldsDropped: 0,
          enrichmentsApplied: 0,
        },
      },
      meta: {
        hash: await hashProjection(stubPayload, snapshotId, undefined),
        generatedAt: now,
        format: mapping.target,
      },
    };
  }
  
  // Destination mode: canonical → destination format
  const reportBuilder = new MappingReportBuilder();
  reportBuilder
    .setReferences(
      undefined, // pipelineId not needed for projection
      snapshotId,
      mapping.id,
      'none' // no transform in projection
    )
    .startTiming();
  
  try {
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Compile destination mapping (with caching)
    // ═══════════════════════════════════════════════════════════════════════
    
    reportBuilder.startPhase('compile');
    
    const cacheKey = getCacheKey(mapping.id, mapping.version);
    let compiled = compilationCache.get(cacheKey);
    
    if (!compiled) {
      try {
        const rules = (mapping as any).rules as MappingDSLRule[];
        if (!rules || rules.length === 0) {
          throw new MappingCompileError(
            mapping.id,
            'Mapping has no rules defined',
            { mapping }
          );
        }
        
        compiled = compileMappingDSL(mapping, rules);
        compilationCache.set(cacheKey, compiled);
      } catch (error) {
        if (error instanceof MappingCompileError) {
          throw error;
        }
        throw new MappingCompileError(
          mapping.id,
          error instanceof Error ? error.message : String(error),
          { mapping, error }
        );
      }
    }
    
    reportBuilder.endPhase();
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Apply destination mapping to canonical record
    // ═══════════════════════════════════════════════════════════════════════
    
    reportBuilder.startPhase('apply');
    
    // Create a shallow copy to prevent mutation
    const canonicalCopy = { ...canonicalRecord };
    
    const context: EngineContext = {
      pipelineId: 'projection',
      now: new Date().toISOString(),
    };
    
    let projectionResult;
    try {
      projectionResult = applyMappingToDestination(canonicalCopy, compiled, context);
    } catch (error) {
      throw new MappingApplyError(
        mapping.id,
        canonicalRecord.id,
        error instanceof Error ? error.message : String(error),
        { canonicalRecord, mapping, error }
      );
    }
    
    // Add rule execution stats to report
    for (const ruleExec of projectionResult.reportDraft.ruleExecutions) {
      reportBuilder.addRuleStats({
        ruleId: ruleExec.ruleId,
        status: ruleExec.status,
        outputs: ruleExec.outputCount || 0,
        reason: ruleExec.reason,
      });
    }
    
    // Add warnings
    reportBuilder.addWarnings(projectionResult.reportDraft.totalWarnings);
    
    reportBuilder.endPhase();
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Build final report and compute hash
    // ═══════════════════════════════════════════════════════════════════════
    
    reportBuilder.endTiming();
    
    // Set diff summary
    const canonicalFieldCount = Object.keys(canonicalRecord).length;
    const destinationFieldCount = Object.keys(projectionResult.destinationPayload).length;
    
    reportBuilder.setDiffSummary({
      sourceFieldCount: canonicalFieldCount,
      canonicalFieldCount: destinationFieldCount,
      fieldsTransformed: projectionResult.reportDraft.totalOutputs,
    });
    
    // Determine status and finalize
    reportBuilder.determineStatus();
    const mappingReport = reportBuilder.finalize();
    
    // Compute deterministic hash (excludes timestamps)
    const now = new Date().toISOString();
    const hash = await hashProjection(
      projectionResult.destinationPayload,
      snapshotId,
      mapping.id
    );
    
    return {
      projectionPayload: projectionResult.destinationPayload,
      mappingReport,
      meta: {
        hash,
        generatedAt: now,
        format: mapping.target,
      },
    };
    
  } catch (error) {
    // Build error report
    reportBuilder.endTiming();
    reportBuilder.setStatus('failed');
    
    if (error instanceof MappingCompileError || error instanceof MappingApplyError) {
      reportBuilder.addWarning({
        code: error.code,
        message: error.message,
        severity: 'error',
      });
    } else {
      reportBuilder.addWarning({
        code: 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : String(error),
        severity: 'error',
      });
    }
    
    // Re-throw the error
    throw error;
  }
}

/**
 * Compute a simple content hash for projection determinism.
 * 
 * In production, this should use a proper cryptographic hash (SHA-256).
 * 
 * @param data - Data to hash
 * @returns Hash string
 */
// Hash computation moved to hash.ts module
// Uses stableHash() for deterministic SHA-256 hashing
// See: hashProvenance() and hashProjection()
