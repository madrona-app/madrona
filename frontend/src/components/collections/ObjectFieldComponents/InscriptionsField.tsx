import { useId } from 'react';
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
  const groupLabelId = useId();
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
    <div role="group" aria-labelledby={groupLabelId}>
      <div className="flex items-center justify-between mb-2">
        <span id={groupLabelId} className="text-sm font-medium text-ink">Inscriptions</span>
        <button type="button" onClick={onAdd} className="text-sm text-bark hover:text-copper-dark flex items-center gap-1">
          <Plus size={14} aria-hidden="true" />
          Add inscription
        </button>
      </div>
      <div className="space-y-2">
        {inscriptions.map((text, i) => (
          <div key={i} className="flex items-start gap-2">
            <textarea
              aria-label={`Inscription ${i + 1}`}
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
              aria-label={`Remove inscription ${i + 1}`}
              className="p-1 rounded text-archive hover:text-semantic-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 mt-1"
            >
              <X size={16} aria-hidden="true" />
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
