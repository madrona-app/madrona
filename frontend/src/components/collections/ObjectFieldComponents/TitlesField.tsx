import { useId } from 'react';
import { Plus, X } from 'lucide-react';
import type { Title } from './types';

export function TitlesField({
  titles,
  isEditing,
  onChange,
  onAdd,
  onSave,
}: {
  titles: Title[];
  isEditing: boolean;
  onChange: (titles: Title[]) => void;
  onAdd: () => void;
  onSave: () => void;
}) {
  const groupLabelId = useId();
  if (!isEditing) {
    if (titles.length === 0) return null;
    return (
      <div>
        <dt className="text-sm font-medium text-archive mb-2">Titles</dt>
        <dd>
          <div className="border border-lichen rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone/30">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-ink">Title</th>
                  <th className="text-left px-3 py-2 font-medium text-ink w-32">Type</th>
                  <th className="text-left px-3 py-2 font-medium text-ink w-28">Language</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lichen">
                {titles.map((t, i) => (
                  <tr key={i} className={t.is_preferred ? 'bg-bark/5' : 'bg-parchment'}>
                    <td className="px-3 py-2 text-ink">
                      {t.title}
                      {t.is_preferred && <span className="ml-2 text-xs text-bark">(display)</span>}
                    </td>
                    <td className="px-3 py-2 text-archive">{t.title_type || '—'}</td>
                    <td className="px-3 py-2 text-archive">{t.language || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </dd>
      </div>
    );
  }

  return (
    <div role="group" aria-labelledby={groupLabelId}>
      <div className="flex items-center justify-between mb-2">
        <span id={groupLabelId} className="text-sm font-medium text-ink">Titles</span>
        <button
          type="button"
          onClick={onAdd}
          className="text-sm text-bark hover:text-copper-dark flex items-center gap-1"
        >
          <Plus size={14} aria-hidden="true" />
          Add title
        </button>
      </div>
      <div className="space-y-2">
        {titles.length === 0 ? (
          <p className="text-sm text-archive italic">No titles added yet</p>
        ) : (
          titles.map((t, i) => (
            <div key={i} className="flex items-start gap-2 p-3 bg-stone/30 rounded-lg">
              <input
                type="radio"
                name="preferred_title"
                checked={t.is_preferred}
                onChange={() => {
                  const updated = titles.map((title, idx) => ({
                    ...title,
                    is_preferred: idx === i,
                  }));
                  onChange(updated);
                  onSave();
                }}
                className="mt-2"
                title="Set as display title"
                aria-label={`Display title: title ${i + 1}${t.title ? `, ${t.title}` : ''}`}
              />
              <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  type="text"
                  aria-label={`Title ${i + 1} text`}
                  value={t.title}
                  onChange={(e) => {
                    const updated = [...titles];
                    updated[i] = { ...updated[i], title: e.target.value };
                    onChange(updated);
                  }}
                  onBlur={onSave}
                  placeholder="Title text"
                  className="input md:col-span-1"
                />
                <select
                  aria-label={`Title ${i + 1} type`}
                  value={t.title_type || ''}
                  onChange={(e) => {
                    const updated = [...titles];
                    updated[i] = { ...updated[i], title_type: e.target.value || null };
                    onChange(updated);
                    onSave();
                  }}
                  className="input"
                >
                  <option value="">Type...</option>
                  <option value="preferred">Preferred</option>
                  <option value="descriptive">Descriptive</option>
                  <option value="former">Former</option>
                  <option value="alternate">Alternate</option>
                </select>
                <select
                  aria-label={`Title ${i + 1} language`}
                  value={t.language || ''}
                  onChange={(e) => {
                    const updated = [...titles];
                    updated[i] = { ...updated[i], language: e.target.value || null };
                    onChange(updated);
                    onSave();
                  }}
                  className="input"
                >
                  <option value="">Language...</option>
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => {
                  onChange(titles.filter((_, idx) => idx !== i));
                  onSave();
                }}
                aria-label={`Remove title ${i + 1}${t.title ? `, ${t.title}` : ''}`}
                className="p-1 rounded text-archive hover:text-semantic-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
