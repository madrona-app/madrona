import { Plus, X } from 'lucide-react';
import { AuthorityAutocomplete, type AuthorityBackedValue } from '../AuthorityAutocomplete';
import type { Material } from './types';

/**
 * Convert a Material to an AuthorityBackedValue for the autocomplete.
 */
function materialToAuthorityValue(material: Material): AuthorityBackedValue | null {
  if (!material.name) return null;
  return {
    value: material.name,
    part: material.part || undefined,
    authorities: material.vocabulary_term_id
      ? [{ uri: material.vocabulary_term_id, source: 'AAT' }]
      : undefined,
  };
}

/**
 * Convert an AuthorityBackedValue back to Material fields.
 */
function authorityValueToMaterial(
  value: AuthorityBackedValue | null,
  existing: Material
): Material {
  if (!value) {
    return { ...existing, name: '', vocabulary_term_id: null };
  }
  return {
    name: value.value,
    part: value.part || existing.part,
    vocabulary_term_id: value.authorities?.[0]?.uri || null,
  };
}

export function MaterialsField({
  materials,
  isEditing,
  onChange,
  onAdd,
  onSave,
}: {
  materials: Material[];
  isEditing: boolean;
  onChange: (materials: Material[]) => void;
  onAdd: () => void;
  onSave: () => void;
}) {
  if (!isEditing) {
    if (materials.length === 0) return null;
    return (
      <div>
        <dt className="text-sm font-medium text-archive mb-1">Materials</dt>
        <dd className="text-ink">
          {materials.map((m, i) => (
            <span key={i}>
              {i > 0 && ', '}
              {m.name}
              {m.part && <span className="text-archive"> ({m.part})</span>}
            </span>
          ))}
        </dd>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-ink">Materials</label>
        <button type="button" onClick={onAdd} className="text-sm text-bark hover:text-copper-dark flex items-center gap-1">
          <Plus size={14} />
          Add material
        </button>
      </div>
      <div className="space-y-2">
        {materials.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1">
              <AuthorityAutocomplete
                fieldType="material"
                value={materialToAuthorityValue(m)}
                onChange={(value) => {
                  const updated = [...materials];
                  updated[i] = authorityValueToMaterial(value, m);
                  onChange(updated);
                  onSave();
                }}
                placeholder="Material name (e.g., oil paint, canvas)"
                showVerifiedBadge={true}
                allowCreate={true}
              />
            </div>
            <input
              type="text"
              value={m.part || ''}
              onChange={(e) => {
                const updated = [...materials];
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
                onChange(materials.filter((_, idx) => idx !== i));
                onSave();
              }}
              className="p-1 text-archive hover:text-semantic-error"
            >
              <X size={16} />
            </button>
          </div>
        ))}
        {materials.length === 0 && (
          <p className="text-sm text-archive italic">No materials added</p>
        )}
      </div>
    </div>
  );
}
