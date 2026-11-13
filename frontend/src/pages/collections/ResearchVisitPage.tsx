import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { getUseRequests } from '../../lib/api';
import { getConstituents } from '../../lib/api/constituents';
import {
  createResearchVisit,
  deleteResearchVisit,
  getResearchVisit,
  updateResearchVisit,
  type ResearchVisit,
  type ResearchVisitInput,
} from '../../lib/api/researchVisits';
import { formatDateShort } from '@/lib/formatters';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuth } from '../../hooks/useAuth';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import ConfirmDialog from '../../components/ConfirmDialog';
import { RecordSearch } from '../../components/collections/research-visits/RecordSearch';
import { ResearchVisitObjects } from '../../components/collections/research-visits/ResearchVisitObjects';

const fieldClass =
  'w-full px-3 py-2 border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark aria-[invalid=true]:border-semantic-error';
const focusRing = 'focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

type FormState = {
  researcher_name: string;
  researcher_affiliation: string;
  researcher_constituent_id: string;
  researcher_constituent_name: string;
  visit_date: string;
  arrival_time: string;
  departure_time: string;
  location: string;
  research_topic: string;
  purpose: string;
  supervised_by_name: string;
  use_request_id: string;
  notes: string;
};

type FieldKey = 'researcher_name' | 'visit_date' | 'departure_time';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fromVisit(v: ResearchVisit): FormState {
  return {
    researcher_name: v.researcher_name,
    researcher_affiliation: v.researcher_affiliation ?? '',
    researcher_constituent_id: v.researcher_constituent_id ?? '',
    researcher_constituent_name: v.researcher_constituent_name ?? '',
    visit_date: v.visit_date,
    arrival_time: v.arrival_time ?? '',
    departure_time: v.departure_time ?? '',
    location: v.location ?? '',
    research_topic: v.research_topic ?? '',
    purpose: v.purpose ?? '',
    supervised_by_name: v.supervised_by_name ?? '',
    use_request_id: v.use_request_id ?? '',
    notes: v.notes ?? '',
  };
}

function toInput(f: FormState): ResearchVisitInput {
  const orNull = (s: string) => (s.trim() ? s.trim() : null);
  return {
    researcher_name: f.researcher_name.trim(),
    researcher_affiliation: orNull(f.researcher_affiliation),
    researcher_constituent_id: f.researcher_constituent_id || null,
    visit_date: f.visit_date,
    arrival_time: f.arrival_time || null,
    departure_time: f.departure_time || null,
    location: orNull(f.location),
    research_topic: orNull(f.research_topic),
    purpose: orNull(f.purpose),
    supervised_by_name: orNull(f.supervised_by_name),
    use_request_id: f.use_request_id || null,
    notes: orNull(f.notes),
  };
}

function validate(f: FormState): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};
  if (!f.researcher_name.trim()) errors.researcher_name = 'Enter the researcher’s name.';
  if (!f.visit_date) errors.visit_date = 'Enter the date of the visit.';
  if (f.arrival_time && f.departure_time && f.departure_time < f.arrival_time) {
    errors.departure_time = 'Departure time must be the same as or later than arrival time.';
  }
  return errors;
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
      {error && (
        <p id={`${id}-error`} className="text-sm text-semantic-error mt-1">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: string) {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

export default function ResearchVisitPage() {
  const { orgId, visitId } = useParams<{ orgId: string; visitId?: string }>();
  const isCreate = !visitId;
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const headingRef = useRef<HTMLHeadingElement>(null);

  const canEdit = isCreate ? hasPermission('use_requests.create') : hasPermission('use_requests.edit');
  const listPath = `/organizations/${orgId}/collections/research-visits`;

  const { data: visit, isLoading, error: loadError } = useQuery({
    queryKey: ['research-visit', orgId, visitId],
    queryFn: () => getResearchVisit(orgId!, visitId!),
    enabled: !!orgId && !!visitId,
  });

  const { data: useRequests } = useQuery({
    queryKey: ['use-requests', orgId, 'research-visit-picker'],
    queryFn: () => getUseRequests(orgId!, { limit: 100 }),
    enabled: !!orgId && canEdit,
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLInputElement | null>>>({});

  // Initialise the form when the page shows a different record: blank for a
  // new visit, from the record otherwise. Done during render (not in an
  // effect) so the first paint already has the values.
  const formKey = visitId ?? 'new';
  const [formFor, setFormFor] = useState<string | null>(null);
  if (formFor !== formKey) {
    if (isCreate) {
      setForm({
        researcher_name: '', researcher_affiliation: '', researcher_constituent_id: '',
        researcher_constituent_name: '', visit_date: today(), arrival_time: '', departure_time: '',
        location: '', research_topic: '', purpose: '',
        supervised_by_name: user?.name ?? '', use_request_id: '', notes: '',
      });
      setFormFor(formKey);
    } else if (visit) {
      setForm(fromVisit(visit));
      setFormFor(formKey);
    }
  }

  // Arriving from "Log visit": announce it and put focus on the page heading
  // so screen reader users hear where they are.
  const arrivalAnnouncement = (location.state as { announce?: string } | null)?.announce ?? '';
  const liveMessage = announcement || arrivalAnnouncement;
  useEffect(() => {
    if (visit && arrivalAnnouncement) headingRef.current?.focus();
  }, [visit, arrivalAnnouncement]);

  if (!orgId) return null;

  if (!isCreate && isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading research visit…" />
      </div>
    );
  }

  if (!isCreate && (loadError || !visit)) {
    return (
      <div className="max-w-4xl mx-auto">
        <p role="alert" className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 text-semantic-error">
          Could not load this research visit{loadError ? `: ${(loadError as Error).message}` : '.'}
        </p>
        <Link to={listPath} className={`text-bark hover:text-copper-dark mt-4 inline-block ${focusRing}`}>
          Back to research visits
        </Link>
      </div>
    );
  }

  if (!form) return null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    setSaveError('');
    const firstInvalid = (['researcher_name', 'visit_date', 'departure_time'] as FieldKey[]).find((k) => found[k]);
    if (firstInvalid) {
      fieldRefs.current[firstInvalid]?.focus();
      return;
    }
    setSaving(true);
    try {
      if (isCreate) {
        const created = await createResearchVisit(orgId, toInput(form));
        queryClient.invalidateQueries({ queryKey: ['research-visits', orgId] });
        navigate(`${listPath}/${created.visit_id}`, {
          replace: true,
          state: { announce: 'Research visit logged. You can now add the objects used.' },
        });
        return;
      }
      const updated = await updateResearchVisit(orgId, visitId!, toInput(form));
      queryClient.setQueryData(['research-visit', orgId, visitId], updated);
      queryClient.invalidateQueries({ queryKey: ['research-visits', orgId] });
      setForm(fromVisit(updated));
      setAnnouncement('Research visit saved.');
    } catch (err) {
      setSaveError(`Could not save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteResearchVisit(orgId, visitId!);
      queryClient.invalidateQueries({ queryKey: ['research-visits', orgId] });
      navigate(listPath, { state: { announce: 'Research visit deleted.' } });
    } catch (err) {
      setConfirmDelete(false);
      setSaveError(`Could not delete: ${(err as Error).message}`);
    }
  };

  const title = isCreate
    ? 'Log a research visit'
    : `Research visit: ${visit!.researcher_name}, ${formatDateShort(visit!.visit_date)}`;

  const textInput = (name: Exclude<keyof FormState, 'researcher_constituent_id' | 'researcher_constituent_name'>, label: string, opts: { required?: boolean; type?: string; hint?: string; autoComplete?: string } = {}) => {
    const id = fid(name);
    const error = errors[name as FieldKey];
    return (
      <Field id={id} label={label} required={opts.required} error={error} hint={opts.hint}>
        <input
          id={id}
          ref={(el) => { if (name === 'researcher_name' || name === 'visit_date' || name === 'departure_time') fieldRefs.current[name] = el; }}
          type={opts.type ?? 'text'}
          value={form[name]}
          onChange={(e) => set(name, e.target.value)}
          readOnly={!canEdit}
          required={opts.required}
          aria-required={opts.required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, opts.hint)}
          autoComplete={opts.autoComplete ?? 'off'}
          className={fieldClass}
        />
      </Field>
    );
  };

  const textArea = (name: 'purpose' | 'notes', label: string) => (
    <Field id={fid(name)} label={label}>
      <textarea
        id={fid(name)}
        rows={3}
        value={form[name]}
        onChange={(e) => set(name, e.target.value)}
        readOnly={!canEdit}
        className={fieldClass}
      />
    </Field>
  );

  const errorList = Object.entries(errors).filter(([, v]) => v) as [FieldKey, string][];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link to={listPath} className={`inline-flex items-center gap-1 text-sm text-bark hover:text-copper-dark rounded ${focusRing}`}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back to research visits
      </Link>

      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-ink focus:outline-none">
        {title}
      </h1>

      <p role="status" aria-live="polite" className="sr-only">{liveMessage}</p>

      <form noValidate onSubmit={handleSubmit} className="bg-parchment border border-lichen rounded-lg p-6 space-y-6">
        {errorList.length > 0 && (
          <div role="alert" className="p-3 rounded-lg bg-semantic-error/10 border border-semantic-error/30 text-sm text-semantic-error">
            <p className="font-medium">Please correct {errorList.length === 1 ? 'this' : 'these'} before saving:</p>
            <ul className="list-disc pl-5 mt-1">
              {errorList.map(([k, msg]) => (
                <li key={k}><a href={`#${fid(k)}`} className="underline" onClick={(e) => { e.preventDefault(); fieldRefs.current[k]?.focus(); }}>{msg}</a></li>
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
          <legend className="text-lg font-semibold text-forest mb-2">Researcher</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {textInput('researcher_name', 'Name', { required: true, autoComplete: 'off' })}
            {textInput('researcher_affiliation', 'Affiliation', { hint: 'University, organization, or independent.' })}
          </div>
          <div role="group" aria-labelledby={fid('person-label')}>
            <p id={fid('person-label')} className="text-sm font-medium text-ink mb-1">Linked person record</p>
            {form.researcher_constituent_id ? (
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  to={`/organizations/${orgId}/collections/constituents/${form.researcher_constituent_id}`}
                  className={`text-bark hover:text-copper-dark rounded ${focusRing}`}
                >
                  {form.researcher_constituent_name || 'Linked person'}
                </Link>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      set('researcher_constituent_id', '');
                      set('researcher_constituent_name', '');
                      setAnnouncement('Person record unlinked. Save to keep this change.');
                    }}
                    aria-label={`Unlink person record ${form.researcher_constituent_name}`}
                    className={`btn btn-tertiary min-h-[44px] ${focusRing}`}
                  >
                    Unlink
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm text-archive mb-2">None. Optional: link the researcher to a person record.</p>
            )}
            {canEdit && !form.researcher_constituent_id && (
              <RecordSearch<{ constituent_id: string; name: string; organization_name?: string | null }>
                label="Find a person record"
                noun="person record"
                search={async (term) => (await getConstituents(orgId, { q: term, limit: 10 })).items}
                getId={(c) => c.constituent_id}
                renderItem={(c) => (
                  <>
                    <span className="font-medium">{c.name}</span>
                    {c.organization_name && <span className="text-archive"> — {c.organization_name}</span>}
                  </>
                )}
                pickText="Link"
                pickLabel={(c) => `Link ${c.name} as the researcher`}
                onPick={(c) => {
                  setForm((f) => f ? {
                    ...f,
                    researcher_constituent_id: c.constituent_id,
                    researcher_constituent_name: c.name,
                    researcher_name: f.researcher_name || c.name,
                    researcher_affiliation: f.researcher_affiliation || c.organization_name || '',
                  } : f);
                  setAnnouncement(`Linked ${c.name}. Save to keep this change.`);
                }}
              />
            )}
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-forest mb-2">Visit</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            {textInput('visit_date', 'Date', { required: true, type: 'date' })}
            {textInput('arrival_time', 'Arrival time', { type: 'time' })}
            {textInput('departure_time', 'Departure time', { type: 'time' })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {textInput('location', 'Reading room or location')}
            {textInput('supervised_by_name', 'Supervising staff member')}
          </div>
          {textInput('research_topic', 'Research topic')}
          {textArea('purpose', 'Purpose of visit')}
          <Field id={fid('use_request_id')} label="Authorising use request">
            <select
              id={fid('use_request_id')}
              value={form.use_request_id}
              onChange={(e) => set('use_request_id', e.target.value)}
              disabled={!canEdit}
              className={fieldClass}
            >
              <option value="">None</option>
              {form.use_request_id && !useRequests?.items.some((r) => r.request_id === form.use_request_id) && (
                <option value={form.use_request_id}>{visit?.use_request_number ?? 'Current use request'}</option>
              )}
              {useRequests?.items.map((r) => (
                <option key={r.request_id} value={r.request_id}>
                  {r.request_number} — {r.requester_name}
                </option>
              ))}
            </select>
          </Field>
          {!canEdit && visit?.use_request_id && (
            <Link to={`/organizations/${orgId}/collections/use-requests/${visit.use_request_id}`} className={`text-sm text-bark hover:text-copper-dark rounded ${focusRing}`}>
              View use request {visit.use_request_number}
            </Link>
          )}
          {textArea('notes', 'Notes')}
        </fieldset>

        {canEdit && (
          <div className="flex flex-wrap gap-3 justify-between">
            <button type="submit" disabled={saving} className={`btn btn-primary min-h-[44px] ${focusRing}`}>
              {saving ? 'Saving…' : isCreate ? 'Log visit' : 'Save changes'}
            </button>
            {!isCreate && (
              <button type="button" onClick={() => setConfirmDelete(true)} className={`btn btn-tertiary min-h-[44px] text-semantic-error ${focusRing}`}>
                Delete visit
              </button>
            )}
          </div>
        )}
      </form>

      {!isCreate && visit && (
        <ResearchVisitObjects orgId={orgId} visitId={visit.visit_id} objects={visit.objects ?? []} canEdit={canEdit} />
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        title="Delete this research visit?"
        message="The visit record and its list of objects used will be deleted. The objects themselves are not changed."
        confirmText="Delete visit"
        confirmStyle="danger"
      />
    </div>
  );
}
