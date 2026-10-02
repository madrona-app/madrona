import { useState } from 'react';
import { Edit2, Save, X } from 'lucide-react';

const EDITABLE_FIELDS = [
  { key: 'headline', label: 'Headline' },
  { key: 'caption', label: 'Caption' },
  { key: 'keywords', label: 'Keywords' },
  { key: 'copyright_notice', label: 'Copyright Notice' },
  { key: 'credit', label: 'Credit' },
  { key: 'source', label: 'Source' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State/Province' },
  { key: 'country', label: 'Country' },
  { key: 'category', label: 'Category' },
] as const;

const EDITABLE_KEYS = new Set<string>(EDITABLE_FIELDS.map(f => f.key));

interface IPTCEditorProps {
  iptcMetadata: Record<string, any> | null | undefined;
  onUpdate: (updates: Record<string, string | null>) => Promise<any>;
  isUpdating: boolean;
  readOnly?: boolean;
}

export default function IPTCEditor({ iptcMetadata, onUpdate, isUpdating, readOnly }: IPTCEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const startEditing = () => {
    const initial: Record<string, string> = {};
    for (const field of EDITABLE_FIELDS) {
      initial[field.key] = String((iptcMetadata || {})[field.key] || '');
    }
    setDraft(initial);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setDraft({});
  };

  const save = async () => {
    const updates: Record<string, string | null> = {};
    const current = iptcMetadata || {};

    for (const field of EDITABLE_FIELDS) {
      const newVal = draft[field.key]?.trim() || '';
      const oldVal = String(current[field.key] || '');
      if (newVal !== oldVal) {
        updates[field.key] = newVal || null;
      }
    }

    if (Object.keys(updates).length > 0) {
      await onUpdate(updates);
    }
    setEditing(false);
    setDraft({});
  };

  // Non-editable IPTC fields
  const readOnlyEntries = Object.entries(iptcMetadata || {}).filter(
    ([k]) => !EDITABLE_KEYS.has(k)
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-ink">IPTC Metadata</h3>
        {!readOnly && !editing && (
          <button
            onClick={startEditing}
            className="flex items-center gap-1.5 text-xs text-bark hover:text-copper-dark transition-colors"
          >
            <Edit2 size={12} />
            Edit
          </button>
        )}
        {editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={cancel}
              disabled={isUpdating}
              className="flex items-center gap-1 text-xs text-archive hover:text-ink transition-colors"
            >
              <X size={12} />
              Cancel
            </button>
            <button
              onClick={save}
              disabled={isUpdating}
              className="flex items-center gap-1 text-xs text-bark hover:text-copper-dark transition-colors"
            >
              <Save size={12} />
              {isUpdating ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>

      <div className="bg-stone/20 rounded-lg p-4 space-y-4">
        {/* Editable fields */}
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {EDITABLE_FIELDS.map((field) => {
            const value = editing
              ? (draft[field.key] || '')
              : String((iptcMetadata || {})[field.key] || '');

            return (
              <div key={field.key}>
                <dt className="text-archive text-xs mb-1">{field.label}</dt>
                <dd>
                  {!editing ? (
                    <span className="text-ink">{value || '—'}</span>
                  ) : (
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => setDraft(prev => ({ ...prev, [field.key]: e.target.value }))}
                      className="w-full bg-parchment/80 border border-stone rounded px-2 py-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    />
                  )}
                </dd>
              </div>
            );
          })}
        </dl>

        {/* Read-only IPTC fields */}
        {readOnlyEntries.length > 0 && (
          <>
            <div className="border-t border-stone pt-3">
              <p className="text-xs text-archive mb-2">Other IPTC Fields (read-only)</p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {readOnlyEntries.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-archive truncate">{k}</dt>
                    <dd className="text-ink font-medium truncate">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
