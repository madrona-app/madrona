import { useState, useEffect } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams, useNavigate } from 'react-router-dom';
import { Lock, CheckCircle, XCircle, Loader2, Zap } from 'lucide-react';
import { FaDatabase } from 'react-icons/fa';
import {
  getConnectorInstance,
  getConnectorDefinitions,
  updateConnectorInstance,
  testConnectorConnection,
} from '../../lib/api';
import type { ConnectorInstance, ConnectorDefinition } from '../../lib/schemas';
import type { ConnectionTestResult } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import { classifyConnectorField, canEditConnectorSettings, getFieldLockReason } from '../../lib/connectorPermissions';
import CatalogBrowser from '../../components/CatalogBrowser';
import DataPreviewModal from '../../components/DataPreviewModal';

export default function SettingsPage() {
  const { instanceId, orgId } = useParams<{ instanceId: string; orgId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();

  const [instance, setInstance] = useState<ConnectorInstance | null>(null);
  const [definition, setDefinition] = useState<ConnectorDefinition | null>(null);
  const [config, setConfig] = useState<Record<string, any>>({});
  const [connectorName, setConnectorName] = useState('');
  const [connectorDescription, setConnectorDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Connection testing state
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<ConnectionTestResult | null>(null);

  // Preview modal state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewObjectId, setPreviewObjectId] = useState('');
  const [previewObjectName, setPreviewObjectName] = useState('');

  // Permission checks
  const hasEditPermission = hasPermission('connectors.edit');
  const editCapabilities = canEditConnectorSettings(hasEditPermission);

  useEffect(() => {
    loadConnector();
  }, [instanceId, orgId]); // Include orgId in dependency array

  const loadConnector = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!instanceId) {
        throw new Error('Instance ID is required');
      }

      // Load connector instance
      const instanceData = await getConnectorInstance(instanceId);
      setInstance(instanceData);
      setConfig(instanceData.config || {});
      setConnectorName(instanceData.name);
      setConnectorDescription(instanceData.config?.description || '');

      // Load connector definitions
      const definitions = await getConnectorDefinitions();
      const defData = definitions.find(
        (d: ConnectorDefinition) => d.connector_definition_id === instanceData.connector_definition_id
      );
      setDefinition(defData ?? null);
    } catch (err: any) {
      setError(err.message || 'Failed to load connector');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!instance || !instanceId) return;

    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      // Save description in config
      const updatedConfig = { ...config };
      if (connectorDescription) {
        updatedConfig.description = connectorDescription;
      } else {
        delete updatedConfig.description;
      }

      await updateConnectorInstance(instanceId, {
        name: connectorName,
        config: updatedConfig,
      });

      setSuccessMessage('Settings saved');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // Check if this is a database connector
  const isDatabaseConnector = definition?.key?.startsWith('db-') ?? false;

  // Handle connection test
  const handleTestConnection = async () => {
    if (!instanceId) return;

    try {
      setTestingConnection(true);
      setConnectionResult(null);
      const result = await testConnectorConnection(instanceId);
      setConnectionResult(result);
    } catch (err: any) {
      setConnectionResult({
        success: false,
        message: 'Connection test failed',
        error: err.message || 'Unknown error',
      });
    } finally {
      setTestingConnection(false);
    }
  };

  // Handle preview request from catalog browser
  const handlePreview = (objectId: string, objectName: string) => {
    setPreviewObjectId(objectId);
    setPreviewObjectName(objectName);
    setPreviewOpen(true);
  };

  const inputBaseClasses = "w-full px-3 py-2.5 border border-lichen rounded-md text-sm focus-visible:outline-none focus-visible:border-bark focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2";

  const renderField = (key: string, schema: any) => {
    const value = config[key] || '';
    const isRequired = definition?.config_schema.required?.includes(key);
    const isPassword = key.toLowerCase().includes('key') ||
                      key.toLowerCase().includes('secret') ||
                      key.toLowerCase().includes('password') ||
                      key.toLowerCase().includes('token') ||
                      key.toLowerCase().includes('credential');
    const isLargeText = key.toLowerCase().includes('json') ||
                       (schema.minLength && schema.minLength > 100);

    // Classify field and determine if it's editable
    const fieldType = classifyConnectorField(key, schema);
    const lockReason = getFieldLockReason(fieldType, hasEditPermission);
    const isFieldLocked = !!lockReason;

    // Determine field editability based on type and permissions
    let isFieldEditable = false;
    if (fieldType === 'editable') {
      isFieldEditable = editCapabilities.canEditMetadata;
    } else if (fieldType === 'operational') {
      isFieldEditable = editCapabilities.canEditOperational;
    } else {
      isFieldEditable = editCapabilities.canEditCredentials;
    }

    const fieldId = `config-field-${key}`;
    return (
      <div key={key} className="mb-5">
        <label htmlFor={fieldId} className="flex items-center gap-2 mb-2 font-medium">
          {schema.title || key}
          {isRequired && <span className="text-semantic-error ml-1">*</span>}
          {isFieldLocked && (
            <Lock size={14} className="text-stone" aria-label={lockReason || undefined} />
          )}
        </label>
        {schema.description && (
          <p className="text-sm text-archive mb-2 -mt-1">
            {schema.description}
          </p>
        )}
        {isFieldLocked && lockReason && (
          <div className="text-xs text-semantic-warning bg-semantic-warning/10 px-3 py-2 rounded mb-2 border border-semantic-warning/20">
            {lockReason}
          </div>
        )}
        {schema.type === 'string' && isLargeText && (
          <textarea
            id={fieldId}
            value={value}
            onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
            placeholder={schema.default || ''}
            rows={8}
            disabled={!isFieldEditable}
            aria-label={schema.title || key}
            className={`${inputBaseClasses} font-mono text-xs resize-y ${
              isFieldEditable ? 'bg-parchment cursor-text' : 'bg-parchment cursor-not-allowed opacity-60'
            }`}
          />
        )}
        {schema.type === 'string' && !isLargeText && (
          <input
            id={fieldId}
            type={isPassword ? 'password' : 'text'}
            value={value}
            onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
            placeholder={schema.default || ''}
            disabled={!isFieldEditable}
            aria-label={schema.title || key}
            className={`${inputBaseClasses} ${isPassword ? 'font-mono' : ''} ${
              isFieldEditable ? 'bg-parchment cursor-text' : 'bg-parchment cursor-not-allowed opacity-60'
            }`}
          />
        )}
        {schema.type === 'integer' && (
          <input
            id={fieldId}
            type="number"
            value={value}
            onChange={(e) => setConfig({ ...config, [key]: parseInt(e.target.value) || schema.default })}
            min={schema.minimum}
            max={schema.maximum}
            placeholder={schema.default?.toString() || ''}
            disabled={!isFieldEditable}
            aria-label={schema.title || key}
            className={`${inputBaseClasses} ${
              isFieldEditable ? 'bg-parchment cursor-text' : 'bg-parchment cursor-not-allowed opacity-60'
            }`}
          />
        )}
        {schema.type === 'boolean' && (
          <label className={`flex items-center ${isFieldEditable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
            <Checkbox
              id={fieldId}
              checked={value || false}
              onChange={(e) => setConfig({ ...config, [key]: e.target.checked })}
              disabled={!isFieldEditable}
              className="mr-2"
              aria-label={schema.title || key}
            />
            <span>Enable</span>
          </label>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-10 text-center">
        <div className="spinner mx-auto"></div>
        <p className="mt-4 text-archive">Loading settings...</p>
      </div>
    );
  }

  if (!instance || !definition) {
    return (
      <div className="p-10 text-center">
        <p className="text-semantic-error">Connector not found</p>
        <button
          onClick={() => navigate(-1)}
          className="mt-4 px-4 py-2 bg-stone/30 border border-lichen rounded-md cursor-pointer hover:bg-stone/50 transition-colors"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-10 px-5">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate(-1)}
          className="px-4 py-2 bg-stone/30 border border-lichen rounded-md cursor-pointer mb-4 hover:bg-stone/50 transition-colors"
        >
          {'\u2190'} Back
        </button>
        <h1 className="text-2xl font-semibold text-ink mb-2">
          {definition.display_name} Settings
        </h1>
        <p className="text-archive">
          {instance.name} {'\u2022'} {definition.direction === 'source' ? 'Source' : 'Target'} Connector
        </p>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="px-4 py-3 bg-semantic-error/5 border border-semantic-error/20 rounded-md text-semantic-error mb-6">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="px-4 py-3 bg-semantic-success/10 border border-semantic-success/20 rounded-md text-semantic-success mb-6">
          {successMessage}
        </div>
      )}

      {/* Configuration Form */}
      <div className="bg-parchment border border-lichen rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-5 text-forest">
          Configuration
        </h2>

        {/* Connector Name Field */}
        <div className="mb-6 pb-6 border-b border-lichen">
          <label htmlFor="connector-name" className="flex items-center gap-2 mb-2 font-medium">
            Connector Name
            <span className="text-semantic-error ml-1">*</span>
            {!editCapabilities.canEditMetadata && (
              <Lock size={14} className="text-stone" aria-label="Name editing restricted" />
            )}
          </label>
          <p className="text-sm text-archive mb-2 -mt-1">
            A friendly name to identify this connector instance
          </p>
          {!editCapabilities.canEditMetadata && editCapabilities.lockReason && (
            <div className="text-xs text-semantic-warning bg-semantic-warning/10 px-3 py-2 rounded mb-2 border border-semantic-warning/20">
              {editCapabilities.lockReason}
            </div>
          )}
          <input
            id="connector-name"
            type="text"
            value={connectorName}
            onChange={(e) => setConnectorName(e.target.value)}
            placeholder="Enter connector name"
            disabled={!editCapabilities.canEditMetadata}
            aria-label="Connector Name"
            className={`${inputBaseClasses} ${
              editCapabilities.canEditMetadata ? 'bg-parchment cursor-text' : 'bg-parchment cursor-not-allowed opacity-60'
            }`}
          />
        </div>

        {/* Connector Description Field */}
        <div className="mb-6 pb-6 border-b border-lichen">
          <label htmlFor="connector-description" className="flex items-center gap-2 mb-2 font-medium">
            Description
            {!editCapabilities.canEditMetadata && (
              <Lock size={14} className="text-stone" aria-label="Description editing restricted" />
            )}
          </label>
          <p className="text-sm text-archive mb-2 -mt-1">
            Optional notes about what this connector is used for
          </p>
          {!editCapabilities.canEditMetadata && editCapabilities.lockReason && (
            <div className="text-xs text-semantic-warning bg-semantic-warning/10 px-3 py-2 rounded mb-2 border border-semantic-warning/20">
              {editCapabilities.lockReason}
            </div>
          )}
          <textarea
            id="connector-description"
            value={connectorDescription}
            onChange={(e) => setConnectorDescription(e.target.value)}
            placeholder="e.g., Syncs historical collections data from Smithsonian API"
            rows={3}
            disabled={!editCapabilities.canEditMetadata}
            aria-label="Description"
            className={`${inputBaseClasses} resize-y font-[inherit] ${
              editCapabilities.canEditMetadata ? 'bg-parchment cursor-text' : 'bg-parchment cursor-not-allowed opacity-60'
            }`}
          />
        </div>

        {/* Config Fields */}
        {definition.config_schema.properties &&
          Object.entries(definition.config_schema.properties).map(([key, schema]) =>
            renderField(key, schema)
          )}

        {/* Action Buttons */}
        <div className="mt-8 pt-6 border-t border-lichen flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving || !hasEditPermission || (!editCapabilities.canEditMetadata && !editCapabilities.canEditOperational)}
            className={`px-6 py-2.5 border-none rounded-md font-medium flex items-center gap-2 text-parchment transition-colors ${
              (saving || !hasEditPermission)
                ? 'bg-stone cursor-not-allowed'
                : 'bg-bark cursor-pointer hover:bg-copper-dark'
            }`}
          >
            {saving && <div className="spinner w-4 h-4"></div>}
            {saving ? 'Saving...' : 'Save Settings'}
          </button>

          <button
            onClick={loadConnector}
            disabled={saving}
            className={`px-6 py-2.5 bg-parchment text-ink border border-lichen rounded-md font-medium hover:bg-stone/30 transition-colors ${
              saving ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            }`}
          >
            Reset
          </button>
        </div>

        {/* Permission Notice */}
        {editCapabilities.lockReason && (
          <div className="mt-4 px-4 py-3 bg-semantic-warning/10 border border-semantic-warning/20 rounded-md text-sm text-semantic-warning">
            {editCapabilities.lockReason}
          </div>
        )}
      </div>

      {/* Database Connector Tools */}
      {isDatabaseConnector && instanceId && (
        <>
          {/* Test Connection Section */}
          <div className="mt-6 bg-parchment border border-lichen rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <Zap size={20} className="text-bark" />
              <h2 className="text-lg font-semibold m-0 text-forest">
                Connection Test
              </h2>
            </div>

            <p className="text-archive text-sm mb-4">
              Test the database connection to verify your credentials and network connectivity.
            </p>

            <div className="flex items-center gap-4">
              <button
                onClick={handleTestConnection}
                disabled={testingConnection}
                className={`px-5 py-2.5 border-none rounded-md font-medium flex items-center gap-2 text-parchment transition-colors ${
                  testingConnection
                    ? 'bg-stone cursor-not-allowed'
                    : 'bg-bark cursor-pointer hover:bg-copper-dark'
                }`}
              >
                {testingConnection ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Zap size={16} />
                    Test Connection
                  </>
                )}
              </button>

              {connectionResult && (
                <div
                  className={`flex items-center gap-2 px-4 py-2 rounded-md border ${
                    connectionResult.success
                      ? 'bg-semantic-success/10 border-semantic-success/20'
                      : 'bg-semantic-error/5 border-semantic-error/20'
                  }`}
                >
                  {connectionResult.success ? (
                    <CheckCircle size={18} className="text-semantic-success" />
                  ) : (
                    <XCircle size={18} className="text-semantic-error" />
                  )}
                  <div>
                    <span
                      className={`font-medium ${
                        connectionResult.success ? 'text-semantic-success' : 'text-semantic-error'
                      }`}
                    >
                      {connectionResult.success ? 'Connected' : 'Failed'}
                    </span>
                    {connectionResult.latency_ms && (
                      <span className="text-archive ml-2 text-xs">
                        {connectionResult.latency_ms}ms
                      </span>
                    )}
                    {connectionResult.server_version && (
                      <span className="text-archive ml-2 text-xs">
                        v{connectionResult.server_version}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {connectionResult && !connectionResult.success && connectionResult.error && (
              <div className="mt-3 p-3 bg-semantic-error/5 border border-semantic-error/20 rounded-md text-semantic-error text-xs">
                {connectionResult.error}
              </div>
            )}
          </div>

          {/* Catalog Browser Section */}
          <div className="mt-6 bg-parchment border border-lichen rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <FaDatabase size={20} className="text-bark" />
              <h2 className="text-lg font-semibold m-0 text-forest">
                Database Catalog
              </h2>
            </div>

            <p className="text-archive text-sm mb-4">
              Browse schemas, tables, and columns. Click on a table to see its structure or preview data.
            </p>

            <CatalogBrowser instanceId={instanceId} onPreview={handlePreview} />
          </div>
        </>
      )}

      {/* Help Text */}
      <div className="mt-6 p-4 bg-parchment border border-lichen rounded-md text-sm text-archive">
        <p className="font-medium mb-2">Tip</p>
        <p>
          Make sure to save your settings after making changes. Required fields are marked with an asterisk (*).
        </p>
      </div>

      {/* Data Preview Modal */}
      {isDatabaseConnector && instanceId && (
        <DataPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          instanceId={instanceId}
          objectId={previewObjectId}
          objectName={previewObjectName}
        />
      )}
    </div>
  );
}
