import { Plus, X } from 'lucide-react';

/**
 * Generic key-value list editor for simple JSONB arrays of {name, ...} objects.
 * Each item has a primary text field and optional secondary fields.
 */
export function NameListField({
  label,
  items,
  isEditing,
  onChange,
  onSave,
  nameKey = 'name',
  placeholder = 'Enter name...',
  emptyMessage,
  secondaryFields,
}: {
  label: string;
  items: Record<string, any>[];
  isEditing: boolean;
  onChange: (items: Record<string, any>[]) => void;
  onSave: () => void;
  nameKey?: string;
  placeholder?: string;
  emptyMessage?: string;
  secondaryFields?: { key: string; label: string; placeholder?: string }[];
}) {
  if (!isEditing) {
    if (!items || items.length === 0) return null;
    const isComplex = secondaryFields && secondaryFields.length > 1;
    return (
      <div>
        <dt className="text-sm font-medium text-archive mb-1">{label}</dt>
        {isComplex ? (
          <dd className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="text-sm border-l-2 border-lichen pl-3 py-1">
                {item[nameKey] && <span className="font-medium text-ink">{item[nameKey]}</span>}
                {secondaryFields?.map(f => item[f.key] ? (
                  <span key={f.key} className="text-archive ml-2">
                    {f.key === 'date_range' || f.key === 'dates' || f.key === 'year' ? `(${item[f.key]})` : item[f.key]}
                  </span>
                ) : null)}
              </div>
            ))}
          </dd>
        ) : (
          <dd className="flex flex-wrap gap-1.5">
            {items.map((item, i) => (
              <span key={i} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm bg-stone text-ink">
                {item[nameKey]}
                {secondaryFields?.map(f => item[f.key] ? ` (${item[f.key]})` : '').join('')}
              </span>
            ))}
          </dd>
        )}
      </div>
    );
  }

  const newItem: Record<string, any> = { [nameKey]: '' };
  if (secondaryFields) {
    for (const f of secondaryFields) {
      newItem[f.key] = '';
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-ink">{label}</label>
        <button
          type="button"
          onClick={() => onChange([...items, { ...newItem }])}
          className="text-sm text-bark hover:text-copper-dark flex items-center gap-1"
        >
          <Plus size={14} />
          Add
        </button>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className={secondaryFields && secondaryFields.length > 0
              ? `flex-1 grid gap-2 ${secondaryFields.length >= 3 ? 'grid-cols-2' : `grid-cols-${secondaryFields.length + 1}`}`
              : 'flex-1'}>
              <input
                type="text"
                value={item[nameKey] || ''}
                onChange={(e) => {
                  const updated = [...items];
                  updated[i] = { ...updated[i], [nameKey]: e.target.value };
                  onChange(updated);
                }}
                onBlur={onSave}
                placeholder={placeholder}
                className="input w-full"
              />
              {secondaryFields?.map(f => (
                <input
                  key={f.key}
                  type="text"
                  value={item[f.key] || ''}
                  onChange={(e) => {
                    const updated = [...items];
                    updated[i] = { ...updated[i], [f.key]: e.target.value };
                    onChange(updated);
                  }}
                  onBlur={onSave}
                  placeholder={f.placeholder || f.label}
                  className="input w-full"
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                onChange(items.filter((_, idx) => idx !== i));
                onSave();
              }}
              className="p-1 text-archive hover:text-semantic-error mt-1"
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
