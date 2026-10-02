import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles,
  Tag,
  Type,
  User,
  Star,
  Shield,
  Palette,
  RefreshCw,
  Check,
  X,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Loader2,
  Square,
} from 'lucide-react';
import {
  getMediaAITags,
  reprocessMediaAITags,
  deleteMediaAITag,
} from '../../lib/api';
import type { MediaAITag } from '../../lib/schemas';
import { MadronaLoader } from '../ui/MadronaLoader';
import { formatDateTime } from '@/lib/formatters';

// Tag type icons and labels
const TAG_TYPE_CONFIG: Record<string, { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; color: string }> = {
  label: { icon: Tag, label: 'Labels', color: 'text-semantic-info' },
  text: { icon: Type, label: 'Text (OCR)', color: 'text-semantic-success' },
  face: { icon: User, label: 'Faces', color: 'text-forest' },
  celebrity: { icon: Star, label: 'Celebrities', color: 'text-semantic-warning' },
  moderation: { icon: Shield, label: 'Moderation', color: 'text-semantic-error' },
  color: { icon: Palette, label: 'Colors', color: 'text-bark' },
};

// Mapping status badges (only shown for non-pending statuses)
const MAPPING_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  mapped: { label: 'Mapped', color: 'text-semantic-success', bg: 'bg-semantic-success/10' },
  rejected: { label: 'Rejected', color: 'text-semantic-error', bg: 'bg-semantic-error/10' },
  ignored: { label: 'Ignored', color: 'text-archive', bg: 'bg-stone' },
};

interface MediaAITagsTabProps {
  organizationId: string;
  mediaId: string;
  aiProcessingStatus?: string | null;
  aiProcessedAt?: string | null;
  aiLabelCount?: number;
}

/**
 * Confidence bar component
 */
function ConfidenceBar({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-lichen rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${
            percent >= 90 ? 'bg-semantic-success' : percent >= 70 ? 'bg-semantic-info' : 'bg-semantic-warning'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs text-accessible-gray w-8">{percent}%</span>
    </div>
  );
}

/**
 * Bounding box indicator (shows if tag has position data)
 */
function BoundingBoxIndicator({ tag }: { tag: MediaAITag }) {
  if (!tag.bbox) return null;

  return (
    <span
      title={`Position: ${Math.round(Number(tag.bbox.left) * 100)}%, ${Math.round(Number(tag.bbox.top) * 100)}%`}
      className="text-accessible-gray"
    >
      <Square size={12} />
    </span>
  );
}

/**
 * Individual AI tag item
 */
function AITagItem({
  tag,
  onDelete,
}: {
  tag: MediaAITag;
  onDelete?: (tag: MediaAITag) => void;
}) {
  const statusConfig = MAPPING_STATUS_CONFIG[tag.mapping_status];
  const confidence = Number(tag.confidence);

  return (
    <div className="flex items-center justify-between py-2 px-3 bg-parchment border border-lichen rounded-lg hover:border-forest/30 transition-colors">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-ink truncate">{tag.tag_value}</span>
          <BoundingBoxIndicator tag={tag} />
        </div>
        <ConfidenceBar confidence={confidence} />
        {statusConfig && (
          <span className={`text-xs px-1.5 py-0.5 rounded ${statusConfig.bg} ${statusConfig.color}`}>
            {statusConfig.label}
          </span>
        )}
      </div>

      {onDelete && (
        <button
          onClick={() => onDelete(tag)}
          className="p-1 ml-2 text-archive hover:text-semantic-error hover:bg-semantic-error/10 rounded transition-colors"
          title="Remove tag"
          aria-label={`Remove ${tag.tag_value} tag`}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/**
 * Collapsible section for a tag type
 */
function TagTypeSection({
  tagType,
  tags,
  defaultExpanded = true,
  onDelete,
}: {
  tagType: string;
  tags: MediaAITag[];
  defaultExpanded?: boolean;
  onDelete?: (tag: MediaAITag) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const config = TAG_TYPE_CONFIG[tagType] || TAG_TYPE_CONFIG.label;
  const Icon = config.icon;

  // Sort by confidence descending
  const sortedTags = [...tags].sort((a, b) => Number(b.confidence) - Number(a.confidence));

  return (
    <div className="border border-lichen rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-stone hover:bg-stone/80 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon size={16} className={config.color} />
          <span className="font-medium text-ink">{config.label}</span>
          <span className="text-xs text-accessible-gray bg-parchment px-2 py-0.5 rounded-full">
            {tags.length}
          </span>
        </div>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {expanded && (
        <div className="p-3 space-y-2 bg-parchment">
          {sortedTags.map((tag) => (
            <AITagItem
              key={tag.ai_tag_id}
              tag={tag}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Processing status banner
 */
function ProcessingStatusBanner({
  status,
  processedAt,
  onReprocess,
  isReprocessing,
}: {
  status?: string | null;
  processedAt?: string | null;
  onReprocess: () => void;
  isReprocessing: boolean;
}) {
  if (!status) {
    return (
      <div className="flex items-center justify-between p-3 bg-stone/30 border border-lichen rounded-lg">
        <div className="flex items-center gap-2 text-accessible-gray">
          <Sparkles size={16} />
          <span className="text-sm">AI tagging not yet run on this media</span>
        </div>
        <button
          onClick={onReprocess}
          disabled={isReprocessing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-forest border border-forest rounded hover:bg-forest/5 disabled:opacity-50"
        >
          {isReprocessing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Analyze Now
        </button>
      </div>
    );
  }

  const statusConfig: Record<string, { icon: React.ComponentType<{ size?: number; className?: string }>; color: string; bg: string; label: string }> = {
    pending: { icon: Clock, color: 'text-semantic-warning', bg: 'bg-semantic-warning/10', label: 'Queued for processing' },
    processing: { icon: RefreshCw, color: 'text-semantic-info', bg: 'bg-semantic-info/10', label: 'Processing...' },
    completed: { icon: Check, color: 'text-semantic-success', bg: 'bg-semantic-success/10', label: 'Analysis complete' },
    failed: { icon: AlertCircle, color: 'text-semantic-error', bg: 'bg-semantic-error/10', label: 'Analysis failed' },
    skipped: { icon: X, color: 'text-archive', bg: 'bg-stone/30', label: 'Skipped (unsupported format)' },
  };

  const config = statusConfig[status] || statusConfig.pending;
  const StatusIcon = config.icon;

  return (
    <div className={`flex items-center justify-between p-3 ${config.bg} border border-lichen rounded-lg`}>
      <div className="flex items-center gap-2">
        <StatusIcon size={16} className={`${config.color} ${status === 'processing' ? 'animate-spin' : ''}`} />
        <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
        {processedAt && status === 'completed' && (
          <span className="text-xs text-accessible-gray">
            {formatDateTime(processedAt)}
          </span>
        )}
      </div>
      {(status === 'completed' || status === 'failed') && (
        <button
          onClick={onReprocess}
          disabled={isReprocessing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-forest border border-forest rounded hover:bg-forest/5 disabled:opacity-50"
        >
          {isReprocessing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Re-analyze
        </button>
      )}
    </div>
  );
}

/**
 * Media AI Tags Tab
 *
 * Shows AI-detected tags for a media item, grouped by type,
 * with confidence scores and mapping status.
 */
export default function MediaAITagsTab({
  organizationId,
  mediaId,
  aiProcessingStatus,
  aiProcessedAt,
  aiLabelCount: _aiLabelCount,
}: MediaAITagsTabProps) {
  const queryClient = useQueryClient();
  const [isPolling, setIsPolling] = useState(false);

  // Fetch AI tags
  const { data: aiTagsData, isLoading, error } = useQuery({
    queryKey: ['media-ai-tags', organizationId, mediaId],
    queryFn: () => getMediaAITags(organizationId, mediaId),
    enabled: !!organizationId && !!mediaId,
    refetchInterval: (query) => {
      const status = query.state.data?.ai_processing_status;
      if (status === 'completed' || status === 'failed' || status === 'skipped') {
        if (isPolling) setIsPolling(false);
        return false;
      }
      return (isPolling || status === 'processing' || status === 'pending') ? 3000 : false;
    },
  });

  // Reprocess mutation
  const reprocessMutation = useMutation({
    mutationFn: () => reprocessMediaAITags(organizationId, mediaId),
    onSuccess: () => {
      setIsPolling(true);
      queryClient.invalidateQueries({ queryKey: ['media-ai-tags', organizationId, mediaId] });
      queryClient.invalidateQueries({ queryKey: ['media', organizationId, mediaId] });
    },
  });

  // Delete tag mutation
  const deleteMutation = useMutation({
    mutationFn: (aiTagId: string) => deleteMediaAITag(organizationId, mediaId, aiTagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-ai-tags', organizationId, mediaId] });
    },
  });

  const handleReprocess = () => {
    reprocessMutation.mutate();
  };

  const handleDelete = (tag: MediaAITag) => {
    deleteMutation.mutate(tag.ai_tag_id);
  };

  // Group tags by type
  const tagsByType = (aiTagsData?.ai_tags || []).reduce((acc, tag) => {
    const type = tag.tag_type;
    if (!acc[type]) acc[type] = [];
    acc[type].push(tag);
    return acc;
  }, {} as Record<string, MediaAITag[]>);

  // Order tag types
  const orderedTypes = ['label', 'text', 'face', 'celebrity', 'moderation', 'color'];
  const presentTypes = orderedTypes.filter((type) => tagsByType[type]?.length > 0);

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <MadronaLoader variant="dots" />
        <span className="ml-2 text-accessible-gray">Loading AI tags...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="flex items-start gap-2 p-3 bg-semantic-error/10 border border-semantic-error/20 rounded-lg">
          <AlertCircle size={16} className="text-semantic-error mt-0.5" />
          <div>
            <p className="text-sm font-medium text-semantic-error">Failed to load AI tags</p>
            <p className="text-sm text-semantic-error">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const totalTags = aiTagsData?.ai_tags?.length || 0;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Status Banner - prefer fresh status from AI tags response over parent prop */}
      <ProcessingStatusBanner
        status={isPolling && !aiTagsData?.ai_processing_status ? 'pending' : (aiTagsData?.ai_processing_status ?? aiProcessingStatus)}
        processedAt={aiTagsData?.ai_processed_at ?? aiProcessedAt}
        onReprocess={handleReprocess}
        isReprocessing={reprocessMutation.isPending}
      />

      {reprocessMutation.isError && (
        <div className="flex items-center gap-2 p-3 bg-semantic-error/10 border border-semantic-error/20 rounded-lg">
          <AlertCircle size={16} className="text-semantic-error" />
          <span className="text-sm text-semantic-error">
            {reprocessMutation.error instanceof Error
              ? reprocessMutation.error.message
              : 'Failed to queue analysis'}
          </span>
        </div>
      )}

      {/* Summary */}
      {totalTags > 0 && (
        <div className="text-sm text-accessible-gray">
          <strong className="text-ink">{totalTags}</strong> AI-detected tags
        </div>
      )}

      {/* Tag Sections */}
      {presentTypes.length > 0 ? (
        <div className="space-y-4">
          {presentTypes.map((type, index) => (
            <TagTypeSection
              key={type}
              tagType={type}
              tags={tagsByType[type]}
              defaultExpanded={index < 2}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : aiProcessingStatus === 'completed' ? (
        <div className="text-center py-8 bg-stone/30 rounded-lg">
          <Sparkles size={32} className="mx-auto text-accessible-gray mb-3" />
          <p className="text-sm text-accessible-gray">No tags were detected in this media</p>
        </div>
      ) : null}
    </div>
  );
}
