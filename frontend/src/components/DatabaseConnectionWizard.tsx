import { useState, useEffect } from 'react';
import Checkbox from './Checkbox';
import {
  ChevronRight,
  ChevronLeft,
  Check,
  Zap,
  Layers,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  Eye,
  X,
} from 'lucide-react';
import { FaDatabase } from 'react-icons/fa';
import {
  testConnectorConnection,
  getConnectorCatalog,
  describeConnectorObject,
  createConnectorInstance,
  updateConnectorInstance,
  deleteConnectorInstance,
  previewConnectorData,
} from '../lib/api';
import type {
  ConnectionTestResult,
  CatalogResult,
  CatalogObject,
  ObjectDescription,
  PreviewResult,
} from '../lib/api';
import type { ConnectorDefinition } from '../lib/schemas';
import { ConnectorIcon } from '../lib/connectorIcons';
import { logger } from '../lib/logger';
import { ModalPortal } from './ModalPortal';

interface DatabaseConnectionWizardProps {
  definition: ConnectorDefinition;
  organizationId: string;
  onComplete: (instanceId: string) => void;
  onCancel: () => void;
}

type WizardStep = 'configure' | 'test' | 'catalog' | 'complete';

const STEPS: { id: WizardStep; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: 'configure', label: 'Configure', icon: FaDatabase },
  { id: 'test', label: 'Test', icon: Zap },
  { id: 'catalog', label: 'Browse', icon: Layers },
  { id: 'complete', label: 'Complete', icon: Check },
];

export default function DatabaseConnectionWizard({
  definition,
  organizationId,
  onComplete,
  onCancel,
}: DatabaseConnectionWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('configure');
  const [config, setConfig] = useState<Record<string, any>>({});
  const [connectorName, setConnectorName] = useState('');
  const [nameError, setNameError] = useState('');

  // Test connection state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [tempInstanceId, setTempInstanceId] = useState<string | null>(null);

  // Catalog state
  const [catalog, setCatalog] = useState<CatalogResult | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedObjects, setSelectedObjects] = useState<Set<string>>(new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [objectDescriptions, setObjectDescriptions] = useState<Record<string, ObjectDescription>>({});

  // Preview state
  const [previewObject, setPreviewObject] = useState<{ id: string; name: string } | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Creating state
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Initialize config with defaults
  useEffect(() => {
    if (definition.config_schema?.properties) {
      const defaults: Record<string, any> = {};
      Object.entries(definition.config_schema.properties).forEach(([key, schema]: [string, any]) => {
        if (schema.default !== undefined) {
          defaults[key] = schema.default;
        }
      });
      setConfig(defaults);
    }
    // Set default name based on definition
    setConnectorName(`${definition.display_name} Connection`);
  }, [definition]);

  const currentStepIndex = STEPS.findIndex((s) => s.id === currentStep);

  const canProceed = () => {
    switch (currentStep) {
      case 'configure': {
        // Check required fields
        const required = definition.config_schema?.required || [];
        const hasName = connectorName.trim().length > 0;
        const hasRequired = required.every((key: string) => {
          const value = config[key];
          return value !== undefined && value !== null && value !== '';
        });
        return hasName && hasRequired;
      }
      case 'test':
        return testResult?.success === true;
      case 'catalog':
        return true; // Catalog browsing is optional
      default:
        return false;
    }
  };

  const handleNext = async () => {
    if (currentStep === 'configure') {
      setCurrentStep('test');
      // Auto-start test when entering test step
      handleTestConnection();
    } else if (currentStep === 'test') {
      setCurrentStep('catalog');
      // Auto-load catalog when entering catalog step
      if (tempInstanceId) {
        handleLoadCatalog();
      }
    } else if (currentStep === 'catalog') {
      setCurrentStep('complete');
      // Create the actual connector instance
      handleCreateInstance();
    }
  };

  const handleBack = () => {
    const idx = currentStepIndex;
    if (idx > 0) {
      setCurrentStep(STEPS[idx - 1].id);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      // First, create a temporary connector instance to test
      const tempInstance = await createConnectorInstance({
        organization_id: organizationId,
        connector_definition_id: definition.connector_definition_id,
        name: `_temp_test_${Date.now()}`,
        config,
      });
      setTempInstanceId(tempInstance.connector_instance_id);

      // Now test the connection
      const result = await testConnectorConnection(tempInstance.connector_instance_id);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({
        success: false,
        message: 'Connection test failed',
        error: err.message || 'Failed to create test instance',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleLoadCatalog = async () => {
    if (!tempInstanceId) return;

    setLoadingCatalog(true);
    setCatalogError(null);

    try {
      const result = await getConnectorCatalog(tempInstanceId);
      setCatalog(result);
    } catch (err: any) {
      setCatalogError(err.message || 'Failed to load catalog');
    } finally {
      setLoadingCatalog(false);
    }
  };

  const handleDescribeObject = async (objectId: string) => {
    if (!tempInstanceId || objectDescriptions[objectId]) return;

    try {
      const desc = await describeConnectorObject(tempInstanceId, objectId);
      setObjectDescriptions((prev) => ({ ...prev, [objectId]: desc }));
    } catch (err) {
      logger.error('Failed to describe object:', err);
    }
  };

  const handlePreview = async (objectId: string, objectName: string) => {
    if (!tempInstanceId) return;

    setPreviewObject({ id: objectId, name: objectName });
    setLoadingPreview(true);
    setPreviewData(null);

    try {
      const result = await previewConnectorData(tempInstanceId, {
        object_id: objectId,
        limit: 10,
      });
      setPreviewData(result);
    } catch (err: any) {
      logger.error('Preview failed:', err);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleCreateInstance = async () => {
    if (!tempInstanceId) return;

    setCreating(true);
    setCreateError(null);

    try {
      // Update the temp instance with the real name
      await updateConnectorInstance(tempInstanceId, { name: connectorName });
      onComplete(tempInstanceId);
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create connector');
      setCreating(false);
    }
  };

  // Handle cancel - clean up temp instance if it exists
  const handleCancel = async () => {
    if (tempInstanceId) {
      try {
        await deleteConnectorInstance(tempInstanceId);
      } catch (err) {
        // Ignore cleanup errors
        logger.error('Failed to clean up temp instance:', err);
      }
    }
    onCancel();
  };

  const toggleObjectSelection = (objectId: string) => {
    setSelectedObjects((prev) => {
      const next = new Set(prev);
      if (next.has(objectId)) {
        next.delete(objectId);
      } else {
        next.add(objectId);
      }
      return next;
    });
  };

  const toggleExpanded = (objectId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(objectId)) {
        next.delete(objectId);
      } else {
        next.add(objectId);
      }
      return next;
    });
  };

  const renderConfigField = (key: string, schema: any) => {
    const value = config[key] ?? '';
    const isRequired = definition.config_schema?.required?.includes(key);
    const isPassword =
      key.toLowerCase().includes('password') ||
      key.toLowerCase().includes('secret') ||
      key.toLowerCase().includes('key') ||
      key.toLowerCase().includes('token');

    return (
      <div key={key} className="mb-4">
        <label htmlFor={`db-config-${key}`} className="block text-sm font-medium text-ink mb-1">
          {schema.title || key}
          {isRequired && <span className="text-semantic-error ml-1">*</span>}
        </label>
        {schema.description && (
          <p className="text-xs text-archive mb-2">{schema.description}</p>
        )}
        {schema.type === 'string' && (
          <input
            id={`db-config-${key}`}
            type={isPassword ? 'password' : 'text'}
            value={value}
            onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
            placeholder={schema.default || ''}
            className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            aria-label={schema.title || key}
          />
        )}
        {schema.type === 'integer' && (
          <input
            id={`db-config-${key}`}
            type="number"
            value={value}
            onChange={(e) => setConfig({ ...config, [key]: parseInt(e.target.value) || '' })}
            min={schema.minimum}
            max={schema.maximum}
            placeholder={schema.default?.toString() || ''}
            className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            aria-label={schema.title || key}
          />
        )}
        {schema.type === 'boolean' && (
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              id={`db-config-${key}`}
              checked={value || false}
              onChange={(e) => setConfig({ ...config, [key]: e.target.checked })}
              aria-label={schema.title || key}
            />
            <span className="text-sm text-ink">Enable</span>
          </label>
        )}
      </div>
    );
  };

  const renderCatalogTree = (objects: CatalogObject[], level = 0) => {
    return objects.map((obj) => {
      const isExpanded = expandedNodes.has(obj.id);
      const isSelected = selectedObjects.has(obj.id);
      const hasChildren = obj.type === 'schema' || obj.type === 'database';
      const isTable = obj.type === 'table' || obj.type === 'view' || obj.type === 'collection';
      const description = objectDescriptions[obj.id];

      return (
        <div key={obj.id}>
          <div
            className={`flex items-center gap-2 py-2 px-3 rounded cursor-pointer hover:bg-stone ${
              isSelected ? 'bg-bark/10 border border-bark/30' : ''
            }`}
            style={{ paddingLeft: `${level * 20 + 12}px` }}
          >
            {hasChildren ? (
              <button
                onClick={() => toggleExpanded(obj.id)}
                className="p-0.5 hover:bg-lichen rounded"
              >
                <ChevronRight
                  size={16}
                  className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                />
              </button>
            ) : (
              <span className="w-5" />
            )}

            {isTable && (
              <Checkbox
                checked={isSelected}
                onChange={() => toggleObjectSelection(obj.id)}
                aria-label={`Select ${obj.name}`}
              />
            )}

            <span className="flex-1 text-sm text-ink">{obj.name}</span>

            <span className="text-xs text-archive px-2 py-0.5 bg-stone rounded">
              {obj.type}
            </span>

            {isTable && (
              <div className="flex gap-1">
                <button
                  onClick={() => handleDescribeObject(obj.id)}
                  className="p-1 hover:bg-lichen rounded text-archive"
                  aria-label={`View columns for ${obj.name}`}
                >
                  <Layers size={14} aria-hidden="true" />
                </button>
                <button
                  onClick={() => handlePreview(obj.id, obj.name)}
                  className="p-1 hover:bg-bark/10 rounded text-bark"
                  aria-label={`Preview data for ${obj.name}`}
                >
                  <Eye size={14} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          {/* Show columns if described */}
          {description && isTable && (
            <div
              className="bg-stone border-l-2 border-lichen py-2 mb-2"
              style={{ marginLeft: `${level * 20 + 48}px` }}
            >
              <div className="text-xs font-medium text-archive px-3 pb-1">
                Columns ({description.columns.length})
              </div>
              {description.columns.slice(0, 10).map((col) => (
                <div key={col.name} className="flex items-center gap-2 px-3 py-0.5 text-xs">
                  <span className="font-mono text-ink">{col.name}</span>
                  <span className="text-archive">{col.type}</span>
                  {col.primary_key && (
                    <span className="text-semantic-warning bg-semantic-warning/10 px-1 rounded">PK</span>
                  )}
                </div>
              ))}
              {description.columns.length > 10 && (
                <div className="px-3 py-1 text-xs text-archive">
                  +{description.columns.length - 10} more columns
                </div>
              )}
            </div>
          )}

          {/* Render children if expanded */}
          {isExpanded && obj.children && renderCatalogTree(obj.children, level + 1)}
        </div>
      );
    });
  };

  return (
    <div className="bg-parchment rounded-lg shadow-lg max-w-4xl w-full max-h-[90vh] flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-lichen">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ConnectorIcon connectorKey={definition.key} category={definition.category ?? undefined} size={32} className="text-archive" />
            <div>
              <h2 className="text-xl font-semibold text-ink">
                Connect to {definition.display_name}
              </h2>
              <p className="text-sm text-archive">Set up your database connection</p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="p-2 hover:bg-stone rounded-full text-archive"
          >
            <X size={20} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-between mt-6">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            const isActive = step.id === currentStep;
            const isComplete = idx < currentStepIndex;

            return (
              <div key={step.id} className="flex items-center flex-1">
                <div
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                    isActive
                      ? 'bg-azurite/10 text-azurite'
                      : isComplete
                      ? 'text-semantic-success'
                      : 'text-archive'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      isActive
                        ? 'bg-bark text-parchment'
                        : isComplete
                        ? 'bg-semantic-success/10 text-semantic-success'
                        : 'bg-stone'
                    }`}
                  >
                    {isComplete ? <Check size={16} /> : <Icon size={16} />}
                  </div>
                  <span className="text-sm font-medium">{step.label}</span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 ${
                      idx < currentStepIndex ? 'bg-semantic-success/50' : 'bg-lichen'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Configure Step */}
        {currentStep === 'configure' && (
          <div>
            <div className="mb-6">
              <label htmlFor="db-connection-name" className="block text-sm font-medium text-ink mb-1">
                Connection Name <span className="text-semantic-error">*</span>
              </label>
              <p className="text-xs text-archive mb-2">
                A friendly name to identify this connection
              </p>
              <input
                id="db-connection-name"
                type="text"
                value={connectorName}
                onChange={(e) => {
                  setConnectorName(e.target.value);
                  setNameError('');
                }}
                placeholder="My Database Connection"
                className={`w-full px-3 py-2 border rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 ${
                  nameError ? 'border-semantic-error' : 'border-lichen'
                }`}
                aria-label="Connection Name"
              />
              {nameError && <p className="text-sm text-semantic-error mt-1">{nameError}</p>}
            </div>

            <div className="border-t border-lichen pt-6">
              <h3 className="text-lg font-medium text-ink mb-4">Connection Settings</h3>
              {definition.config_schema?.properties &&
                Object.entries(definition.config_schema.properties).map(([key, schema]) =>
                  renderConfigField(key, schema)
                )}
            </div>
          </div>
        )}

        {/* Test Step */}
        {currentStep === 'test' && (
          <div className="text-center py-8">
            {testing && (
              <div>
                <Loader2 size={48} className="mx-auto text-bark animate-spin mb-4" />
                <p className="text-lg text-ink">Testing connection...</p>
                <p className="text-sm text-archive mt-2">
                  Verifying credentials and network connectivity
                </p>
              </div>
            )}

            {!testing && testResult && (
              <div>
                {testResult.success ? (
                  <>
                    <CheckCircle size={48} className="mx-auto text-semantic-success mb-4" />
                    <p className="text-lg font-medium text-semantic-success">Connection Successful!</p>
                    <div className="mt-4 inline-flex items-center gap-4 px-4 py-2 bg-semantic-success/10 rounded-lg">
                      {testResult.latency_ms && (
                        <span className="text-sm text-semantic-success">
                          Latency: {testResult.latency_ms}ms
                        </span>
                      )}
                      {testResult.server_version && (
                        <span className="text-sm text-semantic-success">
                          Version: {testResult.server_version}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <XCircle size={48} className="mx-auto text-semantic-error mb-4" />
                    <p className="text-lg font-medium text-semantic-error">Connection Failed</p>
                    {testResult.error && (
                      <div className="mt-4 mx-auto max-w-md p-4 bg-semantic-error/10 rounded-lg text-left">
                        <p className="text-sm text-semantic-error">{testResult.error}</p>
                      </div>
                    )}
                    <button
                      onClick={() => setCurrentStep('configure')}
                      className="mt-6 px-4 py-2 text-bark hover:bg-bark/10 rounded-lg"
                    >
                      ← Go back to edit settings
                    </button>
                  </>
                )}
              </div>
            )}

            {!testing && !testResult && (
              <div>
                <AlertCircle size={48} className="mx-auto text-archive mb-4" />
                <p className="text-archive">Ready to test connection</p>
                <button
                  onClick={handleTestConnection}
                  className="mt-4 px-6 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark"
                >
                  Test Connection
                </button>
              </div>
            )}
          </div>
        )}

        {/* Catalog Step */}
        {currentStep === 'catalog' && (
          <div>
            <div className="mb-4">
              <h3 className="text-lg font-medium text-ink">Browse Database Catalog</h3>
              <p className="text-sm text-archive">
                Explore available schemas and tables. Optionally select the ones you want to use.
              </p>
            </div>

            {loadingCatalog && (
              <div className="text-center py-12">
                <Loader2 size={32} className="mx-auto text-bark animate-spin mb-3" />
                <p className="text-archive">Loading catalog...</p>
              </div>
            )}

            {catalogError && (
              <div className="p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg">
                <p className="text-semantic-error">{catalogError}</p>
                <button
                  onClick={handleLoadCatalog}
                  className="mt-2 text-sm text-semantic-error hover:underline"
                >
                  Retry
                </button>
              </div>
            )}

            {!loadingCatalog && catalog && (
              <div className="border border-lichen rounded-lg max-h-96 overflow-y-auto">
                {catalog.objects.length > 0 ? (
                  renderCatalogTree(catalog.objects)
                ) : (
                  <div className="text-center py-8 text-archive">No objects found</div>
                )}
              </div>
            )}

            {selectedObjects.size > 0 && (
              <div className="mt-4 p-3 bg-bark/10 rounded-lg">
                <p className="text-sm text-bark">
                  {selectedObjects.size} table{selectedObjects.size !== 1 ? 's' : ''} selected
                </p>
              </div>
            )}
          </div>
        )}

        {/* Complete Step */}
        {currentStep === 'complete' && (
          <div className="text-center py-8">
            {creating && (
              <div>
                <Loader2 size={48} className="mx-auto text-bark animate-spin mb-4" />
                <p className="text-lg text-ink">Creating connector...</p>
              </div>
            )}

            {createError && (
              <div>
                <XCircle size={48} className="mx-auto text-semantic-error mb-4" />
                <p className="text-lg font-medium text-semantic-error">Failed to create connector</p>
                <p className="text-sm text-semantic-error mt-2">{createError}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewObject && (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50">
          <div className="bg-parchment rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col m-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-lichen">
              <h3 className="font-medium text-ink">Preview: {previewObject.name}</h3>
              <button
                onClick={() => setPreviewObject(null)}
                className="p-1 hover:bg-stone rounded"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {loadingPreview && (
                <div className="text-center py-8">
                  <Loader2 size={24} className="mx-auto text-bark animate-spin" />
                </div>
              )}
              {previewData && (
                <table className="w-full text-sm">
                  <thead className="bg-stone">
                    <tr>
                      {previewData.columns.map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2 text-left text-xs font-medium text-archive uppercase"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-lichen">
                    {previewData.rows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-stone">
                        {previewData.columns.map((col) => (
                          <td key={col} className="px-3 py-2 text-ink whitespace-nowrap">
                            {row[col] === null ? (
                              <span className="text-archive italic">null</span>
                            ) : (
                              String(row[col])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Footer */}
      <div className="px-6 py-4 border-t border-lichen flex items-center justify-between bg-stone">
        <button
          onClick={currentStepIndex === 0 ? handleCancel : handleBack}
          className="px-4 py-2 text-ink hover:bg-parchment rounded-lg flex items-center gap-2"
        >
          <ChevronLeft size={18} />
          {currentStepIndex === 0 ? 'Cancel' : 'Back'}
        </button>

        <button
          onClick={handleNext}
          disabled={!canProceed() || creating}
          className={`px-6 py-2 rounded-lg flex items-center gap-2 ${
            canProceed() && !creating
              ? 'bg-bark text-parchment hover:bg-copper-dark'
              : 'bg-lichen text-archive cursor-not-allowed'
          }`}
        >
          {currentStep === 'catalog' ? 'Create Connector' : 'Continue'}
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
