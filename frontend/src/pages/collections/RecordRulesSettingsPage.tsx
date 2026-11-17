import { useId, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, ListChecks, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { RecordHistoryButton } from '../../components/audit/RecordHistoryButton';
import { getFriendlyErrorMessage } from '../../lib/apiClient';
import {
  createCompletenessRule,
  createRecordFlag,
  deleteCompletenessRule,
  deleteRecordFlag,
  listCompletenessRules,
  listRecordFlags,
  recomputeCompleteness,
  updateCompletenessRule,
  updateRecordFlag,
} from '../../lib/api/recordWorkflow';
import type { CheckableField, CompletenessRule, RequirementCheck, RuleRequirement } from '../../lib/api/recordWorkflow';

const fieldClass =
  'w-full px-3 py-2 text-sm border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark aria-[invalid=true]:border-semantic-error';
const iconButton =
  'min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-archive hover:text-semantic-error hover:bg-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

const CHECK_LABELS: Record<RequirementCheck, string> = {
  present: 'is filled in',
  equals: 'equals',
  one_of: 'is one of',
};

/**
 * Administrator settings: record flags (e.g. On view, Access restricted, Heavy)
 * and completeness rules. A record that meets a rule is flagged automatically;
 * a rule can also be required before a record may be published.
 */
export default function RecordRulesSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [announcement, setAnnouncement] = useState('');
  if (!orgId) return null;
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-10">
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
      <FlagsSection orgId={orgId} announce={setAnnouncement} />
      <RulesSection orgId={orgId} announce={setAnnouncement} />
    </div>
  );
}

// ── Flags ───────────────────────────────────────────────────────────────────

function FlagsSection({ orgId, announce }: { orgId: string; announce: (m: string) => void }) {
  const id = useId();
  const queryClient = useQueryClient();
  const labelRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const flagsQ = useQuery({ queryKey: ['record-flags', orgId], queryFn: () => listRecordFlags(orgId) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['record-flags', orgId] });

  const create = useMutation({
    mutationFn: () => createRecordFlag(orgId, { label, description }),
    onSuccess: (f) => {
      setLabel('');
      setDescription('');
      setError('');
      announce(`Flag “${f.label}” added`);
      refresh();
      labelRef.current?.focus();
    },
    onError: (e) => {
      const m = getFriendlyErrorMessage(e);
      setError(m);
      announce(m);
      labelRef.current?.focus();
    },
  });
  const toggleActive = useMutation({
    mutationFn: ({ flagId, active }: { flagId: string; active: boolean }) => updateRecordFlag(orgId, flagId, { is_active: active }),
    onSuccess: (f) => { announce(`“${f.label}” ${f.is_active ? 'activated' : 'deactivated'}`); refresh(); },
    onError: (e) => announce(getFriendlyErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (flagId: string) => deleteRecordFlag(orgId, flagId),
    onSuccess: (r) => { announce(`Flag deleted. Removed from ${r.removed_from_records} records.`); refresh(); labelRef.current?.focus(); },
    onError: (e) => announce(getFriendlyErrorMessage(e)),
  });

  return (
    <section aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-lg font-semibold text-ink flex items-center gap-2">
        <Flag size={20} aria-hidden="true" className="text-bark" />
        Record flags
      </h2>
      <p className="text-sm text-archive mt-1">
        Flags staff can set on object records, such as On view, Access restricted or Heavy. Flags created by a
        completeness rule are set automatically and cannot be set by hand.
      </p>

      {flagsQ.isLoading ? (
        <MadronaLoader label="Loading flags" />
      ) : (
        <table className="mt-4 w-full text-sm border border-lichen rounded-lg overflow-hidden">
          <caption className="sr-only">Record flags</caption>
          <thead className="bg-stone/50">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Flag</th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Description</th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Set by</th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Active</th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-ink"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {(flagsQ.data ?? []).length === 0 && (
              <tr><td colSpan={5} className="px-3 py-3 text-archive">No flags yet.</td></tr>
            )}
            {(flagsQ.data ?? []).map((f) => (
              <tr key={f.flag_id} className="border-t border-lichen">
                <th scope="row" className="px-3 py-2 text-left font-medium text-ink">{f.label}</th>
                <td className="px-3 py-2 text-archive">{f.description}</td>
                <td className="px-3 py-2 text-ink">{f.is_rule_managed ? 'Completeness rule' : 'Staff'}</td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={f.is_active}
                    onChange={(e) => toggleActive.mutate({ flagId: f.flag_id, active: e.target.checked })}
                    aria-label={`${f.label} active`}
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  />
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <RecordHistoryButton
                    organizationId={orgId}
                    entityType="record_flag_definition"
                    entityId={f.flag_id}
                    recordName={f.label}
                    showLabel={false}
                  />
                  {!f.is_rule_managed && (
                    <button
                      type="button"
                      className={iconButton}
                      aria-label={`Delete flag ${f.label}`}
                      onClick={() => {
                        if (window.confirm(`Delete the flag “${f.label}”? It will be removed from every record that has it.`)) {
                          remove.mutate(f.flag_id);
                        }
                      }}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form
        className="mt-4 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
        aria-labelledby={`${id}-add`}
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) {
            setError('Give the flag a name.');
            labelRef.current?.focus();
            return;
          }
          create.mutate();
        }}
      >
        <h3 id={`${id}-add`} className="sm:col-span-5 text-sm font-semibold text-ink">Add a flag</h3>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-label`} className="block text-sm font-medium text-ink mb-1">Flag name</label>
          <input
            ref={labelRef}
            id={`${id}-label`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-err` : undefined}
            className={fieldClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-desc`} className="block text-sm font-medium text-ink mb-1">
            Description <span className="font-normal text-archive">(optional)</span>
          </label>
          <input id={`${id}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} className={fieldClass} />
        </div>
        <button type="submit" disabled={create.isPending} className="btn-primary text-sm inline-flex items-center justify-center gap-1">
          <Plus size={14} aria-hidden="true" />
          Add flag
        </button>
        {error && <p id={`${id}-err`} className="sm:col-span-5 text-sm text-semantic-error">{error}</p>}
      </form>
    </section>
  );
}

// ── Rules ───────────────────────────────────────────────────────────────────

function RulesSection({ orgId, announce }: { orgId: string; announce: (m: string) => void }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CompletenessRule | 'new' | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const rulesQ = useQuery({ queryKey: ['completeness-rules', orgId], queryFn: () => listCompletenessRules(orgId) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['completeness-rules', orgId] });
    queryClient.invalidateQueries({ queryKey: ['record-flags', orgId] });
  };
  const recompute = useMutation({
    mutationFn: () => recomputeCompleteness(orgId),
    onSuccess: (r) => announce(`Checked ${r.records_checked} records against the rules. Flags updated.`),
    onError: (e) => announce(getFriendlyErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (ruleId: string) => deleteCompletenessRule(orgId, ruleId),
    onSuccess: () => { announce('Rule deleted'); refresh(); addButtonRef.current?.focus(); },
    onError: (e) => announce(getFriendlyErrorMessage(e)),
  });
  const fields = rulesQ.data?.fields ?? [];
  const fieldLabel = (f: string) => fields.find((x) => x.field === f)?.label ?? f;

  return (
    <section aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-lg font-semibold text-ink flex items-center gap-2">
        <ListChecks size={20} aria-hidden="true" className="text-bark" />
        Completeness rules
      </h2>
      <p className="text-sm text-archive mt-1">
        Rules your organization defines for a complete record. Records that meet a rule are flagged automatically
        with the rule&apos;s name. A rule can also be required before a record can be published.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button ref={addButtonRef} type="button" className="btn-primary text-sm inline-flex items-center gap-1" onClick={() => setEditing('new')}>
          <Plus size={14} aria-hidden="true" />
          Add a rule
        </button>
        <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1" onClick={() => recompute.mutate()} disabled={recompute.isPending}>
          <RefreshCw size={14} aria-hidden="true" />
          {recompute.isPending ? 'Checking records…' : 'Re-check all records'}
        </button>
      </div>

      {editing && (
        <RuleEditor
          orgId={orgId}
          rule={editing === 'new' ? null : editing}
          fields={fields}
          onClose={(message) => {
            setEditing(null);
            if (message) { announce(message); refresh(); }
            addButtonRef.current?.focus();
          }}
        />
      )}

      <ul className="mt-4 space-y-3">
        {(rulesQ.data?.items ?? []).map((r) => (
          <li key={r.rule_id} className="border border-lichen rounded-lg p-3">
            <h3 className="text-sm font-semibold text-ink">
              {r.name}
              {!r.is_active && <span className="ml-2 font-normal text-archive">(inactive)</span>}
            </h3>
            {r.description && <p className="text-sm text-archive">{r.description}</p>}
            <p className="mt-1 text-sm text-ink">
              Sets the flag “{r.flag_label}”.{r.required_for_publication ? ' Required before publishing.' : ''}
            </p>
            <ul className="mt-1 ml-5 list-disc text-sm text-ink">
              {r.requirements.map((q, i) => (
                <li key={i}>
                  {fieldLabel(q.field)} {CHECK_LABELS[q.check]}
                  {q.check !== 'present' && <> “{Array.isArray(q.value) ? q.value.join(', ') : q.value}”</>}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={() => setEditing(r)} aria-label={`Edit rule ${r.name}`}>
                Edit
              </button>
              <button
                type="button"
                className="btn-tertiary text-sm"
                aria-label={`Delete rule ${r.name}`}
                onClick={() => {
                  if (window.confirm(`Delete the rule “${r.name}”? Its flag will be removed from records.`)) remove.mutate(r.rule_id);
                }}
              >
                Delete
              </button>
              <RecordHistoryButton
                organizationId={orgId}
                entityType="completeness_rule"
                entityId={r.rule_id}
                recordName={r.name}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RuleEditor({
  orgId, rule, fields, onClose,
}: { orgId: string; rule: CompletenessRule | null; fields: CheckableField[]; onClose: (message?: string) => void }) {
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(rule?.name ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [required, setRequired] = useState(rule?.required_for_publication ?? false);
  const [active, setActive] = useState(rule?.is_active ?? true);
  const [reqs, setReqs] = useState<RuleRequirement[]>(rule?.requirements ?? [{ field: 'title', check: 'present' }]);
  const [error, setError] = useState('');
  const rowRefs = useRef<(HTMLSelectElement | null)[]>([]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name, description, required_for_publication: required, is_active: active,
        requirements: reqs.map((r) => ({
          ...r,
          value: r.check === 'one_of' && typeof r.value === 'string' ? r.value.split(',').map((v) => v.trim()).filter(Boolean) : r.value,
        })),
      };
      return rule ? updateCompletenessRule(orgId, rule.rule_id, body) : createCompletenessRule(orgId, body);
    },
    onSuccess: (r) => onClose(rule ? `Rule “${r.name}” saved` : `Rule “${r.name}” added. Use Re-check all records to apply it to existing records.`),
    onError: (e) => { setError(getFriendlyErrorMessage(e)); nameRef.current?.focus(); },
  });

  const update = (i: number, patch: Partial<RuleRequirement>) =>
    setReqs(reqs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <form
      className="mt-4 border border-bark/30 rounded-lg p-4 space-y-4 bg-parchment-warm"
      aria-labelledby={`${id}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) { setError('Give the rule a name.'); nameRef.current?.focus(); return; }
        save.mutate();
      }}
    >
      <h3 id={`${id}-title`} className="text-sm font-semibold text-ink">{rule ? `Edit rule ${rule.name}` : 'New completeness rule'}</h3>
      {error && <p id={`${id}-err`} role="alert" className="text-sm text-semantic-error">{error}</p>}
      <div>
        <label htmlFor={`${id}-name`} className="block text-sm font-medium text-ink mb-1">Rule name</label>
        <input ref={nameRef} id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off"
          aria-invalid={!!error && !name.trim()} aria-describedby={error ? `${id}-err` : `${id}-name-hint`} className={fieldClass} />
        <p id={`${id}-name-hint`} className="mt-1 text-xs text-accessible-gray">Also used as the name of the flag records receive, e.g. “Ready to publish”.</p>
      </div>
      <div>
        <label htmlFor={`${id}-desc`} className="block text-sm font-medium text-ink mb-1">Description <span className="font-normal text-archive">(optional)</span></label>
        <input id={`${id}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} className={fieldClass} />
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-ink">A record meets this rule when</legend>
        <ol className="mt-2 space-y-3">
          {reqs.map((r, i) => {
            const n = i + 1;
            const f = fields.find((x) => x.field === r.field);
            const checks = f?.checks ?? ['present'];
            return (
              <li key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                <div className="sm:col-span-5">
                  <label htmlFor={`${id}-f-${i}`} className="block text-xs font-medium text-archive mb-1">Requirement {n} field</label>
                  <select
                    ref={(el) => { rowRefs.current[i] = el; }}
                    id={`${id}-f-${i}`}
                    value={r.field}
                    onChange={(e) => update(i, { field: e.target.value, check: 'present', value: undefined })}
                    className={fieldClass}
                  >
                    {fields.map((x) => <option key={x.field} value={x.field}>{x.label}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <label htmlFor={`${id}-c-${i}`} className="block text-xs font-medium text-archive mb-1">Requirement {n} check</label>
                  <select id={`${id}-c-${i}`} value={r.check} onChange={(e) => update(i, { check: e.target.value as RequirementCheck })} className={fieldClass}>
                    {checks.map((c) => <option key={c} value={c}>{CHECK_LABELS[c]}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-3">
                  {r.check !== 'present' && (
                    <>
                      <label htmlFor={`${id}-v-${i}`} className="block text-xs font-medium text-archive mb-1">
                        Requirement {n} value{r.check === 'one_of' ? 's, separated by commas' : ''}
                      </label>
                      <input id={`${id}-v-${i}`} value={Array.isArray(r.value) ? r.value.join(', ') : r.value ?? ''}
                        onChange={(e) => update(i, { value: e.target.value })} className={fieldClass} />
                    </>
                  )}
                </div>
                <div className="sm:col-span-1">
                  {reqs.length > 1 && (
                    <button type="button" className={iconButton} aria-label={`Remove requirement ${n}`}
                      onClick={() => {
                        setReqs(reqs.filter((_, idx) => idx !== i));
                        requestAnimationFrame(() => rowRefs.current[Math.max(0, i - 1)]?.focus());
                      }}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <button type="button" className="mt-2 btn-tertiary text-sm inline-flex items-center gap-1"
          onClick={() => {
            setReqs([...reqs, { field: 'brief_description', check: 'present' }]);
            requestAnimationFrame(() => rowRefs.current[reqs.length]?.focus());
          }}>
          <Plus size={14} aria-hidden="true" />
          Add requirement
        </button>
      </fieldset>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Required before a record can be published
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Rule is active
        </label>
      </div>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary text-sm" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save rule'}</button>
        <button type="button" className="btn-secondary text-sm" onClick={() => onClose()}>Cancel</button>
      </div>
    </form>
  );
}
