import { useState, useEffect, useLayoutEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Calendar,
  Users,
  GraduationCap,
  Clock,
  CheckCircle,
  Plus,
  Search,
  Loader2,
  Package,
  X,
  Sparkles,
} from 'lucide-react';
import { getEvents } from '../../lib/api';
import { formatDateShort, formatNumber } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-ink',
  scheduled: 'bg-semantic-info/10 text-semantic-info',
  completed: 'bg-semantic-success/10 text-semantic-success',
  cancelled: 'bg-semantic-error/10 text-semantic-error',
};

const TYPE_LABELS: Record<string, string> = {
  teaching_session: 'Teaching Session',
  program: 'Program',
  opening_reception: 'Opening Reception',
  donor_development: 'Donor Development',
  internal: 'Internal',
};

const TYPE_ICONS: Record<string, typeof Calendar> = {
  teaching_session: GraduationCap,
  program: Users,
  opening_reception: Calendar,
  donor_development: Users,
  internal: Clock,
};

function formatDate(dateStr: string | null): string {
  return formatDateShort(dateStr);
}

const LIMIT = 25;
const SCROLL_KEY = 'events-scroll';

function EventRow({ event, orgId }: { event: any; orgId: string }) {
  const [isHovered, setIsHovered] = useState(false);
  const TypeIcon = TYPE_ICONS[event.event_type] || Calendar;
  return (
    <tr
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3 text-sm text-ink whitespace-nowrap">
        {formatDate(event.start_at)}
      </td>
      <td className="px-4 py-3 text-sm whitespace-nowrap">
        <div className="flex items-center gap-2">
          <TypeIcon size={16} className="text-archive" />
          <span className="text-ink">{TYPE_LABELS[event.event_type] || event.event_type}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/organizations/${orgId}/collections/events/${event.event_id}`}
          className="text-sm font-medium text-bark hover:text-copper-dark no-underline"
        >
          {event.title}
        </Link>
        <div className="text-xs text-archive">{event.event_reference_number}</div>
      </td>
      <td className="px-4 py-3 text-sm text-archive whitespace-nowrap">
        {event.location_path || event.location_name || '\u2014'}
      </td>
      <td className="px-4 py-3 text-sm text-archive whitespace-nowrap">
        {event.owner_name || '\u2014'}
      </td>
      <td className="px-4 py-3 text-sm whitespace-nowrap">
        {event.object_count && event.object_count > 0 ? (
          <div className="flex items-center gap-1.5 text-ink">
            <Package size={14} className="text-archive" />
            {event.object_count}
          </div>
        ) : (
          <span className="text-archive">\u2014</span>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span
          className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
            STATUS_STYLES[event.status] || STATUS_STYLES.draft
          }`}
        >
          {event.status.charAt(0).toUpperCase() + event.status.slice(1)}
        </span>
      </td>
    </tr>
  );
}

export default function EventsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);

  // L10: Scroll persistence
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) { sessionStorage.removeItem(SCROLL_KEY); requestAnimationFrame(() => { document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10)); }); }
  }, []);
  useEffect(() => { return () => { sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0))); }; }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, statusFilter, typeFilter]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['events', orgId, debouncedSearch, statusFilter, typeFilter, offset],
    queryFn: () =>
      getEvents(orgId!, {
        q: debouncedSearch || undefined,
        status: statusFilter || undefined,
        event_type: typeFilter || undefined,
        limit: LIMIT,
        offset,
      }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const showSkeleton = isLoading && !data;

  if (showSkeleton) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 text-semantic-error">
          Error loading events: {(error as Error).message}
        </div>
      </div>
    );
  }

  const events = data?.items || [];

  // Stats calculations
  const now = new Date();
  const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const upcomingEvents = events.filter(
    (e) => e.status === 'scheduled' && e.start_at && new Date(e.start_at) > now
  );

  const thisWeekEvents = events.filter((e) => {
    if (!e.start_at || e.status !== 'scheduled') return false;
    const startDate = new Date(e.start_at);
    return startDate >= now && startDate <= oneWeekFromNow;
  });

  const teachingSessions = events.filter((e) => e.event_type === 'teaching_session');

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <Calendar size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Events</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No events yet</span>
                  : data.total === 1 ? <span>1 event</span>
                  : <span>{formatNumber(data.total)} events</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          <Link
            to={`/organizations/${orgId}/collections/events/create`}
            className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
          >
            <Plus size={18} />
            Create Event
          </Link>
        </div>
        <p className="text-sm text-archive leading-relaxed">
          Museum programming activities including lectures, tours, openings, workshops, donor
          events, and teaching sessions. Events reference collection objects for educational and
          programming purposes.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-info/10 rounded-lg flex items-center justify-center">
              <Calendar size={20} className="text-semantic-info" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{upcomingEvents.length}</p>
              <p className="text-sm text-archive">Upcoming</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-warning/10 rounded-lg flex items-center justify-center">
              <Clock size={20} className="text-semantic-warning" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{thisWeekEvents.length}</p>
              <p className="text-sm text-archive">This Week</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-forest/10 rounded-lg flex items-center justify-center">
              <GraduationCap size={20} className="text-forest" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{teachingSessions.length}</p>
              <p className="text-sm text-archive">Teaching Sessions</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-success/10 rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-semantic-success" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {events.filter((e) => e.status === 'completed').length}
              </p>
              <p className="text-sm text-archive">Completed</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search Hero Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 w-full">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-archive" />
            <input
              type="text"
              placeholder="Search events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input w-full pl-12 pr-4 py-3 text-lg"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-archive hover:text-ink">
                <X size={18} />
              </button>
            )}
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          >
            <option value="">All Types</option>
            <option value="teaching_session">Teaching Session</option>
            <option value="program">Program</option>
            <option value="opening_reception">Opening Reception</option>
            <option value="donor_development">Donor Development</option>
            <option value="internal">Internal</option>
          </select>
        </div>
      </div>

      {/* Content Card */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        {/* Table */}
        {events.length === 0 && (searchQuery || statusFilter || typeFilter) ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">No events match your search</h3>
            <p className="text-archive max-w-md mx-auto mb-6">We couldn&apos;t find any events matching &ldquo;{searchQuery || statusFilter || typeFilter}&rdquo;. Try adjusting your search terms.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => { setSearchQuery(''); setStatusFilter(''); setTypeFilter(''); }} className="btn btn-secondary"><X size={16} className="mr-1.5" />Clear filters</button>
            </div>
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No events yet.</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-stone/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">
                    Title
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">
                    Location
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">
                    Owner
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">
                    Objects
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lichen">
                {events.map((event) => (
                  <EventRow key={event.event_id} event={event} orgId={orgId!} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Loading indicator for refetch */}
        {isFetching && !isLoading && (
          <div className="px-4 py-2 bg-stone/30 border-t border-lichen flex items-center gap-2 text-sm text-archive">
            <Loader2 size={14} className="animate-spin" />
            Updating...
          </div>
        )}
      </div>

      {/* Pagination */}
      {data && data.total > LIMIT && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-accessible-gray">Showing {offset + 1} - {Math.min(offset + LIMIT, data.total)} of {data.total}</p>
          <div className="flex gap-2">
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="btn btn-tertiary text-sm">Previous</button>
            <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= data.total} className="btn btn-tertiary text-sm">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
