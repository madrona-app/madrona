import { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';

export interface ExternalLinkValue {
  url: string;
  label: string;
  link_type?: string;
}

const LINK_TYPES: { value: string; label: string }[] = [
  { value: 'wikipedia', label: 'Wikipedia' },
  { value: 'wikidata', label: 'Wikidata' },
  { value: 'authority', label: 'Authority record' },
  { value: 'finding_aid', label: 'Finding aid' },
  { value: 'catalog', label: 'Library catalog' },
  { value: 'website', label: 'Website' },
  { value: 'other', label: 'Other' },
];

/** Same rule the API enforces: absolute http(s) URLs only. */
export function isValidExternalUrl(url: string): boolean {
  if (!url.trim()) return true; // blank rows are dropped on save
  try {
    const parsed = new URL(url.trim());
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.host;
  } catch {
    return false;
  }
}

const inputClass =
  'w-full px-3 py-1.5 text-sm border border-lichen rounded-lg bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark aria-[invalid=true]:border-semantic-error';

interface ExternalLinksFieldProps {
  links: ExternalLinkValue[];
  isEditing: boolean;
  onChange: (links: ExternalLinkValue[]) => void;
  /** Called when a field loses focus or a row is removed, to persist. */
  onSave: () => void;
}

/**
 * External links (e.g. a Wikipedia page) for a record.
 *
 * Built for keyboard and screen reader use: the rows sit in a fieldset with a
 * legend, every input has a visible label naming its row, the remove buttons
 * say which link they remove, adding a row moves focus to its address field,
 * and removing one returns focus to the Add button. A polite live region
 * confirms adds and removals.
 */
export function ExternalLinksField({ links, isEditing, onChange, onSave }: ExternalLinksFieldProps) {
  const baseId = useId();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const urlRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [saveAfterChange, setSaveAfterChange] = useState(false);

  // A removal is saved once the parent has applied it (the new `links`
  // arrive), not synchronously, so the save never sends the stale list.
  useEffect(() => {
    if (saveAfterChange) {
      setSaveAfterChange(false);
      onSave();
    }
  }, [saveAfterChange, links, onSave]);

  useEffect(() => {
    if (focusIndex !== null) {
      urlRefs.current[focusIndex]?.focus();
      setFocusIndex(null);
    }
  }, [focusIndex, links.length]);

  if (!isEditing) {
    const shown = links.filter((l) => l.url);
    return (
      <div>
        <h3 className="text-sm font-medium text-archive">External links</h3>
        {shown.length === 0 ? (
          <p className="mt-1 text-sm text-archive italic">None</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {shown.map((link, i) => (
              <li key={`${link.url}-${i}`}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-bark hover:text-copper-dark underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 rounded"
                >
                  {link.label || link.url}
                  <ExternalLink size={12} aria-hidden="true" />
                  <span className="sr-only">, opens in a new tab</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const update = (index: number, patch: Partial<ExternalLinkValue>) => {
    onChange(links.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const addRow = () => {
    onChange([...links, { url: '', label: '', link_type: 'other' }]);
    setFocusIndex(links.length);
    setAnnouncement(`Link ${links.length + 1} added`);
  };

  const removeRow = (index: number) => {
    const name = links[index]?.label || links[index]?.url || `link ${index + 1}`;
    onChange(links.filter((_, i) => i !== index));
    setAnnouncement(`Removed ${name}`);
    addButtonRef.current?.focus();
    setSaveAfterChange(true);
  };

  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink mb-2">External links</legend>
      <p id={`${baseId}-help`} className="text-xs text-accessible-gray mb-3">
        Web pages about this object, such as a Wikipedia article. Addresses must start with https:// or http://.
      </p>
      <div className="space-y-4">
        {links.map((link, i) => {
          const n = i + 1;
          const urlId = `${baseId}-url-${i}`;
          const labelId = `${baseId}-label-${i}`;
          const typeId = `${baseId}-type-${i}`;
          const errorId = `${baseId}-error-${i}`;
          const invalid = !isValidExternalUrl(link.url);
          return (
            <div key={i} role="group" aria-label={`Link ${n}`} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
              <div className="sm:col-span-5">
                <label htmlFor={urlId} className="block text-xs font-medium text-archive mb-1">
                  Link {n} web address
                </label>
                <input
                  ref={(el) => { urlRefs.current[i] = el; }}
                  id={urlId}
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  value={link.url}
                  onChange={(e) => update(i, { url: e.target.value })}
                  onBlur={() => { if (!invalid) onSave(); }}
                  aria-invalid={invalid}
                  aria-describedby={invalid ? `${errorId} ${baseId}-help` : `${baseId}-help`}
                  placeholder="https://en.wikipedia.org/wiki/…"
                  className={inputClass}
                />
                {invalid && (
                  <p id={errorId} className="mt-1 text-xs text-semantic-error">
                    Enter a full web address starting with https:// or http://
                  </p>
                )}
              </div>
              <div className="sm:col-span-4">
                <label htmlFor={labelId} className="block text-xs font-medium text-archive mb-1">
                  Link {n} label
                </label>
                <input
                  id={labelId}
                  type="text"
                  value={link.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  onBlur={() => { if (!invalid) onSave(); }}
                  placeholder="Wikipedia"
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor={typeId} className="block text-xs font-medium text-archive mb-1">
                  Link {n} type
                </label>
                <select
                  id={typeId}
                  value={link.link_type || 'other'}
                  onChange={(e) => update(i, { link_type: e.target.value })}
                  onBlur={() => { if (!invalid) onSave(); }}
                  className={inputClass}
                >
                  {LINK_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-1 sm:pt-5">
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  aria-label={`Remove link ${n}${link.label ? `, ${link.label}` : ''}`}
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-archive hover:text-semantic-error hover:bg-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <button
        ref={addButtonRef}
        type="button"
        onClick={addRow}
        className="mt-3 inline-flex items-center gap-1 text-sm text-bark hover:text-copper-dark rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
      >
        <Plus size={14} aria-hidden="true" />
        Add external link
      </button>
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
    </fieldset>
  );
}
