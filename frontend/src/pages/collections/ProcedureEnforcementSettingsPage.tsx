import { useEffect, useId, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, ShieldCheck, ShieldOff, X } from 'lucide-react';
import { apiFetch, getFriendlyErrorMessage } from '../../lib/apiClient';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { useToast } from '../../contexts/ToastContext';
import { cn } from '../../lib/utils';

interface FieldOption {
  field: string;
  label: string;
}

interface BaselineRequirement {
  id: string;
  label: string;
  fields: string[];
  required_for_statuses: string[];
}

interface ProcedureInfo {
  enabled: boolean;
  label: string;
  requirement_count: number;
  blocking_count: number;
  supports_org_required_fields?: boolean;
  baseline_required_fields?: BaselineRequirement[];
  org_required_fields?: FieldOption[];
  eligible_fields?: FieldOption[];
  first_status?: string | null;
}

type SettingsResponse = { procedures: Record<string, ProcedureInfo> };

const humanizeStatus = (s: string) => {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export default function ProcedureEnforcementSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery<SettingsResponse>({
    queryKey: ['procedure-enforcement', orgId],
    queryFn: () => apiFetch(`/organizations/${orgId}/settings/procedure-enforcement`),
    enabled: !!orgId,
  });

  const mutation = useMutation({
    mutationFn: (updates: Record<string, boolean>) =>
      apiFetch(`/organizations/${orgId}/settings/procedure-enforcement`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['procedure-enforcement', orgId] });
      // Also invalidate cached requirements so enforcement flag refreshes
      queryClient.invalidateQueries({ queryKey: ['procedure-requirements'] });
      showToast({ title: 'Enforcement settings updated', type: 'success' });
    },
    onError: (error) => {
      showToast({ title: `Failed to update: ${(error as Error).message}`, type: 'error' });
    },
  });

  const toggleProcedure = (procedureType: string, enabled: boolean) => {
    mutation.mutate({ [procedureType]: enabled });
  };

  // Write the server's updated entry for one procedure into the cache.
  const applyProcedureUpdate = (procedureType: string, info: ProcedureInfo) => {
    queryClient.setQueryData<SettingsResponse>(['procedure-enforcement', orgId], (prev) =>
      prev ? { procedures: { ...prev.procedures, [procedureType]: { ...prev.procedures[procedureType], ...info } } } : prev,
    );
    queryClient.invalidateQueries({ queryKey: ['procedure-requirements'] });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading..." />
      </div>
    );
  }

  const procedures = data?.procedures || {};
  const sortedProcedures = Object.entries(procedures).sort(([, a], [, b]) => a.label.localeCompare(b.label));

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <Shield size={20} className="text-bark" aria-hidden="true" />
          Procedure Enforcement
        </h2>
        <p className="text-sm text-archive mt-1">
          Control whether procedure requirements block status transitions.
          When enforcement is off, requirements are shown as advisory warnings but don't prevent advancement.
        </p>
      </div>

      <div role="status" aria-live="polite" className="sr-only">{status}</div>

      <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
        <table className="w-full">
          <caption className="sr-only">Enforcement by procedure</caption>
          <thead className="bg-stone/50">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Procedure</th>
              <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-ink">Requirements</th>
              <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-ink">Blocking</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-ink">Enforcement</th>
            </tr>
          </thead>
          <tbody>
            {sortedProcedures.map(([procedureType, info]) => (
              <tr key={procedureType} className="border-t border-lichen">
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <div className="flex items-center gap-2">
                    {info.enabled ? (
                      <ShieldCheck size={16} className="text-semantic-success" aria-hidden="true" />
                    ) : (
                      <ShieldOff size={16} className="text-archive" aria-hidden="true" />
                    )}
                    <span className="text-sm font-medium text-ink">{info.label}</span>
                  </div>
                </th>
                <td className="px-4 py-3 text-center text-sm text-archive">
                  {info.requirement_count}
                </td>
                <td className="px-4 py-3 text-center text-sm text-archive">
                  {info.blocking_count}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleProcedure(procedureType, !info.enabled)}
                    disabled={mutation.isPending}
                    aria-pressed={info.enabled}
                    aria-label={`Enforce ${info.label}`}
                    className={cn(
                      'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2',
                      info.enabled ? 'bg-semantic-success' : 'bg-stone'
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'inline-block h-4 w-4 transform rounded-full bg-parchment transition-transform',
                        info.enabled ? 'translate-x-6' : 'translate-x-1'
                      )}
                    />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-archive mt-4">
        When enforcement is enabled, staff cannot advance a record past a status gate without completing all blocking requirements.
        Requirements are still visible when enforcement is off — they serve as guidance without blocking workflow.
      </p>

      {sortedProcedures.length > 0 && (
        <div className="mt-8">
          <h3 className="text-base font-semibold text-ink">Required fields by procedure</h3>
          <p className="text-sm text-archive mt-1">
            Each procedure has a fixed set of required fields. You can require more fields on top of it,
            and remove the ones you added. Added fields are enforced together with the fixed set while
            enforcement is on for that procedure.
          </p>
          <div className="mt-4 flex flex-col gap-4">
            {sortedProcedures.map(([procedureType, info]) => (
              <ProcedureRequiredFields
                key={procedureType}
                orgId={orgId!}
                procedureType={procedureType}
                info={info}
                onUpdated={(updated) => applyProcedureUpdate(procedureType, updated)}
                announce={setStatus}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ProcedureRequiredFieldsProps {
  orgId: string;
  procedureType: string;
  info: ProcedureInfo;
  onUpdated: (info: ProcedureInfo) => void;
  announce: (message: string) => void;
}

function ProcedureRequiredFields({ orgId, procedureType, info, onUpdated, announce }: ProcedureRequiredFieldsProps) {
  const uid = useId();
  const headingId = `${uid}-heading`;
  const baselineId = `${uid}-baseline`;
  const addedId = `${uid}-added`;
  const selectId = `${uid}-select`;
  const hintId = `${uid}-hint`;
  const errorId = `${uid}-error`;
  const [choice, setChoice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const removeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // After a change re-renders the lists, focus this field's Remove button,
  // or the field select when the target is gone.
  const focusTarget = useRef<{ field: string | null } | null>(null);

  const baseline = info.baseline_required_fields ?? [];
  const added = info.org_required_fields ?? [];
  const eligible = info.eligible_fields ?? [];
  const supports = !!info.supports_org_required_fields;

  const addedFromServer = info.org_required_fields;
  useEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    focusTarget.current = null;
    const el = (target.field && removeRefs.current.get(target.field)) || selectRef.current;
    el?.focus();
  }, [addedFromServer]);

  const basePath = `/organizations/${orgId}/settings/procedure-enforcement/${procedureType}/required-fields`;

  const addMutation = useMutation({
    mutationFn: (field: string) =>
      apiFetch<ProcedureInfo>(basePath, { method: 'POST', body: JSON.stringify({ field }) }),
    onSuccess: (updated, field) => {
      const label = eligible.find((f) => f.field === field)?.label ?? field;
      setChoice('');
      setError(null);
      focusTarget.current = { field: null };
      onUpdated(updated);
      announce(`${label} is now required for ${info.label}.`);
    },
    onError: (e) => {
      const message = getFriendlyErrorMessage(e);
      setError(message);
      announce(`Could not add the field: ${message}`);
      selectRef.current?.focus();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (field: string) =>
      apiFetch<ProcedureInfo>(`${basePath}/${encodeURIComponent(field)}`, { method: 'DELETE' }),
    onSuccess: (updated, field) => {
      const index = added.findIndex((f) => f.field === field);
      const label = added[index]?.label ?? field;
      const remaining = added.filter((f) => f.field !== field);
      const next = remaining[Math.min(index, remaining.length - 1)];
      focusTarget.current = { field: next ? next.field : null };
      onUpdated(updated);
      announce(`${label} is no longer required for ${info.label}.`);
    },
    onError: (e) => {
      announce(`Could not remove the field: ${getFriendlyErrorMessage(e)}`);
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!choice) {
      setError('Choose a field to add.');
      selectRef.current?.focus();
      return;
    }
    addMutation.mutate(choice);
  };

  return (
    <section aria-labelledby={headingId} className="bg-parchment border border-lichen rounded-lg p-4">
      <h4 id={headingId} className="text-sm font-semibold text-ink">
        {info.label} required fields
      </h4>

      <p id={baselineId} className="mt-3 text-xs font-medium text-archive uppercase tracking-wide">
        Fixed required fields
      </p>
      {baseline.length > 0 ? (
        <ul aria-labelledby={baselineId} className="mt-1 list-disc pl-5 text-sm text-ink">
          {baseline.map((req) => (
            <li key={req.id}>{req.label}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-archive">None</p>
      )}

      {supports ? (
        <>
          <p id={addedId} className="mt-4 text-xs font-medium text-archive uppercase tracking-wide">
            Added by your organization
          </p>
          {added.length > 0 ? (
            <ul aria-labelledby={addedId} className="mt-1 flex flex-col gap-1">
              {added.map((f) => (
                <li key={f.field} className="flex items-center justify-between gap-2 text-sm text-ink">
                  <span>{f.label}</span>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) removeRefs.current.set(f.field, el);
                      else removeRefs.current.delete(f.field);
                    }}
                    onClick={() => removeMutation.mutate(f.field)}
                    disabled={removeMutation.isPending}
                    aria-label={`Remove required field ${f.label} from ${info.label}`}
                    className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] text-archive hover:text-semantic-error rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:opacity-50"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-archive">None added</p>
          )}

          <form onSubmit={handleAdd} className="mt-4" noValidate>
            <label htmlFor={selectId} className="block text-sm font-medium text-ink mb-1">
              Field to require
            </label>
            <p id={hintId} className="text-xs text-archive mb-1.5">
              {info.first_status
                ? `Required before a ${info.label.toLowerCase()} record can move on from ${humanizeStatus(info.first_status)}.`
                : 'Required on status changes.'}
            </p>
            <div className="flex flex-wrap items-start gap-2">
              <select
                id={selectId}
                ref={selectRef}
                value={choice}
                onChange={(e) => {
                  setChoice(e.target.value);
                  if (error) setError(null);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                className="input min-w-[14rem] flex-1"
              >
                <option value="">Choose a field…</option>
                {eligible.map((f) => (
                  <option key={f.field} value={f.field}>
                    {f.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={addMutation.isPending}
                aria-label={`Add required field to ${info.label}`}
                className="btn btn-secondary min-h-[44px]"
              >
                Add
              </button>
            </div>
            {error && (
              <p id={errorId} className="mt-1 text-sm text-semantic-error">
                {error}
              </p>
            )}
          </form>
        </>
      ) : (
        <p className="mt-4 text-sm text-archive">
          Additional required fields are not available for this procedure yet, because its status changes are not checked on the server.
        </p>
      )}
    </section>
  );
}
