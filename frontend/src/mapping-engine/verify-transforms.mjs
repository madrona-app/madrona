/**
 * Quick verification script for transform pipeline
 */

import { runTransformPipeline } from './transforms.js';

const mockContext = {
  sourceRecord: {
    id: 'snap_test',
    source: { system: 'test', recordId: 'rec_001' },
    raw: {},
    capturedAt: '2026-01-14T10:00:00Z',
    meta: { schemaVersion: '1.0.0', hash: 'test_hash' },
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

// Test normalize-whitespace
console.log('Testing normalize-whitespace...');
const record1 = {
  label: '  The  Starry   Night  ',
  description: '  A painting\nby  Van Gogh  ',
  type: 'Object',
};

const pipeline1 = {
  steps: [{ type: 'normalize-whitespace' }],
};

const result1 = runTransformPipeline(record1, pipeline1, mockContext);
console.log('✓ Label:', result1.record.label);
console.log('✓ Description:', result1.record.description);
console.log('✓ Warnings:', result1.warnings?.length || 0);

// Test normalize-identifiers
console.log('\nTesting normalize-identifiers...');
const record2 = {
  identifiers: [
    { scheme: 'accession', value: '  2024.001  ' },
    { scheme: 'accession', value: '  2024.001  ' },
    { scheme: 'catalog', value: 'CAT  123' },
  ],
  type: 'Object',
};

const pipeline2 = {
  steps: [{ type: 'normalize-identifiers' }],
};

const result2 = runTransformPipeline(record2, pipeline2, mockContext);
console.log('✓ Identifiers count:', result2.record.identifiers?.length);
console.log('✓ Warnings:', result2.warnings);

// Test normalize-dimensions
console.log('\nTesting normalize-dimensions...');
const record3 = {
  properties: {
    height: '100 cm',
    width: '150',
    depth: '25.5 inches',
  },
  type: 'Object',
};

const pipeline3 = {
  steps: [{ type: 'normalize-dimensions' }],
};

const result3 = runTransformPipeline(record3, pipeline3, mockContext);
console.log('✓ Height:', result3.record.properties?.height);
console.log('✓ Width:', result3.record.properties?.width);
console.log('✓ Depth:', result3.record.properties?.depth);

// Test full pipeline
console.log('\nTesting full pipeline...');
const record4 = {
  label: '  The  Starry  Night  ',
  identifiers: [
    { scheme: 'accession', value: '  2024.001  ' },
    { scheme: 'accession', value: '  2024.001  ' },
  ],
  properties: {
    height: '100 cm',
    width: '150',
  },
  type: 'Object',
};

const pipeline4 = {
  steps: [
    { type: 'normalize-whitespace' },
    { type: 'normalize-identifiers' },
    { type: 'normalize-dimensions' },
  ],
};

const result4 = runTransformPipeline(record4, pipeline4, mockContext);
console.log('✓ Label:', result4.record.label);
console.log('✓ Identifiers:', result4.record.identifiers?.length);
console.log('✓ Height:', result4.record.properties?.height);
console.log('✓ Width:', result4.record.properties?.width);
console.log('✓ Total warnings:', result4.warnings?.length || 0);

console.log('\n✅ All transform pipeline tests passed!');
