/**
 * Madrona Mapping Engine v1 — MappingReport Builder
 * 
 * Utility for collecting transformation diagnostics and building MappingReport objects.
 */

import type { MappingReport } from '../types/canonical';
import type { TransformContext, RuleExecutionResult } from './types';

/**
 * Warning entry with optional metadata.
 */
export interface WarningEntry {
  code?: string;
  message: string;
  ruleId?: string;
  severity?: 'info' | 'warning' | 'error';
}

/**
 * Rule execution statistics for a single rule.
 */
export interface RuleStats {
  ruleId: string;
  status: 'applied' | 'skipped' | 'failed';
  outputs?: number;
  reason?: string;
}

/**
 * Phase timing information.
 */
export interface PhaseTimings {
  [phaseName: string]: number; // milliseconds
}

/**
 * Builder for constructing MappingReport objects.
 * 
 * Collects transformation diagnostics throughout the mapping process
 * and produces a finalized MappingReport for inclusion with canonical records.
 * 
 * @example
 * ```typescript
 * const builder = new MappingReportBuilder()
 *   .setReferences('route_123', 'snap_456', 'map_789', 'txf_012')
 *   .startTiming()
 *   .addWarning({ message: 'Field X missing', code: 'MISSING_FIELD' })
 *   .addRuleStats({ ruleId: 'set_label', status: 'applied', outputs: 1 })
 *   .setDiffSummary({ sourceFieldCount: 50, canonicalFieldCount: 35 })
 *   .endTiming()
 *   .determineStatus();
 * 
 * const report = builder.finalize();
 * ```
 */
export class MappingReportBuilder {
  // References
  private pipelineId?: string;
  private snapshotId?: string;
  private mappingId?: string;
  private transformId?: string;
  
  // Status
  private status: 'success' | 'partial' | 'failed' = 'success';
  
  // Warnings
  private warnings: WarningEntry[] = [];
  
  // Rule execution tracking
  private ruleStats: RuleStats[] = [];
  
  // Diff summary (optional)
  private diffSummary?: Partial<MappingReport['diffSummary']>;
  
  // Timing information
  private startTime?: number;
  private endTime?: number;
  private phaseTimings: PhaseTimings = {};
  private currentPhase?: string;
  private currentPhaseStart?: number;
  
  /**
   * Set pipeline component references.
   * 
   * @param pipelineId - Pipeline that processed this record (optional)
   * @param snapshotId - Source record snapshot ID
   * @param mappingId - Mapping configuration ID
   * @param transformId - Transform pipeline ID
   * @returns This builder for chaining
   */
  setReferences(
    pipelineId: string | undefined,
    snapshotId: string,
    mappingId: string,
    transformId: string
  ): this {
    this.pipelineId = pipelineId;
    this.snapshotId = snapshotId;
    this.mappingId = mappingId;
    this.transformId = transformId;
    return this;
  }
  
  /**
   * Explicitly set the transformation status.
   * 
   * @param status - Overall transformation status
   * @returns This builder for chaining
   */
  setStatus(status: 'success' | 'partial' | 'failed'): this {
    this.status = status;
    return this;
  }
  
  /**
   * Automatically determine status based on warnings and rule stats.
   * 
   * Rules:
   * - 'failed': Any error-severity warnings or critical rules failed
   * - 'partial': Any warnings or some rules skipped
   * - 'success': No warnings and all rules executed
   * 
   * @returns This builder for chaining
   */
  determineStatus(): this {
    const hasErrors = this.warnings.some(w => w.severity === 'error');
    const hasFailedRules = this.ruleStats.some(r => r.status === 'failed');
    const hasWarnings = this.warnings.length > 0;
    const hasSkippedRules = this.ruleStats.some(r => r.status === 'skipped');
    
    if (hasErrors || hasFailedRules) {
      this.status = 'failed';
    } else if (hasWarnings || hasSkippedRules) {
      this.status = 'partial';
    } else {
      this.status = 'success';
    }
    
    return this;
  }
  
  /**
   * Add a warning message.
   * 
   * @param warning - Warning entry or simple string message
   * @returns This builder for chaining
   */
  addWarning(warning: WarningEntry | string): this {
    if (typeof warning === 'string') {
      this.warnings.push({ message: warning });
    } else {
      this.warnings.push(warning);
    }
    return this;
  }
  
  /**
   * Add multiple warnings at once.
   * 
   * @param warnings - Array of warnings to add
   * @returns This builder for chaining
   */
  addWarnings(warnings: (WarningEntry | string)[]): this {
    warnings.forEach(w => this.addWarning(w));
    return this;
  }
  
  /**
   * Add rule execution statistics.
   * 
   * @param stats - Rule execution stats
   * @returns This builder for chaining
   */
  addRuleStats(stats: RuleStats): this {
    this.ruleStats.push(stats);
    return this;
  }
  
  /**
   * Add multiple rule stats at once.
   * 
   * @param statsArray - Array of rule stats
   * @returns This builder for chaining
   */
  addRuleStatsArray(statsArray: RuleStats[]): this {
    statsArray.forEach(s => this.addRuleStats(s));
    return this;
  }
  
  /**
   * Set the diff summary (optional high-level change summary).
   * 
   * @param summary - Diff summary data (can be partial)
   * @returns This builder for chaining
   */
  setDiffSummary(summary: Partial<MappingReport['diffSummary']>): this {
    this.diffSummary = summary;
    return this;
  }
  
  /**
   * Start overall timing measurement.
   * 
   * @returns This builder for chaining
   */
  startTiming(): this {
    this.startTime = Date.now();
    return this;
  }
  
  /**
   * End overall timing measurement.
   * 
   * @returns This builder for chaining
   */
  endTiming(): this {
    this.endTime = Date.now();
    
    // End current phase if any
    if (this.currentPhase) {
      this.endPhase();
    }
    
    return this;
  }
  
  /**
   * Start timing a specific phase of the transformation.
   * 
   * @param phaseName - Name of the phase (e.g., "mapping", "validation", "enrichment")
   * @returns This builder for chaining
   */
  startPhase(phaseName: string): this {
    // End previous phase if any
    if (this.currentPhase) {
      this.endPhase();
    }
    
    this.currentPhase = phaseName;
    this.currentPhaseStart = Date.now();
    return this;
  }
  
  /**
   * End timing for the current phase.
   * 
   * @returns This builder for chaining
   */
  endPhase(): this {
    if (this.currentPhase && this.currentPhaseStart !== undefined) {
      const duration = Date.now() - this.currentPhaseStart;
      this.phaseTimings[this.currentPhase] = duration;
      this.currentPhase = undefined;
      this.currentPhaseStart = undefined;
    }
    return this;
  }
  
  /**
   * Get the total duration (if timing was started/ended).
   * 
   * @returns Duration in milliseconds, or undefined if timing not complete
   */
  getDuration(): number | undefined {
    if (this.startTime !== undefined && this.endTime !== undefined) {
      return this.endTime - this.startTime;
    }
    return undefined;
  }
  
  /**
   * Get phase timings.
   * 
   * @returns Object mapping phase names to durations in milliseconds
   */
  getPhaseTimings(): PhaseTimings {
    return { ...this.phaseTimings };
  }
  
  /**
   * Finalize and return the canonical MappingReport.
   * 
   * @returns Complete MappingReport object
   * @throws Error if required fields are missing
   */
  finalize(): MappingReport {
    // Validate required references
    if (!this.snapshotId || !this.mappingId || !this.transformId) {
      throw new Error(
        'MappingReport requires snapshotId, mappingId, and transformId. ' +
        `Got: snapshotId=${this.snapshotId}, mappingId=${this.mappingId}, transformId=${this.transformId}`
      );
    }
    
    // Calculate rule execution summary
    const totalRules = this.ruleStats.length;
    const executedRules = this.ruleStats.filter(r => r.status === 'applied').length;
    const skippedRules = this.ruleStats.filter(r => r.status === 'skipped').length;
    const failedRules = this.ruleStats.filter(r => r.status === 'failed').length;
    
    // Count fields mapped (sum of outputs from applied rules)
    const fieldsMapped = this.ruleStats
      .filter(r => r.status === 'applied')
      .reduce((sum, r) => sum + (r.outputs || 0), 0);
    
    // Fields dropped is estimated (would need source field count to be precise)
    const fieldsDropped = this.diffSummary?.fieldsDropped ?? 0;
    
    // Format warnings as simple strings (dropping metadata for canonical report)
    const warningStrings = this.warnings.map(w => {
      // Include code and ruleId in message if present
      let msg = w.message;
      if (w.code) {
        msg = `[${w.code}] ${msg}`;
      }
      if (w.ruleId) {
        msg = `${msg} (rule: ${w.ruleId})`;
      }
      return msg;
    });
    
    // Build complete diff summary with defaults
    const completeDiffSummary: MappingReport['diffSummary'] = {
      sourceFieldCount: this.diffSummary?.sourceFieldCount ?? 0,
      canonicalFieldCount: this.diffSummary?.canonicalFieldCount ?? 0,
      fieldsAdded: this.diffSummary?.fieldsAdded ?? [],
      fieldsTransformed: this.diffSummary?.fieldsTransformed ?? 0,
      fieldsDropped: this.diffSummary?.fieldsDropped ?? 0,
      enrichmentsApplied: this.diffSummary?.enrichmentsApplied ?? 0,
    };
    
    return {
      references: {
        pipelineId: this.pipelineId,
        snapshotId: this.snapshotId,
        mappingId: this.mappingId,
        transformId: this.transformId,
      },
      status: this.status,
      warnings: warningStrings,
      ruleExecution: {
        totalRules,
        executedRules,
        skippedRules,
        failedRules,
        fieldsMapped,
        fieldsDropped,
      },
      diffSummary: completeDiffSummary,
    };
  }
  
  /**
   * Create a new builder instance.
   * 
   * @returns New MappingReportBuilder
   */
  static create(): MappingReportBuilder {
    return new MappingReportBuilder();
  }
}

/**
 * Convenience function to create a new builder.
 * 
 * @returns New MappingReportBuilder instance
 * 
 * @example
 * ```typescript
 * const report = createReportBuilder()
 *   .setReferences(pipelineId, snapshotId, mappingId, transformId)
 *   .addWarning('Field missing')
 *   .finalize();
 * ```
 */
export function createReportBuilder(): MappingReportBuilder {
  return MappingReportBuilder.create();
}

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY HELPER FUNCTIONS (kept for backward compatibility)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a mapping report from transform context and rule results.
 * 
 * @deprecated Use MappingReportBuilder instead for more control
 * @param context - Transform context with warnings and stats
 * @param ruleResults - Results from rule executions
 * @param status - Overall transformation status
 * @returns Complete mapping report
 */
export function buildMappingReport(
  context: TransformContext,
  ruleResults: RuleExecutionResult[],
  status: 'success' | 'partial' | 'failed'
): MappingReport {
  const { sourceRecord, warnings, ruleStats } = context;
  
  // Count fields mapped (successful, non-skipped rules)
  const fieldsMapped = ruleResults.filter(r => r.success && !r.skipped).length;
  
  // Estimate fields dropped (rules that were skipped)
  const fieldsDropped = ruleStats.skippedRules;
  
  // Count source fields
  const sourceFieldCount = countFields(sourceRecord.raw);
  
  // Count canonical fields
  const canonicalFieldCount = countFields(context.canonicalRecord);
  
  // Identify fields added by system (not from source)
  const fieldsAdded = ['id', 'type', 'provenance', 'meta'];
  
  return {
    references: {
      snapshotId: sourceRecord.id,
      mappingId: 'unknown', // Would be filled by engine
      transformId: 'unknown', // Would be filled by engine
    },
    status,
    warnings,
    ruleExecution: {
      totalRules: ruleStats.totalRules,
      executedRules: ruleStats.executedRules,
      skippedRules: ruleStats.skippedRules,
      failedRules: ruleStats.failedRules,
      fieldsMapped,
      fieldsDropped,
    },
    diffSummary: {
      sourceFieldCount,
      canonicalFieldCount,
      fieldsAdded,
      fieldsTransformed: fieldsMapped,
      fieldsDropped,
      enrichmentsApplied: 0, // Would be tracked by enrichment steps
    },
  };
}

/**
 * Count fields in an object (including nested).
 * 
 * @param obj - Object to count fields in
 * @returns Total field count
 */
function countFields(obj: unknown): number {
  if (!obj || typeof obj !== 'object') {
    return 0;
  }

  let count = 0;
  const record = obj as Record<string, unknown>;

  for (const key in record) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      count++;
      const value = record[key];
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        count += countFields(value);
      }
    }
  }
  
  return count;
}

/**
 * Summarize rule execution results for debugging.
 * 
 * @param results - Rule execution results
 * @returns Human-readable summary
 */
export function summarizeRuleResults(results: RuleExecutionResult[]): string {
  const total = results.length;
  const succeeded = results.filter(r => r.success && !r.skipped).length;
  const failed = results.filter(r => !r.success).length;
  const skipped = results.filter(r => r.skipped).length;
  
  return `Executed ${total} rules: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped`;
}
