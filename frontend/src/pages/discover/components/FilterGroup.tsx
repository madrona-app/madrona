import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { DiscoverFacet } from '../../../types/discover';

interface FilterGroupProps {
  label: string;
  facet: DiscoverFacet;
  selected: string[];
  onToggle: (key: string) => void;
}

export function FilterGroup({ label, facet, selected, onToggle }: FilterGroupProps) {
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const visibleBuckets = showAll ? facet.buckets : facet.buckets.slice(0, 5);

  return (
    <div className="border-b border-parchment/10 pb-4 mb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center justify-between w-full text-left text-sm font-medium text-parchment mb-2"
      >
        {label}
        {expanded ? (
          <ChevronUp size={14} className="text-parchment/50" />
        ) : (
          <ChevronDown size={14} className="text-parchment/50" />
        )}
      </button>
      {expanded && (
        <div className="space-y-1">
          {visibleBuckets.map((bucket) => (
            <label
              key={bucket.key}
              className="flex items-center gap-2 text-sm text-parchment/70 hover:text-parchment cursor-pointer py-0.5"
            >
              <input
                type="checkbox"
                checked={selected.includes(bucket.key)}
                onChange={() => onToggle(bucket.key)}
                className="rounded border-parchment/30 bg-transparent text-bark focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
              <span className="flex-1 truncate">{bucket.key}</span>
              <span className="text-xs text-parchment/40">{bucket.count}</span>
            </label>
          ))}
          {facet.buckets.length > 5 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="text-xs text-parchment/50 hover:text-parchment mt-1"
            >
              {showAll ? 'Show less' : `Show all ${facet.buckets.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
