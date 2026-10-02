import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, X, Trash2 } from 'lucide-react';
import { WorkspaceSection } from '../../../components/workspace';
import { addShipmentReference, removeShipmentReference } from '../../../lib/api/shipments';
import { useToast } from '../../../contexts/ToastContext';
import type { ShipmentDetail } from './types';

interface ReferencesSectionProps {
  orgId: string;
  shipmentId: string;
  shipment: ShipmentDetail;
  isEditing: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  order?: number;
  isEmpty: boolean;
  summary?: string;
}

interface RefFormData {
  procedure_type: string;
  procedure_id: string;
  notes: string;
}

const emptyForm: RefFormData = {
  procedure_type: '',
  procedure_id: '',
  notes: '',
};

const PROCEDURE_TYPE_OPTIONS = [
  { value: '', label: '-- Select --' },
  { value: 'loan_out', label: 'Loan Out' },
  { value: 'loan_in', label: 'Loan In' },
  { value: 'object_exit', label: 'Object Exit' },
  { value: 'object_entry', label: 'Object Entry' },
  { value: 'exhibition_venue', label: 'Exhibition Venue' },
  { value: 'deaccession', label: 'Deaccession' },
];

const inputClassName =
  'w-full px-3 py-1.5 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark bg-parchment';

export default function ReferencesSection({
  orgId,
  shipmentId,
  shipment,
  isEditing,
  isExpanded,
  onToggle,
  order,
  isEmpty,
  summary,
}: ReferencesSectionProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<RefFormData>(emptyForm);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['shipment', orgId, shipmentId] });

  const addMutation = useMutation({
    mutationFn: () =>
      addShipmentReference(orgId, shipmentId, {
        procedure_type: formData.procedure_type,
        procedure_id: formData.procedure_id,
        notes: formData.notes || undefined,
      }),
    onSuccess: () => {
      invalidate();
      setFormData(emptyForm);
      setShowForm(false);
      showToast({ type: 'success', title: 'Procedure linked' });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: err.message || 'Failed to link procedure' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (refId: string) => removeShipmentReference(orgId, shipmentId, refId),
    onSuccess: () => {
      invalidate();
      showToast({ type: 'success', title: 'Procedure unlinked' });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: err.message || 'Failed to unlink procedure' });
    },
  });

  const references = shipment.references ?? [];

  return (
    <WorkspaceSection
      id="references"
      title="Linked Procedures"
      icon={<FileText size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
      isEmpty={isEmpty}
      summary={summary}
    >
      {references.length === 0 && !showForm ? (
        <div className="text-center py-8">
          <FileText size={32} className="mx-auto text-archive mb-3" />
          <p className="text-sm text-archive mb-4">No linked procedures</p>
          {isEditing && (
            <button type="button" onClick={() => setShowForm(true)} className="btn btn-primary" disabled={addMutation.isPending}>
              <Plus size={16} className="mr-1.5" />
              Link Procedure
            </button>
          )}
        </div>
      ) : (
        <>
        {isEditing && !showForm && (
          <div className="flex justify-end mb-2">
            <button type="button" onClick={() => setShowForm(true)} className="btn btn-secondary text-sm">
              <Plus size={14} className="mr-1" />
              Link Procedure
            </button>
          </div>
        )}
        <div className="space-y-2">
          {references.map((ref) => (
            <div
              key={ref.reference_id}
              className="flex items-center justify-between p-3 bg-stone/30 rounded-lg"
            >
              <div>
                <span className="text-xs font-medium text-archive bg-parchment px-2 py-1 rounded mr-2">
                  {ref.procedure_type_label}
                </span>
                <span className="text-sm text-ink font-mono">{ref.procedure_id.slice(0, 8)}...</span>
              </div>
              <div className="flex items-center gap-2">
                {ref.notes && <span className="text-xs text-archive">{ref.notes}</span>}
                {isEditing && (
                  <button
                    type="button"
                    onClick={() => removeMutation.mutate(ref.reference_id)}
                    className="p-1 text-archive hover:text-semantic-error transition-colors"
                    title="Remove"
                    disabled={removeMutation.isPending}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      {isEditing && showForm && (
        <div className="mt-3 p-4 border border-lichen rounded-lg bg-parchment space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink mb-1">
                Procedure Type <span className="text-semantic-error">*</span>
              </label>
              <select
                value={formData.procedure_type}
                onChange={(e) => setFormData((d) => ({ ...d, procedure_type: e.target.value }))}
                className={inputClassName}
              >
                {PROCEDURE_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink mb-1">
                Procedure ID <span className="text-semantic-error">*</span>
              </label>
              <input
                type="text"
                value={formData.procedure_id}
                onChange={(e) => setFormData((d) => ({ ...d, procedure_id: e.target.value }))}
                placeholder="Enter procedure UUID"
                className={inputClassName}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Notes</label>
            <input
              type="text"
              value={formData.notes}
              onChange={(e) => setFormData((d) => ({ ...d, notes: e.target.value }))}
              placeholder="Optional notes..."
              className={inputClassName}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => addMutation.mutate()}
              disabled={
                !formData.procedure_type || !formData.procedure_id.trim() || addMutation.isPending
              }
              className="btn btn-primary text-sm disabled:opacity-50"
            >
              {addMutation.isPending ? 'Linking...' : 'Link'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormData(emptyForm);
              }}
              className="text-sm text-archive hover:text-ink"
            >
              <X size={14} className="inline mr-1" />
              Cancel
            </button>
          </div>
        </div>
      )}
    </WorkspaceSection>
  );
}
