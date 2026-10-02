import React, { useState, useEffect, useLayoutEffect } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MapPin,
  Plus,
  ChevronRight,
  ChevronDown,
  Building2,
  Layers,
  Home,
  Archive,
  Box,
  Edit,
  Trash2,
  Package,
  X,
  Sparkles,
} from 'lucide-react';
import { getLocations, createLocation, updateLocation, deleteLocation } from '../../lib/api';
import { formatNumber } from '@/lib/formatters';
import type { Location } from '../../lib/schemas';
import { usePermissions } from '../../hooks/usePermissions';
import ConfirmDialog from '../../components/ConfirmDialog';

const LOCATION_TYPE_ICONS: Record<string, React.ReactNode> = {
  building: <Building2 size={16} />,
  floor: <Layers size={16} />,
  room: <Home size={16} />,
  case: <Archive size={16} />,
  shelf: <Box size={16} />,
  drawer: <Archive size={16} />,
  other: <MapPin size={16} />,
};

export default function CollectionLocationsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();

  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [parentForNew, setParentForNew] = useState<string | null>(null);
  const [parentTypeForNew, setParentTypeForNew] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // L10: Scroll persistence
  const SCROLL_KEY = 'collection-locations-scroll';
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) sessionStorage.removeItem(SCROLL_KEY);
    if (saved) {
      requestAnimationFrame(() => {
        document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10));
      });
    }
  }, []);
  useEffect(() => {
    return () => {
      sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    };
  }, []);

  const {
    data: locationsData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['collection-locations', orgId],
    queryFn: () => getLocations(orgId!),
    enabled: !!orgId,
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Location>) => createLocation(orgId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection-locations', orgId] });
      setIsCreating(false);
      setParentForNew(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Location> }) =>
      updateLocation(orgId!, id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['collection-locations', orgId] });
      setSelectedLocation(updated);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteLocation(orgId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection-locations', orgId] });
      setSelectedLocation(null);
    },
  });

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Build tree from flat list
  const buildTree = (locations: Location[]): Location[] => {
    const map = new Map<string, Location & { children: Location[] }>();
    const roots: (Location & { children: Location[] })[] = [];

    // Initialize all locations with empty children arrays
    locations.forEach(loc => {
      map.set(loc.location_id, { ...loc, children: [] });
    });

    // Build parent-child relationships
    locations.forEach(loc => {
      const node = map.get(loc.location_id)!;
      if (loc.parent_id && map.has(loc.parent_id)) {
        map.get(loc.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  };

  const locationTree = locationsData?.items ? buildTree(locationsData.items) : [];

  const handleAddChild = (parentId: string | null, parentType: string | null = null) => {
    setParentForNew(parentId);
    setParentTypeForNew(parentType);
    setIsCreating(true);
    setSelectedLocation(null);
  };

  const handleDelete = () => {
    if (!selectedLocation) return;
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    if (selectedLocation) {
      deleteMutation.mutate(selectedLocation.location_id);
    }
    setShowDeleteConfirm(false);
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="animate-pulse">
          <div className="h-8 bg-stone rounded w-1/4 mb-6" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 h-96 bg-stone rounded-institutional" />
            <div className="h-96 bg-stone rounded-institutional" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="text-center py-12 text-semantic-error">
          Error loading locations: {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        {/* Header Row: Title + Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <MapPin size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Location and Movement Control</h1>
              <p className="text-sm text-archive mt-0.5">
                {locationsData?.items ? (
                  locationsData.items.length === 0 ? <span>No locations yet</span>
                  : locationsData.items.length === 1 ? <span>1 location</span>
                  : <span>{formatNumber(locationsData.items.length)} locations</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          {hasPermission('locations.edit') && (
            <button
              onClick={() => handleAddChild(null)}
              className="btn btn-primary flex items-center gap-2 shrink-0 sm:self-auto self-start"
            >
              <Plus size={18} />
              Add Location
            </button>
          )}
        </div>
        {/* Description: Full width, below header row */}
        <p className="text-sm text-archive leading-relaxed">
          Tracks where objects are stored, displayed, or in transit within or outside the institution. Maintains a complete movement history to support accountability, security, and retrieval.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tree View */}
        <div className="lg:col-span-2 card">
          <div className="p-4 border-b border-lichen">
            <h2 className="font-serif font-medium text-forest">Location Hierarchy</h2>
          </div>
          <div className="p-4">
            {locationTree.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
                  <Sparkles size={40} className="text-bark" />
                </div>
                <h3 className="text-2xl font-serif font-medium text-forest mb-6">No locations yet.</h3>
                {hasPermission('locations.edit') && (
                  <button
                    onClick={() => handleAddChild(null)}
                    className="btn btn-primary flex items-center gap-2 mx-auto"
                  >
                    <Plus size={16} />
                    Add First Location
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                {locationTree.map(location => (
                  <LocationTreeNode
                    key={location.location_id}
                    location={location}
                    depth={0}
                    expandedIds={expandedIds}
                    toggleExpanded={toggleExpanded}
                    selectedId={selectedLocation?.location_id}
                    onSelect={setSelectedLocation}
                    onAddChild={handleAddChild}
                    canEdit={hasPermission('locations.edit')}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Detail/Edit Panel */}
        <div className="card">
          {isCreating ? (
            <LocationForm
              parentId={parentForNew}
              parentType={parentTypeForNew}
              onSave={(data) => createMutation.mutate(data)}
              onCancel={() => {
                setIsCreating(false);
                setParentForNew(null);
                setParentTypeForNew(null);
              }}
              isLoading={createMutation.isPending}
            />
          ) : selectedLocation ? (
            <LocationDetail
              location={selectedLocation}
              onUpdate={(data) => updateMutation.mutate({ id: selectedLocation.location_id, data })}
              onDelete={handleDelete}
              onAddChild={() => handleAddChild(selectedLocation.location_id, selectedLocation.location_type)}
              canEdit={hasPermission('locations.edit')}
              isUpdating={updateMutation.isPending}
              isDeleting={deleteMutation.isPending}
            />
          ) : (
            <div className="p-4 text-center text-archive">
              <MapPin size={48} className="mx-auto mb-4 opacity-50" />
              <p>Select a location to view details</p>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={confirmDelete}
        title="Delete Location"
        message={`Are you sure you want to delete "${selectedLocation?.name}"? This will also delete all child locations. This action cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}

// Tree Node Component
function LocationTreeNode({
  location,
  depth,
  expandedIds,
  toggleExpanded,
  selectedId,
  onSelect,
  onAddChild,
  canEdit,
}: {
  location: Location & { children?: Location[] };
  depth: number;
  expandedIds: Set<string>;
  toggleExpanded: (id: string) => void;
  selectedId?: string;
  onSelect: (location: Location) => void;
  onAddChild: (parentId: string, parentType: string) => void;
  canEdit: boolean;
}) {
  const hasChildren = location.children && location.children.length > 0;
  const isExpanded = expandedIds.has(location.location_id);
  const isSelected = selectedId === location.location_id;

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-2 py-1.5 rounded-institutional cursor-pointer group
                   ${isSelected
                     ? 'bg-azurite/10 text-azurite'
                     : 'hover:bg-stone'
                   }`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => onSelect(location)}
      >
        {/* Expand/Collapse */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleExpanded(location.location_id);
          }}
          className={`p-0.5 rounded-institutional hover:bg-lichen ${
            hasChildren ? 'visible' : 'invisible'
          }`}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {/* Icon */}
        <span className="text-archive">
          {LOCATION_TYPE_ICONS[location.location_type] || <MapPin size={16} />}
        </span>

        {/* Name */}
        <span className={`flex-1 text-sm ${location.status !== 'active' ? 'text-archive line-through' : 'text-ink'}`}>
          {location.name}
        </span>

        {/* Object count */}
        {location.current_count != null && location.current_count > 0 && (
          <span className="text-xs text-archive flex items-center gap-1">
            <Package size={12} />
            {location.current_count}
          </span>
        )}

        {/* Add child button */}
        {canEdit && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddChild(location.location_id, location.location_type);
            }}
            className="opacity-0 group-hover:opacity-100 p-1 text-archive hover:text-ink"
            title="Add child location"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {location.children!.map((child: Location) => (
            <LocationTreeNode
              key={child.location_id}
              location={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              toggleExpanded={toggleExpanded}
              selectedId={selectedId}
              onSelect={onSelect}
              onAddChild={onAddChild}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Location Detail Component
function LocationDetail({
  location,
  onUpdate,
  onDelete,
  onAddChild,
  canEdit,
  isUpdating,
  isDeleting,
}: {
  location: Location;
  onUpdate: (data: Partial<Location>) => void;
  onDelete: () => void;
  onAddChild: () => void;
  canEdit: boolean;
  isUpdating: boolean;
  isDeleting: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <LocationForm
        initialData={location}
        onSave={(data) => {
          onUpdate(data);
          setIsEditing(false);
        }}
        onCancel={() => setIsEditing(false)}
        isLoading={isUpdating}
      />
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-archive">
            {LOCATION_TYPE_ICONS[location.location_type] || <MapPin size={20} />}
          </span>
          <h3 className="font-serif font-medium text-forest">{location.name}</h3>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button
              onClick={() => setIsEditing(true)}
              className="p-1.5 text-archive hover:text-ink"
              title="Edit"
            >
              <Edit size={16} />
            </button>
            <button
              onClick={onDelete}
              disabled={isDeleting}
              className="p-1.5 text-archive hover:text-semantic-error"
              title="Delete"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-archive">Type</dt>
          <dd className="text-ink capitalize">{location.location_type}</dd>
        </div>
        {location.path && (
          <div>
            <dt className="text-archive">Path</dt>
            <dd className="text-ink">{location.path}</dd>
          </div>
        )}
        {location.security_level && (
          <div>
            <dt className="text-archive">Security Level</dt>
            <dd className="text-ink">{location.security_level}</dd>
          </div>
        )}
        {location.on_display && (
          <div>
            <dt className="text-archive">Display Location</dt>
            <dd className="text-ink">Yes - objects here are on display</dd>
          </div>
        )}
        {location.climate_controlled && (
          <div>
            <dt className="text-archive">Climate Controlled</dt>
            <dd className="text-ink">Yes</dd>
          </div>
        )}
        {location.capacity !== null && location.capacity !== undefined && (
          <div>
            <dt className="text-archive">Capacity</dt>
            <dd className="text-ink">{location.capacity} objects</dd>
          </div>
        )}
        {location.note && (
          <div>
            <dt className="text-archive">Notes</dt>
            <dd className="text-ink whitespace-pre-wrap">{location.note}</dd>
          </div>
        )}
        <div>
          <dt className="text-archive">Status</dt>
          <dd>
            <span className={location.status === 'active' ? 'badge-success-subtle' : 'badge-neutral'}>
              {location.status === 'active' ? 'Active' : 'Inactive'}
            </span>
          </dd>
        </div>
      </dl>

      {canEdit && (
        <button
          onClick={onAddChild}
          className="mt-4 w-full btn btn-secondary flex items-center justify-center gap-2"
        >
          <Plus size={16} />
          Add Child Location
        </button>
      )}
    </div>
  );
}

type LocationType = 'building' | 'floor' | 'room' | 'case' | 'shelf' | 'drawer' | 'other';

// Get the next level down in the location hierarchy
const getChildLocationType = (parentType: string | null): LocationType | '' => {
  const hierarchy: Record<string, LocationType> = {
    building: 'floor',
    floor: 'room',
    room: 'case',
    case: 'shelf',
    shelf: 'drawer',
    drawer: 'other',
    other: 'other',
  };
  return parentType ? hierarchy[parentType] || '' : '';
};

// Location Form Component
function LocationForm({
  parentId,
  parentType,
  initialData,
  onSave,
  onCancel,
  isLoading,
}: {
  parentId?: string | null;
  parentType?: string | null;
  initialData?: Location;
  onSave: (data: Partial<Location>) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  // Calculate default type: use initial data, or derive from parent, or empty
  const defaultType = initialData?.location_type || getChildLocationType(parentType || null);

  const [formData, setFormData] = useState({
    name: initialData?.name || '',
    location_type: defaultType,
    security_level: initialData?.security_level || '',
    on_display: initialData?.on_display ?? false,
    climate_controlled: initialData?.climate_controlled ?? false,
    capacity: initialData?.capacity?.toString() || '',
    note: initialData?.note || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name: formData.name,
      location_type: formData.location_type as LocationType,
      parent_id: parentId || null,
      security_level: formData.security_level || null,
      on_display: formData.on_display,
      climate_controlled: formData.climate_controlled,
      capacity: formData.capacity ? parseInt(formData.capacity) : null,
      note: formData.note || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-serif font-medium text-forest">
          {initialData ? 'Edit Location' : 'New Location'}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 text-archive hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Name *
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            required
            className="input w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Type *
          </label>
          <select
            value={formData.location_type}
            onChange={(e) => setFormData(prev => ({ ...prev, location_type: e.target.value as LocationType | '' }))}
            required
            className="input w-full"
          >
            <option value="" disabled>Select type...</option>
            <option value="building">Building</option>
            <option value="floor">Floor</option>
            <option value="room">Room</option>
            <option value="case">Case</option>
            <option value="shelf">Shelf</option>
            <option value="drawer">Drawer</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Security Level
          </label>
          <input
            type="text"
            value={formData.security_level}
            onChange={(e) => setFormData(prev => ({ ...prev, security_level: e.target.value }))}
            placeholder="e.g., High, Medium, Low"
            className="input w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Capacity
          </label>
          <input
            type="number"
            value={formData.capacity}
            onChange={(e) => setFormData(prev => ({ ...prev, capacity: e.target.value }))}
            min="0"
            placeholder="Maximum number of objects"
            className="input w-full"
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="on_display"
            checked={formData.on_display}
            onChange={(e) => setFormData(prev => ({ ...prev, on_display: e.target.checked }))}
          />
          <label htmlFor="on_display" className="text-sm text-ink">
            Display Location (objects here are on public display)
          </label>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="climate_controlled"
            checked={formData.climate_controlled}
            onChange={(e) => setFormData(prev => ({ ...prev, climate_controlled: e.target.checked }))}
          />
          <label htmlFor="climate_controlled" className="text-sm text-ink">
            Climate Controlled
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Notes
          </label>
          <textarea
            value={formData.note}
            onChange={(e) => setFormData(prev => ({ ...prev, note: e.target.value }))}
            rows={3}
            className="input w-full"
          />
        </div>
      </div>

      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 btn btn-secondary"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading || !formData.name}
          className="flex-1 btn btn-primary"
        >
          {isLoading ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
}
