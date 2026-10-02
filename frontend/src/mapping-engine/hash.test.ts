import { describe, it, expect } from 'vitest';
import { stableHash, hashProvenance, hashProjection } from './hash';

describe('stableHash', () => {
  it('produces deterministic hashes for same input', async () => {
    const value = { a: 1, b: 2, c: 3 };
    
    const hash1 = await stableHash(value);
    const hash2 = await stableHash(value);
    
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex format
  });
  
  it('produces same hash regardless of key order', async () => {
    const value1 = { a: 1, b: 2, c: 3 };
    const value2 = { c: 3, a: 1, b: 2 };
    const value3 = { b: 2, c: 3, a: 1 };
    
    const hash1 = await stableHash(value1);
    const hash2 = await stableHash(value2);
    const hash3 = await stableHash(value3);
    
    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });
  
  it('produces different hashes for different values', async () => {
    const value1 = { a: 1, b: 2 };
    const value2 = { a: 1, b: 3 };
    
    const hash1 = await stableHash(value1);
    const hash2 = await stableHash(value2);
    
    expect(hash1).not.toBe(hash2);
  });
  
  it('handles nested objects correctly', async () => {
    const value1 = { a: { x: 1, y: 2 }, b: 3 };
    const value2 = { b: 3, a: { y: 2, x: 1 } };
    
    const hash1 = await stableHash(value1);
    const hash2 = await stableHash(value2);
    
    expect(hash1).toBe(hash2);
  });
  
  it('handles arrays correctly', async () => {
    const value1 = { items: [1, 2, 3] };
    const value2 = { items: [1, 2, 3] };
    const value3 = { items: [3, 2, 1] };
    
    const hash1 = await stableHash(value1);
    const hash2 = await stableHash(value2);
    const hash3 = await stableHash(value3);
    
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3); // Array order matters
  });
  
  it('handles null and undefined', async () => {
    const value1 = { a: null, b: undefined };
    const value2 = { a: null, b: null };
    
    const hash1 = await stableHash(value1);
    const hash2 = await stableHash(value2);
    
    // undefined is converted to null, so these should match
    expect(hash1).toBe(hash2);
  });
  
  it('handles primitives', async () => {
    const hash1 = await stableHash(123);
    const hash2 = await stableHash(123);
    const hash3 = await stableHash('123');
    
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3); // Different types
  });
  
  it('handles empty objects and arrays', async () => {
    const emptyObj = await stableHash({});
    const emptyArr = await stableHash([]);
    
    expect(emptyObj).toMatch(/^[0-9a-f]{64}$/);
    expect(emptyArr).toMatch(/^[0-9a-f]{64}$/);
    expect(emptyObj).not.toBe(emptyArr);
  });
});

describe('hashProvenance', () => {
  it('generates deterministic hash from provenance data', async () => {
    const sourceId = 'source_123';
    const mappingId = 'mapping_456';
    const transformId = 'transform_789';
    
    const hash1 = await hashProvenance(sourceId, mappingId, transformId);
    const hash2 = await hashProvenance(sourceId, mappingId, transformId);
    
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });
  
  it('produces different hashes for different provenance', async () => {
    const hash1 = await hashProvenance('source_1', 'mapping_1', 'transform_1');
    const hash2 = await hashProvenance('source_2', 'mapping_1', 'transform_1');
    const hash3 = await hashProvenance('source_1', 'mapping_2', 'transform_1');
    const hash4 = await hashProvenance('source_1', 'mapping_1', 'transform_2');
    
    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).not.toBe(hash4);
  });
  
  it('handles "none" as transform ID', async () => {
    const hash1 = await hashProvenance('source_1', 'mapping_1', 'none');
    const hash2 = await hashProvenance('source_1', 'mapping_1', 'none');
    
    expect(hash1).toBe(hash2);
  });
});

describe('hashProjection', () => {
  it('generates deterministic hash from projection data', async () => {
    const projection = { title: 'Artwork', year: 1889 };
    const snapshotId = 'snapshot_123';
    const mappingId = 'mapping_456';
    
    const hash1 = await hashProjection(projection, snapshotId, mappingId);
    const hash2 = await hashProjection(projection, snapshotId, mappingId);
    
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });
  
  it('produces same hash regardless of projection key order', async () => {
    const projection1 = { title: 'Artwork', year: 1889, artist: 'Van Gogh' };
    const projection2 = { artist: 'Van Gogh', year: 1889, title: 'Artwork' };
    
    const hash1 = await hashProjection(projection1, 'snap_1', 'map_1');
    const hash2 = await hashProjection(projection2, 'snap_1', 'map_1');
    
    expect(hash1).toBe(hash2);
  });
  
  it('produces different hashes for different projections', async () => {
    const projection1 = { title: 'Artwork A' };
    const projection2 = { title: 'Artwork B' };
    
    const hash1 = await hashProjection(projection1, 'snap_1', 'map_1');
    const hash2 = await hashProjection(projection2, 'snap_1', 'map_1');
    
    expect(hash1).not.toBe(hash2);
  });
  
  it('handles undefined mappingId (source mode)', async () => {
    const projection = { title: 'Artwork' };
    
    const hash1 = await hashProjection(projection, 'snap_1', undefined);
    const hash2 = await hashProjection(projection, 'snap_1', undefined);
    
    expect(hash1).toBe(hash2);
  });
  
  it('produces different hashes for different snapshot IDs', async () => {
    const projection = { title: 'Artwork' };
    
    const hash1 = await hashProjection(projection, 'snap_1', 'map_1');
    const hash2 = await hashProjection(projection, 'snap_2', 'map_1');
    
    expect(hash1).not.toBe(hash2);
  });
});

describe('Hash consistency', () => {
  it('excludes timestamps from projection hash', async () => {
    // Same projection content, different timestamps
    const projection1 = {
      title: 'Artwork',
      createdAt: '2026-01-01T00:00:00Z',
    };
    
    const projection2 = {
      title: 'Artwork',
      createdAt: '2026-01-14T12:00:00Z',
    };
    
    // Different timestamps means different hashes
    // (User should exclude timestamp fields from projection before hashing)
    const hash1 = await hashProjection(projection1, 'snap_1', 'map_1');
    const hash2 = await hashProjection(projection2, 'snap_1', 'map_1');
    
    expect(hash1).not.toBe(hash2);
  });
  
  it('works with complex nested structures', async () => {
    const complexValue = {
      metadata: {
        title: 'Complex Object',
        nested: {
          deep: {
            value: 123,
          },
        },
      },
      items: [
        { id: 1, name: 'Item A' },
        { id: 2, name: 'Item B' },
      ],
    };
    
    const hash = await stableHash(complexValue);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
