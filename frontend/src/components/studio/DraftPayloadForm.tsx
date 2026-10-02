import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { MadronaLoader } from '../ui/MadronaLoader';
import { getDraftFormSchema, type DraftFormField } from '../../lib/api/drafts';
import { StudioEntityPicker } from './StudioEntityPicker';

/**
 * DraftPayloadForm — renders a draft's payload as a real, editable form
 * (labeled, typed, sectioned fields) instead of raw JSON. Field shape comes
 * from the backend draft form-schema (the entity's proposable fields + form
 * registry labels/types). Empty fields are NOT written — a cleared field is
 * dropped from the payload, never defaulted, so the form never fabricates a
 * value the reviewer didn't enter.
 *
 * If the schema can't load, it reports via onUnavailable so the caller can fall
 * back to the raw-JSON editor.
 */
interface DraftPayloadFormProps {
  entityType: string;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
  onUnavailable?: () => void;
}

export function DraftPayloadForm({
  entityType,
  value,
  onChange,
  disabled,
  onUnavailable,
}: DraftPayloadFormProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['draft-form-schema', orgId, entityType],
    queryFn: () => getDraftFormSchema(orgId as string, entityType),
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });

  // Sections in first-seen order.
  const grouped = useMemo(() => {
    const out: { section: string; fields: DraftFormField[] }[] = [];
    for (const f of data?.fields ?? []) {
      let g = out.find((s) => s.section === f.section);
      if (!g) { g = { section: f.section, fields: [] }; out.push(g); }
      g.fields.push(f);
    }
    return out;
  }, [data]);

  function setField(name: string, v: unknown) {
    const next = { ...value };
    // Never write an empty value — drop the key so nothing is fabricated.
    if (v === '' || v === undefined || v === null) delete next[name];
    else next[name] = v;
    onChange(next);
  }

  const unavailable = isError || (!isLoading && !data);
  useEffect(() => {
    if (unavailable) onUnavailable?.();
  }, [unavailable, onUnavailable]);

  if (isLoading) {
    return <div className="py-3"><MadronaLoader variant="inline" label="Loading form…" /></div>;
  }
  if (unavailable) {
    return <p className="text-xs text-archive py-2">Form unavailable for this type — edit as JSON.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {grouped.map((group) => (
        <fieldset key={group.section} className="flex flex-col gap-3">
          <legend className="text-[11px] uppercase tracking-wide text-archive">
            {group.section === 'Details' ? 'Details' : group.section.replace(/[-_]/g, ' ')}
          </legend>
          {group.fields.map((f) => (
            <DraftField
              key={f.name}
              field={f}
              orgId={orgId as string}
              value={value[f.name]}
              disabled={disabled}
              onChange={(v) => setField(f.name, v)}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function DraftField({
  field,
  orgId,
  value,
  onChange,
  disabled,
}: {
  field: DraftFormField;
  orgId: string;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const id = `df-${field.name}`;
  const base =
    'w-full rounded-md border border-lichen bg-parchment-warm px-3 py-2 text-sm text-ink ' +
    'focus-visible:ring-2 ring-bark/30 ring-offset-2 outline-none disabled:opacity-70';
  const str = value == null ? '' : String(value);

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">
        {field.label}
        {field.required && <span className="text-bark"> *</span>}
      </label>
      {field.type === 'reference' ? (
        <StudioEntityPicker
          id={id}
          orgId={orgId}
          entityKind={field.reference_kind ?? 'object'}
          value={typeof value === 'string' ? value : undefined}
          disabled={disabled}
          onChange={(v) => onChange(v ?? '')}
        />
      ) : field.type === 'enum' ? (
        <select id={id} value={str} disabled={disabled} className={base}
          onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(field.enum_values ?? []).map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
        </select>
      ) : field.type === 'boolean' ? (
        <input id={id} type="checkbox" checked={value === true} disabled={disabled}
          className="accent-bark h-4 w-4" onChange={(e) => onChange(e.target.checked)} />
      ) : field.type === 'textarea' || field.type === 'json' ? (
        <textarea id={id} value={field.type === 'json' ? jsonStr(value) : str}
          disabled={disabled} rows={field.type === 'json' ? 4 : 3}
          spellCheck={field.type !== 'json'}
          className={`${base} ${field.type === 'json' ? 'font-mono text-xs' : ''}`}
          onChange={(e) => onChange(field.type === 'json' ? parseJson(e.target.value) : e.target.value)} />
      ) : (
        <input id={id}
          type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
          value={str} disabled={disabled} className={base}
          onChange={(e) => onChange(
            field.type === 'number'
              ? (e.target.value === '' ? '' : Number(e.target.value))
              : e.target.value,
          )} />
      )}
      {field.lookup_category && (
        <p className="text-[11px] text-archive mt-1">Reference: a {field.lookup_category} id</p>
      )}
    </div>
  );
}

function jsonStr(v: unknown): string {
  if (v == null) return '';
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}
function parseJson(s: string): unknown {
  if (s.trim() === '') return '';
  try { return JSON.parse(s); } catch { return s; } // keep the raw text until valid
}

export default DraftPayloadForm;
