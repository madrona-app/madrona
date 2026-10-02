import { Plus, X } from 'lucide-react';
import { AuthorityAutocomplete, type AuthorityBackedValue } from '../AuthorityAutocomplete';
import type { Subject } from './types';

/**
 * Convert a Subject to an AuthorityBackedValue for the autocomplete.
 */
function subjectToAuthorityValue(subject: Subject): AuthorityBackedValue | null {
  if (!subject.term) return null;
  return {
    value: subject.term,
    subjectType: subject.type || undefined,
    authorities: subject.vocabulary_term_id
      ? [{ uri: subject.vocabulary_term_id, source: 'AAT' }]
      : undefined,
  };
}

/**
 * Convert an AuthorityBackedValue back to Subject fields.
 */
function authorityValueToSubject(
  value: AuthorityBackedValue | null,
  existing: Subject
): Subject {
  if (!value) {
    return { ...existing, term: '', vocabulary_term_id: null };
  }
  return {
    term: value.value,
    type: value.subjectType || existing.type,
    vocabulary_term_id: value.authorities?.[0]?.uri || null,
  };
}

export function SubjectsField({
  subjects,
  isEditing,
  onChange,
  onAdd,
  onSave,
}: {
  subjects: Subject[];
  isEditing: boolean;
  onChange: (subjects: Subject[]) => void;
  onAdd: () => void;
  onSave: () => void;
}) {
  if (!isEditing) {
    if (subjects.length === 0) return null;
    return (
      <div>
        <dt className="text-sm font-medium text-archive mb-1">Subjects</dt>
        <dd className="flex flex-wrap gap-2">
          {subjects.map((s, i) => (
            <span key={i} className="px-2 py-1 bg-stone/50 text-ink text-sm rounded">
              {s.term}
              {s.type && <span className="text-archive ml-1">({s.type})</span>}
            </span>
          ))}
        </dd>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-ink">Subjects</label>
        <button type="button" onClick={onAdd} className="text-sm text-bark hover:text-copper-dark flex items-center gap-1">
          <Plus size={14} />
          Add subject
        </button>
      </div>
      <div className="space-y-2">
        {subjects.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1">
              <AuthorityAutocomplete
                fieldType="subject"
                value={subjectToAuthorityValue(s)}
                onChange={(value) => {
                  const updated = [...subjects];
                  updated[i] = authorityValueToSubject(value, s);
                  onChange(updated);
                  onSave();
                }}
                placeholder="Subject term (e.g., landscape, portrait)"
                showVerifiedBadge={true}
                allowCreate={true}
              />
            </div>
            <select
              value={s.type || ''}
              onChange={(e) => {
                const updated = [...subjects];
                updated[i] = { ...updated[i], type: e.target.value || null };
                onChange(updated);
                onSave();
              }}
              className="input w-32"
            >
              <option value="">Type...</option>
              <option value="topic">Topic</option>
              <option value="person">Person</option>
              <option value="place">Place</option>
              <option value="event">Event</option>
              <option value="concept">Concept</option>
            </select>
            <button
              type="button"
              onClick={() => {
                onChange(subjects.filter((_, idx) => idx !== i));
                onSave();
              }}
              className="p-1 text-archive hover:text-semantic-error"
            >
              <X size={16} />
            </button>
          </div>
        ))}
        {subjects.length === 0 && (
          <p className="text-sm text-archive italic">No subjects added</p>
        )}
      </div>
    </div>
  );
}
