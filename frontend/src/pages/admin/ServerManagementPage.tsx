import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Server,
  Database,
  HardDrive,
  Cpu,
  Radio,
  CircleDot,
  Loader2,
  RefreshCw,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import ConfirmDialog from '../../components/ConfirmDialog';

interface ServiceStatus {
  status: string;
  details?: Record<string, any>;
}

interface FeatureFlags {
  opensearch: boolean;
  clip: boolean;
  whisper: boolean;
  ocr: boolean;
  semantic_search: boolean;
  tus: boolean;
  unoserver: boolean;
  agent: boolean;
}

interface ServerStatus {
  environment: {
    app_env: string;
    version: string;
    canonical_validation_mode: string;
  };
  feature_flags: FeatureFlags;
  services: Record<string, ServiceStatus>;
}

interface Organization {
  organization_id: string;
  name: string;
}

interface ActionResult {
  success: boolean;
  action: string;
  message: string;
  details?: Record<string, any>;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'healthy' || status === 'green' || status === 'configured'
      ? 'bg-semantic-success'
      : status === 'yellow'
        ? 'bg-semantic-warning'
        : status === 'disabled'
          ? 'bg-lichen'
          : status === 'no_workers'
            ? 'bg-semantic-warning'
            : 'bg-semantic-error';

  return (
    <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} />
  );
}

function ServiceCard({
  label,
  icon: Icon,
  service,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  service?: ServiceStatus;
}) {
  if (!service) return null;

  return (
    <div className="rounded-lg border border-lichen bg-parchment p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <Icon size={18} className="text-accessible-gray" />
          <span className="font-medium text-ink text-sm">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot status={service.status} />
          <span className="text-xs text-archive capitalize">{service.status}</span>
        </div>
      </div>
      {service.details && (
        <div className="space-y-1.5">
          {Object.entries(service.details).map(([key, value]) => {
            if (typeof value === 'object' && value !== null) {
              if (Array.isArray(value)) {
                return (
                  <div key={key} className="text-xs text-archive">
                    <span className="text-accessible-gray">{formatKey(key)}:</span>{' '}
                    {value.length > 0 ? value.join(', ') : 'none'}
                  </div>
                );
              }
              return (
                <div key={key} className="text-xs text-archive">
                  <span className="text-accessible-gray">{formatKey(key)}:</span>{' '}
                  {Object.entries(value).map(([k, v]) => (
                    <span key={k} className="inline-block mr-3">
                      {k}: <span className="text-ink">{JSON.stringify(v)}</span>
                    </span>
                  ))}
                </div>
              );
            }
            return (
              <div key={key} className="flex justify-between text-xs">
                <span className="text-archive">{formatKey(key)}</span>
                <span className="text-ink font-medium">{String(value)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ServerManagementPage() {
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [showCacheClearConfirm, setShowCacheClearConfirm] = useState(false);
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ['server-status'],
    queryFn: () => apiFetch<ServerStatus>('/admin/server-status'),
    refetchInterval: 30000,
  });

  const { data: orgsData } = useQuery({
    queryKey: ['platform-organizations'],
    queryFn: () =>
      apiFetch<{ organizations: Organization[] }>('/platform/organizations', {
        expectKeys: ['organizations'],
      }),
  });

  const actionMutation = useMutation({
    mutationFn: (body: { action: string; organization_id?: string; confirm?: boolean }) =>
      apiFetch<ActionResult>('/admin/server-actions', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (result) => setActionResult(result),
    onError: (error: Error) =>
      setActionResult({ success: false, action: '', message: error.message }),
  });

  const isProduction = status?.environment.app_env === 'production';
  const isStaging = status?.environment.app_env === 'staging';
  const organizations = orgsData?.organizations || [];

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
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="rounded-md bg-forest/10 p-2">
            <Server className="h-5 w-5 text-forest" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-ink">Server Management</h1>
              {status?.environment.app_env && !isProduction && (
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                    isStaging
                      ? 'bg-semantic-warning/10 text-semantic-warning'
                      : 'bg-semantic-info/10 text-semantic-info'
                  }`}
                >
                  {status.environment.app_env}
                </span>
              )}
            </div>
            <p className="text-sm text-archive">
              Version {status?.environment.version} · Validation mode:{' '}
              <span className="text-ink font-medium">
                {status?.environment.canonical_validation_mode}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Staging banner */}
      {isStaging && (
        <div className="mb-6 p-3 rounded-lg bg-semantic-warning/10 border border-semantic-warning/20 flex items-center gap-2">
          <AlertTriangle size={16} className="text-semantic-warning flex-shrink-0" />
          <span className="text-sm text-semantic-warning">
            Staging environment — strict canonical validation mode is{' '}
            <span className="font-medium">{status?.environment.canonical_validation_mode}</span>
          </span>
        </div>
      )}

      {/* Service Health Grid */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-ink mb-4">Service Health</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <ServiceCard label="Database" icon={Database} service={status?.services.database} />
          <ServiceCard label="Redis" icon={CircleDot} service={status?.services.redis} />
          <ServiceCard label="OpenSearch" icon={Radio} service={status?.services.opensearch} />
          <ServiceCard label="Celery Workers" icon={Cpu} service={status?.services.celery} />
          <ServiceCard label="Ollama" icon={Server} service={status?.services.ollama} />
          <ServiceCard label="Storage" icon={HardDrive} service={status?.services.storage} />
        </div>
      </section>

      {/* Feature Flags */}
      {status?.feature_flags && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-ink mb-4">Feature Flags</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(status.feature_flags).map(([key, enabled]) => (
              <span
                key={key}
                className={`text-xs px-3 py-1.5 rounded-full font-medium ${
                  enabled
                    ? 'bg-semantic-success/10 text-semantic-success'
                    : 'bg-lichen text-archive'
                }`}
              >
                {formatKey(key)}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Admin Actions */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-ink mb-4">Admin Actions</h2>

        {/* Action result banner */}
        {actionResult && (
          <div
            className={`mb-4 p-3 rounded-lg border text-sm ${
              actionResult.success
                ? 'bg-semantic-success/10 border-semantic-success/20 text-semantic-success'
                : 'bg-semantic-error/10 border-semantic-error/20 text-semantic-error'
            }`}
          >
            {actionResult.message}
            {actionResult.details && (
              <span className="ml-2 text-xs">
                ({Object.entries(actionResult.details)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')})
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Reindex Collections */}
          <div className="rounded-lg border border-lichen bg-parchment p-5">
            <h3 className="font-medium text-ink text-sm mb-3">Reindex Collections</h3>
            <p className="text-xs text-archive mb-3">
              Rebuild the OpenSearch collections index for an organization.
            </p>
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="w-full mb-3 px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 bg-parchment text-ink"
            >
              <option value="">Select organization...</option>
              {organizations.map((org) => (
                <option key={org.organization_id} value={org.organization_id}>
                  {org.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setActionResult(null);
                actionMutation.mutate({
                  action: 'reindex_collections',
                  organization_id: selectedOrgId,
                });
              }}
              disabled={!selectedOrgId || actionMutation.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Reindex Collections
            </button>
          </div>

          {/* Reindex Media */}
          <div className="rounded-lg border border-lichen bg-parchment p-5">
            <h3 className="font-medium text-ink text-sm mb-3">Reindex Media</h3>
            <p className="text-xs text-archive mb-3">
              Rebuild the OpenSearch media index for an organization.
            </p>
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="w-full mb-3 px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 bg-parchment text-ink"
            >
              <option value="">Select organization...</option>
              {organizations.map((org) => (
                <option key={org.organization_id} value={org.organization_id}>
                  {org.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setActionResult(null);
                actionMutation.mutate({
                  action: 'reindex_media',
                  organization_id: selectedOrgId,
                });
              }}
              disabled={!selectedOrgId || actionMutation.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Reindex Media
            </button>
          </div>

          {/* Clear Redis Cache */}
          <div className="rounded-lg border border-lichen bg-parchment p-5">
            <h3 className="font-medium text-ink text-sm mb-3">Clear Redis Cache</h3>
            <p className="text-xs text-archive mb-3">
              Flush the Redis cache. Active sessions and queued tasks are not affected.
            </p>
            {isProduction && (
              <div className="mb-3 p-2 rounded bg-semantic-warning/10 text-xs text-semantic-warning flex items-center gap-1.5">
                <AlertTriangle size={12} />
                Production — requires confirmation
              </div>
            )}
            <button
              onClick={() => {
                setActionResult(null);
                if (isProduction) {
                  setShowCacheClearConfirm(true);
                } else {
                  actionMutation.mutate({ action: 'clear_redis_cache' });
                }
              }}
              disabled={actionMutation.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm bg-semantic-error text-parchment rounded-lg hover:bg-semantic-error/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
              Clear Cache
            </button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        isOpen={showCacheClearConfirm}
        onClose={() => setShowCacheClearConfirm(false)}
        onConfirm={() =>
          actionMutation.mutate({ action: 'clear_redis_cache', confirm: true })
        }
        title="Clear Redis Cache"
        message="You are about to flush the Redis cache in production. This will invalidate all cached data including session caches. Are you sure?"
        confirmText="Clear Cache"
        confirmStyle="danger"
      />
    </div>
  );
}
