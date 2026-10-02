import type { JsonValue } from '../../types/api';
import { classifyDiff, computeListDiff } from './diffUtils';
import { formatFieldName } from './formatFieldName';
import { ScalarDiff } from './ScalarDiff';
import { ListDiff } from './ListDiff';
import { ObjectDiff } from './ObjectDiff';

export interface FieldDiffData {
  field_name: string;
  old_value: JsonValue;
  new_value: JsonValue;
}

interface FieldDiffRowProps {
  diff: FieldDiffData;
  /** Whether the inline detail accordion for this row is open */
  detailOpen?: boolean;
  /** Toggle inline detail accordion */
  onToggleDetail?: () => void;
  /** Open the raw diff modal for this field */
  onViewRaw?: (diff: FieldDiffData) => void;
}

/** Compact +N / -N chip shown next to the field name */
function DeltaChip({ count, type }: { count: number; type: 'added' | 'removed' }) {
  if (count === 0) return null;
  const isAdded = type === 'added';
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
        isAdded
          ? 'bg-semantic-success/10 text-semantic-success border border-semantic-success/20'
          : 'bg-semantic-error/10 text-semantic-error border border-semantic-error/20'
      }`}
    >
      <span className="sr-only">{isAdded ? 'added' : 'removed'}</span>
      {isAdded ? '+' : '\u2212'}{count}
    </span>
  );
}

export function FieldDiffRow({
  diff,
  detailOpen = false,
  onToggleDetail,
  onViewRaw,
}: FieldDiffRowProps) {
  const kind = classifyDiff(diff);

  // Compute delta counts for list diffs to show chips
  let addedCount = 0;
  let removedCount = 0;
  if (kind === 'list') {
    const result = computeListDiff(diff.old_value, diff.new_value);
    addedCount = result.added.length;
    removedCount = result.removed.length;
    // Skip no-op list diffs entirely
    if (addedCount === 0 && removedCount === 0) return null;
  }

  return (
    <div className="py-2 border-b border-lichen/50 last:border-0">
      {/* Field name + delta chips on one line */}
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className="text-sm font-medium text-ink">
          {formatFieldName(diff.field_name)}
        </span>
        {kind === 'list' && (
          <>
            <DeltaChip count={addedCount} type="added" />
            <DeltaChip count={removedCount} type="removed" />
          </>
        )}
      </div>

      {/* Diff content */}
      <div>
        {kind === 'scalar' && (
          <ScalarDiff oldValue={diff.old_value} newValue={diff.new_value} fieldName={diff.field_name} />
        )}
        {kind === 'list' && (
          <ListDiff
            oldValue={diff.old_value}
            newValue={diff.new_value}
            fieldName={diff.field_name}
            detailOpen={detailOpen}
            onToggleDetail={onToggleDetail}
          />
        )}
        {kind === 'object' && (
          <ObjectDiff
            oldValue={diff.old_value}
            newValue={diff.new_value}
            onViewDetails={onViewRaw ? () => onViewRaw(diff) : undefined}
          />
        )}
      </div>
    </div>
  );
}
