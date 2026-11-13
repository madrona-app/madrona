import { useEffect, useId, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { BookOpen, Plus } from 'lucide-react';
import { getResearchVisits } from '../../lib/api/researchVisits';
import { formatDateShort, formatNumber } from '@/lib/formatters';
import { usePermissions } from '../../hooks/usePermissions';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const LIMIT = 25;
const focusRing = 'focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

function timeRange(arrival: string | null, departure: string | null): string | null {
  if (arrival && departure) return `${arrival} to ${departure}`;
  if (arrival) return `from ${arrival}`;
  if (departure) return `until ${departure}`;
  return null;
}

export default function ResearchVisitsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const location = useLocation();
  const { hasPermission } = usePermissions();
  const uid = useId();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [offset, setOffset] = useState(0);
  const arrivalAnnouncement = (location.state as { announce?: string } | null)?.announce ?? '';

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['research-visits', orgId, debounced, offset],
    queryFn: () => getResearchVisits(orgId!, { q: debounced || undefined, limit: LIMIT, offset }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const visits = data?.items ?? [];
  const total = data?.total ?? 0;
  const status = !data
    ? ''
    : debounced
      ? `${formatNumber(total)} ${total === 1 ? 'visit matches' : 'visits match'} “${debounced}”.`
      : '';

  return (
    <div className="max-w-6xl mx-auto">
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-3">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0" aria-hidden="true">
              <BookOpen size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Research Visits</h1>
              <p className="text-sm text-archive mt-0.5">
                {data ? (total === 1 ? '1 visit' : `${formatNumber(total)} visits`) : 'Loading…'}
              </p>
            </div>
          </div>
          {hasPermission('use_requests.create') && (
            <Link
              to={`/organizations/${orgId}/collections/research-visits/create`}
              className={`btn btn-secondary flex items-center gap-2 no-underline min-h-[44px] ${focusRing}`}
            >
              <Plus size={18} aria-hidden="true" />
              Log a visit
            </Link>
          )}
        </div>
        <p className="text-sm text-archive leading-relaxed">
          A log of in-person visits by researchers and the objects they used. Approval to use the
          collection is recorded separately as a use request.
        </p>
      </div>

      <p role="status" aria-live="polite" className="sr-only">{arrivalAnnouncement || status}</p>

      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6">
        <label htmlFor={`${uid}-search`} className="block text-sm font-medium text-ink mb-1">
          Search visits
        </label>
        <input
          id={`${uid}-search`}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-describedby={`${uid}-search-hint`}
          className="input w-full max-w-md"
        />
        <p id={`${uid}-search-hint`} className="text-xs text-archive mt-1">
          Matches researcher name, affiliation, research topic, or location.
        </p>
      </div>

      {isLoading && !data ? (
        <div className="flex items-center justify-center min-h-[20vh]">
          <MadronaLoader label="Loading research visits…" />
        </div>
      ) : error ? (
        <p role="alert" className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 text-semantic-error">
          Could not load research visits: {(error as Error).message}
        </p>
      ) : visits.length === 0 ? (
        <div className="bg-parchment border border-lichen rounded-lg p-8 text-center">
          <h2 className="text-lg font-medium text-forest">
            {debounced ? 'No visits match your search' : 'No research visits logged yet'}
          </h2>
        </div>
      ) : (
        <div className="bg-parchment border border-lichen rounded-lg overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">
              Research visits, newest first{data && total > LIMIT ? `, showing ${offset + 1} to ${Math.min(offset + LIMIT, total)} of ${total}` : ''}
            </caption>
            <thead className="bg-stone/50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Date</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Researcher</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Research topic</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Location</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Objects used</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Supervised by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {visits.map((v) => {
                const times = timeRange(v.arrival_time, v.departure_time);
                return (
                  <tr key={v.visit_id} className="align-top">
                    <td className="px-4 py-3 text-ink whitespace-nowrap">
                      {formatDateShort(v.visit_date)}
                      {times && <div className="text-sm text-archive">{times}</div>}
                    </td>
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      <Link
                        to={`/organizations/${orgId}/collections/research-visits/${v.visit_id}`}
                        className={`text-bark hover:text-copper-dark font-medium rounded ${focusRing}`}
                      >
                        {v.researcher_name}
                      </Link>
                      {v.researcher_affiliation && <div className="text-sm text-archive">{v.researcher_affiliation}</div>}
                    </th>
                    <td className="px-4 py-3 text-ink">{v.research_topic || <span className="text-archive">Not recorded</span>}</td>
                    <td className="px-4 py-3 text-ink">{v.location || <span className="text-archive">Not recorded</span>}</td>
                    <td className="px-4 py-3 text-ink">{v.object_count}</td>
                    <td className="px-4 py-3 text-ink">{v.supervised_by_name || <span className="text-archive">Not recorded</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && total > LIMIT && (
        <nav aria-label="Research visit pages" className="mt-6 flex items-center justify-between">
          <p className="text-sm text-archive">
            Showing {offset + 1} to {Math.min(offset + LIMIT, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className={`btn btn-tertiary min-h-[44px] ${focusRing}`}>
              Previous page
            </button>
            <button type="button" onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= total} className={`btn btn-tertiary min-h-[44px] ${focusRing}`}>
              Next page
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
