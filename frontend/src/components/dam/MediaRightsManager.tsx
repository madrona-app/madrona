import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Scale,
  Plus,
  Edit2,
  Trash2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import {
  listMediaRights,
  deleteMediaRights,
  type MediaRightsRecord,
} from '../../lib/api';
import { AddRightsModal } from './AddRightsModal';
import ConfirmDialog from '../ConfirmDialog';
import { formatDateShort } from '@/lib/formatters';

interface MediaRightsManagerProps {
  organizationId: string;
  mediaId: string;
}

const RIGHTS_TYPE_LABELS: Record<string, string> = {
  copyright: 'Copyright',
  license: 'License',
  restriction: 'Restriction',
  permission: 'Permission',
};

const LICENSE_TYPE_LABELS: Record<string, string> = {
  'CC-BY': 'CC Attribution',
  'CC-BY-SA': 'CC Attribution-ShareAlike',
  'CC-BY-NC': 'CC Attribution-NonCommercial',
  'CC-BY-ND': 'CC Attribution-NoDerivs',
  'CC-BY-NC-SA': 'CC Attribution-NonCommercial-ShareAlike',
  'CC-BY-NC-ND': 'CC Attribution-NonCommercial-NoDerivs',
  'CC0': 'CC0 Public Domain',
  'ARR': 'All Rights Reserved',
  'PD': 'Public Domain',
  'custom': 'Custom License',
};

export function MediaRightsManager({ organizationId, mediaId }: MediaRightsManagerProps) {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRights, setEditingRights] = useState<MediaRightsRecord | null>(null);
  const [confirmState, setConfirmState] = useState<{action: () => void; title: string; message: string} | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['media-rights', organizationId, mediaId],
    queryFn: () => listMediaRights(organizationId, mediaId),
  });

  const deleteMutation = useMutation({
    mutationFn: (rightsId: string) => deleteMediaRights(organizationId, mediaId, rightsId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-rights', organizationId, mediaId] });
    },
  });

  const handleDelete = (rights: MediaRightsRecord) => {
    setConfirmState({
      action: () => deleteMutation.mutate(rights.rights_id),
      title: 'Delete Rights Record',
      message: `Delete this ${RIGHTS_TYPE_LABELS[rights.rights_type] || rights.rights_type} record? This cannot be undone.`,
    });
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-16 bg-stone-200 rounded" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-md text-semantic-error flex items-center gap-2">
        <AlertCircle size={16} />
        <span>Failed to load rights records</span>
      </div>
    );
  }

  const rights = data?.rights || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scale size={18} className="text-stone-500" />
          <h3 className="font-medium text-stone-900">Rights Information</h3>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          data-add-rights
          className="px-3 py-1.5 border border-stone-300 rounded-md text-sm text-stone-700 hover:bg-stone-50 flex items-center gap-1 transition-colors"
        >
          <Plus size={14} />
          Add Rights
        </button>
      </div>

      {/* Rights List */}
      {rights.length === 0 ? (
        <div className="p-6 bg-stone-50 rounded-md text-center">
          <Scale size={32} className="mx-auto text-stone-400 mb-2" />
          <p className="text-stone-600 mb-3">No rights information</p>
          <p className="text-sm text-stone-500">
            Add copyright, licensing, or usage restriction information for this media.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rights.map((r) => (
            <div
              key={r.rights_id}
              className={`p-3 border rounded-md ${
                r.is_active ? 'bg-parchment border-lichen' : 'bg-stone/20 border-lichen opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-stone-900">
                      {RIGHTS_TYPE_LABELS[r.rights_type] || r.rights_type}
                    </span>
                    {r.license_type && (
                      <span className="px-2 py-0.5 text-xs bg-semantic-info/10 text-semantic-info rounded">
                        {LICENSE_TYPE_LABELS[r.license_type] || r.license_type}
                      </span>
                    )}
                    {!r.is_active && (
                      <span className="px-2 py-0.5 text-xs bg-stone-200 text-stone-600 rounded">
                        Inactive
                      </span>
                    )}
                  </div>

                  {r.rights_holder && (
                    <div className="mt-1 text-sm text-stone-600">
                      Holder: {r.rights_holder}
                    </div>
                  )}

                  {r.rights_statement && (
                    <p className="mt-1 text-sm text-stone-500">{r.rights_statement}</p>
                  )}

                  <div className="mt-1 flex items-center gap-3 text-sm text-stone-500 flex-wrap">
                    {r.territory && (
                      <span>Territory: {r.territory}</span>
                    )}
                    {r.start_date && (
                      <>
                        <span className="text-stone-300">|</span>
                        <span>From: {formatDateShort(r.start_date)}</span>
                      </>
                    )}
                    {r.end_date && (
                      <>
                        <span className="text-stone-300">|</span>
                        <span
                          className={
                            new Date(r.end_date) < new Date() ? 'text-semantic-error' : ''
                          }
                        >
                          Until: {formatDateShort(r.end_date)}
                        </span>
                      </>
                    )}
                  </div>

                  {r.usage_restrictions && r.usage_restrictions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {r.usage_restrictions.map((restriction, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 text-xs bg-semantic-warning/10 text-semantic-warning rounded"
                        >
                          {restriction}
                        </span>
                      ))}
                    </div>
                  )}

                  {r.license_url && (
                    <a
                      href={r.license_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-sm text-semantic-info hover:underline"
                    >
                      <ExternalLink size={12} />
                      View License
                    </a>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditingRights(r)}
                    className="p-1.5 hover:bg-stone-100 rounded text-stone-600"
                    title="Edit"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(r)}
                    disabled={deleteMutation.isPending}
                    className="p-1.5 hover:bg-stone-100 rounded text-semantic-error"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmText="Confirm"
        confirmStyle="danger"
      />

      {/* Modals */}
      <AddRightsModal
        isOpen={showAddModal}
        organizationId={organizationId}
        mediaId={mediaId}
        onClose={() => setShowAddModal(false)}
      />

      <AddRightsModal
        isOpen={!!editingRights}
        organizationId={organizationId}
        mediaId={mediaId}
        existingRights={editingRights || undefined}
        onClose={() => setEditingRights(null)}
      />
    </div>
  );
}
