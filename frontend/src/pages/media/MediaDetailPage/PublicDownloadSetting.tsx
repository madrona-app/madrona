import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateMedia } from '../../../lib/api';

export type PublicDownloadLevel = 'none' | 'derivatives' | 'originals';

const OPTIONS: Array<{ value: '' | PublicDownloadLevel; label: string }> = [
  { value: '', label: 'Not set (no public downloads)' },
  { value: 'none', label: 'No downloads' },
  { value: 'derivatives', label: 'Access copies only' },
  { value: 'originals', label: 'Access copies and original file' },
];

interface Props {
  orgId: string;
  mediaId: string;
  mediaType: string;
  value: PublicDownloadLevel | null | undefined;
  canEdit: boolean;
}

/**
 * Per-file public download level.
 *
 * An explicit Save button rather than save-on-change: arrowing through a
 * native select fires change events on some browsers, which would save every
 * option a keyboard user passed on the way to the one they wanted.
 */
export function PublicDownloadSetting({ orgId, mediaId, mediaType, value, canEdit }: Props) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const selectId = useId();
  const helpId = useId();
  const typeHelpId = useId();
  const errorId = useId();
  const saved = value ?? '';
  const [draft, setDraft] = useState<'' | PublicDownloadLevel>(saved);
  const [status, setStatus] = useState('');
  // Follow the saved value when it changes (e.g. after a refetch) without
  // remounting, so the saved-status message survives for screen readers.
  const [syncedFrom, setSyncedFrom] = useState(saved);
  if (syncedFrom !== saved) {
    setSyncedFrom(saved);
    setDraft(saved);
  }

  const mutation = useMutation({
    mutationFn: (level: PublicDownloadLevel | null) =>
      updateMedia(orgId, mediaId, { public_download_level: level }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', orgId, mediaId] });
      setStatus('Public download setting saved.');
    },
    onError: () => setStatus(''),
  });

  const noAccessCopy = mediaType === 'audio' || mediaType === 'document';
  const dirty = draft !== saved;
  const describedBy = [helpId, noAccessCopy ? typeHelpId : null, mutation.isError ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-medium text-ink mb-3">Public downloads</h3>
      <div className="bg-stone/20 rounded-lg p-4">
        <label htmlFor={selectId} className="block text-xs font-medium text-archive mb-1">
          What visitors can download
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            id={selectId}
            value={draft}
            disabled={!canEdit || mutation.isPending}
            aria-describedby={describedBy}
            aria-invalid={mutation.isError || undefined}
            onChange={(e) => { setDraft(e.target.value as '' | PublicDownloadLevel); setStatus(''); }}
            className="min-h-[44px] px-3 py-1.5 text-sm border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {OPTIONS.map((o) => (
              <option key={o.value || 'unset'} value={o.value}>{o.label}</option>
            ))}
          </select>
          {canEdit && (
            <button
              type="button"
              onClick={() => mutation.mutate(draft === '' ? null : draft)}
              disabled={!dirty || mutation.isPending}
              className="btn btn-secondary min-h-[44px] text-sm px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {mutation.isPending ? 'Saving…' : 'Save download setting'}
            </button>
          )}
        </div>
        <p id={helpId} className="mt-2 text-xs text-accessible-gray">
          Applies to this file on the public collection site and in public collection shares.
          Access copies are web-sized renditions (images and transcoded video); the original is the
          file as uploaded. Not set means no downloads on the public site, and a collection share
          uses its own setting. A share can never allow more than this file does. Visitors can still
          play or read a published file; this setting controls downloads.
          {!canEdit && ' You need permission to edit media to change it.'}
        </p>
        {noAccessCopy && (
          <p id={typeHelpId} className="mt-1 text-xs text-accessible-gray">
            {mediaType === 'audio' ? 'Audio files' : 'Documents'} have no access copy, so only
            {' '}“Access copies and original file” offers a download.
          </p>
        )}
        {mutation.isError && (
          <p id={errorId} role="alert" className="mt-2 text-xs text-semantic-error">
            The download setting could not be saved. {(mutation.error as Error)?.message}
          </p>
        )}
        <p role="status" aria-live="polite" className="mt-2 text-xs text-semantic-success min-h-[1em]">
          {status}
        </p>
      </div>
    </section>
  );
}
