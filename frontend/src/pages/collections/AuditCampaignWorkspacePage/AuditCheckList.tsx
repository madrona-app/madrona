/**
 * AuditCheckList - generate a campaign's spot-check list and record checks.
 *
 * The list is drawn on the server from the campaign's scope and sampling
 * method; the seed is shown so the draw can be reproduced. Each row records
 * found / not found / wrong location with native buttons, and every change is
 * announced through a polite live region.
 */
import { useCallback, useId, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Printer, Download, MapPin, Plus } from 'lucide-react';
import {
  getAuditCheckList,
  generateAuditCheckList,
  recordAuditCheck,
  updateAuditCampaign,
} from '../../../lib/api';
import type { AuditCheckListItem, AuditCheckOutcome, AuditCheckList as CheckListData } from '../../../lib/api';
import { formatDateTime } from '@/lib/formatters';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { useAccessibleModal, getModalAriaProps } from '../../../hooks/useAccessibleModal';
import { ModalPortal } from '../../../components/ModalPortal';
import { LocationSelect } from './LocationSelect';
import { OUTCOME_LABELS, buildCheckListCsv, downloadCsv } from './checkListCsv';


const OUTCOME_STYLES: Record<string, string> = {
  pending: 'bg-stone text-ink',
  found: 'bg-semantic-success/10 text-semantic-success',
  not_found: 'bg-semantic-error/10 text-semantic-error',
  wrong_location: 'bg-semantic-warning/10 text-semantic-warning',
};

const METHOD_LABELS: Record<string, string> = {
  complete: 'Complete (every object in scope)',
  targeted: 'Targeted (every object matching the scope)',
  random: 'Random',
  systematic: 'Systematic (every k-th object from a random start)',
  stratified: 'Stratified by location',
};

export interface ScopeLocation {
  location_id: string;
  include_children?: boolean;
  label?: string;
}

interface CampaignLike {
  audit_id: string;
  title?: string | null;
  audit_number?: string | null;
  status?: string | null;
  sample_method?: string | null;
  sample_size?: number | null;
  sample_percentage?: number | null;
  target_locations?: unknown[] | null;
  target_object_types?: string[] | null;
}

interface AuditCheckListProps {
  orgId: string;
  campaign: CampaignLike;
  canEdit: boolean;
  /** Rendered above the table; used for bulk actions on selected rows. */
  renderSelectionToolbar?: (ctx: SelectionContext) => React.ReactNode;
}

export interface SelectionContext {
  items: AuditCheckListItem[];
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  clearSelection: () => void;
  announce: (message: string) => void;
}

function normaliseScope(raw: unknown[] | null | undefined): ScopeLocation[] {
  return (raw ?? []).flatMap((entry): ScopeLocation[] => {
    if (typeof entry === 'string') return [{ location_id: entry, include_children: true }];
    if (entry && typeof entry === 'object' && 'location_id' in entry) {
      const e = entry as ScopeLocation;
      return [{ location_id: e.location_id, include_children: e.include_children !== false, label: e.label }];
    }
    return [];
  });
}

function itemLabel(item: AuditCheckListItem): string {
  return item.object_number || item.title || 'object';
}

function resultText(item: AuditCheckListItem): string {
  const base = OUTCOME_LABELS[item.outcome] ?? item.outcome;
  if (item.outcome === 'wrong_location' && item.actual_location_name) {
    return `${base}: found in ${item.actual_location_name}`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Scope editor
// ---------------------------------------------------------------------------

function ScopeEditor({ orgId, campaign, canEdit, announce }: {
  orgId: string; campaign: CampaignLike; canEdit: boolean; announce: (m: string) => void;
}) {
  const queryClient = useQueryClient();
  const ids = useId();
  const scope = normaliseScope(campaign.target_locations);
  const [pendingLocation, setPendingLocation] = useState<{ id: string; label: string } | null>(null);
  const [includeChildren, setIncludeChildren] = useState(true);
  const [objectTypes, setObjectTypes] = useState((campaign.target_object_types ?? []).join(', '));
  const listRef = useRef<HTMLUListElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const save = useMutation({
    mutationFn: (payload: { target_locations: ScopeLocation[]; target_object_types: string[] }) =>
      updateAuditCampaign(orgId, campaign.audit_id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['audit-campaign', orgId, campaign.audit_id] }),
    onError: (err: Error) => announce(`Scope not saved: ${err.message}`),
  });

  const types = () => objectTypes.split(',').map((t) => t.trim()).filter(Boolean);

  const addLocation = () => {
    if (!pendingLocation) return;
    if (scope.some((s) => s.location_id === pendingLocation.id)) {
      announce(`${pendingLocation.label} is already in the scope.`);
      return;
    }
    const next = [...scope, { location_id: pendingLocation.id, include_children: includeChildren, label: pendingLocation.label }];
    save.mutate({ target_locations: next, target_object_types: types() }, {
      onSuccess: () => announce(`Added ${pendingLocation.label} to the scope${includeChildren ? ', including sub-locations' : ''}.`),
    });
    setPendingLocation(null);
  };

  const removeLocation = (index: number) => {
    const removed = scope[index];
    const next = scope.filter((_, i) => i !== index);
    save.mutate({ target_locations: next, target_object_types: types() }, {
      onSuccess: () => {
        announce(`Removed ${removed.label || 'location'} from the scope.`);
        // Focus the next remove button, or the add control when the list empties.
        requestAnimationFrame(() => {
          const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button');
          const target = buttons && buttons.length ? buttons[Math.min(index, buttons.length - 1)] : addButtonRef.current;
          target?.focus();
        });
      },
    });
  };

  return (
    <section aria-labelledby={`${ids}-scope`} className="border border-lichen rounded-lg p-4 print:hidden">
      <h3 id={`${ids}-scope`} className="text-base font-semibold text-ink mb-2">Scope</h3>
      <p className="text-sm text-accessible-gray mb-3">
        Objects whose current location is in these locations make up the population the check list is drawn from.
        With no locations, every object in the organization is in scope.
      </p>
      {scope.length > 0 ? (
        <ul ref={listRef} className="flex flex-col gap-2 mb-4">
          {scope.map((s, i) => (
            <li key={s.location_id} className="flex items-center gap-3 text-sm text-ink">
              <MapPin size={16} className="text-archive shrink-0" aria-hidden="true" />
              <span className="flex-1">
                {s.label || s.location_id}
                {s.include_children ? ', including sub-locations' : ', this location only'}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => removeLocation(i)}
                  className="btn btn-tertiary text-sm min-h-[44px] focus-visible:ring-2 ring-bark/30 ring-offset-2"
                  aria-label={`Remove ${s.label || 'location'} from scope`}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink mb-4">No scope locations: all objects are in scope.</p>
      )}

      {canEdit && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-ink mb-1">Add a scope location</legend>
            <LocationSelect
              orgId={orgId}
              label="Location"
              value={pendingLocation?.id ?? ''}
              onChange={(id, loc) => setPendingLocation(id ? { id, label: loc?.name ?? id } : null)}
            />
            <label className="inline-flex items-center gap-2 text-sm text-ink min-h-[44px]">
              <input
                type="checkbox"
                checked={includeChildren}
                onChange={(e) => setIncludeChildren(e.target.checked)}
                className="w-5 h-5"
              />
              Include sub-locations
            </label>
            <button
              ref={addButtonRef}
              type="button"
              onClick={addLocation}
              disabled={!pendingLocation || save.isPending}
              className="btn btn-secondary text-sm self-start min-h-[44px] inline-flex items-center gap-2"
            >
              <Plus size={16} aria-hidden="true" />
              Add to scope
            </button>
          </fieldset>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${ids}-types`} className="text-sm font-medium text-ink">
              Object types (comma-separated)
            </label>
            <input
              id={`${ids}-types`}
              type="text"
              value={objectTypes}
              onChange={(e) => setObjectTypes(e.target.value)}
              aria-describedby={`${ids}-types-hint`}
              className="input w-full min-h-[44px]"
            />
            <p id={`${ids}-types-hint`} className="text-xs text-accessible-gray">
              Leave empty to include every object type.
            </p>
            <button
              type="button"
              onClick={() => save.mutate(
                { target_locations: scope, target_object_types: types() },
                { onSuccess: () => announce('Object types saved.') },
              )}
              disabled={save.isPending}
              className="btn btn-secondary text-sm self-start min-h-[44px]"
            >
              Save object types
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Wrong-location dialog
// ---------------------------------------------------------------------------

function WrongLocationDialog({ orgId, item, onClose, onSave, saving, serverError }: {
  orgId: string;
  item: AuditCheckListItem | null;
  onClose: () => void;
  onSave: (locationId: string, note: string) => void;
  saving: boolean;
  serverError: string | null;
}) {
  const isOpen = !!item;
  const { modalRef, titleId, descriptionId } = useAccessibleModal({ isOpen, onClose, titlePrefix: 'wrong-location-dialog' });
  const ids = useId();
  const [locationId, setLocationId] = useState('');
  const [note, setNote] = useState('');
  const [showError, setShowError] = useState(false);

  if (!item) return null;
  const errorId = `${ids}-error`;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationId) {
      setShowError(true);
      return;
    }
    onSave(locationId, note);
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50" data-modal-layer="1000">
        <div ref={modalRef} {...getModalAriaProps(titleId, descriptionId)} className="bg-parchment rounded-lg max-w-[520px] w-[90%] shadow-xl">
          <form onSubmit={submit} noValidate>
            <div className="px-6 py-5 border-b border-lichen">
              <h2 id={titleId} className="m-0 text-lg font-semibold text-ink font-serif">
                Wrong location: {itemLabel(item)}
              </h2>
              <p id={descriptionId} className="text-sm text-accessible-gray mt-1">
                Expected in {item.expected_location_name || 'no recorded location'}. Choose where it was found.
              </p>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <LocationSelect
                orgId={orgId}
                label="Found location"
                value={locationId}
                onChange={(id) => { setLocationId(id); if (id) setShowError(false); }}
                required
                invalid={showError}
                errorId={errorId}
              />
              {showError && (
                <p id={errorId} className="text-sm text-semantic-error">Choose the location where the object was found.</p>
              )}
              {serverError && (
                <p className="text-sm text-semantic-error" role="alert">{serverError}</p>
              )}
              <div>
                <label htmlFor={`${ids}-note`} className="block text-sm font-medium text-ink mb-1">Note (optional)</label>
                <textarea
                  id={`${ids}-note`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="input w-full"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
              <button type="button" onClick={onClose} className="btn btn-secondary min-h-[44px]">Cancel</button>
              <button type="submit" disabled={saving} className="btn btn-primary min-h-[44px]">Save result</button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function AuditCheckList({ orgId, campaign, canEdit, renderSelectionToolbar }: AuditCheckListProps) {
  const queryClient = useQueryClient();
  const ids = useId();
  const campaignId = campaign.audit_id;
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [wrongLocationItem, setWrongLocationItem] = useState<AuditCheckListItem | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const generateButtonRef = useRef<HTMLButtonElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  // Stable close handlers: useAccessibleModal re-runs its focus effect when
  // onClose changes, which would pull focus back to the first field.
  const closeReplace = useCallback(() => setConfirmReplace(false), []);
  const closeWrongLocation = useCallback(() => setWrongLocationItem(null), []);

  // A new node per message so repeating the same text is announced again.
  const [messageKey, setMessageKey] = useState(0);
  const announce = (m: string) => { setMessage(m); setMessageKey((k) => k + 1); };

  const queryKey = ['audit-check-list', orgId, campaignId];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => getAuditCheckList(orgId, campaignId),
    enabled: !!orgId && !!campaignId,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const checked = data?.checked ?? 0;
  const closed = campaign.status === 'completed' || campaign.status === 'cancelled';
  const checksStarted = checked > 0;

  const generate = useMutation({
    mutationFn: (replace: boolean) => generateAuditCheckList(orgId, campaignId, { replace }),
    onSuccess: (result: CheckListData) => {
      queryClient.setQueryData(queryKey, result);
      queryClient.invalidateQueries({ queryKey: ['audit-campaign', orgId, campaignId] });
      setError(null);
      setSelectedIds(new Set());
      announce(`Check list generated: ${result.total} object${result.total === 1 ? '' : 's'} to check.`);
      requestAnimationFrame(() => tableRef.current?.focus());
    },
    onError: (err: Error) => {
      setError(err.message);
      announce(`Check list not generated: ${err.message}`);
    },
  });

  const record = useMutation({
    mutationFn: (vars: { item: AuditCheckListItem; outcome: AuditCheckOutcome; actual_location_id?: string; note?: string }) =>
      recordAuditCheck(orgId, campaignId, vars.item.result_id, {
        outcome: vars.outcome,
        actual_location_id: vars.actual_location_id ?? null,
        ...(vars.note !== undefined ? { note: vars.note } : {}),
      }),
    onSuccess: (updated, vars) => {
      let newChecked = checked;
      queryClient.setQueryData<CheckListData>(queryKey, (prev) => {
        if (!prev) return prev;
        const nextItems = prev.items.map((i) => (i.result_id === updated.result_id ? updated : i));
        newChecked = nextItems.filter((i) => i.outcome !== 'pending').length;
        return { ...prev, items: nextItems, checked: newChecked };
      });
      queryClient.invalidateQueries({ queryKey: ['audit-campaign', orgId, campaignId] });
      setError(null);
      const verb = vars.outcome === 'pending' ? 'cleared' : `recorded as ${resultText(updated).toLowerCase()}`;
      announce(`${itemLabel(updated)} ${verb}. ${newChecked} of ${total} checked.`);
    },
    onError: (err: Error, vars) => {
      setError(`${itemLabel(vars.item)}: ${err.message}`);
      announce(`Result for ${itemLabel(vars.item)} not saved: ${err.message}`);
    },
  });

  const exportCsv = () => {
    const name = (campaign.audit_number || 'audit').replace(/[^A-Za-z0-9._-]+/g, '-');
    downloadCsv(`${name}-check-list.csv`, buildCheckListCsv(items));
    announce(`Exported ${items.length} rows to CSV.`);
  };

  const method = campaign.sample_method || 'complete';
  const sizeText = method === 'complete' || method === 'targeted'
    ? null
    : campaign.sample_size != null
      ? `Sample size: ${campaign.sample_size}.`
      : campaign.sample_percentage != null
        ? `Sample percentage: ${campaign.sample_percentage}%.`
        : 'No sample size or percentage set yet.';
  const params = (data?.params ?? {}) as Record<string, unknown>;

  const generateHintId = `${ids}-generate-hint`;
  let generateHint: string | null = null;
  if (closed) generateHint = `This campaign is ${campaign.status}; its check list can't change.`;
  else if (checksStarted) generateHint = `${checked} check${checked === 1 ? ' has' : 's have'} been recorded, so the list can't be regenerated.`;

  const selection: SelectionContext = {
    items,
    selectedIds,
    setSelectedIds,
    clearSelection: () => setSelectedIds(new Set()),
    announce,
  };

  return (
    <div className="flex flex-col gap-4">
      <div role="status" aria-live="polite" className="text-sm text-ink min-h-[1.25rem] print:hidden">
        <span key={messageKey}>{message}</span>
      </div>

      <ScopeEditor orgId={orgId} campaign={campaign} canEdit={canEdit && !closed} announce={announce} />

      <section aria-labelledby={`${ids}-heading`} className="flex flex-col gap-3">
        <h3 id={`${ids}-heading`} className="text-base font-semibold text-ink flex items-center gap-2">
          <ListChecks size={18} aria-hidden="true" className="text-archive" />
          Check list
        </h3>
        <p className="text-sm text-ink">
          Sampling method: {METHOD_LABELS[method] ?? method}. {sizeText}
        </p>
        {data?.generated_at && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-ink">
            <dt className="font-medium">Generated</dt>
            <dd>{formatDateTime(data.generated_at)}</dd>
            <dt className="font-medium">Population in scope</dt>
            <dd>{String(params.population_count ?? '—')}</dd>
            <dt className="font-medium">Objects on list</dt>
            <dd>{total}</dd>
            <dt className="font-medium">Seed</dt>
            <dd><code>{data.seed}</code></dd>
          </dl>
        )}

        {error && (
          <p className="text-sm text-semantic-error bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-3">{error}</p>
        )}

        <div className="flex flex-wrap gap-3 print:hidden">
          {canEdit && (
            <button
              ref={generateButtonRef}
              type="button"
              onClick={() => (total > 0 ? setConfirmReplace(true) : generate.mutate(false))}
              disabled={closed || checksStarted || generate.isPending}
              aria-describedby={generateHint ? generateHintId : undefined}
              className="btn btn-primary text-sm min-h-[44px] inline-flex items-center gap-2"
            >
              <ListChecks size={16} aria-hidden="true" />
              {generate.isPending ? 'Generating…' : total > 0 ? 'Replace check list' : 'Generate check list'}
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!items.length}
            className="btn btn-secondary text-sm min-h-[44px] inline-flex items-center gap-2"
          >
            <Printer size={16} aria-hidden="true" />
            Print check list
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!items.length}
            className="btn btn-secondary text-sm min-h-[44px] inline-flex items-center gap-2"
          >
            <Download size={16} aria-hidden="true" />
            Export CSV
          </button>
        </div>
        {generateHint && canEdit && (
          <p id={generateHintId} className="text-sm text-accessible-gray print:hidden">{generateHint}</p>
        )}

        {renderSelectionToolbar && items.length > 0 && renderSelectionToolbar(selection)}

        {isLoading ? (
          <p className="text-sm text-ink">Loading check list…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-ink">No check list yet.{canEdit ? ' Set the scope and sampling method, then generate one.' : ''}</p>
        ) : (
          <div className="overflow-x-auto border border-lichen rounded-lg">
            <table ref={tableRef} tabIndex={-1} className="w-full text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30">
              <caption className="text-left px-4 py-2 font-medium text-ink">
                Check list for {campaign.title || 'this campaign'}: {checked} of {total} checked
              </caption>
              <thead className="bg-stone/50">
                <tr>
                  {renderSelectionToolbar && (
                    <th scope="col" className="px-3 py-2 text-left font-medium text-ink print:hidden">
                      <SelectAll items={items} selectedIds={selectedIds} setSelectedIds={setSelectedIds} announce={announce} />
                    </th>
                  )}
                  <th scope="col" className="px-3 py-2 text-left font-medium text-ink">#</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Object number</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Title</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Expected location</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Result</th>
                  {canEdit && !closed && (
                    <th scope="col" className="px-3 py-2 text-left font-medium text-ink print:hidden">Record result</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-lichen">
                {items.map((item) => {
                  const label = itemLabel(item);
                  const busy = record.isPending && record.variables?.item.result_id === item.result_id;
                  return (
                    <tr key={item.result_id}>
                      {renderSelectionToolbar && (
                        <td className="px-3 py-2 print:hidden">
                          <label className="inline-flex items-center justify-center min-w-[44px] min-h-[44px]">
                            <input
                              type="checkbox"
                              className="w-5 h-5"
                              checked={selectedIds.has(item.result_id)}
                              onChange={(e) => {
                                const next = new Set(selectedIds);
                                if (e.target.checked) next.add(item.result_id); else next.delete(item.result_id);
                                setSelectedIds(next);
                                announce(`${next.size} of ${items.length} selected.`);
                              }}
                            />
                            <span className="sr-only">Select {label}{item.title && item.object_number ? `, ${item.title}` : ''}</span>
                          </label>
                        </td>
                      )}
                      <td className="px-3 py-2 text-ink">{item.check_sequence ?? '—'}</td>
                      <th scope="row" className="px-3 py-2 text-left font-medium text-ink">{item.object_number || '—'}</th>
                      <td className="px-3 py-2 text-ink">{item.title || '—'}</td>
                      <td className="px-3 py-2 text-ink">
                        {item.expected_location_name || 'No recorded location'}
                        {item.expected_location_path && item.expected_location_path !== item.expected_location_name && (
                          <span className="block text-xs text-accessible-gray">{item.expected_location_path}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${OUTCOME_STYLES[item.outcome] ?? 'bg-stone text-ink'}`}>
                          {resultText(item)}
                        </span>
                        {item.follow_up_action === 'location_updated' && (
                          <span className="block text-xs text-accessible-gray mt-1">Location record updated</span>
                        )}
                      </td>
                      {canEdit && !closed && (
                        <td className="px-3 py-2 print:hidden">
                          <div role="group" aria-label={`Record result for ${label}`} className="flex flex-wrap gap-2">
                            {(['found', 'not_found'] as const).map((outcome) => (
                              <button
                                key={outcome}
                                type="button"
                                aria-pressed={item.outcome === outcome}
                                disabled={busy}
                                onClick={() => record.mutate({ item, outcome })}
                                className={`btn text-xs min-h-[44px] px-3 ${item.outcome === outcome ? 'btn-primary' : 'btn-secondary'}`}
                              >
                                {OUTCOME_LABELS[outcome]}<span className="sr-only">: {label}</span>
                              </button>
                            ))}
                            <button
                              type="button"
                              aria-pressed={item.outcome === 'wrong_location'}
                              aria-haspopup="dialog"
                              disabled={busy}
                              onClick={() => { setDialogError(null); setWrongLocationItem(item); }}
                              className={`btn text-xs min-h-[44px] px-3 ${item.outcome === 'wrong_location' ? 'btn-primary' : 'btn-secondary'}`}
                            >
                              Wrong location<span className="sr-only">: {label}</span>
                            </button>
                            {item.outcome !== 'pending' && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => record.mutate({ item, outcome: 'pending' })}
                                className="btn btn-tertiary text-xs min-h-[44px] px-3"
                              >
                                Clear{' '}<span className="sr-only">result for {label}</span>
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        isOpen={confirmReplace}
        onClose={closeReplace}
        onConfirm={() => generate.mutate(true)}
        title="Replace check list?"
        message={`The current list of ${total} object${total === 1 ? '' : 's'} has no recorded checks. Replacing it draws a new list with a new seed.`}
        confirmText="Replace list"
      />

      <WrongLocationDialog
        key={wrongLocationItem?.result_id ?? 'closed'}
        orgId={orgId}
        item={wrongLocationItem}
        onClose={closeWrongLocation}
        saving={record.isPending}
        serverError={dialogError}
        onSave={(locationId, note) => {
          const item = wrongLocationItem!;
          record.mutate(
            { item, outcome: 'wrong_location', actual_location_id: locationId, note: note || undefined },
            {
              onSuccess: () => setWrongLocationItem(null),
              onError: (err: Error) => setDialogError(err.message),
            },
          );
        }}
      />
    </div>
  );
}

function SelectAll({ items, selectedIds, setSelectedIds, announce }: {
  items: AuditCheckListItem[];
  selectedIds: Set<string>;
  setSelectedIds: (s: Set<string>) => void;
  announce: (m: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const all = items.length > 0 && items.every((i) => selectedIds.has(i.result_id));
  const some = !all && items.some((i) => selectedIds.has(i.result_id));
  return (
    <label className="inline-flex items-center justify-center min-w-[44px] min-h-[44px]">
      <input
        ref={(el) => { ref.current = el; if (el) el.indeterminate = some; }}
        type="checkbox"
        className="w-5 h-5"
        checked={all}
        onChange={() => {
          setSelectedIds(all ? new Set() : new Set(items.map((i) => i.result_id)));
          announce(all ? 'Selection cleared.' : `All ${items.length} selected.`);
        }}
      />
      <span className="sr-only">Select all {items.length} objects</span>
    </label>
  );
}
