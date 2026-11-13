/**
 * AuditBulkUpdate - act on selected check-list results.
 *
 * "Update records" previews then applies: wrong-location results get a
 * Movement to the found location (same service as the workspace
 * record_movement bulk action) and seen objects get last inventoried
 * date/by. "Send to workspace" puts the selected objects in a workspace,
 * where every other existing bulk action is available.
 */
import { useCallback, useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Layers, RefreshCw } from 'lucide-react';
import { previewAuditBulkUpdate, executeAuditBulkUpdate } from '../../../lib/api';
import type { AuditBulkUpdateRequest, AuditBulkUpdateResult } from '../../../lib/api';
import { useAccessibleModal, getModalAriaProps } from '../../../hooks/useAccessibleModal';
import { ModalPortal } from '../../../components/ModalPortal';
import { AddToWorkspaceDialog } from '../../../components/workspaces';
import type { SelectionContext } from './AuditCheckList';

interface Props extends SelectionContext {
  orgId: string;
  campaignId: string;
}

export function AuditBulkUpdate({ orgId, campaignId, items, selectedIds, setSelectedIds, clearSelection, announce }: Props) {
  const ids = useId();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const closeDialog = useCallback(() => setDialogOpen(false), []);

  const selected = items.filter((i) => selectedIds.has(i.result_id));
  const count = selected.length;
  const wrong = items.filter((i) => i.outcome === 'wrong_location' && i.follow_up_action !== 'location_updated');
  const seen = items.filter((i) => i.outcome === 'found' || i.outcome === 'wrong_location');
  const objectIds = Array.from(new Set(selected.map((i) => i.object_id).filter((x): x is string => !!x)));

  const selectGroup = (group: typeof items, label: string) => {
    setSelectedIds(new Set(group.map((i) => i.result_id)));
    announce(`Selected ${group.length} ${label}.`);
  };

  return (
    <div role="region" aria-labelledby={`${ids}-heading`} className="border border-lichen rounded-lg p-3 flex flex-col gap-3 print:hidden">
      <h4 id={`${ids}-heading`} className="text-sm font-semibold text-ink">Act on selected results</h4>
      <p className="text-sm text-ink">
        {count} of {items.length} selected
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => selectGroup(wrong, `wrong-location result${wrong.length === 1 ? '' : 's'} not yet applied`)}
          disabled={!wrong.length} className="btn btn-tertiary text-sm min-h-[44px]">
          Select wrong location ({wrong.length})
        </button>
        <button type="button" onClick={() => selectGroup(seen, `result${seen.length === 1 ? '' : 's'} where the object was seen`)}
          disabled={!seen.length} className="btn btn-tertiary text-sm min-h-[44px]">
          Select all seen ({seen.length})
        </button>
        <button type="button" onClick={() => { clearSelection(); announce('Selection cleared.'); }}
          disabled={!count} className="btn btn-tertiary text-sm min-h-[44px]">
          Clear selection
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setDialogOpen(true)} disabled={!count} aria-haspopup="dialog"
          className="btn btn-primary text-sm min-h-[44px] inline-flex items-center gap-2">
          <RefreshCw size={16} aria-hidden="true" />
          Update records ({count})
        </button>
        <button type="button" onClick={() => setWorkspaceOpen(true)} disabled={!objectIds.length} aria-haspopup="dialog"
          className="btn btn-secondary text-sm min-h-[44px] inline-flex items-center gap-2">
          <Layers size={16} aria-hidden="true" />
          Send to workspace ({objectIds.length})
        </button>
      </div>
      <p className="text-xs text-accessible-gray">
        In a workspace you can apply any other bulk action, such as condition checks or status changes, to these objects.
      </p>

      {dialogOpen && (
        <BulkUpdateDialog
          orgId={orgId}
          campaignId={campaignId}
          resultIds={selected.map((i) => i.result_id)}
          onClose={closeDialog}
          announce={announce}
        />
      )}
      <AddToWorkspaceDialog
        isOpen={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
        objectIds={objectIds}
        objectLabel={`${objectIds.length} object${objectIds.length === 1 ? '' : 's'}`}
      />
    </div>
  );
}

function BulkUpdateDialog({ orgId, campaignId, resultIds, onClose, announce }: {
  orgId: string;
  campaignId: string;
  resultIds: string[];
  onClose: () => void;
  announce: (m: string) => void;
}) {
  const queryClient = useQueryClient();
  const { modalRef, titleId, descriptionId } = useAccessibleModal({ isOpen: true, onClose, titlePrefix: 'audit-bulk-update' });
  const ids = useId();
  const [updateLocation, setUpdateLocation] = useState(true);
  const [markInventoried, setMarkInventoried] = useState(true);
  const [reason, setReason] = useState('inventory');
  const [preview, setPreview] = useState<AuditBulkUpdateResult | null>(null);
  const [done, setDone] = useState<AuditBulkUpdateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogMessage, setDialogMessage] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  const request = (): AuditBulkUpdateRequest => ({
    result_ids: resultIds,
    update_location: updateLocation,
    mark_inventoried: markInventoried,
    reason: reason.trim() || 'inventory',
  });

  const previewMutation = useMutation({
    mutationFn: () => previewAuditBulkUpdate(orgId, campaignId, request()),
    onSuccess: (data) => {
      setPreview(data);
      setError(null);
      setDialogMessage(summary(data, false));
    },
    onError: (err: Error) => setError(err.message),
  });

  const executeMutation = useMutation({
    mutationFn: () => executeAuditBulkUpdate(orgId, campaignId, request()),
    onSuccess: (data) => {
      setDone(data);
      setError(null);
      const text = summary(data, true);
      setDialogMessage(text);
      announce(text);
      requestAnimationFrame(() => closeRef.current?.focus());
      queryClient.invalidateQueries({ queryKey: ['audit-check-list', orgId, campaignId] });
      queryClient.invalidateQueries({ queryKey: ['audit-campaign', orgId, campaignId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const shown = done ?? preview;
  const optionsChanged = () => { setPreview(null); setDone(null); };
  const nothingChosen = !updateLocation && !markInventoried;
  const nothingToApply = !!preview && preview.location_update_count === 0 && preview.inventoried_count === 0;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50" data-modal-layer="1000">
        <div ref={modalRef} {...getModalAriaProps(titleId, descriptionId)}
          className="bg-parchment rounded-lg max-w-3xl w-[95%] max-h-[90vh] overflow-y-auto shadow-xl">
          <div className="px-6 py-5 border-b border-lichen">
            <h2 id={titleId} className="m-0 text-lg font-semibold text-ink font-serif">
              Update records from {resultIds.length} result{resultIds.length === 1 ? '' : 's'}
            </h2>
            <p id={descriptionId} className="text-sm text-accessible-gray mt-1">
              Choose what to update, preview the changes, then apply them.
            </p>
          </div>
          <div className="px-6 py-5 flex flex-col gap-4">
            <div role="status" aria-live="polite" className="text-sm text-ink">{dialogMessage}</div>
            <fieldset disabled={!!done} className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-ink mb-1">Updates to apply</legend>
              <label className="inline-flex items-start gap-2 text-sm text-ink min-h-[44px]">
                <input type="checkbox" className="w-5 h-5 mt-0.5" checked={updateLocation}
                  onChange={(e) => { setUpdateLocation(e.target.checked); optionsChanged(); }} />
                <span>Update current location to the found location (records a movement) for wrong-location results</span>
              </label>
              <label className="inline-flex items-start gap-2 text-sm text-ink min-h-[44px]">
                <input type="checkbox" className="w-5 h-5 mt-0.5" checked={markInventoried}
                  onChange={(e) => { setMarkInventoried(e.target.checked); optionsChanged(); }} />
                <span>Set last inventoried date and person from the check, for objects that were seen</span>
              </label>
              {updateLocation && (
                <div>
                  <label htmlFor={`${ids}-reason`} className="block text-sm font-medium text-ink mb-1">Movement reason</label>
                  <input id={`${ids}-reason`} type="text" value={reason} maxLength={50}
                    onChange={(e) => { setReason(e.target.value); optionsChanged(); }}
                    className="input w-full max-w-xs min-h-[44px]" />
                </div>
              )}
            </fieldset>

            {error && <p role="alert" className="text-sm text-semantic-error">{error}</p>}

            {shown && (
              <div className="overflow-x-auto border border-lichen rounded-lg">
                <table className="w-full text-sm">
                  <caption className="text-left px-3 py-2 font-medium text-ink">
                    {done ? 'Applied changes' : 'Preview of changes'}
                  </caption>
                  <thead className="bg-stone/50">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Object number</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Changes</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Not changed</th>
                      {done && <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Outcome</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-lichen">
                    {shown.rows.map((r) => (
                      <tr key={r.result_id}>
                        <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                          {r.object_number || '—'}
                          {r.title && <span className="block text-xs font-normal text-accessible-gray">{r.title}</span>}
                        </th>
                        <td className="px-3 py-2 text-ink">
                          {r.changes.length ? <ul className="list-disc pl-4">{r.changes.map((c) => <li key={c}>{c}</li>)}</ul> : 'None'}
                        </td>
                        <td className="px-3 py-2 text-ink">
                          {r.skipped.length ? <ul className="list-disc pl-4">{r.skipped.map((c) => <li key={c}>{c}</li>)}</ul> : '—'}
                        </td>
                        {done && (
                          <td className="px-3 py-2 text-ink">
                            {r.status === 'success' ? 'Updated' : r.status === 'error' ? `Failed${r.message ? `: ${r.message}` : ''}` : 'Skipped'}
                            {r.movement_reference && <span className="block text-xs text-accessible-gray">Movement {r.movement_reference}</span>}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="px-6 py-4 border-t border-lichen flex flex-wrap justify-end gap-3">
            <button ref={closeRef} type="button" onClick={onClose} className="btn btn-secondary min-h-[44px]">
              {done ? 'Close' : 'Cancel'}
            </button>
            {!done && (
              <button type="button" onClick={() => previewMutation.mutate()}
                disabled={nothingChosen || previewMutation.isPending}
                className="btn btn-secondary min-h-[44px]">
                {previewMutation.isPending ? 'Previewing…' : 'Preview changes'}
              </button>
            )}
            {!done && (
              <button type="button" onClick={() => executeMutation.mutate()}
                disabled={!preview || nothingToApply || executeMutation.isPending}
                className="btn btn-primary min-h-[44px]">
                {executeMutation.isPending ? 'Applying…' : 'Apply changes'}
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

function summary(r: AuditBulkUpdateResult, executed: boolean): string {
  const parts: string[] = [];
  if (r.update_location) parts.push(`${r.location_update_count} location update${r.location_update_count === 1 ? '' : 's'}`);
  if (r.mark_inventoried) parts.push(`${r.inventoried_count} inventoried date${r.inventoried_count === 1 ? '' : 's'}`);
  const head = executed ? 'Applied' : 'Preview';
  const skipped = r.skipped_count ? `, ${r.skipped_count} result${r.skipped_count === 1 ? '' : 's'} with nothing to change` : '';
  return `${head}: ${parts.join(' and ')}${skipped}.`;
}
