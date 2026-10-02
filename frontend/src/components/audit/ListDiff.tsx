import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { JsonValue } from '../../types/api';
import {
  computeListDiff,
  summarizeListDiff,
  formatListDiffAsText,
  getFieldLabelFn,
  type ItemLabelFn,
} from './diffUtils';
import { formatFieldName } from './formatFieldName';

interface ListDiffProps {
  oldValue: JsonValue;
  newValue: JsonValue;
  fieldName?: string;
  /** Whether the inline detail accordion is open (controlled by parent) */
  detailOpen?: boolean;
  /** Callback to toggle the inline detail accordion */
  onToggleDetail?: () => void;
}

function ValueChip({ type, label }: { type: 'added' | 'removed'; label: string }) {
  const isAdded = type === 'added';
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border-l-2 ${
        isAdded
          ? 'border-semantic-success bg-semantic-success/5 text-ink'
          : 'border-semantic-error bg-semantic-error/5 text-ink'
      }`}
    >
      <span className={isAdded ? 'text-semantic-success' : 'text-semantic-error'}>
        {isAdded ? '+' : '\u2212'}
      </span>
      <span className="sr-only">{isAdded ? 'added' : 'removed'}</span>
      {label}
    </span>
  );
}

/** Label for items in the detail accordion — returns empty string for unlabelable items */
function detailItemLabel(item: JsonValue, labelFn: ItemLabelFn): string {
  return labelFn(item) || '';
}

export function ListDiff({
  oldValue,
  newValue,
  fieldName,
  detailOpen = false,
  onToggleDetail,
}: ListDiffProps) {
  const [copied, setCopied] = useState(false);
  const labelFn = getFieldLabelFn(fieldName);
  const { added, removed } = computeListDiff(oldValue, newValue);
  const summary = summarizeListDiff(added, removed, 3, labelFn);

  if (added.length === 0 && removed.length === 0) {
    return null; // No-op diff, omit entirely
  }

  const hasReadablePreview = summary.previewAdded.length > 0 || summary.previewRemoved.length > 0;
  // Show expand button only when there are items beyond the preview
  const hasHiddenItems = summary.remainingCount > 0;

  const handleCopy = async () => {
    const text = formatListDiffAsText(
      fieldName ? formatFieldName(fieldName) : 'Changes',
      added,
      removed,
      labelFn,
    );
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  // When no items have readable labels, show count-only (no toggle — use Raw Diff for details)
  if (!hasReadablePreview) {
    const parts: string[] = [];
    if (added.length > 0) parts.push(`${added.length} added`);
    if (removed.length > 0) parts.push(`${removed.length} removed`);
    return (
      <div>
        <span className="text-xs text-archive">{parts.join(', ')}</span>
      </div>
    );
  }

  return (
    <div>
      {/* Inline preview chips */}
      <div className="flex flex-wrap gap-1.5 items-center">
        {summary.previewRemoved.map((label, i) => (
          <ValueChip key={`r-${i}`} type="removed" label={label} />
        ))}
        {summary.previewAdded.map((label, i) => (
          <ValueChip key={`a-${i}`} type="added" label={label} />
        ))}
        {hasHiddenItems && onToggleDetail && (
          <button
            onClick={onToggleDetail}
            className="text-xs text-bark hover:text-copper-dark underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-1 rounded"
            aria-expanded={detailOpen}
          >
            {detailOpen ? 'Hide details' : `+${summary.remainingCount} more`}
          </button>
        )}
      </div>

      {/* Inline detail accordion — only when there are hidden items */}
      {detailOpen && hasHiddenItems && (
        <div className="mt-2 ml-1 pl-3 border-l-2 border-lichen bg-stone rounded-r py-2 pr-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-archive">All changes in this field</span>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 text-xs text-bark hover:text-copper-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-1 rounded px-1.5 py-0.5"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy changes'}
            </button>
          </div>
          {removed.length > 0 && (
            <div className={added.length > 0 ? 'mb-2' : ''}>
              <div className="text-xs font-medium text-semantic-error/80 mb-1">Removed</div>
              <div className="flex flex-wrap gap-1 items-center">
                {removed.filter((item) => detailItemLabel(item, labelFn)).map((item, i) => (
                  <ValueChip key={`dr-${i}`} type="removed" label={detailItemLabel(item, labelFn)} />
                ))}
              </div>
            </div>
          )}
          {added.length > 0 && (
            <div>
              <div className="text-xs font-medium text-semantic-success/80 mb-1">Added</div>
              <div className="flex flex-wrap gap-1 items-center">
                {added.filter((item) => detailItemLabel(item, labelFn)).map((item, i) => (
                  <ValueChip key={`da-${i}`} type="added" label={detailItemLabel(item, labelFn)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
