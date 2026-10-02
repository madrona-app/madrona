import { CheckCircle, Clock, ArrowRightLeft } from 'lucide-react';
import { formatDateShort } from '../../../lib/formatters';
import { cn } from '../../../lib/utils';
import type { Movement } from './types';
import { MOVEMENT_REASON_LABELS } from './types';

export function MovementTimeline({
  movements,
  total,
  showAll,
  onShowAll,
  onShowLess,
  showPartInfo = false,
}: {
  movements: Movement[];
  total: number;
  showAll: boolean;
  onShowAll: () => void;
  onShowLess: () => void;
  /** Show part number/name when available (for multi-part objects) */
  showPartInfo?: boolean;
}) {
  // Check if any movement has part info
  const hasPartInfo = showPartInfo || movements.some(m => m.part_number || m.part_name);

  if (movements.length === 0) {
    return (
      <div className="text-center py-8 text-archive">
        <ArrowRightLeft size={32} className="mx-auto mb-3 opacity-40" />
        <p className="text-sm">No movements recorded yet</p>
      </div>
    );
  }

  // Helper to format part label
  const getPartLabel = (movement: Movement) => {
    if (!movement.part_number && !movement.part_name) return null;
    const partNum = movement.part_number ? `.${movement.part_number}` : '';
    const partName = movement.part_name ? ` ${movement.part_name}` : '';
    return `${partNum}${partName}`.trim();
  };

  return (
    <div className="space-y-3">
      {movements.map((movement, index) => {
        const partLabel = getPartLabel(movement);

        return (
          <div
            key={movement.movement_id}
            className={cn(
              "flex items-start gap-3 p-3 rounded-lg",
              index === 0 ? "bg-forest/5 border border-forest/20" : "bg-stone/30"
            )}
          >
            {/* Status indicator */}
            <div className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
              movement.status === 'completed' ? 'bg-semantic-success text-parchment' :
              movement.status === 'in_transit' ? 'bg-semantic-warning text-parchment' :
              'bg-stone text-archive border-2 border-lichen'
            )}>
              {movement.status === 'completed' ? <CheckCircle size={14} /> : <Clock size={14} />}
            </div>

            {/* Movement details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Part label (for multi-part objects) */}
                {hasPartInfo && partLabel && (
                  <span className="text-xs px-1.5 py-0.5 bg-stone text-archive rounded font-mono">
                    {partLabel}
                  </span>
                )}
                <span className="font-medium text-forest">
                  {movement.to_location_name || movement.to_location_path || 'Unknown location'}
                </span>
                {index === 0 && (
                  <span className="text-xs px-1.5 py-0.5 bg-forest/10 text-forest rounded">
                    Current
                  </span>
                )}
              </div>

              <div className="text-sm text-bark mt-1">
                {(movement.from_location_name || movement.from_location_path) && (
                  <span>From {movement.from_location_name || movement.from_location_path} · </span>
                )}
                <span>{MOVEMENT_REASON_LABELS[movement.reason] || movement.reason}</span>
              </div>

              <div className="text-xs text-archive mt-1 flex items-center gap-2 flex-wrap">
                {movement.movement_date && (
                  <span>
                    {formatDateShort(movement.movement_date)}
                  </span>
                )}
                {(movement.handler_name || movement.moved_by_name) && (
                  <>
                    <span>·</span>
                    <span>Handled by {movement.handler_name || movement.moved_by_name}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {total > 5 && (
        <div className="text-center pt-2">
          <button onClick={showAll ? onShowLess : onShowAll} className="text-sm text-bark hover:text-copper-dark">
            {showAll ? 'Show less' : `View all ${total} movements`}
          </button>
        </div>
      )}
    </div>
  );
}
