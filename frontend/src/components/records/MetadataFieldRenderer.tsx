import type { MetadataFieldDef } from './types';

interface MetadataFieldRendererProps {
  fields: MetadataFieldDef[];
  values: Record<string, any>;
  onChange: (key: string, value: any) => void;
}

export function MetadataFieldRenderer({
  fields,
  values,
  onChange,
}: MetadataFieldRendererProps) {
  return (
    <>
      {fields.map((field) => (
        <div key={field.key}>
          <label className="block text-sm font-medium text-ink mb-1.5">
            {field.label}
            {field.required && <span className="text-semantic-error"> *</span>}
          </label>

          {field.type === 'text' && (
            <input
              type="text"
              value={values[field.key] ?? field.defaultValue ?? ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          )}

          {field.type === 'textarea' && (
            <textarea
              value={values[field.key] ?? field.defaultValue ?? ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              rows={2}
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
            />
          )}

          {field.type === 'select' && field.options && (
            <select
              value={values[field.key] ?? field.defaultValue ?? ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              {field.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}

          {field.type === 'radio-cards' && field.options && (
            <div className="space-y-2">
              {field.options.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                    (values[field.key] ?? field.defaultValue) === opt.value
                      ? 'border-bark bg-bark/5'
                      : 'border-lichen hover:border-bark/30'
                  }`}
                >
                  <input
                    type="radio"
                    name={field.key}
                    value={opt.value}
                    checked={(values[field.key] ?? field.defaultValue) === opt.value}
                    onChange={(e) => onChange(field.key, e.target.value)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-ink">{opt.label}</p>
                    {opt.description && (
                      <p className="text-xs text-archive">{opt.description}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          {field.helpText && (
            <p className="text-xs text-archive mt-1">{field.helpText}</p>
          )}
        </div>
      ))}
    </>
  );
}
