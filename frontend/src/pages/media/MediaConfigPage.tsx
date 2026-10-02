import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Settings,
  Search,
  Tag,
  Droplets,
  Link2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  Activity,
  HardDrive,
  Database,
  Clock,
  Info,
  Sparkles,
  Shield,
} from 'lucide-react';
import { reindexMedia, getStorageAnalytics, type StorageAnalytics } from '../../lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { useOrganization } from '../../contexts/useOrganization';
import { formatNumber } from '@/lib/formatters';

interface ReindexResult {
  success: boolean;
  indexed: number;
  total: number;
  message: string;
}

// Human-readable storage class names
const STORAGE_CLASS_LABELS: Record<string, string> = {
  STANDARD: 'Standard',
  INTELLIGENT_TIERING: 'Intelligent-Tiering',
  GLACIER_IR: 'Glacier Instant Retrieval',
  GLACIER: 'Glacier Flexible Retrieval',
  DEEP_ARCHIVE: 'Glacier Deep Archive',
};

// Colors for storage tiers in the bar chart
const TIER_COLORS: Record<string, string> = {
  STANDARD: 'bg-semantic-info',
  INTELLIGENT_TIERING: 'bg-semantic-success',
  GLACIER_IR: 'bg-bark',
  GLACIER: 'bg-forest',
  DEEP_ARCHIVE: 'bg-archive',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Storage & Lifecycle Section Component
 */
function StorageLifecycleSection({ organizationId }: { organizationId: string }) {
  const { data: analytics, isLoading, error, refetch } = useQuery<StorageAnalytics>({
    queryKey: ['storage-analytics', organizationId],
    queryFn: () => getStorageAnalytics(organizationId),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  if (isLoading) {
    return (
      <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center gap-2">
            <HardDrive size={18} className="text-forest" />
            <h2 className="text-lg font-semibold text-ink">Storage & Lifecycle</h2>
          </div>
        </div>
        <div className="px-6 py-8 flex items-center justify-center">
          <MadronaLoader variant="dots" label="Loading storage analytics..." />
        </div>
      </section>
    );
  }

  if (error || analytics?.error) {
    return (
      <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center gap-2">
            <HardDrive size={18} className="text-forest" />
            <h2 className="text-lg font-semibold text-ink">Storage & Lifecycle</h2>
          </div>
        </div>
        <div className="px-6 py-5">
          <div className="flex items-start gap-2 p-3 bg-semantic-warning/10 border border-semantic-warning/30 rounded-md">
            <AlertCircle size={16} className="text-semantic-warning mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-semantic-warning">Unable to load storage analytics</p>
              <p className="text-sm text-semantic-warning mt-0.5">
                {analytics?.error || 'Storage analytics are not available at this time.'}
              </p>
              <button
                onClick={() => refetch()}
                className="mt-2 text-sm text-semantic-warning hover:text-semantic-warning underline"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!analytics) return null;

  const originalsCategory = analytics.categories.find(c => c.category === 'originals');
  const derivativesCategory = analytics.categories.find(c => c.category === 'derivatives');

  // Calculate total for bar chart proportions
  const maxCategoryBytes = Math.max(
    originalsCategory?.total_bytes || 0,
    derivativesCategory?.total_bytes || 0
  );

  return (
    <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
      <div className="px-6 py-4 border-b border-lichen">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <HardDrive size={18} className="text-forest" />
              <h2 className="text-lg font-semibold text-ink">Storage & Lifecycle</h2>
            </div>
            <p className="text-sm text-archive mt-1">
              Storage usage breakdown and automatic lifecycle policy status.
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="p-2 text-accessible-gray hover:text-forest hover:bg-forest/5 rounded-md transition-colors"
            title="Refresh analytics"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="px-6 py-5 space-y-6">
        {/* Overview Cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-stone rounded-lg">
            <div className="flex items-center gap-2 text-accessible-gray mb-1">
              <Database size={14} />
              <span className="text-xs font-medium uppercase tracking-wide">Total Storage</span>
            </div>
            <p className="text-xl font-semibold text-ink">{analytics.total_gb.toFixed(2)} GB</p>
          </div>
          <div className="p-4 bg-stone rounded-lg">
            <div className="flex items-center gap-2 text-accessible-gray mb-1">
              <HardDrive size={14} />
              <span className="text-xs font-medium uppercase tracking-wide">Files</span>
            </div>
            <p className="text-xl font-semibold text-ink">{formatNumber(analytics.object_count)}</p>
          </div>
          <div className="p-4 bg-stone rounded-lg">
            <div className="flex items-center gap-2 text-accessible-gray mb-1">
              <Clock size={14} />
              <span className="text-xs font-medium uppercase tracking-wide">Active Rules</span>
            </div>
            <p className="text-xl font-semibold text-ink">
              {analytics.lifecycle_rules.filter(r => r.status === 'Enabled').length}
            </p>
          </div>
        </div>

        {/* Storage Breakdown by Category */}
        <div>
          <h3 className="text-sm font-semibold text-ink mb-3">Storage by Category</h3>
          <div className="space-y-4">
            {/* Originals */}
            {originalsCategory && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-ink">
                    Originals (Archival Masters)
                  </span>
                  <span className="text-sm text-accessible-gray">
                    {formatBytes(originalsCategory.total_bytes)} ({formatNumber(originalsCategory.object_count)} files)
                  </span>
                </div>
                <div className="h-4 bg-lichen rounded-full overflow-hidden flex">
                  {originalsCategory.tiers.map((tier, idx) => {
                    const widthPercent = maxCategoryBytes > 0
                      ? (tier.total_bytes / maxCategoryBytes) * 100
                      : 0;
                    return (
                      <div
                        key={tier.storage_class}
                        className={`${TIER_COLORS[tier.storage_class] || 'bg-archive'} ${idx > 0 ? '' : ''}`}
                        style={{ width: `${widthPercent}%` }}
                        title={`${STORAGE_CLASS_LABELS[tier.storage_class] || tier.storage_class}: ${formatBytes(tier.total_bytes)}`}
                      />
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-3 mt-2">
                  {originalsCategory.tiers.map(tier => (
                    <div key={tier.storage_class} className="flex items-center gap-1.5 text-xs text-accessible-gray">
                      <div className={`w-2.5 h-2.5 rounded-full ${TIER_COLORS[tier.storage_class] || 'bg-archive'}`} />
                      <span>{STORAGE_CLASS_LABELS[tier.storage_class] || tier.storage_class}:</span>
                      <span className="font-medium">{formatBytes(tier.total_bytes)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Derivatives */}
            {derivativesCategory && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-ink">
                    Derivatives (Web Copies)
                  </span>
                  <span className="text-sm text-accessible-gray">
                    {formatBytes(derivativesCategory.total_bytes)} ({formatNumber(derivativesCategory.object_count)} files)
                  </span>
                </div>
                <div className="h-4 bg-lichen rounded-full overflow-hidden flex">
                  {derivativesCategory.tiers.map((tier, idx) => {
                    const widthPercent = maxCategoryBytes > 0
                      ? (tier.total_bytes / maxCategoryBytes) * 100
                      : 0;
                    return (
                      <div
                        key={tier.storage_class}
                        className={`${TIER_COLORS[tier.storage_class] || 'bg-archive'} ${idx > 0 ? '' : ''}`}
                        style={{ width: `${widthPercent}%` }}
                        title={`${STORAGE_CLASS_LABELS[tier.storage_class] || tier.storage_class}: ${formatBytes(tier.total_bytes)}`}
                      />
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-3 mt-2">
                  {derivativesCategory.tiers.map(tier => (
                    <div key={tier.storage_class} className="flex items-center gap-1.5 text-xs text-accessible-gray">
                      <div className={`w-2.5 h-2.5 rounded-full ${TIER_COLORS[tier.storage_class] || 'bg-archive'}`} />
                      <span>{STORAGE_CLASS_LABELS[tier.storage_class] || tier.storage_class}:</span>
                      <span className="font-medium">{formatBytes(tier.total_bytes)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Info Note */}
        <div className="flex items-start gap-2 p-3 bg-semantic-info/10 border border-semantic-info/20 rounded-md">
          <Info size={16} className="text-semantic-info mt-0.5 flex-shrink-0" />
          <div className="text-sm text-semantic-info">
            <p className="font-medium">About Storage</p>
            <p className="mt-1 text-semantic-info">
              Original files automatically transition to Glacier Instant Retrieval after 30 days,
              reducing storage costs while maintaining fast access. Derivatives move to Intelligent-Tiering
              which automatically optimizes costs based on access patterns. All file versions are
              retained indefinitely.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Media Configuration Page
 *
 * A single-page settings surface for system-level Media configuration.
 * This is NOT a navigable sub-application - users exit via the main Media sidebar.
 *
 * Pattern: GitHub Repository Settings, Notion Workspace Settings
 */
export default function MediaConfigPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;

  const { hasPermission } = usePermissions();
  const canAdmin = hasPermission('media.admin');
  const [lastReindexResult, setLastReindexResult] = useState<ReindexResult | null>(null);

  const reindexMutation = useMutation({
    mutationFn: () => {
      if (!organizationId) throw new Error('No organization selected');
      return reindexMedia(organizationId);
    },
    onSuccess: (result) => {
      setLastReindexResult(result);
    },
  });

  const handleReindex = () => {
    setLastReindexResult(null);
    reindexMutation.mutate();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-forest/10 rounded-lg">
            <Settings size={24} className="text-forest" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-ink">Media Configuration</h1>
            <p className="text-sm text-archive">
              Manage system-level Media configuration
            </p>
          </div>
        </div>
      </div>

      {/* Storage & Lifecycle Section */}
      {organizationId && <StorageLifecycleSection organizationId={organizationId} />}

      {/* Search Index Section */}
      <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center gap-2">
            <Search size={18} className="text-forest" />
            <h2 className="text-lg font-semibold text-ink">Search Index</h2>
          </div>
          <p className="text-sm text-archive mt-1">
            Rebuild the search index if media search results are incomplete or out of sync.
          </p>
        </div>
        <div className="px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex-1 mr-4">
              <p className="text-sm text-accessible-gray">
                The search index is automatically updated when media is uploaded, modified, or deleted.
                Manual reindexing is only needed if you suspect the index is out of sync.
              </p>
            </div>
            <button
              onClick={handleReindex}
              disabled={!canAdmin || reindexMutation.isPending}
              title={!canAdmin ? "You don't have permission" : undefined}
              className={`flex items-center gap-2 px-4 py-2 bg-forest text-parchment rounded-md hover:bg-forest/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0 ${!canAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <RefreshCw size={16} className={reindexMutation.isPending ? 'animate-spin' : ''} />
              {reindexMutation.isPending ? 'Reindexing...' : 'Reindex Now'}
            </button>
          </div>

          {/* Reindex Status */}
          {reindexMutation.isPending && (
            <div className="mt-4 flex items-center gap-2 text-sm text-accessible-gray">
              <MadronaLoader variant="inline" label="Rebuilding search index..." />
            </div>
          )}

          {reindexMutation.isError && (
            <div className="mt-4 flex items-start gap-2 p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-md">
              <AlertCircle size={16} className="text-semantic-error mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-semantic-error">Reindex Failed</p>
                <p className="text-sm text-semantic-error mt-0.5">
                  {reindexMutation.error instanceof Error
                    ? reindexMutation.error.message
                    : 'An unexpected error occurred'}
                </p>
              </div>
            </div>
          )}

          {lastReindexResult && reindexMutation.isSuccess && (
            <div className="mt-4 flex items-start gap-2 p-3 bg-semantic-success/10 border border-semantic-success/30 rounded-md">
              <CheckCircle size={16} className="text-semantic-success mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-semantic-success">Reindex Complete</p>
                <p className="text-sm text-semantic-success mt-0.5">
                  Successfully indexed {lastReindexResult.indexed} of {lastReindexResult.total} media assets
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* AI Auto-Tagging Section */}
      <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-forest" />
              <h2 className="text-lg font-semibold text-ink">AI Auto-Tagging</h2>
            </div>
            <p className="text-sm text-archive mt-1">
              Automatically detect and apply tags using AI analysis of uploaded images and documents.
            </p>
          </div>
          <Link
            to={`/organizations/${organizationId}/media/ai-config`}
            className="flex items-center gap-2 px-4 py-2 text-forest border border-forest rounded-md hover:bg-forest/5 transition-colors"
          >
            Configure AI Tagging
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Tag Definitions Section */}
      <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Tag size={18} className="text-forest" />
              <h2 className="text-lg font-semibold text-ink">Tag Definitions</h2>
            </div>
            <p className="text-sm text-archive mt-1">
              Define tags that can be assigned to media items for organization and filtering.
            </p>
          </div>
          <Link
            to={`/organizations/${organizationId}/media/tag-settings`}
            className="flex items-center gap-2 px-4 py-2 text-forest border border-forest rounded-md hover:bg-forest/5 transition-colors"
          >
            Manage Tags
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Watermark Templates Section */}
      <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Droplets size={18} className="text-forest" />
              <h2 className="text-lg font-semibold text-ink">Watermark Templates</h2>
            </div>
            <p className="text-sm text-archive mt-1">
              Create templates for watermarking published media to protect your assets.
            </p>
          </div>
          <Link
            to={`/organizations/${organizationId}/media/watermark-templates`}
            className="flex items-center gap-2 px-4 py-2 text-forest border border-forest rounded-md hover:bg-forest/5 transition-colors"
          >
            Manage Templates
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Field Inheritance Section */}
      <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Link2 size={18} className="text-forest" />
              <h2 className="text-lg font-semibold text-ink">Field Inheritance</h2>
            </div>
            <p className="text-sm text-archive mt-1">
              Configure how Collection object metadata is displayed on linked Media items.
            </p>
          </div>
          <Link
            to={`/organizations/${organizationId}/media/field-inheritance`}
            className="flex items-center gap-2 px-4 py-2 text-forest border border-forest rounded-md hover:bg-forest/5 transition-colors"
          >
            Configure Fields
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Rights Enforcement Section */}
      <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Shield size={18} className="text-forest" />
              <h2 className="text-lg font-semibold text-ink">Rights Enforcement</h2>
            </div>
            <p className="text-sm text-archive mt-1">
              Gate media downloads behind MediaRights, unpublished-view, and derivative-download permissions.
            </p>
          </div>
          <Link
            to={`/organizations/${organizationId}/media/rights-enforcement`}
            className="flex items-center gap-2 px-4 py-2 text-forest border border-forest rounded-md hover:bg-forest/5 transition-colors"
          >
            Configure Enforcement
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Contextual Reference - Processing Jobs */}
      <div className="pt-4 border-t border-lichen">
        <p className="text-sm text-archive">
          <Activity size={14} className="inline mr-1.5 -mt-0.5" />
          Need to monitor media processing?{' '}
          <Link
            to={`/organizations/${organizationId}/media/processing-jobs`}
            className="text-forest hover:underline"
          >
            View Processing Jobs
          </Link>
        </p>
      </div>
    </div>
  );
}
