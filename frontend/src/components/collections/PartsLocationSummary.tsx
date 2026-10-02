/**
 * PartsLocationSummary - Compact display for header when object has multiple parts.
 *
 * Examples:
 * - "3 parts across 2 locations"
 * - "2 on display, 1 in storage"
 * - "3 parts in Gallery 3"
 */

import { MapPin, Package } from 'lucide-react';

interface Part {
  part_id: string;
  current_location_id?: string | null;
  current_location_name?: string | null;
  current_location_path?: string | null;
  current_location_on_display?: boolean | null;
}

interface PartsLocationSummaryProps {
  parts: Part[];
  className?: string;
}

export function PartsLocationSummary({ parts, className = '' }: PartsLocationSummaryProps) {
  if (!parts || parts.length === 0) {
    return null;
  }

  // If only one part, don't show summary (use regular location display)
  if (parts.length === 1) {
    return null;
  }

  // Count parts by location status
  const onDisplay = parts.filter(p => p.current_location_on_display).length;
  const inStorage = parts.length - onDisplay;

  // Count unique locations
  const uniqueLocations = new Set(
    parts.map(p => p.current_location_id).filter(Boolean)
  );
  const locationCount = uniqueLocations.size || 1;

  // Find most common location for single-location display (prefer path over name)
  const locationCounts = new Map<string, { display: string; count: number }>();
  parts.forEach(p => {
    const locDisplay = p.current_location_path || p.current_location_name;
    if (locDisplay) {
      const existing = locationCounts.get(locDisplay);
      if (existing) {
        existing.count++;
      } else {
        locationCounts.set(locDisplay, { display: locDisplay, count: 1 });
      }
    }
  });

  // Build summary text
  let summaryText: string;
  if (locationCount === 1 && locationCounts.size === 1) {
    // All parts in same location
    const locDisplay = Array.from(locationCounts.values())[0]?.display || 'Unknown';
    summaryText = `${parts.length} parts in ${locDisplay}`;
  } else if (onDisplay > 0 && inStorage > 0) {
    // Mix of display and storage
    summaryText = `${onDisplay} on display, ${inStorage} in storage`;
  } else if (onDisplay === parts.length) {
    // All on display
    summaryText = `${parts.length} parts on display`;
  } else if (inStorage === parts.length) {
    // All in storage
    summaryText = `${parts.length} parts in storage`;
  } else {
    // Default: show parts across locations
    summaryText = `${parts.length} parts across ${locationCount} location${locationCount !== 1 ? 's' : ''}`;
  }

  // Determine badge color
  const badgeClass = onDisplay > 0
    ? 'bg-meadow/10 text-meadow-dark'
    : 'bg-stone/50 text-archive';

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <div className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${badgeClass}`}>
        <Package size={12} />
        <span>{summaryText}</span>
      </div>
    </div>
  );
}

/**
 * PartsLocationTooltip - Extended tooltip view showing all parts and their locations.
 * Use with a popover/dropdown for detailed view.
 */
interface PartsLocationTooltipProps {
  parts: Part[];
  objectNumber: string;
}

export function PartsLocationTooltip({ parts, objectNumber }: PartsLocationTooltipProps) {
  if (!parts || parts.length === 0) {
    return null;
  }

  return (
    <div className="min-w-[200px] max-w-[300px]">
      <div className="text-xs font-medium text-archive mb-2 pb-1 border-b border-lichen">
        Part Locations
      </div>
      <div className="space-y-1.5">
        {parts.map((part, index) => {
          const partNum = (part as { part_number?: string }).part_number;
          const name = (part as { name?: string }).name;

          return (
            <div key={part.part_id} className="flex items-start gap-2 text-sm">
              <div className="w-4 h-4 rounded bg-stone/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[10px] text-archive font-medium">
                  {partNum || index + 1}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-forest truncate">
                  {name || `${objectNumber}.${partNum || index + 1}`}
                </div>
                <div className="flex items-center gap-1 text-xs text-archive">
                  <MapPin size={10} />
                  <span className="truncate">
                    {part.current_location_path || part.current_location_name || 'No location'}
                    {part.current_location_on_display && ' (Display)'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PartsLocationSummary;
