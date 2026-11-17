import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Library, Plus } from 'lucide-react';
import { getBibRecords, RECORD_TYPES, recordTypeLabel, type BibRecord } from '../../lib/api/library';
import { formatNumber } from '@/lib/formatters';
import { usePermissions } from '../../hooks/usePermissions';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const LIMIT = 25;
const focusRing = 'focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';
const fieldClass =
  'w-full px-3 py-2 border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark';

function plural(n: number, one: string, many: string) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

function imprint(r: BibRecord): string | null {
  const parts = [r.place, r.publisher, r.date_display].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export default function LibraryRecordsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const location = useLocation();
  const { hasPermission } = usePermissions();
  const uid = useId();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [recordType, setRecordType] = useState('');
  const [offset, setOffset] = useState(0);
  const tableRef = useRef<HTMLTableElement>(null);
  const pageChanged = useRef(false);
  const arrivalAnnouncement = (location.state as { announce?: string } | null)?.announce ?? '';

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['library-records', orgId, debounced, recordType, offset],
    queryFn: () => getBibRecords(orgId!, {
      q: debounced || undefined,
      record_type: recordType || undefined,
      limit: LIMIT,
      offset,
    }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const records = data?.items ?? [];
  const total = data?.total ?? 0;
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + LIMIT, total);
  const filtered = !!debounced || !!recordType;
  const typeLabel = recordType ? recordTypeLabel(recordType).toLowerCase() : '';

  // Move focus to the table after a page change, once the new rows are in.
  useEffect(() => {
    if (pageChanged.current && data && !isFetching) {
      pageChanged.current = false;
      tableRef.current?.focus();
    }
  }, [data, isFetching]);

  const goTo = (next: number) => {
    pageChanged.current = true;
    setOffset(next);
  };

  let status = '';
  if (data && !isFetching) {
    const found = filtered
      ? `${plural(total, 'record matches', 'records match')}${debounced ? ` “${debounced}”` : ''}${typeLabel ? ` in ${typeLabel}` : ''}.`
      : `${plural(total, 'record', 'records')}.`;
    status = total > LIMIT ? `${found} Showing ${first} to ${last}.` : found;
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-3">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0" aria-hidden="true">
              <Library size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Library</h1>
              <p className="text-sm text-archive mt-0.5">
                {data ? plural(total, 'record', 'records') : 'Loading…'}
              </p>
            </div>
          </div>
          {hasPermission('collections.create') && (
            <Link
              to={`/organizations/${orgId}/collections/library/create`}
              className={`btn btn-secondary flex items-center gap-2 no-underline min-h-[44px] ${focusRing}`}
            >
              <Plus size={18} aria-hidden="true" />
              New library record
            </Link>
          )}
        </div>
        <p className="text-sm text-archive leading-relaxed">
          Bibliographic records for books, serials, braille, large print and audio, with the
          holdings and items (copies, volumes, barcodes) the library has of each.
        </p>
      </div>

      <p role="status" aria-live="polite" className="sr-only">{arrivalAnnouncement || status}</p>

      <div role="search" aria-label="Library records" className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div>
          <label htmlFor={`${uid}-search`} className="block text-sm font-medium text-ink mb-1">
            Search library records
          </label>
          <input
            id={`${uid}-search`}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-describedby={`${uid}-search-hint`}
            className={fieldClass}
          />
          <p id={`${uid}-search-hint`} className="text-xs text-archive mt-1">
            Matches title, author or other statement of responsibility, ISBN, ISSN, or call number. An item barcode finds its record.
          </p>
        </div>
        <div>
          <label htmlFor={`${uid}-type`} className="block text-sm font-medium text-ink mb-1">
            Record type
          </label>
          <select
            id={`${uid}-type`}
            value={recordType}
            onChange={(e) => { setRecordType(e.target.value); setOffset(0); }}
            className={fieldClass}
          >
            <option value="">All types</option>
            {RECORD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && !data ? (
        <div className="flex items-center justify-center min-h-[20vh]">
          <MadronaLoader label="Loading library records…" />
        </div>
      ) : error ? (
        <p role="alert" className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 text-semantic-error">
          Could not load library records: {(error as Error).message}
        </p>
      ) : records.length === 0 ? (
        <div className="bg-parchment border border-lichen rounded-lg p-8 text-center">
          <h2 className="text-lg font-medium text-forest">
            {filtered ? 'No library records match' : 'No library records yet'}
          </h2>
        </div>
      ) : (
        <div className="bg-parchment border border-lichen rounded-lg overflow-x-auto">
          <table ref={tableRef} tabIndex={-1} className="w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-bark/30">
            <caption className="sr-only">
              Library records by title{total > LIMIT ? `, showing ${first} to ${last} of ${total}` : ''}
            </caption>
            <thead className="bg-stone/50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Title</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Type</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Responsibility</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Publication</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Call number</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Items</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {records.map((r) => (
                <tr key={r.bib_record_id} className="align-top">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <Link
                      to={`/organizations/${orgId}/collections/library/${r.bib_record_id}`}
                      className={`text-bark hover:text-copper-dark font-medium rounded ${focusRing}`}
                    >
                      {r.title || 'Untitled'}
                    </Link>
                    {r.subtitle && <div className="text-sm text-archive">{r.subtitle}</div>}
                  </th>
                  <td className="px-4 py-3 text-ink">{recordTypeLabel(r.record_type)}</td>
                  <td className="px-4 py-3 text-ink">{r.statement_of_responsibility || <span className="text-archive">Not recorded</span>}</td>
                  <td className="px-4 py-3 text-ink">{imprint(r) || <span className="text-archive">Not recorded</span>}</td>
                  <td className="px-4 py-3 text-ink">{r.call_number || <span className="text-archive">None</span>}</td>
                  <td className="px-4 py-3 text-ink">
                    {plural(r.item_count, 'item', 'items')}
                    {r.holding_count > 1 && <div className="text-sm text-archive">in {r.holding_count} holdings</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && total > LIMIT && (
        <nav aria-label="Library record pages" className="mt-6 flex items-center justify-between">
          <p className="text-sm text-archive">
            Showing {first} to {last} of {formatNumber(total)}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => goTo(Math.max(0, offset - LIMIT))} disabled={offset === 0} className={`btn btn-tertiary min-h-[44px] ${focusRing}`}>
              Previous page
            </button>
            <button type="button" onClick={() => goTo(offset + LIMIT)} disabled={offset + LIMIT >= total} className={`btn btn-tertiary min-h-[44px] ${focusRing}`}>
              Next page
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
