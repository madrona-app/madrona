import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HardDrive,
  Cloud,
  Server,
  Check,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useOrganization } from '../../contexts/useOrganization';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateShort } from '@/lib/formatters';

type StorageProvider = 'managed' | 's3' | 's3_compatible' | 'azure' | 'gcs';

interface StorageConfig {
  provider: StorageProvider;
  is_verified: boolean;
  verified_at: string | null;
  verification_error: string | null;
  cdn_domain: string | null;
  has_cdn_signing_key: boolean;
  storage_region?: string;
  bucket?: string;
  region?: string;
  endpoint_url?: string;
  container?: string;
  account_name?: string;
  created_at: string | null;
  updated_at: string | null;
}

interface TestResult {
  success: boolean;
  error?: string;
  message?: string;
}

const PROVIDER_INFO = {
  managed: {
    name: 'Madrona Managed Storage',
    description: 'Storage managed by Madrona. Simple, reliable, and secure.',
    icon: Cloud,
  },
  s3: {
    name: 'AWS S3',
    description: 'Use your own Amazon S3 bucket for full control over storage.',
    icon: Cloud,
  },
  s3_compatible: {
    name: 'S3-Compatible',
    description: 'Self-hosted or any S3-compatible storage service.',
    icon: Server,
  },
  azure: {
    name: 'Azure Blob Storage',
    description: 'Microsoft Azure Blob Storage for enterprise organizations.',
    icon: Cloud,
  },
  gcs: {
    name: 'Google Cloud Storage',
    description: 'Google Cloud Storage for GCP-based infrastructure.',
    icon: Cloud,
  },
};

export default function StorageConfigPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const queryClient = useQueryClient();

  const [selectedProvider, setSelectedProvider] = useState<StorageProvider>('managed');
  const [formData, setFormData] = useState({
    // S3 / S3-compatible
    bucket: '',
    region: 'us-west-2',
    access_key_id: '',
    secret_access_key: '',
    endpoint_url: '',
    // Azure
    container: '',
    account_name: '',
    account_key: '',
    connection_string: '',
    // GCS
    gcs_bucket: '',
    project_id: '',
    credentials_json: '',
  });
  const [showSecrets, setShowSecrets] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Fetch current config
  const { data: config, isLoading } = useQuery({
    queryKey: ['storage-config', organizationId],
    queryFn: async () => {
      const response = await apiFetch<StorageConfig>(
        `/organizations/${organizationId}/storage-config`
      );
      return response;
    },
    enabled: !!organizationId,
  });

  // Update form when config loads
  useEffect(() => {
    if (config) {
      setSelectedProvider(config.provider);
      if (config.bucket) {
        setFormData((prev) => ({
          ...prev,
          bucket: config.bucket || '',
          region: config.region || 'us-west-2',
          endpoint_url: config.endpoint_url || '',
        }));
      }
    }
  }, [config]);

  // Save configuration
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        provider: selectedProvider,
      };

      if (selectedProvider === 's3' || selectedProvider === 's3_compatible') {
        payload.bucket = formData.bucket;
        payload.region = formData.region;
        payload.access_key_id = formData.access_key_id;
        payload.secret_access_key = formData.secret_access_key;
        if (selectedProvider === 's3_compatible') {
          payload.endpoint_url = formData.endpoint_url;
        }
      } else if (selectedProvider === 'azure') {
        payload.container = formData.container;
        payload.account_name = formData.account_name;
        payload.account_key = formData.account_key;
        if (formData.connection_string) {
          payload.connection_string = formData.connection_string;
        }
      } else if (selectedProvider === 'gcs') {
        payload.bucket = formData.gcs_bucket;
        payload.project_id = formData.project_id;
        if (formData.credentials_json) {
          try {
            payload.credentials = JSON.parse(formData.credentials_json);
          } catch {
            throw new Error('Invalid JSON in service account credentials');
          }
        }
      }

      await apiFetch(`/organizations/${organizationId}/storage-config`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-config', organizationId] });
      setTestResult({ success: true, message: 'Configuration saved and verified' });
    },
    onError: (error: Error) => {
      setTestResult({ success: false, error: error.message });
    },
  });

  // Test connection
  const testMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        provider: selectedProvider,
      };

      if (selectedProvider === 's3' || selectedProvider === 's3_compatible') {
        payload.bucket = formData.bucket;
        payload.region = formData.region;
        payload.access_key_id = formData.access_key_id;
        payload.secret_access_key = formData.secret_access_key;
        if (selectedProvider === 's3_compatible') {
          payload.endpoint_url = formData.endpoint_url;
        }
      } else if (selectedProvider === 'azure') {
        payload.container = formData.container;
        payload.account_name = formData.account_name;
        payload.account_key = formData.account_key;
        if (formData.connection_string) {
          payload.connection_string = formData.connection_string;
        }
      } else if (selectedProvider === 'gcs') {
        payload.bucket = formData.gcs_bucket;
        payload.project_id = formData.project_id;
        if (formData.credentials_json) {
          try {
            payload.credentials = JSON.parse(formData.credentials_json);
          } catch {
            throw new Error('Invalid JSON in service account credentials');
          }
        }
      }

      const response = await apiFetch<TestResult>(
        `/organizations/${organizationId}/storage-config/test`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );
      return response;
    },
    onSuccess: (result) => {
      setTestResult(result);
    },
    onError: (error: Error) => {
      setTestResult({ success: false, error: error.message });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTestResult(null);
    saveMutation.mutate();
  };

  const handleTest = () => {
    setTestResult(null);
    testMutation.mutate();
  };

  const isAnyLoading = isLoading || saveMutation.isPending || testMutation.isPending;
  const hasRequiredFields =
    selectedProvider === 'managed' ||
    (selectedProvider === 's3' &&
      formData.bucket &&
      formData.access_key_id &&
      formData.secret_access_key) ||
    (selectedProvider === 's3_compatible' &&
      formData.bucket &&
      formData.endpoint_url &&
      formData.access_key_id &&
      formData.secret_access_key) ||
    (selectedProvider === 'azure' &&
      formData.container &&
      formData.account_name &&
      (formData.account_key || formData.connection_string)) ||
    (selectedProvider === 'gcs' &&
      formData.gcs_bucket &&
      formData.credentials_json);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <MadronaLoader />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <HardDrive className="w-8 h-8 text-forest" />
          <h1 className="text-2xl font-semibold text-ink">Storage Configuration</h1>
        </div>
        <p className="text-ink/70">
          Configure where your organization's media files are stored. Use Madrona's managed
          storage or bring your own bucket (BYOB).
        </p>
      </div>

      {/* Current Status */}
      {config && (
        <div className="mb-8 p-4 bg-parchment rounded-lg border border-lichen">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {config.is_verified ? (
                <div className="flex items-center gap-2 text-semantic-success">
                  <Check className="w-5 h-5" />
                  <span className="font-medium">Connected</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-semantic-warning">
                  <AlertCircle className="w-5 h-5" />
                  <span className="font-medium">Not verified</span>
                </div>
              )}
              <span className="text-ink/50">|</span>
              <span className="text-ink/70">
                Provider: <span className="font-medium">{PROVIDER_INFO[config.provider].name}</span>
              </span>
            </div>
            {config.verified_at && (
              <span className="text-sm text-ink/50">
                Last verified: {formatDateShort(config.verified_at)}
              </span>
            )}
          </div>
          {config.bucket && (
            <div className="mt-2 text-sm text-ink/60">
              Bucket: <code className="bg-stone px-1 rounded">{config.bucket}</code>
              {config.region && (
                <>
                  {' '}
                  in <code className="bg-stone px-1 rounded">{config.region}</code>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Provider Selection */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-ink mb-4">Select Storage Provider</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(['managed', 's3', 's3_compatible', 'azure', 'gcs'] as StorageProvider[]).map((provider) => {
            const info = PROVIDER_INFO[provider];
            const Icon = info.icon;
            const isSelected = selectedProvider === provider;

            return (
              <button
                key={provider}
                type="button"
                onClick={() => setSelectedProvider(provider)}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  isSelected
                    ? 'border-bark bg-bark/5'
                    : 'border-lichen hover:border-stone hover:bg-stone/30'
                }`}
              >
                <div className="flex items-start gap-3">
                  <Icon
                    className={`w-6 h-6 mt-0.5 ${isSelected ? 'text-bark' : 'text-ink/40'}`}
                  />
                  <div className="flex-1">
                    <div
                      className={`font-medium ${isSelected ? 'text-bark' : 'text-ink'}`}
                    >
                      {info.name}
                    </div>
                    <div className="text-sm text-ink/60 mt-1">{info.description}</div>
                  </div>
                  {isSelected && <Check className="w-5 h-5 text-bark" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Configuration Form */}
      {selectedProvider !== 'managed' && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-parchment rounded-lg border border-lichen p-6">
            <h3 className="text-lg font-medium text-ink mb-4">
              {PROVIDER_INFO[selectedProvider].name} Configuration
            </h3>

            {(selectedProvider === 's3' || selectedProvider === 's3_compatible') && (
              <div className="space-y-4">
                {/* Endpoint URL (S3-compatible only) */}
                {selectedProvider === 's3_compatible' && (
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      Endpoint URL <span className="text-semantic-error">*</span>
                    </label>
                    <input
                      type="url"
                      value={formData.endpoint_url}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, endpoint_url: e.target.value }))
                      }
                      placeholder="https://s3.example.com"
                      className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      required
                    />
                    <p className="text-xs text-ink/50 mt-1">
                      The URL of your S3-compatible server
                    </p>
                  </div>
                )}

                {/* Bucket Name */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Bucket Name <span className="text-semantic-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.bucket}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, bucket: e.target.value }))
                    }
                    placeholder="my-media-bucket"
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    required
                  />
                </div>

                {/* Region */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Region</label>
                  <select
                    value={formData.region}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, region: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                  >
                    <option value="us-west-2">US West (Oregon)</option>
                    <option value="us-east-1">US East (N. Virginia)</option>
                    <option value="us-east-2">US East (Ohio)</option>
                    <option value="ca-central-1">Canada (Central)</option>
                    <option value="eu-west-1">Europe (Ireland)</option>
                    <option value="eu-west-2">Europe (London)</option>
                    <option value="eu-central-1">Europe (Frankfurt)</option>
                    <option value="ap-southeast-1">Asia Pacific (Singapore)</option>
                    <option value="ap-southeast-2">Asia Pacific (Sydney)</option>
                    <option value="ap-northeast-1">Asia Pacific (Tokyo)</option>
                  </select>
                </div>

                {/* Access Key */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Access Key ID <span className="text-semantic-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.access_key_id}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, access_key_id: e.target.value }))
                    }
                    placeholder="AKIA..."
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark font-mono text-sm"
                    required
                  />
                </div>

                {/* Secret Key */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Secret Access Key <span className="text-semantic-error">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showSecrets ? 'text' : 'password'}
                      value={formData.secret_access_key}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          secret_access_key: e.target.value,
                        }))
                      }
                      placeholder="Your secret access key"
                      className="w-full px-3 py-2 pr-10 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark font-mono text-sm"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecrets(!showSecrets)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink"
                    >
                      {showSecrets ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-ink/50 mt-1">
                    Credentials are encrypted before storage
                  </p>
                </div>
              </div>
            )}

            {/* Azure Configuration */}
            {selectedProvider === 'azure' && (
              <div className="space-y-4">
                {/* Container Name */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Container Name <span className="text-semantic-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.container}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, container: e.target.value }))
                    }
                    placeholder="my-media-container"
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    required
                  />
                </div>

                {/* Account Name */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Storage Account Name <span className="text-semantic-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.account_name}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, account_name: e.target.value }))
                    }
                    placeholder="mystorageaccount"
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    required
                  />
                </div>

                {/* Account Key */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Account Key <span className="text-semantic-error">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showSecrets ? 'text' : 'password'}
                      value={formData.account_key}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, account_key: e.target.value }))
                      }
                      placeholder="Your storage account key"
                      className="w-full px-3 py-2 pr-10 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark font-mono text-sm"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecrets(!showSecrets)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink"
                    >
                      {showSecrets ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-ink/50 mt-1">
                    Find this in Azure Portal → Storage Account → Access Keys
                  </p>
                </div>

                {/* Connection String (optional) */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Connection String <span className="text-ink/50">(alternative)</span>
                  </label>
                  <input
                    type={showSecrets ? 'text' : 'password'}
                    value={formData.connection_string}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, connection_string: e.target.value }))
                    }
                    placeholder="DefaultEndpointsProtocol=https;AccountName=..."
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark font-mono text-sm"
                  />
                  <p className="text-xs text-ink/50 mt-1">
                    Alternatively, paste the full connection string
                  </p>
                </div>
              </div>
            )}

            {/* GCS Configuration */}
            {selectedProvider === 'gcs' && (
              <div className="space-y-4">
                {/* Bucket Name */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Bucket Name <span className="text-semantic-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.gcs_bucket}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, gcs_bucket: e.target.value }))
                    }
                    placeholder="my-media-bucket"
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    required
                  />
                </div>

                {/* Project ID */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Project ID
                  </label>
                  <input
                    type="text"
                    value={formData.project_id}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, project_id: e.target.value }))
                    }
                    placeholder="my-gcp-project"
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                  />
                  <p className="text-xs text-ink/50 mt-1">
                    Your Google Cloud project ID (optional if in service account)
                  </p>
                </div>

                {/* Service Account JSON */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Service Account Credentials <span className="text-semantic-error">*</span>
                  </label>
                  <textarea
                    value={formData.credentials_json}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, credentials_json: e.target.value }))
                    }
                    placeholder='{"type": "service_account", "project_id": "...", ...}'
                    rows={6}
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark font-mono text-xs"
                    required
                  />
                  <p className="text-xs text-ink/50 mt-1">
                    Paste the full JSON from your service account key file
                  </p>
                </div>
              </div>
            )}

            {/* IAM Policy Info */}
            {selectedProvider === 's3' && (
              <div className="mt-6 p-4 bg-stone/50 rounded-lg">
                <h4 className="font-medium text-ink text-sm mb-2">Required IAM Permissions</h4>
                <p className="text-xs text-ink/60 mb-2">
                  The IAM user needs the following permissions on your bucket:
                </p>
                <code className="block text-xs bg-ink text-parchment p-3 rounded overflow-x-auto whitespace-pre">
                  {`{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket"
    ],
    "Resource": [
      "arn:aws:s3:::YOUR-BUCKET",
      "arn:aws:s3:::YOUR-BUCKET/*"
    ]
  }]
}`}
                </code>
                <a
                  href="https://docs.madrona.io/byob"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-bark hover:text-copper-dark mt-2"
                >
                  View full documentation <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            {/* Azure Permissions Info */}
            {selectedProvider === 'azure' && (
              <div className="mt-6 p-4 bg-stone/50 rounded-lg">
                <h4 className="font-medium text-ink text-sm mb-2">Required Permissions</h4>
                <p className="text-xs text-ink/60 mb-2">
                  The storage account key provides full access. For production, consider using
                  a SAS token with limited permissions:
                </p>
                <ul className="text-xs text-ink/60 list-disc list-inside space-y-1">
                  <li>Read, Write, Delete on Blob objects</li>
                  <li>List on Container</li>
                </ul>
                <a
                  href="https://docs.madrona.io/byob/azure"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-bark hover:text-copper-dark mt-2"
                >
                  View full documentation <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            {/* GCS Permissions Info */}
            {selectedProvider === 'gcs' && (
              <div className="mt-6 p-4 bg-stone/50 rounded-lg">
                <h4 className="font-medium text-ink text-sm mb-2">Required IAM Permissions</h4>
                <p className="text-xs text-ink/60 mb-2">
                  The service account needs the following roles on your bucket:
                </p>
                <ul className="text-xs text-ink/60 list-disc list-inside space-y-1">
                  <li>Storage Object Admin (roles/storage.objectAdmin)</li>
                  <li>Or custom role with: storage.objects.create, .get, .delete, .list</li>
                </ul>
                <a
                  href="https://docs.madrona.io/byob/gcs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-bark hover:text-copper-dark mt-2"
                >
                  View full documentation <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>

          {/* Test Result */}
          {testResult && (
            <div
              className={`p-4 rounded-lg border ${
                testResult.success
                  ? 'bg-semantic-success/10 border-semantic-success/30 text-semantic-success'
                  : 'bg-semantic-error/10 border-semantic-error/30 text-semantic-error'
              }`}
            >
              <div className="flex items-center gap-2">
                {testResult.success ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <AlertCircle className="w-5 h-5" />
                )}
                <span className="font-medium">
                  {testResult.success ? 'Connection Successful' : 'Connection Failed'}
                </span>
              </div>
              {testResult.error && (
                <p className="mt-2 text-sm">{testResult.error}</p>
              )}
              {testResult.message && (
                <p className="mt-2 text-sm">{testResult.message}</p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleTest}
              disabled={!hasRequiredFields || isAnyLoading}
              className="flex items-center gap-2 px-4 py-2 text-ink/70 hover:text-ink border border-lichen rounded-lg hover:bg-stone/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Test Connection
            </button>

            <button
              type="submit"
              disabled={!hasRequiredFields || isAnyLoading}
              className="flex items-center gap-2 px-6 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Configuration
            </button>
          </div>
        </form>
      )}

      {/* Managed Storage Info */}
      {selectedProvider === 'managed' && (
        <div className="bg-parchment rounded-lg border border-lichen p-6">
          <h3 className="text-lg font-medium text-ink mb-4">Managed Storage</h3>
          <p className="text-ink/70 mb-4">
            Your organization is using Madrona's managed storage. Files are stored securely in
            AWS S3 with automatic backups, lifecycle management, and CDN delivery.
          </p>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="p-3 bg-stone/30 rounded-lg">
              <div className="text-ink/50">Region</div>
              <div className="font-medium text-ink">
                {config?.storage_region || 'us-west-2'}
              </div>
            </div>
            <div className="p-3 bg-stone/30 rounded-lg">
              <div className="text-ink/50">CDN</div>
              <div className="font-medium text-ink">CloudFront (Global)</div>
            </div>
          </div>

          {config?.provider !== 'managed' && (
            <button
              onClick={() => {
                saveMutation.mutate();
              }}
              disabled={isAnyLoading}
              className="mt-4 flex items-center gap-2 px-6 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark transition-colors disabled:opacity-50"
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Switch to Managed Storage
            </button>
          )}
        </div>
      )}
    </div>
  );
}
