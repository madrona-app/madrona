import { Plus, X } from 'lucide-react';

export function InscriptionsField({
  inscriptions,
  isEditing,
  onChange,
  onAdd,
  onSave,
}: {
  inscriptions: string[];
  isEditing: boolean;
  onChange: (inscriptions: string[]) => void;
  onAdd: () => void;
  onSave: () => void;
}) {
  if (!isEditing) {
    if (inscriptions.length === 0) return null;
    return (
      <div>
        <dt className="text-sm font-medium text-archive mb-1">Inscriptions</dt>
        <dd className="text-ink space-y-1">
          {inscriptions.map((text, i) => (
            <p key={i} className="italic">&ldquo;{text}&rdquo;</p>
          ))}
        </dd>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-ink">Inscriptions</label>
        <button type="button" onClick={onAdd} className="text-sm text-bark hover:text-copper-dark flex items-center gap-1">
          <Plus size={14} />
          Add inscription
        </button>
      </div>
      <div className="space-y-2">
        {inscriptions.map((text, i) => (
          <div key={i} className="flex items-start gap-2">
            <textarea
              value={text}
              onChange={(e) => {
                const updated = [...inscriptions];
                updated[i] = e.target.value;
                onChange(updated);
              }}
              onBlur={onSave}
              placeholder="Inscription text..."
              rows={2}
              className="input flex-1"
            />
            <button
              type="button"
              onClick={() => {
                onChange(inscriptions.filter((_, idx) => idx !== i));
                onSave();
              }}
              className="p-1 text-archive hover:text-semantic-error mt-1"
            >
              <X size={16} />
            </button>
          </div>
        ))}
        {inscriptions.length === 0 && (
          <p className="text-sm text-archive italic">No inscriptions recorded</p>
        )}
      </div>
    </div>
  );
}
