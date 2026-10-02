/**
 * TourRouteMap - Visualizes touring exhibition routes.
 *
 * Shows venues in sequence order with connecting route lines,
 * along with date information and venue status.
 */

import { useMemo, useRef, useEffect, useState } from 'react';
import { Marker, Source, Layer, Popup } from 'react-map-gl/maplibre';
import { Calendar, Clock, CheckCircle2, Circle, AlertCircle } from 'lucide-react';
import BaseMap from './BaseMap';
import type { BaseMapRef } from './BaseMap';
import { formatDateMonth } from '@/lib/formatters';

export interface TourVenue {
  venue_id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Order in the tour sequence (1-based) */
  sequence_order: number;
  /** Start date of exhibition at this venue */
  start_date?: string;
  /** End date of exhibition at this venue */
  end_date?: string;
  /** Status of the venue in the tour */
  status: 'proposed' | 'confirmed' | 'tentative' | 'installed' | 'open' | 'closing' | 'completed' | 'cancelled' | 'in_transit' | 'returned';
  /** City/location name for display */
  city?: string;
}

export interface TourRouteMapProps {
  /** List of venues in tour order */
  venues: TourVenue[];
  /** Height of the map container */
  height?: string | number;
  /** Called when a venue marker is clicked */
  onVenueClick?: (venue: TourVenue) => void;
  /** Exhibition title for display */
  exhibitionTitle?: string;
  /** Show date labels on markers */
  showDateLabels?: boolean;
  /** Animate the route line drawing */
  animateRoute?: boolean;
}

export default function TourRouteMap({
  venues,
  height = 500,
  onVenueClick,
  exhibitionTitle,
  showDateLabels = true,
}: TourRouteMapProps) {
  const mapRef = useRef<BaseMapRef>(null);
  const [selectedVenue, setSelectedVenue] = useState<TourVenue | null>(null);

  // Sort venues by sequence order
  const sortedVenues = useMemo(() => {
    return [...venues]
      .filter((v) => v.status !== 'cancelled')
      .sort((a, b) => a.sequence_order - b.sequence_order);
  }, [venues]);

  // Calculate bounds to fit all venues
  useEffect(() => {
    if (sortedVenues.length === 0 || !mapRef.current) return;

    const coords = sortedVenues.map((v) => [v.longitude, v.latitude] as [number, number]);

    if (coords.length > 1) {
      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ];

      setTimeout(() => {
        mapRef.current?.fitBounds(bounds, { padding: 60 });
      }, 100);
    } else if (coords.length === 1) {
      setTimeout(() => {
        mapRef.current?.flyTo({
          center: coords[0],
          zoom: 10,
        });
      }, 100);
    }
  }, [sortedVenues]);

  // Generate route line GeoJSON
  const routeLineGeoJSON = useMemo(() => {
    if (sortedVenues.length < 2) return null;

    const coordinates = sortedVenues.map((v) => [v.longitude, v.latitude] as [number, number]);

    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates,
          },
          properties: {},
        },
      ],
    };
  }, [sortedVenues]);

  // Calculate initial center
  const initialCenter = useMemo(() => {
    if (sortedVenues.length > 0) {
      const avgLat = sortedVenues.reduce((sum, v) => sum + v.latitude, 0) / sortedVenues.length;
      const avgLng = sortedVenues.reduce((sum, v) => sum + v.longitude, 0) / sortedVenues.length;
      return { latitude: avgLat, longitude: avgLng };
    }
    return { latitude: 40, longitude: -95 };
  }, [sortedVenues]);

  // Get marker color based on status
  const getStatusColor = (status: TourVenue['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-semantic-success';
      case 'confirmed':
        return 'bg-bark';
      case 'tentative':
        return 'bg-semantic-warning';
      case 'cancelled':
        return 'bg-semantic-error';
      default:
        return 'bg-archive';
    }
  };

  // Get status icon
  const getStatusIcon = (status: TourVenue['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-3 h-3 text-parchment" />;
      case 'confirmed':
        return <Circle className="w-3 h-3 text-parchment" fill="white" />;
      case 'tentative':
        return <Clock className="w-3 h-3 text-parchment" />;
      default:
        return <AlertCircle className="w-3 h-3 text-parchment" />;
    }
  };

  // Format date for display
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return null;
    return formatDateMonth(dateStr);
  };

  const handleVenueClick = (venue: TourVenue) => {
    setSelectedVenue(venue);
    onVenueClick?.(venue);
  };

  return (
    <div className="relative">
      <BaseMap
        ref={mapRef}
        latitude={initialCenter.latitude}
        longitude={initialCenter.longitude}
        zoom={3}
        height={height}
        showNavigation={true}
        showScale={true}
      >
        {/* Route line layer */}
        {routeLineGeoJSON && (
          <Source id="tour-route" type="geojson" data={routeLineGeoJSON}>
            {/* Main route line */}
            <Layer
              id="tour-route-line"
              type="line"
              paint={{
                'line-color': '#8B4513', // bark color
                'line-width': 3,
                'line-opacity': 0.8,
              }}
            />
            {/* Outline for visibility */}
            <Layer
              id="tour-route-outline"
              type="line"
              paint={{
                'line-color': 'rgb(var(--color-parchment-warm))',
                'line-width': 5,
                'line-opacity': 0.4,
              }}
              beforeId="tour-route-line"
            />
          </Source>
        )}

        {/* Venue markers */}
        {sortedVenues.map((venue, index) => {
          const colorClass = getStatusColor(venue.status);
          const isFirst = index === 0;
          const isLast = index === sortedVenues.length - 1;

          return (
            <Marker
              key={venue.venue_id}
              latitude={venue.latitude}
              longitude={venue.longitude}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                handleVenueClick(venue);
              }}
            >
              <div className="relative cursor-pointer group">
                {/* Marker */}
                <div
                  className={`w-10 h-10 ${colorClass} rounded-full flex items-center justify-center shadow-lg border-2 border-parchment hover:scale-110 transition-transform`}
                >
                  <span className="text-parchment font-bold text-sm">{venue.sequence_order}</span>
                </div>

                {/* Start/End labels */}
                {(isFirst || isLast) && (
                  <div
                    className={`absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-xs font-medium ${
                      isFirst ? 'bg-semantic-success/100 text-parchment' : 'bg-semantic-info/100 text-parchment'
                    }`}
                  >
                    {isFirst ? 'Start' : 'End'}
                  </div>
                )}

                {/* Date label */}
                {showDateLabels && venue.start_date && (
                  <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs bg-ink/80 text-parchment px-1.5 py-0.5 rounded">
                    {formatDate(venue.start_date)}
                  </div>
                )}

                {/* Hover tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                  <div className="bg-parchment rounded-lg shadow-lg p-2 text-sm whitespace-nowrap">
                    <div className="font-medium text-ink">{venue.name}</div>
                    {venue.city && <div className="text-archive text-xs">{venue.city}</div>}
                  </div>
                </div>
              </div>
            </Marker>
          );
        })}

        {/* Popup for selected venue */}
        {selectedVenue && (
          <Popup
            latitude={selectedVenue.latitude}
            longitude={selectedVenue.longitude}
            anchor="bottom"
            onClose={() => setSelectedVenue(null)}
            closeOnClick={false}
          >
            <div className="p-2 min-w-[200px]">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-6 h-6 ${getStatusColor(selectedVenue.status)} rounded-full flex items-center justify-center`}>
                  {getStatusIcon(selectedVenue.status)}
                </div>
                <span className="text-xs capitalize text-archive">{selectedVenue.status}</span>
              </div>
              <div className="font-medium text-ink">{selectedVenue.name}</div>
              {selectedVenue.city && (
                <div className="text-sm text-archive">{selectedVenue.city}</div>
              )}
              {(selectedVenue.start_date || selectedVenue.end_date) && (
                <div className="flex items-center gap-1 mt-2 text-sm text-archive">
                  <Calendar className="w-4 h-4" />
                  {formatDate(selectedVenue.start_date)}
                  {selectedVenue.end_date && ` - ${formatDate(selectedVenue.end_date)}`}
                </div>
              )}
            </div>
          </Popup>
        )}
      </BaseMap>

      {/* Title header */}
      {exhibitionTitle && (
        <div className="absolute top-4 left-4 bg-parchment rounded-lg shadow-md p-3">
          <div className="text-xs text-archive mb-1">Tour Route</div>
          <div className="font-medium text-ink">{exhibitionTitle}</div>
          <div className="text-sm text-archive mt-1">
            {sortedVenues.length} venue{sortedVenues.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-parchment rounded-lg shadow-md p-3 text-sm">
        <div className="font-medium text-ink mb-2">Venue Status</div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-semantic-success rounded-full" />
            <span className="text-archive">Completed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-bark rounded-full" />
            <span className="text-archive">Confirmed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-semantic-warning rounded-full" />
            <span className="text-archive">Tentative</span>
          </div>
        </div>
      </div>

      {/* Timeline summary */}
      {sortedVenues.length > 0 && sortedVenues[0].start_date && (
        <div className="absolute bottom-4 right-4 bg-parchment rounded-lg shadow-md p-3 text-sm">
          <div className="font-medium text-ink mb-2">Tour Timeline</div>
          <div className="flex items-center gap-2 text-archive">
            <Calendar className="w-4 h-4" />
            <span>
              {formatDate(sortedVenues[0].start_date)}
              {sortedVenues[sortedVenues.length - 1].end_date && (
                <> - {formatDate(sortedVenues[sortedVenues.length - 1].end_date)}</>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
