/**
 * Deterministic hashing utilities for mapping engine.
 * 
 * Provides stable JSON canonicalization and SHA-256 hashing to ensure
 * identical inputs produce identical hashes regardless of object key order,
 * whitespace, or other non-semantic differences.
 */

/**
 * Canonicalize a JSON value into a stable string representation.
 * 
 * Rules:
 * - Objects: Sort keys alphabetically, recursively canonicalize values
 * - Arrays: Preserve order, recursively canonicalize elements
 * - Primitives: JSON stringify (null, boolean, number, string)
 * - undefined: Convert to null
 * 
 * @param value - Any JSON-serializable value
 * @returns Canonical string representation
 */
function canonicalizeJSON(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map(item => canonicalizeJSON(item));
    return `[${items.join(',')}]`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys.map(key => {
      const canonicalKey = JSON.stringify(key);
      const canonicalValue = canonicalizeJSON(obj[key]);
      return `${canonicalKey}:${canonicalValue}`;
    });
    return `{${pairs.join(',')}}`;
  }

  // Fallback for functions, symbols, etc.
  return 'null';
}

/**
 * Compute a stable SHA-256 hash of a JSON value.
 * 
 * Canonicalizes the input to ensure deterministic output:
 * - Object keys are sorted alphabetically
 * - Whitespace is normalized
 * - Same semantic value always produces same hash
 * 
 * Use cases:
 * - Canonical record provenance hashing
 * - Projection payload fingerprinting
 * - Content-addressable storage keys
 * 
 * @param value - Any JSON-serializable value
 * @returns Hex-encoded SHA-256 hash (64 characters)
 * 
 * @example
 * ```ts
 * // These produce identical hashes:
 * stableHash({ b: 2, a: 1 })
 * stableHash({ a: 1, b: 2 })
 * 
 * // Provenance hash
 * const hash = stableHash({
 *   sourceId: record.id,
 *   mappingId: mapping.id,
 *   transformId: pipeline?.id || 'none'
 * });
 * ```
 */
export async function stableHash(value: unknown): Promise<string> {
  const canonical = canonicalizeJSON(value);
  
  // Use Web Crypto API for SHA-256
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  
  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex;
}

/**
 * Compute provenance hash for a canonical record.
 * 
 * Combines source identity, mapping, and transform into a single hash
 * that uniquely identifies the transformation lineage.
 * 
 * Excludes timestamps to ensure deterministic hashing.
 * 
 * @param sourceId - Source record identifier
 * @param mappingId - Mapping configuration identifier
 * @param transformId - Transform pipeline identifier (or 'none')
 * @returns Hex-encoded SHA-256 hash
 */
export async function hashProvenance(
  sourceId: string,
  mappingId: string,
  transformId: string
): Promise<string> {
  return stableHash({
    sourceId,
    mappingId,
    transformId,
  });
}

/**
 * Compute projection payload hash for deterministic fingerprinting.
 * 
 * Creates a content-addressable hash of the projection output,
 * excluding metadata timestamps.
 * 
 * @param projection - Projection payload (source or destination format)
 * @param snapshotId - Snapshot identifier for provenance
 * @param mappingId - Mapping identifier (or 'none' for source mode)
 * @returns Hex-encoded SHA-256 hash
 */
export async function hashProjection(
  projection: unknown,
  snapshotId: string,
  mappingId: string | undefined
): Promise<string> {
  return stableHash({
    projection,
    snapshotId,
    mappingId: mappingId || 'none',
  });
}
