import { useState } from 'react';
import Checkbox from '../Checkbox';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, FolderPlus, Lock, Users, Globe } from 'lucide-react';
import { createMediaCollection } from '../../lib/api';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { ModalPortal } from '../ModalPortal';

interface CreateCollectionModalProps {
  organizationId: string;
  onClose: () => void;
  onCreated?: (collectionId: string) => void;
}

const VISIBILITY_OPTIONS = [
  {
    value: 'private',
    label: 'Private',
    description: 'Only you can see this lightbox',
    icon: Lock,
  },
  {
    value: 'org',
    label: 'Organization',
    description: 'All organization members can view',
    icon: Users,
  },
  {
    value: 'public',
    label: 'Public',
    description: 'Anyone with the link can view',
    icon: Globe,
  },
];

export function CreateCollectionModal({
  organizationId,
  onClose,
  onCreated,
}: CreateCollectionModalProps) {
  const queryClient = useQueryClient();
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen: true,
    onClose,
    titlePrefix: 'create-collection-modal',
  });

  const [form, setForm] = useState({
    name: '',
    description: '',
    visibility: 'private',
    consent_clearance_required: true,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createMediaCollection(organizationId, {
        name: form.name,
        description: form.description || undefined,
        visibility: form.visibility as 'private' | 'org' | 'public',
        consent_clearance_required: form.consent_clearance_required,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['media-collections', organizationId] });
      onCreated?.(data.collection_id);
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    createMutation.mutate();
  };

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-lichen">
          <h2 id={titleId} className="text-lg font-semibold text-ink flex items-center gap-2">
            <FolderPlus size={20} />
            Create Lightbox
          </h2>
        </div>

        <form id="create-collection-form" onSubmit={handleSubmit} className="p-6 space-y-4">
          <p id={descriptionId} className="sr-only">
            Create a new lightbox for sharing curated media selections
          </p>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Name <span className="text-semantic-error">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              placeholder="My Lightbox"
              required
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              rows={2}
              placeholder="Optional description..."
            />
          </div>

          {/* Visibility */}
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Visibility</label>
            <div className="space-y-2">
              {VISIBILITY_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <label
                    key={option.value}
                    className={`flex items-start gap-3 p-3 border rounded-sm cursor-pointer transition-colors ${
                      form.visibility === option.value
                        ? 'border-bark bg-bark/5'
                        : 'border-lichen hover:bg-stone/20'
                    }`}
                  >
                    <input
                      type="radio"
                      name="visibility"
                      value={option.value}
                      checked={form.visibility === option.value}
                      onChange={(e) => setForm({ ...form, visibility: e.target.value })}
                      className="mt-1"
                    />
                    <Icon size={18} className="mt-0.5 text-archive" />
                    <div>
                      <div className="font-medium text-ink">{option.label}</div>
                      <div className="text-sm text-archive">{option.description}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Consent Clearance */}
          {form.visibility === 'public' && (
            <div className="p-3 bg-semantic-warning/10 border border-semantic-warning/30 rounded-sm">
              <label className="flex items-start gap-3">
                <Checkbox
                  checked={form.consent_clearance_required}
                  onChange={(e) =>
                    setForm({ ...form, consent_clearance_required: e.target.checked })
                  }
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-semantic-warning">Require Consent Clearance</div>
                  <div className="text-sm text-semantic-warning">
                    All media must have valid public consent before the lightbox can be shared
                    publicly.
                  </div>
                </div>
              </label>
            </div>
          )}

          {/* Error */}
          {createMutation.isError && (
            <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-semantic-error text-sm">
              {(createMutation.error as Error)?.message || 'Failed to create lightbox'}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-stone rounded-sm bg-parchment text-ink hover:bg-stone/20 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="create-collection-form"
            disabled={createMutation.isPending || !form.name.trim()}
            className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {createMutation.isPending && <Loader2 size={16} className="animate-spin" />}
            Create Lightbox
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
