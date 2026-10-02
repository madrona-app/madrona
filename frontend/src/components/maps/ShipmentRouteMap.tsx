/**
 * ShipmentRouteMap - Visualizes exhibition shipment routes.
 *
 * Shows shipping paths with origin/destination points, status indicators,
 * and carrier information for touring exhibition logistics.
 */

import { useMemo, useRef, useEffect, useState } from 'react';
import { Marker, Source, Layer, Popup } from 'react-map-gl/maplibre';
import {
  Truck,
  Package,
  Calendar,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Plane,
  MapPin,
} from 'lucide-react';
import BaseMap from './BaseMap';
import type { BaseMapRef } from './BaseMap';
import { formatDateShort } from '@/lib/formatters';

export interface ShipmentPoint {
  shipment_id: string;
  shipment_number: string | null;
  direction: 'inbound' | 'outbound';
  status: 'planned' | 'shipped' | 'in_transit' | 'delayed' | 'arrived' | 'closed';
  carrier: string | null;
  tracking_number: string | null;
  origin: string | null;
  origin_coordinates: { lat: number; lng: number } | null;
  destination: string | null;
  destination_coordinates: { lat: number; lng: number } | null;
  ship_date: string | null;
  expected_arrival: string | null;
  actual_arrival: string | null;
  object_count: number;
}

export interface ShipmentRouteMapProps {
  /** List of shipments with route data */
  shipments: ShipmentPoint[];
  /** Height of the map container */
  height?: string | number;
  /** Called when a shipment marker is clicked */
  onShipmentClick?: (shipment: ShipmentPoint) => void;
  /** Exhibition title for display */
  exhibitionTitle?: string;
  /** Filter to show only certain statuses */
  statusFilter?: ShipmentPoint['status'][];
}

export default function ShipmentRouteMap({
  shipments,
  height = 500,
  onShipmentClick,
  exhibitionTitle,
  statusFilter,
}: ShipmentRouteMapProps) {
  const mapRef = useRef<BaseMapRef>(null);
  const [selectedShipment, setSelectedShipment] = useState<ShipmentPoint | null>(null);

  // Filter shipments with valid coordinates
  const validShipments = useMemo(() => {
    let filtered = shipments.filter(
      (s) =>
        (s.origin_coordinates?.lat && s.origin_coordinates?.lng) ||
        (s.destination_coordinates?.lat && s.destination_coordinates?.lng)
    );

    if (statusFilter && statusFilter.length > 0) {
      filtered = filtered.filter((s) => statusFilter.includes(s.status));
    }

    return filtered;
  }, [shipments, statusFilter]);

  // Calculate bounds to fit all points
  useEffect(() => {
    if (validShipments.length === 0 || !mapRef.current) return;

    const coords: [number, number][] = [];
    validShipments.forEach((s) => {
      if (s.origin_coordinates?.lat && s.origin_coordinates?.lng) {
        coords.push([s.origin_coordinates.lng, s.origin_coordinates.lat]);
      }
      if (s.destination_coordinates?.lat && s.destination_coordinates?.lng) {
        coords.push([s.destination_coordinates.lng, s.destination_coordinates.lat]);
      }
    });

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
          zoom: 8,
        });
      }, 100);
    }
  }, [validShipments]);

  // Generate route lines GeoJSON
  const routeLinesGeoJSON = useMemo(() => {
    const features = validShipments
      .filter(
        (s) =>
          s.origin_coordinates?.lat &&
          s.origin_coordinates?.lng &&
          s.destination_coordinates?.lat &&
          s.destination_coordinates?.lng
      )
      .map((s) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [s.origin_coordinates!.lng, s.origin_coordinates!.lat],
            [s.destination_coordinates!.lng, s.destination_coordinates!.lat],
          ],
        },
        properties: {
          shipment_id: s.shipment_id,
          status: s.status,
          direction: s.direction,
        },
      }));

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [validShipments]);

  // Calculate initial center
  const initialCenter = useMemo(() => {
    const coords: { lat: number; lng: number }[] = [];
    validShipments.forEach((s) => {
      if (s.origin_coordinates?.lat && s.origin_coordinates?.lng) {
        coords.push({ lat: s.origin_coordinates.lat, lng: s.origin_coordinates.lng });
      }
      if (s.destination_coordinates?.lat && s.destination_coordinates?.lng) {
        coords.push({ lat: s.destination_coordinates.lat, lng: s.destination_coordinates.lng });
      }
    });

    if (coords.length > 0) {
      const avgLat = coords.reduce((sum, c) => sum + c.lat, 0) / coords.length;
      const avgLng = coords.reduce((sum, c) => sum + c.lng, 0) / coords.length;
      return { latitude: avgLat, longitude: avgLng };
    }
    return { latitude: 40, longitude: -95 };
  }, [validShipments]);

  // Get line color based on status
  const getStatusLineColor = (status: ShipmentPoint['status']) => {
    switch (status) {
      case 'arrived':
      case 'closed':
        return 'rgb(var(--color-success))'; // green
      case 'in_transit':
        return '#3b82f6'; // blue
      case 'shipped':
        return '#8b5cf6'; // purple
      case 'delayed':
        return '#ef4444'; // red
      case 'planned':
      default:
        return 'rgb(var(--color-archive))'; // gray
    }
  };

  // Get marker color class based on status
  const getStatusColor = (status: ShipmentPoint['status']) => {
    switch (status) {
      case 'arrived':
      case 'closed':
        return 'bg-semantic-success';
      case 'in_transit':
        return 'bg-viz-1';
      case 'shipped':
        return 'bg-viz-2';
      case 'delayed':
        return 'bg-semantic-error';
      case 'planned':
      default:
        return 'bg-archive';
    }
  };

  // Get status icon
  const getStatusIcon = (status: ShipmentPoint['status']) => {
    switch (status) {
      case 'arrived':
      case 'closed':
        return <CheckCircle2 className="w-4 h-4 text-parchment" />;
      case 'in_transit':
        return <Truck className="w-4 h-4 text-parchment" />;
      case 'shipped':
        return <Plane className="w-4 h-4 text-parchment" />;
      case 'delayed':
        return <AlertTriangle className="w-4 h-4 text-parchment" />;
      case 'planned':
      default:
        return <Clock className="w-4 h-4 text-parchment" />;
    }
  };

  // Format date for display
  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return null;
    return formatDateShort(dateStr);
  };

  const handleShipmentClick = (shipment: ShipmentPoint) => {
    setSelectedShipment(shipment);
    onShipmentClick?.(shipment);
  };

  // Count shipments by status
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    validShipments.forEach((s) => {
      counts[s.status] = (counts[s.status] || 0) + 1;
    });
    return counts;
  }, [validShipments]);

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
        {/* Route lines layer */}
        {routeLinesGeoJSON.features.length > 0 && (
          <Source id="shipment-routes" type="geojson" data={routeLinesGeoJSON}>
            {/* Create separate layers for each status to color them differently */}
            {['planned', 'shipped', 'in_transit', 'delayed', 'arrived', 'closed'].map((status) => (
              <Layer
                key={`route-${status}`}
                id={`route-${status}`}
                type="line"
                filter={['==', ['get', 'status'], status]}
                paint={{
                  'line-color': getStatusLineColor(status as ShipmentPoint['status']),
                  'line-width': 2,
                  'line-opacity': 0.8,
                  'line-dasharray': status === 'planned' ? [4, 2] : [1],
                }}
              />
            ))}
          </Source>
        )}

        {/* Origin and Destination markers */}
        {validShipments.map((shipment) => (
          <div key={shipment.shipment_id}>
            {/* Origin marker */}
            {shipment.origin_coordinates?.lat && shipment.origin_coordinates?.lng && (
              <Marker
                latitude={shipment.origin_coordinates.lat}
                longitude={shipment.origin_coordinates.lng}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  handleShipmentClick(shipment);
                }}
              >
                <div className="relative cursor-pointer group">
                  <div
                    className={`w-8 h-8 ${getStatusColor(shipment.status)} rounded-full flex items-center justify-center shadow-lg border-2 border-parchment hover:scale-110 transition-transform`}
                  >
                    <MapPin className="w-4 h-4 text-parchment" />
                  </div>
                  {/* Origin label */}
                  <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs bg-ink/80 text-parchment px-1.5 py-0.5 rounded">
                    Origin
                  </div>
                </div>
              </Marker>
            )}

            {/* Destination marker */}
            {shipment.destination_coordinates?.lat && shipment.destination_coordinates?.lng && (
              <Marker
                latitude={shipment.destination_coordinates.lat}
                longitude={shipment.destination_coordinates.lng}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  handleShipmentClick(shipment);
                }}
              >
                <div className="relative cursor-pointer group">
                  <div
                    className={`w-8 h-8 ${getStatusColor(shipment.status)} rounded-full flex items-center justify-center shadow-lg border-2 border-parchment hover:scale-110 transition-transform`}
                  >
                    {getStatusIcon(shipment.status)}
                  </div>
                  {/* Destination label */}
                  <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs bg-ink/80 text-parchment px-1.5 py-0.5 rounded">
                    Dest
                  </div>
                </div>
              </Marker>
            )}
          </div>
        ))}

        {/* Popup for selected shipment */}
        {selectedShipment && (selectedShipment.origin_coordinates || selectedShipment.destination_coordinates) && (
          <Popup
            latitude={
              selectedShipment.destination_coordinates?.lat ||
              selectedShipment.origin_coordinates?.lat ||
              0
            }
            longitude={
              selectedShipment.destination_coordinates?.lng ||
              selectedShipment.origin_coordinates?.lng ||
              0
            }
            anchor="bottom"
            onClose={() => setSelectedShipment(null)}
            closeOnClick={false}
          >
            <div className="p-2 min-w-[220px]">
              <div className="flex items-center gap-2 mb-2">
                <div
                  className={`w-6 h-6 ${getStatusColor(selectedShipment.status)} rounded-full flex items-center justify-center`}
                >
                  {getStatusIcon(selectedShipment.status)}
                </div>
                <span className="text-xs capitalize text-archive">
                  {selectedShipment.status.replace('_', ' ')}
                </span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    selectedShipment.direction === 'outbound'
                      ? 'bg-semantic-info/10 text-semantic-info'
                      : 'bg-semantic-success/10 text-semantic-success'
                  }`}
                >
                  {selectedShipment.direction}
                </span>
              </div>

              {selectedShipment.shipment_number && (
                <div className="font-medium text-ink">{selectedShipment.shipment_number}</div>
              )}

              <div className="space-y-1 mt-2 text-sm">
                {selectedShipment.origin && (
                  <div className="text-archive">
                    <span className="font-medium">From:</span> {selectedShipment.origin}
                  </div>
                )}
                {selectedShipment.destination && (
                  <div className="text-archive">
                    <span className="font-medium">To:</span> {selectedShipment.destination}
                  </div>
                )}
              </div>

              {selectedShipment.carrier && (
                <div className="flex items-center gap-1 mt-2 text-sm text-archive">
                  <Truck className="w-4 h-4" />
                  {selectedShipment.carrier}
                </div>
              )}

              {(selectedShipment.ship_date || selectedShipment.expected_arrival) && (
                <div className="flex items-center gap-1 mt-2 text-sm text-archive">
                  <Calendar className="w-4 h-4" />
                  {formatDate(selectedShipment.ship_date)}
                  {selectedShipment.expected_arrival && (
                    <> → {formatDate(selectedShipment.expected_arrival)}</>
                  )}
                </div>
              )}

              {selectedShipment.object_count > 0 && (
                <div className="flex items-center gap-1 mt-2 text-sm text-archive">
                  <Package className="w-4 h-4" />
                  {selectedShipment.object_count} object
                  {selectedShipment.object_count !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          </Popup>
        )}
      </BaseMap>

      {/* Title header */}
      {exhibitionTitle && (
        <div className="absolute top-4 left-4 bg-parchment rounded-lg shadow-md p-3">
          <div className="text-xs text-archive mb-1">Shipment Routes</div>
          <div className="font-medium text-ink">{exhibitionTitle}</div>
          <div className="text-sm text-archive mt-1">
            {validShipments.length} shipment{validShipments.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-parchment rounded-lg shadow-md p-3 text-sm">
        <div className="font-medium text-ink mb-2">Shipment Status</div>
        <div className="space-y-1.5">
          {statusCounts['in_transit'] && (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-viz-1 rounded-full" />
              <span className="text-archive">In Transit ({statusCounts['in_transit']})</span>
            </div>
          )}
          {statusCounts['shipped'] && (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-viz-2 rounded-full" />
              <span className="text-archive">Shipped ({statusCounts['shipped']})</span>
            </div>
          )}
          {(statusCounts['arrived'] || statusCounts['closed']) && (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-semantic-success rounded-full" />
              <span className="text-archive">
                Arrived ({(statusCounts['arrived'] || 0) + (statusCounts['closed'] || 0)})
              </span>
            </div>
          )}
          {statusCounts['delayed'] && (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-semantic-error rounded-full" />
              <span className="text-archive">Delayed ({statusCounts['delayed']})</span>
            </div>
          )}
          {statusCounts['planned'] && (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-archive rounded-full" />
              <span className="text-archive">Planned ({statusCounts['planned']})</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
