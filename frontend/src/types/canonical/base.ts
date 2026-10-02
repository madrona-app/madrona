/**
 * Madrona Canonical Schema v1 — Core Type Definitions
 *
 * This module defines the strongly-typed structure of the Madrona Canonical Record,
 * which serves as the stable developer-facing envelope for all entity data flowing
 * through the system.
 *
 * DESIGN PRINCIPLES:
 * - Stable API contract that isolates consumers from source format changes
 * - Minimal required fields, extensible optional fields
 * - All fields are JSON-serializable (no functions, Dates as ISO strings)
 * - Namespaced properties and extensions to prevent collision
 *
 * @see backend/app/models.py - EntityCurrent table implements this schema
 * @see backend/app/services/canonical_store.py - Core ingestion logic
 */

// ============================================================================
// API DOCUMENTATION — DEVELOPER GUIDE
// ============================================================================

/**
 * # MADRONA CANONICAL SCHEMA — DEVELOPER GUIDE
 *
 * ## What is a CanonicalRecord?
 *
 * A **CanonicalRecord** is Madrona's stable, developer-facing representation of
 * an entity (artwork, specimen, document, person, etc.). Think of it as a
 * normalized API response format that remains consistent regardless of which
 * source system the data originated from.
 *
 * ### CanonicalRecord IS:
 * - **Stable API contract**: Field names and structure don't change with source updates
 * - **Normalized schema**: Same structure whether data comes from Airtable, Salesforce, or PostgreSQL
 * - **Queryable**: Optimized for fast retrieval, filtering, and display
 * - **Versioned**: Schema version field enables safe evolution and migration
 * - **Traceable**: Provenance links back to source data for audit and debugging
 *
 * ### CanonicalRecord IS NOT:
 * - **Raw source data**: Source payloads are stored separately (see SourceRecord)
 * - **Real-time view**: It's a snapshot; use `provenance.ingestedAt` to check freshness
 * - **Complete lineage**: No per-field lineage (see "Why No Field-Level Lineage" below)
 * - **Source-specific**: Avoid embedding source system IDs directly; use `identifiers[]`
 *
 * ### API Integration Pattern:
 * ```typescript
 * // Fetch canonical records
 * GET /api/entities?type=Object&limit=20
 * → Array<CanonicalRecord>
 *
 * // Fetch single record with optional mapping report
 * GET /api/entities/{id}?include_mapping_report=true
 * → { record: CanonicalRecord, report?: MappingReport }
 *
 * // Query by identifier from source system
 * GET /api/entities?identifier=accession-number:2024.15.1
 * → Array<CanonicalRecord>
 * ```
 *
 * ---
 *
 * ## How SourceRecords Relate to CanonicalRecords
 *
 * **SourceRecords** are immutable snapshots of raw source data at the moment
 * of ingestion. They provide the reproducibility foundation for the entire system.
 *
 * ### Relationship Model:
 * ```
 * SourceRecord (immutable, raw)
 *      ↓ [snapshotId reference]
 * CanonicalRecord.provenance.snapshotId
 *      ↓ [points to]
 * SourceRecord.id
 * ```
 *
 * ### Key Points:
 * - **Separation of concerns**: Source data (SourceRecord) vs. canonical data (CanonicalRecord)
 * - **Reference, don't embed**: Canonical records reference snapshots, never embed raw data
 * - **Immutability**: SourceRecords never change; re-ingestion creates new snapshots
 * - **Reproducibility**: f(SourceRecord, Mapping, Transform) = CanonicalRecord (deterministic)
 *
 * ### Storage Model:
 * - **CanonicalRecords**: Hot storage, frequently queried, lean structure (~5-20KB each)
 * - **SourceRecords**: Warm/cold storage, accessed for debugging/replay, can be large (50KB+)
 * - **Compression**: SourceRecords can be compressed or archived after transformation
 *
 * ### API Access:
 * ```typescript
 * // Get canonical record
 * GET /api/entities/{canonicalId}
 * → CanonicalRecord (includes provenance.snapshotId)
 *
 * // Get original source data for debugging
 * GET /api/source-records/{snapshotId}
 * → SourceRecord (with raw source payload)
 *
 * // Re-project source with new mapping
 * POST /api/projections
 * {
 *   mode: "destination",
 *   snapshotId: "snap_abc123",
 *   mappingId: "mapping_v2.0.0"
 * }
 * → ProjectionResponse (new canonical without persisting)
 * ```
 *
 * ---
 *
 * ## How Mappings and Projections Work
 *
 * ### Mappings:
 * A **Mapping** is a versioned configuration that defines how to translate source
 * system fields into canonical fields. Think of it as a schema crosswalk or ETL rule set.
 *
 * **Key characteristics:**
 * - **Versioned**: Semantic versioning (1.0.0, 1.1.0, 2.0.0)
 * - **Retrievable**: Historical mapping versions remain accessible
 * - **Referenced**: CanonicalRecord stores `provenance.mappingId`, not the mapping itself
 * - **Immutable**: Updating creates a new version; old records keep old mappings
 *
 * **Example mapping rule (conceptual):**
 * ```
 * source.fields.Title → canonical.label
 * source.fields.Artist[0] → canonical.properties.creator
 * source.fields.Date → canonical.dates.created (parse to ISO 8601)
 * ```
 *
 * ### Projections:
 * A **Projection** is an on-demand transformation that renders source data into a
 * target format (canonical, export schema, etc.) without persisting the result.
 *
 * **Use cases:**
 * - **Preview**: "What would this source record look like in canonical format?"
 * - **Testing**: "Does my new mapping v2 produce correct output?"
 * - **Migration**: "How would all old records transform with the new mapping?"
 * - **Export**: "Generate MARC21 format for this canonical record"
 *
 * **Projection modes:**
 * - `source`: Return raw source data (useful for "view source" debugging)
 * - `destination`: Transform source → canonical (or other target schema)
 *
 * **Determinism guarantee:**
 * Given the same `snapshotId` + `mappingId`, projections produce identical output.
 * This enables reliable testing and verification of transformation logic.
 *
 * ### Workflow:
 * ```typescript
 * // 1. Test new mapping with projection (ephemeral)
 * POST /api/projections
 * {
 *   mode: "destination",
 *   snapshotId: "snap_abc123",
 *   mappingId: "map_new_v2",
 * }
 * → ProjectionResponse (review output, not persisted)
 *
 * // 2. If satisfied, persist projection to canonical store
 * POST /api/entities
 * { ...projectionResponse.projection }
 * → CanonicalRecord (now persisted and queryable)
 *
 * // 3. Or batch re-project all records with new mapping
 * POST /api/migrations/re-project
 * {
 *   sourceCriteria: { system: "cms", dataset: "artworks" },
 *   mappingId: "mapping_v2.0.0"
 * }
 * → Job { id, status, progress }
 * ```
 *
 * ---
 *
 * ## Why Field-Level Lineage is Intentionally Excluded
 *
 * You'll notice that Madrona **does not track** which source fields mapped to
 * which canonical fields for each record. This is a deliberate design decision.
 *
 * ### The Problem with Field-Level Lineage:
 * - **Storage explosion**: Every field needs lineage metadata (source, mapping rule, timestamp)
 * - **Complexity**: Multi-step transforms make lineage graphs complex and brittle
 * - **Maintenance burden**: Lineage breaks when mappings change or fields are renamed
 * - **Query performance**: Lineage data bloats records and slows queries
 * - **Diminishing returns**: Most debugging needs are met by record-level provenance
 *
 * ### Madrona's Alternative: Reproducibility
 * Instead of storing field lineage, we enable **deterministic replay**:
 *
 * 1. **Record-level provenance**: Know which snapshot, mapping, and transform produced this record
 * 2. **Immutable snapshots**: Source data frozen in time (SourceRecord)
 * 3. **Versioned mappings**: Retrieve the exact mapping configuration used
 * 4. **Deterministic transforms**: Re-execute transform(source, mapping) → same output
 *
 * ### Debugging Workflow (Without Field Lineage):
 * ```typescript
 * // User: "Why does canonical.label show 'Untitled'? The source has a title."
 *
 * // 1. Get canonical record with provenance
 * GET /api/entities/{id}
 * → { label: "Untitled", provenance: { snapshotId: "snap_abc", mappingId: "map_v1" } }
 *
 * // 2. Retrieve original source data
 * GET /api/source-records/snap_abc
 * → { raw: { title: "The Starry Night", ... } }
 *
 * // 3. Retrieve mapping configuration
 * GET /api/mappings/map_v1
 * → { rules: [ { source: "title", target: "label", ... } ] }
 *
 * // 4. Re-project with debug logging
 * POST /api/projections?debug=true
 * { snapshotId: "snap_abc", mappingId: "map_v1" }
 * → Logs show: "Rule 'title→label' executed but source.title was empty string"
 *
 * // Result: Source had empty title, not missing. Mapping working correctly.
 * ```
 *
 * ### What You Get Instead:
 * - **MappingReport**: High-level transform summary (status, warnings, rule stats)
 * - **Provenance IDs**: Direct links to source, mapping, and transform configs
 * - **Projection API**: Re-execute transforms on-demand with debug output
 * - **Fast queries**: Canonical records stay lean and fast without lineage overhead
 *
 * ### When You Need More Detail:
 * If you need field-level lineage for specific use cases:
 * - Use `MappingReport.warnings` to surface common field issues
 * - Add custom lineage to `extensions` for critical fields
 * - Use projection API with debug mode for forensic analysis
 * - Consider source-specific lineage in SourceRecord.meta for specialized needs
 *
 * ---
 *
 * ## Quick Reference
 *
 * | Resource         | Purpose                           | Mutability | Storage  |
 * |------------------|-----------------------------------|------------|----------|
 * | SourceRecord     | Raw source data snapshot          | Immutable  | Warm/cold|
 * | CanonicalRecord  | Normalized entity representation  | Versioned  | Hot      |
 * | Mapping          | Field transformation rules        | Versioned  | Config   |
 * | TransformPipeline| Execution logic (validate, enrich)| Versioned  | Config   |
 * | MappingReport    | Transform diagnostic summary      | Ephemeral  | Optional |
 * | ProjectionResponse| On-demand transform output       | Ephemeral  | None     |
 *
 * ## Integration Checklist
 *
 * - [ ] Query canonical records via REST API (GET /api/entities)
 * - [ ] Parse CanonicalRecord.provenance for source traceability
 * - [ ] Use CanonicalRecord.meta.schemaVersion for version handling
 * - [ ] Access source data via provenance.snapshotId when debugging
 * - [ ] Request MappingReport (?include_mapping_report=true) for quality checks
 * - [ ] Use projection API to preview transform changes before persisting
 * - [ ] Validate records with Zod schemas (CanonicalRecordSchema)
 * - [ ] Enforce invariants (validateCanonicalRecordForAPI) at API boundaries
 *
 * ## Further Reading
 *
 * - Canonical Record Type Registry: See CanonicalRecordType enum below
 * - Provenance Model: See Provenance interface documentation
 * - Extensions Guide: See Extension interface for domain-specific data
 * - Validation Guide: See runtime validation schemas and helpers
 */

/**
 * Immutable snapshot of source data at time of ingestion.
 *
 * SourceRecords provide lossless preservation of original source data,
 * enabling reproducibility, re-projection, and auditing of transformations.
 *
 * CRITICAL DESIGN PRINCIPLES (v1):
 *
 * SOURCE RECORDS ARE IMMUTABLE ONCE WRITTEN
 * - Once captured, a SourceRecord never changes
 * - New source data creates a new SourceRecord with a new id
 * - Immutability ensures transformation reproducibility
 * - Historical snapshots remain accessible for audit and replay
 * - Updates to source systems create new snapshots, don't overwrite old ones
 *
 * CANONICAL RECORDS MUST REFERENCE SOURCE RECORDS, NEVER EMBED
 * - CanonicalRecord.provenance.snapshotId points to SourceRecord.id
 * - Source data is stored separately from canonical data
 * - This prevents data duplication and keeps canonical records lean
 * - Source records can be large (full API responses, database rows)
 * - Canonical records should be fast to query and serialize
 * - Reference model allows source records to be archived/compressed
 *
 * SOURCE RECORDS ENABLE REPRODUCIBILITY AND RE-PROJECTION
 * - Reproducibility: f(sourceRecord, mapping, transform) = canonical
 * - Re-projection: Change mapping/transform, replay source → get new canonical
 * - Debugging: Compare source → canonical to diagnose transform issues
 * - Migration: Re-transform all source records with updated logic
 * - Audit: Prove canonical data accurately reflects source data
 *
 * USAGE PATTERNS:
 *
 * 1. INGESTION FLOW:
 *    - Fetch data from source system (API, database, file)
 *    - Create immutable SourceRecord with raw data
 *    - Write SourceRecord to storage (returns snapshotId)
 *    - Transform source → canonical
 *    - Write CanonicalRecord with provenance.snapshotId
 *
 * 2. DEBUGGING FLOW:
 *    - User reports issue with CanonicalRecord
 *    - Look up provenance.snapshotId
 *    - Retrieve SourceRecord.raw
 *    - Re-execute transform(sourceRecord, mapping)
 *    - Compare output to current canonical
 *    - Identify discrepancy in transform logic
 *
 * 3. MIGRATION FLOW:
 *    - Update mapping or transform logic
 *    - Query all SourceRecords for source system
 *    - Re-transform each sourceRecord.raw → new canonical
 *    - Write updated CanonicalRecords (new provenance.ingestedAt)
 *    - Original SourceRecords remain unchanged
 *
 * STORAGE CONSIDERATIONS:
 * - Source records can be large (full API responses, wide database rows)
 * - Consider compression for storage efficiency
 * - May archive old source records to cold storage
 * - Keep recent source records hot for rapid replay
 * - Index by source system + recordId for fast lookup
 */
export interface SourceRecord {
  /**
   * Unique identifier for this source record snapshot.
   *
   * This is the snapshotId referenced by CanonicalRecord.provenance.snapshotId.
   *
   * Format recommendations:
   * - UUID: "snap_abc123-def456-..."
   * - Composite: "snap_{source}_{timestamp}_{recordId}"
   * - Hash: "snap_sha256_{contentHash}"
   *
   * Must be globally unique across all source records.
   */
  id: string;

  /**
   * Source system identification.
   *
   * Identifies which external system this source record came from.
   * Should match the values used in CanonicalRecord.provenance.system.
   *
   * Structure:
   * - `system`: Source system identifier (e.g., "airtable", "emuseum")
   * - `dataset`: Optional dataset/table/collection within the system
   * - `recordId`: The primary key or unique ID in the source system
   *
   * Examples:
   * ```typescript
   * { system: "airtable", dataset: "appABC123", recordId: "recXYZ789" }
   * { system: "postgres", dataset: "public.objects", recordId: "12345" }
   * { system: "api", recordId: "obj_abc123" }
   * ```
   */
  source: {
    system: string;
    dataset?: string;
    recordId: string;
  };

  /**
   * ISO 8601 timestamp when this source record was captured.
   *
   * This is when the data was extracted/fetched from the source system,
   * not when the entity was created in the source system.
   *
   * Example: "2024-01-15T14:30:00Z"
   *
   * Use for:
   * - Determining source data freshness
   * - Selecting which snapshot to use for replay
   * - Audit trails showing when source was captured
   */
  capturedAt: string;

  /**
   * Raw source data, preserved exactly as received.
   *
   * This is the lossless snapshot of the source record. Must be JSON-serializable.
   *
   * STRUCTURE DEPENDS ON SOURCE TYPE:
   *
   * API-based sources:
   * - Full API response payload (JSON object or array)
   * - May include nested objects, arrays, null values
   * - Preserve exact field names (camelCase, snake_case, etc.)
   *
   * Database-based sources:
   * - Row data as key-value object
   * - Field names match database column names
   * - Values in native JSON types (string, number, boolean, null)
   *
   * File-based sources:
   * - Parsed file content (CSV → array of objects, XML → parsed structure)
   * - May include file metadata (filename, size, mime type)
   *
   * Examples:
   * ```typescript
   * // API source (Airtable)
   * {
   *   id: "recXYZ789",
   *   fields: {
   *     "Title": "The Starry Night",
   *     "Artist": ["recABC123"],
   *     "Date": "1889-06-01",
   *     "Dimensions": { width: 73.7, height: 92.1, unit: "cm" }
   *   },
   *   createdTime: "2023-01-01T00:00:00.000Z"
   * }
   *
   * // Database source (PostgreSQL)
   * {
   *   object_id: 12345,
   *   title: "The Starry Night",
   *   artist_id: 67,
   *   date_created: "1889-06-01",
   *   width_cm: 73.7,
   *   height_cm: 92.1,
   *   created_at: "2023-01-01T00:00:00Z",
   *   updated_at: "2024-01-15T10:30:00Z"
   * }
   * ```
   *
   * CRITICAL: This must be the exact data received from the source.
   * Do not normalize, transform, or clean the data before storing.
   * Transformations happen in the mapping/transform layer, not here.
   */
  raw: Record<string, any>;

  /**
   * Metadata about this source record snapshot.
   *
   * System-managed fields describing the capture context and data properties.
   *
   * Common fields:
   * - `contentHash`: Cryptographic hash of the raw data for deduplication
   * - `byteSize`: Size of the raw data in bytes
   * - `compressionType`: If compressed (e.g., "gzip", "brotli")
   * - `sourceVersion`: API version or database schema version
   * - `extractionMethod`: How data was captured (e.g., "api", "sql", "file")
   *
   * Example:
   * ```typescript
   * {
   *   contentHash: "sha256:abc123...",
   *   byteSize: 4096,
   *   sourceVersion: "api-v2",
   *   extractionMethod: "rest-api"
   * }
   * ```
   */
  meta: Record<string, any>;
}

/**
 * Field mapping configuration defining how to transform source data to canonical format.
 *
 * Mappings are versioned, immutable configurations that define the schema translation
 * from source system fields to canonical record fields.
 *
 * CRITICAL DESIGN PRINCIPLES (v1):
 *
 * CANONICAL RECORDS STORE ONLY IDS OF MAPPINGS/TRANSFORMS
 * - CanonicalRecord.provenance.mappingId references Mapping.id
 * - The mapping configuration is NOT embedded in the canonical record
 * - This keeps canonical records lean and focused on entity data
 * - Mapping configurations can be large (hundreds of field rules)
 * - Storing IDs allows mapping configurations to be updated independently
 *
 * MAPPINGS/TRANSFORMS ARE VERSIONED AND RETRIEVABLE
 * - Each mapping has a unique id + version identifier
 * - Versions use semantic versioning (1.0.0, 1.1.0, 2.0.0)
 * - Historical mapping versions remain accessible for audit and replay
 * - Can retrieve the exact mapping used to produce any canonical record
 * - Reproducibility guarantee: mapping + source → same canonical output
 *
 * CHANGING MAPPINGS DOES NOT RETROACTIVELY CHANGE CANONICAL RECORDS
 * - Updating a mapping creates a new version, doesn't modify existing records
 * - Existing canonical records continue referencing old mapping versions
 * - To apply new mapping: re-transform source records → new canonical records
 * - This is an explicit, observable operation (not a silent background change)
 * - Canonical records are snapshots, not live views of source data
 *
 * USAGE PATTERN:
 * 1. Create mapping configuration (source schema → canonical schema)
 * 2. Version the mapping (e.g., "smithsonian_v1.0.0")
 * 3. Transform source records using this mapping
 * 4. Canonical records store provenance.mappingId = mapping.id
 * 5. Update mapping → create new version (e.g., "smithsonian_v1.1.0")
 * 6. New transforms use new version; existing records unchanged
 * 7. Optional: Re-transform existing source records with new mapping
 */
export interface Mapping {
  /**
   * Unique identifier for this mapping configuration.
   *
   * This is the mappingId referenced by CanonicalRecord.provenance.mappingId.
   *
   * Format recommendations:
   * - Namespaced: "mapping_{source}_{name}"
   * - UUID: "map_abc123-def456-..."
   * - Semantic: "smithsonian_dublin_core_v1"
   *
   * Must be globally unique across all mappings.
   */
  id: string;

  /**
   * Source schema or system this mapping applies to.
   *
   * Identifies which source system's data structure this mapping handles.
   * Should match SourceRecord.source.system values.
   *
   * Examples:
   * - "airtable": Maps Airtable field structures
   * - "emuseum": Maps eMuseum API responses
   * - "postgres": Maps database table schema
   * - "google-sheets": Maps spreadsheet columns
   *
   * Allows filtering mappings by source system.
   */
  source: string;

  /**
   * Target schema this mapping produces.
   *
   * For Madrona canonical mappings, this is typically "canonical" or
   * the specific canonical schema version.
   *
   * Examples:
   * - "canonical": Standard Madrona canonical schema
   * - "canonical-v1": Specific schema version
   * - "dublin-core": Maps to Dublin Core elements
   * - "cidoc-crm": Maps to CIDOC-CRM classes
   *
   * Allows supporting multiple target schemas from the same source.
   */
  target: string;

  /**
   * Version identifier for this mapping configuration.
   *
   * Use semantic versioning to track mapping evolution:
   * - Major (1.0.0 → 2.0.0): Breaking changes, incompatible field mappings
   * - Minor (1.0.0 → 1.1.0): Additive changes, new field mappings
   * - Patch (1.0.0 → 1.0.1): Bug fixes, documentation updates
   *
   * Examples:
   * - "1.0.0": Initial mapping release
   * - "1.1.0": Added new optional field mappings
   * - "2.0.0": Restructured core field mappings (breaking)
   *
   * Version increments create new mapping records; old versions remain accessible.
   */
  version: string;

  /**
   * ISO 8601 timestamp when this mapping version was created.
   *
   * Immutable timestamp marking when this mapping configuration was defined.
   *
   * Example: "2024-01-15T14:30:00Z"
   *
   * Use for:
   * - Audit trails (when did this mapping version appear?)
   * - Temporal queries (which mappings existed at time T?)
   * - Migration planning (how old are our mappings?)
   */
  createdAt: string;
}

/**
 * Transformation pipeline configuration defining execution steps.
 *
 * TransformPipelines are versioned, executable configurations that specify
 * how to process source data through a series of transformation steps.
 *
 * CRITICAL DESIGN PRINCIPLES (v1):
 *
 * CANONICAL RECORDS STORE ONLY IDS OF MAPPINGS/TRANSFORMS
 * - CanonicalRecord.provenance.transformId references TransformPipeline.id
 * - The transform logic is NOT embedded in the canonical record
 * - This keeps canonical records lean and focused on entity data
 * - Transform pipelines can be complex (multiple steps, conditional logic)
 * - Storing IDs allows transform pipelines to be updated independently
 *
 * MAPPINGS/TRANSFORMS ARE VERSIONED AND RETRIEVABLE
 * - Each transform has a unique id + version identifier
 * - Versions use semantic versioning (1.0.0, 1.1.0, 2.0.0)
 * - Historical transform versions remain accessible for audit and replay
 * - Can retrieve the exact transform used to produce any canonical record
 * - Reproducibility guarantee: transform + mapping + source → same canonical output
 *
 * CHANGING TRANSFORMS DOES NOT RETROACTIVELY CHANGE CANONICAL RECORDS
 * - Updating a transform creates a new version, doesn't modify existing records
 * - Existing canonical records continue referencing old transform versions
 * - To apply new transform: re-transform source records → new canonical records
 * - This is an explicit, observable operation (not a silent background change)
 * - Canonical records are snapshots, not live views
 *
 * USAGE PATTERN:
 * 1. Create transform pipeline (sequence of processing steps)
 * 2. Version the transform (e.g., "enrich_v1.0.0")
 * 3. Execute transform on source records (with mapping)
 * 4. Canonical records store provenance.transformId = transform.id
 * 5. Update transform → create new version (e.g., "enrich_v1.1.0")
 * 6. New executions use new version; existing records unchanged
 * 7. Optional: Re-transform existing source records with new transform
 */
export interface TransformPipeline {
  /**
   * Unique identifier for this transform pipeline.
   *
   * This is the transformId referenced by CanonicalRecord.provenance.transformId.
   *
   * Format recommendations:
   * - Namespaced: "transform_{name}_{version}"
   * - UUID: "txf_abc123-def456-..."
   * - Semantic: "smithsonian_enrich_v1"
   *
   * Must be globally unique across all transform pipelines.
   */
  id: string;

  /**
   * Version identifier for this transform pipeline.
   *
   * Use semantic versioning to track transform evolution:
   * - Major (1.0.0 → 2.0.0): Breaking changes, incompatible logic
   * - Minor (1.0.0 → 1.1.0): Additive changes, new processing steps
   * - Patch (1.0.0 → 1.0.1): Bug fixes, performance improvements
   *
   * Examples:
   * - "1.0.0": Initial transform release
   * - "1.1.0": Added enrichment step
   * - "2.0.0": Restructured processing pipeline (breaking)
   *
   * Version increments create new transform records; old versions remain accessible.
   */
  version: string;

  /**
   * Ordered sequence of transformation steps.
   *
   * Each step represents a discrete processing operation in the pipeline.
   * Steps execute sequentially; output of step N becomes input to step N+1.
   *
   * Step structure is flexible; common patterns:
   * ```typescript
   * [
   *   { type: "map", mappingId: "map_abc123" },
   *   { type: "validate", schema: "canonical-v1" },
   *   { type: "enrich", service: "wikidata-lookup" },
   *   { type: "normalize", rules: ["trim", "lowercase"] },
   *   { type: "classify", taxonomy: "aat" }
   * ]
   * ```
   *
   * Each step should be:
   * - Deterministic: Same input → same output
   * - Idempotent: Can be re-run safely
   * - Testable: Can be validated independently
   *
   * The steps array is the executable specification of the transform.
   * Together with the mapping and source data, it defines the canonical output.
   */
  steps: Array<Record<string, any>>;
}

/**
 * Debug artifact summarizing how a canonical record was produced.
 *
 * MappingReport provides lightweight transformation diagnostics without the
 * expense and complexity of per-field lineage tracking. It's designed for
 * debugging, auditing, and understanding transformation behavior.
 *
 * CRITICAL DESIGN PRINCIPLES (v1):
 *
 * MAPPING REPORT REPLACES FIELD-LEVEL LINEAGE
 * - Traditional lineage: Track which source field mapped to each canonical field
 * - Problem: Expensive to compute, expensive to store, brittle to maintain
 * - Solution: High-level transformation summary + reproducibility via replay
 *
 * - MappingReport tells you:
 *   ✓ Which pipeline components produced this record (route, snapshot, mapping, transform)
 *   ✓ Whether transformation succeeded, partially succeeded, or failed
 *   ✓ Which mapping rules executed and their outcomes
 *   ✓ High-level summary of what changed (fields added, transformed, dropped)
 *   ✓ Warnings and issues encountered during transformation
 *
 * - MappingReport does NOT tell you:
 *   ✗ Exact field-to-field lineage (use mapping config + replay for that)
 *   ✗ Byte-level diffs of transformations
 *   ✗ Complete history of all field modifications
 *
 * For detailed lineage questions, the workflow is:
 * 1. Look at MappingReport to understand high-level transformation
 * 2. Retrieve source record via provenance.snapshotId
 * 3. Retrieve mapping config via provenance.mappingId
 * 4. Retrieve transform config via provenance.transformId
 * 5. Re-execute transform with debug logging to see exact field mappings
 *
 * MAPPING REPORT IS OPTIONAL AND INCLUDED VIA QUERY PARAMETER
 * - By default: GET /entities/{id} returns only the canonical record
 * - With report: GET /entities/{id}?include_mapping_report=true returns record + report
 * - This keeps default responses fast and lean
 * - Only include report when needed for debugging or audit
 * - Reports can be generated on-demand or cached with canonical records
 *
 * MAPPING REPORT MUST BE SAFE TO EXPOSE TO API CONSUMERS
 * - No sensitive credentials or API keys
 * - No internal system details that could be exploited
 * - No PII unless already in canonical record
 * - Sanitized error messages (no stack traces, file paths)
 * - Safe for external partners and third-party developers
 * - Suitable for public API responses
 *
 * USAGE PATTERNS:
 *
 * 1. DEBUGGING FAILED TRANSFORMATIONS:
 *    - Transformation fails or produces unexpected output
 *    - Retrieve MappingReport to see status and warnings
 *    - Check rule execution summary for failed rules
 *    - Review warnings for missing required fields or type mismatches
 *    - Use provenance IDs to retrieve source data and replay with debug logs
 *
 * 2. AUDITING DATA QUALITY:
 *    - Generate MappingReport for sample of records
 *    - Analyze warning patterns across records
 *    - Identify common transformation issues (missing fields, type errors)
 *    - Prioritize mapping improvements based on warning frequency
 *
 * 3. MIGRATION VERIFICATION:
 *    - Update mapping or transform version
 *    - Generate MappingReport for test records with both old and new versions
 *    - Compare reports to understand behavior changes
 *    - Verify warnings don't increase with new version
 */
export interface MappingReport {
  /**
   * References to pipeline components that produced this canonical record.
   *
   * These IDs link back to the source data and transformation configuration,
   * enabling reproducibility and detailed investigation.
   *
   * Structure:
   * ```typescript
   * {
   *   pipelineId: "route_abc123",           // Pipeline that processed this record
   *   snapshotId: "snap_xyz789",         // Immutable source record snapshot
   *   mappingId: "map_def456",           // Field mapping configuration
   *   transformId: "transform_ghi789"    // Transformation pipeline
   * }
   * ```
   *
   * These should match the IDs in CanonicalRecord.provenance.
   */
  references: {
    pipelineId?: string;
    snapshotId: string;
    mappingId: string;
    transformId: string;
  };

  /**
   * Overall transformation status.
   *
   * Indicates whether the transformation completed successfully or encountered issues.
   *
   * - `success`: Transformation completed without errors or warnings
   *   - All required fields were populated
   *   - All mapping rules executed successfully
   *   - Canonical record is complete and valid
   *
   * - `partial`: Transformation completed with warnings
   *   - Some optional fields could not be populated
   *   - Some mapping rules failed or skipped
   *   - Canonical record is valid but may be incomplete
   *   - Check warnings array for details
   *
   * - `failed`: Transformation failed and did not produce a canonical record
   *   - Required fields missing or invalid
   *   - Critical mapping rules failed
   *   - Source data incompatible with mapping
   *   - Check warnings array for error details
   */
  status: 'success' | 'partial' | 'failed';

  /**
   * Warnings and issues encountered during transformation.
   *
   * Array of human-readable warning messages describing problems encountered
   * during the transformation process. Empty array if no warnings.
   *
   * Common warning types:
   * - Missing source fields: "Source field 'artist_name' not found in source data"
   * - Type mismatches: "Expected number for 'width', got string '100cm'"
   * - Validation failures: "Date '1889-06' does not match ISO 8601 format"
   * - Mapping errors: "Multiple values found for single-value field 'title'"
   * - Enrichment failures: "Wikidata lookup failed for 'Vincent van Gogh'"
   *
   * Example:
   * ```typescript
   * [
   *   "Source field 'dimensions.depth' not found, omitting depth from canonical",
   *   "Date format 'circa 1889' could not be parsed to ISO 8601, using raw value",
   *   "Classification lookup for 'oil painting' returned multiple matches, using first"
   * ]
   * ```
   *
   * Warnings are sanitized and safe to expose to API consumers.
   * No sensitive data, credentials, or exploitable system details.
   */
  warnings: string[];

  /**
   * Summary of mapping rule execution.
   *
   * High-level statistics about which mapping rules ran and their outcomes.
   * Does not include field-level lineage, but provides transformation overview.
   *
   * Structure:
   * ```typescript
   * {
   *   totalRules: 42,              // Total number of mapping rules
   *   executedRules: 38,           // Rules that ran (had source data)
   *   skippedRules: 4,             // Rules skipped (missing source fields)
   *   failedRules: 2,              // Rules that encountered errors
   *   fieldsMapped: 35,            // Canonical fields populated
   *   fieldsDropped: 7             // Source fields not mapped to canonical
   * }
   * ```
   *
   * Use this to understand transformation coverage and completeness.
   * High skipped/failed counts may indicate mapping configuration issues.
   */
  ruleExecution: {
    totalRules: number;
    executedRules: number;
    skippedRules: number;
    failedRules: number;
    fieldsMapped: number;
    fieldsDropped: number;
  };

  /**
   * High-level summary of data transformation.
   *
   * Provides a bird's-eye view of what changed during transformation,
   * without tracking individual field lineage.
   *
   * Structure:
   * ```typescript
   * {
   *   sourceFieldCount: 52,           // Number of fields in source record
   *   canonicalFieldCount: 35,        // Number of fields in canonical record
   *   fieldsAdded: ['id', 'type'],    // Fields added by transformation (not in source)
   *   fieldsTransformed: 30,          // Fields mapped from source (may be renamed/restructured)
   *   fieldsDropped: 22,              // Source fields not mapped to canonical
   *   enrichmentsApplied: 3           // Additional data added via enrichment services
   * }
   * ```
   *
   * This is intentionally high-level:
   * - Counts and categories, not field-by-field lineage
   * - Identifies patterns (many drops? few transforms?)
   * - Suitable for dashboards and summary reports
   *
   * For detailed field mappings, retrieve the mapping configuration
   * via references.mappingId and examine the rule definitions.
   */
  diffSummary: {
    sourceFieldCount: number;
    canonicalFieldCount: number;
    fieldsAdded: string[];
    fieldsTransformed: number;
    fieldsDropped: number;
    enrichmentsApplied: number;
  };
}

/**
 * Request to project data from a source snapshot to a specific format.
 *
 * Projections are on-demand transformations that render source data into
 * source format (raw) or destination format (canonical, export schema).
 * They enable preview, testing, and re-projection without persisting data.
 *
 * CRITICAL DESIGN PRINCIPLES (v1):
 *
 * PROJECTIONS MUST BE DETERMINISTIC WHEN SNAPSHOT ID IS SUPPLIED
 * - Same snapshotId + same mappingId → same projection output (always)
 * - This is the reproducibility guarantee for transformations
 * - Projections are pure functions: f(snapshot, mapping) = projection
 * - No side effects, no non-deterministic operations (random, timestamps, external lookups)
 * - Enables testing, debugging, and verification of transformation logic
 *
 * - Determinism requirements:
 *   ✓ Use snapshot data as-is (frozen in time)
 *   ✓ Use versioned mapping configuration
 *   ✓ No external API calls (unless cached/mocked)
 *   ✓ No timestamps generated during projection (use provided/fixed values)
 *   ✓ No random values or UUIDs (use deterministic seeds if needed)
 *
 * - Non-deterministic operations (avoid or make deterministic):
 *   ✗ Current timestamps → Use snapshot.capturedAt or provided timestamp
 *   ✗ External enrichment APIs → Cache results or exclude from projection
 *   ✗ Random IDs → Use hash of source data or sequential IDs
 *   ✗ Machine learning inference → Use fixed model version with reproducible results
 *
 * PROJECTION OUTPUT IS NOT STORED UNLESS EXPLICITLY PERSISTED
 * - Projections are ephemeral by default (computed on-demand, discarded after response)
 * - No automatic write to canonical store
 * - Client must explicitly call a write/persist endpoint to store projection results
 * - This prevents accidental data creation and keeps projections lightweight
 *
 * - Use cases:
 *   ✓ Preview: See transformation output before committing
 *   ✓ Testing: Verify mapping changes produce expected results
 *   ✓ Debugging: Compare projected output to stored canonical record
 *   ✓ Migration: Test new mapping versions on historical snapshots
 *   ✓ Export: Generate destination format for external systems
 *
 * - To persist projection:
 *   1. POST /projections → Get ProjectionResponse with projection data
 *   2. Review output, verify correctness
 *   3. POST /entities with projection.payload → Persist to canonical store
 *
 * USAGE PATTERNS:
 *
 * 1. PREVIEW TRANSFORMATION (source mode):
 *    ```typescript
 *    {
 *      mode: "source",
 *      snapshotId: "snap_abc123",
 *      mappingId: "map_xyz789"
 *    }
 *    ```
 *    Returns: Original source data (useful for inspection before transform)
 *
 * 2. TEST MAPPING (destination mode):
 *    ```typescript
 *    {
 *      mode: "destination",
 *      snapshotId: "snap_abc123",
 *      mappingId: "map_new_v2",
 *      sourceDescriptor: { system: "airtable", dataset: "appXYZ" }
 *    }
 *    ```
 *    Returns: Projected canonical record using new mapping (not persisted)
 *
 * 3. MIGRATION TEST:
 *    ```typescript
 *    {
 *      mode: "destination",
 *      snapshotId: "snap_old_data",
 *      mappingId: "map_v2"
 *    }
 *    ```
 *    Returns: How old data would look with new mapping (deterministic)
 */
export interface ProjectionRequest {
  /**
   * Projection mode determining output format.
   *
   * - `source`: Project to original source format (return raw source data)
   *   - Useful for inspecting original data before transformation
   *   - Enables "view source" debugging workflows
   *   - Output matches SourceRecord.raw structure
   *
   * - `destination`: Project to destination format (canonical or export schema)
   *   - Apply mapping and transformation logic
   *   - Output matches target schema (e.g., CanonicalRecord)
   *   - Useful for preview, testing, and migration verification
   */
  mode: 'source' | 'destination';

  /**
   * Mapping configuration identifier.
   *
   * Required for destination mode (defines transformation rules).
   * Optional for source mode (not used, source data returned as-is).
   *
   * References a Mapping.id that defines how to transform source → destination.
   *
   * Examples:
   * - "map_smithsonian_v1": Named mapping configuration
   * - "mapping_abc123": Internal mapping UUID
   */
  mappingId?: string;

  /**
   * Source descriptor for ad-hoc source identification.
   *
   * Optional alternative to using snapshotId when source context is needed
   * but you don't have a specific snapshot yet. Used for creating new
   * projections from live source data (non-deterministic).
   *
   * Structure:
   * ```typescript
   * {
   *   system: "airtable",
   *   dataset: "appABC123",
   *   recordId: "recXYZ789"
   * }
   * ```
   *
   * Note: When sourceDescriptor is used instead of snapshotId, projection
   * is not deterministic (fetches current source data, which may change).
   */
  sourceDescriptor?: {
    system: string;
    dataset?: string;
    recordId: string;
  };

  /**
   * Source record snapshot identifier.
   *
   * References a SourceRecord.id containing the immutable source data.
   *
   * Required for deterministic projections. When supplied, projection
   * output is guaranteed to be the same for repeated requests with the
   * same snapshotId + mappingId combination.
   *
   * Example: "snap_abc123-def456-..."
   *
   * Enables:
   * - Reproducible transformations
   * - Historical replay (project old snapshots with new mappings)
   * - Regression testing (verify mapping changes don't break existing transforms)
   */
  snapshotId: string;
}

/**
 * Response containing projected data from a source snapshot.
 *
 * ProjectionResponse provides the computed output of a projection operation
 * without persisting it to storage. The projection is ephemeral and must be
 * explicitly persisted if needed.
 *
 * CRITICAL DESIGN PRINCIPLES (v1):
 *
 * PROJECTIONS MUST BE DETERMINISTIC WHEN SNAPSHOT ID IS SUPPLIED
 * - Same request parameters → same response payload (always)
 * - The meta.hash field proves determinism (same hash = same projection)
 * - Clients can cache projections by hash for performance
 * - Re-executing projection with same inputs produces identical output
 *
 * PROJECTION OUTPUT IS NOT STORED UNLESS EXPLICITLY PERSISTED
 * - This is a computed response, not a database record
 * - No side effects on canonical store or source records
 * - To persist: client must call separate write/persist endpoint
 * - Projections are for preview, testing, and validation
 */
export interface ProjectionResponse {
  /**
   * Source record identifier that was projected.
   *
   * For snapshotId-based projections, this is the original recordId from
   * the source system (extracted from SourceRecord.source.recordId).
   *
   * For sourceDescriptor-based projections, this is the recordId provided
   * in the request.
   *
   * Examples:
   * - "recXYZ789" (Airtable record ID)
   * - "12345" (Database primary key)
   * - "obj_abc123" (API resource ID)
   */
  recordId: string;

  /**
   * Projection mode used (matches request mode).
   *
   * - `source`: Projection contains raw source data
   * - `destination`: Projection contains transformed destination data
   */
  mode: 'source' | 'destination';

  /**
   * Mapping configuration identifier used (matches request mappingId).
   *
   * Null for source mode projections (no mapping applied).
   * Required for destination mode projections.
   */
  mappingId: string | null;

  /**
   * Source snapshot identifier used (matches request snapshotId).
   *
   * Identifies which immutable source record was projected.
   * Enables tracing projection back to source data.
   */
  snapshotId: string;

  /**
   * Projected data payload.
   *
   * Structure depends on projection mode:
   *
   * - Source mode: Raw source data (matches SourceRecord.raw)
   *   ```typescript
   *   {
   *     id: "recXYZ789",
   *     fields: { "Title": "The Starry Night", "Artist": "Vincent van Gogh" }
   *   }
   *   ```
   *
   * - Destination mode: Transformed destination data (matches target schema)
   *   ```typescript
   *   {
   *     id: "object:smithsonian:12345",
   *     type: "Object",
   *     label: "The Starry Night",
   *     properties: { ... }
   *   }
   *   ```
   *
   * This is the main output of the projection operation.
   * This data is NOT automatically persisted.
   */
  projection: Record<string, any>;

  /**
   * Metadata about the projection operation.
   *
   * Provides information about when and how the projection was generated,
   * plus a hash for verifying determinism.
   *
   * Structure:
   * ```typescript
   * {
   *   hash: "sha256:abc123...",          // Content hash of projection.payload
   *   generatedAt: "2024-01-15T14:30:00Z" // ISO 8601 timestamp of projection
   * }
   * ```
   *
   * The hash field is critical for determinism verification:
   * - Same hash on repeated projections → deterministic ✓
   * - Different hash on repeated projections → non-deterministic ✗
   *
   * The generatedAt field is informational (when this projection was computed).
   * It does NOT affect projection content (content is based on snapshot time).
   */
  meta: {
    hash: string;
    generatedAt: string;
  };
}

/**
 * Canonical Record Type Registry — Madrona Schema v1
 *
 * This registry defines the stable, constrained set of entity types that flow
 * through the Madrona canonical schema. These types are intentionally generic
 * and domain-agnostic to support multiple use cases (museums, archives, libraries).
 *
 * TYPE SEMANTICS:
 *
 * - `Object`: Physical or conceptual items of cultural/scholarly significance
 *   Examples: Artworks, artifacts, archival items, specimens, books
 *   Intended for: Collections items, catalog records, primary holdings
 *
 * - `Work`: Creative or intellectual works (may exist in multiple physical forms)
 *   Examples: A novel (abstract), a musical composition, a film, a performance
 *   Distinguishes: Abstract work vs physical manifestation (FRBR Work vs Item)
 *
 * - `Agent`: Entities capable of action or creation (people, organizations, systems)
 *   Examples: Artists, authors, institutions, collectives, software agents
 *   Replaces: Separate 'person' and 'organization' types for simplicity
 *
 * - `Place`: Geographic locations, sites, or spatial entities
 *   Examples: Cities, buildings, archaeological sites, exhibition spaces
 *   Includes: Both physical locations and named geographic entities
 *
 * - `Event`: Occurrences, activities, or temporal entities
 *   Examples: Exhibitions, acquisitions, performances, historical events
 *   Temporal: Has definite start/end times or periods
 *
 * - `Media`: Digital media assets or representations
 *   Examples: Images, videos, audio recordings, 3D models, documents
 *   Context: May represent the entity itself (born-digital) or depictions of other entities
 *
 * DESIGN NOTES:
 * - This is a closed set to ensure consistency and predictable behavior
 * - Future schema versions may add types (e.g., 'Collection', 'Concept')
 * - Domain-specific subtypes should use properties.subtype or classifications
 * - Avoid creating new types for minor distinctions; use classifications instead
 *
 * EXTENSION STRATEGY:
 * To add a new type in future versions:
 * 1. Update this union with the new literal type
 * 2. Document semantics and examples in this comment block
 * 3. Update backend EntityCurrent validation if constrained
 * 4. Update transformers to map source types to new canonical type
 * 5. Bump schema version (e.g., v1 → v2) if breaking change
 */
export type CanonicalRecordType =
  | 'Object'
  | 'Work'
  | 'Agent'
  | 'Place'
  | 'Event'
  | 'Media';

/**
 * Legacy alias for backward compatibility.
 * @deprecated Use CanonicalRecordType instead
 */
export type CanonicalEntityType = CanonicalRecordType;

/**
 * Provenance metadata tracking the origin and transformation of an entity.
 *
 * Records which connector and route ingested the data, enabling debugging
 * and audit trails.
 */
/**
 * Provenance metadata for reproducibility, audit, and debugging.
 *
 * Provenance captures the complete pipeline context needed to:
 * 1. REPLAY: Re-execute the exact transformation that produced this record
 * 2. AUDIT: Trace back to the original source system and record
 * 3. DEBUG: Diagnose transformation issues or data quality problems
 *
 * CRITICAL DESIGN PRINCIPLES (v1):
 *
 * PROVENANCE EXISTS FOR REPLAY, AUDIT, AND DEBUGGING
 * - Records the pipeline state machine (snapshot → mapping → transform → route)
 * - Captures source system coordinates (system, dataset, recordId)
 * - Enables deterministic re-execution from source to canonical
 * - Supports forensic investigation of data issues
 *
 * PROVENANCE DOES NOT IMPLY PER-FIELD LINEAGE
 * - This is record-level provenance, not field-level provenance
 * - We do NOT track which source fields mapped to which canonical fields
 * - Field-level lineage is prohibitively expensive and brittle
 * - The mapping configuration provides the field relationships (static)
 * - The source record snapshot provides the input values (static)
 * - Re-executing the transform with these inputs proves the derivation
 *
 * PROVENANCE FIELDS ARE STABLE API CONTRACT
 * - These fields will not be removed or renamed without major version bump
 * - Consuming applications can depend on these fields existing
 * - New optional fields may be added in minor versions
 * - This is the reproducibility guarantee for canonical records
 *
 * REPRODUCIBILITY MODEL:
 *
 * Given: sourceRecordId, snapshotId, mappingId, transformId
 * Then: Re-executing the transform produces the same canonical output
 *
 * This is a mathematical property: f(source, mapping, transform) = canonical
 *
 * The provenance fields capture the input tuple needed to verify this property.
 *
 * DEBUGGING WORKFLOW:
 *
 * 1. User reports issue with canonical record
 * 2. Look up provenance to find sourceRecordId and snapshotId
 * 3. Retrieve original source record from snapshot
 * 4. Look up mappingId and transformId configuration
 * 5. Re-execute transform with source + mapping + transform
 * 6. Compare output to current canonical record
 * 7. Diff reveals where transformation diverged
 */
export interface Provenance {
  /**
   * Source system identifier.
   *
   * Identifies the external system from which this record originated.
   * This is a logical identifier, not a connection string.
   *
   * Examples:
   * - "smithsonian": Smithsonian Institution systems
   * - "airtable": Airtable workspace
   * - "google-sheets": Google Sheets connector
   * - "emuseum": eMuseum collection management system
   *
   * This field is required for audit trails back to the source.
   */
  system: string;

  /**
   * Dataset identifier within the source system.
   *
   * Many source systems have multiple datasets (tables, bases, sheets).
   * This field disambiguates which dataset within the source system.
   *
   * Examples:
   * - Airtable base ID: "appABC123xyz"
   * - Google Sheet ID: "1abc...xyz"
   * - Database table name: "objects"
   * - API endpoint: "/collections/primary"
   *
   * Optional because some sources have a single implied dataset.
   */
  dataset?: string;

  /**
   * Original record identifier in the source system.
   *
   * The primary key or unique identifier from the source system.
   * This is the authoritative ID for looking up the source record.
   *
   * Examples:
   * - Airtable record ID: "recXYZ789"
   * - Database primary key: "12345"
   * - API resource ID: "obj_abc123"
   * - Spreadsheet row number: "42"
   *
   * This is the same as sourceRecordId (required for backward compatibility).
   */
  recordId: string;

  /**
   * Original source record identifier.
   *
   * DEPRECATED: Use `recordId` instead. Kept for backward compatibility.
   *
   * This is the unique identifier from the source system that can be
   * used to look up the original record for audit or replay purposes.
   */
  sourceRecordId: string;

  /**
   * Snapshot identifier capturing the source record state.
   *
   * References the immutable snapshot of the source record at the time
   * it was ingested. This enables deterministic replay of transformations.
   *
   * The snapshot contains:
   * - The exact source record data (all fields, all values)
   * - The extraction timestamp
   * - The source system schema version
   *
   * With the snapshot, we can re-execute the transform and get the same
   * canonical output, even if the source record has since changed.
   *
   * Examples:
   * - "snap_abc123": Internal snapshot UUID
   * - "run_xyz789_rec_12345": Run ID + record ID composite
   */
  snapshotId: string;

  /**
   * Mapping configuration identifier.
   *
   * References the field mapping configuration that defined how to map
   * source fields to canonical fields. This is the "schema" for the transform.
   *
   * The mapping configuration contains:
   * - Source field → canonical field mappings
   * - Data type conversions
   * - Default values and fallbacks
   * - Conditional mapping rules
   *
   * Examples:
   * - "mapping_smithsonian_v2": Named mapping version
   * - "map_abc123": Internal mapping UUID
   */
  mappingId: string;

  /**
   * Transformation implementation identifier.
   *
   * References the code/logic that executed the transformation from source
   * to canonical format. This captures the version of the transform logic.
   *
   * The transform is the executable function: f(source, mapping) → canonical
   *
   * Examples:
   * - "smithsonian_dublin_core@1.0.0": Named transformer + version
   * - "transform_abc123": Internal transform UUID
   * - "v2.3.1": Git commit or release tag
   *
   * This allows identifying bugs in specific transform versions and
   * re-running records through updated transform logic.
   */
  transformId: string;

  /**
   * Pipeline identifier that processed this record.
   *
   * Pipelines define the end-to-end data flow: source → mapping → transform → destination.
   * The pipeline ID captures which pipeline configuration was active.
   *
   * Optional because some records may be created through direct API calls
   * rather than through a configured pipeline.
   *
   * Examples:
   * - "pipeline_abc123": Internal pipeline UUID
   * - "smithsonian_to_canonical_v1": Named pipeline identifier
   */
  pipelineId?: string;

  /**
   * ISO 8601 timestamp when the record was ingested into Madrona.
   *
   * This is the moment the source record was transformed and written
   * to the canonical store. Distinct from when it was extracted or
   * when it was last seen in the source system.
   *
   * Example: "2024-01-15T14:30:00Z"
   *
   * This is required for time-based audit queries and data freshness checks.
   */
  ingestedAt: string;

  /**
   * Content hash of the source record data.
   *
   * Optional cryptographic hash (SHA-256, MD5, etc.) of the source record
   * content at the time of ingestion. Used for:
   * - Change detection (has the source record changed?)
   * - Deduplication (have we seen this exact content before?)
   * - Integrity verification (is the snapshot corrupted?)
   *
   * Hash should be computed over normalized JSON to ensure stability.
   *
   * Examples:
   * - "sha256:abc123...": Prefixed with algorithm
   * - "d41d8cd98f00b204e9800998ecf8427e": MD5 hex digest
   *
   * Optional because not all sources support efficient content hashing.
   */
  contentHash?: string;
}

/**
 * System-managed metadata about the canonical record itself.
 *
 * Meta fields track the lifecycle and versioning of canonical records within
 * Madrona. These fields are managed by the system, not derived from source data.
 *
 * CRITICAL DESIGN PRINCIPLES (v1):
 *
 * META FIELDS ARE SYSTEM-MANAGED
 * - Automatically populated by Madrona on record creation and updates
 * - Never manually edited by users or transformers
 * - Reflect the state of the canonical record, not the source record
 * - Used for internal system operations (caching, versioning, conflict resolution)
 *
 * META FIELDS ARE NOT DERIVED FROM SOURCE DATA
 * - Do not come from source system fields or mappings
 * - Independent of source record content
 * - Managed by Madrona's canonical storage layer
 * - Provenance tracks source lineage; Meta tracks canonical lifecycle
 *
 * META FIELDS MAY CHANGE INDEPENDENTLY OF CANONICAL CONTENT
 * - schemaVersion can be bumped without changing record data (migration)
 * - updatedAt changes on any write, even if content is identical
 * - Meta changes do not trigger re-transformation or downstream updates
 * - Meta is operational metadata, not semantic content
 *
 * DISTINCTION FROM PROVENANCE:
 * - Provenance: Where did this data come from? (source system coordinates)
 * - Meta: What is the state of this canonical record? (system lifecycle)
 *
 * Provenance enables reproducibility; Meta enables operational management.
 */
export interface Meta {
  /**
   * Canonical schema version used for this record.
   *
   * Identifies which version of the Madrona Canonical Schema this record
   * conforms to. Used for schema migrations and forward/backward compatibility.
   *
   * Format: Semantic versioning "major.minor.patch"
   * - Major: Breaking changes (field removals, type changes)
   * - Minor: Additive changes (new optional fields)
   * - Patch: Documentation or clarification updates
   *
   * Examples:
   * - "1.0.0": Initial canonical schema
   * - "1.1.0": Added new optional fields
   * - "2.0.0": Breaking changes, incompatible with v1
   *
   * This field is required to ensure records can be correctly interpreted
   * as the schema evolves over time.
   *
   * When the schema version is bumped, existing records may need migration.
   * The schemaVersion field allows the system to identify which records
   * need updating and apply appropriate migration logic.
   */
  schemaVersion: string;

  /**
   * ISO 8601 timestamp when this canonical record was created in Madrona.
   *
   * This is the moment the record was first written to the canonical store,
   * not when it was extracted from the source or when it exists in the world.
   *
   * Example: "2024-01-15T14:30:00Z"
   *
   * This timestamp is immutable and never changes after record creation.
   * Use for:
   * - Audit trails (when did this record first appear?)
   * - Data freshness reports (how old is our canonical data?)
   * - Historical analysis (growth of canonical store over time)
   */
  createdAt: string;

  /**
   * ISO 8601 timestamp when this canonical record was last updated.
   *
   * This timestamp changes every time the record is written, even if the
   * content is identical. It reflects write operations, not semantic changes.
   *
   * Example: "2024-01-20T10:15:00Z"
   *
   * Use for:
   * - Cache invalidation (has this record been updated since last fetch?)
   * - Conflict resolution (which write is most recent?)
   * - Activity monitoring (which records are actively being updated?)
   *
   * Note: This is distinct from provenance.ingestedAt, which tracks when
   * the source data was transformed. A record can be re-written (updatedAt
   * changes) without re-transforming (ingestedAt stays the same).
   */
  updatedAt: string;
}

/**
 * External identifier from another system or authority.
 *
 * Generic structure for cross-referencing entities with external databases,
 * controlled vocabularies, or institutional identifiers.
 *
 * USAGE EXAMPLES:
 * - Museums: Accession numbers, catalog IDs, object numbers
 * - Libraries: ISBN, ISSN, LCCN, OCLC numbers
 * - Archives: Finding aid IDs, EAD IDs
 * - Authority files: VIAF, LCNAF, ULAN, AAT IDs
 * - Scientific: DOI, PMID, specimen IDs
 * - Linked data: Wikidata QIDs, DBpedia URIs
 *
 * The scheme field namespaces the identifier to prevent collisions across
 * different identifier systems.
 */
export interface Identifier {
  /**
   * The identifier scheme or authority issuing this identifier.
   *
   * Use lowercase, hyphen-separated names for consistency.
   *
   * Common schemes:
   * - `accession-number`: Museum accession/catalog number
   * - `isbn`: International Standard Book Number
   * - `issn`: International Standard Serial Number
   * - `doi`: Digital Object Identifier
   * - `viaf`: Virtual International Authority File
   * - `lcnaf`: Library of Congress Name Authority File
   * - `ulan`: Union List of Artist Names
   * - `aat`: Getty Art & Architecture Thesaurus
   * - `wikidata`: Wikidata entity ID (QID)
   * - `orcid`: Open Researcher and Contributor ID
   * - `local`: Institution-specific identifier
   */
  scheme: string;

  /**
   * The identifier value as a string.
   *
   * Store as-is from the source system without normalization.
   * Examples: "978-0-123456-78-9", "Q5", "n79021164", "2021.45.1"
   */
  value: string;
}

/**
 * Classification or categorization applied to an entity.
 *
 * Generic structure for assigning entities to controlled vocabularies,
 * taxonomies, subject headings, or custom classification schemes.
 *
 * USAGE EXAMPLES:
 * - Museums: Object types, material types, cultural context
 * - Libraries: LCSH subject headings, Dewey Decimal
 * - Archives: Record types, provenance
 * - Scientific: Taxonomic classifications, specimen types
 * - Custom: Institution-specific categories
 *
 * Supports both hierarchical (id-based) and flat (label-based) vocabularies.
 */
export interface Classification {
  /**
   * The classification scheme or controlled vocabulary used.
   *
   * Use lowercase, hyphen-separated names for consistency.
   *
   * Common schemes:
   * - `aat`: Getty Art & Architecture Thesaurus
   * - `lcsh`: Library of Congress Subject Headings
   * - `lcgft`: Library of Congress Genre/Form Terms
   * - `ddc`: Dewey Decimal Classification
   * - `lcc`: Library of Congress Classification
   * - `nomenclature`: Nomenclature 4.0 (museum object names)
   * - `iconclass`: Iconographic classification system
   * - `mesh`: Medical Subject Headings
   * - `local`: Institution-specific taxonomy
   * - `custom`: Ad-hoc or uncontrolled terms
   */
  scheme: string;

  /**
   * Unique identifier for this classification term within the scheme.
   *
   * Optional: Use when the vocabulary provides stable IDs or codes.
   * Examples: "300025342" (AAT ID), "Q12345" (Wikidata), "750.1" (Dewey)
   *
   * If the vocabulary is flat (no IDs), use label only.
   */
  id?: string;

  /**
   * Human-readable label for this classification term.
   *
   * Optional: May be omitted if id is self-explanatory or label can be
   * resolved via external lookup. However, storing the label improves
   * performance and usability.
   *
   * Examples: "paintings (visual works)", "Oil on canvas", "19th century"
   */
  label?: string;
}

/**
 * Relationship to another entity in the canonical store.
 *
 * Relationships are typed, directional links between canonical records.
 * They enable entity graphs, linked data, and contextual navigation.
 *
 * DESIGN NOTES (v1):
 * - Relationships are NOT standalone resources in v1
 * - They are embedded properties of the source entity
 * - Direction: source (this record) → target (referenced record)
 * - No reverse relationship is automatically created
 *
 * FUTURE COMPATIBILITY:
 * In future schema versions, relationships MAY be promoted to first-class
 * resources with their own IDs, provenance, and bidirectional sync.
 * The current structure is forward-compatible with this change.
 *
 * RELATIONSHIP TYPES (examples, not exhaustive):
 * - `created-by`: Links object → agent (creator)
 * - `depicts`: Links object → agent/place/event (subject matter)
 * - `located-at`: Links object → place (current location)
 * - `part-of`: Links object → object (collection/parent)
 * - `related-to`: Generic association between entities
 * - `same-as`: Identity link (this entity = that entity)
 *
 * Custom relationship types are permitted but should follow kebab-case
 * conventions and be documented in domain-specific schemas.
 */
export interface Relationship {
  /**
   * The type of relationship between source and target entities.
   *
   * This is a string identifier describing the semantic relationship.
   * Use kebab-case for consistency (e.g., 'created-by', 'part-of').
   *
   * In future versions, this may be validated against a relationship
   * type registry, but v1 allows arbitrary strings to support diverse
   * domain vocabularies.
   *
   * Examples:
   * - 'created-by' (object → agent)
   * - 'depicts' (object → agent/place/event)
   * - 'located-at' (object → place)
   * - 'part-of' (object → collection)
   * - 'exhibited-at' (object → event)
   * - 'same-as' (entity → entity, identity link)
   */
  type: string;

  /**
   * The canonical record ID of the target entity.
   *
   * Format: "{source_system}:{connector_instance_id}:{source_id}"
   * Must reference an existing or expected entity in the canonical store.
   *
   * IMPORTANT: This is the entity_key/id, NOT a database UUID.
   *
   * Example: "smithsonian:123e4567-e89b-12d3-a456-426614174000:person-12345"
   */
  target: string;

  /**
   * Optional role or context for this relationship.
   *
   * Provides additional semantic nuance when the relationship type alone
   * is insufficient. Useful for qualified relationships.
   *
   * Examples:
   * - type: 'created-by', role: 'primary-artist'
   * - type: 'created-by', role: 'attributed-to'
   * - type: 'located-at', role: 'current-location'
   * - type: 'part-of', role: 'permanent-collection'
   */
  role?: string;

  /**
   * Optional human-readable label for the target entity.
   *
   * Stores a denormalized copy of the target entity's label for display
   * purposes without requiring a join/lookup. This is a performance
   * optimization and convenience field.
   *
   * WARNING: This may become stale if the target entity's label changes.
   * Applications should periodically refresh or treat as a hint only.
   *
   * Example: "Vincent van Gogh", "Metropolitan Museum of Art"
   */
  label?: string;
}

/**
 * Lightweight reference to a media asset associated with an entity.
 *
 * MediaReferences are pointers to media, NOT embedded binary data.
 * They are designed for web and publishing use cases where media is
 * stored externally and referenced by URL or identifier.
 *
 * DESIGN NOTES (v1):
 * - MediaReference does NOT embed binaries (no base64, no blobs)
 * - Media assets are stored separately (CDN, IIIF, institutional servers)
 * - This structure is optimized for linking, not storage
 *
 * FUTURE COMPATIBILITY:
 * In future schema versions, media MAY become a first-class CanonicalRecord
 * with type='Media'. The current MediaReference structure is forward-compatible:
 * - `id` would become the canonical record ID
 * - `type` already describes media classification
 * - MediaReference would act as a lightweight projection
 *
 * Promoting media to first-class records enables:
 * - Independent provenance tracking for media
 * - Relationships between media and multiple entities
 * - Media-specific metadata (EXIF, IPTC, technical details)
 * - Versioning and derivative tracking
 */
export interface MediaReference {
  /**
   * Identifier for this media asset.
   *
   * Format depends on context:
   * - URL: Full URL to the media (most common)
   * - UUID: Internal media asset ID
   * - Canonical ID: If media is a first-class entity (future)
   * - IIIF: IIIF Image API identifier
   *
   * Examples:
   * - "https://cdn.example.org/images/abc123.jpg"
   * - "media:smithsonian:uuid:file-12345"
   * - "https://iiif.example.org/image/abc123"
   *
   * This is the primary key for accessing the media.
   */
  id: string;

  /**
   * Type of media asset.
   *
   * Describes the media category for appropriate rendering and handling.
   *
   * Values:
   * - `image`: Still images (photos, paintings, illustrations)
   * - `video`: Moving images (films, animations, recordings)
   * - `audio`: Sound recordings (music, interviews, ambient)
   * - `document`: Text documents (PDFs, transcripts, manuscripts)
   * - `model`: 3D models or spatial data
   * - `other`: Uncategorized or mixed media
   */
  type: 'image' | 'video' | 'audio' | 'document' | 'model' | 'other';

  /**
   * Optional URL to access the media asset.
   *
   * If `id` is not a URL, this provides the access endpoint.
   * May point to a CDN, IIIF server, or institutional media server.
   *
   * Omit if `id` is already a complete URL.
   *
   * Examples:
   * - "https://cdn.example.org/images/abc123.jpg"
   * - "https://iiif.example.org/image/abc123/full/max/0/default.jpg"
   */
  url?: string;

  /**
   * Optional human-readable label or caption for the media.
   *
   * Used for:
   * - Alt text for accessibility
   * - Captions in galleries or publications
   * - Media credits or attributions
   *
   * Examples:
   * - "The Starry Night, 1889"
   * - "Portrait of the artist, oil on canvas"
   * - "Audio recording of interview, 1965"
   */
  label?: string;

  /**
   * Optional role or context for this media reference.
   *
   * Describes the relationship between this media and the parent entity.
   *
   * Common roles:
   * - `primary`: Main/featured image or media
   * - `thumbnail`: Small preview image
   * - `detail`: Close-up or detail view
   * - `alternate`: Alternative view or angle
   * - `documentation`: Archival or documentary media
   * - `conservation`: Conservation photography
   *
   * Custom roles are permitted for domain-specific needs.
   */
  role?: string;
}

/**
 * Extension point for source-specific or domain-specific data.
 *
 * Extensions are the primary escape hatch for data that doesn't fit
 * the canonical schema. They allow sources to preserve rich, specialized
 * data without forcing it into canonical fields.
 *
 * CRITICAL DESIGN RULES (v1):
 *
 * 1. MUST BE SAFE TO IGNORE
 *    All consuming applications must be able to ignore extensions entirely.
 *    Extensions cannot be required to render or process a canonical record.
 *    Core functionality must work without understanding any extensions.
 *
 * 2. MUST NEVER OVERWRITE CANONICAL FIELDS
 *    Extensions are supplementary, not replacement data.
 *    If data belongs in a canonical field, it goes there first.
 *    Extensions may DUPLICATE canonical data for convenience, but never replace it.
 *
 * 3. PRIMARY ESCAPE HATCH
 *    Extensions are the correct place for:
 *    - Source-system internal IDs and metadata
 *    - Domain-specific controlled vocabularies
 *    - Specialized data models (CIDOC-CRM, FRBR, scientific schemas)
 *    - Institutional business logic flags
 *    - Migration artifacts and legacy data
 *
 * NAMESPACE CONVENTIONS:
 * - Source systems: `source:<system>` (e.g., `source:airtable`, `source:salesforce`)
 * - Data models: `model:<standard>` (e.g., `model:cidoc-crm`, `model:frbr`)
 * - Institutions: `org:<institution>` (e.g., `org:smithsonian`, `org:moma`)
 * - Custom domains: `domain:<area>` (e.g., `domain:natural-history`, `domain:art`)
 *
 * EXAMPLES:
 *
 * Source system metadata:
 * ```typescript
 * {
 *   namespace: "source:airtable",
 *   type: "record-metadata",
 *   data: {
 *     table_id: "tblABC123",
 *     record_id: "recXYZ789",
 *     created_time: "2024-01-01T00:00:00Z",
 *     last_modified_by: { id: "usr123", email: "curator@example.org" }
 *   }
 * }
 * ```
 *
 * Domain-specific classification:
 * ```typescript
 * {
 *   namespace: "domain:natural-history",
 *   type: "specimen-data",
 *   data: {
 *     collection_method: "field observation",
 *     preservation: "ethanol",
 *     catalog_number: "USNM 123456",
 *     type_status: "holotype"
 *   }
 * }
 * ```
 *
 * Specialized data model:
 * ```typescript
 * {
 *   namespace: "model:cidoc-crm",
 *   type: "entity-mapping",
 *   data: {
 *     crm_class: "E22_Human-Made_Object",
 *     properties: [
 *       { property: "P108_has_produced", target: "actor:maker:123" }
 *     ]
 *   }
 * }
 * ```
 */
export interface Extension {
  /**
   * Namespace identifying the source or domain of this extension.
   *
   * Namespaces prevent collisions between different systems using
   * the same extension types. Use standard prefixes:
   * - `source:<system>` for source system metadata
   * - `model:<standard>` for data model mappings
   * - `org:<institution>` for institutional extensions
   * - `domain:<area>` for domain-specific data
   *
   * Examples:
   * - "source:airtable"
   * - "model:cidoc-crm"
   * - "org:smithsonian"
   * - "domain:art-history"
   */
  namespace: string;

  /**
   * Type of extension within the namespace.
   *
   * Categorizes the extension data for appropriate handling.
   * Type semantics are defined by the namespace.
   *
   * Examples:
   * - "record-metadata" (source system internal data)
   * - "specimen-data" (natural history specimen fields)
   * - "entity-mapping" (data model crosswalk)
   * - "workflow-status" (institutional process tracking)
   */
  type: string;

  /**
   * Extension data payload.
   *
   * Arbitrary JSON object containing the extension data.
   * Structure is defined by the combination of namespace + type.
   *
   * RULES:
   * - Must be valid JSON (no functions, circular references, etc.)
   * - Should be serializable and portable
   * - May contain nested objects and arrays
   * - Should NOT contain references to canonical fields (duplication is okay)
   *
   * Applications that don't understand this namespace/type combination
   * will ignore this data entirely, which is the correct behavior.
   */
  data: Record<string, any>;
}

/**
 * Rights and licensing information for an entity.
 *
 * Describes usage permissions, copyright, and attribution requirements.
 */
export interface CanonicalRights {
  /**
   * The rights statement or license
   * Examples: 'CC0', 'CC BY', 'In Copyright', 'Public Domain'
   */
  statement: string;

  /**
   * URI for the full rights statement or license
   */
  uri?: string;

  /**
   * Copyright holder or rights owner
   */
  holder?: string;

  /**
   * ISO 8601 date when copyright begins
   */
  from_date?: string;

  /**
   * ISO 8601 date when copyright expires or enters public domain
   */
  to_date?: string;

  /**
   * Additional usage notes or restrictions
   */
  notes?: string;
}

/**
 * The complete Madrona Canonical Record structure.
 *
 * This is the stable, versioned envelope that all entity data flows through.
 * Required fields provide the minimum viable record structure, while optional
 * fields enable rich, domain-specific representations.
 *
 * USAGE:
 * - Frontend UI displays entities using this structure
 * - API endpoints return entities in this format
 * - Transformers convert source formats into this schema
 * - Destinations receive entities in this format (or transformed variants)
 *
 * EXTENSIBILITY:
 * - `properties`: Domain-specific structured data (e.g., museum measurements, dates)
 * - `extensions`: Source-specific or experimental fields not yet standardized
 */
export interface CanonicalRecord {
  /**
   * Globally unique identifier for this entity.
   *
   * Format: "{source_system}:{connector_instance_id}:{source_id}"
   * Example: "smithsonian:123e4567-e89b-12d3-a456-426614174000:edanmdm-saam_1969.47.91"
   *
   * This composite key ensures uniqueness across all sources and enables
   * traceability back to the original source record.
   */
  id: string;

  /**
   * Canonical entity type classification.
   *
   * Determines how the entity is displayed, queried, and exported.
   * Must be one of the predefined CanonicalRecordType values.
   */
  type: CanonicalRecordType;

  /**
   * Primary human-readable label for this entity.
   *
   * This is the "title" or "name" displayed in lists and detail views.
   * Examples: "The Starry Night", "Vincent van Gogh", "Metropolitan Museum of Art"
   */
  label: string;

  /**
   * Provenance metadata for reproducibility, audit, and debugging.
   *
   * Records the complete pipeline context needed to replay transformations,
   * trace back to source systems, and diagnose data quality issues.
   *
   * IMPORTANT: This is record-level provenance, NOT field-level lineage.
   * - Tracks which source system, dataset, and record produced this canonical record
   * - Captures the pipeline state machine (snapshot → mapping → transform → route)
   * - Enables deterministic re-execution: f(snapshot, mapping, transform) = canonical
   * - Does NOT track which source fields mapped to which canonical fields
   *
   * Field-level lineage is provided by the mapping configuration (static schema)
   * combined with the source record snapshot (static input data). Re-executing
   * the transform proves the field derivations without expensive per-field tracking.
   *
   * Provenance fields are part of the stable API contract and will not be
   * removed or renamed without a major version bump.
   */
  provenance: Provenance;

  /**
   * System-managed metadata about this canonical record.
   *
   * Tracks schema version, lifecycle timestamps, and operational state.
   * These fields are managed by Madrona, not derived from source data.
   *
   * Meta fields may change independently of canonical content:
   * - schemaVersion bumps on schema migrations
   * - updatedAt changes on every write operation
   * - Meta changes do not trigger downstream updates
   *
   * Distinction: Provenance tracks data lineage (where from?), Meta tracks
   * canonical lifecycle (what state?).
   */
  meta: Meta;

  /**
   * Extended textual description or summary of the entity.
   *
   * May contain multiple paragraphs, HTML (sanitized), or Markdown.
   * Used in detail views and exports.
   */
  description?: string;

  /**
   * Lifecycle or workflow status of the entity.
   *
   * Examples: 'draft', 'published', 'archived', 'deleted', 'under_review'
   * Enables filtering and workflow management.
   */
  status?: string;

  /**
   * Canonical URL for this entity.
   *
   * If available, this is the authoritative web link to view this entity
   * in its source system or a stable permalink.
   */
  canonical_url?: string;

  /**
   * External identifiers from other systems or authorities.
   *
   * Enables cross-referencing with controlled vocabularies, authority files,
   * and external databases. Use the `scheme` field to namespace identifiers
   * and prevent collisions.
   *
   * Examples: ISBN, DOI, accession numbers, VIAF, Wikidata QIDs
   */
  identifiers?: Identifier[];

  /**
   * Classifications, categories, or subject headings applied to this entity.
   *
   * Used for taxonomy navigation, filtering, and search refinement.
   * Supports both controlled vocabularies (AAT, LCSH) and custom schemes.
   */
  classifications?: Classification[];

  /**
   * Domain-specific properties structured as key-value pairs.
   *
   * This is where source-specific or domain-specific structured data lives.
   * All properties are namespaced under a single object to avoid collisions.
   *
   * IMPORTANT: This is arbitrary JSON, but should follow domain conventions:
   * - Museum objects: dimensions, materials, creation_date, accession_number
   * - People: birth_date, death_date, nationality, occupation
   * - Places: coordinates, address, elevation
   *
   * Example:
   * ```json
   * {
   *   "dimensions": {"height": 73.7, "width": 92.1, "unit": "cm"},
   *   "creation_date": "1889",
   *   "medium": "Oil on canvas",
   *   "accession_number": "1969.47.91"
   * }
   * ```
   */
  properties?: Record<string, unknown>;

  /**
   * Structured date information for the entity.
   *
   * Key-value pairs of date types to ISO 8601 date strings.
   * Provides structured access to important dates in the entity's lifecycle.
   *
   * Common date keys:
   * - `created`: When the entity was created/produced
   * - `acquired`: When the entity was acquired by the institution
   * - `published`: When the entity record was published
   * - `modified`: When the entity was last modified
   * - `exhibited`: When the entity was exhibited
   *
   * Values should be ISO 8601 formatted dates or date ranges:
   * - Full date: "2024-01-15"
   * - Year-month: "1889-06"
   * - Year only: "1889"
   * - Date range: "1889-06/1890-12"
   *
   * Example:
   * ```json
   * {
   *   "created": "1889-06",
   *   "acquired": "1941-05-15",
   *   "published": "2024-01-15"
   * }
   * ```
   */
  dates?: Record<string, string>;

  /**
   * Relationships to other entities in the graph.
   *
   * Typed, directional links to other canonical records.
   * Enables entity graphs, linked data, and contextual navigation.
   *
   * Note: Relationships are embedded in v1, not standalone resources.
   * Future versions may promote relationships to first-class resources
   * without breaking this structure.
   */
  relationships?: Relationship[];

  /**
   * Media references associated with this entity.
   *
   * MediaReferences are lightweight pointers to media assets, not embedded binaries.
   * Each reference points to externally stored media (CDN, IIIF, institutional servers).
   *
   * Use cases:
   * - Images of artworks or specimens
   * - Audio/video recordings
   * - Scanned documents or manuscripts
   * - 3D models or spatial data
   *
   * The media array may contain multiple references with different roles:
   * - Primary featured image (`role: 'primary'`)
   * - Thumbnail for lists (`role: 'thumbnail'`)
   * - Detail views or alternative angles (`role: 'detail'`, `role: 'alternate'`)
   *
   * Media references are ordered; the first is typically the default/primary.
   *
   * FUTURE: Media may become first-class CanonicalRecords (type='Media') with
   * independent provenance tracking. Current MediaReferences are forward-compatible.
   */
  media?: MediaReference[];

  /**
   * Rights and licensing information.
   *
   * Describes usage permissions, copyright, and attribution requirements
   * for this entity and its media assets.
   */
  rights?: CanonicalRights;

  /**
   * Extensions for source-specific or experimental fields.
   *
   * This is an escape hatch for data that doesn't fit the canonical schema yet.
   * Use sparingly and namespace by source or domain to avoid conflicts.
   *
   * Example:
   * ```json
   * {
   *   "smithsonian": {
   *     "unit_code": "SAAM",
   *     "record_link": "https://..."
   *   },
   *   "experimental": {
   *     "ai_generated_tags": ["portrait", "oil painting"]
   *   }
   * }
   * ```
   *
   * Fields in extensions may be promoted to first-class properties in future
   * schema versions if they prove valuable across sources.
   */
  extensions?: Extension[];
}

/**
 * Type guard to check if an object conforms to CanonicalRecord structure.
 *
 * @param obj - The object to check
 * @returns True if the object has all required CanonicalRecord fields
 */
export function isCanonicalRecord(obj: unknown): obj is CanonicalRecord {
  if (!obj || typeof obj !== 'object') return false;

  const record = obj as Partial<CanonicalRecord>;

  return (
    typeof record.id === 'string' &&
    typeof record.type === 'string' &&
    typeof record.label === 'string' &&
    record.provenance !== undefined &&
    typeof record.provenance === 'object' &&
    record.meta !== undefined &&
    typeof record.meta === 'object'
  );
}

/**
 * Create a minimal valid CanonicalRecord for testing or defaults.
 *
 * @param overrides - Partial record to override defaults
 * @returns A complete CanonicalRecord with required fields populated
 */
export function createCanonicalRecord(
  overrides: Partial<CanonicalRecord> = {}
): CanonicalRecord {
  const now = new Date().toISOString();

  return {
    id: overrides.id || 'unknown:000000-0000-0000-0000-000000000000:unknown',
    type: overrides.type || 'Object',
    label: overrides.label || 'Untitled',
    provenance: overrides.provenance || {
      system: 'unknown',
      recordId: 'unknown',
      sourceRecordId: 'unknown',
      snapshotId: 'snap_unknown',
      mappingId: 'map_unknown',
      transformId: 'transform_unknown',
      ingestedAt: now,
    },
    meta: overrides.meta || {
      schemaVersion: '1.0.0',
      createdAt: now,
      updatedAt: now,
    },
    ...overrides,
  };
}
