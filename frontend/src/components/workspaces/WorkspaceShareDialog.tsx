/**
 * WorkspaceShareDialog - Share a workspace with other users
 *
 * Allows users to:
 * - Search for organization members
 * - Share workspace with selected users
 * - Set permission levels (view, edit, execute, admin)
 * - View and manage existing shares
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Search, UserPlus, Users, Trash2, Check, ChevronDown } from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { cn } from '../../lib/utils';
import {
  getOrganizationUsers,
  listWorkspaceShares,
  createWorkspaceShare,
  deleteWorkspaceShare,
  type OrganizationUser,
} from '../../lib/api';
import type { WorkspaceShare } from '../../lib/schemas';
import { MadronaLoader } from '../ui/MadronaLoader';
import { ModalPortal } from '../ModalPortal';

interface WorkspaceShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  workspaceName: string;
  ownerId: string; // The workspace owner's user_id
}

type PermissionLevel = 'view' | 'edit' | 'execute' | 'admin';

const permissionLabels: Record<PermissionLevel, { label: string; description: string }> = {
  view: { label: 'View', description: 'Can view workspace and objects' },
  edit: { label: 'Edit', description: 'Can add/remove objects' },
  execute: { label: 'Execute', description: 'Can run bulk actions' },
  admin: { label: 'Admin', description: 'Full control including sharing' },
};

export default function WorkspaceShareDialog({
  isOpen,
  onClose,
  workspaceId,
  workspaceName,
  ownerId,
}: WorkspaceShareDialogProps) {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;
  const queryClient = useQueryClient();

  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'workspace-share-dialog',
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<OrganizationUser | null>(null);
  const [selectedPermission, setSelectedPermission] = useState<PermissionLevel>('view');
  const [showPermissionDropdown, setShowPermissionDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const permissionButtonRef = useRef<HTMLButtonElement>(null);

  // Calculate dropdown position when showing
  useEffect(() => {
    if (showPermissionDropdown && permissionButtonRef.current) {
      const rect = permissionButtonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.right - 192, // 192px = w-48
      });
    }
  }, [showPermissionDropdown]);

  // Fetch organization users
  const { data: usersData, isLoading: isLoadingUsers } = useQuery({
    queryKey: ['organization-users', orgId],
    queryFn: () => getOrganizationUsers(orgId!),
    enabled: !!orgId && isOpen,
  });

  // Fetch existing shares
  const { data: sharesData, isLoading: isLoadingShares } = useQuery({
    queryKey: ['workspace-shares', orgId, workspaceId],
    queryFn: () => listWorkspaceShares(orgId!, workspaceId),
    enabled: !!orgId && isOpen,
  });

  // Create share mutation
  const createShareMutation = useMutation({
    mutationFn: ({ userId, permission }: { userId: string; permission: PermissionLevel }) =>
      createWorkspaceShare(orgId!, workspaceId, userId, permission),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-shares', orgId, workspaceId] });
      setSelectedUser(null);
      setSearchQuery('');
      setError(null);
      if (result.updated) {
        setSuccessMessage('Permission updated successfully');
      } else {
        setSuccessMessage('Workspace shared successfully');
      }
      setTimeout(() => setSuccessMessage(null), 3000);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to share workspace');
    },
  });

  // Delete share mutation
  const deleteShareMutation = useMutation({
    mutationFn: (shareId: string) => deleteWorkspaceShare(orgId!, workspaceId, shareId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-shares', orgId, workspaceId] });
      setSuccessMessage('Share removed');
      setTimeout(() => setSuccessMessage(null), 3000);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to remove share');
    },
  });

  // Filter users based on search and exclude owner and already shared users
  const filteredUsers = useMemo(() => {
    if (!usersData?.users) return [];

    const existingShareUserIds = new Set(
      sharesData?.shares
        ?.filter((s) => s.principal_type === 'user')
        .map((s) => s.principal_id) || []
    );

    return usersData.users.filter((user) => {
      // Exclude owner
      if (user.user_id === ownerId) return false;
      // Exclude already shared users
      if (existingShareUserIds.has(user.user_id)) return false;
      // Filter by search
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          user.email.toLowerCase().includes(query) ||
          (user.name && user.name.toLowerCase().includes(query))
        );
      }
      return true;
    });
  }, [usersData?.users, sharesData?.shares, ownerId, searchQuery]);

  const handleShare = () => {
    if (!selectedUser) return;
    createShareMutation.mutate({
      userId: selectedUser.user_id,
      permission: selectedPermission,
    });
  };

  const handleRemoveShare = (shareId: string) => {
    deleteShareMutation.mutate(shareId);
  };

  const handleClose = () => {
    setSearchQuery('');
    setSelectedUser(null);
    setSelectedPermission('view');
    setError(null);
    setSuccessMessage(null);
    onClose();
  };

  if (!isOpen) return null;

  const existingShares = sharesData?.shares || [];

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={handleClose}
    >
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        onClick={(e) => e.stopPropagation()}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center justify-between">
            <div>
              <h2 id={titleId} className="text-lg font-semibold text-ink">Share Workspace</h2>
              <p id={descriptionId} className="text-sm text-archive">{workspaceName}</p>
            </div>
            <button
              onClick={handleClose}
              className="p-1 text-archive hover:text-ink rounded"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Messages */}
          {error && (
            <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-sm text-semantic-error">
              {error}
            </div>
          )}
          {successMessage && (
            <div className="p-3 bg-semantic-success/10 border border-semantic-success/30 rounded-sm text-sm text-semantic-success">
              {successMessage}
            </div>
          )}

          {/* Add new share section */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-ink mb-1">
              Add people
            </label>

            {/* User search */}
            <div className="flex gap-2 mb-3">
              <div className="relative flex-1">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-archive"
                />
                <input
                  type="text"
                  placeholder="Search by name or email..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSelectedUser(null);
                  }}
                  className="w-full pl-9 pr-4 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>

              {/* Permission dropdown */}
              <div className="relative">
                <button
                  ref={permissionButtonRef}
                  onClick={() => setShowPermissionDropdown(!showPermissionDropdown)}
                  className="flex items-center gap-1 px-3 py-2 border border-lichen rounded-sm text-sm hover:border-bark/30"
                >
                  {permissionLabels[selectedPermission].label}
                  <ChevronDown size={14} />
                </button>
                {showPermissionDropdown && (
                  <>
                    <div
                      className="fixed inset-0 z-[1010]"
                      onClick={() => setShowPermissionDropdown(false)}
                    />
                    <div
                      className="fixed w-48 bg-parchment border border-lichen rounded-sm shadow-lg z-[1020]"
                      style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
                    >
                      {(Object.keys(permissionLabels) as PermissionLevel[]).map((perm) => (
                        <button
                          key={perm}
                          onClick={() => {
                            setSelectedPermission(perm);
                            setShowPermissionDropdown(false);
                          }}
                          className={cn(
                            'w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-stone/50',
                            selectedPermission === perm && 'bg-bark/5'
                          )}
                        >
                          <div>
                            <div className="font-medium text-ink">{permissionLabels[perm].label}</div>
                            <div className="text-xs text-archive">
                              {permissionLabels[perm].description}
                            </div>
                          </div>
                          {selectedPermission === perm && (
                            <Check size={14} className="text-bark" />
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* User suggestions dropdown */}
            {searchQuery && !selectedUser && (
              <div className="border border-lichen rounded-sm max-h-48 overflow-y-auto">
                {isLoadingUsers ? (
                  <MadronaLoader variant="dots" />
                ) : filteredUsers.length === 0 ? (
                  <div className="p-3 text-sm text-archive text-center">
                    No users found
                  </div>
                ) : (
                  filteredUsers.slice(0, 10).map((user) => (
                    <button
                      key={user.user_id}
                      onClick={() => {
                        setSelectedUser(user);
                        setSearchQuery(user.email);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-stone/50"
                    >
                      <div className="w-8 h-8 rounded-full bg-bark/10 flex items-center justify-center">
                        <span className="text-xs font-medium text-bark">
                          {(user.name || user.email).charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-ink truncate">
                          {user.name || user.email}
                        </div>
                        {user.name && (
                          <div className="text-xs text-archive truncate">{user.email}</div>
                        )}
                      </div>
                      <div className="text-xs text-archive">{user.role_display_name}</div>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Selected user preview */}
            {selectedUser && (
              <div className="flex items-center gap-3 p-3 bg-bark/5 rounded-sm">
                <div className="w-8 h-8 rounded-full bg-bark/10 flex items-center justify-center">
                  <span className="text-xs font-medium text-bark">
                    {(selectedUser.name || selectedUser.email).charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">
                    {selectedUser.name || selectedUser.email}
                  </div>
                  {selectedUser.name && (
                    <div className="text-xs text-archive truncate">{selectedUser.email}</div>
                  )}
                </div>
                <button
                  onClick={() => {
                    setSelectedUser(null);
                    setSearchQuery('');
                  }}
                  className="p-1 text-archive hover:text-ink"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Share button */}
            {selectedUser && (
              <button
                onClick={handleShare}
                disabled={createShareMutation.isPending}
                className="mt-3 flex items-center justify-center gap-2 w-full px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50"
              >
                <UserPlus size={16} />
                {createShareMutation.isPending ? 'Sharing...' : 'Share'}
              </button>
            )}
          </div>

          {/* Existing shares */}
          <div className="flex-1 overflow-y-auto">
            <div className="flex items-center gap-2 mb-3">
              <Users size={16} className="text-archive" />
              <span className="text-sm font-medium text-ink">
                People with access ({existingShares.length})
              </span>
            </div>

            {isLoadingShares ? (
              <MadronaLoader variant="dots" />
            ) : existingShares.length === 0 ? (
              <div className="text-sm text-archive text-center py-4">
                This workspace is not shared with anyone yet.
              </div>
            ) : (
              <div className="space-y-2">
                {existingShares.map((share: WorkspaceShare) => (
                  <div
                    key={share.share_id}
                    className="flex items-center gap-3 p-3 border border-lichen rounded-sm"
                  >
                    <div className="w-8 h-8 rounded-full bg-bark/10 flex items-center justify-center">
                      <span className="text-xs font-medium text-bark">
                        {(share.principal_name || share.principal_email || 'U')
                          .charAt(0)
                          .toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink truncate">
                        {share.principal_name || share.principal_email || 'Unknown user'}
                      </div>
                      {share.principal_name && share.principal_email && (
                        <div className="text-xs text-archive truncate">
                          {share.principal_email}
                        </div>
                      )}
                    </div>
                    <span className="text-xs px-2 py-1 bg-stone/50 rounded text-archive">
                      {permissionLabels[share.permission as PermissionLevel]?.label ||
                        share.permission}
                    </span>
                    <button
                      onClick={() => handleRemoveShare(share.share_id)}
                      disabled={deleteShareMutation.isPending}
                      className="p-1 text-archive hover:text-semantic-error"
                      title="Remove access"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-archive hover:text-ink transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
