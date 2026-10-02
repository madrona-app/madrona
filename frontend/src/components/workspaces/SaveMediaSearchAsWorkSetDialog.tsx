/**
 * SaveMediaSearchAsWorkSetDialog
 *
 * Parallel to SaveSearchAsWorkSetDialog (collections) but builds a
 * MediaSearchRequest-shaped dynamic_query for a media workset.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Layers, Search, Filter, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useOrganization } from '../../contexts/useOrganization';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { createWorkspace } from '../../lib/api';
import { formatNumber } from '../../lib/formatters';
import { ModalPortal } from '../ModalPortal';

export interface MediaSavedQueryFilters {
  media_type?: string;
  processing_status?: string;
  ai_processing_status?: string;
  is_published?: boolean;
  color_key?: string;
  tag_filters?: Array<{ key: string; value: string }>;
}

interface SaveMediaSearchAsWorkSetDialogProps {
  isOpen: boolean;
  onClose: () => void;
  searchQuery?: string;
  filters?: MediaSavedQueryFilters;
  resultCount?: number;
}

export default function SaveMediaSearchAsWorkSetDialog({
  isOpen,
  onClose,
  searchQuery,
  filters,
  resultCount,
}: SaveMediaSearchAsWorkSetDialogProps) {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'save-media-search-dialog',
  });

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [createdWorkspaceId, setCreatedWorkspaceId] = useState<string | null>(null);

  // Build the dynamic_query matching MediaSearchRequest shape (flat,
  // unlike the collections version which nests under `query` and `filters`).
  const dynamicQuery: Record<string, unknown> = {};
  if (searchQuery) dynamicQuery.query = searchQuery;
  if (filters?.media_type) dynamicQuery.media_type = filters.media_type;
  if (filters?.processing_status) dynamicQuery.processing_status = filters.processing_status;
  if (filters?.ai_processing_status) dynamicQuery.ai_processing_status = filters.ai_processing_status;
  if (filters?.is_published !== undefined) dynamicQuery.is_published = filters.is_published;
  if (filters?.color_key) dynamicQuery.color_key = filters.color_key;
  if (filters?.tag_filters?.length) dynamicQuery.tag_filters = filters.tag_filters;

  // Human-readable query summary
  const querySummary: string[] = [];
  if (searchQuery) querySummary.push(`Search: "${searchQuery}"`);
  if (filters?.media_type) querySummary.push(`Type: ${filters.media_type}`);
  if (filters?.processing_status) querySummary.push(`Processing: ${filters.processing_status}`);
  if (filters?.ai_processing_status) querySummary.push(`AI: ${filters.ai_processing_status}`);
  if (filters?.is_published === true) querySummary.push('Published');
  if (filters?.is_published === false) querySummary.push('Unpublished');
  if (filters?.color_key) querySummary.push(`Color: ${filters.color_key}`);
  if (filters?.tag_filters?.length) {
    querySummary.push(
      `Tags: ${filters.tag_filters.map((t) => `${t.key}=${t.value}`).join(', ')}`,
    );
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createWorkspace(orgId!, {
        name: name.trim(),
        workspace_type: 'media',
        is_dynamic: true,
        dynamic_query: dynamicQuery,
      }),
    onSuccess: (data) => {
      setError(null);
      setCreatedWorkspaceId(data.workspace_id);
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['media-workspaces'] });
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create work set');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    createMutation.mutate();
  };

  const handleClose = () => {
    setName('');
    setError(null);
    setCreatedWorkspaceId(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="fixed inset-0 bg-ink/40" onClick={handleClose} />
        <div
          ref={modalRef}
          {...getModalAriaProps(titleId)}
          className="relative bg-parchment rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-lichen">
            <div className="flex items-center gap-2">
              <Layers size={20} className="text-bark" />
              <h2 id={titleId} className="text-lg font-semibold text-ink">
                Save as Work Set
              </h2>
            </div>
            <button
              onClick={handleClose}
              className="p-1 rounded hover:bg-stone/50 text-archive"
            >
              <X size={18} />
            </button>
          </div>

          {/* Success state */}
          {createdWorkspaceId ? (
            <div className="p-6 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-semantic-success/10 flex items-center justify-center mb-4">
                <Check size={24} className="text-semantic-success" />
              </div>
              <h3 className="text-lg font-medium text-ink mb-2">Work Set Created</h3>
              <p className="text-sm text-archive mb-6">
                Your dynamic media work set will automatically update when search results change.
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/30 text-ink"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    handleClose();
                    navigate(`/organizations/${orgId}/media/work/workspaces/${createdWorkspaceId}`);
                  }}
                  className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark"
                >
                  View Work Set
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="p-4 space-y-4">
                {/* Name input */}
                <div>
                  <label htmlFor="media-workset-name" className="block text-sm font-medium text-ink mb-1">
                    Work Set Name
                  </label>
                  <input
                    id="media-workset-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Website hero images"
                    className="input w-full"
                    autoFocus
                  />
                </div>

                {/* Query summary */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Saved Search
                  </label>
                  <div className="bg-stone/20 border border-lichen rounded-lg p-3 space-y-1.5">
                    {querySummary.length > 0 ? (
                      querySummary.map((line, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm text-archive">
                          {line.startsWith('Search:') ? (
                            <Search size={14} className="text-bark flex-shrink-0" />
                          ) : (
                            <Filter size={14} className="text-bark flex-shrink-0" />
                          )}
                          <span>{line}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-archive">All media (no filters)</div>
                    )}
                    {resultCount !== undefined && (
                      <div className="text-xs text-archive pt-1 border-t border-lichen/50">
                        Currently {formatNumber(resultCount)} matching items
                      </div>
                    )}
                  </div>
                </div>

                {/* Info note */}
                <p className="text-xs text-archive">
                  This work set will stay in sync with your search — results update automatically as media
                  is added, modified, or removed. You can also pin specific items to always appear at the top.
                </p>

                {error && (
                  <div className="text-sm text-semantic-error bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-2">
                    {error}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 p-4 border-t border-lichen">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/30 text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!name.trim() || createMutation.isPending}
                  className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create Work Set'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
