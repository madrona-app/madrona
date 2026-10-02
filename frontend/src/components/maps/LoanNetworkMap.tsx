/**
 * LoanNetworkMap - Visualizes lending/borrowing relationships geographically.
 *
 * Shows institutions that have loaned to or borrowed from the organization,
 * with lines connecting them to indicate loan relationships.
 */

import { useMemo, useRef, useEffect } from 'react';
import { Marker, Source, Layer } from 'react-map-gl/maplibre';
import { Building2, ArrowRight, ArrowLeft, ArrowLeftRight } from 'lucide-react';
import BaseMap from './BaseMap';
import type { BaseMapRef } from './BaseMap';

export interface LoanContact {
  contact_id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** Number of loans out (we lent to them) */
  loans_out_count: number;
  /** Number of loans in (they lent to us) */
  loans_in_count: number;
  /** Active loan count */
  active_loans: number;
}

export interface LoanNetworkMapProps {
  /** The organization's coordinates (center point) */
  organizationCoordinates?: { latitude: number; longitude: number; name?: string };
  /** List of contacts with loan relationships */
  contacts: LoanContact[];
  /** Height of the map container */
  height?: string | number;
  /** Called when a contact marker is clicked */
  onContactClick?: (contact: LoanContact) => void;
  /** Show loan flow direction lines */
  showFlowLines?: boolean;
  /** Filter to show only active loans */
  activeOnly?: boolean;
}

interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  properties: {
    type: 'loan_out' | 'loan_in' | 'bidirectional';
    count: number;
    contactName: string;
  };
}

export default function LoanNetworkMap({
  organizationCoordinates,
  contacts,
  height = 500,
  onContactClick,
  showFlowLines = true,
  activeOnly = false,
}: LoanNetworkMapProps) {
  const mapRef = useRef<BaseMapRef>(null);

  // Filter contacts - exclude those without coordinates and optionally filter by activity
  const filteredContacts = useMemo(() => {
    // First filter out contacts without valid coordinates
    const withCoords = contacts.filter(
      (c) => c.latitude !== null && c.longitude !== null
    ) as (LoanContact & { latitude: number; longitude: number })[];

    if (activeOnly) {
      return withCoords.filter((c) => c.active_loans > 0);
    }
    return withCoords.filter((c) => c.loans_out_count > 0 || c.loans_in_count > 0);
  }, [contacts, activeOnly]);

  // Calculate bounds to fit all markers
  useEffect(() => {
    if (filteredContacts.length === 0 || !mapRef.current) return;

    const allCoords = filteredContacts.map((c) => [c.longitude, c.latitude] as [number, number]);
    if (organizationCoordinates) {
      allCoords.push([organizationCoordinates.longitude, organizationCoordinates.latitude]);
    }

    if (allCoords.length > 1) {
      const lngs = allCoords.map((c) => c[0]);
      const lats = allCoords.map((c) => c[1]);
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ];

      // Add some padding
      setTimeout(() => {
        mapRef.current?.fitBounds(bounds, { padding: 50 });
      }, 100);
    }
  }, [filteredContacts, organizationCoordinates]);

  // Generate GeoJSON for flow lines
  const flowLinesGeoJSON = useMemo(() => {
    if (!showFlowLines || !organizationCoordinates) return null;

    const features: GeoJSONFeature[] = filteredContacts.map((contact) => {
      const hasLoansOut = contact.loans_out_count > 0;
      const hasLoansIn = contact.loans_in_count > 0;
      const type =
        hasLoansOut && hasLoansIn ? 'bidirectional' : hasLoansOut ? 'loan_out' : 'loan_in';

      return {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [organizationCoordinates.longitude, organizationCoordinates.latitude],
            [contact.longitude, contact.latitude],
          ],
        },
        properties: {
          type,
          count: contact.loans_out_count + contact.loans_in_count,
          contactName: contact.name,
        },
      };
    });

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [filteredContacts, organizationCoordinates, showFlowLines]);

  // Calculate initial center
  const initialCenter = useMemo(() => {
    if (organizationCoordinates) {
      return {
        latitude: organizationCoordinates.latitude,
        longitude: organizationCoordinates.longitude,
      };
    }
    if (filteredContacts.length > 0) {
      const avgLat =
        filteredContacts.reduce((sum, c) => sum + c.latitude, 0) / filteredContacts.length;
      const avgLng =
        filteredContacts.reduce((sum, c) => sum + c.longitude, 0) / filteredContacts.length;
      return { latitude: avgLat, longitude: avgLng };
    }
    return { latitude: 40, longitude: -95 }; // Default to US center
  }, [organizationCoordinates, filteredContacts]);

  // Get marker size based on loan count
  const getMarkerSize = (contact: LoanContact) => {
    const total = contact.loans_out_count + contact.loans_in_count;
    if (total >= 10) return 'lg';
    if (total >= 5) return 'md';
    return 'sm';
  };

  // Get marker color based on loan direction
  const getMarkerColor = (contact: LoanContact) => {
    const hasLoansOut = contact.loans_out_count > 0;
    const hasLoansIn = contact.loans_in_count > 0;
    if (hasLoansOut && hasLoansIn) return 'bg-viz-3/100'; // Bidirectional
    if (hasLoansOut) return 'bg-semantic-info/100'; // We lent to them
    return 'bg-semantic-success/100'; // They lent to us
  };

  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-10 h-10',
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
        {/* Flow lines layer */}
        {flowLinesGeoJSON && (
          <Source id="loan-flows" type="geojson" data={flowLinesGeoJSON}>
            {/* Loan out lines (blue, dashed) */}
            <Layer
              id="loan-out-lines"
              type="line"
              filter={['==', ['get', 'type'], 'loan_out']}
              paint={{
                'line-color': '#3b82f6',
                'line-width': 2,
                'line-dasharray': [2, 2],
                'line-opacity': 0.7,
              }}
            />
            {/* Loan in lines (green, dashed) */}
            <Layer
              id="loan-in-lines"
              type="line"
              filter={['==', ['get', 'type'], 'loan_in']}
              paint={{
                'line-color': 'rgb(var(--color-success))',
                'line-width': 2,
                'line-dasharray': [2, 2],
                'line-opacity': 0.7,
              }}
            />
            {/* Bidirectional lines (purple, solid) */}
            <Layer
              id="bidirectional-lines"
              type="line"
              filter={['==', ['get', 'type'], 'bidirectional']}
              paint={{
                'line-color': '#a855f7',
                'line-width': 3,
                'line-opacity': 0.8,
              }}
            />
          </Source>
        )}

        {/* Organization marker (center) */}
        {organizationCoordinates && (
          <Marker
            latitude={organizationCoordinates.latitude}
            longitude={organizationCoordinates.longitude}
            anchor="center"
          >
            <div className="relative">
              <div className="w-12 h-12 bg-bark rounded-full flex items-center justify-center shadow-lg border-2 border-parchment">
                <Building2 className="w-6 h-6 text-parchment" />
              </div>
              {organizationCoordinates.name && (
                <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap bg-ink text-parchment text-xs px-2 py-1 rounded">
                  {organizationCoordinates.name}
                </div>
              )}
            </div>
          </Marker>
        )}

        {/* Contact markers */}
        {filteredContacts.map((contact) => {
          const size = getMarkerSize(contact);
          const colorClass = getMarkerColor(contact);
          const hasLoansOut = contact.loans_out_count > 0;
          const hasLoansIn = contact.loans_in_count > 0;

          return (
            <Marker
              key={contact.contact_id}
              latitude={contact.latitude}
              longitude={contact.longitude}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                onContactClick?.(contact);
              }}
            >
              <div
                className={`${sizeClasses[size]} ${colorClass} rounded-full flex items-center justify-center shadow-md cursor-pointer hover:scale-110 transition-transform border-2 border-parchment`}
                title={contact.name}
              >
                {hasLoansOut && hasLoansIn ? (
                  <ArrowLeftRight className="w-3 h-3 text-parchment" />
                ) : hasLoansOut ? (
                  <ArrowRight className="w-3 h-3 text-parchment" />
                ) : (
                  <ArrowLeft className="w-3 h-3 text-parchment" />
                )}
              </div>
            </Marker>
          );
        })}
      </BaseMap>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-parchment rounded-lg shadow-md p-3 text-sm">
        <div className="font-medium text-ink mb-2">Loan Network</div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-bark rounded-full" />
            <span className="text-archive">Your Organization</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-semantic-info/100 rounded-full" />
            <span className="text-archive">Loans Out (we lent)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-semantic-success/100 rounded-full" />
            <span className="text-archive">Loans In (they lent)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-viz-3/100 rounded-full" />
            <span className="text-archive">Bidirectional</span>
          </div>
        </div>
        {activeOnly && (
          <div className="mt-2 pt-2 border-t border-lichen text-xs text-archive">
            Showing active loans only
          </div>
        )}
      </div>

      {/* Stats summary */}
      <div className="absolute top-4 left-4 bg-parchment rounded-lg shadow-md p-3 text-sm">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-lg font-semibold text-ink">{filteredContacts.length}</div>
            <div className="text-xs text-archive">Institutions</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-semantic-info">
              {filteredContacts.reduce((sum, c) => sum + c.loans_out_count, 0)}
            </div>
            <div className="text-xs text-archive">Loans Out</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-semantic-success">
              {filteredContacts.reduce((sum, c) => sum + c.loans_in_count, 0)}
            </div>
            <div className="text-xs text-archive">Loans In</div>
          </div>
        </div>
      </div>
    </div>
  );
}
