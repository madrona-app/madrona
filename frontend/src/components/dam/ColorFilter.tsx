/**
 * ColorFilter — visual color palette filter for search sidebar.
 * Shows color swatches users can click to filter by dominant color.
 */

interface ColorFilterProps {
  selectedColor: string | null;
  onColorSelect: (color: string | null) => void;
}

const COLOR_BUCKETS = [
  { key: 'r', name: 'Red', hex: '#ef4444' },
  { key: 'o', name: 'Orange', hex: 'rgb(var(--color-warning))' },
  { key: 'y', name: 'Yellow', hex: '#eab308' },
  { key: 'g', name: 'Green', hex: 'rgb(var(--color-success))' },
  { key: 't', name: 'Teal', hex: '#14b8a6' },
  { key: 'b', name: 'Blue', hex: '#3b82f6' },
  { key: 'p', name: 'Purple', hex: '#a855f7' },
  { key: 'i', name: 'Pink', hex: '#ec4899' },
  { key: 'n', name: 'Brown', hex: 'rgb(var(--color-warning))' },
  { key: 'k', name: 'Black', hex: '#171717' },
  { key: 'a', name: 'Gray', hex: 'rgb(var(--color-archive))' },
  { key: 'w', name: 'White', hex: 'rgb(var(--color-parchment-warm))' },
];

export function ColorFilter({ selectedColor, onColorSelect }: ColorFilterProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-archive uppercase tracking-wider">
        Dominant Color
      </h4>
      <div className="flex flex-wrap gap-1.5">
        {COLOR_BUCKETS.map((color) => (
          <button
            key={color.key}
            onClick={() =>
              onColorSelect(selectedColor === color.key ? null : color.key)
            }
            className={`w-7 h-7 rounded-full border-2 transition-all ${
              selectedColor === color.key
                ? 'border-bark ring-2 ring-bark/30 scale-110'
                : 'border-lichen hover:border-archive hover:scale-105'
            }`}
            style={{ backgroundColor: color.hex }}
            title={color.name}
          />
        ))}
      </div>
      {selectedColor && (
        <button
          onClick={() => onColorSelect(null)}
          className="text-xs text-archive hover:text-ink transition-colors"
        >
          Clear color filter ({COLOR_BUCKETS.find(c => c.key === selectedColor)?.name})
        </button>
      )}
    </div>
  );
}
