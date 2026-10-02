import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Share2,
  Copy,
  Check,
  ExternalLink,
  RotateCcw,
  Trash2,
  Lock,
  Download,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import {
  listMyPublicShares,
  rotatePublicShareToken,
  disablePublicSharing,
} from '../../lib/api';

function formatDate(iso: string | null, opts: { relative?: boolean } = {}): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (opts.relative) {
    const diff = d.getTime() - Date.now();
    const days = Math.round(diff / 86_400_000);
    if (Math.abs(days) < 1) return 'today';
    if (days > 0 && days < 30) return `in ${days}d`;
    if (days < 0 && days > -30) return `${-days}d ago`;
  }
  return d.toLocaleDateString();
}

const LEVEL_LABEL: Record<string, string> = {
  none: 'View only',
  derivatives: 'Derivatives',
  originals: 'Originals',
};

/**
 * User-facing index of every public share link they currently own.
 *
 * Surfaces per-row access stats (views / downloads / failed password attempts)
 * so owners can notice unusual activity without digging into each collection.
 */
export default function MyLightboxSharesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['my-shares', orgId],
    queryFn: () => listMyPublicShares(orgId!),
    enabled: !!orgId,
  });

  const rotateMutation = useMutation({
    mutationFn: (collectionId: string) => rotatePublicShareToken(orgId!, collectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-shares', orgId] });
      queryClient.invalidateQueries({ queryKey: ['media-collections', orgId] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (collectionId: string) => disablePublicSharing(orgId!, collectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-shares', orgId] });
      queryClient.invalidateQueries({ queryKey: ['media-collections', orgId] });
    },
  });

  const handleCopy = (token: string) => {
    const url = `${window.location.origin}/share/collection/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(token);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3">
        <div className="p-2 bg-forest/10 rounded-lg">
          <Share2 size={24} className="text-forest" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink">My Shared Links</h1>
          <p className="text-archive text-sm">
            Public share links you've created for lightboxes. Rotate a token to invalidate the old URL; revoke to disable sharing entirely.
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 text-archive py-8">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="p-4 bg-semantic-error/10 border border-semantic-error/30 rounded text-semantic-error flex items-center gap-2">
          <AlertTriangle size={16} />
          Failed to load shares: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      ) : (data?.shares.length ?? 0) === 0 ? (
        <div className="text-center py-16 text-archive">
          <Share2 size={40} className="mx-auto mb-3 opacity-40" />
          <p>You haven't created any public share links yet.</p>
          <p className="text-sm mt-1">
            Open any lightbox and click <span className="font-medium">Share</span> to create one.
          </p>
        </div>
      ) : (
        <div className="border border-lichen rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone/30 text-archive text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Lightbox</th>
                <th className="text-left px-4 py-2">Protections</th>
                <th className="text-left px-4 py-2">Activity</th>
                <th className="text-left px-4 py-2">Expires</th>
                <th className="text-right px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {data!.shares.map((s) => {
                const isExpired =
                  s.public_share_expires_at &&
                  new Date(s.public_share_expires_at).getTime() < Date.now();
                return (
                  <tr key={s.collection_id} className={isExpired ? 'bg-stone/20' : ''}>
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0">
                          <Link
                            to={`/organizations/${orgId}/media/collections/${s.collection_id}`}
                            className="font-medium text-ink hover:text-bark"
                          >
                            {s.name}
                          </Link>
                          <div className="text-xs text-archive">{s.item_count} items</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap gap-1">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-stone/40 text-xs text-archive"
                          title="Download level"
                        >
                          <Download size={10} />
                          {LEVEL_LABEL[s.public_share_download_level] ?? s.public_share_download_level}
                        </span>
                        {s.public_share_has_password && (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-bark/10 text-xs text-bark"
                            title="Password-protected"
                          >
                            <Lock size={10} />
                            Password
                          </span>
                        )}
                        {isExpired && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-semantic-warning/10 text-xs text-semantic-warning">
                            Expired
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="text-xs text-archive space-y-0.5">
                        <div>
                          {s.views} view{s.views === 1 ? '' : 's'}
                          {s.downloads > 0 && <> · {s.downloads} download{s.downloads === 1 ? '' : 's'}</>}
                        </div>
                        {s.failed_auth > 0 && (
                          <div className="text-semantic-warning">
                            {s.failed_auth} failed password attempt{s.failed_auth === 1 ? '' : 's'}
                          </div>
                        )}
                        <div>Last access: {formatDate(s.last_accessed_at)}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-archive">
                      {s.public_share_expires_at
                        ? formatDate(s.public_share_expires_at, { relative: true })
                        : 'Never'}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center justify-end gap-1">
                        {s.public_share_token && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleCopy(s.public_share_token!)}
                              className="p-1.5 rounded hover:bg-stone/40 text-archive hover:text-ink"
                              title="Copy link"
                              aria-label={`Copy share link for ${s.name}`}
                            >
                              {copiedId === s.public_share_token ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                            <a
                              href={`/share/collection/${s.public_share_token}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 rounded hover:bg-stone/40 text-archive hover:text-ink"
                              title="Open in new tab"
                              aria-label={`Open share link for ${s.name}`}
                            >
                              <ExternalLink size={14} />
                            </a>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Rotate token for "${s.name}"? The existing URL will stop working.`)) {
                              rotateMutation.mutate(s.collection_id);
                            }
                          }}
                          disabled={rotateMutation.isPending}
                          className="p-1.5 rounded hover:bg-stone/40 text-archive hover:text-bark disabled:opacity-50"
                          title="Rotate token"
                          aria-label={`Rotate token for ${s.name}`}
                        >
                          <RotateCcw size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Revoke share for "${s.name}"? The public link will be disabled.`)) {
                              revokeMutation.mutate(s.collection_id);
                            }
                          }}
                          disabled={revokeMutation.isPending}
                          className="p-1.5 rounded hover:bg-stone/40 text-archive hover:text-semantic-error disabled:opacity-50"
                          title="Revoke"
                          aria-label={`Revoke share for ${s.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
