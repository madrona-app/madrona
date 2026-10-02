import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import {
  getGuidePreferences,
  updateGuidePreferences,
  type GuideVerbosity,
} from '../../lib/api/guidePreferences';
import { MadronaLoader } from '../ui/MadronaLoader';
import { ErrorState } from '../ui/ErrorState';

const INSTRUCTIONS_MAX = 2000;

const VERBOSITY_OPTIONS: { value: GuideVerbosity; label: string; hint: string }[] = [
  { value: 'terse', label: 'Terse', hint: 'Short, to the point' },
  { value: 'normal', label: 'Normal', hint: 'Balanced (default)' },
  { value: 'detailed', label: 'Detailed', hint: 'Thorough, with context' },
];

/**
 * GuidePreferencesPanel — a user's own, private personalization for the Guide
 * assistant. Standing instructions + a verbosity preference, injected below the
 * org system prompt as subordinate guidance. Private to the user (RLS-enforced).
 */
export function GuidePreferencesPanel() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['guide-preferences'],
    queryFn: getGuidePreferences,
  });

  const [instructions, setInstructions] = useState('');
  // null = "normal"/unset; we surface it as the explicit 'normal' radio.
  const [verbosity, setVerbosity] = useState<GuideVerbosity>('normal');
  const [justSaved, setJustSaved] = useState(false);

  // Seed local state once the server value arrives.
  useEffect(() => {
    if (data) {
      setInstructions(data.instructions ?? '');
      setVerbosity(data.verbosity ?? 'normal');
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      updateGuidePreferences({
        instructions: instructions.trim(),
        // 'normal' is the default — persist it as null so "unset" and "normal"
        // are the same thing on the server.
        verbosity: verbosity === 'normal' ? null : verbosity,
      }),
    onSuccess: (saved) => {
      qc.setQueryData(['guide-preferences'], saved);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2000);
    },
  });

  const dirty =
    data != null &&
    (instructions.trim() !== (data.instructions ?? '').trim() ||
      (verbosity === 'normal' ? null : verbosity) !== (data.verbosity ?? null));

  return (
    <section aria-labelledby="guide-prefs-heading">
      <div className="flex items-center gap-2 mb-4">
        <h2 id="guide-prefs-heading" className="text-xl font-semibold text-ink">
          Guide preferences
        </h2>
      </div>

      <div className="bg-parchment rounded-lg shadow border border-lichen p-6">
        <p className="text-sm text-archive mb-5 max-w-prose">
          Personalize how the Guide assistant responds to you. These are private
          to your account and never override your organization&rsquo;s rules.
        </p>

        {isLoading && (
          <div className="flex justify-center py-8">
            <MadronaLoader variant="inline" label="Loading your preferences…" />
          </div>
        )}

        {!isLoading && isError && (
          <ErrorState
            variant="compact"
            title="Couldn't load your preferences."
            onRetry={() => refetch()}
          />
        )}

        {!isLoading && !isError && (
          <div className="flex flex-col gap-6">
            {/* Standing instructions */}
            <div>
              <label
                htmlFor="guide-pref-instructions"
                className="block text-sm font-medium text-ink mb-1.5"
              >
                Things to keep in mind
              </label>
              <textarea
                id="guide-pref-instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value.slice(0, INSTRUCTIONS_MAX))}
                rows={4}
                placeholder="e.g. I work in conservation. Cite collections standards. Prefer plain language over jargon."
                className="w-full rounded-md border border-lichen bg-parchment-warm px-3 py-2 text-sm text-ink placeholder:text-archive/60 focus-visible:ring-2 ring-bark/30 ring-offset-2 outline-none resize-y"
              />
              <div className="mt-1 text-xs text-archive text-right">
                {instructions.length}/{INSTRUCTIONS_MAX}
              </div>
            </div>

            {/* Verbosity */}
            <fieldset>
              <legend className="block text-sm font-medium text-ink mb-2">
                Answer length
              </legend>
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                {VERBOSITY_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex-1 cursor-pointer rounded-md border px-3 py-2.5 transition-colors ${
                      verbosity === opt.value
                        ? 'border-bark bg-bark/5'
                        : 'border-lichen hover:bg-stone/30'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="guide-pref-verbosity"
                        value={opt.value}
                        checked={verbosity === opt.value}
                        onChange={() => setVerbosity(opt.value)}
                        className="accent-bark focus-visible:ring-2 ring-bark/30"
                      />
                      <span className="text-sm font-medium text-ink">{opt.label}</span>
                    </div>
                    <p className="mt-0.5 ml-6 text-xs text-archive">{opt.hint}</p>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex items-center gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Saving…' : 'Save preferences'}
              </button>
              {justSaved && (
                <span className="flex items-center gap-1 text-sm text-semantic-success">
                  <Check size={16} aria-hidden /> Saved
                </span>
              )}
              {save.isError && (
                <span className="text-sm text-semantic-error">
                  Couldn&rsquo;t save. Please try again.
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default GuidePreferencesPanel;
