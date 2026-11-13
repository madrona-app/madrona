import { useId, useRef, useState, type ReactNode } from 'react';
import { Search, Loader2 } from 'lucide-react';

const inputClass =
  'w-full px-3 py-2 border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark';

interface RecordSearchProps<T> {
  /** Visible label for the search field, e.g. "Find an object by number or name". */
  label: string;
  /** Short noun for result announcements: "object" -> "3 objects found". */
  noun: string;
  search: (term: string) => Promise<T[]>;
  getId: (item: T) => string;
  /** Text shown for a result. */
  renderItem: (item: T) => ReactNode;
  /** Accessible name of a result's pick button, e.g. "Add RV.1, Braille slate". */
  pickLabel: (item: T) => string;
  /** Visible text of a result's pick button. */
  pickText: string;
  onPick: (item: T) => Promise<void> | void;
  /** Ids to leave out of the results (already linked). */
  excludeIds?: Set<string>;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

/**
 * A search box with an explicit Search button and a plain list of results,
 * each with its own button. Deliberately not a combobox: nothing happens
 * until the user submits, results are an ordinary list a screen reader can
 * browse, and the result count is announced in a polite live region.
 */
export function RecordSearch<T>({
  label,
  noun,
  search,
  getId,
  renderItem,
  pickLabel,
  pickText,
  onPick,
  excludeIds,
  inputRef,
}: RecordSearchProps<T>) {
  const id = useId();
  const inputId = `${id}-input`;
  const resultsId = `${id}-results`;
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<T[] | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickingId, setPickingId] = useState<string | null>(null);

  const visible = (results ?? []).filter((r) => !excludeIds?.has(getId(r)));

  const runSearch = async () => {
    const q = term.trim();
    if (!q) {
      setResults(null);
      setStatus('Enter text to search.');
      ref.current?.focus();
      return;
    }
    setBusy(true);
    setStatus('Searching…');
    try {
      const found = await search(q);
      setResults(found);
      const n = found.filter((r) => !excludeIds?.has(getId(r))).length;
      setStatus(n === 0 ? `No ${noun}s found for “${q}”.` : `${n} ${noun}${n === 1 ? '' : 's'} found.`);
    } catch (err) {
      setResults(null);
      setStatus(`Search failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handlePick = async (item: T) => {
    setPickingId(getId(item));
    try {
      await onPick(item);
      setResults((prev) => prev?.filter((r) => getId(r) !== getId(item)) ?? null);
    } catch {
      // onPick reports its own error; keep the result so it can be retried.
    } finally {
      setPickingId(null);
    }
  };

  return (
    // A div with role="search", not a nested <form>: this sits inside the
    // visit form, and the Search button submits only this search.
    <div role="search" aria-label={label}>
      <label htmlFor={inputId} className="block text-sm font-medium text-ink mb-1">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          ref={ref}
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            // Enter searches here instead of submitting the surrounding form.
            if (e.key === 'Enter') {
              e.preventDefault();
              void runSearch();
            }
          }}
          aria-describedby={`${id}-status`}
          className={inputClass}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={busy}
          aria-label={`Search ${noun}s`}
          className="btn btn-secondary inline-flex items-center gap-2 min-h-[44px] shrink-0 focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        >
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
          Search
        </button>
      </div>
      <p id={`${id}-status`} role="status" aria-live="polite" className="text-sm text-archive mt-1 min-h-[1.25rem]">
        {status}
      </p>
      {visible.length > 0 && (
        <ul id={resultsId} aria-label={`Search results for ${noun}s`} className="mt-2 border border-lichen rounded-lg divide-y divide-lichen">
          {visible.map((item) => (
            <li key={getId(item)} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0 text-sm text-ink">{renderItem(item)}</div>
              <button
                type="button"
                onClick={() => void handlePick(item)}
                disabled={pickingId !== null}
                aria-label={pickLabel(item)}
                className="btn btn-tertiary min-h-[44px] shrink-0 focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              >
                {pickingId === getId(item) ? `${pickText}ing…` : pickText}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
