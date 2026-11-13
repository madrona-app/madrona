import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import {
  createBibRecord,
  deleteBibRecord,
  getBibRecord,
  RECORD_TYPES,
  recordTypeLabel,
  updateBibRecord,
  type BibRecord,
  type BibRecordFields,
  type BibRecordInput,
  type RecordType,
} from '../../lib/api/library';
import { usePermissions } from '../../hooks/usePermissions';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import ConfirmDialog from '../../components/ConfirmDialog';
import { LibraryHoldings } from '../../components/collections/library/LibraryHoldings';
import { LibraryAuthorityLinks } from '../../components/collections/library/LibraryAuthorityLinks';

const fieldClass =
  'w-full px-3 py-2 border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark aria-[invalid=true]:border-semantic-error';
const focusRing = 'focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

type TextKey = Exclude<keyof BibRecordFields, 'record_type' | 'date_earliest' | 'date_latest'>;
type FormState = Record<TextKey | 'date_earliest' | 'date_latest', string> & { record_type: RecordType };
type FieldKey = 'title' | 'date_earliest' | 'date_latest';
const ERROR_ORDER: FieldKey[] = ['title', 'date_earliest', 'date_latest'];

const TEXT_KEYS: TextKey[] = [
  'title', 'subtitle', 'statement_of_responsibility', 'edition', 'place', 'publisher',
  'date_display', 'extent', 'series_statement', 'language', 'isbn', 'issn', 'lccn',
  'oclc_number', 'call_number', 'format_notes', 'notes',
];

function emptyForm(): FormState {
  const f = { record_type: 'book' as RecordType, date_earliest: '', date_latest: '' } as FormState;
  for (const k of TEXT_KEYS) f[k] = '';
  return f;
}

function fromRecord(r: BibRecord): FormState {
  const f = emptyForm();
  f.record_type = (r.record_type ?? 'book') as RecordType;
  for (const k of TEXT_KEYS) f[k] = (r[k] as string | null | undefined) ?? '';
  f.date_earliest = r.date_earliest != null ? String(r.date_earliest) : '';
  f.date_latest = r.date_latest != null ? String(r.date_latest) : '';
  return f;
}

function toInput(f: FormState, hidden: Set<string>): BibRecordInput {
  const out: Record<string, unknown> = { record_type: f.record_type };
  for (const k of TEXT_KEYS) out[k] = f[k].trim() ? f[k].trim() : null;
  out.date_earliest = f.date_earliest.trim() ? Number(f.date_earliest) : null;
  out.date_latest = f.date_latest.trim() ? Number(f.date_latest) : null;
  // Never send fields this user cannot see: that would blank them.
  for (const k of hidden) delete out[k];
  return out as BibRecordInput;
}

const YEAR = /^-?\d{1,4}$/;

function validate(f: FormState, hidden: Set<string>): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};
  if (!hidden.has('title') && !f.title.trim()) errors.title = 'Enter a title.';
  const early = f.date_earliest.trim();
  const late = f.date_latest.trim();
  if (early && !YEAR.test(early)) errors.date_earliest = 'Enter the earliest year as a number, for example 1957.';
  if (late && !YEAR.test(late)) errors.date_latest = 'Enter the latest year as a number, for example 1968.';
  if (early && late && !errors.date_earliest && !errors.date_latest && Number(late) < Number(early)) {
    errors.date_latest = 'The latest year must be the same as or later than the earliest year.';
  }
  return errors;
}

function describedBy(id: string, error?: string, hint?: string) {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

function Field({
  id, label, required, error, hint, children,
}: { id: string; label: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">
        {label}
        {required && <span aria-hidden="true" className="text-semantic-error"> *</span>}
      </label>
      {hint && <p id={`${id}-hint`} className="text-xs text-archive mb-1">{hint}</p>}
      {children}
      {error && <p id={`${id}-error`} className="text-sm text-semantic-error mt-1">{error}</p>}
    </div>
  );
}

export default function LibraryRecordPage() {
  const { orgId, recordId } = useParams<{ orgId: string; recordId?: string }>();
  const isCreate = !recordId;
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLInputElement | null>>>({});

  const canEdit = isCreate ? hasPermission('collections.create') : hasPermission('collections.edit');
  const canDelete = !isCreate && hasPermission('collections.delete');
  const listPath = `/organizations/${orgId}/collections/library`;

  const { data: record, isLoading, error: loadError } = useQuery({
    queryKey: ['library-record', orgId, recordId],
    queryFn: () => getBibRecord(orgId!, recordId!),
    enabled: !!orgId && !!recordId,
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Initialise the form when the page shows a different record, during
  // render so the first paint already has the values.
  const formKey = recordId ?? 'new';
  const [formFor, setFormFor] = useState<string | null>(null);
  if (formFor !== formKey) {
    if (isCreate) {
      setForm(emptyForm());
      setFormFor(formKey);
    } else if (record) {
      setForm(fromRecord(record));
      setFormFor(formKey);
    }
  }

  const arrivalAnnouncement = (location.state as { announce?: string } | null)?.announce ?? '';
  const liveMessage = announcement || arrivalAnnouncement;
  useEffect(() => {
    if (record && arrivalAnnouncement) headingRef.current?.focus();
  }, [record, arrivalAnnouncement]);

  if (!orgId) return null;

  if (!isCreate && isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading library record…" />
      </div>
    );
  }

  if (!isCreate && (loadError || !record)) {
    return (
      <div className="max-w-4xl mx-auto">
        <p role="alert" className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 text-semantic-error">
          Could not load this library record{loadError ? `: ${(loadError as Error).message}` : '.'}
        </p>
        <Link to={listPath} className={`text-bark hover:text-copper-dark mt-4 inline-block ${focusRing}`}>
          Back to the library
        </Link>
      </div>
    );
  }

  if (!form) return null;

  const hidden = new Set(record?._restricted_fields ?? []);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validate(form, hidden);
    setErrors(found);
    setSaveError('');
    const firstInvalid = ERROR_ORDER.find((k) => found[k]);
    if (firstInvalid) {
      fieldRefs.current[firstInvalid]?.focus();
      return;
    }
    setSaving(true);
    try {
      if (isCreate) {
        const created = await createBibRecord(orgId, toInput(form, hidden));
        queryClient.invalidateQueries({ queryKey: ['library-records', orgId] });
        navigate(`${listPath}/${created.bib_record_id}`, {
          replace: true,
          state: { announce: 'Library record created. You can now add names, subjects, holdings and items.' },
        });
        return;
      }
      const updated = await updateBibRecord(orgId, recordId!, toInput(form, hidden));
      queryClient.setQueryData(['library-record', orgId, recordId], updated);
      queryClient.invalidateQueries({ queryKey: ['library-records', orgId] });
      setForm(fromRecord(updated));
      setAnnouncement('Library record saved.');
    } catch (err) {
      setSaveError(`Could not save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteBibRecord(orgId, recordId!);
      queryClient.invalidateQueries({ queryKey: ['library-records', orgId] });
      navigate(listPath, { state: { announce: 'Library record deleted.' } });
    } catch (err) {
      setConfirmDelete(false);
      setSaveError(`Could not delete: ${(err as Error).message}`);
    }
  };

  const title = isCreate
    ? 'New library record'
    : `${record!.title || 'Untitled'} (${recordTypeLabel(record!.record_type)})`;

  const input = (
    name: TextKey | 'date_earliest' | 'date_latest',
    label: string,
    opts: { required?: boolean; hint?: string; inputMode?: 'numeric' } = {},
  ) => {
    if (hidden.has(name)) return null;
    const id = fid(name);
    const error = errors[name as FieldKey];
    return (
      <Field id={id} label={label} required={opts.required} error={error} hint={opts.hint}>
        <input
          id={id}
          ref={(el) => { if ((ERROR_ORDER as string[]).includes(name)) fieldRefs.current[name as FieldKey] = el; }}
          type="text"
          inputMode={opts.inputMode}
          value={form[name]}
          onChange={(e) => set(name, e.target.value)}
          readOnly={!canEdit}
          required={opts.required}
          aria-required={opts.required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, opts.hint)}
          autoComplete="off"
          className={fieldClass}
        />
      </Field>
    );
  };

  const textArea = (name: TextKey, label: string, hint?: string) => {
    if (hidden.has(name)) return null;
    const id = fid(name);
    return (
      <Field id={id} label={label} hint={hint}>
        <textarea
          id={id}
          rows={3}
          value={form[name]}
          onChange={(e) => set(name, e.target.value)}
          readOnly={!canEdit}
          aria-describedby={describedBy(id, undefined, hint)}
          className={fieldClass}
        />
      </Field>
    );
  };

  const errorList = ERROR_ORDER.filter((k) => errors[k]).map((k) => [k, errors[k]!] as const);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Link to={listPath} className={`inline-flex items-center gap-1 text-sm text-bark hover:text-copper-dark rounded ${focusRing}`}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back to the library
      </Link>

      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-ink focus:outline-none">
        {title}
      </h1>

      <p role="status" aria-live="polite" className="sr-only">{liveMessage}</p>

      <form noValidate onSubmit={handleSubmit} aria-label="Bibliographic description" className="bg-parchment border border-lichen rounded-lg p-6 space-y-6">
        {errorList.length > 0 && (
          <div role="alert" className="p-3 rounded-lg bg-semantic-error/10 border border-semantic-error/30 text-sm text-semantic-error">
            <p className="font-medium">Please correct {errorList.length === 1 ? 'this' : 'these'} before saving:</p>
            <ul className="list-disc pl-5 mt-1">
              {errorList.map(([k, msg]) => (
                <li key={k}>
                  <a href={`#${fid(k)}`} className="underline" onClick={(e) => { e.preventDefault(); fieldRefs.current[k]?.focus(); }}>{msg}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {saveError && (
          <p role="alert" className="p-3 rounded-lg bg-semantic-error/10 border border-semantic-error/30 text-sm text-semantic-error">
            {saveError}
          </p>
        )}

        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-forest mb-2">Title and responsibility</legend>
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            {!hidden.has('record_type') && (
              <Field id={fid('record_type')} label="Record type" required>
                <select
                  id={fid('record_type')}
                  value={form.record_type}
                  onChange={(e) => set('record_type', e.target.value as RecordType)}
                  disabled={!canEdit}
                  aria-required="true"
                  className={fieldClass}
                >
                  {RECORD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
            )}
            {input('title', 'Title', { required: true })}
          </div>
          {input('subtitle', 'Subtitle')}
          {input('statement_of_responsibility', 'Statement of responsibility', { hint: 'As given on the item, for example “by Floyd Matson; narrated by …”.' })}
          {input('edition', 'Edition')}
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-forest mb-2">Publication</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {input('place', 'Place of publication')}
            {input('publisher', 'Publisher')}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {input('date_display', 'Date', { hint: 'As it should be shown, for example “c1957” or “1956–1968”.' })}
            {input('date_earliest', 'Earliest year', { inputMode: 'numeric', hint: 'For sorting and searching.' })}
            {input('date_latest', 'Latest year', { inputMode: 'numeric', hint: 'Same as earliest for a single year.' })}
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-forest mb-2">Description</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {input('extent', 'Extent', { hint: 'For example “3 volumes of braille” or “6 audio cassettes”.' })}
            {input('language', 'Language')}
          </div>
          {input('series_statement', 'Series')}
          {textArea('format_notes', 'Format notes', 'Braille grade, print size, playback format and similar.')}
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-forest mb-2">Identifiers and classification</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {input('isbn', 'ISBN')}
            {input('issn', 'ISSN')}
            {input('lccn', 'LC control number (LCCN)')}
            {input('oclc_number', 'OCLC number')}
          </div>
          {input('call_number', 'Call number', { hint: 'Classification, for example HV1593 .M38 1990.' })}
        </fieldset>

        {!hidden.has('notes') && (
          <fieldset className="space-y-4">
            <legend className="text-lg font-semibold text-forest mb-2">Notes</legend>
            {textArea('notes', 'Notes')}
          </fieldset>
        )}

        {canEdit && (
          <div className="flex flex-wrap gap-3 justify-between">
            <button type="submit" disabled={saving} className={`btn btn-primary min-h-[44px] ${focusRing}`}>
              {saving ? 'Saving…' : isCreate ? 'Create record' : 'Save changes'}
            </button>
            {canDelete && (
              <button type="button" onClick={() => setConfirmDelete(true)} className={`btn btn-tertiary min-h-[44px] text-semantic-error ${focusRing}`}>
                Delete record
              </button>
            )}
          </div>
        )}
      </form>

      {!isCreate && record && (
        <>
          <LibraryAuthorityLinks
            orgId={orgId}
            recordId={record.bib_record_id}
            subjects={record.subjects ?? []}
            names={record.names ?? []}
            canEdit={canEdit}
          />
          <LibraryHoldings
            orgId={orgId}
            recordId={record.bib_record_id}
            holdings={record.holdings ?? []}
            canEdit={canEdit}
          />
        </>
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        title="Delete this library record?"
        message="The record, its holdings and items, and its subject and name links will be deleted. Subject headings, person records and object records are not changed."
        confirmText="Delete record"
        confirmStyle="danger"
      />
    </div>
  );
}
