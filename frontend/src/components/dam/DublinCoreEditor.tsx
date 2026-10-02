import { useState } from 'react';
import { Edit2, Save, X } from 'lucide-react';

interface DcField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  sync?: string;
  readOnly?: boolean;
  placeholder?: string;
}

const DC_FIELDS: DcField[] = [
  { key: 'dc_title', label: 'Title', sync: 'Title', type: 'text' },
  { key: 'dc_creator', label: 'Creator', sync: 'Creator', type: 'text' },
  { key: 'dc_subject', label: 'Subject', type: 'text' },
  { key: 'dc_description', label: 'Description', sync: 'Description', type: 'textarea' },
  { key: 'dc_publisher', label: 'Publisher', type: 'text' },
  { key: 'dc_contributor', label: 'Contributor', type: 'text' },
  { key: 'dc_date', label: 'Date', type: 'text', placeholder: 'YYYY-MM-DD' },
  { key: 'dc_type', label: 'Type', type: 'select' },
  { key: 'dc_format', label: 'Format', type: 'text', readOnly: true },
  { key: 'dc_identifier', label: 'Identifier', type: 'text' },
  { key: 'dc_source', label: 'Source', sync: 'Source', type: 'text' },
  { key: 'dc_language', label: 'Language', type: 'text', placeholder: 'e.g. en, fr' },
  { key: 'dc_relation', label: 'Relation', type: 'text' },
  { key: 'dc_coverage', label: 'Coverage', type: 'text' },
  { key: 'dc_rights', label: 'Rights', sync: 'Rights Statement', type: 'text' },
];

const DCMI_TYPES = [
  '', 'Collection', 'Dataset', 'Event', 'Image', 'InteractiveResource',
  'MovingImage', 'PhysicalObject', 'Service', 'Software', 'Sound',
  'StillImage', 'Text',
];

interface DublinCoreEditorProps {
  dublinCore: Record<string, string> | null | undefined;
  onUpdate: (updates: Record<string, string | null>) => Promise<any>;
  isUpdating: boolean;
  readOnly?: boolean;
}

export default function DublinCoreEditor({ dublinCore, onUpdate, isUpdating, readOnly }: DublinCoreEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const startEditing = () => {
    setDraft({ ...(dublinCore || {}) });
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setDraft({});
  };

  const save = async () => {
    const updates: Record<string, string | null> = {};
    const current = dublinCore || {};

    for (const field of DC_FIELDS) {
      if (field.readOnly) continue;
      const newVal = draft[field.key]?.trim() || '';
      const oldVal = current[field.key] || '';
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

  const getValue = (key: string) => {
    if (editing) return draft[key] || '';
    return (dublinCore || {})[key] || '';
  };

  const setField = (key: string, value: string) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-ink flex items-center gap-2">
          Dublin Core (ISO 15836)
        </h3>
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

      <div className="bg-stone/20 rounded-lg p-4">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {DC_FIELDS.map((field) => (
            <div key={field.key} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
              <dt className="text-archive text-xs mb-1">
                {field.label}
                {field.sync && (
                  <span className="text-archive/60 ml-1">(syncs to {field.sync})</span>
                )}
              </dt>
              <dd>
                {!editing || field.readOnly ? (
                  <span className="text-ink">{getValue(field.key) || '—'}</span>
                ) : field.type === 'select' ? (
                  <select
                    value={getValue(field.key)}
                    onChange={(e) => setField(field.key, e.target.value)}
                    className="w-full bg-parchment/80 border border-stone rounded px-2 py-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  >
                    {DCMI_TYPES.map((t) => (
                      <option key={t} value={t}>{t || '(none)'}</option>
                    ))}
                  </select>
                ) : field.type === 'textarea' ? (
                  <textarea
                    value={getValue(field.key)}
                    onChange={(e) => setField(field.key, e.target.value)}
                    rows={2}
                    placeholder={field.placeholder}
                    className="w-full bg-parchment/80 border border-stone rounded px-2 py-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 resize-y"
                  />
                ) : (
                  <input
                    type="text"
                    value={getValue(field.key)}
                    onChange={(e) => setField(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full bg-parchment/80 border border-stone rounded px-2 py-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  />
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
