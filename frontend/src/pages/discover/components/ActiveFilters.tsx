import { X } from 'lucide-react';
import type { DiscoverSearchParams } from '../../../types/discover';

interface ActiveFiltersProps {
  params: DiscoverSearchParams;
  onRemove: (key: string, value?: string) => void;
  onClearAll: () => void;
}

export function ActiveFilters({ params, onRemove, onClearAll }: ActiveFiltersProps) {
  const pills: Array<{ label: string; onRemove: () => void }> = [];

  if (params.object_type) {
    params.object_type.forEach((v) =>
      pills.push({ label: `Type: ${v}`, onRemove: () => onRemove('object_type', v) })
    );
  }
  if (params.classification) {
    params.classification.forEach((v) =>
      pills.push({ label: `Classification: ${v}`, onRemove: () => onRemove('classification', v) })
    );
  }
  if (params.creator) pills.push({ label: `Maker: ${params.creator}`, onRemove: () => onRemove('creator') });
  if (params.material) pills.push({ label: `Material: ${params.material}`, onRemove: () => onRemove('material') });
  if (params.technique) pills.push({ label: `Technique: ${params.technique}`, onRemove: () => onRemove('technique') });
  if (params.subject) pills.push({ label: `Subject: ${params.subject}`, onRemove: () => onRemove('subject') });
  if (params.style_period) {
    params.style_period.forEach((v) =>
      pills.push({ label: `Period: ${v}`, onRemove: () => onRemove('style_period', v) })
    );
  }
  if (params.creation_place) pills.push({ label: `Place: ${params.creation_place}`, onRemove: () => onRemove('creation_place') });
  if (params.has_image) pills.push({ label: 'With image', onRemove: () => onRemove('has_image') });
  if (params.date_from) pills.push({ label: `From: ${params.date_from}`, onRemove: () => onRemove('date_from') });
  if (params.date_to) pills.push({ label: `To: ${params.date_to}`, onRemove: () => onRemove('date_to') });
  if (params.on_display) pills.push({ label: 'On Display', onRemove: () => onRemove('on_display') });

  if (pills.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {pills.map((pill, i) => (
        <button
          key={i}
          onClick={pill.onRemove}
          aria-label={`Remove ${pill.label} filter`}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-bark/10 text-bark text-xs rounded-full hover:bg-bark/20 transition-colors"
        >
          {pill.label}
          <X size={12} />
        </button>
      ))}
      <button
        onClick={onClearAll}
        aria-label="Clear all filters"
        className="text-xs text-archive hover:text-ink underline px-2 py-1.5"
      >
        Clear all
      </button>
    </div>
  );
}
