import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, Check } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';
import { autocompleteCollections, getLocations } from '../../lib/api/collections';
import { searchMedia } from '../../lib/api/media';
import { searchConstituents } from '../../lib/api/constituents';
import { getAssignableUsers } from '../../lib/api/workspaces';
import { resolveRefs } from '../../lib/api/drafts';

/**
 * StudioEntityPicker — a compact inline search-and-pick field for an entity
 * reference (object · media · constituent · location · user). Used by the
 * Start-procedure form (object/media from-context params) and the drafts form
 * (any *_id reference), so a referenced field is a real picker showing the
 * entity's name — never a raw UUID. When a value is already set, its label is
 * resolved for display.
 */
interface Hit {
  id: string;
  label: string;
  sublabel?: string;
}

interface StudioEntityPickerProps {
  orgId: string;
  entityKind: string; // object | media | constituent | location | user
  value: string | undefined;
  onChange: (id: string | undefined, label?: string) => void;
  disabled?: boolean;
  id?: string;
}

// Kinds the backend resolve-refs endpoint can turn into a label.
const RESOLVABLE = new Set(['object', 'constituent', 'location', 'user']);

const _NOUN: Record<string, string> = {
  media: 'media', constituent: 'people / orgs', location: 'locations',
  user: 'people', object: 'objects',
};

async function searchEntities(orgId: string, kind: string, q: string): Promise<Hit[]> {
  switch (kind) {
    case 'media': {
      const res = await searchMedia(orgId, { q, limit: 8 });
      return res.hits.map((h) => ({
        id: h.media_id, label: h.title || h.filename,
        sublabel: h.title ? h.filename : undefined,
      }));
    }
    case 'constituent': {
      const res = await searchConstituents(orgId, { q, limit: 8 });
      return res.results
        .filter((c) => c.constituent_id || c.id)
        .map((c) => ({ id: (c.constituent_id || c.id) as string, label: c.label, sublabel: c.description }));
    }
    case 'location': {
      const res = await getLocations(orgId, { q });
      return (res.items ?? []).slice(0, 8).map((l) => {
        const path = (l as { path?: string }).path;
        return { id: l.location_id, label: path || l.name, sublabel: path ? l.name : undefined };
      });
    }
    case 'user': {
      const res = await getAssignableUsers(orgId);
      const ql = q.toLowerCase();
      return res.users
        .filter((u) => u.name.toLowerCase().includes(ql) || u.email.toLowerCase().includes(ql))
        .slice(0, 8)
        .map((u) => ({ id: u.user_id, label: u.name, sublabel: u.email }));
    }
    default: {
      const res = await autocompleteCollections(orgId, q, 'title', 8);
      return res.suggestions.map((s) => ({
        id: s.object_id, label: s.value || s.object_number || s.object_id,
        sublabel: s.object_number,
      }));
    }
  }
}

export function StudioEntityPicker({
  orgId,
  entityKind,
  value,
  onChange,
  disabled,
  id,
}: StudioEntityPickerProps) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Hit | null>(null);
  const debounced = useDebounce(query.trim(), 250);

  // If the value is cleared externally, drop the picked label too.
  useEffect(() => {
    if (!value) setPicked(null);
  }, [value]);

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ['studio-entity-pick', orgId, entityKind, debounced],
    queryFn: () => searchEntities(orgId, entityKind, debounced),
    enabled: !!orgId && !value && debounced.length >= 2,
  });

  // Resolve an already-set id to its label (so the chip shows a name, not a UUID).
  const { data: resolved } = useQuery({
    queryKey: ['studio-entity-resolve', orgId, entityKind, value],
    queryFn: () => resolveRefs(orgId, [{ kind: entityKind, id: value as string }]),
    enabled: !!orgId && !!value && !picked && RESOLVABLE.has(entityKind),
  });
  const resolvedLabel = value ? resolved?.labels?.[value] : undefined;

  if (value) {
    const label = picked?.label ?? resolvedLabel ?? value;
    return (
      <div className="flex items-center gap-2 rounded-md border border-lichen bg-parchment-warm px-3 py-2">
        <Check size={15} className="shrink-0 text-semantic-success" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          {label}
          {picked?.sublabel && <span className="ml-1.5 text-archive">{picked.sublabel}</span>}
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={() => { onChange(undefined); setPicked(null); setQuery(''); }}
            className="shrink-0 text-archive hover:text-ink"
            aria-label="Clear selection"
          >
            <X size={15} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-md border border-lichen bg-parchment-warm px-3 py-2 focus-within:ring-2 ring-bark/30 ring-offset-2">
        <Search size={15} className="shrink-0 text-archive" aria-hidden />
        <input
          id={id}
          type="text"
          value={query}
          disabled={disabled}
          placeholder={`Search ${_NOUN[entityKind] ?? 'records'}…`}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-archive"
          autoComplete="off"
        />
      </div>
      {debounced.length >= 2 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-lichen bg-parchment shadow-lg">
          {isFetching && <li className="px-3 py-2 text-sm text-archive">Searching…</li>}
          {!isFetching && hits.length === 0 && (
            <li className="px-3 py-2 text-sm text-archive">No matches.</li>
          )}
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => { onChange(h.id, h.label); setPicked(h); setQuery(''); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-stone/40 focus-visible:bg-stone/40 outline-none"
              >
                <span className="min-w-0 flex-1 truncate">{h.label}</span>
                {h.sublabel && <span className="shrink-0 text-xs text-archive">{h.sublabel}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default StudioEntityPicker;
