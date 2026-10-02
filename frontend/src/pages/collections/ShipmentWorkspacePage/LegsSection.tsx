import { useState } from 'react';
import Checkbox from '../../../components/Checkbox';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, X, Trash2, Pencil } from 'lucide-react';
import { WorkspaceSection } from '../../../components/workspace';
import { addShipmentLeg, updateShipmentLeg, removeShipmentLeg } from '../../../lib/api/shipments';
import { useToast } from '../../../contexts/ToastContext';
import { formatDateShort } from '@/lib/formatters';
import type { ShipmentDetail, LegData } from './types';

interface LegsSectionProps {
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

interface LegFormData {
  shipping_method: string;
  carrier_name: string;
  tracking_number: string;
  departure_location: string;
  departure_date: string;
  arrival_location: string;
  arrival_date: string;
  climate_controlled: boolean;
  notes: string;
}

const emptyForm: LegFormData = {
  shipping_method: '',
  carrier_name: '',
  tracking_number: '',
  departure_location: '',
  departure_date: '',
  arrival_location: '',
  arrival_date: '',
  climate_controlled: false,
  notes: '',
};

const SHIPPING_METHOD_OPTIONS = [
  { value: '', label: '-- Select --' },
  { value: 'air', label: 'Air' },
  { value: 'ground', label: 'Ground' },
  { value: 'sea', label: 'Sea' },
  { value: 'courier', label: 'Courier' },
  { value: 'hand_carry', label: 'Hand Carry' },
];

const inputClassName =
  'w-full px-3 py-1.5 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark bg-parchment';

function LegForm({
  formData,
  setFormData,
  onSubmit,
  onCancel,
  isPending,
  submitLabel,
}: {
  formData: LegFormData;
  setFormData: React.Dispatch<React.SetStateAction<LegFormData>>;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
  submitLabel: string;
}) {
  return (
    <div className="p-4 border border-lichen rounded-lg bg-parchment space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink mb-1">Shipping Method</label>
          <select
            value={formData.shipping_method}
            onChange={(e) => setFormData((d) => ({ ...d, shipping_method: e.target.value }))}
            className={inputClassName}
          >
            {SHIPPING_METHOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink mb-1">Carrier Name</label>
          <input
            type="text"
            value={formData.carrier_name}
            onChange={(e) => setFormData((d) => ({ ...d, carrier_name: e.target.value }))}
            placeholder="e.g. FedEx, Dietl"
            className={inputClassName}
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-ink mb-1">Tracking Number</label>
        <input
          type="text"
          value={formData.tracking_number}
          onChange={(e) => setFormData((d) => ({ ...d, tracking_number: e.target.value }))}
          className={inputClassName}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink mb-1">Departure Location</label>
          <input
            type="text"
            value={formData.departure_location}
            onChange={(e) => setFormData((d) => ({ ...d, departure_location: e.target.value }))}
            className={inputClassName}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink mb-1">Departure Date</label>
          <input
            type="date"
            value={formData.departure_date}
            onChange={(e) => setFormData((d) => ({ ...d, departure_date: e.target.value }))}
            className={inputClassName}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink mb-1">Arrival Location</label>
          <input
            type="text"
            value={formData.arrival_location}
            onChange={(e) => setFormData((d) => ({ ...d, arrival_location: e.target.value }))}
            className={inputClassName}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink mb-1">Arrival Date</label>
          <input
            type="date"
            value={formData.arrival_date}
            onChange={(e) => setFormData((d) => ({ ...d, arrival_date: e.target.value }))}
            className={inputClassName}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="climate_controlled"
          checked={formData.climate_controlled}
          onChange={(e) => setFormData((d) => ({ ...d, climate_controlled: e.target.checked }))}
        />
        <label htmlFor="climate_controlled" className="text-sm text-ink">
          Climate Controlled
        </label>
      </div>
      <div>
        <label className="block text-xs font-medium text-ink mb-1">Notes</label>
        <input
          type="text"
          value={formData.notes}
          onChange={(e) => setFormData((d) => ({ ...d, notes: e.target.value }))}
          className={inputClassName}
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSubmit}
          disabled={isPending}
          className="btn btn-primary text-sm disabled:opacity-50"
        >
          {isPending ? 'Saving...' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-archive hover:text-ink">
          <X size={14} className="inline mr-1" />
          Cancel
        </button>
      </div>
    </div>
  );
}

function legToForm(leg: LegData): LegFormData {
  return {
    shipping_method: leg.shipping_method ?? '',
    carrier_name: leg.carrier_name ?? '',
    tracking_number: leg.tracking_number ?? '',
    departure_location: leg.departure_location ?? '',
    departure_date: leg.departure_date ?? '',
    arrival_location: leg.arrival_location ?? '',
    arrival_date: leg.arrival_date ?? '',
    climate_controlled: false,
    notes: '',
  };
}

export default function LegsSection({
  orgId,
  shipmentId,
  shipment,
  isEditing,
  isExpanded,
  onToggle,
  order,
  isEmpty,
  summary,
}: LegsSectionProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<LegFormData>(emptyForm);
  const [editingLegId, setEditingLegId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<LegFormData>(emptyForm);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['shipment', orgId, shipmentId] });

  const buildPayload = (data: LegFormData) => ({
    shipping_method: data.shipping_method || undefined,
    carrier_name: data.carrier_name || undefined,
    tracking_number: data.tracking_number || undefined,
    departure_location: data.departure_location || undefined,
    departure_date: data.departure_date || undefined,
    arrival_location: data.arrival_location || undefined,
    arrival_date: data.arrival_date || undefined,
    climate_controlled: data.climate_controlled,
    notes: data.notes || undefined,
  });

  const addMutation = useMutation({
    mutationFn: () => addShipmentLeg(orgId, shipmentId, buildPayload(formData)),
    onSuccess: () => {
      invalidate();
      setFormData(emptyForm);
      setShowForm(false);
      showToast({ type: 'success', title: 'Leg added' });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: err.message || 'Failed to add leg' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (legId: string) =>
      updateShipmentLeg(orgId, shipmentId, legId, buildPayload(editFormData)),
    onSuccess: () => {
      invalidate();
      setEditingLegId(null);
      showToast({ type: 'success', title: 'Leg updated' });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: err.message || 'Failed to update leg' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (legId: string) => removeShipmentLeg(orgId, shipmentId, legId),
    onSuccess: () => {
      invalidate();
      showToast({ type: 'success', title: 'Leg removed' });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: err.message || 'Failed to remove leg' });
    },
  });

  const legs = shipment.legs ?? [];

  return (
    <WorkspaceSection
      id="legs"
      title="Legs"
      icon={<MapPin size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
      isEmpty={isEmpty}
      summary={summary}
    >
      {legs.length === 0 && !showForm ? (
        <div className="text-center py-8">
          <MapPin size={32} className="mx-auto text-archive mb-3" />
          <p className="text-sm text-archive mb-4">No legs added yet</p>
          {isEditing && (
            <button type="button" onClick={() => setShowForm(true)} className="btn btn-primary" disabled={addMutation.isPending}>
              <Plus size={16} className="mr-1.5" />
              Add Leg
            </button>
          )}
        </div>
      ) : (
        <>
        {isEditing && !showForm && (
          <div className="flex justify-end mb-2">
            <button type="button" onClick={() => setShowForm(true)} className="btn btn-secondary text-sm">
              <Plus size={14} className="mr-1" />
              Add Leg
            </button>
          </div>
        )}
        <div className="space-y-3">
          {legs.map((leg) =>
            editingLegId === leg.leg_id ? (
              <LegForm
                key={leg.leg_id}
                formData={editFormData}
                setFormData={setEditFormData}
                onSubmit={() => updateMutation.mutate(leg.leg_id)}
                onCancel={() => setEditingLegId(null)}
                isPending={updateMutation.isPending}
                submitLabel="Save"
              />
            ) : (
              <div
                key={leg.leg_id}
                className="flex items-center justify-between p-3 bg-stone/30 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-archive bg-parchment px-2 py-1 rounded">
                    Leg {leg.leg_number}
                  </span>
                  <div>
                    <div className="text-sm text-ink">
                      {leg.departure_location || '?'} &rarr; {leg.arrival_location || '?'}
                    </div>
                    <div className="text-xs text-archive mt-0.5">
                      {leg.shipping_method_label || '\u2014'}{' '}
                      {leg.carrier_name ? `/ ${leg.carrier_name}` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {leg.departure_date && (
                    <span className="text-xs text-archive">
                      {formatDateShort(leg.departure_date)}
                    </span>
                  )}
                  {leg.arrival_date && (
                    <span className="text-xs text-archive">
                      &rarr; {formatDateShort(leg.arrival_date)}
                    </span>
                  )}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      leg.status === 'arrived'
                        ? 'bg-semantic-success/10 text-semantic-success'
                        : leg.status === 'in_transit'
                          ? 'bg-semantic-info/10 text-semantic-info'
                          : 'bg-stone text-ink'
                    }`}
                  >
                    {leg.status_label}
                  </span>
                  {isEditing && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingLegId(leg.leg_id);
                          setEditFormData(legToForm(leg));
                        }}
                        className="text-xs text-archive hover:text-ink transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeMutation.mutate(leg.leg_id)}
                        className="p-1 text-archive hover:text-semantic-error transition-colors"
                        title="Remove"
                        disabled={removeMutation.isPending}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
        </>
      )}

      {isEditing && showForm && (
        <div className="mt-3">
          <LegForm
            formData={formData}
            setFormData={setFormData}
            onSubmit={() => addMutation.mutate()}
            onCancel={() => {
              setShowForm(false);
              setFormData(emptyForm);
            }}
            isPending={addMutation.isPending}
            submitLabel="Add"
          />
        </div>
      )}
    </WorkspaceSection>
  );
}
