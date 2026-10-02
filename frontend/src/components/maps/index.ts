/**
 * Map Components for Madrona GIS Features
 *
 * These components provide interactive mapping capabilities using MapLibre GL JS.
 * All components use free tile providers (CartoDB/OpenStreetMap) requiring no API keys.
 *
 * Components:
 * - BaseMap: Foundation map component with Madrona theming
 * - PointPicker: Interactive click-to-place coordinate entry
 * - AreaDrawer: Draw polygon regions (excavation sites, geographic areas)
 * - MapSearch: Draw area to find objects within bounds
 * - LocationPreview: Read-only location display
 *
 * @example
 * ```tsx
 * import { PointPicker, MapSearch, LocationPreview } from '@/components/maps';
 *
 * // Interactive coordinate entry
 * <PointPicker
 *   value={coordinates}
 *   onChange={setCoordinates}
 *   height={400}
 * />
 *
 * // Map-based object search
 * <MapSearch
 *   onSearch={handlePolygonSearch}
 *   placeRoles={['creation_place', 'discovery_place']}
 * />
 *
 * // Simple location preview
 * <LocationPreview
 *   latitude={48.8566}
 *   longitude={2.3522}
 *   name="Paris, France"
 * />
 * ```
 */

export { default as BaseMap } from './BaseMap';
export type { BaseMapProps, BaseMapRef } from './BaseMap';

export { default as PointPicker } from './PointPicker';
export type { PointPickerProps, Coordinates } from './PointPicker';

export { default as AreaDrawer } from './AreaDrawer';
export type { AreaDrawerProps, PolygonCoordinates } from './AreaDrawer';

export { default as MapSearch } from './MapSearch';
export type { MapSearchProps } from './MapSearch';

export { default as LocationPreview } from './LocationPreview';
export type { LocationPreviewProps } from './LocationPreview';

export { default as LocationPickerModal } from './LocationPickerModal';
export type { LocationPickerModalProps } from './LocationPickerModal';

// Visualization Maps
export { default as LoanNetworkMap } from './LoanNetworkMap';
export type { LoanNetworkMapProps, LoanContact } from './LoanNetworkMap';

export { default as TourRouteMap } from './TourRouteMap';
export type { TourRouteMapProps, TourVenue } from './TourRouteMap';

export { default as CollectionOriginMap } from './CollectionOriginMap';
export type { CollectionOriginMapProps, PlaceOrigin } from './CollectionOriginMap';

export { default as ShipmentRouteMap } from './ShipmentRouteMap';
export type { ShipmentRouteMapProps, ShipmentPoint } from './ShipmentRouteMap';
