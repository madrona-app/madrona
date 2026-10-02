import { Plus, X } from 'lucide-react';
import { AuthorityAutocomplete, type AuthorityBackedValue } from '../AuthorityAutocomplete';
import type { Technique } from './types';

/**
 * Convert a Technique to an AuthorityBackedValue for the autocomplete.
 */
function techniqueToAuthorityValue(technique: Technique): AuthorityBackedValue | null {
  if (!technique.name) return null;
  return {
    value: technique.name,
    part: technique.part || undefined,
    authorities: technique.vocabulary_term_id
      ? [{ uri: technique.vocabulary_term_id, source: 'AAT' }]
      : undefined,
  };
}

/**
 * Convert an AuthorityBackedValue back to Technique fields.
 */
function authorityValueToTechnique(
  value: AuthorityBackedValue | null,
  existing: Technique
): Technique {
  if (!value) {
    return { ...existing, name: '', vocabulary_term_id: null };
  }
  return {
    name: value.value,
    part: value.part || existing.part,
    vocabulary_term_id: value.authorities?.[0]?.uri || null,
  };
}

export function TechniquesField({
  techniques,
  isEditing,
  onChange,
  onAdd,
  onSave,
}: {
  techniques: Technique[];
  isEditing: boolean;
  onChange: (techniques: Technique[]) => void;
  onAdd: () => void;
  onSave: () => void;
}) {
  if (!isEditing) {
    if (techniques.length === 0) return null;
    return (
      <div>
        <dt className="text-sm font-medium text-archive mb-1">Techniques</dt>
        <dd className="text-ink">
          {techniques.map((t, i) => (
            <span key={i}>
              {i > 0 && ', '}
              {t.name}
              {t.part && <span className="text-archive"> ({t.part})</span>}
            </span>
          ))}
        </dd>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-ink">Techniques</label>
        <button type="button" onClick={onAdd} className="text-sm text-bark hover:text-copper-dark flex items-center gap-1">
          <Plus size={14} />
          Add technique
        </button>
      </div>
      <div className="space-y-2">
        {techniques.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1">
              <AuthorityAutocomplete
                fieldType="technique"
                value={techniqueToAuthorityValue(t)}
                onChange={(value) => {
                  const updated = [...techniques];
                  updated[i] = authorityValueToTechnique(value, t);
                  onChange(updated);
                  onSave();
                }}
                placeholder="Technique name (e.g., impasto, etching)"
                showVerifiedBadge={true}
                allowCreate={true}
              />
            </div>
            <input
              type="text"
              value={t.part || ''}
              onChange={(e) => {
                const updated = [...techniques];
                updated[i] = { ...updated[i], part: e.target.value || null };
                onChange(updated);
              }}
              onBlur={onSave}
              placeholder="Part (optional)"
              className="input w-32"
            />
            <button
              type="button"
              onClick={() => {
                onChange(techniques.filter((_, idx) => idx !== i));
                onSave();
              }}
              className="p-1 text-archive hover:text-semantic-error"
            >
              <X size={16} />
            </button>
          </div>
        ))}
        {techniques.length === 0 && (
          <p className="text-sm text-archive italic">No techniques added</p>
        )}
      </div>
    </div>
  );
}
