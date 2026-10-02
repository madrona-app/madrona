import { useState } from 'react';
import Checkbox from '../Checkbox';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Tags,
  FileText,
  Copyright,
  Plus,
  Check,
  AlertTriangle,
  X,
} from 'lucide-react';
import { batchMediaOperation } from '../../lib/api';
import { SlideOver } from '../ui/SlideOver';

interface BatchMetadataPanelProps {
  organizationId: string;
  selectedMediaIds: string[];
  onClose: () => void;
}

type TabId = 'tags' | 'fields' | 'credits';

export function BatchMetadataPanel({
  organizationId,
  selectedMediaIds,
  onClose,
}: BatchMetadataPanelProps) {
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabId>('tags');
  const [showSuccess, setShowSuccess] = useState(false);

  // Tags tab state
  const [tagsToAdd, setTagsToAdd] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');

  // Fields tab state
  const [applyTitle, setApplyTitle] = useState(false);
  const [titlePrefix, setTitlePrefix] = useState('');
  const [applyDescription, setApplyDescription] = useState(false);
  const [description, setDescription] = useState('');
  const [applyAltText, setApplyAltText] = useState(false);
  const [altText, setAltText] = useState('');

  // Credits tab state
  const [applyCredit, setApplyCredit] = useState(false);
  const [credit, setCredit] = useState('');
  const [applyCopyright, setApplyCopyright] = useState(false);
  const [copyrightNotice, setCopyrightNotice] = useState('');

  // Batch update mutation
  const batchMutation = useMutation({
    mutationFn: async () => {
      // Build updates based on what's enabled
      const updates: Record<string, unknown> = {};

      if (activeTab === 'tags') {
        if (tagsToAdd.length > 0) {
          updates.add_tags = tagsToAdd;
        }
      } else if (activeTab === 'fields') {
        if (applyTitle && titlePrefix) {
          updates.title_prefix = titlePrefix;
        }
        if (applyDescription) {
          updates.description = description;
        }
        if (applyAltText) {
          updates.alt_text = altText;
        }
      } else if (activeTab === 'credits') {
        if (applyCredit) {
          updates.credit = credit;
        }
        if (applyCopyright) {
          updates.copyright_notice = copyrightNotice;
        }
      }

      // Use batch operation API
      return batchMediaOperation(
        organizationId,
        'extract_metadata', // Using this as a general update operation
        selectedMediaIds,
        { metadata_updates: updates }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-library', organizationId] });
      setShowSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1500);
    },
  });

  const handleAddTag = () => {
    if (newTag.trim() && !tagsToAdd.includes(newTag.trim())) {
      setTagsToAdd([...tagsToAdd, newTag.trim()]);
      setNewTag('');
    }
  };

  const handleRemoveFromAdd = (tag: string) => {
    setTagsToAdd(tagsToAdd.filter((t) => t !== tag));
  };

  const hasChanges = () => {
    if (activeTab === 'tags') {
      return tagsToAdd.length > 0;
    } else if (activeTab === 'fields') {
      return (applyTitle && titlePrefix) || applyDescription || applyAltText;
    } else if (activeTab === 'credits') {
      return applyCredit || applyCopyright;
    }
    return false;
  };

  const footer = (
    <div className="flex justify-end gap-3">
      <button
        type="button"
        onClick={onClose}
        className="px-4 py-2 text-sm font-medium text-ink bg-parchment border border-lichen rounded-lg hover:bg-stone/50 transition-colors"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={() => batchMutation.mutate()}
        disabled={!hasChanges() || batchMutation.isPending}
        className="px-4 py-2 text-sm font-medium text-parchment bg-bark rounded-lg hover:bg-copper-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {batchMutation.isPending && <Loader2 size={16} className="animate-spin" />}
        Apply to {selectedMediaIds.length} Items
      </button>
    </div>
  );

  return (
    <SlideOver
      isOpen={true}
      onClose={onClose}
      title="Batch Edit Metadata"
      subtitle={`${selectedMediaIds.length} items selected`}
      width="md"
      footer={!showSuccess ? footer : undefined}
    >
      {/* Success State */}
      {showSuccess ? (
        <div className="py-8 text-center">
          <div className="mx-auto w-16 h-16 bg-semantic-success/10 rounded-full flex items-center justify-center mb-4">
            <Check className="h-8 w-8 text-semantic-success" />
          </div>
          <h3 className="text-lg font-semibold text-forest mb-2">Changes Applied</h3>
          <p className="text-archive">
            Metadata has been updated for {selectedMediaIds.length} items.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Tabs */}
          <div className="flex border-b border-lichen -mx-6 px-6">
            {[
              { id: 'tags' as TabId, label: 'Tags', icon: Tags },
              { id: 'fields' as TabId, label: 'Fields', icon: FileText },
              { id: 'credits' as TabId, label: 'Credits', icon: Copyright },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === tab.id
                    ? 'border-bark text-bark'
                    : 'border-transparent text-archive hover:text-ink'
                }`}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="space-y-6">
            {/* Tags Tab */}
            {activeTab === 'tags' && (
              <>
                {/* Add Tags */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">Add Tags</label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
                      placeholder="Enter tag and press Enter"
                      className="flex-1 px-3 py-2 text-sm border border-lichen rounded-lg bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    />
                    <button
                      type="button"
                      onClick={handleAddTag}
                      className="px-3 py-2 text-archive bg-stone/50 border border-lichen rounded-lg hover:bg-stone transition-colors"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  {tagsToAdd.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {tagsToAdd.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-semantic-success/10 text-semantic-success text-sm rounded"
                        >
                          <Plus size={12} />
                          {tag}
                          <button
                            type="button"
                            onClick={() => handleRemoveFromAdd(tag)}
                            className="hover:text-semantic-success/80"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

              </>
            )}

            {/* Fields Tab */}
            {activeTab === 'fields' && (
              <>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Checkbox
                      id="apply-title"
                      checked={applyTitle}
                      onChange={(e) => setApplyTitle(e.target.checked)}
                    />
                    <label htmlFor="apply-title" className="text-sm font-medium text-ink">
                      Add Title Prefix
                    </label>
                  </div>
                  <input
                    type="text"
                    value={titlePrefix}
                    onChange={(e) => setTitlePrefix(e.target.value)}
                    disabled={!applyTitle}
                    placeholder="e.g., Collection A - "
                    className="w-full px-3 py-2 text-sm border border-lichen rounded-lg bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:bg-stone/30 disabled:text-archive"
                  />
                  <p className="text-xs text-archive mt-1">
                    Prefix will be added to existing titles
                  </p>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Checkbox
                      id="apply-description"
                      checked={applyDescription}
                      onChange={(e) => setApplyDescription(e.target.checked)}
                    />
                    <label htmlFor="apply-description" className="text-sm font-medium text-ink">
                      Set Description
                    </label>
                  </div>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={!applyDescription}
                    rows={3}
                    placeholder="Description for all selected items"
                    className="w-full px-3 py-2 text-sm border border-lichen rounded-lg bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:bg-stone/30 disabled:text-archive resize-none"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Checkbox
                      id="apply-alt"
                      checked={applyAltText}
                      onChange={(e) => setApplyAltText(e.target.checked)}
                    />
                    <label htmlFor="apply-alt" className="text-sm font-medium text-ink">
                      Set Alt Text
                    </label>
                  </div>
                  <input
                    type="text"
                    value={altText}
                    onChange={(e) => setAltText(e.target.value)}
                    disabled={!applyAltText}
                    placeholder="Alt text for accessibility"
                    className="w-full px-3 py-2 text-sm border border-lichen rounded-lg bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:bg-stone/30 disabled:text-archive"
                  />
                </div>
              </>
            )}

            {/* Credits Tab */}
            {activeTab === 'credits' && (
              <>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Checkbox
                      id="apply-credit"
                      checked={applyCredit}
                      onChange={(e) => setApplyCredit(e.target.checked)}
                    />
                    <label htmlFor="apply-credit" className="text-sm font-medium text-ink">
                      Set Credit
                    </label>
                  </div>
                  <input
                    type="text"
                    value={credit}
                    onChange={(e) => setCredit(e.target.value)}
                    disabled={!applyCredit}
                    placeholder="e.g., Photo by John Smith"
                    className="w-full px-3 py-2 text-sm border border-lichen rounded-lg bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:bg-stone/30 disabled:text-archive"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Checkbox
                      id="apply-copyright"
                      checked={applyCopyright}
                      onChange={(e) => setApplyCopyright(e.target.checked)}
                    />
                    <label htmlFor="apply-copyright" className="text-sm font-medium text-ink">
                      Set Copyright Notice
                    </label>
                  </div>
                  <input
                    type="text"
                    value={copyrightNotice}
                    onChange={(e) => setCopyrightNotice(e.target.value)}
                    disabled={!applyCopyright}
                    placeholder="e.g., © 2024 Organization Name"
                    className="w-full px-3 py-2 text-sm border border-lichen rounded-lg bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:bg-stone/30 disabled:text-archive"
                  />
                </div>
              </>
            )}

            {/* Warning */}
            <div className="flex items-start gap-2 p-3 bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg text-sm text-semantic-warning">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <p>
                Changes will be applied to all {selectedMediaIds.length} selected items.
                This action cannot be easily undone.
              </p>
            </div>

            {/* Error */}
            {batchMutation.isError && (
              <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
                {(batchMutation.error as Error)?.message || 'Failed to apply changes'}
              </div>
            )}
          </div>
        </div>
      )}
    </SlideOver>
  );
}
