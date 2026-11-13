import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getLocations } from '../../../lib/api/collections';
import {
  addBibHolding,
  addBibItem,
  deleteBibHolding,
  deleteBibItem,
  ITEM_STATUSES,
  itemStatusLabel,
  updateBibHolding,
  updateBibItem,
  type BibHolding,
  type BibHoldingInput,
  type BibItem,
  type BibItemInput,
  type ItemStatus,
} from '../../../lib/api/library';
import ConfirmDialog from '../../ConfirmDialog';

const focusRing = 'focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';
const fieldClass =
  'w-full px-3 py-2 border border-lichen rounded-lg bg-parchment text-ink text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark';

const orNull = (s: string) => (s.trim() ? s.trim() : null);

/** "Holding 1: Stacks, HV1593 .M38" — names a holding in headings and buttons. */
function holdingLabel(h: BibHolding, index: number): string {
  const detail = [h.location_name, h.call_number].filter(Boolean).join(', ');
  return detail ? `Holding ${index + 1}: ${detail}` : `Holding ${index + 1}`;
}

/** "item T0001" / "item v.3" / "item 2" — names an item in buttons. */
function itemLabel(item: BibItem, index: number): string {
  if (item.barcode) return `item ${item.barcode}`;
  if (item.enumeration) return `item ${item.enumeration}`;
  return `item ${index + 1}`;
}

function TextField({
  id, label, value, onChange, multiline, inputRef, hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">{label}</label>
      {hint && <p id={`${id}-hint`} className="text-xs text-archive mb-1">{hint}</p>}
      {multiline ? (
        <textarea id={id} rows={2} value={value} onChange={(e) => onChange(e.target.value)} className={fieldClass} />
      ) : (
        <input
          id={id}
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
          autoComplete="off"
          className={fieldClass}
        />
      )}
    </div>
  );
}

function FormShell({
  heading, headingLevel, headingId, error, onSubmit, onCancel, submitText, cancelLabel, children,
}: {
  heading: string;
  headingLevel: 'h3' | 'h4';
  headingId: string;
  error: string;
  onSubmit: (e: FormEvent) => void;
  onCancel?: () => void;
  submitText: string;
  cancelLabel?: string;
  children: ReactNode;
}) {
  const Heading = headingLevel;
  return (
    <form noValidate onSubmit={onSubmit} aria-labelledby={headingId} className="border-t border-lichen pt-4 mt-4 space-y-3">
      <Heading id={headingId} className="text-base font-medium text-forest">{heading}</Heading>
      {error && (
        <p role="alert" className="p-3 rounded-lg bg-semantic-error/10 border border-semantic-error/30 text-sm text-semantic-error">
          {error}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={`btn btn-primary min-h-[44px] ${focusRing}`}>{submitText}</button>
        {onCancel && (
          <button type="button" onClick={onCancel} aria-label={cancelLabel} className={`btn btn-tertiary min-h-[44px] ${focusRing}`}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// ============================================================================
// Holding form
// ============================================================================

type HoldingDraft = {
  location_id: string;
  call_number: string;
  holdings_statement: string;
  shelving_notes: string;
  public_note: string;
  staff_note: string;
};

const emptyHolding: HoldingDraft = {
  location_id: '', call_number: '', holdings_statement: '', shelving_notes: '', public_note: '', staff_note: '',
};

function holdingDraft(h: BibHolding): HoldingDraft {
  return {
    location_id: h.location_id ?? '',
    call_number: h.call_number ?? '',
    holdings_statement: h.holdings_statement ?? '',
    shelving_notes: h.shelving_notes ?? '',
    public_note: h.public_note ?? '',
    staff_note: h.staff_note ?? '',
  };
}

function holdingInput(d: HoldingDraft): BibHoldingInput {
  return {
    location_id: d.location_id || null,
    call_number: orNull(d.call_number),
    holdings_statement: orNull(d.holdings_statement),
    shelving_notes: orNull(d.shelving_notes),
    public_note: orNull(d.public_note),
    staff_note: orNull(d.staff_note),
  };
}

function HoldingForm({
  orgId, heading, initial, submitText, onSave, onCancel, cancelLabel, focusOnMount, currentLocation,
}: {
  orgId: string;
  heading: string;
  initial: HoldingDraft;
  submitText: string;
  onSave: (input: BibHoldingInput) => Promise<void>;
  onCancel?: () => void;
  cancelLabel?: string;
  focusOnMount?: boolean;
  currentLocation?: { id: string; name: string | null };
}) {
  const id = useId();
  const [draft, setDraft] = useState<HoldingDraft>(initial);
  const [error, setError] = useState('');
  const firstRef = useRef<HTMLSelectElement>(null);
  const { data: locations } = useQuery({
    queryKey: ['locations', orgId, 'library-holding-picker'],
    queryFn: () => getLocations(orgId, { is_active: true }),
  });

  useEffect(() => {
    if (focusOnMount) firstRef.current?.focus();
  }, [focusOnMount]);

  const set = (key: keyof HoldingDraft) => (v: string) => setDraft((d) => ({ ...d, [key]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await onSave(holdingInput(draft));
      if (!onCancel) setDraft(emptyHolding);
    } catch (err) {
      setError(`Could not save the holding: ${(err as Error).message}`);
    }
  };

  const locationItems = locations?.items ?? [];
  const showCurrent = currentLocation && !locationItems.some((l) => l.location_id === currentLocation.id);

  return (
    <FormShell
      heading={heading}
      headingLevel="h3"
      headingId={`${id}-heading`}
      error={error}
      onSubmit={(e) => void submit(e)}
      onCancel={onCancel}
      cancelLabel={cancelLabel}
      submitText={submitText}
    >
      <div>
        <label htmlFor={`${id}-location`} className="block text-sm font-medium text-ink mb-1">Location</label>
        <select
          id={`${id}-location`}
          ref={firstRef}
          value={draft.location_id}
          onChange={(e) => set('location_id')(e.target.value)}
          className={fieldClass}
        >
          <option value="">No location</option>
          {showCurrent && <option value={currentLocation.id}>{currentLocation.name ?? 'Current location'}</option>}
          {locationItems.map((l) => (
            <option key={l.location_id} value={l.location_id}>{l.path || l.name}</option>
          ))}
        </select>
      </div>
      <TextField id={`${id}-call`} label="Local call number" value={draft.call_number} onChange={set('call_number')} />
      <TextField
        id={`${id}-statement`}
        label="Holdings statement"
        hint="What is held, for example v.1–12, 1956–1968."
        value={draft.holdings_statement}
        onChange={set('holdings_statement')}
      />
      <TextField id={`${id}-shelving`} label="Shelving notes" value={draft.shelving_notes} onChange={set('shelving_notes')} multiline />
      <TextField id={`${id}-public`} label="Public note" value={draft.public_note} onChange={set('public_note')} multiline />
      <TextField id={`${id}-staff`} label="Staff note" value={draft.staff_note} onChange={set('staff_note')} multiline />
    </FormShell>
  );
}

// ============================================================================
// Item form
// ============================================================================

type ItemDraft = {
  barcode: string;
  copy_number: string;
  enumeration: string;
  chronology: string;
  status: ItemStatus;
  condition_note: string;
};

const emptyItem: ItemDraft = {
  barcode: '', copy_number: '', enumeration: '', chronology: '', status: 'available', condition_note: '',
};

function itemDraft(i: BibItem): ItemDraft {
  return {
    barcode: i.barcode ?? '',
    copy_number: i.copy_number ?? '',
    enumeration: i.enumeration ?? '',
    chronology: i.chronology ?? '',
    status: i.status,
    condition_note: i.condition_note ?? '',
  };
}

function itemInput(d: ItemDraft): BibItemInput {
  return {
    barcode: orNull(d.barcode),
    copy_number: orNull(d.copy_number),
    enumeration: orNull(d.enumeration),
    chronology: orNull(d.chronology),
    status: d.status,
    condition_note: orNull(d.condition_note),
  };
}

function ItemForm({
  heading, initial, submitText, onSave, onCancel, cancelLabel, focusOnMount,
}: {
  heading: string;
  initial: ItemDraft;
  submitText: string;
  onSave: (input: BibItemInput) => Promise<void>;
  onCancel?: () => void;
  cancelLabel?: string;
  focusOnMount?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<ItemDraft>(initial);
  const [error, setError] = useState('');
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusOnMount) firstRef.current?.focus();
  }, [focusOnMount]);

  const set = (key: keyof ItemDraft) => (v: string) => setDraft((d) => ({ ...d, [key]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await onSave(itemInput(draft));
      if (!onCancel) setDraft(emptyItem);
    } catch (err) {
      setError(`Could not save the item: ${(err as Error).message}`);
      firstRef.current?.focus();
    }
  };

  return (
    <FormShell
      heading={heading}
      headingLevel="h4"
      headingId={`${id}-heading`}
      error={error}
      onSubmit={(e) => void submit(e)}
      onCancel={onCancel}
      cancelLabel={cancelLabel}
      submitText={submitText}
    >
      <TextField
        id={`${id}-barcode`}
        label="Barcode"
        hint="Must be unique in this library. Leave empty if not yet barcoded."
        value={draft.barcode}
        onChange={set('barcode')}
        inputRef={firstRef}
      />
      <TextField id={`${id}-copy`} label="Copy number" value={draft.copy_number} onChange={set('copy_number')} />
      <TextField id={`${id}-enum`} label="Volume or part" hint="Enumeration, for example v. 3." value={draft.enumeration} onChange={set('enumeration')} />
      <TextField id={`${id}-chron`} label="Date or issue" hint="Chronology, for example 1957." value={draft.chronology} onChange={set('chronology')} />
      <div>
        <label htmlFor={`${id}-status`} className="block text-sm font-medium text-ink mb-1">Status</label>
        <select id={`${id}-status`} value={draft.status} onChange={(e) => set('status')(e.target.value)} className={fieldClass}>
          {ITEM_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <TextField id={`${id}-condition`} label="Condition note" value={draft.condition_note} onChange={set('condition_note')} multiline />
    </FormShell>
  );
}

// ============================================================================
// Items of one holding
// ============================================================================

function HoldingItems({
  orgId, recordId, holding, label, canEdit, announce, refresh,
}: {
  orgId: string;
  recordId: string;
  holding: BibHolding;
  label: string;
  canEdit: boolean;
  announce: (msg: string) => void;
  refresh: () => Promise<unknown>;
}) {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const editRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const items = holding.items;

  // After add or edit, put focus on that row's Edit button once it renders.
  useEffect(() => {
    if (focusId && editRefs.current[focusId]) {
      editRefs.current[focusId]?.focus();
      setFocusId(null);
    }
  }, [focusId, items]);

  const add = async (input: BibItemInput) => {
    const created = await addBibItem(orgId, recordId, holding.holding_id, input);
    await refresh();
    announce(`Added ${created.barcode ? `item ${created.barcode}` : 'an item'} to ${label}.`);
    setFocusId(created.item_id);
  };

  const save = async (item: BibItem, index: number, input: BibItemInput) => {
    await updateBibItem(orgId, recordId, holding.holding_id, item.item_id, input);
    await refresh();
    announce(`Saved ${itemLabel(item, index)}.`);
    setEditingId(null);
    setFocusId(item.item_id);
  };

  const remove = async (item: BibItem, index: number) => {
    setError('');
    try {
      await deleteBibItem(orgId, recordId, holding.holding_id, item.item_id);
      await refresh();
      announce(`Removed ${itemLabel(item, index)} from ${label}.`);
      if (editingId === item.item_id) setEditingId(null);
      headingRef.current?.focus();
    } catch (err) {
      setError(`Could not remove ${itemLabel(item, index)}: ${(err as Error).message}`);
    }
  };

  const editingIndex = items.findIndex((i) => i.item_id === editingId);
  const editing = editingIndex >= 0 ? items[editingIndex] : null;

  return (
    <section aria-labelledby={`${id}-heading`} className="mt-6 border border-lichen rounded-lg p-4">
      <h3 id={`${id}-heading`} ref={headingRef} tabIndex={-1} className="text-base font-semibold text-forest mb-2 focus:outline-none">
        Items in {label}
      </h3>
      {error && (
        <p role="alert" className="mb-3 p-3 rounded-lg bg-semantic-error/10 border border-semantic-error/30 text-sm text-semantic-error">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-archive">No items in this holding yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="text-left text-sm text-archive pb-2">
              {items.length === 1 ? '1 item' : `${items.length} items`} in {label}
            </caption>
            <thead className="bg-stone/50">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Barcode</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Copy</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Volume or part</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Date or issue</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Status</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Condition</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Catalogued object</th>
                {canEdit && <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {items.map((item, index) => (
                <tr key={item.item_id} className="align-top">
                  <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                    {item.barcode || <span className="text-archive font-normal">No barcode</span>}
                  </th>
                  <td className="px-3 py-2 text-ink">{item.copy_number || '—'}</td>
                  <td className="px-3 py-2 text-ink">{item.enumeration || '—'}</td>
                  <td className="px-3 py-2 text-ink">{item.chronology || '—'}</td>
                  <td className="px-3 py-2 text-ink">{itemStatusLabel(item.status)}</td>
                  <td className="px-3 py-2 text-ink whitespace-pre-line">{item.condition_note || '—'}</td>
                  <td className="px-3 py-2 text-ink">
                    {item.collection_object_id ? (
                      <Link to={`/organizations/${orgId}/collections/objects/${item.collection_object_id}`} className={`text-bark hover:text-copper-dark rounded ${focusRing}`}>
                        {item.collection_object_number || 'Object record'}
                      </Link>
                    ) : '—'}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          ref={(el) => { editRefs.current[item.item_id] = el; }}
                          onClick={() => setEditingId(item.item_id)}
                          aria-label={`Edit ${itemLabel(item, index)}`}
                          className={`btn btn-tertiary min-h-[44px] ${focusRing}`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(item, index)}
                          aria-label={`Remove ${itemLabel(item, index)} from ${label}`}
                          className={`btn btn-tertiary min-h-[44px] text-semantic-error ${focusRing}`}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (editing ? (
        <ItemForm
          key={editing.item_id}
          heading={`Edit ${itemLabel(editing, editingIndex)}`}
          initial={itemDraft(editing)}
          submitText="Save item"
          onSave={(input) => save(editing, editingIndex, input)}
          onCancel={() => { setEditingId(null); setFocusId(editing.item_id); }}
          cancelLabel={`Cancel editing ${itemLabel(editing, editingIndex)}`}
          focusOnMount
        />
      ) : (
        <ItemForm
          heading={`Add an item to ${label}`}
          initial={emptyItem}
          submitText="Add item"
          onSave={add}
        />
      ))}
    </section>
  );
}

// ============================================================================
// Holdings
// ============================================================================

interface Props {
  orgId: string;
  recordId: string;
  holdings: BibHolding[];
  canEdit: boolean;
}

/** Holdings of a library record, each with its items: tables plus add/edit/remove. */
export function LibraryHoldings({ orgId, recordId, holdings, canEdit }: Props) {
  const id = useId();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const editRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ holding: BibHolding; label: string } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['library-record', orgId, recordId] });

  useEffect(() => {
    if (focusId && editRefs.current[focusId]) {
      editRefs.current[focusId]?.focus();
      setFocusId(null);
    }
  }, [focusId, holdings]);

  const add = async (input: BibHoldingInput) => {
    const created = await addBibHolding(orgId, recordId, input);
    await refresh();
    setAnnouncement(`Added holding ${holdings.length + 1}. You can now add its items.`);
    setFocusId(created.holding_id);
  };

  const save = async (h: BibHolding, label: string, input: BibHoldingInput) => {
    await updateBibHolding(orgId, recordId, h.holding_id, input);
    await refresh();
    setAnnouncement(`Saved ${label}.`);
    setEditingId(null);
    setFocusId(h.holding_id);
  };

  const remove = async (h: BibHolding, label: string) => {
    setError('');
    try {
      await deleteBibHolding(orgId, recordId, h.holding_id);
      await refresh();
      const n = h.items.length;
      setAnnouncement(`Removed ${label}${n ? ` and its ${n === 1 ? 'item' : `${n} items`}` : ''}.`);
      if (editingId === h.holding_id) setEditingId(null);
      headingRef.current?.focus();
    } catch (err) {
      setError(`Could not remove ${label}: ${(err as Error).message}`);
    }
  };

  const editingIndex = holdings.findIndex((h) => h.holding_id === editingId);
  const editing = editingIndex >= 0 ? holdings[editingIndex] : null;

  return (
    <section aria-labelledby={`${id}-heading`} className="bg-parchment border border-lichen rounded-lg p-6">
      <h2 id={`${id}-heading`} ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-forest mb-3 focus:outline-none">
        Holdings and items
      </h2>
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      {error && (
        <p role="alert" className="mb-3 p-3 rounded-lg bg-semantic-error/10 border border-semantic-error/30 text-sm text-semantic-error">
          {error}
        </p>
      )}

      {holdings.length === 0 ? (
        <p className="text-sm text-archive">No holdings yet. Add a holding for each location where the library keeps this title, then add its items.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="text-left text-sm text-archive pb-2">
              {holdings.length === 1 ? '1 holding' : `${holdings.length} holdings`}
            </caption>
            <thead className="bg-stone/50">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Holding</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Holdings statement</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Public note</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Items</th>
                {canEdit && <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {holdings.map((h, index) => {
                const label = holdingLabel(h, index);
                return (
                  <tr key={h.holding_id} className="align-top">
                    <th scope="row" className="px-3 py-2 text-left font-medium text-ink">{label}</th>
                    <td className="px-3 py-2 text-ink">{h.holdings_statement || '—'}</td>
                    <td className="px-3 py-2 text-ink whitespace-pre-line">{h.public_note || '—'}</td>
                    <td className="px-3 py-2 text-ink">{h.items.length}</td>
                    {canEdit && (
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            ref={(el) => { editRefs.current[h.holding_id] = el; }}
                            onClick={() => setEditingId(h.holding_id)}
                            aria-label={`Edit ${label}`}
                            className={`btn btn-tertiary min-h-[44px] ${focusRing}`}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => (h.items.length ? setConfirmRemove({ holding: h, label }) : void remove(h, label))}
                            aria-label={`Remove ${label}`}
                            className={`btn btn-tertiary min-h-[44px] text-semantic-error ${focusRing}`}
                          >
                            Remove
                          </button>
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

      {canEdit && (editing ? (
        <HoldingForm
          key={editing.holding_id}
          orgId={orgId}
          heading={`Edit ${holdingLabel(editing, editingIndex)}`}
          initial={holdingDraft(editing)}
          submitText="Save holding"
          onSave={(input) => save(editing, holdingLabel(editing, editingIndex), input)}
          onCancel={() => { setEditingId(null); setFocusId(editing.holding_id); }}
          cancelLabel={`Cancel editing ${holdingLabel(editing, editingIndex)}`}
          currentLocation={editing.location_id ? { id: editing.location_id, name: editing.location_name } : undefined}
          focusOnMount
        />
      ) : (
        <HoldingForm
          orgId={orgId}
          heading="Add a holding"
          initial={emptyHolding}
          submitText="Add holding"
          onSave={add}
        />
      ))}

      {holdings.map((h, index) => (
        <HoldingItems
          key={h.holding_id}
          orgId={orgId}
          recordId={recordId}
          holding={h}
          label={holdingLabel(h, index)}
          canEdit={canEdit}
          announce={setAnnouncement}
          refresh={refresh}
        />
      ))}

      <ConfirmDialog
        isOpen={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => { if (confirmRemove) void remove(confirmRemove.holding, confirmRemove.label); }}
        title={confirmRemove ? `Remove ${confirmRemove.label}?` : 'Remove holding?'}
        message={confirmRemove
          ? `This also removes its ${confirmRemove.holding.items.length === 1 ? 'item' : `${confirmRemove.holding.items.length} items`}. Linked object records are not changed.`
          : ''}
        confirmText="Remove holding"
        confirmStyle="danger"
      />
    </section>
  );
}
