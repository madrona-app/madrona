import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getReportPdfMode, updateReportPdfMode } from '../../lib/api/on-demand-reports';
import type { ReportPdfMode } from '../../lib/api/on-demand-reports';

const OPTIONS: { value: ReportPdfMode; label: string; description: string }[] = [
  {
    value: 'all',
    label: 'Offer all PDF reports',
    description:
      'Document reports produce tagged PDF. Spreadsheet-style (tabular) PDFs are not tagged for screen readers.',
  },
  {
    value: 'tagged_only',
    label: 'Offer tagged PDF reports only',
    description:
      'Document reports keep their tagged PDF; untagged tabular PDFs are hidden. Accessible formats are always offered.',
  },
  {
    value: 'none',
    label: 'Accessible formats only',
    description: 'No PDF. Reports are offered as HTML, Word, plain text, CSV and Excel.',
  },
];

/**
 * Per-organization choice of which PDF report exports are offered. A native
 * radio group with an explicit Save button (arrowing through radios must not
 * save each option), and the outcome announced in a status region.
 */
export function ReportPdfSetting({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['report-pdf-mode', organizationId],
    queryFn: () => getReportPdfMode(organizationId),
  });
  // null = no unsaved choice; show the stored setting
  const [choice, setChoice] = useState<ReportPdfMode | null>(null);
  const [status, setStatus] = useState('');
  const mode = choice ?? data?.pdf_mode ?? null;

  const mutation = useMutation({
    mutationFn: (value: ReportPdfMode) => updateReportPdfMode(organizationId, value),
    onSuccess: (result) => {
      queryClient.setQueryData(['report-pdf-mode', organizationId], result);
      setChoice(null);
      queryClient.invalidateQueries({ queryKey: ['on-demand-reports', 'available'] });
      const label = OPTIONS.find((o) => o.value === result.pdf_mode)?.label ?? result.pdf_mode;
      setStatus(`Saved: ${label}.`);
    },
    onError: (err: unknown) => {
      setStatus(`Could not save: ${err instanceof Error ? err.message : 'unknown error'}.`);
    },
  });

  const dirty = !!data && mode !== null && mode !== data.pdf_mode;

  return (
    <section aria-labelledby="report-pdf-heading" className="mb-8">
      <h2 id="report-pdf-heading" className="text-lg font-semibold text-ink">
        PDF reports
      </h2>
      <p className="mt-1 mb-3 text-sm text-accessible-gray">
        Every report can be exported as an accessible web page (HTML), Word document or plain
        text; lists also export to CSV and Excel. Choose which PDF exports to offer as well.
      </p>
      {isLoading ? (
        <p className="text-sm text-accessible-gray">Loading setting…</p>
      ) : isError ? (
        <p className="text-sm text-semantic-error">Could not load the PDF setting.</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (mode) mutation.mutate(mode);
          }}
        >
          <fieldset>
            <legend className="sr-only">PDF reports to offer</legend>
            <div className="space-y-2">
              {OPTIONS.map((o) => {
                const id = `report-pdf-mode-${o.value}`;
                return (
                  <div key={o.value} className="flex items-start gap-3">
                    <input
                      type="radio"
                      id={id}
                      name="report-pdf-mode"
                      value={o.value}
                      checked={mode === o.value}
                      onChange={() => {
                        setChoice(o.value);
                        setStatus('');
                      }}
                      aria-describedby={`${id}-desc`}
                      className="mt-1 h-4 w-4 accent-bark focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    />
                    <div>
                      <label htmlFor={id} className="text-sm font-medium text-ink">
                        {o.label}
                      </label>
                      <p id={`${id}-desc`} className="text-xs text-accessible-gray">
                        {o.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
          <button
            type="submit"
            disabled={!dirty || mutation.isPending}
            className="btn-primary mt-3 min-h-[44px] px-4 py-2 rounded text-sm font-medium focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? 'Saving…' : 'Save PDF setting'}
          </button>
        </form>
      )}
      <p role="status" className="mt-2 text-sm text-ink">
        {status}
      </p>
    </section>
  );
}

export default ReportPdfSetting;
