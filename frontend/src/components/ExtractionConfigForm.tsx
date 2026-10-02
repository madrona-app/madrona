/**
 * ExtractionConfigForm - Dynamic form for configuring database extraction.
 *
 * This component renders a form for configuring how data should be extracted
 * from a database connector. It supports:
 * - Multiple extraction objects (tables/views)
 * - Column mappings with transforms
 * - Sync mode selection (full vs incremental)
 * - Filter configuration
 *
 * The form is used when setting up a PipelineSource to define what data to pull
 * from a customer's database.
 */

import { useState, useCallback } from 'react';
import Checkbox from './Checkbox';
import {
  type ExtractionConfig,
  type ExtractionObject,
  type ColumnMapping,
  type SyncMode,
  type EntityType,
  createEmptyExtractionObject,
  createEmptyColumnMapping,
  createEmptyExtractionConfig,
  CANONICAL_TARGET_FIELDS,
  COLUMN_TRANSFORMS,
  ENTITY_TYPES,
} from '../types/extraction';
import { useExtractionSchema } from '../hooks/useExtractionSchema';
import { ChevronDown, ChevronRight, Plus, Trash2, Table, Columns } from 'lucide-react';
import { FaDatabase } from 'react-icons/fa';

interface ExtractionConfigFormProps {
  /** Connector definition key (e.g., 'db-sqlserver') */
  definitionKey: string;
  /** Initial config values */
  initialConfig?: ExtractionConfig;
  /** Callback when config changes */
  onChange: (config: ExtractionConfig) => void;
  /** Available columns from catalog (for autocomplete) */
  availableColumns?: string[];
  /** Whether the form is disabled */
  disabled?: boolean;
}

/**
 * Form for configuring database extraction parameters.
 */
export function ExtractionConfigForm({
  definitionKey,
  initialConfig,
  onChange,
  availableColumns = [],
  disabled = false,
}: ExtractionConfigFormProps) {
  const { schema: _schema, isLoading, hasExtractionSchema } = useExtractionSchema(definitionKey);
  const [config, setConfig] = useState<ExtractionConfig>(
    initialConfig || createEmptyExtractionConfig()
  );
  const [expandedObjects, setExpandedObjects] = useState<Set<number>>(new Set([0]));

  // Update parent when config changes
  const updateConfig = useCallback((newConfig: ExtractionConfig) => {
    setConfig(newConfig);
    onChange(newConfig);
  }, [onChange]);

  // Toggle object expansion
  const toggleObjectExpanded = (index: number) => {
    setExpandedObjects(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Add new extraction object
  const addObject = () => {
    const newObjects = [...config.objects, createEmptyExtractionObject()];
    updateConfig({ ...config, objects: newObjects });
    setExpandedObjects(prev => new Set(prev).add(newObjects.length - 1));
  };

  // Remove extraction object
  const removeObject = (index: number) => {
    if (config.objects.length <= 1) return;
    const newObjects = config.objects.filter((_, i) => i !== index);
    updateConfig({ ...config, objects: newObjects });
  };

  // Update extraction object
  const updateObject = (index: number, updates: Partial<ExtractionObject>) => {
    const newObjects = config.objects.map((obj, i) =>
      i === index ? { ...obj, ...updates } : obj
    );
    updateConfig({ ...config, objects: newObjects });
  };

  // Add column mapping
  const addColumnMapping = (objectIndex: number) => {
    const obj = config.objects[objectIndex];
    const newMappings = [...(obj.columnMappings || []), createEmptyColumnMapping()];
    updateObject(objectIndex, { columnMappings: newMappings });
  };

  // Remove column mapping
  const removeColumnMapping = (objectIndex: number, mappingIndex: number) => {
    const obj = config.objects[objectIndex];
    const newMappings = (obj.columnMappings || []).filter((_, i) => i !== mappingIndex);
    updateObject(objectIndex, { columnMappings: newMappings });
  };

  // Update column mapping
  const updateColumnMapping = (
    objectIndex: number,
    mappingIndex: number,
    updates: Partial<ColumnMapping>
  ) => {
    const obj = config.objects[objectIndex];
    const newMappings = (obj.columnMappings || []).map((mapping, i) =>
      i === mappingIndex ? { ...mapping, ...updates } : mapping
    );
    updateObject(objectIndex, { columnMappings: newMappings });
  };

  if (isLoading) {
    return (
      <div style={styles.loading}>
        <div style={styles.spinner} />
        <span>Loading extraction schema...</span>
      </div>
    );
  }

  if (!hasExtractionSchema) {
    return (
      <div style={styles.noSchema}>
        <FaDatabase size={24} style={{ opacity: 0.5 }} />
        <p>Extraction configuration is not available for this connector type.</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Global Settings */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>
          <FaDatabase size={18} />
          Extraction Settings
        </h3>

        <div style={styles.fieldRow}>
          <div style={styles.field}>
            <label htmlFor="extraction-sync-mode" style={styles.label}>Sync Mode</label>
            <select
              id="extraction-sync-mode"
              style={styles.select}
              value={config.syncMode || 'full'}
              onChange={(e) => updateConfig({ ...config, syncMode: e.target.value as SyncMode })}
              disabled={disabled}
            >
              <option value="full">Full Refresh</option>
              <option value="incremental">Incremental</option>
            </select>
            <span style={styles.hint}>
              {config.syncMode === 'incremental'
                ? 'Only sync new/changed records using watermark column'
                : 'Replace all records on each sync'}
            </span>
          </div>

          <div style={styles.field}>
            <label htmlFor="extraction-entity-type" style={styles.label}>Entity Type</label>
            <select
              id="extraction-entity-type"
              style={styles.select}
              value={config.entityType || 'Object'}
              onChange={(e) => updateConfig({ ...config, entityType: e.target.value as EntityType })}
              disabled={disabled}
            >
              {ENTITY_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            <span style={styles.hint}>
              {ENTITY_TYPES.find(t => t.value === (config.entityType || 'Object'))?.description}
            </span>
          </div>
        </div>

        <div style={styles.fieldRow}>
          <div style={styles.field}>
            <label htmlFor="extraction-batch-size" style={styles.label}>Batch Size</label>
            <input
              id="extraction-batch-size"
              type="number"
              style={styles.input}
              value={config.batchSize || 1000}
              onChange={(e) => updateConfig({ ...config, batchSize: parseInt(e.target.value) || 1000 })}
              min={100}
              max={10000}
              disabled={disabled}
              aria-label="Batch Size"
            />
            <span style={styles.hint}>Rows per batch (100-10,000)</span>
          </div>

          <div style={styles.field}>
            <label style={styles.checkboxLabel}>
              <Checkbox
                checked={config.continueOnError || false}
                onChange={(e) => updateConfig({ ...config, continueOnError: e.target.checked })}
                disabled={disabled}
                aria-label="Continue on error"
              />
              Continue on error
            </label>
            <span style={styles.hint}>Keep extracting if individual rows fail</span>
          </div>
        </div>
      </div>

      {/* Extraction Objects */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionTitle}>
            <Table size={18} />
            Tables / Views to Extract
          </h3>
          <button
            style={styles.addButton}
            onClick={addObject}
            disabled={disabled}
            type="button"
          >
            <Plus size={16} />
            Add Table
          </button>
        </div>

        {config.objects.map((obj, objIndex) => (
          <ExtractionObjectCard
            key={objIndex}
            object={obj}
            index={objIndex}
            isExpanded={expandedObjects.has(objIndex)}
            onToggle={() => toggleObjectExpanded(objIndex)}
            onUpdate={(updates) => updateObject(objIndex, updates)}
            onRemove={() => removeObject(objIndex)}
            onAddMapping={() => addColumnMapping(objIndex)}
            onRemoveMapping={(mappingIndex) => removeColumnMapping(objIndex, mappingIndex)}
            onUpdateMapping={(mappingIndex, updates) =>
              updateColumnMapping(objIndex, mappingIndex, updates)
            }
            canRemove={config.objects.length > 1}
            availableColumns={availableColumns}
            syncMode={config.syncMode || 'full'}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Card for a single extraction object (table/view).
 */
interface ExtractionObjectCardProps {
  object: ExtractionObject;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdate: (updates: Partial<ExtractionObject>) => void;
  onRemove: () => void;
  onAddMapping: () => void;
  onRemoveMapping: (index: number) => void;
  onUpdateMapping: (index: number, updates: Partial<ColumnMapping>) => void;
  canRemove: boolean;
  availableColumns: string[];
  syncMode: SyncMode;
  disabled: boolean;
}

function ExtractionObjectCard({
  object,
  index,
  isExpanded,
  onToggle,
  onUpdate,
  onRemove,
  onAddMapping,
  onRemoveMapping,
  onUpdateMapping,
  canRemove,
  availableColumns,
  syncMode,
  disabled,
}: ExtractionObjectCardProps) {
  const objectName = object.table || object.objectId || `Object ${index + 1}`;
  const hasCustomQuery = !!object.customQuery;

  const sectionId = `extraction-object-${index}-content`;

  return (
    <div style={styles.objectCard}>
      <div style={styles.objectHeader}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-controls={sectionId}
          style={styles.objectToggleButton}
        >
          {isExpanded ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
          <Table size={16} style={{ opacity: 0.6 }} aria-hidden="true" />
          <span style={styles.objectName}>{objectName}</span>
          {object.schema && (
            <span style={styles.objectSchema}>{object.schema}</span>
          )}
        </button>
        {canRemove && (
          <button
            style={styles.removeButton}
            onClick={onRemove}
            disabled={disabled}
            type="button"
            aria-label={`Remove table ${objectName}`}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {isExpanded && (
        <div id={sectionId} style={styles.objectContent}>
          {/* Table Selection */}
          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label htmlFor={`object-${index}-schema`} style={styles.label}>Schema</label>
              <input
                id={`object-${index}-schema`}
                type="text"
                style={styles.input}
                value={object.schema || ''}
                onChange={(e) => onUpdate({ schema: e.target.value })}
                placeholder="e.g., dbo, public"
                disabled={disabled || hasCustomQuery}
                aria-label="Schema"
              />
            </div>
            <div style={styles.field}>
              <label htmlFor={`object-${index}-table`} style={styles.label}>Table / View</label>
              <input
                id={`object-${index}-table`}
                type="text"
                style={styles.input}
                value={object.table || ''}
                onChange={(e) => onUpdate({ table: e.target.value })}
                placeholder="e.g., Products, Users"
                disabled={disabled || hasCustomQuery}
                aria-label="Table / View"
              />
            </div>
          </div>

          {/* Custom Query (optional) */}
          <div style={styles.field}>
            <label htmlFor={`object-${index}-custom-query`} style={styles.label}>
              Custom Query
              <span style={styles.optional}>(optional, overrides table selection)</span>
            </label>
            <textarea
              id={`object-${index}-custom-query`}
              style={styles.textarea}
              value={object.customQuery || ''}
              onChange={(e) => onUpdate({ customQuery: e.target.value })}
              placeholder="SELECT id, name, updated_at FROM dbo.Products WHERE active = 1"
              rows={3}
              disabled={disabled}
              aria-label="Custom Query"
            />
            <span style={styles.hint}>Use parameterized queries for security</span>
          </div>

          {/* ID and Watermark Columns */}
          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label htmlFor={`object-${index}-id-column`} style={styles.label}>
                ID Column
                <span style={styles.required}>*</span>
              </label>
              <input
                id={`object-${index}-id-column`}
                type="text"
                style={styles.input}
                value={object.idColumn || ''}
                onChange={(e) => onUpdate({ idColumn: e.target.value })}
                placeholder="e.g., id, product_id"
                disabled={disabled}
                list={`columns-${index}`}
                aria-label="ID Column"
              />
              <datalist id={`columns-${index}`}>
                {availableColumns.map((col) => (
                  // eslint-disable-next-line jsx-a11y/control-has-associated-label -- datalist options are suggestions, not interactive controls
                  <option key={col} value={col} />
                ))}
              </datalist>
              <span style={styles.hint}>Column used as unique entity identifier</span>
            </div>

            {syncMode === 'incremental' && (
              <div style={styles.field}>
                <label htmlFor={`object-${index}-watermark`} style={styles.label}>
                  Watermark Column
                  <span style={styles.required}>*</span>
                </label>
                <input
                  id={`object-${index}-watermark`}
                  type="text"
                  style={styles.input}
                  value={object.watermarkColumn || ''}
                  onChange={(e) => onUpdate({ watermarkColumn: e.target.value })}
                  placeholder="e.g., updated_at, modified_date"
                  disabled={disabled}
                  aria-label="Watermark Column"
                />
                <span style={styles.hint}>Column for tracking changes (datetime)</span>
              </div>
            )}
          </div>

          {/* Column Mappings */}
          <div style={styles.mappingsSection}>
            <div style={styles.mappingsHeader}>
              <h4 style={styles.mappingsTitle}>
                <Columns size={16} />
                Column Mappings
              </h4>
              <button
                style={styles.addMappingButton}
                onClick={onAddMapping}
                disabled={disabled}
                type="button"
              >
                <Plus size={14} />
                Add Mapping
              </button>
            </div>

            {(!object.columnMappings || object.columnMappings.length === 0) ? (
              <div style={styles.noMappings}>
                No column mappings defined. All columns will be extracted to properties.
              </div>
            ) : (
              <div style={styles.mappingsList}>
                <div style={styles.mappingsHeaderRow}>
                  <span>Source Column</span>
                  <span>Target Field</span>
                  <span>Transform</span>
                  <span></span>
                </div>
                {object.columnMappings.map((mapping, mappingIndex) => (
                  <div key={mappingIndex} style={styles.mappingRow}>
                    <input
                      type="text"
                      style={styles.mappingInput}
                      value={mapping.sourceColumn}
                      onChange={(e) =>
                        onUpdateMapping(mappingIndex, { sourceColumn: e.target.value })
                      }
                      placeholder="source_column"
                      aria-label={`Source column for mapping ${mappingIndex + 1}`}
                      disabled={disabled}
                      list={`columns-${index}`}
                    />
                    <select
                      style={styles.mappingSelect}
                      value={mapping.targetField}
                      onChange={(e) =>
                        onUpdateMapping(mappingIndex, { targetField: e.target.value })
                      }
                      disabled={disabled}
                      aria-label="Target field"
                    >
                      <option value="">Select target...</option>
                      {CANONICAL_TARGET_FIELDS.map((field) => (
                        <option key={field.value} value={field.value}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                    <select
                      style={styles.mappingSelect}
                      value={mapping.transform || 'none'}
                      onChange={(e) =>
                        onUpdateMapping(mappingIndex, {
                          transform: e.target.value as ColumnMapping['transform'],
                        })
                      }
                      disabled={disabled}
                      aria-label="Transform"
                    >
                      {COLUMN_TRANSFORMS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <button
                      style={styles.removeMappingButton}
                      onClick={() => onRemoveMapping(mappingIndex)}
                      disabled={disabled}
                      type="button"
                      aria-label="Remove mapping"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Row Limit (optional) */}
          <div style={styles.field}>
            <label htmlFor={`object-${index}-row-limit`} style={styles.label}>
              Row Limit
              <span style={styles.optional}>(optional, for testing)</span>
            </label>
            <input
              id={`object-${index}-row-limit`}
              type="number"
              style={{ ...styles.input, maxWidth: '150px' }}
              value={object.limit || ''}
              onChange={(e) =>
                onUpdate({ limit: e.target.value ? parseInt(e.target.value) : undefined })
              }
              placeholder="No limit"
              min={1}
              max={1000000}
              disabled={disabled}
              aria-label="Row Limit"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Styles
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '40px',
    color: 'rgb(var(--color-archive))',
  },
  spinner: {
    width: '20px',
    height: '20px',
    border: '2px solid #E6E4DF',
    borderTopColor: 'rgb(var(--color-bark))',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  noSchema: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '40px',
    color: 'rgb(var(--color-archive))',
    textAlign: 'center',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    margin: 0,
    fontSize: '14px',
    fontWeight: 600,
    color: 'rgb(var(--color-accessible-gray))',
  },
  fieldRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'rgb(var(--color-accessible-gray))',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  required: {
    color: 'rgb(var(--color-error))',
  },
  optional: {
    fontSize: '11px',
    color: 'rgb(var(--color-archive))',
    fontWeight: 400,
  },
  input: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #E6E4DF',
    borderRadius: '6px',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  select: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #E6E4DF',
    borderRadius: '6px',
    outline: 'none',
    backgroundColor: 'white',
    cursor: 'pointer',
  },
  textarea: {
    padding: '8px 12px',
    fontSize: '13px',
    fontFamily: 'monospace',
    border: '1px solid #E6E4DF',
    borderRadius: '6px',
    outline: 'none',
    resize: 'vertical',
    minHeight: '60px',
  },
  hint: {
    fontSize: '11px',
    color: 'rgb(var(--color-archive))',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    color: 'rgb(var(--color-accessible-gray))',
    cursor: 'pointer',
  },
  addButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: 'rgb(var(--color-bark))',
    backgroundColor: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  objectCard: {
    border: '1px solid #E6E4DF',
    borderRadius: '8px',
    backgroundColor: 'rgb(var(--color-parchment-warm))',
    overflow: 'hidden',
  },
  objectHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 16px 4px 4px',
    backgroundColor: 'rgb(var(--color-parchment-warm))',
  },
  objectToggleButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    flex: 1,
    textAlign: 'left',
  },
  objectName: {
    fontSize: '14px',
    fontWeight: 500,
    color: 'rgb(var(--color-accessible-gray))',
  },
  objectSchema: {
    fontSize: '12px',
    color: 'rgb(var(--color-archive))',
    backgroundColor: 'rgb(var(--color-lichen))',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  removeButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px',
    color: 'rgb(var(--color-archive))',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'color 0.15s',
  },
  objectContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    padding: '16px',
    borderTop: '1px solid #E6E4DF',
    backgroundColor: 'white',
  },
  mappingsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '12px',
    backgroundColor: 'rgb(var(--color-parchment-warm))',
    borderRadius: '6px',
  },
  mappingsHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mappingsTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    margin: 0,
    fontSize: '13px',
    fontWeight: 500,
    color: 'rgb(var(--color-accessible-gray))',
  },
  addMappingButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    fontSize: '12px',
    color: 'rgb(var(--color-bark))',
    backgroundColor: 'white',
    border: '1px solid #E6E4DF',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  noMappings: {
    fontSize: '12px',
    color: 'rgb(var(--color-archive))',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: '12px',
  },
  mappingsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  mappingsHeaderRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 120px 32px',
    gap: '8px',
    fontSize: '11px',
    fontWeight: 500,
    color: 'rgb(var(--color-archive))',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    padding: '0 4px',
  },
  mappingRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 120px 32px',
    gap: '8px',
    alignItems: 'center',
  },
  mappingInput: {
    padding: '6px 8px',
    fontSize: '13px',
    border: '1px solid #E6E4DF',
    borderRadius: '4px',
    outline: 'none',
  },
  mappingSelect: {
    padding: '6px 8px',
    fontSize: '13px',
    border: '1px solid #E6E4DF',
    borderRadius: '4px',
    outline: 'none',
    backgroundColor: 'white',
  },
  removeMappingButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px',
    color: 'rgb(var(--color-archive))',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
};

export default ExtractionConfigForm;
