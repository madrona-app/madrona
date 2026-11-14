import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { usePermissions } from '../../hooks/usePermissions';
import { ApiError } from '../../lib/apiClient';
import {
  getPublicFieldSettings,
  savePublicFields,
  type PublicFieldSettings,
} from '../../lib/api/discoverPublicFields';

/**
 * Collections configuration > Public Fields.
 *
 * Choose which standard object fields the public portal (record pages,
 * search results, exports) and the public APIs publish. Fields outside the
 * server's allowlist (valuation, location, acquisition source, internal
 * notes, culturally restricted context) never appear here and are refused by
 * the API. User-defined additional fields keep their own public flag, set on
 * the Additional Fields page; they are listed here for a complete picture.
 */

const BUTTON =
  'inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

const publicFieldsQueryKey = (orgId: string | undefined) => ['discover-public-fields', orgId];

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError && err.status < 500 && err.message) return err.message;
  return 'The public fields could not be saved. Try again.';
}

export default function PublicFieldsSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('discover.publish') || hasPermission('org.manage_settings');

  const { data, isLoading, isError } = useQuery({
    queryKey: publicFieldsQueryKey(orgId),
    queryFn: () => getPublicFieldSettings(orgId!),
    enabled: !!orgId,
  });

  // Unsaved edits; null means "what is saved".
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const saved = useMemo(() => new Set(data?.public_fields ?? []), [data]);
  const selected = draft ?? saved;
  const isDirty = !!data && !sameSet(saved, selected);

  const mutation = useMutation({
    mutationFn: (keys: string[]) => savePublicFields(orgId!, keys),
    onSuccess: (result: PublicFieldSettings) => {
      queryClient.setQueryData(publicFieldsQueryKey(orgId), result);
      setDraft(null);
      setError('');
      const count = result.public_fields.length;
      setStatus(`Saved. ${count} of ${result.fields.length} standard fields are now public.`);
    },
    onError: (err) => {
      setStatus('');
      setError(messageFor(err));
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading public field settings" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <h2 className="text-lg font-semibold text-ink">Public Fields</h2>
        <p role="alert" className="text-sm text-semantic-error mt-2">
          The public field settings could not be loaded.
        </p>
      </div>
    );
  }

  const toggle = (key: string, on: boolean) => {
    setStatus('');
    const next = new Set(selected);
    if (on) next.add(key);
    else next.delete(key);
    setDraft(next);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canManage || mutation.isPending) return;
    if (!isDirty) {
      setError('');
      setStatus('No changes to save.');
      return;
    }
    // Catalog order, so the saved value reads the same as the page.
    mutation.mutate(data.fields.filter((f) => selected.has(f.key)).map((f) => f.key));
  };

  const resetToDefaults = () => {
    setDraft(new Set(data.default_fields));
    setError('');
    setStatus('Default fields selected. Save to apply them.');
  };

  const publicFields = data.fields.filter((f) => selected.has(f.key));
  const hiddenFields = data.fields.filter((f) => !selected.has(f.key));
  const publicExtras = data.additional_fields.filter((f) => f.is_public);
  const readonlyId = 'public-fields-readonly';

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <Eye size={20} className="text-bark" aria-hidden="true" />
          Public Fields
        </h2>
        <p className="text-sm text-archive mt-1">
          Choose which catalogue fields visitors can see on published records. This applies to the
          public portal&rsquo;s record pages, search results and filters, downloads, link previews, and
          the public APIs and IIIF manifests. Only records you have published are ever shown, and only
          their published images. A field that is not public is also not searchable or filterable on
          the portal.
        </p>
        {data.is_default && (
          <p className="text-sm text-archive mt-2">
            Your organization is using the default selection.
          </p>
        )}
        {!canManage && (
          <p className="text-sm text-accessible-gray mt-2" id={readonlyId}>
            You can view these settings. Changing them requires permission to publish to the portal or
            to manage organization settings.
          </p>
        )}
      </div>

      <form onSubmit={onSubmit} aria-label="Public fields" noValidate>
        <div className="space-y-4">
          {data.groups.map((group) => {
            const fields = data.fields.filter((f) => f.group === group.key);
            if (fields.length === 0) return null;
            return (
              <fieldset key={group.key} className="bg-parchment border border-lichen rounded-lg">
                <legend className="px-2 ml-2 text-sm font-semibold text-ink">{group.label}</legend>
                <ul className="divide-y divide-lichen">
                  {fields.map((f) => {
                    const inputId = `public-field-${f.key}`;
                    const descId = `${inputId}-desc`;
                    const describedBy = canManage ? descId : `${descId} ${readonlyId}`;
                    return (
                      <li key={f.key} className="flex items-start gap-3 px-4 py-3">
                        <input
                          id={inputId}
                          type="checkbox"
                          checked={f.locked || selected.has(f.key)}
                          disabled={f.locked || !canManage}
                          aria-describedby={describedBy}
                          onChange={(e) => toggle(f.key, e.target.checked)}
                          className="mt-0.5 h-6 w-6 shrink-0 accent-bark cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                        />
                        <div className="min-w-0">
                          <label htmlFor={inputId} className="text-sm font-medium text-ink cursor-pointer">
                            {f.label}
                          </label>
                          <p id={descId} className="text-sm text-archive">
                            {f.description}
                            {!f.locked && !f.default_public && ' Not public by default.'}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })}
        </div>

        <div className="sticky bottom-0 bg-parchment border-t border-lichen py-4 mt-6 flex flex-wrap items-center gap-3">
          {canManage && (
            <>
              <button type="submit" className={`${BUTTON} btn btn-primary`} aria-describedby="public-fields-dirty">
                {mutation.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <button
                type="button"
                onClick={resetToDefaults}
                className={`${BUTTON} border border-lichen bg-parchment text-ink hover:bg-stone`}
              >
                Select the defaults
              </button>
            </>
          )}
          <span id="public-fields-dirty" className="text-sm text-archive">
            {isDirty ? 'You have unsaved changes.' : ''}
          </span>
        </div>
        <div role="status" aria-live="polite" className="text-sm text-semantic-success min-h-[1.25rem]">
          {status}
        </div>
        <div role="alert" className="text-sm text-semantic-error">
          {error}
        </div>
      </form>

      <section aria-labelledby="public-fields-summary" className="mt-8 bg-parchment-warm border border-lichen rounded-lg p-4">
        <h3 id="public-fields-summary" className="text-base font-semibold text-ink">
          What visitors will see
        </h3>
        <p className="text-sm text-ink mt-1">
          {publicFields.length} of {data.fields.length} standard fields
          {isDirty ? ' will be public when you save' : ' are public'}
          {publicExtras.length > 0 &&
            `, plus ${publicExtras.length} additional field${publicExtras.length === 1 ? '' : 's'}`}
          .
        </p>
        <h4 className="text-sm font-semibold text-ink mt-3">Public</h4>
        <ul className="list-disc pl-5 text-sm text-ink">
          {publicFields.map((f) => <li key={f.key}>{f.label}</li>)}
          {publicExtras.map((f) => <li key={`extra-${f.key}`}>{f.label} (additional field)</li>)}
        </ul>
        <h4 className="text-sm font-semibold text-ink mt-3">Not public</h4>
        {hiddenFields.length === 0 ? (
          <p className="text-sm text-archive">Every standard field is public.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm text-ink">
            {hiddenFields.map((f) => <li key={f.key}>{f.label}</li>)}
          </ul>
        )}
      </section>

      <section aria-labelledby="public-fields-extra" className="mt-6">
        <h3 id="public-fields-extra" className="text-base font-semibold text-ink">
          Additional fields
        </h3>
        <p className="text-sm text-archive mt-1">
          Each field your organization defined has its own public setting.{' '}
          <Link
            to={`/organizations/${orgId}/collections/config/custom-fields`}
            className="text-bark hover:text-copper-dark underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 rounded"
          >
            Change them on the Additional Fields page
          </Link>
          .
        </p>
        {data.additional_fields.length === 0 ? (
          <p className="text-sm text-archive mt-2">Your organization has no additional fields.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm text-ink mt-2">
            {data.additional_fields.map((f) => (
              <li key={f.key}>
                {f.label}: {f.is_public ? 'public' : 'not public'}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="public-fields-never" className="mt-6">
        <h3 id="public-fields-never" className="text-base font-semibold text-ink">
          Never published
        </h3>
        <p className="text-sm text-archive mt-1">
          These fields cannot be made public, whatever is chosen above.
        </p>
        <ul className="list-disc pl-5 text-sm text-ink mt-2">
          {data.never_public.map((f) => (
            <li key={f.key}>
              <span className="font-medium">{f.label}</span>: {f.reason}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
