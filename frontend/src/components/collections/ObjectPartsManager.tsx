/**
 * ObjectPartsManager - Manage object parts with independent location tracking.
 *
 * Every CollectionObject has at least one ObjectPart (auto-created).
 * Shows all parts with location badges and an "Add Part" button.
 *
 * Features:
 * - List parts with location badges
 * - Add/edit/remove part actions
 * - Part number auto-generation (.1, .2, etc.)
 * - Location selector per part
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  MapPin,
  Package,
  Edit2,
  Trash2,
  Loader2,
  AlertCircle,
  MoreVertical,
  Barcode,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  ArrowRightLeft,
} from 'lucide-react';
import { formatDateShort } from '../../lib/formatters';
import {
  getObjectParts,
  createObjectPart,
  updateObjectPart,
  deleteObjectPart,
  getMovements,
} from '../../lib/api';
import type { ObjectPart } from '../../lib/schemas';
import SlideOver from '../ui/SlideOver';
import { LocationPickerButton } from './LocationPickerModal';
import { MOVEMENT_REASON_LABELS } from './ObjectFieldComponents';
import ConfirmDialog from '../ConfirmDialog';

interface ObjectPartsManagerProps {
  organizationId: string;
  objectId: string;
  objectNumber: string;
  readOnly?: boolean;
}

interface PartFormData {
  name: string;
  description: string;
  current_location_id: string;
  current_location_fitness: string;
  current_location_note: string;
  home_location_id: string;
  barcode: string;
}

const LOCATION_FITNESS_OPTIONS = [
  { value: 'suitable', label: 'Suitable' },
  { value: 'temporary', label: 'Temporary' },
  { value: 'unsuitable', label: 'Unsuitable' },
];

const emptyFormData: PartFormData = {
  name: '',
  description: '',
  current_location_id: '',
  current_location_fitness: '',
  current_location_note: '',
  home_location_id: '',
  barcode: '',
};

export function ObjectPartsManager({
  organizationId,
  objectId,
  objectNumber,
  readOnly = false,
}: ObjectPartsManagerProps) {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPart, setEditingPart] = useState<ObjectPart | null>(null);
  const [formData, setFormData] = useState<PartFormData>(emptyFormData);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [expandedMovements, setExpandedMovements] = useState<Record<string, boolean>>({});
  const [expandedMovementsFull, setExpandedMovementsFull] = useState<Record<string, boolean>>({});
  const [confirmState, setConfirmState] = useState<{action: () => void; title: string; message: string} | null>(null);

  // Fetch parts
  const {
    data: partsData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['object-parts', organizationId, objectId],
    queryFn: () => getObjectParts(organizationId, objectId),
    enabled: !!organizationId && !!objectId,
  });

  // Fetch movements for this object (high limit to cover all parts)
  const { data: movementsData } = useQuery({
    queryKey: ['object-movements', organizationId, objectId],
    queryFn: () => getMovements(organizationId, { object_id: objectId, limit: 200 }),
    enabled: !!organizationId && !!objectId,
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<PartFormData>) =>
      createObjectPart(organizationId, objectId, {
        name: data.name || undefined,
        description: data.description || undefined,
        current_location_id: data.current_location_id || undefined,
        current_location_fitness: data.current_location_fitness || undefined,
        current_location_note: data.current_location_note || undefined,
        home_location_id: data.home_location_id || undefined,
        barcode: data.barcode || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-parts', organizationId, objectId] });
      queryClient.invalidateQueries({ queryKey: ['collection-object', organizationId, objectId] });
      queryClient.invalidateQueries({ queryKey: ['object-movements', organizationId, objectId] });
      setShowAddModal(false);
      setFormData(emptyFormData);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ partId, data }: { partId: string; data: Partial<PartFormData> }) =>
      updateObjectPart(organizationId, objectId, partId, {
        name: data.name || undefined,
        description: data.description || undefined,
        current_location_id: data.current_location_id || null,
        current_location_fitness: data.current_location_fitness || null,
        current_location_note: data.current_location_note || null,
        home_location_id: data.home_location_id || null,
        barcode: data.barcode || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-parts', organizationId, objectId] });
      queryClient.invalidateQueries({ queryKey: ['collection-object', organizationId, objectId] });
      queryClient.invalidateQueries({ queryKey: ['object-movements', organizationId, objectId] });
      setEditingPart(null);
      setFormData(emptyFormData);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (partId: string) => deleteObjectPart(organizationId, objectId, partId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-parts', organizationId, objectId] });
      queryClient.invalidateQueries({ queryKey: ['collection-object', organizationId, objectId] });
      queryClient.invalidateQueries({ queryKey: ['object-movements', organizationId, objectId] });
    },
  });

  const handleAddClick = () => {
    setFormData(emptyFormData);
    setShowAddModal(true);
  };

  const handleEditClick = (part: ObjectPart) => {
    setFormData({
      name: part.name || '',
      description: part.description || '',
      current_location_id: part.current_location_id || '',
      current_location_fitness: part.current_location_fitness || '',
      current_location_note: part.current_location_note || '',
      home_location_id: part.home_location_id || '',
      barcode: part.barcode || '',
    });
    setEditingPart(part);
    setActiveMenu(null);
  };

  const handleDelete = (part: ObjectPart) => {
    const partLabel = part.name || `Part ${part.part_number || ''}`;
    setConfirmState({
      action: () => deleteMutation.mutate(part.part_id),
      title: 'Remove Part',
      message: `Remove ${partLabel}? This cannot be undone.`,
    });
    setActiveMenu(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingPart) {
      updateMutation.mutate({ partId: editingPart.part_id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const parts = partsData?.parts || [];
  const allMovements = movementsData?.items || [];
  const totalMovements = movementsData?.total || 0;

  // Get movements for a specific part (or all movements for single-part objects)
  const getPartMovements = (partId: string | null) => {
    if (!partId) {
      // Single-part: show all movements for the object
      return allMovements;
    }
    // Multi-part: filter by part_id (include null-part movements too if they match)
    return allMovements.filter(m => m.part_id === partId);
  };

  const toggleMovements = (partId: string) => {
    setExpandedMovements(prev => ({ ...prev, [partId]: !prev[partId] }));
  };

  // Generate display label for part
  const getPartLabel = (part: ObjectPart): string => {
    const partNum = part.part_number ? `.${part.part_number}` : '';
    const name = part.name ? ` ${part.name}` : '';
    return `${objectNumber}${partNum}${name}`;
  };

  // Get location badge
  const getLocationBadge = (part: ObjectPart) => {
    if (!part.current_location_id) {
      return <span className="text-xs text-archive/50">No location</span>;
    }

    const isOnDisplay = part.current_location_on_display;
    const locDisplay = part.current_location_path || part.current_location_name || 'Unknown';

    return (
      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
        isOnDisplay
          ? 'bg-meadow/10 text-meadow-dark'
          : 'bg-stone/50 text-archive'
      }`}>
        <MapPin size={12} />
        {locDisplay}
        {isOnDisplay && ' (Display)'}
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 size={24} className="animate-spin text-archive" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-archive">
        <AlertCircle size={16} />
        <span>Failed to load parts</span>
      </div>
    );
  }

  const partFormFields = (
    <form onSubmit={handleSubmit} className="space-y-4 p-6">
      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-forest mb-1">
          Name
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={e => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g., Teapot, Lid, Sugar Bowl"
          className="input"
        />
        <p className="text-xs text-archive mt-1">
          Descriptive name for this part (optional but recommended)
        </p>
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-forest mb-1">
          Description
        </label>
        <textarea
          value={formData.description}
          onChange={e => setFormData({ ...formData, description: e.target.value })}
          rows={2}
          className="input"
          placeholder="Brief description of this part..."
        />
      </div>

      {/* Current Location */}
      <div>
        <label className="block text-sm font-medium text-forest mb-1">
          Current Location
        </label>
        <LocationPickerButton
          organizationId={organizationId}
          value={formData.current_location_id || null}
          onChange={(locationId) => setFormData({ ...formData, current_location_id: locationId || '' })}
          placeholder="Select location..."
        />
      </div>

      {/* Location Fitness */}
      <div>
        <label className="block text-sm font-medium text-forest mb-1">
          Location Fitness
        </label>
        <select
          value={formData.current_location_fitness}
          onChange={e => setFormData({ ...formData, current_location_fitness: e.target.value })}
          className="input"
        >
          <option value="">Not specified</option>
          {LOCATION_FITNESS_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Location Note */}
      <div>
        <label className="block text-sm font-medium text-forest mb-1">
          Location Note
        </label>
        <input
          type="text"
          value={formData.current_location_note}
          onChange={e => setFormData({ ...formData, current_location_note: e.target.value })}
          className="input"
          placeholder="e.g., Shelf 3, Case A"
        />
      </div>

      {/* Home Location */}
      <div>
        <label className="block text-sm font-medium text-forest mb-1">
          Home Location
        </label>
        <LocationPickerButton
          organizationId={organizationId}
          value={formData.home_location_id || null}
          onChange={(locationId) => setFormData({ ...formData, home_location_id: locationId || '' })}
          placeholder="Select home location..."
        />
        <p className="text-xs text-archive mt-1">
          Default storage location when not on display or loan
        </p>
      </div>

      {/* Barcode */}
      <div>
        <label className="block text-sm font-medium text-forest mb-1">
          Barcode
        </label>
        <input
          type="text"
          value={formData.barcode}
          onChange={e => setFormData({ ...formData, barcode: e.target.value })}
          className="input"
          placeholder="Scan or enter barcode..."
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4 border-t border-lichen">
        <button
          type="button"
          onClick={() => {
            setEditingPart(null);
            setShowAddModal(false);
            setFormData(emptyFormData);
          }}
          className="btn btn-ghost"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={createMutation.isPending || updateMutation.isPending}
          className="btn btn-primary"
        >
          {(createMutation.isPending || updateMutation.isPending) && (
            <Loader2 size={16} className="animate-spin mr-2" />
          )}
          {editingPart ? 'Save Changes' : 'Add Part'}
        </button>
      </div>
    </form>
  );

  // Single-part object: show movement history + option to split into parts
  if (parts.length <= 1) {
    return (
      <>
        <div className="space-y-4">
          {/* Movement History */}
          <div>
            <dt className="text-sm font-medium text-archive mb-2">Movement History</dt>
            <CompactMovementList
              movements={allMovements}
              total={totalMovements}
              showAll={!!expandedMovementsFull['_single']}
              onToggleShowAll={() => setExpandedMovementsFull(prev => ({ ...prev, _single: !prev._single }))}
            />
          </div>

          {/* Split into parts */}
          <div className="border-t border-lichen pt-4">
            <p className="text-sm text-archive mb-3">
              This object is tracked as a single unit. Add a part to split it into separately tracked components.
            </p>
            {!readOnly && (
              <button
                onClick={handleAddClick}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-dashed border-lichen text-archive hover:border-bark hover:text-bark rounded-lg transition-colors"
              >
                <Plus size={16} />
                Add Part
              </button>
            )}
          </div>
        </div>
        <SlideOver
          isOpen={showAddModal}
          onClose={() => { setShowAddModal(false); setFormData(emptyFormData); }}
          title="Add Part"
        >
          {partFormFields}
        </SlideOver>
        <ConfirmDialog
          isOpen={!!confirmState}
          onClose={() => setConfirmState(null)}
          onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
          title={confirmState?.title ?? ''}
          message={confirmState?.message ?? ''}
          confirmText="Confirm"
          confirmStyle="danger"
        />
      </>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-archive">
            {parts.length} parts across{' '}
            {new Set(parts.map(p => p.current_location_id).filter(Boolean)).size || 1} location(s)
          </div>
          {!readOnly && (
            <button
              onClick={handleAddClick}
              className="btn btn-sm btn-ghost text-archive hover:text-forest"
            >
              <Plus size={16} className="mr-1" />
              Add Part
            </button>
          )}
        </div>

        {/* Parts List */}
        <div className="space-y-2">
          {parts.map((part) => {
            const partMovements = getPartMovements(part.part_id);
            const isMovementsExpanded = expandedMovements[part.part_id];

            return (
              <div
                key={part.part_id}
                className="bg-parchment border border-lichen rounded-lg hover:border-archive/30 transition-colors"
              >
                <div className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded bg-stone/30 flex items-center justify-center flex-shrink-0">
                      <Package size={16} className="text-archive" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-forest truncate">
                        {getPartLabel(part)}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {getLocationBadge(part)}
                        {part.barcode && (
                          <span className="inline-flex items-center gap-1 text-xs text-archive">
                            <Barcode size={10} />
                            {part.barcode}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Movement history toggle */}
                    {partMovements.length > 0 && (
                      <button
                        onClick={() => toggleMovements(part.part_id)}
                        className="p-1.5 text-archive hover:text-forest rounded hover:bg-stone/50 text-xs flex items-center gap-1"
                        title="Movement history"
                      >
                        {isMovementsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span>{partMovements.length} mov.</span>
                      </button>
                    )}

                    {!readOnly && (
                      <div className="relative">
                        <button
                          onClick={() => setActiveMenu(activeMenu === part.part_id ? null : part.part_id)}
                          className="p-1.5 text-archive hover:text-forest rounded hover:bg-stone/50"
                        >
                          <MoreVertical size={16} />
                        </button>

                        {activeMenu === part.part_id && (
                          <>
                            <div
                              className="fixed inset-0 z-10"
                              onClick={() => setActiveMenu(null)}
                            />
                            <div className="absolute right-0 top-full mt-1 z-20 bg-parchment border border-lichen rounded-lg shadow-lg py-1 min-w-[140px]">
                              <button
                                onClick={() => handleEditClick(part)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-forest hover:bg-stone/30"
                              >
                                <Edit2 size={14} />
                                Edit
                              </button>
                              <button
                                onClick={() => handleDelete(part)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-semantic-error hover:bg-semantic-error/10"
                              >
                                <Trash2 size={14} />
                                Remove
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Per-part movement history (expandable) */}
                {isMovementsExpanded && partMovements.length > 0 && (
                  <div className="border-t border-lichen px-3 py-3">
                    <CompactMovementList
                      movements={partMovements}
                      total={partMovements.length}
                      showAll={!!expandedMovementsFull[part.part_id]}
                      onToggleShowAll={() => setExpandedMovementsFull(prev => ({ ...prev, [part.part_id]: !prev[part.part_id] }))}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Part SlideOver */}
      <SlideOver
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setFormData(emptyFormData); }}
        title="Add Part"
      >
        {partFormFields}
      </SlideOver>

      {/* Edit Part SlideOver */}
      <SlideOver
        isOpen={!!editingPart}
        onClose={() => { setEditingPart(null); setFormData(emptyFormData); }}
        title="Edit Part"
      >
        {partFormFields}
      </SlideOver>

      <ConfirmDialog
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmText="Confirm"
        confirmStyle="danger"
      />
    </>
  );
}

/**
 * Compact movement list for inline display within part cards.
 * Shows from → to with date and reason on a single line per movement.
 */
function CompactMovementList({
  movements,
  total,
  showAll,
  onToggleShowAll,
}: {
  movements: any[];
  total: number;
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  if (movements.length === 0) {
    return (
      <div className="text-center py-4 text-archive">
        <ArrowRightLeft size={20} className="mx-auto mb-2 opacity-40" />
        <p className="text-xs">No movements recorded</p>
      </div>
    );
  }

  const formatLoc = (path: string | null, name: string | null) =>
    path || name || 'Unknown';

  const formatDate = (dateStr: string) => formatDateShort(dateStr);

  const RECENT_COUNT = 3;
  const displayMovements = showAll ? movements : movements.slice(0, RECENT_COUNT);
  const hasMore = total > RECENT_COUNT;

  return (
    <div className="space-y-1.5">
      {displayMovements.map((m, i) => (
        <div
          key={m.movement_id}
          className={`flex items-center gap-2 text-xs py-1.5 px-2 rounded ${
            i === 0 ? 'bg-forest/5' : ''
          }`}
        >
          {/* From → To */}
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="text-archive truncate max-w-[140px]">
              {m.from_location_path || m.from_location_name
                ? formatLoc(m.from_location_path, m.from_location_name)
                : 'Initial'}
            </span>
            <ArrowRight size={12} className="text-archive/50 flex-shrink-0" />
            <span className={`font-medium truncate max-w-[140px] ${i === 0 ? 'text-forest' : 'text-ink'}`}>
              {formatLoc(m.to_location_path, m.to_location_name)}
            </span>
          </div>

          {/* Reason + Date */}
          <div className="flex items-center gap-1.5 text-archive flex-shrink-0">
            <span>{MOVEMENT_REASON_LABELS[m.reason] || m.reason}</span>
            {m.movement_date && (
              <>
                <span className="opacity-40">·</span>
                <span>{formatDate(m.movement_date)}</span>
              </>
            )}
          </div>
        </div>
      ))}

      {hasMore && (
        <div className="text-center pt-1">
          <button onClick={onToggleShowAll} className="text-xs text-bark hover:text-copper-dark">
            {showAll ? 'Show recent only' : `View all ${total} movements`}
          </button>
        </div>
      )}
    </div>
  );
}

export default ObjectPartsManager;
