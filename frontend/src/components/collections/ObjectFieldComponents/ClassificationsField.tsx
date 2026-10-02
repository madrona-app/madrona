import { Plus, X } from 'lucide-react';
import { AuthorityAutocomplete, type AuthorityBackedValue } from '../AuthorityAutocomplete';
import type { Classification } from './types';

/**
 * Convert a Classification to an AuthorityBackedValue for the autocomplete.
 */
function classificationToAuthorityValue(c: Classification): AuthorityBackedValue | null {
  if (!c.term) return null;
  return {
    value: c.term,
    isPrimary: c.is_primary,
    authorities: c.vocabulary_term_id
      ? [{ uri: c.vocabulary_term_id, source: c.classification_system === 'Nomenclature' ? 'Nomenclature' : 'AAT' }]
      : undefined,
  };
}

/**
 * Convert an AuthorityBackedValue back to Classification fields.
 */
function authorityValueToClassification(
  value: AuthorityBackedValue | null,
  existing: Classification,
): Classification {
  if (!value) {
    return { ...existing, term: '', vocabulary_term_id: null };
  }
  const ref = value.authorities?.[0];
  return {
    term: value.value,
    is_primary: value.isPrimary || existing.is_primary,
    classification_system: ref?.source === 'Nomenclature' ? 'Nomenclature' : ref?.source === 'AAT' ? 'AAT' : existing.classification_system,
    vocabulary_term_id: ref?.uri || null,
    value_key: existing.value_key,
  };
}

export function ClassificationsField({
  classifications,
  isEditing,
  onChange,
  onAdd,
  onSave,
  lookupOptions: _lookupOptions = [],
}: {
  classifications: Classification[];
  isEditing: boolean;
  onChange: (classifications: Classification[]) => void;
  onAdd: () => void;
  onSave: () => void;
  /** Legacy lookup options — no longer used (replaced by live authority search) */
  lookupOptions?: { value: string; label: string }[];
}) {
  if (!isEditing) {
    if (classifications.length === 0) return null;
    return (
      <div>
        <dt className="text-sm font-medium text-archive mb-2">Classifications</dt>
        <dd className="flex flex-wrap gap-2">
          {classifications.map((c, i) => (
            <span key={i} className="px-2 py-1 bg-stone/50 text-ink text-sm rounded">
              {c.term}
            </span>
          ))}
        </dd>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-ink">Classifications</label>
        <button
          type="button"
          onClick={onAdd}
          className="text-sm text-bark hover:text-copper-dark flex items-center gap-1"
        >
          <Plus size={14} />
          Add classification
        </button>
      </div>

      <div className="space-y-2">
        {classifications.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1">
              <AuthorityAutocomplete
                fieldType="classification"
                value={classificationToAuthorityValue(c)}
                onChange={(value) => {
                  const updated = [...classifications];
                  updated[i] = authorityValueToClassification(value, c);
                  onChange(updated);
                  onSave();
                }}
                placeholder="Search classifications (AAT, Nomenclature)..."
                showVerifiedBadge={true}
                allowCreate={true}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                onChange(classifications.filter((_, idx) => idx !== i));
                onSave();
              }}
              className="p-1 text-archive hover:text-semantic-error"
            >
              <X size={16} />
            </button>
          </div>
        ))}
        {classifications.length === 0 && (
          <p className="text-sm text-archive italic">No classifications — click "Add classification" to search AAT and Nomenclature</p>
        )}
      </div>
    </div>
  );
}
