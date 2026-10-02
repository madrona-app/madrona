import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, ArrowRight, Calendar, FileText, Loader2, Package } from 'lucide-react';
import { SlideOver } from '../ui/SlideOver';
import { LocationPickerButton } from './LocationPickerModal';
import { createMovement } from '../../lib/api';
import type { Location } from '../../lib/schemas';

const MOVEMENT_REASON_OPTIONS = [
  { value: 'storage', label: 'Storage' },
  { value: 'exhibition', label: 'Exhibition' },
  { value: 'conservation', label: 'Conservation' },
  { value: 'loan', label: 'Loan' },
  { value: 'photography', label: 'Photography' },
  { value: 'research', label: 'Research' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'rearrangement', label: 'Rearrangement' },
  { value: 'environmental', label: 'Environmental' },
  { value: 'security', label: 'Security' },
  { value: 'access_request', label: 'Access Request' },
  { value: 'other', label: 'Other' },
];

interface PartInfo {
  part_id: string;
  part_number: string | null;
  name: string | null;
  current_location_id: string | null;
  current_location_name: string | null;
  current_location_path: string | null;
}

interface RecordMovementSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  objectId: string;
  objectNumber?: string;
  objectTitle?: string;
  currentLocationId?: string | null;
  currentLocationName?: string | null;
  homeLocationId?: string | null;
  homeLocationName?: string | null;
  parts?: PartInfo[];
  onSuccess?: () => void;
}

export function RecordMovementSlideOver({
  isOpen,
  onClose,
  organizationId,
  objectId,
  objectNumber,
  objectTitle,
  currentLocationId,
  currentLocationName,
  homeLocationId,
  homeLocationName,
  parts,
  onSuccess,
}: RecordMovementSlideOverProps) {
  const queryClient = useQueryClient();
  const isMultiPart = parts && parts.length > 1;

  const [selectedPartId, setSelectedPartId] = useState<string>('');
  const [formData, setFormData] = useState({
    to_location_id: '',
    reason: 'storage',
    movement_date: new Date().toISOString().split('T')[0],
    movement_note: '',
  });

  const [toLocationName, setToLocationName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derive from-location based on selected part or object
  const selectedPart = isMultiPart && selectedPartId
    ? parts.find(p => p.part_id === selectedPartId)
    : null;

  const fromLocationName = isMultiPart
    ? (selectedPart ? (selectedPart.current_location_path || selectedPart.current_location_name || 'Not set') : null)
    : (currentLocationName || 'Not set');

  const fromLocationId = isMultiPart
    ? (selectedPart?.current_location_id || null)
    : (currentLocationId || null);

  // Reset form when opening
  useEffect(() => {
    if (isOpen) {
      setFormData({
        to_location_id: '',
        reason: 'storage',
        movement_date: new Date().toISOString().split('T')[0],
        movement_note: '',
      });
      setSelectedPartId('');
      setToLocationName(null);
      setError(null);
    }
  }, [isOpen]);

  const createMutation = useMutation({
    mutationFn: (data: {
      object_id: string;
      part_id?: string;
      to_location_id: string;
      reason: string;
      movement_date?: string;
      movement_note?: string;
    }) => createMovement(organizationId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-movements', organizationId, objectId] });
      queryClient.invalidateQueries({ queryKey: ['collection-movements', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['collection-object', organizationId, objectId] });
      queryClient.invalidateQueries({ queryKey: ['object-parts', organizationId, objectId] });
      onSuccess?.();
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to record movement');
    },
  });

  const today = new Date().toISOString().split('T')[0];

  const handleSubmit = () => {
    if (isMultiPart && !selectedPartId) {
      setError('Please select which part to move');
      return;
    }

    if (!formData.to_location_id) {
      setError('Please select a destination location');
      return;
    }

    if (formData.movement_date && formData.movement_date > today) {
      setError('Movement date cannot be in the future');
      return;
    }

    createMutation.mutate({
      object_id: objectId,
      part_id: isMultiPart ? selectedPartId : undefined,
      to_location_id: formData.to_location_id,
      reason: formData.reason,
      movement_date: formData.movement_date || undefined,
      movement_note: formData.movement_note || undefined,
    });
  };

  const handleMoveToHome = () => {
    if (homeLocationId) {
      setFormData(prev => ({ ...prev, to_location_id: homeLocationId }));
      setToLocationName(homeLocationName || 'Home location');
    }
  };

  const handleLocationChange = (locationId: string | null, location?: Location) => {
    setFormData(prev => ({ ...prev, to_location_id: locationId || '' }));
    setToLocationName(location ? (location.path || location.name) : null);
  };

  const getPartLabel = (part: PartInfo) => {
    const num = part.part_number ? `.${part.part_number}` : '';
    const name = part.name ? ` ${part.name}` : '';
    return `${objectNumber || ''}${num}${name}`;
  };

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title="Record Movement"
      subtitle={objectNumber ? `${objectNumber}${objectTitle ? `: ${objectTitle}` : ''}` : undefined}
      width="lg"
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-archive hover:text-ink"
            disabled={createMutation.isPending}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 flex items-center gap-2"
            disabled={createMutation.isPending || !formData.to_location_id || (isMultiPart && !selectedPartId)}
          >
            {createMutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Recording...
              </>
            ) : (
              'Record Movement'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error text-sm">
            {error}
          </div>
        )}

        {/* Part Selector (multi-part objects only) */}
        {isMultiPart && (
          <div>
            <label className="text-sm font-medium text-ink block mb-1.5">
              <Package size={14} className="inline mr-1.5" />
              Part to Move <span className="text-semantic-error">*</span>
            </label>
            <select
              value={selectedPartId}
              onChange={(e) => setSelectedPartId(e.target.value)}
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              <option value="">Select part...</option>
              {parts.map((part) => (
                <option key={part.part_id} value={part.part_id}>
                  {getPartLabel(part)}
                  {part.current_location_path || part.current_location_name
                    ? ` — ${part.current_location_path || part.current_location_name}`
                    : ' — No location'}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* From Location (read-only) */}
        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">From Location</label>
          <div className="flex items-center gap-2 p-3 bg-stone/30 rounded-lg text-sm">
            <MapPin size={16} className="text-archive" />
            <span>{isMultiPart && !selectedPartId ? 'Select a part first' : fromLocationName}</span>
          </div>
          {!isMultiPart && (
            <p className="text-xs text-archive mt-1">Current location of the object</p>
          )}
        </div>

        {/* To Location */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-ink">
              To Location <span className="text-semantic-error">*</span>
            </label>
            {homeLocationId && homeLocationId !== fromLocationId && (
              <button
                onClick={handleMoveToHome}
                className="text-xs text-bark hover:text-copper-dark"
              >
                Use home location
              </button>
            )}
          </div>
          <LocationPickerButton
            organizationId={organizationId}
            value={formData.to_location_id || null}
            onChange={handleLocationChange}
            placeholder="Select destination location..."
          />
        </div>

        {/* Reason */}
        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            Reason <span className="text-semantic-error">*</span>
          </label>
          <select
            value={formData.reason}
            onChange={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          >
            {MOVEMENT_REASON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Date */}
        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            <Calendar size={14} className="inline mr-1.5" />
            Movement Date
          </label>
          <input
            type="date"
            value={formData.movement_date}
            max={today}
            onChange={(e) => setFormData(prev => ({ ...prev, movement_date: e.target.value }))}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            <FileText size={14} className="inline mr-1.5" />
            Notes
          </label>
          <textarea
            value={formData.movement_note}
            onChange={(e) => setFormData(prev => ({ ...prev, movement_note: e.target.value }))}
            placeholder="Optional notes about this movement..."
            rows={3}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
          />
        </div>

        {/* Visual indicator */}
        {formData.to_location_id && toLocationName && fromLocationName && (!isMultiPart || selectedPartId) && (
          <div className="flex items-center gap-3 p-4 bg-forest/5 border border-forest/20 rounded-lg">
            <div className="flex-1 text-center">
              <p className="text-xs text-archive mb-1">From</p>
              <p className="text-sm font-medium text-ink">{fromLocationName}</p>
            </div>
            <ArrowRight size={20} className="text-forest" />
            <div className="flex-1 text-center">
              <p className="text-xs text-archive mb-1">To</p>
              <p className="text-sm font-medium text-ink">{toLocationName}</p>
            </div>
          </div>
        )}
      </div>
    </SlideOver>
  );
}
