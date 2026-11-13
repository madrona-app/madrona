import { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListPlus } from 'lucide-react';
import { ApiError, getFriendlyErrorMessage } from '../../lib/apiClient';
import { listCustomFields, saveObjectCustomFields } from '../../lib/api/customFields';
import type { CustomFieldDefinition, CustomFieldValues } from '../../lib/api/customFields';

const fieldClass =
  'w-full px-3 py-2 text-sm border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark aria-[invalid=true]:border-semantic-error';

function display(d: CustomFieldDefinition, v: CustomFieldValues[string] | undefined): string {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return 'Not recorded';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (d.field_type === 'date' && typeof v === 'string') {
    const dt = new Date(`${v}T00:00:00`);
    return Number.isNaN(dt.getTime()) ? v : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }
  return String(v);
}

interface Props {
  orgId: string;
  objectId: string;
  values: CustomFieldValues | null | undefined;
  canEdit: boolean;
}

/**
 * The organization's user-defined fields on an object record.
 *
 * Read view is a description list; edit view uses native controls with a
 * visible label each, help text tied by aria-describedby, choice lists as a
 * fieldset of checkboxes, and server errors placed on the field they belong
 * to with focus moved there. Fields the user's role cannot edit are shown as
 * text, and fields it cannot view never reach the browser.
 */
export function CustomFieldsPanel({ orgId, objectId, values, canEdit }: Props) {
  const id = useId();
  const queryClient = useQueryClient();
  const defsQ = useQuery({ queryKey: ['custom-fields', orgId], queryFn: () => listCustomFields(orgId) });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CustomFieldValues>({});
  const [errors, setErrors] = useState<{ key: string | null; message: string } | null>(null);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!editing) setDraft({ ...(values ?? {}) }); }, [values, editing]);

  const defs = defsQ.data ?? [];
  if (defs.length === 0) return null;
  const editable = defs.filter((d) => d.can_edit !== false);

  const save = async () => {
    setSaving(true);
    setErrors(null);
    const changed: CustomFieldValues = {};
    for (const d of editable) {
      const before = (values ?? {})[d.key] ?? null;
      const after = draft[d.key] ?? null;
      if (JSON.stringify(before) !== JSON.stringify(after)) changed[d.key] = after;
    }
    try {
      if (Object.keys(changed).length) await saveObjectCustomFields(orgId, objectId, changed);
      setEditing(false);
      setStatus('Additional fields saved');
      queryClient.invalidateQueries({ queryKey: ['collection-object', orgId, objectId] });
    } catch (e) {
      const field = e instanceof ApiError ? String(e.details?.field ?? '') : '';
      const key = field.startsWith('custom_fields.') ? field.slice('custom_fields.'.length) : null;
      const message = getFriendlyErrorMessage(e);
      setErrors({ key, message });
      setStatus(message);
      requestAnimationFrame(() => document.getElementById(key ? `${id}-${key}` : `${id}-error`)?.focus());
    } finally {
      setSaving(false);
    }
  };

  const set = (key: string, v: CustomFieldValues[string]) => setDraft((d) => ({ ...d, [key]: v }));

  return (
    <section aria-labelledby={`${id}-h`} className="bg-parchment-warm border border-lichen rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`${id}-h`} className="text-base font-semibold text-ink flex items-center gap-2">
          <ListPlus size={18} aria-hidden="true" className="text-forest" />
          Additional fields
        </h2>
        {canEdit && editable.length > 0 && !editing && (
          <button type="button" className="btn-secondary text-sm" onClick={() => setEditing(true)}>Edit additional fields</button>
        )}
      </div>
      <div role="status" aria-live="polite" className="sr-only">{status}</div>

      {!editing ? (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {defs.map((d) => (
            <div key={d.key}>
              <dt className="text-archive">{d.label}</dt>
              <dd className="text-ink mt-0.5">
                {d.field_type === 'url' && typeof values?.[d.key] === 'string' ? (
                  <a href={String(values?.[d.key])} target="_blank" rel="noopener noreferrer"
                    className="text-bark hover:text-copper-dark underline underline-offset-2">
                    {String(values?.[d.key])}<span className="sr-only">, opens in a new tab</span>
                  </a>
                ) : display(d, values?.[d.key])}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-4" noValidate>
          {errors && !errors.key && (
            <p id={`${id}-error`} tabIndex={-1} role="alert" className="text-sm text-semantic-error">{errors.message}</p>
          )}
          {defs.map((d) => {
            const fid = `${id}-${d.key}`;
            const help = d.help_text ? `${fid}-help` : undefined;
            const err = errors?.key === d.key ? `${fid}-err` : undefined;
            const describedBy = [help, err].filter(Boolean).join(' ') || undefined;
            const v = draft[d.key];
            const readOnly = d.can_edit === false;
            const labelEl = (
              <>
                {d.label}
                {d.is_required && <span className="text-archive font-normal"> (required)</span>}
                {readOnly && <span className="text-archive font-normal"> (read only for your role)</span>}
              </>
            );
            if (readOnly) {
              return (
                <div key={d.key}>
                  <p className="text-sm font-medium text-ink">{labelEl}</p>
                  <p className="text-sm text-ink">{display(d, values?.[d.key])}</p>
                </div>
              );
            }
            if (d.field_type === 'multi_select') {
              const chosen = Array.isArray(v) ? v : [];
              return (
                <fieldset key={d.key} aria-describedby={describedBy}>
                  <legend className="text-sm font-medium text-ink">{labelEl}</legend>
                  <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {d.options.map((o, i) => (
                      <label key={o} className="flex items-center gap-2 text-sm text-ink min-h-[24px]">
                        <input id={i === 0 ? fid : undefined} type="checkbox" checked={chosen.includes(o)}
                          onChange={(e) => set(d.key, e.target.checked ? [...chosen, o] : chosen.filter((x) => x !== o))} />
                        {o}
                      </label>
                    ))}
                  </div>
                  {d.help_text && <p id={help} className="mt-1 text-xs text-accessible-gray">{d.help_text}</p>}
                  {err && <p id={err} className="mt-1 text-xs text-semantic-error">{errors?.message}</p>}
                </fieldset>
              );
            }
            const common = {
              id: fid,
              'aria-describedby': describedBy,
              'aria-invalid': !!err,
              'aria-required': d.is_required || undefined,
              className: fieldClass,
            };
            let control;
            if (d.field_type === 'long_text') {
              control = <textarea {...common} rows={3} value={String(v ?? '')} onChange={(e) => set(d.key, e.target.value)} />;
            } else if (d.field_type === 'select') {
              control = (
                <select {...common} value={String(v ?? '')} onChange={(e) => set(d.key, e.target.value || null)}>
                  <option value="">Not recorded</option>
                  {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              );
            } else if (d.field_type === 'boolean') {
              control = (
                <select {...common} value={v === true ? 'yes' : v === false ? 'no' : ''}
                  onChange={(e) => set(d.key, e.target.value === '' ? null : e.target.value === 'yes')}>
                  <option value="">Not recorded</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              );
            } else {
              const type = d.field_type === 'number' ? 'number' : d.field_type === 'date' ? 'date' : d.field_type === 'url' ? 'url' : 'text';
              control = <input {...common} type={type} value={String(v ?? '')} onChange={(e) => set(d.key, e.target.value)} />;
            }
            return (
              <div key={d.key}>
                <label htmlFor={fid} className="block text-sm font-medium text-ink mb-1">{labelEl}</label>
                {control}
                {d.help_text && <p id={help} className="mt-1 text-xs text-accessible-gray">{d.help_text}</p>}
                {err && <p id={err} className="mt-1 text-xs text-semantic-error">{errors?.message}</p>}
              </div>
            );
          })}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm" disabled={saving}>{saving ? 'Saving…' : 'Save additional fields'}</button>
            <button type="button" className="btn-secondary text-sm" onClick={() => { setEditing(false); setErrors(null); }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
