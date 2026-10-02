import { useCallback, useEffect, useState } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams } from 'react-router-dom';
import { Key, Plus, Copy, Check, Eye, EyeOff, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import ConfirmDialog from '../../components/ConfirmDialog';
import { formatDateShort } from '@/lib/formatters';
import { logger } from '@/lib/logger';

interface APIKeyRecord {
  api_key_id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  status: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}

const AVAILABLE_SCOPES = [
  { id: 'collections.view', label: 'Collections (read)', description: 'Search and view collection objects, featured items, and related data' },
  { id: 'media.view', label: 'Media (read)', description: 'Access published media files, derivatives, and IIIF manifests' },
  { id: 'exhibit.view', label: 'Exhibitions (read)', description: 'View exhibitions, venues, and floor plans' },
  { id: 'constituents.view', label: 'Contacts (read)', description: 'View person and organization records' },
  { id: 'loans.view', label: 'Loans (read)', description: 'View loan records' },
  { id: 'collections.edit', label: 'Collections (write)', description: 'Create and update collection objects' },
  { id: 'media.edit', label: 'Media (write)', description: 'Upload and update media files' },
  { id: 'data.view', label: 'Data pipeline (read)', description: 'Read pipeline datasets and entities' },
  { id: 'data.manage', label: 'Data pipeline (write)', description: 'Write pipeline datasets and entities' },
  { id: 'runs.view', label: 'Pipeline runs (read)', description: 'View pipeline run history' },
  { id: 'runs.execute', label: 'Pipeline runs (execute)', description: 'Trigger pipeline runs' },
];

const EXPIRATION_OPTIONS = [
  { value: '', label: 'Never expires' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year' },
];

export default function APIKeysPage() {
  const { orgId } = useParams<{ orgId: string }>();

  const [apiKeys, setApiKeys] = useState<APIKeyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(['collections.view', 'media.view']);
  const [expiresInDays, setExpiresInDays] = useState('');
  const [creating, setCreating] = useState(false);

  // Created key display
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showKey, setShowKey] = useState(false);

  // Revoke state
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ api_keys: APIKeyRecord[] }>(
        `/organizations/${orgId}/api-keys`
      );
      setApiKeys(data.api_keys);
    } catch (err: any) {
      logger.error('Failed to load API keys:', err);
      const status = err?.status || err?.response?.status;
      if (status === 403) {
        setError('You do not have permission to manage API keys');
      } else {
        setError(err?.message || 'Failed to load API keys');
      }
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreateKey = async () => {
    if (!orgId) return;
    setCreating(true);
    setError(null);
    try {
      const data = await apiFetch<{ data: { secret_api_key: string } }>(
        `/organizations/${orgId}/api-keys`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: newKeyName.trim(),
            scopes: newKeyScopes,
            expires_in_days: expiresInDays ? parseInt(expiresInDays, 10) : null,
          }),
        },
      );
      setCreatedKey(data.data.secret_api_key);
      setShowCreateForm(false);
      fetchKeys();
    } catch (err: any) {
      const detail = err?.body?.detail;
      setError(detail?.message || 'Failed to create API key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeKey = async (apiKeyId: string) => {
    if (!orgId) return;
    setRevokingId(apiKeyId);
    setError(null);
    try {
      await apiFetch(
        `/api-keys/${apiKeyId}?organization_id=${orgId}`,
        { method: 'DELETE' },
      );
      fetchKeys();
    } catch {
      setError('Failed to revoke API key');
    } finally {
      setRevokingId(null);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleCloseCreatedKey = () => {
    setCreatedKey(null);
    setNewKeyName('');
    setNewKeyScopes(['collections.view', 'media.view']);
    setExpiresInDays('');
  };

  const toggleScope = (scopeId: string) => {
    setNewKeyScopes(prev =>
      prev.includes(scopeId)
        ? prev.filter(s => s !== scopeId)
        : [...prev, scopeId]
    );
  };

  const activeKeys = apiKeys.filter(k => k.status === 'active');
  const revokedKeys = apiKeys.filter(k => k.status === 'revoked');

  return (
    <div className="max-w-4xl mx-auto py-8 px-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-bark/10 rounded-lg">
          <Key size={24} className="text-bark" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-ink">API Keys</h1>
          <p className="text-sm text-archive">
            Manage API access for third-party integrations and AI tools
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-sm text-semantic-error">
          {error}
        </div>
      )}

      {/* Created Key Display */}
      {createdKey && (
        <div className="mb-6 p-4 bg-semantic-success/10 border border-semantic-success/30 rounded-sm">
          <div className="flex items-center gap-2 mb-3">
            <Check size={18} className="text-semantic-success" />
            <span className="font-medium text-semantic-success">API Key Created</span>
          </div>
          <p className="text-sm text-semantic-success mb-3">
            Copy your API key now. You won't be able to see it again.
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 p-2 bg-parchment border border-semantic-success/30 rounded-lg">
              <code className="flex-1 text-sm font-mono break-all">
                {showKey ? createdKey : '\u2022'.repeat(32)}
              </code>
              <button
                onClick={() => setShowKey(!showKey)}
                className="p-1 text-archive hover:text-ink"
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button
              onClick={() => copyToClipboard(createdKey)}
              className="p-2 bg-bark text-parchment rounded-sm hover:bg-bark/90"
            >
              {copiedKey ? <Check size={18} /> : <Copy size={18} />}
            </button>
          </div>
          <button
            onClick={handleCloseCreatedKey}
            className="mt-3 text-sm text-semantic-success hover:underline"
          >
            I've copied my key
          </button>
        </div>
      )}

      {/* Create Key Form */}
      {showCreateForm && !createdKey && (
        <div className="mb-6 p-5 border border-lichen rounded-sm space-y-4 bg-parchment">
          <h2 className="font-medium text-ink text-lg">Create New API Key</h2>

          <div>
            <label htmlFor="api-key-name" className="block text-sm font-medium text-ink mb-1">
              Key Name
            </label>
            <input
              id="api-key-name"
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g., Website Integration, Claude Desktop"
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>

          <div>
            <label htmlFor="api-key-expiry" className="block text-sm font-medium text-ink mb-1">
              Expiration
            </label>
            <select
              id="api-key-expiry"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              {EXPIRATION_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              Permissions
            </label>
            <div className="space-y-2">
              {AVAILABLE_SCOPES.map((scope) => (
                <label
                  key={scope.id}
                  className="flex items-start gap-3 p-3 bg-stone/30 rounded-sm cursor-pointer hover:bg-stone/50"
                >
                  <Checkbox
                    checked={newKeyScopes.includes(scope.id)}
                    onChange={() => toggleScope(scope.id)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-ink">{scope.label}</p>
                    <p className="text-xs text-archive">{scope.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 border border-stone rounded-sm bg-parchment text-ink hover:bg-stone/20 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateKey}
              disabled={!newKeyName.trim() || newKeyScopes.length === 0 || creating}
              className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {creating && <Loader2 size={16} className="animate-spin" />}
              Create Key
            </button>
          </div>
        </div>
      )}

      {/* Keys List */}
      {!showCreateForm && !createdKey && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-ink">
              {activeKeys.length} active key{activeKeys.length !== 1 ? 's' : ''}
            </h2>
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-3 py-1.5 bg-bark text-parchment rounded-sm text-sm flex items-center gap-1 hover:bg-bark/90"
            >
              <Plus size={16} />
              Create Key
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-archive" />
            </div>
          ) : activeKeys.length === 0 && revokedKeys.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-lichen rounded-sm">
              <Key size={40} className="mx-auto text-lichen mb-3" />
              <p className="text-ink mb-4">No API keys yet.</p>
              <button
                onClick={() => setShowCreateForm(true)}
                className="px-4 py-2 bg-bark text-parchment rounded-sm text-sm hover:bg-bark/90"
              >
                Create your first key
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {activeKeys.map((key) => (
                <div
                  key={key.api_key_id}
                  className="p-4 border border-lichen rounded-sm bg-parchment"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-ink">{key.name}</p>
                      <code className="text-sm text-archive">{key.key_prefix}...****</code>
                    </div>
                    <button
                      onClick={() => setRevokeConfirmId(key.api_key_id)}
                      disabled={revokingId === key.api_key_id}
                      className="p-2 text-archive hover:text-semantic-error hover:bg-stone/30 rounded disabled:opacity-50"
                      title="Revoke key"
                    >
                      {revokingId === key.api_key_id
                        ? <Loader2 size={16} className="animate-spin" />
                        : <Trash2 size={16} />}
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-xs text-archive">
                    <span>Created: {formatDateShort(key.created_at)}</span>
                    {key.expires_at && (
                      <span>Expires: {formatDateShort(key.expires_at)}</span>
                    )}
                    <span>
                      Last used: {key.last_used_at
                        ? formatDateShort(key.last_used_at)
                        : 'Never'}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {key.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="px-2 py-0.5 bg-stone/30 text-ink text-xs rounded"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                </div>
              ))}

              {revokedKeys.length > 0 && (
                <details className="mt-4">
                  <summary className="text-sm text-archive cursor-pointer hover:text-ink">
                    {revokedKeys.length} revoked key{revokedKeys.length !== 1 ? 's' : ''}
                  </summary>
                  <div className="mt-2 space-y-2">
                    {revokedKeys.map((key) => (
                      <div
                        key={key.api_key_id}
                        className="p-3 border border-lichen/50 rounded-sm opacity-60"
                      >
                        <p className="text-sm text-ink line-through">{key.name}</p>
                        <code className="text-xs text-archive">{key.key_prefix}...****</code>
                        <span className="ml-2 text-xs text-semantic-error">Revoked</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </>
      )}

      {/* Usage hint */}
      <div className="mt-8 p-4 bg-bark/10 border border-bark/20 rounded-sm">
        <div className="flex items-start gap-2">
          <AlertCircle size={18} className="text-bark mt-0.5" />
          <div>
            <p className="text-sm font-medium text-ink">Using API Keys</p>
            <p className="text-sm text-archive mt-1">
              Keys with <strong>Collections</strong> and <strong>Media</strong> permissions work with
              the public REST API and MCP (Model Context Protocol) for AI tools like Claude Desktop.
            </p>
            <p className="text-sm text-archive mt-1">
              Pass your key via the <code className="px-1 py-0.5 bg-stone/40 rounded text-xs">X-API-Key</code> header.
              For MCP, connect to <code className="px-1 py-0.5 bg-stone/40 rounded text-xs">/mcp</code> with the same header.
            </p>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!revokeConfirmId}
        onClose={() => setRevokeConfirmId(null)}
        onConfirm={() => {
          if (revokeConfirmId) handleRevokeKey(revokeConfirmId);
          setRevokeConfirmId(null);
        }}
        title="Revoke API Key?"
        message="This key will stop working immediately. This action cannot be undone."
        confirmText="Revoke"
        confirmStyle="danger"
      />
    </div>
  );
}
