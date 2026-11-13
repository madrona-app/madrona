import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ListChecks } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { usePermissions } from '../../hooks/usePermissions';
import {
  useVocabularyValidation,
  vocabularyValidationQueryKey,
  type VocabularyValidationField,
} from '../../hooks/useVocabularyValidation';

/**
 * Collections settings: switch strict vocabulary validation on per object field.
 *
 * Off (lenient) is the default for every field so migrated free-text data is
 * never blocked. When a field is strict, the object API rejects values that are
 * not in the organization's vocabulary, lookup list or a linked reference
 * source, and the editor's autocomplete stops offering "use as entered".
 */
export default function VocabularyValidationSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('org.manage_settings');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading, isError } = useVocabularyValidation(orgId);

  const mutation = useMutation({
    mutationFn: (update: Partial<Record<string, boolean>>) =>
      apiFetch(`/organizations/${orgId}/settings/vocabulary-validation`, {
        method: 'PUT',
        body: JSON.stringify(update),
      }) as Promise<{ fields: VocabularyValidationField[] }>,
    onSuccess: (result, update) => {
      queryClient.setQueryData(vocabularyValidationQueryKey(orgId), result);
      const [key, strict] = Object.entries(update)[0] ?? [];
      const label = result.fields.find((f) => f.key === key)?.label ?? key;
      setError('');
      setStatus(`${label}: strict validation ${strict ? 'on' : 'off'}.`);
    },
    onError: (err, update) => {
      const key = Object.keys(update)[0];
      const label = data?.fields.find((f) => f.key === key)?.label ?? key;
      setStatus('');
      setError(`Could not change ${label}: ${(err as Error).message}`);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading vocabulary validation settings" />
      </div>
    );
  }

  const fields = data?.fields ?? [];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <ListChecks size={20} className="text-bark" aria-hidden="true" />
          Vocabulary Validation
        </h2>
        <p className="text-sm text-archive mt-1">
          Choose which object fields accept only terms from your vocabularies, lookup lists or
          linked reference sources. Strict fields reject new values typed as free text, and the
          object editor no longer offers to use an entry as typed. Values already on a record are
          kept and can still be saved. All fields are off by default.
        </p>
        {!canManage && (
          <p className="text-sm text-accessible-gray mt-2" id="vocab-validation-readonly">
            You can view these settings. Changing them requires permission to manage organization settings.
          </p>
        )}
      </div>

      {isError ? (
        <p role="alert" className="text-sm text-semantic-error">
          Vocabulary validation settings could not be loaded.
        </p>
      ) : (
        <fieldset className="bg-parchment border border-lichen rounded-lg">
          <legend className="sr-only">Strict vocabulary validation by field</legend>
          <ul className="divide-y divide-lichen">
            {fields.map((f) => {
              const inputId = `vocab-strict-${f.key}`;
              const descId = `${inputId}-desc`;
              return (
                <li key={f.key} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <label htmlFor={inputId} className="text-sm font-medium text-ink cursor-pointer">
                      {f.label}
                    </label>
                    <p id={descId} className="text-sm text-archive">
                      {f.description}
                    </p>
                  </div>
                  <input
                    id={inputId}
                    type="checkbox"
                    role="switch"
                    checked={f.strict}
                    disabled={!canManage}
                    aria-describedby={canManage ? descId : `${descId} vocab-validation-readonly`}
                    onChange={(e) => {
                      // Stay enabled while saving so focus is never dropped from a
                      // control that becomes disabled under the keyboard.
                      if (mutation.isPending) return;
                      mutation.mutate({ [f.key]: e.target.checked });
                    }}
                    className="mt-1 h-6 w-6 shrink-0 accent-bark cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  />
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      <div role="status" aria-live="polite" className="text-sm text-semantic-success mt-3 min-h-[1.25rem]">
        {status}
      </div>
      <div role="alert" className="text-sm text-semantic-error">
        {error}
      </div>
    </div>
  );
}
