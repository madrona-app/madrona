import { useState, lazy, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MapPin,
  Plus,
  Edit,
  Trash2,
  Calendar,
  DollarSign,
  ArrowRight,
  Building,
  Loader2,
  Map,
  List,
  Navigation,
} from 'lucide-react';
import { formatDateShort, formatNumber } from '../../lib/formatters';
import {
  getExhibitionVenues,
  createExhibitionVenue,
  updateExhibitionVenue,
  deleteExhibitionVenue,
  type ExhibitionVenue,
} from '../../lib/api';
import SlideOver from '../ui/SlideOver';
import TouringTimeline from './TouringTimeline';
import ConfirmDialog from '../ConfirmDialog';
import { useGeo, type TourVenue } from '../../hooks/useGeo';
import { LocationPickerModal, type Coordinates } from '../maps';
import { MadronaLoader } from '../ui/MadronaLoader';

// Lazy load the map component
const TourRouteMap = lazy(() => import('../maps/TourRouteMap'));

type ViewMode = 'list' | 'map';

interface TouringScheduleTabProps {
  organizationId: string;
  exhibitionId: string;
  isEditing?: boolean;
}

const STATUS_OPTIONS = [
  { value: 'proposed', label: 'Proposed' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'installed', label: 'Installed' },
  { value: 'open', label: 'Open' },
  { value: 'closing', label: 'Closing' },
  { value: 'returned', label: 'Returned' },
];

const STATUS_STYLES: Record<string, string> = {
  proposed: 'bg-stone text-archive',
  confirmed: 'bg-semantic-info/10 text-semantic-info',
  in_transit: 'bg-semantic-warning/10 text-semantic-warning',
  installed: 'bg-copper/10 text-copper',
  open: 'bg-semantic-success/10 text-semantic-success',
  closing: 'bg-semantic-warning/10 text-semantic-warning',
  returned: 'bg-bark/10 text-bark',
};

export function TouringScheduleTab({
  organizationId,
  exhibitionId,
  isEditing = false,
}: TouringScheduleTabProps) {
  const queryClient = useQueryClient();
  const [showEditor, setShowEditor] = useState(false);
  const [editingVenue, setEditingVenue] = useState<ExhibitionVenue | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [confirmState, setConfirmState] = useState<{action: () => void; title: string; message: string} | null>(null);

  // Fetch venues
  const { data, isLoading } = useQuery({
    queryKey: ['exhibition-venues', organizationId, exhibitionId],
    queryFn: () => getExhibitionVenues(organizationId, exhibitionId),
    enabled: !!organizationId && !!exhibitionId,
  });

  // Fetch tour route data for map (includes coordinates)
  const { useTourRoute } = useGeo();
  const { data: tourRouteData } = useTourRoute(exhibitionId, {
    enabled: viewMode === 'map' && !!exhibitionId,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (venueId: string) =>
      deleteExhibitionVenue(organizationId, exhibitionId, venueId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['exhibition-venues', organizationId, exhibitionId],
      });
    },
  });

  const venues = data?.exhibition_venues || [];

  const handleDelete = (venueId: string) => {
    setConfirmState({
      action: () => deleteMutation.mutate(venueId),
      title: 'Remove Venue',
      message: 'Are you sure you want to remove this venue from the tour?',
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-ink">Touring Schedule</h4>
          <p className="text-xs text-archive">
            Manage venues and dates for this traveling exhibition
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View Mode Toggle */}
          <div className="flex border border-lichen rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
                viewMode === 'list'
                  ? 'bg-bark text-parchment'
                  : 'bg-parchment text-ink hover:bg-stone'
              }`}
              title="List view"
            >
              <List size={12} />
              List
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
                viewMode === 'map'
                  ? 'bg-bark text-parchment'
                  : 'bg-parchment text-ink hover:bg-stone'
              }`}
              title="Map view"
            >
              <Map size={12} />
              Map
            </button>
          </div>
          {isEditing && (
            <button
              onClick={() => {
                setEditingVenue(null);
                setShowEditor(true);
              }}
              className="flex items-center gap-1 text-sm text-bark hover:text-copper-dark"
            >
              <Plus size={14} />
              Add Venue
            </button>
          )}
        </div>
      </div>

      {/* Timeline visualization */}
      {venues.length > 0 && viewMode === 'list' && <TouringTimeline venues={venues} />}

      {/* Map View */}
      {viewMode === 'map' && (
        <div className="border border-lichen rounded-lg overflow-hidden">
          {tourRouteData?.venues && tourRouteData.venues.length > 0 ? (
            <Suspense
              fallback={
                <div className="h-[400px] bg-stone flex items-center justify-center">
                  <MadronaLoader variant="dots" />
                </div>
              }
            >
              <TourRouteMap
                venues={tourRouteData.venues.map((v) => ({
                  venue_id: v.venue_id,
                  name: v.name,
                  latitude: v.latitude ?? 0,
                  longitude: v.longitude ?? 0,
                  sequence_order: v.sequence_order,
                  start_date: v.start_date ?? undefined,
                  end_date: v.end_date ?? undefined,
                  status: v.status as TourVenue['status'],
                  city: v.city ?? undefined,
                })).filter((v) => v.latitude !== 0 && v.longitude !== 0)}
                height={400}
                exhibitionTitle={tourRouteData.exhibition.title}
                showDateLabels={true}
                onVenueClick={(venue) => {
                  // Find and scroll to the venue in the list, or open editor
                  if (isEditing) {
                    const fullVenue = venues.find(
                      (v) => v.exhibition_venue_id === venue.venue_id
                    );
                    if (fullVenue) {
                      setEditingVenue(fullVenue);
                      setShowEditor(true);
                    }
                  }
                }}
              />
            </Suspense>
          ) : (
            <div className="h-[400px] bg-stone/30 flex flex-col items-center justify-center text-archive">
              <Map size={32} className="mb-2 opacity-40" />
              <p className="text-sm">No venues with coordinates</p>
              <p className="text-xs mt-1">
                Add venue addresses to see them on the map
              </p>
            </div>
          )}
        </div>
      )}

      {/* Venue list */}
      {isLoading ? (
        <div className="text-sm text-archive">Loading venues...</div>
      ) : venues.length === 0 ? (
        <div className="text-sm text-archive italic py-8 text-center border border-dashed border-lichen rounded-lg">
          No tour venues scheduled yet.
          {isEditing && (
            <button
              onClick={() => setShowEditor(true)}
              className="block mx-auto mt-2 text-bark hover:text-copper-dark"
            >
              Add a venue
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {venues.map((venue, index) => (
            <div
              key={venue.exhibition_venue_id}
              className="flex items-start gap-4 p-4 border border-lichen rounded-lg bg-parchment"
            >
              {/* Order indicator */}
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-bark/10 flex items-center justify-center text-sm font-medium text-bark">
                  {venue.tour_order}
                </div>
                {index < venues.length - 1 && (
                  <div className="w-px h-8 bg-lichen mt-2" />
                )}
              </div>

              {/* Venue info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-ink flex items-center gap-2">
                      {venue.venue_id ? (
                        <MapPin size={14} className="text-bark" />
                      ) : (
                        <Building size={14} className="text-archive" />
                      )}
                      {venue.venue_name || venue.external_venue_name}
                    </p>
                    {venue.external_venue_address && (
                      <p className="text-xs text-archive mt-1">
                        {venue.external_venue_address}
                      </p>
                    )}
                  </div>
                  <span
                    className={`px-2 py-0.5 text-xs font-medium rounded-full shrink-0 ${
                      STATUS_STYLES[venue.status] || STATUS_STYLES.proposed
                    }`}
                  >
                    {venue.status.replace('_', ' ')}
                  </span>
                </div>

                {/* Dates */}
                <div className="flex items-center gap-4 mt-2 text-xs text-archive">
                  <span className="flex items-center gap-1">
                    <Calendar size={12} />
                    {venue.planned_start_date
                      ? formatDateShort(venue.planned_start_date)
                      : 'TBD'}
                    {' '}<ArrowRight size={10} />{' '}
                    {venue.planned_end_date
                      ? formatDateShort(venue.planned_end_date)
                      : 'TBD'}
                  </span>
                  {venue.fee_amount && (
                    <span className="flex items-center gap-1">
                      <DollarSign size={12} />
                      {formatNumber(venue.fee_amount)} {venue.fee_currency || 'USD'}
                    </span>
                  )}
                </div>

                {/* Special requirements */}
                {venue.special_requirements && (
                  <p className="text-xs text-archive mt-2 line-clamp-1">
                    {venue.special_requirements}
                  </p>
                )}

                {/* Actions */}
                {isEditing && (
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => {
                        setEditingVenue(venue);
                        setShowEditor(true);
                      }}
                      className="flex items-center gap-1 text-xs text-bark hover:text-copper-dark"
                    >
                      <Edit size={12} />
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(venue.exhibition_venue_id)}
                      disabled={deleteMutation.isPending}
                      className="flex items-center gap-1 text-xs text-semantic-error hover:text-semantic-error/80 disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmText="Confirm"
        confirmStyle="danger"
      />

      {/* Venue Editor */}
      <VenueEditor
        isOpen={showEditor}
        organizationId={organizationId}
        exhibitionId={exhibitionId}
        venue={editingVenue}
        onClose={() => {
          setShowEditor(false);
          setEditingVenue(null);
        }}
        onSuccess={() => {
          setShowEditor(false);
          setEditingVenue(null);
        }}
      />
    </div>
  );
}

// Venue Editor SlideOver
interface VenueEditorProps {
  isOpen: boolean;
  organizationId: string;
  exhibitionId: string;
  venue?: ExhibitionVenue | null;
  onClose: () => void;
  onSuccess: () => void;
}

function VenueEditor({
  isOpen,
  organizationId,
  exhibitionId,
  venue,
  onClose,
  onSuccess,
}: VenueEditorProps) {
  const queryClient = useQueryClient();
  const isEditMode = !!venue;

  // Geocoding
  const { geocode } = useGeo();

  // Form state
  const [externalVenueName, setExternalVenueName] = useState(venue?.external_venue_name || '');
  const [externalVenueAddress, setExternalVenueAddress] = useState(
    venue?.external_venue_address || ''
  );
  const [plannedStartDate, setPlannedStartDate] = useState(venue?.planned_start_date || '');
  const [plannedEndDate, setPlannedEndDate] = useState(venue?.planned_end_date || '');
  const [status, setStatus] = useState(venue?.status || 'proposed');
  const [feeAmount, setFeeAmount] = useState(venue?.fee_amount?.toString() || '');
  const [feeCurrency, setFeeCurrency] = useState(venue?.fee_currency || 'USD');
  const [specialRequirements, setSpecialRequirements] = useState(
    venue?.special_requirements || ''
  );
  const [error, setError] = useState<string | null>(null);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);

  // Handle geocoding the address
  const handleGeocode = async () => {
    if (!externalVenueAddress.trim()) {
      setError('Please enter an address to geocode');
      return;
    }
    setIsGeocoding(true);
    setError(null);
    try {
      const result = await geocode.mutateAsync({ address: externalVenueAddress });
      if (result.success && result.point) {
        setCoordinates({
          latitude: result.point.latitude,
          longitude: result.point.longitude,
        });
      } else {
        setError('Could not geocode address. Try picking a location on the map.');
      }
    } catch {
      setError('Geocoding failed. Try picking a location on the map.');
    } finally {
      setIsGeocoding(false);
    }
  };

  // Mutations
  const createMutation = useMutation({
    mutationFn: () =>
      createExhibitionVenue(organizationId, exhibitionId, {
        external_venue_name: externalVenueName,
        external_venue_address: externalVenueAddress || undefined,
        planned_start_date: plannedStartDate || undefined,
        planned_end_date: plannedEndDate || undefined,
        status: status as ExhibitionVenue['status'],
        fee_amount: feeAmount ? Number(feeAmount) : undefined,
        fee_currency: feeCurrency || undefined,
        special_requirements: specialRequirements || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['exhibition-venues', organizationId, exhibitionId],
      });
      onSuccess();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateExhibitionVenue(organizationId, exhibitionId, venue!.exhibition_venue_id, {
        external_venue_name: externalVenueName,
        external_venue_address: externalVenueAddress || undefined,
        planned_start_date: plannedStartDate || undefined,
        planned_end_date: plannedEndDate || undefined,
        status: status as ExhibitionVenue['status'],
        fee_amount: feeAmount ? Number(feeAmount) : undefined,
        fee_currency: feeCurrency || undefined,
        special_requirements: specialRequirements || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['exhibition-venues', organizationId, exhibitionId],
      });
      onSuccess();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = () => {
    setError(null);
    if (!externalVenueName.trim()) {
      setError('Venue name is required');
      return;
    }

    if (isEditMode) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <>
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Venue' : 'Add Venue'}
      subtitle="Configure a tour venue for this exhibition"
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50 flex items-center gap-2"
          >
            {isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : isEditMode ? (
              'Save Changes'
            ) : (
              'Add Venue'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Venue Name <span className="text-semantic-error">*</span>
          </label>
          <input
            type="text"
            value={externalVenueName}
            onChange={(e) => setExternalVenueName(e.target.value)}
            placeholder="e.g., Museum of Modern Art"
            className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Address
          </label>
          <textarea
            value={externalVenueAddress}
            onChange={(e) => setExternalVenueAddress(e.target.value)}
            rows={2}
            placeholder="Full address of the venue"
            className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
          />
        </div>

        {/* Location / Coordinates */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Location (for map display)
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleGeocode}
              disabled={isGeocoding || !externalVenueAddress.trim()}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGeocoding ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Navigation size={14} />
              )}
              Geocode Address
            </button>
            <button
              type="button"
              onClick={() => setShowLocationPicker(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50"
            >
              <MapPin size={14} />
              Pick on Map
            </button>
            {coordinates && (
              <span className="text-xs text-archive">
                {coordinates.latitude.toFixed(4)}, {coordinates.longitude.toFixed(4)}
              </span>
            )}
          </div>
          {coordinates && (
            <p className="text-xs text-semantic-success mt-1.5 flex items-center gap-1">
              <MapPin size={12} />
              Location set - venue will appear on tour route map
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Planned Start Date
            </label>
            <input
              type="date"
              value={plannedStartDate}
              onChange={(e) => setPlannedStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Planned End Date
            </label>
            <input
              type="date"
              value={plannedEndDate}
              onChange={(e) => setPlannedEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'proposed' | 'confirmed' | 'installed' | 'open' | 'closing' | 'in_transit' | 'returned')}
            className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Fee Amount
            </label>
            <input
              type="number"
              value={feeAmount}
              onChange={(e) => setFeeAmount(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Currency
            </label>
            <select
              value={feeCurrency}
              onChange={(e) => setFeeCurrency(e.target.value)}
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="CAD">CAD</option>
              <option value="AUD">AUD</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Special Requirements
          </label>
          <textarea
            value={specialRequirements}
            onChange={(e) => setSpecialRequirements(e.target.value)}
            rows={3}
            placeholder="Climate control, security, insurance requirements..."
            className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
          />
        </div>
      </div>
    </SlideOver>

      {/* Location Picker Modal */}
      <LocationPickerModal
        isOpen={showLocationPicker}
        onClose={() => setShowLocationPicker(false)}
        onSelect={(coords) => {
          setCoordinates(coords);
        }}
        initialValue={coordinates}
        title="Select Venue Location"
        description="Click on the map to set the venue location for tour route display."
      />
    </>
  );
}

export default TouringScheduleTab;
