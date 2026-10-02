import { useState, useEffect } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  Check,
  Globe,
  Key,
  Shield,
  Zap,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  X,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  HelpCircle,
} from 'lucide-react';
import {
  createConnectorInstance,
  updateConnectorInstance,
  deleteConnectorInstance,
  testConnectorConnection,
} from '../lib/api';
import type { ConnectionTestResult } from '../lib/api';
import type { ConnectorDefinition } from '../lib/schemas';
import { ConnectorIcon } from '../lib/connectorIcons';
import { logger } from '../lib/logger';

interface ApiConnectionWizardProps {
  definition: ConnectorDefinition;
  organizationId: string;
  onComplete: (instanceId: string) => void;
  onCancel: () => void;
}

type WizardStep = 'configure' | 'auth' | 'test' | 'complete';
type AuthType = 'none' | 'api_key' | 'basic' | 'bearer' | 'oauth2_client' | 'custom_headers';

interface AuthConfig {
  type: AuthType;
  // API Key
  api_key?: string;
  api_key_name?: string;
  api_key_location?: 'header' | 'query';
  // Basic Auth
  username?: string;
  password?: string;
  // Bearer Token
  bearer_token?: string;
  // OAuth2 Client Credentials
  client_id?: string;
  client_secret?: string;
  token_url?: string;
  scope?: string;
  // Custom Headers
  custom_headers?: { key: string; value: string }[];
}

const STEPS: { id: WizardStep; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: 'configure', label: 'Configure', icon: Globe },
  { id: 'auth', label: 'Authentication', icon: Key },
  { id: 'test', label: 'Test', icon: Zap },
  { id: 'complete', label: 'Complete', icon: Check },
];

const AUTH_TYPES: { id: AuthType; label: string; description: string }[] = [
  { id: 'none', label: 'No Authentication', description: 'Public API with no authentication required' },
  { id: 'api_key', label: 'API Key', description: 'Authenticate using an API key in header or query parameter' },
  { id: 'basic', label: 'Basic Auth', description: 'HTTP Basic Authentication with username and password' },
  { id: 'bearer', label: 'Bearer Token', description: 'Authenticate using a bearer token in the Authorization header' },
  { id: 'oauth2_client', label: 'OAuth2 Client Credentials', description: 'OAuth2 flow for server-to-server authentication' },
  { id: 'custom_headers', label: 'Custom Headers', description: 'Define custom HTTP headers for authentication' },
];

export default function ApiConnectionWizard({
  definition,
  organizationId,
  onComplete,
  onCancel,
}: ApiConnectionWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('configure');

  // Configure step
  const [connectorName, setConnectorName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [configErrors, setConfigErrors] = useState<Record<string, string>>({});

  // Auth step
  const [authConfig, setAuthConfig] = useState<AuthConfig>({ type: 'none', custom_headers: [] });
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  // Test step
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [tempInstanceId, setTempInstanceId] = useState<string | null>(null);
  const [_testEndpoint, _setTestEndpoint] = useState('');

  // Complete step
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Initialize defaults
  useEffect(() => {
    setConnectorName(`${definition.display_name} Connection`);
    // Check if definition has default base_url in config_schema
    const defaultBaseUrl = definition.config_schema?.properties?.base_url?.default;
    if (defaultBaseUrl) {
      setBaseUrl(defaultBaseUrl);
    }
  }, [definition]);

  const currentStepIndex = STEPS.findIndex((s) => s.id === currentStep);

  const validateConfig = (): boolean => {
    const errors: Record<string, string> = {};

    if (!connectorName.trim()) {
      errors.name = 'Connection name is required';
    }

    if (!baseUrl.trim()) {
      errors.baseUrl = 'Base URL is required';
    } else {
      try {
        new URL(baseUrl);
      } catch {
        errors.baseUrl = 'Please enter a valid URL';
      }
    }

    setConfigErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateAuth = (): boolean => {
    switch (authConfig.type) {
      case 'none':
        return true;
      case 'api_key':
        return !!(authConfig.api_key && authConfig.api_key_name);
      case 'basic':
        return !!(authConfig.username && authConfig.password);
      case 'bearer':
        return !!authConfig.bearer_token;
      case 'oauth2_client':
        return !!(authConfig.client_id && authConfig.client_secret && authConfig.token_url);
      case 'custom_headers':
        return (authConfig.custom_headers || []).length > 0 &&
          authConfig.custom_headers!.every(h => h.key && h.value);
      default:
        return false;
    }
  };

  const canProceed = (): boolean => {
    switch (currentStep) {
      case 'configure':
        return !!connectorName.trim() && !!baseUrl.trim();
      case 'auth':
        return validateAuth();
      case 'test':
        return testResult?.success === true;
      default:
        return false;
    }
  };

  const buildConfig = (): Record<string, any> => {
    const config: Record<string, any> = {
      base_url: baseUrl,
      auth_type: authConfig.type,
    };

    switch (authConfig.type) {
      case 'api_key':
        config.api_key = authConfig.api_key;
        config.api_key_name = authConfig.api_key_name;
        config.api_key_location = authConfig.api_key_location || 'header';
        break;
      case 'basic':
        config.username = authConfig.username;
        config.password = authConfig.password;
        break;
      case 'bearer':
        config.bearer_token = authConfig.bearer_token;
        break;
      case 'oauth2_client':
        config.client_id = authConfig.client_id;
        config.client_secret = authConfig.client_secret;
        config.token_url = authConfig.token_url;
        if (authConfig.scope) config.scope = authConfig.scope;
        break;
      case 'custom_headers':
        config.custom_headers = authConfig.custom_headers;
        break;
    }

    return config;
  };

  const handleNext = async () => {
    if (currentStep === 'configure') {
      if (validateConfig()) {
        setCurrentStep('auth');
      }
    } else if (currentStep === 'auth') {
      setCurrentStep('test');
      handleTestConnection();
    } else if (currentStep === 'test') {
      setCurrentStep('complete');
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
      // Create a temporary connector instance
      const tempInstance = await createConnectorInstance({
        organization_id: organizationId,
        connector_definition_id: definition.connector_definition_id,
        name: `_temp_api_test_${Date.now()}`,
        config: buildConfig(),
      });
      setTempInstanceId(tempInstance.connector_instance_id);

      // Test the connection
      const result = await testConnectorConnection(tempInstance.connector_instance_id);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({
        success: false,
        message: 'Connection test failed',
        error: err.message || 'Failed to test connection',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleCreateInstance = async () => {
    if (!tempInstanceId) return;

    setCreating(true);
    setCreateError(null);

    try {
      await updateConnectorInstance(tempInstanceId, { name: connectorName });
      onComplete(tempInstanceId);
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create connector');
      setCreating(false);
    }
  };

  const handleCancel = async () => {
    if (tempInstanceId) {
      try {
        await deleteConnectorInstance(tempInstanceId);
      } catch (err) {
        logger.error('Failed to clean up temp instance:', err);
      }
    }
    onCancel();
  };

  const toggleShowSecret = (field: string) => {
    setShowSecrets((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const addCustomHeader = () => {
    setAuthConfig((prev) => ({
      ...prev,
      custom_headers: [...(prev.custom_headers || []), { key: '', value: '' }],
    }));
  };

  const updateCustomHeader = (index: number, field: 'key' | 'value', value: string) => {
    setAuthConfig((prev) => {
      const headers = [...(prev.custom_headers || [])];
      headers[index] = { ...headers[index], [field]: value };
      return { ...prev, custom_headers: headers };
    });
  };

  const removeCustomHeader = (index: number) => {
    setAuthConfig((prev) => ({
      ...prev,
      custom_headers: (prev.custom_headers || []).filter((_, i) => i !== index),
    }));
  };

  const renderSecretInput = (
    field: string,
    value: string | undefined,
    onChange: (value: string) => void,
    placeholder: string,
    ariaLabel: string,
    inputId?: string
  ) => (
    <div className="relative">
      <input
        id={inputId}
        type={showSecrets[field] ? 'text' : 'password'}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="w-full px-3 py-2 pr-10 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 font-mono text-sm"
      />
      <button
        type="button"
        onClick={() => toggleShowSecret(field)}
        aria-label={showSecrets[field] ? `Hide ${ariaLabel.toLowerCase()}` : `Show ${ariaLabel.toLowerCase()}`}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-archive hover:text-ink"
      >
        {showSecrets[field] ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  );

  const renderAuthForm = () => {
    switch (authConfig.type) {
      case 'none':
        return (
          <div className="text-center py-8 text-archive">
            <Shield size={32} className="mx-auto mb-3 text-archive" />
            <p>No authentication will be used for this API.</p>
          </div>
        );

      case 'api_key':
        return (
          <div className="space-y-4">
            <div>
              <label htmlFor="auth-api-key" className="block text-sm font-medium text-ink mb-1">
                API Key <span className="text-semantic-error">*</span>
              </label>
              {renderSecretInput(
                'api_key',
                authConfig.api_key,
                (v) => setAuthConfig({ ...authConfig, api_key: v }),
                'Enter your API key',
                'API Key',
                'auth-api-key'
              )}
            </div>
            <div>
              <label htmlFor="api-key-name" className="block text-sm font-medium text-ink mb-1">
                Header/Parameter Name <span className="text-semantic-error">*</span>
              </label>
              <input
                id="api-key-name"
                type="text"
                value={authConfig.api_key_name || ''}
                onChange={(e) => setAuthConfig({ ...authConfig, api_key_name: e.target.value })}
                placeholder="e.g., X-API-Key, api_key"
                aria-label="Header/Parameter Name"
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>
            <fieldset>
              <legend className="block text-sm font-medium text-ink mb-2">
                Send API Key In
              </legend>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="api-key-location"
                    checked={authConfig.api_key_location !== 'query'}
                    onChange={() => setAuthConfig({ ...authConfig, api_key_location: 'header' })}
                    className="text-bark"
                    aria-label="Send API key in header"
                  />
                  <span className="text-sm">Header</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="api-key-location"
                    checked={authConfig.api_key_location === 'query'}
                    onChange={() => setAuthConfig({ ...authConfig, api_key_location: 'query' })}
                    className="text-bark"
                    aria-label="Send API key as query parameter"
                  />
                  <span className="text-sm">Query Parameter</span>
                </label>
              </div>
            </fieldset>
          </div>
        );

      case 'basic':
        return (
          <div className="space-y-4">
            <div>
              <label htmlFor="basic-auth-username" className="block text-sm font-medium text-ink mb-1">
                Username <span className="text-semantic-error">*</span>
              </label>
              <input
                id="basic-auth-username"
                type="text"
                value={authConfig.username || ''}
                onChange={(e) => setAuthConfig({ ...authConfig, username: e.target.value })}
                placeholder="Enter username"
                aria-label="Username"
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label htmlFor="auth-password" className="block text-sm font-medium text-ink mb-1">
                Password <span className="text-semantic-error">*</span>
              </label>
              {renderSecretInput(
                'password',
                authConfig.password,
                (v) => setAuthConfig({ ...authConfig, password: v }),
                'Enter password',
                'Password',
                'auth-password'
              )}
            </div>
          </div>
        );

      case 'bearer':
        return (
          <div className="space-y-4">
            <div>
              <label htmlFor="auth-bearer-token" className="block text-sm font-medium text-ink mb-1">
                Bearer Token <span className="text-semantic-error">*</span>
              </label>
              {renderSecretInput(
                'bearer_token',
                authConfig.bearer_token,
                (v) => setAuthConfig({ ...authConfig, bearer_token: v }),
                'Enter bearer token',
                'Bearer Token',
                'auth-bearer-token'
              )}
              <p className="text-xs text-archive mt-1">
                Will be sent as: Authorization: Bearer {'<token>'}
              </p>
            </div>
          </div>
        );

      case 'oauth2_client':
        return (
          <div className="space-y-4">
            <div className="p-3 bg-semantic-info/10 rounded-lg mb-4">
              <div className="flex items-start gap-2">
                <HelpCircle size={16} className="text-semantic-info mt-0.5 flex-shrink-0" />
                <p className="text-sm text-semantic-info">
                  OAuth2 Client Credentials flow is used for server-to-server authentication.
                  The system will automatically request and refresh access tokens.
                </p>
              </div>
            </div>
            <div>
              <label htmlFor="oauth-token-url" className="block text-sm font-medium text-ink mb-1">
                Token URL <span className="text-semantic-error">*</span>
              </label>
              <input
                id="oauth-token-url"
                type="url"
                value={authConfig.token_url || ''}
                onChange={(e) => setAuthConfig({ ...authConfig, token_url: e.target.value })}
                placeholder="https://api.example.com/oauth/token"
                aria-label="Token URL"
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label htmlFor="oauth-client-id" className="block text-sm font-medium text-ink mb-1">
                Client ID <span className="text-semantic-error">*</span>
              </label>
              <input
                id="oauth-client-id"
                type="text"
                value={authConfig.client_id || ''}
                onChange={(e) => setAuthConfig({ ...authConfig, client_id: e.target.value })}
                placeholder="Enter client ID"
                aria-label="Client ID"
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label htmlFor="auth-client-secret" className="block text-sm font-medium text-ink mb-1">
                Client Secret <span className="text-semantic-error">*</span>
              </label>
              {renderSecretInput(
                'client_secret',
                authConfig.client_secret,
                (v) => setAuthConfig({ ...authConfig, client_secret: v }),
                'Enter client secret',
                'Client Secret',
                'auth-client-secret'
              )}
            </div>
            <div>
              <label htmlFor="oauth-scope" className="block text-sm font-medium text-ink mb-1">
                Scope <span className="text-archive">(optional)</span>
              </label>
              <input
                id="oauth-scope"
                type="text"
                value={authConfig.scope || ''}
                onChange={(e) => setAuthConfig({ ...authConfig, scope: e.target.value })}
                placeholder="e.g., read write"
                aria-label="Scope"
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>
          </div>
        );

      case 'custom_headers':
        return (
          <div className="space-y-4">
            <p className="text-sm text-archive">
              Add custom headers that will be sent with every request.
            </p>
            {(authConfig.custom_headers || []).map((header, idx) => (
              <div key={idx} className="flex gap-2 items-start">
                <div className="flex-1">
                  <input
                    type="text"
                    value={header.key}
                    onChange={(e) => updateCustomHeader(idx, 'key', e.target.value)}
                    placeholder="Header name"
                    aria-label={`Custom header ${idx + 1} name`}
                    className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 text-sm"
                  />
                </div>
                <div className="flex-1">
                  <input
                    type="text"
                    value={header.value}
                    onChange={(e) => updateCustomHeader(idx, 'value', e.target.value)}
                    placeholder="Header value"
                    aria-label={`Custom header ${idx + 1} value`}
                    className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 text-sm font-mono"
                  />
                </div>
                <button
                  onClick={() => removeCustomHeader(idx)}
                  aria-label={`Remove custom header ${idx + 1}`}
                  className="p-2 text-semantic-error hover:bg-semantic-error/10 rounded"
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </div>
            ))}
            <button
              onClick={addCustomHeader}
              className="flex items-center gap-2 px-3 py-2 text-sm text-bark hover:bg-bark/10 rounded-lg"
            >
              <Plus size={16} />
              Add Header
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="bg-parchment rounded-lg shadow-lg max-w-3xl w-full max-h-[90vh] flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-lichen">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ConnectorIcon connectorKey={definition.key} category={definition.category ?? undefined} size={32} className="text-archive" />
            <div>
              <h2 className="text-xl font-semibold text-ink">
                Connect to {definition.display_name}
              </h2>
              <p className="text-sm text-archive">Set up your API connection</p>
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
          <div className="space-y-6">
            <div>
              <label htmlFor="connection-name" className="block text-sm font-medium text-ink mb-1">
                Connection Name <span className="text-semantic-error">*</span>
              </label>
              <p className="text-xs text-archive mb-2">
                A friendly name to identify this connection
              </p>
              <input
                id="connection-name"
                type="text"
                value={connectorName}
                onChange={(e) => {
                  setConnectorName(e.target.value);
                  setConfigErrors((prev) => ({ ...prev, name: '' }));
                }}
                placeholder="My API Connection"
                aria-label="Connection Name"
                className={`w-full px-3 py-2 border rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 ${
                  configErrors.name ? 'border-semantic-error' : 'border-lichen'
                }`}
              />
              {configErrors.name && (
                <p className="text-sm text-semantic-error mt-1">{configErrors.name}</p>
              )}
            </div>

            <div>
              <label htmlFor="base-url" className="block text-sm font-medium text-ink mb-1">
                Base URL <span className="text-semantic-error">*</span>
              </label>
              <p className="text-xs text-archive mb-2">
                The base URL for the API (without trailing slash)
              </p>
              <input
                id="base-url"
                type="url"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setConfigErrors((prev) => ({ ...prev, baseUrl: '' }));
                }}
                placeholder="https://api.example.com/v1"
                aria-label="Base URL"
                className={`w-full px-3 py-2 border rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 ${
                  configErrors.baseUrl ? 'border-semantic-error' : 'border-lichen'
                }`}
              />
              {configErrors.baseUrl && (
                <p className="text-sm text-semantic-error mt-1">{configErrors.baseUrl}</p>
              )}
            </div>
          </div>
        )}

        {/* Auth Step */}
        {currentStep === 'auth' && (
          <div>
            <div className="mb-6">
              <h3 className="text-lg font-medium text-ink mb-2">
                Select Authentication Method
              </h3>
              <p className="text-sm text-archive">
                Choose how to authenticate with the API
              </p>
            </div>

            {/* Auth type selection */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              {AUTH_TYPES.map((type) => (
                <button
                  key={type.id}
                  onClick={() => setAuthConfig({ ...authConfig, type: type.id })}
                  className={`p-4 border rounded-lg text-left transition-all ${
                    authConfig.type === type.id
                      ? 'border-bark bg-bark/10 ring-2 ring-bark/30'
                      : 'border-lichen hover:border-stone hover:bg-stone'
                  }`}
                >
                  <div className="font-medium text-ink">{type.label}</div>
                  <div className="text-xs text-archive mt-1">{type.description}</div>
                </button>
              ))}
            </div>

            {/* Auth configuration form */}
            <div className="border-t border-lichen pt-6">
              <h4 className="text-sm font-medium text-ink mb-4">
                {AUTH_TYPES.find((t) => t.id === authConfig.type)?.label} Configuration
              </h4>
              {renderAuthForm()}
            </div>
          </div>
        )}

        {/* Test Step */}
        {currentStep === 'test' && (
          <div className="text-center py-8">
            {testing && (
              <div>
                <Loader2 size={48} className="mx-auto text-bark animate-spin mb-4" />
                <p className="text-lg text-ink">Testing API connection...</p>
                <p className="text-sm text-archive mt-2">
                  Verifying authentication and connectivity
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
                          Response time: {testResult.latency_ms}ms
                        </span>
                      )}
                    </div>
                    {testResult.message && testResult.message !== 'Connection successful' && (
                      <p className="text-sm text-archive mt-3">{testResult.message}</p>
                    )}
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
                    <div className="mt-6 flex justify-center gap-3">
                      <button
                        onClick={() => setCurrentStep('auth')}
                        className="px-4 py-2 text-bark hover:bg-bark/10 rounded-lg"
                      >
                        ← Edit Authentication
                      </button>
                      <button
                        onClick={handleTestConnection}
                        className="px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark"
                      >
                        Retry Test
                      </button>
                    </div>
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
          {currentStep === 'test' ? 'Create Connector' : 'Continue'}
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
