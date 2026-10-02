import { Plus, X } from 'lucide-react';

/**
 * Generic string list editor -- reusable for any string[] JSONB field.
 * Displays as comma-separated tags in view mode, individual inputs in edit mode.
 */
export function StringListField({
  label,
  items,
  isEditing,
  onChange,
  onSave,
  placeholder = 'Enter value...',
  emptyMessage,
}: {
  label: string;
  items: string[];
  isEditing: boolean;
  onChange: (items: string[]) => void;
  onSave: () => void;
  placeholder?: string;
  emptyMessage?: string;
}) {
  if (!isEditing) {
    if (!items || items.length === 0) return null;
    return (
      <div>
        <dt className="text-sm font-medium text-archive mb-1">{label}</dt>
        <dd className="flex flex-wrap gap-1.5">
          {items.map((item, i) => (
            <span key={i} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm bg-stone text-ink">
              {item}
            </span>
          ))}
        </dd>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-ink">{label}</label>
        <button
          type="button"
          onClick={() => onChange([...items, ''])}
          className="text-sm text-bark hover:text-copper-dark flex items-center gap-1"
        >
          <Plus size={14} />
          Add
        </button>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={item}
              onChange={(e) => {
                const updated = [...items];
                updated[i] = e.target.value;
                onChange(updated);
              }}
              onBlur={onSave}
              placeholder={placeholder}
              className="input flex-1"
            />
            <button
              type="button"
              onClick={() => {
                onChange(items.filter((_, idx) => idx !== i));
                onSave();
              }}
              className="p-1 text-archive hover:text-semantic-error"
            >
              <X size={16} />
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-sm text-archive italic">{emptyMessage || `No ${label.toLowerCase()} added`}</p>
        )}
      </div>
    </div>
  );
}
