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
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-ink">Titles</label>
        <button
          type="button"
          onClick={onAdd}
          className="text-sm text-bark hover:text-copper-dark flex items-center gap-1"
        >
          <Plus size={14} />
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
              />
              <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  type="text"
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
                className="p-1 text-archive hover:text-semantic-error"
              >
                <X size={16} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
