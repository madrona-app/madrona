/**
 * LocationPickerModal - Visual hierarchical location selector.
 *
 * Shows locations in a tree view with:
 * - Search/filter capability
 * - Expand/collapse for hierarchy
 * - Visual indicators for location type and display status
 * - Breadcrumb path display for selected location
 */

import { useState, useMemo, useEffect } from 'react';
import { ModalPortal } from '../ModalPortal';
import { useQuery } from '@tanstack/react-query';
import {
  MapPin,
  Search,
  ChevronRight,
  ChevronDown,
  Building2,
  Layers,
  LayoutGrid,
  Box,
  Archive,
  X,
  Loader2,
  Check,
  Eye,
} from 'lucide-react';
import { getLocations } from '../../lib/api';
import type { Location } from '../../lib/schemas';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';

// Location type icons
const LOCATION_TYPE_ICONS: Record<string, React.ReactNode> = {
  building: <Building2 size={16} />,
  wing: <Layers size={16} />,
  floor: <Layers size={16} />,
  room: <LayoutGrid size={16} />,
  area: <LayoutGrid size={16} />,
  cabinet: <Archive size={16} />,
  shelving_unit: <Archive size={16} />,
  shelf: <Box size={16} />,
  drawer: <Box size={16} />,
  bin: <Box size={16} />,
  box: <Box size={16} />,
  case: <Box size={16} />,
  frame: <Box size={16} />,
  rack: <Archive size={16} />,
  pallet: <Box size={16} />,
  external: <MapPin size={16} />,
  other: <MapPin size={16} />,
};

interface LocationPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (location: Location) => void;
  organizationId: string;
  selectedLocationId?: string | null;
  title?: string;
  /** Filter to only show display locations */
  displayOnly?: boolean;
}

type LocationWithChildren = Location & { children: LocationWithChildren[] };

export function LocationPickerModal({
  isOpen,
  onClose,
  onSelect,
  organizationId,
  selectedLocationId,
  title = 'Select Location',
  displayOnly = false,
}: LocationPickerModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'location-picker',
  });

  // Fetch locations
  const { data: locationsData, isLoading } = useQuery({
    queryKey: ['locations', organizationId, { is_active: true }],
    queryFn: () => getLocations(organizationId, { is_active: true }),
    enabled: isOpen && !!organizationId,
  });

  // Build tree from flat list
  const locationTree = useMemo(() => {
    if (!locationsData?.items) return [];

    let locations = locationsData.items;

    // Filter for display locations if requested
    if (displayOnly) {
      locations = locations.filter(loc => loc.on_display);
    }

    const map = new Map<string, LocationWithChildren>();
    const roots: LocationWithChildren[] = [];

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

    // Sort children by name
    const sortChildren = (nodes: LocationWithChildren[]) => {
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      nodes.forEach(node => sortChildren(node.children));
    };
    sortChildren(roots);

    return roots;
  }, [locationsData?.items, displayOnly]);

  // Filter tree based on search query
  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return locationTree;

    const query = searchQuery.toLowerCase();

    // Check if a node or any of its descendants match
    const nodeMatches = (node: LocationWithChildren): boolean => {
      if (node.name.toLowerCase().includes(query)) return true;
      if (node.code?.toLowerCase().includes(query)) return true;
      if (node.path?.toLowerCase().includes(query)) return true;
      return node.children.some((child: LocationWithChildren) => nodeMatches(child));
    };

    // Filter and clone the tree, keeping only matching branches
    const filterTree = (nodes: LocationWithChildren[]): LocationWithChildren[] => {
      return nodes
        .filter(node => nodeMatches(node))
        .map(node => ({
          ...node,
          children: filterTree(node.children),
        }));
    };

    return filterTree(locationTree);
  }, [locationTree, searchQuery]);

  // Auto-expand when searching
  useEffect(() => {
    if (searchQuery.trim()) {
      // Expand all nodes when searching
      const allIds = new Set<string>();
      const collectIds = (nodes: LocationWithChildren[]) => {
        nodes.forEach(node => {
          allIds.add(node.location_id);
          collectIds(node.children);
        });
      };
      collectIds(filteredTree);
      setExpandedIds(allIds);
    }
  }, [searchQuery, filteredTree]);

  // Expand to show selected location on open
  useEffect(() => {
    if (isOpen && selectedLocationId && locationsData?.items) {
      const selected = locationsData.items.find(l => l.location_id === selectedLocationId);
      if (selected?.path) {
        // Find all ancestor IDs by walking up the tree
        const ancestorIds = new Set<string>();
        let current = selected;
        while (current?.parent_id) {
          const parent = locationsData.items.find(l => l.location_id === current!.parent_id);
          if (parent) {
            ancestorIds.add(parent.location_id);
            current = parent;
          } else {
            break;
          }
        }
        setExpandedIds(prev => new Set([...prev, ...ancestorIds]));
      }
    }
  }, [isOpen, selectedLocationId, locationsData?.items]);

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

  const handleSelect = (location: Location) => {
    onSelect(location);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      data-modal-layer="1000"
      onMouseDown={(e) => { e.stopPropagation(); onClose(); }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId)}
        className="bg-parchment rounded-lg w-[90%] max-w-[600px] max-h-[80vh] shadow-xl flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen flex items-center justify-between">
          <h2 id={titleId} className="m-0 text-lg font-semibold text-ink font-serif">
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-archive hover:text-ink rounded hover:bg-stone/50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-lichen">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search locations..."
              className="w-full pl-9 pr-4 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              autoFocus
            />
          </div>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-[300px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-archive" />
            </div>
          ) : filteredTree.length === 0 ? (
            <div className="text-center py-12 text-archive">
              {searchQuery ? 'No locations match your search' : 'No locations available'}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredTree.map(location => (
                <LocationTreeNode
                  key={location.location_id}
                  location={location}
                  depth={0}
                  expandedIds={expandedIds}
                  toggleExpanded={toggleExpanded}
                  selectedId={selectedLocationId}
                  hoveredId={hoveredId}
                  setHoveredId={setHoveredId}
                  onSelect={handleSelect}
                  searchQuery={searchQuery}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-lichen rounded-lg text-sm text-ink hover:bg-stone/50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

// Tree Node Component
function LocationTreeNode({
  location,
  depth,
  expandedIds,
  toggleExpanded,
  selectedId,
  hoveredId,
  setHoveredId,
  onSelect,
  searchQuery,
}: {
  location: LocationWithChildren;
  depth: number;
  expandedIds: Set<string>;
  toggleExpanded: (id: string) => void;
  selectedId?: string | null;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  onSelect: (location: Location) => void;
  searchQuery: string;
}) {
  const hasChildren = location.children && location.children.length > 0;
  const isExpanded = expandedIds.has(location.location_id);
  const isSelected = selectedId === location.location_id;
  const isHovered = hoveredId === location.location_id;

  // Highlight matching text
  const highlightMatch = (text: string) => {
    if (!searchQuery.trim()) return text;
    const query = searchQuery.toLowerCase();
    const index = text.toLowerCase().indexOf(query);
    if (index === -1) return text;
    return (
      <>
        {text.slice(0, index)}
        <span className="bg-meadow/30 rounded px-0.5">{text.slice(index, index + query.length)}</span>
        {text.slice(index + query.length)}
      </>
    );
  };

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors
                   ${isSelected
                     ? 'bg-bark/10 ring-1 ring-bark/30'
                     : isHovered
                       ? 'bg-stone/50'
                       : 'hover:bg-stone/30'
                   }`}
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
        onClick={() => onSelect(location)}
        onMouseEnter={() => setHoveredId(location.location_id)}
        onMouseLeave={() => setHoveredId(null)}
      >
        {/* Expand/Collapse */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleExpanded(location.location_id);
          }}
          className={`p-0.5 rounded hover:bg-lichen flex-shrink-0 ${
            hasChildren ? 'visible' : 'invisible'
          }`}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {/* Icon */}
        <span className="text-archive flex-shrink-0">
          {LOCATION_TYPE_ICONS[location.location_type] || <MapPin size={16} />}
        </span>

        {/* Name and path */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium truncate ${
              location.status !== 'active' ? 'text-archive line-through' : 'text-ink'
            }`}>
              {highlightMatch(location.name)}
            </span>
            {location.on_display && (
              <span className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 bg-meadow/10 text-meadow-dark rounded">
                <Eye size={10} />
                Display
              </span>
            )}
          </div>
          {depth === 0 && location.code && (
            <div className="text-xs text-archive truncate">
              {location.code}
            </div>
          )}
        </div>

        {/* Selected indicator */}
        {isSelected && (
          <Check size={16} className="text-bark flex-shrink-0" />
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {location.children.map((child: LocationWithChildren) => (
            <LocationTreeNode
              key={child.location_id}
              location={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              toggleExpanded={toggleExpanded}
              selectedId={selectedId}
              hoveredId={hoveredId}
              setHoveredId={setHoveredId}
              onSelect={onSelect}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * LocationPickerButton - Button that opens the location picker modal.
 * Shows the selected location's hierarchical path.
 */
interface LocationPickerButtonProps {
  organizationId: string;
  value: string | null;
  onChange: (locationId: string | null, location?: Location) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Filter to only show display locations */
  displayOnly?: boolean;
}

export function LocationPickerButton({
  organizationId,
  value,
  onChange,
  placeholder = 'Select location...',
  className = '',
  disabled = false,
  displayOnly = false,
}: LocationPickerButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);

  // Fetch location details if we have a value but no selected location
  const { data: locationsData } = useQuery({
    queryKey: ['locations', organizationId, { is_active: true }],
    queryFn: () => getLocations(organizationId, { is_active: true }),
    enabled: !!organizationId && !!value && !selectedLocation,
  });

  // Find the selected location from fetched data
  useEffect(() => {
    if (value && locationsData?.items && !selectedLocation) {
      const found = locationsData.items.find(l => l.location_id === value);
      if (found) setSelectedLocation(found);
    }
    if (!value) {
      setSelectedLocation(null);
    }
  }, [value, locationsData?.items, selectedLocation]);

  const handleSelect = (location: Location) => {
    setSelectedLocation(location);
    onChange(location.location_id, location);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedLocation(null);
    onChange(null);
  };

  const displayValue = selectedLocation
    ? selectedLocation.path || selectedLocation.name
    : null;

  return (
    <>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setIsOpen(true)}
        onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setIsOpen(true); } }}
        aria-disabled={disabled || undefined}
        className={`w-full flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg text-left text-sm
                   ${disabled ? 'bg-stone/30 cursor-not-allowed' : 'bg-parchment hover:border-archive cursor-pointer'}
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark ${className}`}
      >
        <MapPin size={16} className="text-archive flex-shrink-0" />
        <span className={`flex-1 truncate ${displayValue ? 'text-ink' : 'text-archive'}`}>
          {displayValue || placeholder}
        </span>
        {selectedLocation?.on_display && (
          <span className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 bg-meadow/10 text-meadow-dark rounded flex-shrink-0">
            <Eye size={10} />
            Display
          </span>
        )}
        {value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="p-0.5 text-archive hover:text-ink rounded hover:bg-stone/50 flex-shrink-0"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <LocationPickerModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onSelect={handleSelect}
        organizationId={organizationId}
        selectedLocationId={value}
        displayOnly={displayOnly}
      />
    </>
  );
}

/**
 * EditableLocationPicker - For use in workspace pages.
 * Shows location path as text in view mode, LocationPickerButton in edit mode.
 */
interface EditableLocationPickerProps {
  label: string;
  organizationId: string;
  value: string | null;
  displayValue?: string | null;
  onChange: (locationId: string | null) => void;
  onSave?: () => void;
  isEditing: boolean;
  required?: boolean;
  className?: string;
  emptyText?: string;
  displayOnly?: boolean;
}

export function EditableLocationPicker({
  label,
  organizationId,
  value,
  displayValue,
  onChange,
  onSave,
  isEditing,
  required = false,
  className = '',
  emptyText = '—',
  displayOnly = false,
}: EditableLocationPickerProps) {
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);

  // Fetch location details for display
  const { data: locationsData } = useQuery({
    queryKey: ['locations', organizationId, { is_active: true }],
    queryFn: () => getLocations(organizationId, { is_active: true }),
    enabled: !!organizationId && !!value && !displayValue && !selectedLocation,
  });

  // Find the location for display
  useEffect(() => {
    if (value && locationsData?.items && !selectedLocation) {
      const found = locationsData.items.find(l => l.location_id === value);
      if (found) setSelectedLocation(found);
    }
    if (!value) {
      setSelectedLocation(null);
    }
  }, [value, locationsData?.items, selectedLocation]);

  const locationDisplayValue = displayValue || selectedLocation?.path || selectedLocation?.name || null;
  const isOnDisplay = selectedLocation?.on_display;

  // View mode
  if (!isEditing) {
    if (!value) {
      return (
        <div className={className}>
          <dt className="text-sm font-medium text-archive mb-1">{label}</dt>
          <dd className="text-archive italic text-sm">{emptyText}</dd>
        </div>
      );
    }

    return (
      <div className={className}>
        <dt className="text-sm font-medium text-archive mb-1">{label}</dt>
        <dd className="text-ink flex items-center gap-2">
          <MapPin size={14} className="text-archive flex-shrink-0" />
          <span>{locationDisplayValue || 'Loading...'}</span>
          {isOnDisplay && (
            <span className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 bg-meadow/10 text-meadow-dark rounded">
              <Eye size={10} />
              Display
            </span>
          )}
        </dd>
      </div>
    );
  }

  // Edit mode
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="text-sm font-medium text-ink">
        {label}
        {required && <span className="text-semantic-error ml-0.5">*</span>}
      </label>
      <LocationPickerButton
        organizationId={organizationId}
        value={value}
        onChange={(locationId, location) => {
          if (location) setSelectedLocation(location);
          onChange(locationId);
          onSave?.();
        }}
        displayOnly={displayOnly}
      />
    </div>
  );
}

export default LocationPickerModal;
