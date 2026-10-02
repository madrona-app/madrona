import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Lightbulb,
  Tag,
  Type,
  User,
  Star,
  Shield,
  Palette,
  Plus,
  ChevronRight,
  Loader2,
  AlertCircle,
  Check,
  Image,
} from 'lucide-react';
import {
  getAITagSuggestions,
  createMediaAITagMapping,
  listTagDefinitions,
  type AITagSuggestion,
} from '../../lib/api';
import type { MediaTagDefinition } from '../../lib/schemas';
import SlideOver from '../ui/SlideOver';
import { MadronaLoader } from '../ui/MadronaLoader';

// Tag type configuration
const TAG_TYPE_CONFIG: Record<string, { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; color: string }> = {
  label: { icon: Tag, label: 'Labels', color: 'text-semantic-info bg-semantic-info/10' },
  text: { icon: Type, label: 'Text', color: 'text-semantic-success bg-semantic-success/10' },
  face: { icon: User, label: 'Faces', color: 'text-semantic-info bg-semantic-info/10' },
  celebrity: { icon: Star, label: 'Celebrities', color: 'text-semantic-warning bg-semantic-warning/10' },
  moderation: { icon: Shield, label: 'Moderation', color: 'text-semantic-error bg-semantic-error/10' },
  color: { icon: Palette, label: 'Colors', color: 'text-bark bg-bark/10' },
};

interface UnmappedAISuggestionsPanelProps {
  organizationId: string;
}

/**
 * Quick mapping modal
 */
function QuickMapModal({
  isOpen,
  onClose,
  organizationId,
  suggestion,
  tagDefinitions,
}: {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  suggestion: AITagSuggestion | null;
  tagDefinitions: MediaTagDefinition[];
}) {
  const queryClient = useQueryClient();
  const [definitionId, setDefinitionId] = useState('');
  const [mappedValue, setMappedValue] = useState(suggestion?.ai_tag_value || '');

  // Reset when suggestion changes
  if (suggestion && mappedValue !== suggestion.ai_tag_value && !definitionId) {
    setMappedValue(suggestion.ai_tag_value);
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createMediaAITagMapping(organizationId, {
        ai_tag_type: suggestion!.ai_tag_type,
        ai_tag_value: suggestion!.ai_tag_value,
        definition_id: definitionId,
        mapped_value: mappedValue,
        auto_apply: true,
        min_confidence: 0.8,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-tag-suggestions', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['ai-tag-mappings', organizationId] });
      setDefinitionId('');
      setMappedValue('');
      onClose();
    },
  });

  if (!suggestion) return null;

  const typeConfig = TAG_TYPE_CONFIG[suggestion.ai_tag_type] || TAG_TYPE_CONFIG.label;
  const TypeIcon = typeConfig.icon;

  return (
    <SlideOver isOpen={isOpen} onClose={onClose} title="Quick Map Tag">
      <div className="flex flex-col h-full">
        <div className="flex-1 p-6 space-y-6">
          {createMutation.isError && (
            <div className="flex items-start gap-2 p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg">
              <AlertCircle size={16} className="text-semantic-error mt-0.5" />
              <p className="text-sm text-semantic-error">
                {createMutation.error instanceof Error
                  ? createMutation.error.message
                  : 'Failed to create mapping'}
              </p>
            </div>
          )}

          {/* Source */}
          <div>
            <label className="block text-sm font-medium text-ink mb-2">AI Detected Tag</label>
            <div className="flex items-center gap-3 p-3 bg-stone rounded-lg">
              <span className={`p-1.5 rounded ${typeConfig.color.split(' ')[1]}`}>
                <TypeIcon size={16} className={typeConfig.color.split(' ')[0]} />
              </span>
              <div>
                <p className="font-medium text-ink">{suggestion.ai_tag_value}</p>
                <p className="text-xs text-accessible-gray">
                  Found in {suggestion.occurrence_count} media items •{' '}
                  {Math.round(suggestion.avg_confidence * 100)}% avg confidence
                </p>
              </div>
            </div>
          </div>

          {/* Target Definition */}
          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              Map to Tag Definition <span className="text-semantic-error">*</span>
            </label>
            <select
              value={definitionId}
              onChange={(e) => setDefinitionId(e.target.value)}
              className="w-full px-3 py-2 border border-lichen rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <option value="">Select a tag definition...</option>
              {tagDefinitions
                .filter((d) => d.is_active)
                .map((def) => (
                  <option key={def.definition_id} value={def.definition_id}>
                    {def.display_name}
                  </option>
                ))}
            </select>
          </div>

          {/* Mapped Value */}
          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              Tag Value <span className="text-semantic-error">*</span>
            </label>
            <input
              type="text"
              value={mappedValue}
              onChange={(e) => setMappedValue(e.target.value)}
              className="w-full px-3 py-2 border border-lichen rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
            <p className="text-xs text-accessible-gray mt-1">
              The value that will be assigned when this AI tag is detected
            </p>
          </div>

          {/* Preview */}
          {definitionId && mappedValue && (
            <div className="p-3 bg-semantic-success/10 border border-semantic-success/30 rounded-lg">
              <p className="text-sm text-semantic-success">
                <Check size={14} className="inline mr-1" />
                When AI detects "{suggestion.ai_tag_value}", it will be mapped to{' '}
                <strong>
                  {tagDefinitions.find((d) => d.definition_id === definitionId)?.display_name}
                </strong>{' '}
                = "{mappedValue}"
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-lichen p-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-accessible-gray hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !definitionId || !mappedValue}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-forest text-parchment rounded-md hover:bg-forest/90 disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            Create Mapping
          </button>
        </div>
      </div>
    </SlideOver>
  );
}

/**
 * Unmapped AI Suggestions Panel
 *
 * Shows frequently detected AI tags that don't have mappings yet,
 * allowing users to quickly create mappings.
 */
export function UnmappedAISuggestionsPanel({ organizationId }: UnmappedAISuggestionsPanelProps) {
  const [selectedSuggestion, setSelectedSuggestion] = useState<AITagSuggestion | null>(null);
  const [filterType, setFilterType] = useState<string>('');

  // Fetch suggestions
  const { data: suggestionsData, isLoading } = useQuery({
    queryKey: ['ai-tag-suggestions', organizationId, filterType],
    queryFn: () =>
      getAITagSuggestions(organizationId, {
        tag_type: filterType || undefined,
        min_occurrences: 2,
        limit: 20,
      }),
    enabled: !!organizationId,
  });

  // Fetch tag definitions for the modal
  const { data: definitionsData } = useQuery({
    queryKey: ['tag-definitions', organizationId],
    queryFn: () => listTagDefinitions(organizationId),
    enabled: !!organizationId,
  });

  const suggestions = suggestionsData?.suggestions || [];
  const definitions = definitionsData?.definitions || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <MadronaLoader variant="dots" />
        <span className="ml-2 text-sm text-accessible-gray">Loading suggestions...</span>
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className="text-center py-8 bg-stone rounded-lg">
        <Lightbulb size={32} className="mx-auto text-accessible-gray mb-3" />
        <p className="text-sm font-medium text-ink">No unmapped tags</p>
        <p className="text-xs text-accessible-gray mt-1">
          All frequently occurring AI tags have been mapped
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb size={18} className="text-semantic-warning" />
          <h4 className="font-medium text-ink">Suggested Mappings</h4>
          <span className="text-xs text-accessible-gray bg-stone px-2 py-0.5 rounded-full">
            {suggestions.length}
          </span>
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="text-xs px-2 py-1 border border-lichen rounded focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        >
          <option value="">All types</option>
          {Object.entries(TAG_TYPE_CONFIG).map(([value, config]) => (
            <option key={value} value={value}>
              {config.label}
            </option>
          ))}
        </select>
      </div>

      {/* Suggestions List */}
      <div className="space-y-2">
        {suggestions.map((suggestion) => {
          const typeConfig = TAG_TYPE_CONFIG[suggestion.ai_tag_type] || TAG_TYPE_CONFIG.label;
          const TypeIcon = typeConfig.icon;

          return (
            <button
              key={`${suggestion.ai_tag_type}-${suggestion.ai_tag_value}`}
              onClick={() => setSelectedSuggestion(suggestion)}
              className="w-full flex items-center justify-between p-3 bg-parchment border border-lichen rounded-lg hover:border-forest/30 hover:bg-forest/5 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <span className={`p-1.5 rounded ${typeConfig.color.split(' ')[1]}`}>
                  <TypeIcon size={14} className={typeConfig.color.split(' ')[0]} />
                </span>
                <div>
                  <p className="font-medium text-ink">{suggestion.ai_tag_value}</p>
                  <div className="flex items-center gap-2 text-xs text-accessible-gray">
                    <span className="flex items-center gap-1">
                      <Image size={10} />
                      {suggestion.occurrence_count}
                    </span>
                    <span>•</span>
                    <span>{Math.round(suggestion.avg_confidence * 100)}% conf</span>
                  </div>
                </div>
              </div>
              <ChevronRight size={16} className="text-accessible-gray" />
            </button>
          );
        })}
      </div>

      {/* Quick Map Modal */}
      <QuickMapModal
        isOpen={!!selectedSuggestion}
        onClose={() => setSelectedSuggestion(null)}
        organizationId={organizationId}
        suggestion={selectedSuggestion}
        tagDefinitions={definitions}
      />
    </div>
  );
}
