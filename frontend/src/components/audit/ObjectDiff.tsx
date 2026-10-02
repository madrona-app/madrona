import type { JsonValue } from '../../types/api';

interface ObjectDiffProps {
  oldValue: JsonValue;
  newValue: JsonValue;
  onViewDetails?: () => void;
}

export function ObjectDiff({ oldValue, newValue, onViewDetails }: ObjectDiffProps) {
  const oldKeys = typeof oldValue === 'object' && oldValue !== null && !Array.isArray(oldValue)
    ? Object.keys(oldValue)
    : [];
  const newKeys = typeof newValue === 'object' && newValue !== null && !Array.isArray(newValue)
    ? Object.keys(newValue)
    : [];

  const allKeys = new Set([...oldKeys, ...newKeys]);
  let changedCount = 0;
  for (const key of allKeys) {
    const oldV = oldKeys.includes(key) ? (oldValue as Record<string, JsonValue>)[key] : undefined;
    const newV = newKeys.includes(key) ? (newValue as Record<string, JsonValue>)[key] : undefined;
    if (JSON.stringify(oldV) !== JSON.stringify(newV)) changedCount++;
  }

  return (
    <span className="text-sm inline-flex items-center gap-2">
      <span className="text-archive">
        {changedCount} field{changedCount !== 1 ? 's' : ''} changed
      </span>
      {onViewDetails && (
        <button
          onClick={onViewDetails}
          className="text-xs text-bark hover:text-copper-dark underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-1 rounded"
        >
          View details
        </button>
      )}
    </span>
  );
}
