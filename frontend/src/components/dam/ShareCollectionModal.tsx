import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Share2,
  Link2,
  Copy,
  Check,
  Users,
  Trash2,
  Shield,
  AlertTriangle,
  RotateCcw,
  Lock,
  Download,
  History,
} from 'lucide-react';
import {
  listCollectionShares,
  removeCollectionShare,
  shareCollection,
  enablePublicSharing,
  disablePublicSharing,
  updatePublicShareSettings,
  rotatePublicShareToken,
  listPublicShareAccessLog,
  checkConsentClearance,
  clearCollectionForPublic,
} from '../../lib/api';
import type { MediaCollection } from '../../lib/schemas';
import { TeamShareSelector } from './TeamShareSelector';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { ModalPortal } from '../ModalPortal';

interface ShareCollectionModalProps {
  organizationId: string;
  collection: MediaCollection;
  onClose: () => void;
}

export function ShareCollectionModal({
  organizationId,
  collection,
  onClose,
}: ShareCollectionModalProps) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  // Draft values for the settings panel. Seeded from the collection; committed
  // via updatePublicShareSettings. Password is separate: empty string = don't
  // change; explicit null = clear.
  const [draftExpiresAt, setDraftExpiresAt] = useState<string>(
    collection.public_share_expires_at ? collection.public_share_expires_at.slice(0, 10) : '',
  );
  const [draftPassword, setDraftPassword] = useState<string>('');
  const [draftLevel, setDraftLevel] = useState<'none' | 'derivatives' | 'originals'>(
    collection.public_share_download_level ?? 'none',
  );
  const [showAccessLog, setShowAccessLog] = useState(false);
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen: true,
    onClose,
    titlePrefix: 'share-collection-modal',
  });

  // Fetch shares
  const { data: sharesData, isLoading: loadingShares } = useQuery({
    queryKey: ['collection-shares', organizationId, collection.collection_id],
    queryFn: () => listCollectionShares(organizationId, collection.collection_id),
  });

  // Fetch consent clearance status
  const { data: clearanceData, isLoading: loadingClearance } = useQuery({
    queryKey: ['collection-consent-clearance', organizationId, collection.collection_id],
    queryFn: () => checkConsentClearance(organizationId, collection.collection_id),
    enabled: collection.consent_clearance_required,
  });

  const enablePublicMutation = useMutation({
    mutationFn: () =>
      enablePublicSharing(organizationId, collection.collection_id, {
        expires_at: draftExpiresAt || null,
        password: draftPassword || null,
        download_level: draftLevel,
      }),
    onSuccess: () => {
      setDraftPassword('');
      queryClient.invalidateQueries({ queryKey: ['media-collections', organizationId] });
    },
  });

  const disablePublicMutation = useMutation({
    mutationFn: () => disablePublicSharing(organizationId, collection.collection_id),
    onSuccess: () => {
      setDraftPassword('');
      setDraftExpiresAt('');
      setDraftLevel('none');
      queryClient.invalidateQueries({ queryKey: ['media-collections', organizationId] });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (changes: {
      expires_at?: string | null;
      password?: string | null;
      download_level?: 'none' | 'derivatives' | 'originals';
    }) => updatePublicShareSettings(organizationId, collection.collection_id, changes),
    onSuccess: () => {
      setDraftPassword('');
      queryClient.invalidateQueries({ queryKey: ['media-collections', organizationId] });
    },
  });

  const rotateTokenMutation = useMutation({
    mutationFn: () => rotatePublicShareToken(organizationId, collection.collection_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-collections', organizationId] });
    },
  });

  // Lazy-fetched access log.
  const { data: accessLogData, isLoading: accessLogLoading, refetch: refetchAccessLog } = useQuery({
    queryKey: ['public-share-access-log', organizationId, collection.collection_id],
    queryFn: () =>
      listPublicShareAccessLog(organizationId, collection.collection_id, { limit: 50 }),
    enabled: showAccessLog && collection.public_share_enabled,
  });

  const clearConsentMutation = useMutation({
    mutationFn: () => clearCollectionForPublic(organizationId, collection.collection_id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['collection-consent-clearance', organizationId, collection.collection_id],
      });
      queryClient.invalidateQueries({ queryKey: ['media-collections', organizationId] });
    },
  });

  const removeShareMutation = useMutation({
    mutationFn: (shareId: string) =>
      removeCollectionShare(organizationId, collection.collection_id, shareId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['collection-shares', organizationId, collection.collection_id],
      });
    },
  });

  const addShareMutation = useMutation({
    mutationFn: (params: {
      principalType: 'user' | 'role';
      principalId: string;
      role: 'viewer' | 'editor';
    }) =>
      shareCollection(organizationId, collection.collection_id, {
        principal_type: params.principalType,
        principal_id: params.principalId,
        role: params.role,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['collection-shares', organizationId, collection.collection_id],
      });
    },
  });

  const handleCopyLink = () => {
    if (collection.public_share_token) {
      const url = `${window.location.origin}/share/collection/${collection.public_share_token}`;
      navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shares = sharesData?.shares || [];
  const canEnablePublic =
    !collection.consent_clearance_required ||
    collection.consent_cleared_at ||
    clearanceData?.is_cleared;

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
            <Share2 size={20} />
            Share Lightbox
          </h2>
        </div>

        <div className="p-6 space-y-6">
          <p id={descriptionId} className="sr-only">
            Share this lightbox via public link or with specific users and roles
          </p>

          {/* Public Link Sharing */}
          <div>
            <h3 className="font-medium text-ink mb-3 flex items-center gap-2">
              <Link2 size={16} />
              Public Link
            </h3>

            {/* Consent Clearance Warning */}
            {collection.consent_clearance_required && !collection.consent_cleared_at && (
              <div className="mb-3">
                {loadingClearance ? (
                  <div className="p-3 bg-stone/30 rounded-sm flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-sm text-ink">Checking consent status...</span>
                  </div>
                ) : clearanceData?.is_cleared ? (
                  <div className="p-3 bg-semantic-success/10 border border-semantic-success/30 rounded-sm">
                    <div className="flex items-center gap-2 text-semantic-success">
                      <Check size={16} />
                      <span className="font-medium">All media have valid consent</span>
                    </div>
                    <button
                      onClick={() => clearConsentMutation.mutate()}
                      disabled={clearConsentMutation.isPending}
                      className="mt-2 px-3 py-1.5 border border-stone rounded-sm bg-parchment text-sm text-ink hover:bg-stone/20 transition-colors flex items-center gap-1"
                    >
                      {clearConsentMutation.isPending ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Shield size={14} />
                      )}
                      Mark as Cleared
                    </button>
                  </div>
                ) : (
                  <div className="p-3 bg-semantic-warning/10 border border-semantic-warning/30 rounded-sm">
                    <div className="flex items-center gap-2 text-semantic-warning mb-2">
                      <AlertTriangle size={16} />
                      <span className="font-medium">Consent clearance required</span>
                    </div>
                    <p className="text-sm text-semantic-warning mb-2">
                      {clearanceData?.media_without_consent?.length || 0} media items need public
                      consent before this lightbox can be shared publicly.
                    </p>
                    {clearanceData?.media_without_consent &&
                      clearanceData.media_without_consent.length > 0 && (
                        <ul className="text-sm text-semantic-warning list-disc list-inside">
                          {clearanceData.media_without_consent.slice(0, 3).map((m) => (
                            <li key={m.media_id}>{m.title || m.filename}</li>
                          ))}
                          {clearanceData.media_without_consent.length > 3 && (
                            <li>...and {clearanceData.media_without_consent.length - 3} more</li>
                          )}
                        </ul>
                      )}
                  </div>
                )}
              </div>
            )}

            {collection.public_share_enabled ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 bg-stone/30 rounded-sm">
                  <input
                    type="text"
                    value={`${window.location.origin}/share/collection/${collection.public_share_token}`}
                    readOnly
                    className="flex-1 bg-transparent text-sm text-ink"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="px-3 py-1.5 border border-stone rounded-sm bg-parchment text-sm text-ink hover:bg-stone/20 transition-colors flex items-center gap-1"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>

                {/* Current settings summary */}
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-stone/30 rounded text-archive">
                    <Download size={12} />
                    {collection.public_share_download_level === 'none'
                      ? 'View only'
                      : collection.public_share_download_level === 'derivatives'
                        ? 'Derivatives'
                        : 'Originals'}
                  </span>
                  {collection.public_share_has_password && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-bark/10 rounded text-bark">
                      <Lock size={12} /> Password set
                    </span>
                  )}
                  {collection.public_share_expires_at && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-stone/30 rounded text-archive">
                      Expires {new Date(collection.public_share_expires_at).toLocaleDateString()}
                    </span>
                  )}
                </div>

                {/* Settings panel */}
                <div className="border border-lichen rounded p-3 space-y-3">
                  <h4 className="text-sm font-medium text-ink">Link settings</h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="text-xs text-archive space-y-1">
                      <span className="block">Expires on</span>
                      <input
                        type="date"
                        value={draftExpiresAt}
                        onChange={(e) => setDraftExpiresAt(e.target.value)}
                        className="w-full px-2 py-1.5 border border-lichen rounded text-sm text-ink bg-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:border-bark"
                      />
                      <span className="text-[10px] text-archive">Leave blank for no expiration</span>
                    </label>

                    <label className="text-xs text-archive space-y-1">
                      <span className="block">Download level</span>
                      <select
                        value={draftLevel}
                        onChange={(e) => setDraftLevel(e.target.value as 'none' | 'derivatives' | 'originals')}
                        className="w-full px-2 py-1.5 border border-lichen rounded text-sm text-ink bg-parchment"
                      >
                        <option value="none">View only</option>
                        <option value="derivatives">Derivatives only</option>
                        <option value="originals">Originals allowed</option>
                      </select>
                    </label>
                  </div>

                  <label className="text-xs text-archive space-y-1 block">
                    <span className="block">Password (optional)</span>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={draftPassword}
                        onChange={(e) => setDraftPassword(e.target.value)}
                        placeholder={collection.public_share_has_password ? '••••••••' : 'Set a password'}
                        className="flex-1 px-2 py-1.5 border border-lichen rounded text-sm text-ink bg-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:border-bark"
                      />
                      {collection.public_share_has_password && (
                        <button
                          type="button"
                          onClick={() => updateSettingsMutation.mutate({ password: null })}
                          disabled={updateSettingsMutation.isPending}
                          className="px-2 py-1 text-xs border border-lichen rounded text-archive hover:bg-stone/30"
                          title="Remove password"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </label>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        updateSettingsMutation.mutate({
                          expires_at: draftExpiresAt || null,
                          download_level: draftLevel,
                          ...(draftPassword ? { password: draftPassword } : {}),
                        })
                      }
                      disabled={updateSettingsMutation.isPending}
                      className="px-3 py-1.5 bg-bark text-parchment rounded text-sm hover:bg-copper-dark disabled:opacity-50 flex items-center gap-1"
                    >
                      {updateSettingsMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                      Save settings
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('Rotate the share token? The existing URL will stop working.')) {
                          rotateTokenMutation.mutate();
                        }
                      }}
                      disabled={rotateTokenMutation.isPending}
                      className="text-xs text-bark hover:text-copper-dark flex items-center gap-1"
                      title="Invalidate the current URL and generate a new one"
                    >
                      <RotateCcw size={12} />
                      Rotate token
                    </button>
                  </div>
                </div>

                {/* Access log */}
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!showAccessLog) refetchAccessLog();
                      setShowAccessLog((v) => !v);
                    }}
                    className="text-xs text-archive hover:text-ink flex items-center gap-1"
                  >
                    <History size={12} />
                    {showAccessLog ? 'Hide access log' : 'View access log'}
                  </button>
                  {showAccessLog && (
                    <div className="mt-2 border border-lichen rounded max-h-60 overflow-auto">
                      {accessLogLoading ? (
                        <div className="p-3 text-sm text-archive flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin" /> Loading…
                        </div>
                      ) : (accessLogData?.entries.length ?? 0) === 0 ? (
                        <div className="p-3 text-sm text-archive italic">No accesses logged yet.</div>
                      ) : (
                        <table className="w-full text-xs">
                          <thead className="bg-stone/30 text-archive">
                            <tr>
                              <th className="text-left px-2 py-1">When</th>
                              <th className="text-left px-2 py-1">Action</th>
                              <th className="text-left px-2 py-1">IP</th>
                            </tr>
                          </thead>
                          <tbody>
                            {accessLogData!.entries.map((e) => (
                              <tr key={e.access_id} className="border-t border-lichen">
                                <td className="px-2 py-1 text-ink whitespace-nowrap">
                                  {e.accessed_at ? new Date(e.accessed_at).toLocaleString() : '—'}
                                </td>
                                <td className="px-2 py-1 text-ink">
                                  {e.action}
                                  {e.action === 'auth' && e.auth_success === false && (
                                    <span className="ml-1 text-semantic-error">(failed)</span>
                                  )}
                                </td>
                                <td className="px-2 py-1 text-archive font-mono">{e.ip_address ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => disablePublicMutation.mutate()}
                  disabled={disablePublicMutation.isPending}
                  className="text-sm text-semantic-error hover:underline"
                >
                  Disable public link
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="text-xs text-archive space-y-1">
                    <span className="block">Expires on (optional)</span>
                    <input
                      type="date"
                      value={draftExpiresAt}
                      onChange={(e) => setDraftExpiresAt(e.target.value)}
                      className="w-full px-2 py-1.5 border border-lichen rounded text-sm text-ink bg-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:border-bark"
                    />
                  </label>
                  <label className="text-xs text-archive space-y-1">
                    <span className="block">Download level</span>
                    <select
                      value={draftLevel}
                      onChange={(e) => setDraftLevel(e.target.value as 'none' | 'derivatives' | 'originals')}
                      className="w-full px-2 py-1.5 border border-lichen rounded text-sm text-ink bg-parchment"
                    >
                      <option value="none">View only</option>
                      <option value="derivatives">Derivatives only</option>
                      <option value="originals">Originals allowed</option>
                    </select>
                  </label>
                </div>
                <label className="text-xs text-archive space-y-1 block">
                  <span className="block">Password (optional)</span>
                  <input
                    type="password"
                    value={draftPassword}
                    onChange={(e) => setDraftPassword(e.target.value)}
                    placeholder="Leave blank for no password"
                    className="w-full px-2 py-1.5 border border-lichen rounded text-sm text-ink bg-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:border-bark"
                  />
                </label>
                <button
                  onClick={() => enablePublicMutation.mutate()}
                  disabled={enablePublicMutation.isPending || !canEnablePublic}
                  className="px-4 py-2 border border-stone rounded-sm bg-parchment text-ink hover:bg-stone/20 transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  {enablePublicMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                  <Link2 size={16} />
                  Create Public Link
                </button>
              </div>
            )}

            {enablePublicMutation.isError && (
              <p className="mt-2 text-sm text-semantic-error">
                {(enablePublicMutation.error as Error)?.message || 'Failed to enable public sharing'}
              </p>
            )}
          </div>

          {/* User/Role Sharing */}
          <div className="border-t border-lichen pt-4">
            <h3 className="font-medium text-ink mb-3 flex items-center gap-2">
              <Users size={16} />
              Share with Users or Roles
            </h3>

            {/* Existing Shares List */}
            {loadingShares ? (
              <div className="flex items-center justify-center p-4">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : shares.length === 0 ? (
              <p className="text-sm text-archive mb-4">Not shared with any users or roles yet.</p>
            ) : (
              <div className="space-y-2 mb-4">
                {shares.map((share) => (
                  <div
                    key={share.share_id}
                    className="flex items-center justify-between p-2 bg-stone/30 rounded-sm"
                  >
                    <div className="flex items-center gap-2">
                      {share.principal_type === 'role' ? (
                        <Shield size={14} className="text-forest" />
                      ) : (
                        <Users size={14} className="text-archive" />
                      )}
                      <div>
                        <p className="font-medium text-sm text-ink">
                          {share.principal_name || share.user_name || share.user_email || share.principal_id || share.user_id}
                        </p>
                        <p className="text-xs text-archive capitalize">
                          {share.principal_type === 'role' ? 'Role' : 'User'} - {share.role}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeShareMutation.mutate(share.share_id)}
                      disabled={removeShareMutation.isPending}
                      className="p-1 hover:bg-stone/50 rounded text-archive hover:text-semantic-error"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Share with TeamShareSelector */}
            <div className="mt-4">
              <TeamShareSelector
                organizationId={organizationId}
                onSelect={(principalType, principalId, _principalName, role) => {
                  addShareMutation.mutate({ principalType, principalId, role });
                }}
                disabled={addShareMutation.isPending}
              />
              {addShareMutation.isError && (
                <p className="mt-2 text-sm text-semantic-error">
                  {(addShareMutation.error as Error)?.message || 'Failed to add share'}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-lichen flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
