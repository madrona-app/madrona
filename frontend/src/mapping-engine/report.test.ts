/**
 * MappingReportBuilder Tests
 */

import { describe, it, expect } from 'vitest';
import { MappingReportBuilder, createReportBuilder } from './report';

describe('MappingReportBuilder', () => {
  describe('basic usage', () => {
    it('should create a complete report with all required fields', () => {
      const builder = new MappingReportBuilder();
      
      builder
        .setReferences(
          'route_test_123',
          'snap_test_456',
          'map_test_789',
          'txf_test_012'
        )
        .addWarning('Test warning message')
        .addRuleStats({
          ruleId: 'set_label',
          status: 'applied',
          outputs: 1,
        })
        .setDiffSummary({
          sourceFieldCount: 50,
          canonicalFieldCount: 35,
          fieldsAdded: ['id', 'type'],
          fieldsTransformed: 30,
          fieldsDropped: 20,
          enrichmentsApplied: 2,
        });
      
      const report = builder.finalize();
      
      expect(report.references.pipelineId).toBe('route_test_123');
      expect(report.references.snapshotId).toBe('snap_test_456');
      expect(report.references.mappingId).toBe('map_test_789');
      expect(report.references.transformId).toBe('txf_test_012');
      expect(report.warnings).toHaveLength(1);
      expect(report.warnings[0]).toBe('Test warning message');
      expect(report.ruleExecution.totalRules).toBe(1);
      expect(report.ruleExecution.executedRules).toBe(1);
      expect(report.diffSummary.sourceFieldCount).toBe(50);
    });
    
    it('should work with createReportBuilder convenience function', () => {
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .finalize();
      
      expect(report.references.snapshotId).toBe('snap_123');
      expect(report.references.pipelineId).toBeUndefined();
    });
    
    it('should throw error if required fields are missing', () => {
      const builder = new MappingReportBuilder();
      
      expect(() => builder.finalize()).toThrow(
        'MappingReport requires snapshotId, mappingId, and transformId'
      );
    });
  });
  
  describe('status determination', () => {
    it('should determine status as success with no warnings', () => {
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .addRuleStats({ ruleId: 'rule1', status: 'applied', outputs: 1 })
        .addRuleStats({ ruleId: 'rule2', status: 'applied', outputs: 1 })
        .determineStatus()
        .finalize();
      
      expect(report.status).toBe('success');
    });
    
    it('should determine status as partial with warnings', () => {
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .addWarning('Some field missing')
        .addRuleStats({ ruleId: 'rule1', status: 'applied', outputs: 1 })
        .determineStatus()
        .finalize();
      
      expect(report.status).toBe('partial');
    });
    
    it('should determine status as partial with skipped rules', () => {
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .addRuleStats({ ruleId: 'rule1', status: 'applied', outputs: 1 })
        .addRuleStats({ ruleId: 'rule2', status: 'skipped' })
        .determineStatus()
        .finalize();
      
      expect(report.status).toBe('partial');
    });
    
    it('should determine status as failed with error warnings', () => {
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .addWarning({ message: 'Critical error', severity: 'error' })
        .addRuleStats({ ruleId: 'rule1', status: 'applied', outputs: 1 })
        .determineStatus()
        .finalize();
      
      expect(report.status).toBe('failed');
    });
    
    it('should determine status as failed with failed rules', () => {
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .addRuleStats({ ruleId: 'rule1', status: 'failed', reason: 'Parse error' })
        .determineStatus()
        .finalize();
      
      expect(report.status).toBe('failed');
    });
    
    it('should allow explicit status override', () => {
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .addWarning('Warning')
        .setStatus('success') // Explicit override
        .finalize();
      
      expect(report.status).toBe('success');
    });
  });
  
  describe('warnings', () => {
    it('should add string warnings', () => {
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .addWarning('Simple warning')
        .finalize();
      
      expect(report.warnings).toEqual(['Simple warning']);
    });
    
    it('should add warnings with code', () => {
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .addWarning({
          code: 'MISSING_FIELD',
          message: 'Field not found',
        })
        .finalize();
      
      expect(report.warnings[0]).toBe('[MISSING_FIELD] Field not found');
    });
    
    it('should add warnings with ruleId', () => {
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .addWarning({
          message: 'Value invalid',
          ruleId: 'set_date',
        })
        .finalize();
      
      expect(report.warnings[0]).toBe('Value invalid (rule: set_date)');
    });
    
    it('should add warnings with code and ruleId', () => {
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .addWarning({
          code: 'VALIDATION_ERROR',
          message: 'Invalid date format',
          ruleId: 'set_created_date',
        })
        .finalize();
      
      expect(report.warnings[0]).toBe('[VALIDATION_ERROR] Invalid date format (rule: set_created_date)');
    });
    
    it('should add multiple warnings at once', () => {
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .addWarnings(['Warning 1', 'Warning 2', { message: 'Warning 3', code: 'W3' }])
        .finalize();
      
      expect(report.warnings).toHaveLength(3);
      expect(report.warnings[2]).toBe('[W3] Warning 3');
    });
  });
  
  describe('rule stats', () => {
    it('should calculate correct rule execution summary', () => {
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .addRuleStats({ ruleId: 'r1', status: 'applied', outputs: 2 })
        .addRuleStats({ ruleId: 'r2', status: 'applied', outputs: 1 })
        .addRuleStats({ ruleId: 'r3', status: 'skipped', reason: 'Source missing' })
        .addRuleStats({ ruleId: 'r4', status: 'failed', reason: 'Parse error' })
        .finalize();
      
      expect(report.ruleExecution.totalRules).toBe(4);
      expect(report.ruleExecution.executedRules).toBe(2);
      expect(report.ruleExecution.skippedRules).toBe(1);
      expect(report.ruleExecution.failedRules).toBe(1);
      expect(report.ruleExecution.fieldsMapped).toBe(3); // 2 + 1 outputs
    });
    
    it('should add rule stats array', () => {
      const stats = [
        { ruleId: 'r1', status: 'applied' as const, outputs: 1 },
        { ruleId: 'r2', status: 'applied' as const, outputs: 1 },
      ];
      
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .addRuleStatsArray(stats)
        .finalize();
      
      expect(report.ruleExecution.totalRules).toBe(2);
    });
  });
  
  describe('diff summary', () => {
    it('should use default values if not set', () => {
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .finalize();
      
      expect(report.diffSummary.sourceFieldCount).toBe(0);
      expect(report.diffSummary.canonicalFieldCount).toBe(0);
      expect(report.diffSummary.fieldsAdded).toEqual([]);
      expect(report.diffSummary.fieldsTransformed).toBe(0);
      expect(report.diffSummary.fieldsDropped).toBe(0);
      expect(report.diffSummary.enrichmentsApplied).toBe(0);
    });
    
    it('should accept partial diff summary', () => {
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .setDiffSummary({
          sourceFieldCount: 100,
          fieldsAdded: ['id', 'type', 'meta'],
        })
        .finalize();
      
      expect(report.diffSummary.sourceFieldCount).toBe(100);
      expect(report.diffSummary.fieldsAdded).toEqual(['id', 'type', 'meta']);
      expect(report.diffSummary.canonicalFieldCount).toBe(0); // Still uses default
    });
  });
  
  describe('timing', () => {
    it('should track overall duration', async () => {
      const builder = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .startTiming();
      
      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 50));
      
      builder.endTiming();
      
      const duration = builder.getDuration();
      expect(duration).toBeGreaterThanOrEqual(40);
      expect(duration).toBeLessThan(150);
    });
    
    it('should track phase timings', async () => {
      const builder = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .startTiming();
      
      builder.startPhase('mapping');
      await new Promise(resolve => setTimeout(resolve, 20));
      builder.endPhase();
      
      builder.startPhase('validation');
      await new Promise(resolve => setTimeout(resolve, 20));
      builder.endPhase();
      
      builder.endTiming();
      
      const timings = builder.getPhaseTimings();
      expect(timings.mapping).toBeGreaterThan(15);
      expect(timings.validation).toBeGreaterThan(15);
    });
    
    it('should auto-end phase when starting new phase', async () => {
      const builder = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .startTiming();
      
      builder.startPhase('phase1');
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Starting phase2 should auto-end phase1
      builder.startPhase('phase2');
      await new Promise(resolve => setTimeout(resolve, 20));
      
      builder.endTiming();
      
      const timings = builder.getPhaseTimings();
      expect(timings.phase1).toBeDefined();
      expect(timings.phase2).toBeDefined();
    });
    
    it('should auto-end phase on endTiming', async () => {
      const builder = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .startTiming();
      
      builder.startPhase('phase1');
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // endTiming should auto-end phase1
      builder.endTiming();
      
      const timings = builder.getPhaseTimings();
      expect(timings.phase1).toBeDefined();
    });
  });
  
  describe('method chaining', () => {
    it('should support fluent builder pattern', () => {
      const report = createReportBuilder()
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .startTiming()
        .addWarning('Warning 1')
        .addWarning('Warning 2')
        .addRuleStats({ ruleId: 'r1', status: 'applied', outputs: 1 })
        .addRuleStats({ ruleId: 'r2', status: 'skipped' })
        .setDiffSummary({ sourceFieldCount: 50 })
        .endTiming()
        .determineStatus()
        .finalize();
      
      expect(report.status).toBe('partial');
      expect(report.warnings).toHaveLength(2);
      expect(report.ruleExecution.totalRules).toBe(2);
    });
  });
  
  describe('static create method', () => {
    it('should create builder via static method', () => {
      const builder = MappingReportBuilder.create();
      
      const report = builder
        .setReferences(undefined, 'snap_123', 'map_456', 'txf_789')
        .finalize();
      
      expect(report.references.snapshotId).toBe('snap_123');
    });
  });
});
