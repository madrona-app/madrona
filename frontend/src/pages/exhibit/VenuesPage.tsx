import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Building2,
  Loader2,
  Search,
  Pencil,
  Trash2,
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  MapPin,
  PenTool,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { usePermissions } from '../../hooks/usePermissions';
import { useAccessibleModal } from '../../hooks/useAccessibleModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

interface FloorPlan {
  floor_plan_id: string;
  name: string;
  floor_number: number;
  geometry: {
    type: string;
    width_cm: number;
    depth_cm: number;
  };
  ceiling_height_cm: number;
  wall_color: string;
}

interface Venue {
  venue_id: string;
  name: string;
  description: string | null;
  address: string | null;
  default_ceiling_height_cm: number;
  default_wall_color: string;
  floor_plan_count: number;
  created_at: string;
}

interface VenueWithPlans extends Venue {
  floor_plans: FloorPlan[];
}

// =============================================================================
// Venue Modal
// =============================================================================

function VenueModal({
  isOpen,
  onClose,
  orgId: orgId,
  venue,
}: {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  venue: Venue | null;
}) {
  const queryClient = useQueryClient();
  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'venue-modal',
  });

  const [name, setName] = useState(venue?.name || '');
  const [description, setDescription] = useState(venue?.description || '');
  const [address, setAddress] = useState(venue?.address || '');
  const [ceilingHeight, setCeilingHeight] = useState(venue?.default_ceiling_height_cm || 300);
  const [wallColor, setWallColor] = useState(venue?.default_wall_color || 'rgb(var(--color-parchment-warm))');

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = {
        name: name.trim(),
        description: description.trim() || null,
        address: address.trim() || null,
        default_ceiling_height_cm: ceilingHeight,
        default_wall_color: wallColor,
      };
      if (venue) {
        await apiFetch(`/organizations/${orgId}/exhibit/venues/${venue.venue_id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        });
      } else {
        await apiFetch(`/organizations/${orgId}/exhibit/venues`, {
          method: 'POST',
          body: JSON.stringify(data),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['venues', orgId] });
      onClose();
    },
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-parchment rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
      >
        <h2 id={titleId} className="text-lg font-semibold text-ink mb-4">
          {venue ? 'Edit Venue' : 'Create New Venue'}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Default Ceiling (cm)
              </label>
              <input
                type="number"
                value={ceilingHeight}
                onChange={(e) => setCeilingHeight(parseInt(e.target.value) || 300)}
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Default Wall Color
              </label>
              <input
                type="color"
                value={wallColor}
                onChange={(e) => setWallColor(e.target.value)}
                className="w-full h-10 px-1 py-1 border border-lichen rounded-lg cursor-pointer"
              />
            </div>
          </div>
        </div>

        {saveMutation.isError && (
          <div className="mt-4 p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {saveMutation.error instanceof Error ? saveMutation.error.message : 'Failed to save venue'}
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-archive hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!name.trim() || saveMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50"
          >
            {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {venue ? 'Save Changes' : 'Create Venue'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Floor Plan Modal
// =============================================================================

function FloorPlanModal({
  isOpen,
  onClose,
  orgId,
  venueId,
  plan,
}: {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  venueId: string;
  plan: FloorPlan | null;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'floor-plan-modal',
  });

  const [name, setName] = useState(plan?.name || '');
  const [floor, setFloor] = useState(plan?.floor_number || 0);
  const [width, setWidth] = useState(plan?.geometry.width_cm || 800);
  const [depth, setDepth] = useState(plan?.geometry.depth_cm || 600);
  const [ceilingHeight, setCeilingHeight] = useState<number | ''>(plan?.ceiling_height_cm || '');
  const [wallColor, setWallColor] = useState(plan?.wall_color || '');

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = {
        name: name.trim(),
        floor_number: floor,
        geometry: {
          type: 'rectangular',
          width_cm: width,
          depth_cm: depth,
          walls: {
            north: { length: width },
            south: { length: width },
            east: { length: depth },
            west: { length: depth },
          },
        },
        ceiling_height_cm: ceilingHeight || null,
        wall_color: wallColor || null,
      };

      if (plan) {
        await apiFetch(`/organizations/${orgId}/exhibit/floor-plans/${plan.floor_plan_id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        });
        return null;
      } else {
        const response = await apiFetch<{ floor_plan_id: string }>(
          `/organizations/${orgId}/exhibit/venues/${venueId}/floor-plans`,
          { method: 'POST', body: JSON.stringify(data) }
        );
        return response.floor_plan_id;
      }
    },
    onSuccess: (newPlanId) => {
      queryClient.invalidateQueries({ queryKey: ['venues', orgId] });
      queryClient.invalidateQueries({ queryKey: ['venue-details', orgId, venueId] });
      onClose();
      if (newPlanId) {
        navigate(`/organizations/${orgId}/collections/exhibitions/floor-plans/${newPlanId}/edit`);
      }
    },
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-parchment rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
      >
        <h2 id={titleId} className="text-lg font-semibold text-ink mb-4">
          {plan ? 'Edit Room' : 'Add New Room'}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Room Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Main Gallery, Room 1"
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Floor Number</label>
            <input
              type="number"
              value={floor}
              onChange={(e) => setFloor(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Width (cm) *</label>
              <input
                type="number"
                value={width}
                onChange={(e) => setWidth(parseInt(e.target.value) || 800)}
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Depth (cm) *</label>
              <input
                type="number"
                value={depth}
                onChange={(e) => setDepth(parseInt(e.target.value) || 600)}
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>
          </div>
          <p className="text-xs text-archive">
            Room size: {(width / 100).toFixed(1)}m × {(depth / 100).toFixed(1)}m
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Ceiling Height (cm)
              </label>
              <input
                type="number"
                value={ceilingHeight}
                onChange={(e) => setCeilingHeight(e.target.value ? parseInt(e.target.value) : '')}
                placeholder="Use venue default"
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Wall Color</label>
              <input
                type="color"
                value={wallColor || 'rgb(var(--color-parchment-warm))'}
                onChange={(e) => setWallColor(e.target.value)}
                className="w-full h-10 px-1 py-1 border border-lichen rounded-lg cursor-pointer"
              />
            </div>
          </div>
        </div>

        {!plan && (
          <div className="mt-4 p-3 bg-semantic-info/10 rounded-lg border border-semantic-info/30">
            <p className="text-xs text-semantic-info">
              <strong>Tip:</strong> After creating the room, you'll be taken to the floor plan editor
              where you can upload a background image to trace over and define the exact room geometry.
            </p>
          </div>
        )}

        {saveMutation.isError && (
          <div className="mt-4 p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {saveMutation.error instanceof Error ? saveMutation.error.message : 'Failed to save'}
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-archive hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!name.trim() || saveMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50"
          >
            {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {plan ? 'Save Changes' : 'Create & Edit Geometry'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Venues Page
// =============================================================================

export default function VenuesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

  const [expandedVenue, setExpandedVenue] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Modal state
  const [showVenueModal, setShowVenueModal] = useState(false);
  const [editingVenue, setEditingVenue] = useState<Venue | null>(null);
  const [showFloorPlanModal, setShowFloorPlanModal] = useState(false);
  const [editingFloorPlan, setEditingFloorPlan] = useState<FloorPlan | null>(null);
  const [selectedVenueForPlan, setSelectedVenueForPlan] = useState<string | null>(null);

  // Delete state
  const [showDeleteVenueConfirm, setShowDeleteVenueConfirm] = useState(false);
  const [venueToDelete, setVenueToDelete] = useState<string | null>(null);
  const [showDeleteFloorPlanConfirm, setShowDeleteFloorPlanConfirm] = useState(false);
  const [floorPlanToDelete, setFloorPlanToDelete] = useState<{ planId: string; venueId: string } | null>(null);

  const canEdit = hasPermission('venues.edit');

  // Data fetching with React Query
  const { data: venuesData, isLoading } = useQuery({
    queryKey: ['venues', orgId],
    queryFn: () => apiFetch<{ venues: Venue[] }>(`/organizations/${orgId}/exhibit/venues`, { expectKeys: ['venues'] }),
    enabled: !!orgId,
  });

  const venues = venuesData?.venues || [];

  // Fetch venue details when expanded
  const { data: expandedVenueData } = useQuery({
    queryKey: ['venue-details', orgId, expandedVenue],
    queryFn: () => apiFetch<VenueWithPlans>(`/organizations/${orgId}/exhibit/venues/${expandedVenue}`),
    enabled: !!orgId && !!expandedVenue,
  });

  const deleteMutation = useMutation({
    mutationFn: async (venueId: string) => {
      await apiFetch(`/organizations/${orgId}/exhibit/venues/${venueId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['venues', orgId] });
      if (expandedVenue === venueToDelete) setExpandedVenue(null);
    },
  });

  const deleteFloorPlanMutation = useMutation({
    mutationFn: async ({ planId, venueId }: { planId: string; venueId: string }) => {
      await apiFetch(`/organizations/${orgId}/exhibit/floor-plans/${planId}`, { method: 'DELETE' });
      return venueId;
    },
    onSuccess: (venueId) => {
      queryClient.invalidateQueries({ queryKey: ['venues', orgId] });
      queryClient.invalidateQueries({ queryKey: ['venue-details', orgId, venueId] });
    },
  });

  const openVenueModal = (venue?: Venue) => {
    setEditingVenue(venue || null);
    setShowVenueModal(true);
  };

  const openFloorPlanModal = (venueId: string, plan?: FloorPlan) => {
    setSelectedVenueForPlan(venueId);
    setEditingFloorPlan(plan || null);
    setShowFloorPlanModal(true);
  };

  const filteredVenues = venues.filter(
    (v) =>
      v.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.address?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <MadronaLoader />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="w-8 h-8 text-bark" />
            <h1 className="text-2xl font-semibold text-ink">Venues</h1>
          </div>
          {canEdit && (
            <button
              onClick={() => openVenueModal()}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Venue
            </button>
          )}
        </div>
        <p className="mt-2 text-archive">
          Manage gallery spaces and floor plans for exhibitions.
        </p>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-archive" />
          <input
            type="text"
            placeholder="Search venues..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          />
        </div>
      </div>

      {/* Venues List */}
      {filteredVenues.length === 0 ? (
        <div className="text-center py-12 rounded-lg border border-dashed border-lichen">
          <Building2 className="w-12 h-12 mx-auto text-archive mb-4" />
          <h3 className="text-lg font-medium text-ink mb-2">No venues found</h3>
          <p className="text-archive mb-4">
            {searchTerm
              ? 'Try adjusting your search'
              : 'Create your first venue to define gallery spaces'}
          </p>
          {canEdit && !searchTerm && (
            <button
              onClick={() => openVenueModal()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark"
            >
              <Plus className="w-4 h-4" />
              New Venue
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredVenues.map((venue) => {
            const isExpanded = expandedVenue === venue.venue_id;
            const details = isExpanded ? expandedVenueData : null;

            return (
              <div
                key={venue.venue_id}
                className="bg-parchment rounded-lg border border-lichen overflow-hidden"
              >
                {/* Venue Header */}
                <div
                  role="button"
                  tabIndex={0}
                  className="w-full p-4 flex items-center gap-4 text-left hover:bg-stone/50 transition-colors cursor-pointer"
                  onClick={() => setExpandedVenue(isExpanded ? null : venue.venue_id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedVenue(isExpanded ? null : venue.venue_id); } }}
                >
                  <div className="p-2 bg-bark/10 rounded-lg">
                    <Building2 className="w-5 h-5 text-bark" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-ink">{venue.name}</h3>
                    {venue.address && (
                      <p className="text-sm text-archive flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {venue.address}
                      </p>
                    )}
                  </div>
                  <div className="text-sm text-archive">
                    {venue.floor_plan_count} room{venue.floor_plan_count !== 1 ? 's' : ''}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => openVenueModal(venue)}
                        className="p-2 text-archive hover:text-ink hover:bg-stone rounded"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVenueToDelete(venue.venue_id);
                          setShowDeleteVenueConfirm(true);
                        }}
                        className="p-2 text-archive hover:text-semantic-error hover:bg-semantic-error/10 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  {isExpanded ? (
                    <ChevronDown className="w-5 h-5 text-archive" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-archive" />
                  )}
                </div>

                {/* Floor Plans */}
                {isExpanded && (
                  <div className="border-t border-lichen bg-stone/20 p-4">
                    {!details ? (
                      <div className="flex items-center justify-center py-4">
                        <MadronaLoader variant="dots" />
                      </div>
                    ) : details.floor_plans.length === 0 ? (
                      <div className="text-center py-4 text-sm text-archive">
                        <LayoutGrid className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        No floor plans yet.
                        {canEdit && (
                          <button
                            onClick={() => openFloorPlanModal(venue.venue_id)}
                            className="block mx-auto mt-2 text-bark hover:text-copper-dark"
                          >
                            Add a room
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {details.floor_plans.map((plan) => (
                            <div
                              key={plan.floor_plan_id}
                              className="bg-parchment rounded-lg border border-lichen p-3 flex items-center gap-3"
                            >
                              <div className="w-16 h-16 bg-stone rounded flex items-center justify-center">
                                <LayoutGrid className="w-6 h-6 text-archive" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-ink truncate">{plan.name}</p>
                                <p className="text-xs text-archive">
                                  {plan.geometry.width_cm / 100}m × {plan.geometry.depth_cm / 100}m
                                  {plan.floor_number !== 0 && ` · Floor ${plan.floor_number}`}
                                </p>
                              </div>
                              {canEdit && (
                                <div className="flex items-center gap-1">
                                  <Link
                                    to={`/organizations/${orgId}/collections/exhibitions/floor-plans/${plan.floor_plan_id}/edit`}
                                    className="p-1.5 text-bark hover:text-copper-dark hover:bg-bark/10 rounded"
                                    title="Draw walls & upload floor plan image"
                                  >
                                    <PenTool className="w-3.5 h-3.5" />
                                  </Link>
                                  <button
                                    onClick={() => openFloorPlanModal(venue.venue_id, plan)}
                                    className="p-1.5 text-archive hover:text-ink hover:bg-stone rounded"
                                    title="Edit room settings"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      setFloorPlanToDelete({ planId: plan.floor_plan_id, venueId: venue.venue_id });
                                      setShowDeleteFloorPlanConfirm(true);
                                    }}
                                    className="p-1.5 text-archive hover:text-semantic-error hover:bg-semantic-error/10 rounded"
                                    title="Delete room"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        {canEdit && (
                          <button
                            onClick={() => openFloorPlanModal(venue.venue_id)}
                            className="mt-3 flex items-center gap-1 text-sm text-bark hover:text-copper-dark"
                          >
                            <Plus className="w-4 h-4" />
                            Add Room
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <VenueModal
        isOpen={showVenueModal}
        onClose={() => setShowVenueModal(false)}
        orgId={orgId!}
        venue={editingVenue}
      />

      {selectedVenueForPlan && (
        <FloorPlanModal
          isOpen={showFloorPlanModal}
          onClose={() => setShowFloorPlanModal(false)}
          orgId={orgId!}
          venueId={selectedVenueForPlan}
          plan={editingFloorPlan}
        />
      )}

      <ConfirmDialog
        isOpen={showDeleteVenueConfirm}
        onClose={() => setShowDeleteVenueConfirm(false)}
        onConfirm={() => {
          if (venueToDelete) deleteMutation.mutate(venueToDelete);
        }}
        title="Delete Venue"
        message="Delete this venue and all its floor plans?"
        confirmText="Delete"
        confirmStyle="danger"
      />

      <ConfirmDialog
        isOpen={showDeleteFloorPlanConfirm}
        onClose={() => setShowDeleteFloorPlanConfirm(false)}
        onConfirm={() => {
          if (floorPlanToDelete) deleteFloorPlanMutation.mutate(floorPlanToDelete);
        }}
        title="Delete Floor Plan"
        message="Delete this floor plan?"
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
