/**
 * Collections configuration > General > Deaccessioned records.
 *
 * One switch: keep deaccessioned records out of general search. On by
 * default. Saves immediately and announces the result in a status region.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive } from 'lucide-react';
import { usePermissions } from '../../../hooks/usePermissions';
import {
  getHideDeaccessioned,
  hideDeaccessionedQueryKey,
  setHideDeaccessioned,
} from '../../../lib/api/searchSettings';

export function DeaccessionedSearchSetting({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('org.manage_settings');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const { data: hide, isLoading, isError } = useQuery({
    queryKey: hideDeaccessionedQueryKey(organizationId),
    queryFn: () => getHideDeaccessioned(organizationId),
    enabled: !!organizationId,
  });

  const mutation = useMutation({
    mutationFn: (next: boolean) => setHideDeaccessioned(organizationId, next),
    onSuccess: (next) => {
      queryClient.setQueryData(hideDeaccessionedQueryKey(organizationId), next);
      queryClient.invalidateQueries({ queryKey: ['collections-search', organizationId] });
      setError('');
      setStatus(
        next
          ? 'Deaccessioned records are now hidden from search and the public portal.'
          : 'Deaccessioned records now appear in search, and on the public portal if published.',
      );
    },
    onError: (err) => {
      setStatus('');
      setError(`The setting could not be changed: ${(err as Error).message}`);
    },
  });

  const inputId = 'setting-hide-deaccessioned';
  const descId = `${inputId}-desc`;
  const readonlyId = `${inputId}-readonly`;

  return (
    <section
      aria-labelledby="deaccessioned-search-heading"
      className="bg-parchment rounded-lg border border-lichen shadow-sm mt-6"
    >
      <div className="px-6 py-4 border-b border-lichen">
        <div className="flex items-center gap-2">
          <Archive size={18} className="text-forest" aria-hidden="true" />
          <h2 id="deaccessioned-search-heading" className="text-lg font-semibold text-ink">
            Deaccessioned Records
          </h2>
        </div>
      </div>
      <div className="px-6 py-5">
        {isLoading ? (
          <p className="text-sm text-archive">Loading setting&hellip;</p>
        ) : isError ? (
          <p role="alert" className="text-sm text-semantic-error">This setting could not be loaded.</p>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <label htmlFor={inputId} className="text-sm font-medium text-ink cursor-pointer">
                Hide deaccessioned records from search
              </label>
              <p id={descId} className="text-sm text-archive">
                Staff searches and object lists leave out deaccessioned records unless someone checks
                &ldquo;Include deaccessioned records&rdquo; or filters by that status. The public portal
                never shows them. The records themselves are kept and stay reachable from procedures
                and reports.
              </p>
              {!canManage && (
                <p id={readonlyId} className="text-sm text-accessible-gray mt-1">
                  Changing this requires permission to manage organization settings.
                </p>
              )}
            </div>
            <input
              id={inputId}
              type="checkbox"
              role="switch"
              checked={!!hide}
              disabled={!canManage}
              aria-describedby={canManage ? descId : `${descId} ${readonlyId}`}
              onChange={(e) => {
                // Stay enabled while saving so keyboard focus is never dropped.
                if (mutation.isPending) return;
                mutation.mutate(e.target.checked);
              }}
              className="mt-1 h-6 w-6 shrink-0 accent-bark cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
        )}
        <div role="status" aria-live="polite" className="text-sm text-semantic-success mt-3 min-h-[1.25rem]">
          {status}
        </div>
        <div role="alert" className="text-sm text-semantic-error">
          {error}
        </div>
      </div>
    </section>
  );
}
