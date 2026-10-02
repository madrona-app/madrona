import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Plus,
  User,
  Edit2,
  Trash2,
  Loader2,
  AlertCircle,
  MoreVertical,
  CheckCircle,
} from 'lucide-react';
import {
  getObjectAuthorities,
  unlinkObjectAuthority,
} from '../../../lib/api';
import type { ObjectPersonAuthority } from '../../../lib/schemas';
import type { ObjectAuthoritiesManagerProps } from './types';
import { ROLE_LABELS, ROLE_ORDER } from './constants';
import { AddAuthoritySlideOver } from './AddAuthoritySlideOver';
import { EditAuthoritySlideOver } from './EditAuthoritySlideOver';
import ConfirmDialog from '../../ConfirmDialog';

export function ObjectAuthoritiesManager({
  organizationId,
  objectId,
  readOnly = false,
  embedded = false,
}: ObjectAuthoritiesManagerProps) {
  const queryClient = useQueryClient();
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [editingLink, setEditingLink] = useState<ObjectPersonAuthority | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{action: () => void; title: string; message: string} | null>(null);

  const {
    data: authorities,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['object-authorities', organizationId, objectId],
    queryFn: () => getObjectAuthorities(organizationId, objectId),
    enabled: !!organizationId && !!objectId,
  });

  const unlinkMutation = useMutation({
    mutationFn: (linkId: string) => unlinkObjectAuthority(organizationId, objectId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-authorities', organizationId, objectId] });
    },
  });

  const handleUnlink = (link: ObjectPersonAuthority) => {
    setConfirmState({
      action: () => unlinkMutation.mutate(link.link_id),
      title: 'Remove Biography',
      message: `Remove ${link.authority?.preferred_name || 'this biography'} from this object?`,
    });
    setActiveMenu(null);
  };

  // Group authorities by role
  const authoritiesByRole: Record<string, ObjectPersonAuthority[]> = {};
  (authorities || []).forEach((link: ObjectPersonAuthority) => {
    if (!authoritiesByRole[link.role]) {
      authoritiesByRole[link.role] = [];
    }
    authoritiesByRole[link.role].push(link);
  });

  if (isLoading) {
    if (embedded) {
      return (
        <div className="flex items-center justify-center py-4">
          <Loader2 size={24} className="animate-spin text-archive" />
        </div>
      );
    }
    return (
      <div className="card">
        <div className="p-4 border-b border-lichen flex items-center justify-between">
          <h3 className="font-serif font-medium text-forest">Biographies</h3>
        </div>
        <div className="p-6 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-archive" />
        </div>
      </div>
    );
  }

  if (error) {
    if (embedded) {
      return (
        <div className="flex items-center gap-2 text-sm text-archive">
          <AlertCircle size={16} />
          <span>Failed to load biographies</span>
        </div>
      );
    }
    return (
      <div className="card">
        <div className="p-4 border-b border-lichen">
          <h3 className="font-serif font-medium text-forest">Biographies</h3>
        </div>
        <div className="p-6">
          <div className="flex items-center gap-2 text-sm text-archive">
            <AlertCircle size={16} />
            <span>Failed to load biographies</span>
          </div>
        </div>
      </div>
    );
  }

  const totalAuthorities = authorities?.length || 0;

  const content = (
    <>
      {totalAuthorities === 0 ? (
        <div className="text-center py-6">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-stone/50 flex items-center justify-center">
            <User size={24} className="text-archive/50" />
          </div>
          <p className="text-sm text-archive mb-3">No biographies linked yet</p>
          {!readOnly && (
            <button
              onClick={() => setShowAddPanel(true)}
              className="text-sm text-bark hover:text-copper-dark flex items-center gap-1.5 mx-auto"
            >
              <Plus size={14} />
              Add Biography
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {ROLE_ORDER.map((role) => {
            const roleAuthorities = authoritiesByRole[role];
            if (!roleAuthorities || roleAuthorities.length === 0) return null;

            return (
              <div key={role}>
                <h4 className="text-xs font-medium text-archive uppercase tracking-wide mb-2">
                  {ROLE_LABELS[role] || role}
                </h4>
                <div className="space-y-2">
                  {roleAuthorities.map((link) => (
                    <div
                      key={link.link_id}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-stone/30 group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <User size={16} className="text-archive shrink-0" />
                        <div className="min-w-0">
                          <Link
                            to={`/organizations/${organizationId}/collections/authorities/${link.authority_id}`}
                            className="text-sm font-medium text-ink hover:text-bark truncate block"
                          >
                            {link.display_name_override || link.authority?.preferred_name || 'Unknown'}
                          </Link>
                          <div className="flex items-center gap-2 text-xs text-archive">
                            {link.role_qualifier && <span>{link.role_qualifier}</span>}
                            {link.attribution_certainty && link.attribution_certainty !== 'certain' && (
                              <span>({link.attribution_certainty})</span>
                            )}
                            {link.authority?.is_verified && (
                              <span className="flex items-center gap-0.5 text-forest">
                                <CheckCircle size={10} />
                                Verified
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {!readOnly && (
                        <div className="relative">
                          <button
                            onClick={() => setActiveMenu(activeMenu === link.link_id ? null : link.link_id)}
                            className="p-1 text-archive hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <MoreVertical size={16} />
                          </button>

                          {activeMenu === link.link_id && (
                            <div className="absolute right-0 top-full mt-1 bg-parchment border border-lichen rounded-institutional shadow-lg z-10 py-1 min-w-[120px]">
                              <button
                                onClick={() => {
                                  setEditingLink(link);
                                  setActiveMenu(null);
                                }}
                                className="w-full text-left px-3 py-1.5 text-sm hover:bg-stone/50 flex items-center gap-2"
                              >
                                <Edit2 size={14} />
                                Edit
                              </button>
                              <button
                                onClick={() => handleUnlink(link)}
                                className="w-full text-left px-3 py-1.5 text-sm hover:bg-stone/50 text-semantic-error flex items-center gap-2"
                              >
                                <Trash2 size={14} />
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Authority SlideOver */}
      <AddAuthoritySlideOver
        isOpen={showAddPanel}
        organizationId={organizationId}
        objectId={objectId}
        onClose={() => setShowAddPanel(false)}
        onSuccess={() => {
          setShowAddPanel(false);
          queryClient.invalidateQueries({ queryKey: ['object-authorities', organizationId, objectId] });
        }}
      />

      {/* Edit Authority SlideOver */}
      <EditAuthoritySlideOver
        isOpen={!!editingLink}
        organizationId={organizationId}
        objectId={objectId}
        link={editingLink}
        onClose={() => setEditingLink(null)}
        onSuccess={() => {
          setEditingLink(null);
          queryClient.invalidateQueries({ queryKey: ['object-authorities', organizationId, objectId] });
        }}
      />

      <ConfirmDialog
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmText="Confirm"
        confirmStyle="danger"
      />
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="card">
      <div className="p-4 border-b border-lichen flex items-center justify-between">
        <h3 className="font-serif font-medium text-forest">Biographies</h3>
        {!readOnly && (
          <button
            onClick={() => setShowAddPanel(true)}
            className="btn btn-tertiary text-sm flex items-center gap-1"
          >
            <Plus size={14} />
            Link Biography
          </button>
        )}
      </div>
      <div className="p-4">
        {content}
      </div>
    </div>
  );
}

export default ObjectAuthoritiesManager;
