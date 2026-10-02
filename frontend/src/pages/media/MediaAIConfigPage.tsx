import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles,
  ChevronLeft,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Info,
  FileText,
  Image,
  DollarSign,
  Activity,
  Loader2,
  Link2,
} from 'lucide-react';
import {
  getMediaAIConfig,
  updateMediaAIConfig,
  getAITaggingStats,
  type MediaAIConfig,
} from '../../lib/api';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { AITagMappingsManager, UnmappedAISuggestionsPanel, BulkAIReprocessPanel } from '../../components/dam';
import { useOrganization } from '../../contexts/useOrganization';
import { usePermissions } from '../../hooks/usePermissions';
import { formatNumber } from '@/lib/formatters';

/**
 * Toggle switch component for feature flags
 */
function Toggle({
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <div className="relative mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="sr-only"
        />
        <div
          className={`w-10 h-6 rounded-full transition-colors ${
            checked ? 'bg-forest' : 'bg-lichen'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div
            className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-parchment shadow transition-transform ${
              checked ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </div>
      </div>
      <div className="flex-1">
        <span className={`text-sm font-medium ${disabled ? 'text-accessible-gray' : 'text-ink'}`}>
          {label}
        </span>
        {description && (
          <p className="text-xs text-accessible-gray mt-0.5">{description}</p>
        )}
      </div>
    </label>
  );
}

/**
 * Stats card component
 */
function StatCard({
  label,
  value,
  icon: Icon,
  color = 'text-forest',
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color?: string;
}) {
  return (
    <div className="p-4 bg-stone rounded-lg">
      <div className="flex items-center gap-2 text-accessible-gray mb-1">
        <Icon size={14} className={color} />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-xl font-semibold text-ink">{value}</p>
    </div>
  );
}

/**
 * Media AI Configuration Page
 *
 * Configure AI auto-tagging features for media uploads including:
 * - Feature toggles (labels, text, faces, etc.)
 * - Confidence thresholds
 * - Budget controls
 */
export default function MediaAIConfigPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('media.admin');

  // Local form state
  const [formData, setFormData] = useState<Partial<MediaAIConfig> | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch config
  const {
    data: config,
    isLoading: configLoading,
    error: configError,
  } = useQuery({
    queryKey: ['media-ai-config', organizationId],
    queryFn: () => getMediaAIConfig(organizationId!),
    enabled: !!organizationId,
  });

  // Initialize form data when config loads
  useEffect(() => {
    if (config && !formData) {
      setFormData(config);
    }
  }, [config, formData]);

  // Fetch stats
  const { data: stats } = useQuery({
    queryKey: ['ai-tagging-stats', organizationId],
    queryFn: () => getAITaggingStats(organizationId!),
    enabled: !!organizationId,
    staleTime: 30000, // 30 seconds
  });

  // Update mutation - only pass allowed fields
  const updateMutation = useMutation({
    mutationFn: (updates: Partial<MediaAIConfig>) => {
      // Extract only the fields that the API accepts, ensuring numbers are numbers
      const { auto_tag_on_upload, detect_labels, detect_text, detect_faces,
        detect_celebrities, detect_moderation, extract_pdf_text,
        min_label_confidence, min_text_confidence, max_labels_per_image,
        monthly_budget_usd } = updates;
      return updateMediaAIConfig(organizationId!, {
        auto_tag_on_upload, detect_labels, detect_text, detect_faces,
        detect_celebrities, detect_moderation, extract_pdf_text,
        min_label_confidence: min_label_confidence !== undefined ? Number(min_label_confidence) : undefined,
        min_text_confidence: min_text_confidence !== undefined ? Number(min_text_confidence) : undefined,
        max_labels_per_image: max_labels_per_image !== undefined ? Number(max_labels_per_image) : undefined,
        monthly_budget_usd: monthly_budget_usd !== undefined ? (monthly_budget_usd === null ? null : Number(monthly_budget_usd)) : undefined,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['media-ai-config', organizationId] });
      setFormData(data);
      setHasChanges(false);
    },
  });

  const handleToggle = (field: keyof MediaAIConfig, value: boolean) => {
    if (!formData) return;
    setFormData({ ...formData, [field]: value });
    setHasChanges(true);
  };

  const handleNumberChange = (field: keyof MediaAIConfig, value: number | null) => {
    if (!formData) return;
    setFormData({ ...formData, [field]: value });
    setHasChanges(true);
  };

  const handleSave = () => {
    if (!formData) return;
    updateMutation.mutate({
      auto_tag_on_upload: formData.auto_tag_on_upload,
      detect_labels: formData.detect_labels,
      detect_text: formData.detect_text,
      detect_faces: formData.detect_faces,
      detect_celebrities: formData.detect_celebrities,
      detect_moderation: formData.detect_moderation,
      extract_pdf_text: formData.extract_pdf_text,
      min_label_confidence: Number(formData.min_label_confidence),
      min_text_confidence: Number(formData.min_text_confidence),
      max_labels_per_image: Number(formData.max_labels_per_image),
      monthly_budget_usd: formData.monthly_budget_usd
        ? Number(formData.monthly_budget_usd)
        : null,
    });
  };

  if (!organizationId) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-md p-4 text-semantic-error">
          Organization ID is required
        </div>
      </div>
    );
  }

  if (configLoading) {
    return (
      <div className="max-w-3xl mx-auto py-12 flex items-center justify-center">
        <MadronaLoader variant="dots" label="Loading AI configuration..." />
      </div>
    );
  }

  if (configError) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-semantic-warning/10 border border-semantic-warning/30 rounded-md p-4">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-semantic-warning mt-0.5" />
            <div>
              <p className="text-sm font-medium text-semantic-warning">Unable to load AI configuration</p>
              <p className="text-sm text-semantic-warning mt-1">
                AI tagging may not be configured for this organization yet.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back link */}
      <Link
        to={`/organizations/${organizationId}/media/config`}
        className="inline-flex items-center gap-1 text-sm text-archive hover:text-bark no-underline"
      >
        <ChevronLeft size={16} />
        Back to Media Configuration
      </Link>

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-forest/10 rounded-lg">
            <Sparkles size={24} className="text-forest" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-ink">AI Auto-Tagging</h1>
            <p className="text-sm text-archive">
              Configure automatic tag detection for uploaded media
            </p>
          </div>
        </div>
        {canEdit && hasChanges && (
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-forest text-parchment rounded-md hover:bg-forest/90 disabled:opacity-50 transition-colors"
          >
            {updateMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <CheckCircle size={16} />
            )}
            Save Changes
          </button>
        )}
      </div>

      {/* Success/Error Messages */}
      {updateMutation.isSuccess && (
        <div className="flex items-start gap-2 p-3 bg-semantic-success/10 border border-semantic-success/30 rounded-md">
          <CheckCircle size={16} className="text-semantic-success mt-0.5" />
          <p className="text-sm text-semantic-success">Configuration saved successfully</p>
        </div>
      )}

      {updateMutation.isError && (
        <div className="flex items-start gap-2 p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-md">
          <AlertCircle size={16} className="text-semantic-error mt-0.5" />
          <p className="text-sm text-semantic-error">
            Failed to save configuration:{' '}
            {updateMutation.error instanceof Error
              ? updateMutation.error.message
              : 'Unknown error'}
          </p>
        </div>
      )}

      {/* Stats Section */}
      {stats && (
        <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
          <div className="px-6 py-4 border-b border-lichen">
            <div className="flex items-center gap-2">
              <Activity size={18} className="text-forest" />
              <h2 className="text-lg font-semibold text-ink">Processing Status</h2>
            </div>
          </div>
          <div className="px-6 py-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="Total Media"
                value={formatNumber(stats.total_media)}
                icon={Image}
              />
              <StatCard
                label="Completed"
                value={formatNumber(stats.completed_count)}
                icon={CheckCircle}
                color="text-semantic-success"
              />
              <StatCard
                label="Pending"
                value={formatNumber(stats.pending_count)}
                icon={RefreshCw}
                color="text-semantic-warning"
              />
              <StatCard
                label="AI Tags"
                value={formatNumber(stats.total_ai_tags)}
                icon={Sparkles}
              />
            </div>

            {/* Bulk Reprocess Panel */}
            <BulkAIReprocessPanel
              organizationId={organizationId}
              stats={stats}
              canEdit={canEdit}
            />
          </div>
        </section>
      )}

      {/* Feature Toggles */}
      {formData && (
        <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
          <div className="px-6 py-4 border-b border-lichen">
            <h2 className="text-lg font-semibold text-ink">Detection Features</h2>
            <p className="text-sm text-archive mt-1">
              Select which types of AI analysis to run on uploaded images
            </p>
          </div>
          <div className="px-6 py-5 space-y-5">
            <Toggle
              checked={Boolean(formData.auto_tag_on_upload)}
              onChange={(v) => handleToggle('auto_tag_on_upload', v)}
              disabled={!canEdit}
              label="Auto-tag on Upload"
              description="Automatically analyze new media when uploaded"
            />

            <div className="border-t border-lichen pt-5">
              <h3 className="text-sm font-medium text-ink mb-4 flex items-center gap-2">
                <Image size={16} />
                Image Analysis
              </h3>
              <div className="space-y-4 ml-6">
                <Toggle
                  checked={Boolean(formData.detect_labels)}
                  onChange={(v) => handleToggle('detect_labels', v)}
                  disabled={!canEdit}
                  label="Detect Labels"
                  description="Identify objects, scenes, and concepts in images"
                />
                <Toggle
                  checked={Boolean(formData.detect_text)}
                  onChange={(v) => handleToggle('detect_text', v)}
                  disabled={!canEdit}
                  label="Detect Text (OCR)"
                  description="Extract text visible in images"
                />
                <Toggle
                  checked={Boolean(formData.detect_faces)}
                  onChange={(v) => handleToggle('detect_faces', v)}
                  disabled={!canEdit}
                  label="Detect Faces"
                  description="Identify face locations (no identity recognition)"
                />
                <Toggle
                  checked={Boolean(formData.detect_celebrities)}
                  onChange={(v) => handleToggle('detect_celebrities', v)}
                  disabled={!canEdit}
                  label="Detect Celebrities"
                  description="Identify known public figures (requires Detect Faces)"
                />
                <Toggle
                  checked={Boolean(formData.detect_moderation)}
                  onChange={(v) => handleToggle('detect_moderation', v)}
                  disabled={!canEdit}
                  label="Content Moderation"
                  description="Flag potentially inappropriate content"
                />
              </div>
            </div>

            <div className="border-t border-lichen pt-5">
              <h3 className="text-sm font-medium text-ink mb-4 flex items-center gap-2">
                <FileText size={16} />
                Document Analysis
              </h3>
              <div className="ml-6">
                <Toggle
                  checked={Boolean(formData.extract_pdf_text)}
                  onChange={(v) => handleToggle('extract_pdf_text', v)}
                  disabled={!canEdit}
                  label="Extract PDF Text"
                  description="Extract searchable text from PDF documents (no API cost)"
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Confidence Thresholds */}
      {formData && (
        <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
          <div className="px-6 py-4 border-b border-lichen">
            <h2 className="text-lg font-semibold text-ink">Confidence Thresholds</h2>
            <p className="text-sm text-archive mt-1">
              Set minimum confidence levels for auto-applying detected tags
            </p>
          </div>
          <div className="px-6 py-5 space-y-5">
            <div>
              <label className="block text-sm font-medium text-ink mb-2">
                Minimum Label Confidence
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="0.5"
                  max="0.99"
                  step="0.01"
                  value={Number(formData.min_label_confidence) || 0.7}
                  onChange={(e) =>
                    handleNumberChange('min_label_confidence', parseFloat(e.target.value))
                  }
                  disabled={!canEdit}
                  className="flex-1 h-2 bg-lichen rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed"
                />
                <span className="w-16 text-center text-sm font-mono bg-stone px-2 py-1 rounded">
                  {(Number(formData.min_label_confidence) * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-xs text-accessible-gray mt-1">
                Labels below this confidence will be stored but not auto-applied
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-2">
                Minimum Text Confidence
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="0.5"
                  max="0.99"
                  step="0.01"
                  value={Number(formData.min_text_confidence) || 0.8}
                  onChange={(e) =>
                    handleNumberChange('min_text_confidence', parseFloat(e.target.value))
                  }
                  disabled={!canEdit}
                  className="flex-1 h-2 bg-lichen rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed"
                />
                <span className="w-16 text-center text-sm font-mono bg-stone px-2 py-1 rounded">
                  {(Number(formData.min_text_confidence) * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-2">
                Max Labels per Image
              </label>
              <input
                type="number"
                min="10"
                max="100"
                value={formData.max_labels_per_image || 50}
                onChange={(e) =>
                  handleNumberChange('max_labels_per_image', parseInt(e.target.value) || 50)
                }
                disabled={!canEdit}
                className="w-24 px-3 py-1.5 border border-lichen rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest disabled:bg-stone disabled:cursor-not-allowed"
              />
              <p className="text-xs text-accessible-gray mt-1">
                Maximum number of labels to store per image (10-100)
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Budget Controls */}
      {formData && (
        <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
          <div className="px-6 py-4 border-b border-lichen">
            <div className="flex items-center gap-2">
              <DollarSign size={18} className="text-forest" />
              <h2 className="text-lg font-semibold text-ink">Budget Controls</h2>
            </div>
            <p className="text-sm text-archive mt-1">
              Set monthly spending limits for AI processing
            </p>
          </div>
          <div className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-2">
                Monthly Budget (USD)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-accessible-gray">$</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formData.monthly_budget_usd ?? ''}
                  onChange={(e) =>
                    handleNumberChange(
                      'monthly_budget_usd',
                      e.target.value ? parseFloat(e.target.value) : null
                    )
                  }
                  placeholder="No limit"
                  disabled={!canEdit}
                  className="w-32 px-3 py-1.5 border border-lichen rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest disabled:bg-stone disabled:cursor-not-allowed"
                />
              </div>
              <p className="text-xs text-accessible-gray mt-1">
                Leave empty for no limit. Processing will pause when budget is reached.
              </p>
            </div>

            {stats && (
              <div className="p-3 bg-stone rounded-md">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-accessible-gray">Current Month Usage</span>
                  <span className="text-sm font-medium text-ink">
                    ${Number(stats.monthly_usage_usd).toFixed(4)}
                    {stats.monthly_budget_usd && (
                      <span className="text-accessible-gray">
                        {' '}
                        / ${Number(stats.monthly_budget_usd).toFixed(2)}
                      </span>
                    )}
                  </span>
                </div>
                {stats.monthly_budget_usd && (
                  <div className="mt-2 h-2 bg-lichen rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        Number(stats.monthly_usage_usd) / Number(stats.monthly_budget_usd) > 0.9
                          ? 'bg-semantic-error/100'
                          : Number(stats.monthly_usage_usd) / Number(stats.monthly_budget_usd) > 0.7
                          ? 'bg-semantic-warning/100'
                          : 'bg-forest'
                      }`}
                      style={{
                        width: `${Math.min(
                          100,
                          (Number(stats.monthly_usage_usd) / Number(stats.monthly_budget_usd)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Tag Mappings */}
      <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center gap-2">
            <Link2 size={18} className="text-forest" />
            <h2 className="text-lg font-semibold text-ink">Tag Mappings</h2>
          </div>
          <p className="text-sm text-archive mt-1">
            Map AI-detected labels to your organization's tag definitions for automatic tagging
          </p>
        </div>
        <div className="p-6 space-y-8">
          {/* Unmapped Suggestions */}
          <UnmappedAISuggestionsPanel organizationId={organizationId} />

          {/* All Mappings */}
          <div className="border-t border-lichen pt-6">
            <AITagMappingsManager organizationId={organizationId} />
          </div>
        </div>
      </section>

      {/* Info Note */}
      <div className="flex items-start gap-2 p-3 bg-semantic-info/10 border border-semantic-info/30 rounded-md">
        <Info size={16} className="text-semantic-info mt-0.5 flex-shrink-0" />
        <div className="text-sm text-semantic-info">
          <p className="font-medium">About AI Auto-Tagging</p>
          <p className="mt-1 text-semantic-info">
            AI tagging uses AWS Rekognition for image analysis and PyMuPDF for PDF text extraction.
            Image analysis costs approximately $0.001-0.004 per image depending on features enabled.
            PDF text extraction is processed locally at no additional cost.
          </p>
        </div>
      </div>
    </div>
  );
}
