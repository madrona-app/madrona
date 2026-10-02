import { useState } from 'react';
import Checkbox from '../../Checkbox';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, Save } from 'lucide-react';
import {
  createMediaAITagMapping,
  updateMediaAITagMapping,
} from '../../../lib/api';
import SlideOver from '../../ui/SlideOver';
import { TAG_TYPES } from './types';
import type { AITagType, MappingEditorProps } from './types';

export function MappingEditor({
  isOpen,
  onClose,
  organizationId,
  mapping,
  tagDefinitions,
}: MappingEditorProps) {
  const queryClient = useQueryClient();
  const isEditing = !!mapping;

  // Form state
  const [aiTagType, setAiTagType] = useState<AITagType>(
    (mapping?.ai_tag_type as AITagType) || 'label'
  );
  const [aiTagValue, setAiTagValue] = useState(mapping?.ai_tag_value || '');
  const [definitionId, setDefinitionId] = useState(mapping?.definition_id || '');
  const [mappedValue, setMappedValue] = useState(mapping?.mapped_value || '');
  const [autoApply, setAutoApply] = useState(mapping?.auto_apply ?? true);
  const [minConfidence, setMinConfidence] = useState(
    mapping ? Number(mapping.min_confidence) * 100 : 80
  );

  const resetForm = () => {
    setAiTagType(mapping?.ai_tag_type || 'label');
    setAiTagValue(mapping?.ai_tag_value || '');
    setDefinitionId(mapping?.definition_id || '');
    setMappedValue(mapping?.mapped_value || '');
    setAutoApply(mapping?.auto_apply ?? true);
    setMinConfidence(mapping ? Number(mapping.min_confidence) * 100 : 80);
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createMediaAITagMapping(organizationId, {
        ai_tag_type: aiTagType,
        ai_tag_value: aiTagValue,
        definition_id: definitionId,
        mapped_value: mappedValue,
        auto_apply: autoApply,
        min_confidence: minConfidence / 100,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-tag-mappings', organizationId] });
      onClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateMediaAITagMapping(organizationId, mapping!.mapping_id, {
        definition_id: definitionId,
        mapped_value: mappedValue,
        auto_apply: autoApply,
        min_confidence: minConfidence / 100,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-tag-mappings', organizationId] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEditing) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error || updateMutation.error;

  const selectedDefinition = tagDefinitions.find((d) => d.definition_id === definitionId);

  return (
    <SlideOver isOpen={isOpen} onClose={onClose} title={isEditing ? 'Edit Mapping' : 'New Mapping'}>
      <form onSubmit={handleSubmit} className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-semantic-error/10 border border-semantic-error/20 rounded-lg">
              <AlertCircle size={16} className="text-semantic-error mt-0.5" />
              <p className="text-sm text-semantic-error">
                {error instanceof Error ? error.message : 'Failed to save mapping'}
              </p>
            </div>
          )}

          {/* AI Source Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-ink border-b border-lichen pb-2">
              AI Detection Source
            </h3>

            <div>
              <label className="block text-sm font-medium text-ink mb-1">Tag Type</label>
              <select
                value={aiTagType}
                onChange={(e) => setAiTagType(e.target.value as AITagType)}
                disabled={isEditing}
                className="w-full px-3 py-2 border border-lichen rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:bg-stone"
              >
                {TAG_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                AI Tag Value <span className="text-semantic-error">*</span>
              </label>
              <input
                type="text"
                value={aiTagValue}
                onChange={(e) => setAiTagValue(e.target.value)}
                disabled={isEditing}
                placeholder="e.g., Dog, Cat, Person"
                required
                className="w-full px-3 py-2 border border-lichen rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:bg-stone"
              />
              <p className="text-xs text-accessible-gray mt-1">
                The exact value detected by AI (case-insensitive matching)
              </p>
            </div>
          </div>

          {/* Mapping Target Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-ink border-b border-lichen pb-2">
              Map To Organization Tag
            </h3>

            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Tag Definition <span className="text-semantic-error">*</span>
              </label>
              <select
                value={definitionId}
                onChange={(e) => {
                  setDefinitionId(e.target.value);
                  if (!mappedValue) {
                    const def = tagDefinitions.find((d) => d.definition_id === e.target.value);
                    if (def) setMappedValue(aiTagValue || def.display_name);
                  }
                }}
                required
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

            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Mapped Value <span className="text-semantic-error">*</span>
              </label>
              <input
                type="text"
                value={mappedValue}
                onChange={(e) => setMappedValue(e.target.value)}
                placeholder="Value to assign"
                required
                className="w-full px-3 py-2 border border-lichen rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
              <p className="text-xs text-accessible-gray mt-1">
                The value that will be assigned to the tag definition
              </p>
            </div>
          </div>

          {/* Preview */}
          {selectedDefinition && mappedValue && (
            <div className="p-3 bg-semantic-success/10 border border-semantic-success/20 rounded-lg">
              <p className="text-sm text-semantic-success">
                <strong>Preview:</strong> When AI detects &ldquo;{aiTagValue}&rdquo;, it will set{' '}
                <strong>{selectedDefinition.display_name}</strong> = &ldquo;{mappedValue}&rdquo;
              </p>
            </div>
          )}

          {/* Options Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-ink border-b border-lichen pb-2">Options</h3>

            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox
                checked={autoApply}
                onChange={(e) => setAutoApply(e.target.checked)}
                className="mt-1"
              />
              <div>
                <span className="text-sm font-medium text-ink">Auto-apply</span>
                <p className="text-xs text-accessible-gray">
                  Automatically apply this mapping when confidence threshold is met
                </p>
              </div>
            </label>

            <div>
              <label className="block text-sm font-medium text-ink mb-2">
                Minimum Confidence: {minConfidence}%
              </label>
              <input
                type="range"
                min="50"
                max="99"
                value={minConfidence}
                onChange={(e) => setMinConfidence(parseInt(e.target.value))}
                className="w-full h-2 bg-stone rounded-lg appearance-none cursor-pointer"
              />
              <p className="text-xs text-accessible-gray mt-1">
                Only apply when AI confidence is at least this value
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-lichen p-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              resetForm();
              onClose();
            }}
            className="px-4 py-2 text-sm text-accessible-gray hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending || !aiTagValue || !definitionId || !mappedValue}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-forest text-parchment rounded-md hover:bg-forest/90 disabled:opacity-50"
          >
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {isEditing ? 'Save Changes' : 'Create Mapping'}
          </button>
        </div>
      </form>
    </SlideOver>
  );
}
