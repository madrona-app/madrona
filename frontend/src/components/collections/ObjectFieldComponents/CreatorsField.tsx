import { Plus, X, CheckCircle } from 'lucide-react';
import { AuthorityAutocomplete, type AuthorityBackedValue } from '../AuthorityAutocomplete';
import type { Creator } from './types';

function creatorToAuthorityValue(creator: Creator): AuthorityBackedValue | null {
  if (!creator.name) return null;
  return {
    value: creator.name,
    role: creator.role || undefined,
    attribution: creator.role_qualifier || undefined,
    authorities: creator.ulan_id ? [{
      uri: `http://vocab.getty.edu/ulan/${creator.ulan_id}`,
      source: 'ULAN',
      label: creator.name,
    }] : undefined,
  };
}

function authorityValueToCreator(value: AuthorityBackedValue | null, existing: Creator): Creator {
  if (!value) return existing;
  return {
    ...existing,
    name: value.value,
    ulan_id: value.authorities?.[0]?.uri?.split('/').pop() || null,
    authority_id: (value as unknown as { metadata?: { authority_id?: string } }).metadata?.authority_id || existing.authority_id,
  };
}

export function CreatorsField({
  creators,
  isEditing,
  onChange,
  onAdd,
  onSave,
}: {
  creators: Creator[];
  isEditing: boolean;
  onChange: (creators: Creator[]) => void;
  onAdd: () => void;
  onSave: () => void;
}) {
  if (!isEditing) {
    if (creators.length === 0) return null;
    return (
      <div>
        <dt className="text-sm font-medium text-archive mb-1">Creator(s)</dt>
        <dd className="text-ink space-y-1">
          {creators.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="font-medium">{c.name}</span>
              {c.role && <span className="text-archive">({c.role})</span>}
              {c.role_qualifier && <span className="text-archive italic">{c.role_qualifier}</span>}
              {c.ulan_id && (
                <a
                  href={`http://vocab.getty.edu/ulan/${c.ulan_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-bark hover:text-copper-dark"
                  title="View in Getty ULAN"
                >
                  ULAN
                </a>
              )}
            </div>
          ))}
        </dd>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-ink">Creator(s)</label>
        <button type="button" onClick={onAdd} className="text-sm text-bark hover:text-copper-dark flex items-center gap-1">
          <Plus size={14} />
          Add creator
        </button>
      </div>
      <div className="space-y-3">
        {creators.map((c, i) => (
          <div key={i} className="p-3 border border-lichen rounded-lg space-y-2">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <AuthorityAutocomplete
                  fieldType="creator"
                  value={creatorToAuthorityValue(c)}
                  onChange={(value) => {
                    const updated = [...creators];
                    updated[i] = authorityValueToCreator(value, c);
                    onChange(updated);
                    onSave();
                  }}
                  placeholder="Search for artist or maker (ULAN)..."
                  showVerifiedBadge={true}
                  allowCreate={true}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  onChange(creators.filter((_, idx) => idx !== i));
                  onSave();
                }}
                className="p-1 text-archive hover:text-semantic-error mt-2"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={c.role || ''}
                onChange={(e) => {
                  const updated = [...creators];
                  updated[i] = { ...updated[i], role: e.target.value || null };
                  onChange(updated);
                  onSave();
                }}
                className="input text-sm"
              >
                <option value="">Role...</option>
                <option value="artist">Artist</option>
                <option value="maker">Maker</option>
                <option value="designer">Designer</option>
                <option value="architect">Architect</option>
                <option value="photographer">Photographer</option>
                <option value="sculptor">Sculptor</option>
                <option value="printmaker">Printmaker</option>
                <option value="workshop">Workshop</option>
                <option value="manufacturer">Manufacturer</option>
                <option value="other">Other</option>
              </select>
              <select
                value={c.role_qualifier || ''}
                onChange={(e) => {
                  const updated = [...creators];
                  updated[i] = { ...updated[i], role_qualifier: e.target.value || null };
                  onChange(updated);
                  onSave();
                }}
                className="input text-sm"
              >
                <option value="">Attribution...</option>
                <option value="attributed to">Attributed to</option>
                <option value="circle of">Circle of</option>
                <option value="follower of">Follower of</option>
                <option value="school of">School of</option>
                <option value="studio of">Studio of</option>
                <option value="workshop of">Workshop of</option>
                <option value="after">After</option>
                <option value="manner of">Manner of</option>
                <option value="copy after">Copy after</option>
              </select>
            </div>
            {c.ulan_id && (
              <div className="text-xs text-semantic-success flex items-center gap-1">
                <CheckCircle size={12} />
                Linked to Getty ULAN
              </div>
            )}
          </div>
        ))}
        {creators.length === 0 && (
          <div className="p-4 border border-dashed border-lichen rounded-lg text-center">
            <p className="text-sm text-archive mb-2">No creators added yet</p>
            <button
              type="button"
              onClick={onAdd}
              className="text-sm text-bark hover:text-copper-dark font-medium"
            >
              + Add a creator (search ULAN)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
