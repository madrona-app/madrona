import { MapPin, Building } from 'lucide-react';
import { formatDateMonth, formatDateShort } from '../../lib/formatters';
import type { ExhibitionVenue } from '../../lib/api';

interface TouringTimelineProps {
  venues: ExhibitionVenue[];
}

const STATUS_COLORS: Record<string, string> = {
  proposed: 'rgb(var(--color-archive))',     // gray
  confirmed: '#3b82f6',    // blue
  in_transit: 'rgb(var(--color-warning))',   // amber
  installed: 'rgb(var(--color-success))',    // emerald
  open: 'rgb(var(--color-success))',         // green
  closing: 'rgb(var(--color-warning))',      // orange
  returned: 'rgb(var(--color-archive))',     // gray
};

export function TouringTimeline({ venues }: TouringTimelineProps) {
  // Calculate date range for timeline
  const allDates = venues.flatMap((v) => [
    v.planned_start_date,
    v.planned_end_date,
    v.actual_start_date,
    v.actual_end_date,
  ]).filter(Boolean) as string[];

  if (allDates.length === 0) {
    return null;
  }

  const minDate = new Date(Math.min(...allDates.map((d) => new Date(d).getTime())));
  const maxDate = new Date(Math.max(...allDates.map((d) => new Date(d).getTime())));

  // Add padding
  minDate.setMonth(minDate.getMonth() - 1);
  maxDate.setMonth(maxDate.getMonth() + 1);

  const totalDays = Math.ceil(
    (maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const getPosition = (date: string | undefined): number | null => {
    if (!date) return null;
    const d = new Date(date);
    const days = Math.ceil((d.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
    return (days / totalDays) * 100;
  };

  // Generate month markers
  const months: { label: string; position: number }[] = [];
  const currentDate = new Date(minDate);
  currentDate.setDate(1);
  while (currentDate <= maxDate) {
    const position = getPosition(currentDate.toISOString());
    if (position !== null && position >= 0 && position <= 100) {
      months.push({
        label: formatDateMonth(currentDate),
        position,
      });
    }
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  return (
    <div className="p-4 bg-stone/30 rounded-lg">
      <h5 className="text-xs font-medium text-archive uppercase tracking-wide mb-4">
        Tour Timeline
      </h5>

      {/* Timeline container */}
      <div className="relative">
        {/* Month markers */}
        <div className="h-6 relative border-b border-lichen mb-4">
          {months.map((month, index) => (
            <div
              key={index}
              className="absolute text-[10px] text-archive whitespace-nowrap"
              style={{ left: `${month.position}%`, transform: 'translateX(-50%)' }}
            >
              {month.label}
            </div>
          ))}
        </div>

        {/* Venue bars */}
        <div className="space-y-3">
          {venues.map((venue) => {
            const startPos = getPosition(venue.planned_start_date);
            const endPos = getPosition(venue.planned_end_date);

            // If no dates, show a small dot at the beginning
            const hasRange = startPos !== null && endPos !== null;
            const width = hasRange ? Math.max(endPos - startPos, 2) : 2;
            const left = startPos ?? 0;

            return (
              <div key={venue.exhibition_venue_id} className="relative h-8 flex items-center">
                {/* Venue label */}
                <div className="absolute left-0 w-32 pr-2 text-xs text-ink truncate flex items-center gap-1 z-10">
                  {venue.venue_id ? (
                    <MapPin size={12} className="text-bark shrink-0" />
                  ) : (
                    <Building size={12} className="text-archive shrink-0" />
                  )}
                  <span className="truncate">
                    {venue.venue_name || venue.external_venue_name}
                  </span>
                </div>

                {/* Timeline bar area */}
                <div className="absolute left-36 right-0 h-full">
                  <div className="relative h-full bg-stone/50 rounded">
                    {/* Venue bar */}
                    <div
                      className="absolute h-6 top-1 rounded-sm transition-all"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        backgroundColor: STATUS_COLORS[venue.status] || STATUS_COLORS.proposed,
                        minWidth: '4px',
                      }}
                      title={`${venue.venue_name || venue.external_venue_name}: ${
                        venue.planned_start_date
                          ? formatDateShort(venue.planned_start_date)
                          : 'TBD'
                      } - ${
                        venue.planned_end_date
                          ? formatDateShort(venue.planned_end_date)
                          : 'TBD'
                      }`}
                    />

                    {/* Actual dates overlay (if different) */}
                    {venue.actual_start_date && (
                      <div
                        className="absolute h-2 bottom-0 rounded-sm opacity-50"
                        style={{
                          left: `${getPosition(venue.actual_start_date) || 0}%`,
                          width: `${
                            (getPosition(venue.actual_end_date) || getPosition(venue.actual_start_date) || 0) -
                            (getPosition(venue.actual_start_date) || 0)
                          }%`,
                          backgroundColor: STATUS_COLORS.open,
                          minWidth: '4px',
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Today marker */}
        {(() => {
          const todayPos = getPosition(new Date().toISOString());
          if (todayPos !== null && todayPos >= 0 && todayPos <= 100) {
            return (
              <div
                className="absolute top-0 bottom-0 w-px bg-semantic-error z-20"
                style={{ left: `calc(144px + ${(todayPos / 100) * (100 - 144)}%)` }}
              >
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-[10px] text-semantic-error font-medium">
                  Today
                </div>
              </div>
            );
          }
          return null;
        })()}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-lichen">
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1 text-[10px] text-archive">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: color }}
            />
            {status.replace('_', ' ')}
          </div>
        ))}
      </div>
    </div>
  );
}

export default TouringTimeline;
