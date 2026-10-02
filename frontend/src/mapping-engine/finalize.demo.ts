/**
 * Madrona Mapping Engine v1 — Finalization Demo
 *
 * This demonstrates the finalizeCanonicalRecord() function which enforces
 * canonical invariants and fills system-managed fields.
 */

import { finalizeCanonicalRecord } from './engine';
import type { SourceRecord, CanonicalRecord, TransformPipeline } from '../types/canonical';
import type { EngineContext } from './types';

// Example 1: Successful finalization with all required fields
console.log('=== Example 1: Valid Canonical Draft ===\n');

const mockContext: EngineContext = {
  pipelineId: 'route_demo',
  now: '2026-01-14T10:00:00Z',
};

const mockMapping: any = {
  id: 'map_demo_v1',
  version: '1',
  source: 'airtable',
  target: 'canonical',
};

const sourceRecord: SourceRecord = {
  id: 'snap_abc123',
  source: {
    system: 'airtable',
    dataset: 'appXYZ789',
    recordId: 'recMNO456',
  },
  raw: {
    title: 'The Starry Night',
    artist: 'Vincent van Gogh',
    year: '1889',
  },
  capturedAt: '2026-01-14T09:00:00Z',
  meta: {
    schemaVersion: '1.0.0',
    hash: 'airtable_hash_123',
  },
};

const validDraft: Partial<CanonicalRecord> = {
  id: 'obj_starry_night',
  type: 'Object',
  label: 'The Starry Night',
  description: 'A painting by Vincent van Gogh from 1889',
  properties: {
    medium: 'Oil on canvas',
    dimensions: '73.7 cm × 92.1 cm',
  },
  identifiers: [
    { scheme: 'accession', value: '1941.001' },
  ],
};

const result1 = await finalizeCanonicalRecord(
  validDraft,
  sourceRecord,
  mockMapping,
  undefined,
  mockContext
);

if (result1.success) {
  console.log('✅ Finalization successful!\n');
  console.log('Canonical Record:');
  console.log(JSON.stringify(result1.canonicalRecord, null, 2));
} else {
  console.log('❌ Finalization failed:');
  result1.errors.forEach(err => console.log(`  - ${err}`));
}

// Example 2: Missing required fields
console.log('\n\n=== Example 2: Missing Required Fields ===\n');

const incompleteDraft: Partial<CanonicalRecord> = {
  id: 'obj_incomplete',
  // Missing type
  // Missing label
  description: 'This draft is missing required fields',
};

const result2 = await finalizeCanonicalRecord(
  incompleteDraft,
  sourceRecord,
  mockMapping,
  undefined,
  mockContext
);

if (result2.success) {
  console.log('✅ Unexpected success');
} else {
  console.log('❌ Finalization failed (expected):\n');
  result2.errors.forEach(err => console.log(`  - ${err}`));
}

// Example 3: Invalid type
console.log('\n\n=== Example 3: Invalid Type ===\n');

const invalidTypeDraft: Partial<CanonicalRecord> = {
  id: 'obj_invalid',
  type: 'InvalidType' as any,
  label: 'Invalid Type Example',
};

const result3 = await finalizeCanonicalRecord(
  invalidTypeDraft,
  sourceRecord,
  mockMapping,
  undefined,
  mockContext
);

if (result3.success) {
  console.log('✅ Unexpected success');
} else {
  console.log('❌ Finalization failed (expected):\n');
  result3.errors.forEach(err => console.log(`  - ${err}`));
}

// Example 4: With transform pipeline
console.log('\n\n=== Example 4: With Transform Pipeline ===\n');

const transformPipeline: TransformPipeline = {
  id: 'transform_glam_v2',
  version: '2.0.0',
  steps: [
    { type: 'map', mappingId: 'glam_v2' },
    { type: 'validate', schema: 'canonical-v1' },
  ],
};

const draftWithTransform: Partial<CanonicalRecord> = {
  id: 'obj_with_transform',
  type: 'Work',
  label: 'Document with Transform',
};

const result4 = await finalizeCanonicalRecord(
  draftWithTransform,
  sourceRecord,
  mockMapping,
  transformPipeline,
  mockContext
);

if (result4.success) {
  console.log('✅ Finalization successful with transform pipeline!\n');
  console.log('Provenance details:');
  console.log(`  - system: ${result4.canonicalRecord?.provenance.system}`);
  console.log(`  - dataset: ${result4.canonicalRecord?.provenance.dataset}`);
  console.log(`  - recordId: ${result4.canonicalRecord?.provenance.recordId}`);
  console.log(`  - snapshotId: ${result4.canonicalRecord?.provenance.snapshotId}`);
  console.log(`  - mappingId: ${result4.canonicalRecord?.provenance.mappingId}`);
  console.log(`  - transformId: ${result4.canonicalRecord?.provenance.transformId}`);
  console.log(`  - pipelineId: ${result4.canonicalRecord?.provenance.pipelineId}`);
  console.log(`  - ingestedAt: ${result4.canonicalRecord?.provenance.ingestedAt}`);
  
  console.log('\nMeta details:');
  console.log(`  - schemaVersion: ${result4.canonicalRecord?.meta.schemaVersion}`);
  console.log(`  - createdAt: ${result4.canonicalRecord?.meta.createdAt}`);
  console.log(`  - updatedAt: ${result4.canonicalRecord?.meta.updatedAt}`);
}

// Example 5: All valid types
console.log('\n\n=== Example 5: All Valid Canonical Types ===\n');

const validTypes = ['Object', 'Work', 'Agent', 'Place', 'Event', 'Media'] as const;

(async () => {
  for (const type of validTypes) {
    const draft: Partial<CanonicalRecord> = {
      id: `test_${type.toLowerCase()}`,
      type: type as any,
      label: `Test ${type}`,
    };

    const result = await finalizeCanonicalRecord(draft, sourceRecord, mockMapping, undefined, mockContext);

    if (result.success) {
      console.log(`✅ ${type}: Valid`);
    } else {
      console.log(`❌ ${type}: Failed`);
    }
  }

  console.log('\n=== Demo Complete ===\n');
})();
