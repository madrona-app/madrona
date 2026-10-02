/**
 * SaveSearchAsWorkSetDialog - Save the current search as a dynamic Work Set
 *
 * Takes the current search query and filters, lets the user name the work set,
 * and creates a dynamic workspace backed by the saved search.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Layers, Search, Filter, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useOrganization } from '../../contexts/useOrganization';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { createWorkspace } from '../../lib/api';
import type { CollectionsSearchFilters } from '../../lib/schemas';
import { formatNumber } from '../../lib/formatters';
import { ModalPortal } from '../ModalPortal';

interface SaveSearchAsWorkSetDialogProps {
  isOpen: boolean;
  onClose: () => void;
  searchQuery?: string;
  filters?: CollectionsSearchFilters;
  resultCount?: number;
}

export default function SaveSearchAsWorkSetDialog({
  isOpen,
  onClose,
  searchQuery,
  filters,
  resultCount,
}: SaveSearchAsWorkSetDialogProps) {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'save-search-dialog',
  });

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [createdWorkspaceId, setCreatedWorkspaceId] = useState<string | null>(null);

  // Build the dynamic_query from current search state
  const dynamicQuery: Record<string, unknown> = {};
  if (searchQuery) {
    dynamicQuery.query = { q: searchQuery };
  }
  if (filters && Object.keys(filters).length > 0) {
    dynamicQuery.filters = filters;
  }

  // Build a human-readable summary of the query
  const querySummary: string[] = [];
  if (searchQuery) {
    querySummary.push(`Search: "${searchQuery}"`);
  }
  if (filters) {
    if (filters.object_type?.length) querySummary.push(`Type: ${filters.object_type.join(', ')}`);
    if (filters.classification?.length) querySummary.push(`Classification: ${filters.classification.join(', ')}`);
    if (filters.object_status?.length) querySummary.push(`Status: ${filters.object_status.join(', ')}`);
    if (filters.creator_name) querySummary.push(`Creator: ${filters.creator_name}`);
    if (filters.material) querySummary.push(`Material: ${filters.material}`);
    if (filters.on_display === true) querySummary.push('On display');
    if (filters.on_display === false) querySummary.push('In storage');
    if (filters.has_images === true) querySummary.push('Has images');
    if (filters.has_images === false) querySummary.push('No images');
    if (filters.is_discoverable === true) querySummary.push('Discoverable');
    if (filters.date_from || filters.date_to) {
      querySummary.push(`Date: ${filters.date_from || '...'} – ${filters.date_to || '...'}`);
    }
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createWorkspace(orgId!, {
        name: name.trim(),
        workspace_type: 'collections',
        is_dynamic: true,
        dynamic_query: dynamicQuery,
      }),
    onSuccess: (data) => {
      setError(null);
      setCreatedWorkspaceId(data.workspace_id);
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
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
              Your dynamic work set will automatically update when search results change.
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
                  navigate(`/organizations/${orgId}/collections/work/workspaces/${createdWorkspaceId}`);
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
                <label htmlFor="workset-name" className="block text-sm font-medium text-ink mb-1">
                  Work Set Name
                </label>
                <input
                  id="workset-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Paintings needing conservation"
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
                    <div className="text-sm text-archive">All objects (no filters)</div>
                  )}
                  {resultCount !== undefined && (
                    <div className="text-xs text-archive pt-1 border-t border-lichen/50">
                      Currently {formatNumber(resultCount)} matching objects
                    </div>
                  )}
                </div>
              </div>

              {/* Info note */}
              <p className="text-xs text-archive">
                This work set will stay in sync with your search — results update automatically as objects are added, modified, or removed.
                You can also pin specific objects to always appear at the top.
              </p>

              {/* Error */}
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
