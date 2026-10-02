import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock, Download, Loader2, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import {
  getPublicCollection,
  getPublicCollectionDownloadUrl,
} from '../../lib/api';
import { ApiError } from '../../lib/apiClient';
import { logger } from '@/lib/logger';

const PASSWORD_STORAGE_PREFIX = 'madrona.publicShare.pwd:';

/**
 * Public, unauthenticated view of a shared lightbox.
 *
 * Handles three states beyond the happy path:
 *   - 410 → link has expired
 *   - 401 → password required; prompt + retry
 *   - 404 → token unknown or share disabled
 *
 * Password (when entered) is cached in sessionStorage under the token so
 * subsequent requests (e.g. downloads) don't re-challenge within the session.
 */
export default function PublicCollectionPage() {
  const { token } = useParams<{ token: string }>();
  const storageKey = token ? `${PASSWORD_STORAGE_PREFIX}${token}` : '';
  const [password, setPassword] = useState<string>(() => {
    if (!storageKey) return '';
    try {
      return sessionStorage.getItem(storageKey) || '';
    } catch {
      return '';
    }
  });
  const [passwordAttempt, setPasswordAttempt] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['public-collection', token, password],
    queryFn: () => getPublicCollection(token!, password || undefined),
    enabled: !!token,
    retry: false,
  });

  // Persist validated passwords so download requests can reuse them.
  useEffect(() => {
    if (!storageKey || !password) return;
    try {
      sessionStorage.setItem(storageKey, password);
    } catch {
      /* storage disabled */
    }
  }, [storageKey, password]);

  if (!token) {
    return <StatusScreen title="Invalid link" message="No share token provided." tone="error" />;
  }

  if (isLoading) {
    return (
      <StatusScreen
        title="Loading…"
        message=""
        icon={<Loader2 size={32} className="animate-spin" />}
      />
    );
  }

  // 410 — expired
  if (error instanceof ApiError && error.status === 410) {
    return (
      <StatusScreen
        title="Link expired"
        message="This share link is no longer valid. Please contact the sender for a new link."
        tone="error"
      />
    );
  }

  // 401 — password required
  if (error instanceof ApiError && error.status === 401) {
    return (
      <PasswordChallenge
        attempt={passwordAttempt}
        setAttempt={setPasswordAttempt}
        error={passwordError}
        onSubmit={() => {
          setPassword(passwordAttempt);
          setPasswordError(null);
          // The query refetch runs automatically because `password` is part
          // of queryKey; but if the same bad password is tried twice, force
          // the retry so we surface the latest error.
          refetch().then((r) => {
            if (r.error instanceof ApiError && r.error.status === 401) {
              setPasswordError('Incorrect password');
            }
          });
        }}
      />
    );
  }

  if (error instanceof ApiError && error.status === 404) {
    return (
      <StatusScreen
        title="Not found"
        message="This link is no longer available."
        tone="error"
      />
    );
  }

  if (error || !data) {
    return (
      <StatusScreen
        title="Something went wrong"
        message={error instanceof Error ? error.message : 'Unknown error'}
        tone="error"
      />
    );
  }

  const { collection, items } = data;
  const level = collection.public_share_download_level ?? 'none';
  const canDownload = level !== 'none';

  const handleDownload = async (mediaId: string) => {
    try {
      const resp = await getPublicCollectionDownloadUrl(
        token,
        mediaId,
        level === 'originals' ? 'original' : 'medium',
        password || undefined,
      );
      window.open(resp.url, '_blank', 'noopener');
    } catch (e) {
      logger.error('Download failed', e);
      alert('Download failed. The link may have expired.');
    }
  };

  return (
    <div className="min-h-screen bg-parchment text-ink">
      <header className="border-b border-lichen bg-parchment">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <h1 className="text-2xl font-semibold text-ink">{collection.name}</h1>
          {collection.description && (
            <p className="mt-1 text-archive">{collection.description}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-archive">
            <span>{items.length} items</span>
            {collection.public_share_expires_at && (
              <span>· Expires {new Date(collection.public_share_expires_at).toLocaleDateString()}</span>
            )}
            <span>
              · {level === 'none' ? 'View only' : level === 'derivatives' ? 'Derivatives available' : 'Originals available'}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {items.length === 0 ? (
          <p className="text-archive italic">This collection is empty.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((item) => (
              <div key={item.media_id} className="border border-lichen rounded overflow-hidden bg-parchment">
                <div className="aspect-square bg-stone/30 flex items-center justify-center overflow-hidden">
                  {item.media?.thumbnail_url ? (
                    <img
                      src={item.media.thumbnail_url}
                      alt={item.media.title || item.media.filename || ''}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <ImageIcon size={32} className="text-archive" />
                  )}
                </div>
                <div className="p-3">
                  <p className="text-sm text-ink truncate" title={item.media?.title || item.media?.filename || ''}>
                    {item.media?.title || item.media?.filename || 'Untitled'}
                  </p>
                  {canDownload && (
                    <button
                      type="button"
                      onClick={() => handleDownload(item.media_id)}
                      className="mt-2 text-xs text-bark hover:text-copper-dark flex items-center gap-1"
                    >
                      <Download size={12} />
                      Download
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Supporting components ──────────────────────────────────────────────────

function StatusScreen({
  title,
  message,
  tone = 'info',
  icon,
}: {
  title: string;
  message: string;
  tone?: 'info' | 'error';
  icon?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-parchment flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-3">
        {icon ?? (tone === 'error' ? <AlertTriangle size={32} className="text-semantic-error mx-auto" /> : null)}
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {message && <p className="text-archive">{message}</p>}
      </div>
    </div>
  );
}

function PasswordChallenge({
  attempt,
  setAttempt,
  error,
  onSubmit,
}: {
  attempt: string;
  setAttempt: (v: string) => void;
  error: string | null;
  onSubmit: () => void;
}) {
  return (
    <div className="min-h-screen bg-parchment flex items-center justify-center px-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="max-w-sm w-full space-y-4 border border-lichen rounded-lg p-6 bg-parchment shadow-sm"
      >
        <div className="flex items-center gap-2 text-ink">
          <Lock size={18} />
          <h1 className="text-lg font-semibold">Password required</h1>
        </div>
        <p className="text-sm text-archive">Enter the password shared with the link to view this collection.</p>
        <input
          type="password"
          autoFocus
          value={attempt}
          onChange={(e) => setAttempt(e.target.value)}
          className="w-full px-3 py-2 border border-lichen rounded text-ink bg-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:border-bark"
          placeholder="Password"
        />
        {error && <p className="text-sm text-semantic-error">{error}</p>}
        <button
          type="submit"
          className="w-full px-4 py-2 bg-bark text-parchment rounded hover:bg-bark/90"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
