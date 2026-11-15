import { useId, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListPlus, Plus } from 'lucide-react';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { RecordHistoryButton } from '../../components/audit/RecordHistoryButton';
import { getFriendlyErrorMessage } from '../../lib/apiClient';
import {
  FIELD_TYPE_LABELS,
  createCustomField,
  deactivateCustomField,
  listCustomFields,
  updateCustomField,
} from '../../lib/api/customFields';
import type { CustomFieldDefinition, CustomFieldType } from '../../lib/api/customFields';

const fieldClass =
  'w-full px-3 py-2 text-sm border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark aria-[invalid=true]:border-semantic-error';

/** Roles offered for field-level permissions (system roles; custom role ids may also be stored). */
const ROLE_OPTIONS = [
  { value: 'registrar', label: 'Registrar' },
  { value: 'curator', label: 'Curator' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'viewer', label: 'Viewer' },
];

/** Administrator page: user-defined fields on object records. */
export default function CustomFieldsSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const addRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState<CustomFieldDefinition | 'new' | null>(null);
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['custom-fields-admin', orgId], queryFn: () => listCustomFields(orgId!, true), enabled: !!orgId });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['custom-fields-admin', orgId] });
    queryClient.invalidateQueries({ queryKey: ['custom-fields', orgId] });
  };
  const deactivate = useMutation({
    mutationFn: (f: CustomFieldDefinition) => deactivateCustomField(orgId!, f.field_id),
    onSuccess: (_r, f) => { setStatus(`${f.label} deactivated. Values already recorded are kept.`); refresh(); addRef.current?.focus(); },
    onError: (e) => setStatus(getFriendlyErrorMessage(e)),
  });

  if (!orgId) return null;
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <ListPlus size={20} aria-hidden="true" className="text-bark" />
          Additional fields
        </h2>
        <p className="text-sm text-archive mt-1">
          Fields your organization adds to object records. Each field can be searchable, shown on the public portal,
          and limited to certain roles for viewing or editing.
        </p>
      </div>
      <div role="status" aria-live="polite" className="sr-only">{status}</div>

      <button ref={addRef} type="button" className="btn-primary text-sm inline-flex items-center gap-1" onClick={() => setEditing('new')}>
        <Plus size={14} aria-hidden="true" />
        Add a field
      </button>

      {editing && (
        <FieldEditor
          orgId={orgId}
          field={editing === 'new' ? null : editing}
          onClose={(message) => {
            setEditing(null);
            if (message) { setStatus(message); refresh(); }
            requestAnimationFrame(() => addRef.current?.focus());
          }}
        />
      )}

      {q.isLoading ? <MadronaLoader label="Loading fields" /> : (
        <table className="w-full text-sm border border-lichen rounded-lg overflow-hidden">
          <caption className="sr-only">Additional fields</caption>
          <thead className="bg-stone/50">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Field</th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Type</th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Options</th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Status</th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-ink"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).length === 0 && <tr><td colSpan={5} className="px-3 py-3 text-archive">No additional fields yet.</td></tr>}
            {(q.data ?? []).map((f) => (
              <tr key={f.field_id} className="border-t border-lichen">
                <th scope="row" className="px-3 py-2 text-left font-medium text-ink">{f.label}</th>
                <td className="px-3 py-2 text-ink">{FIELD_TYPE_LABELS[f.field_type]}</td>
                <td className="px-3 py-2 text-ink">
                  {[f.is_required && 'Required', f.is_searchable && 'Searchable', f.is_public && 'Public',
                    f.view_roles.length ? `Visible to ${f.view_roles.join(', ')}` : null,
                    f.edit_roles.length ? `Editable by ${f.edit_roles.join(', ')}` : null].filter(Boolean).join('; ') || 'None'}
                </td>
                <td className="px-3 py-2 text-ink">{f.is_active ? 'Active' : 'Inactive'}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <button type="button" className="btn-secondary text-sm" aria-label={`Edit ${f.label}`} onClick={() => setEditing(f)}>Edit</button>
                    {f.is_active && (
                      <button type="button" className="btn-tertiary text-sm" aria-label={`Deactivate ${f.label}`}
                        onClick={() => { if (window.confirm(`Deactivate “${f.label}”? Values already recorded are kept.`)) deactivate.mutate(f); }}>
                        Deactivate
                      </button>
                    )}
                    <RecordHistoryButton
                      organizationId={orgId}
                      entityType="custom_field_definition"
                      entityId={f.field_id}
                      recordName={f.label}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RoleCheckboxes({ legend, value, onChange, hint }: { legend: string; value: string[]; onChange: (v: string[]) => void; hint: string }) {
  const id = useId();
  return (
    <fieldset aria-describedby={`${id}-hint`}>
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      <p id={`${id}-hint`} className="text-xs text-accessible-gray">{hint}</p>
      <div className="mt-1 flex flex-wrap gap-4">
        {ROLE_OPTIONS.map((r) => (
          <label key={r.value} className="flex items-center gap-2 text-sm text-ink min-h-[24px]">
            <input type="checkbox" checked={value.includes(r.value)}
              onChange={(e) => onChange(e.target.checked ? [...value, r.value] : value.filter((x) => x !== r.value))} />
            {r.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function FieldEditor({ orgId, field, onClose }: { orgId: string; field: CustomFieldDefinition | null; onClose: (message?: string) => void }) {
  const id = useId();
  const labelRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState(field?.label ?? '');
  const [type, setType] = useState<CustomFieldType>(field?.field_type ?? 'text');
  const [options, setOptions] = useState((field?.options ?? []).join('\n'));
  const [help, setHelp] = useState(field?.help_text ?? '');
  const [required, setRequired] = useState(field?.is_required ?? false);
  const [searchable, setSearchable] = useState(field?.is_searchable ?? true);
  const [isPublic, setIsPublic] = useState(field?.is_public ?? false);
  const [viewRoles, setViewRoles] = useState<string[]>(field?.view_roles ?? []);
  const [editRoles, setEditRoles] = useState<string[]>(field?.edit_roles ?? []);
  const [error, setError] = useState('');
  const needsOptions = type === 'select' || type === 'multi_select';

  const save = useMutation({
    mutationFn: () => {
      const body: Partial<CustomFieldDefinition> & { options?: string[] } = {
        label, help_text: help, is_required: required, is_searchable: searchable, is_public: isPublic,
        view_roles: viewRoles, edit_roles: editRoles,
        options: needsOptions ? options.split('\n').map((o) => o.trim()).filter(Boolean) : [],
      };
      if (!field) body.field_type = type;
      return field ? updateCustomField(orgId, field.field_id, body) : createCustomField(orgId, body);
    },
    onSuccess: (f) => onClose(field ? `${f.label} saved` : `${f.label} added`),
    onError: (e) => { setError(getFriendlyErrorMessage(e)); labelRef.current?.focus(); },
  });

  return (
    <form className="border border-bark/30 rounded-lg p-4 space-y-4 bg-parchment-warm" aria-labelledby={`${id}-h`}
      onSubmit={(e) => { e.preventDefault(); if (!label.trim()) { setError('Give the field a name.'); labelRef.current?.focus(); return; } save.mutate(); }}>
      <h3 id={`${id}-h`} className="text-sm font-semibold text-ink">{field ? `Edit ${field.label}` : 'New field'}</h3>
      {error && <p id={`${id}-err`} role="alert" className="text-sm text-semantic-error">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${id}-label`} className="block text-sm font-medium text-ink mb-1">Field name</label>
          <input ref={labelRef} id={`${id}-label`} value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off"
            aria-invalid={!!error && !label.trim()} aria-describedby={error ? `${id}-err` : undefined} className={fieldClass} />
        </div>
        <div>
          <label htmlFor={`${id}-type`} className="block text-sm font-medium text-ink mb-1">Type</label>
          <select id={`${id}-type`} value={type} disabled={!!field} aria-describedby={field ? `${id}-type-hint` : undefined}
            onChange={(e) => setType(e.target.value as CustomFieldType)} className={fieldClass}>
            {(Object.keys(FIELD_TYPE_LABELS) as CustomFieldType[]).map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
          </select>
          {field && <p id={`${id}-type-hint`} className="mt-1 text-xs text-accessible-gray">The type cannot change once a field exists.</p>}
        </div>
      </div>
      {needsOptions && (
        <div>
          <label htmlFor={`${id}-opts`} className="block text-sm font-medium text-ink mb-1">Choices, one per line</label>
          <textarea id={`${id}-opts`} rows={4} value={options} onChange={(e) => setOptions(e.target.value)} className={fieldClass} />
        </div>
      )}
      <div>
        <label htmlFor={`${id}-help`} className="block text-sm font-medium text-ink mb-1">Help text <span className="font-normal text-archive">(optional)</span></label>
        <input id={`${id}-help`} value={help} onChange={(e) => setHelp(e.target.value)} className={fieldClass} />
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-ink">Options</legend>
        <div className="mt-1 space-y-1">
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />Required</label>
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={searchable} onChange={(e) => setSearchable(e.target.checked)} />Searchable</label>
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />Shown on the public portal</label>
        </div>
      </fieldset>
      <RoleCheckboxes legend="Who can see this field" value={viewRoles} onChange={setViewRoles}
        hint="Leave all unticked for everyone who can view objects. Administrators can always see it." />
      <RoleCheckboxes legend="Who can edit this field" value={editRoles} onChange={setEditRoles}
        hint="Leave all unticked for everyone who can edit objects. Administrators can always edit it." />
      <div className="flex gap-2">
        <button type="submit" className="btn-primary text-sm" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save field'}</button>
        <button type="button" className="btn-secondary text-sm" onClick={() => onClose()}>Cancel</button>
      </div>
    </form>
  );
}
