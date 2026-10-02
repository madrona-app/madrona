import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart2,
  Eye,
  Download,
  Code,
  ExternalLink,
  TrendingUp,
  Image,
  Video,
  FileAudio,
  FileText,
  Calendar,
  Box,
} from 'lucide-react';
import { getMediaUsageReport } from '../../lib/api';
import { formatNumber, formatDateShort } from '@/lib/formatters';

type Period = 7 | 30 | 90;

const MEDIA_TYPE_ICONS = {
  image: Image,
  video: Video,
  audio: FileAudio,
  document: FileText,
  model_3d: Box,
};

/**
 * Media Analytics Page - Dashboard for media usage statistics.
 * Shows views, downloads, embeds, and API access metrics.
 */
export default function MediaAnalyticsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [period, setPeriod] = useState<Period>(30);

  const { data, isLoading, error } = useQuery({
    queryKey: ['media-usage-report', orgId, period],
    queryFn: () => getMediaUsageReport(orgId!, { days: period }),
    enabled: !!orgId,
  });

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-stone rounded w-48" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-stone rounded" />
            ))}
          </div>
          <div className="h-64 bg-stone rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded p-4 text-semantic-error">
          Error loading analytics: {(error as Error).message}
        </div>
      </div>
    );
  }

  const stats = data?.by_event_type || { views: 0, downloads: 0, embeds: 0, api_accesses: 0 };
  const totalEvents = data?.total_events || 0;
  const topMedia = data?.top_media || [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart2 className="h-6 w-6" />
            Media Analytics
          </h1>
          <p className="text-archive">
            Track usage and engagement for your media library
          </p>
        </div>

        {/* Period Selector */}
        <div className="flex items-center gap-2 bg-stone/30 rounded-lg p-1">
          {([7, 30, 90] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                period === p
                  ? 'bg-parchment shadow text-ink font-medium'
                  : 'text-archive hover:text-ink'
              }`}
            >
              {p} days
            </button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-semantic-info/10 dark:bg-semantic-info/20 rounded">
              <TrendingUp className="h-5 w-5 text-semantic-info" />
            </div>
            <div>
              <p className="text-sm text-archive">Total Events</p>
              <p className="text-2xl font-bold">{formatNumber(totalEvents)}</p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-semantic-success/10 dark:bg-semantic-success/20 rounded">
              <Eye className="h-5 w-5 text-semantic-success" />
            </div>
            <div>
              <p className="text-sm text-archive">Views</p>
              <p className="text-2xl font-bold">{formatNumber(stats.views)}</p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-forest/10 rounded">
              <Download className="h-5 w-5 text-forest" />
            </div>
            <div>
              <p className="text-sm text-archive">Downloads</p>
              <p className="text-2xl font-bold">{formatNumber(stats.downloads)}</p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-semantic-warning/10 dark:bg-semantic-warning/20 rounded">
              <ExternalLink className="h-5 w-5 text-semantic-warning" />
            </div>
            <div>
              <p className="text-sm text-archive">Embeds</p>
              <p className="text-2xl font-bold">{formatNumber(stats.embeds)}</p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-bark/10 rounded">
              <Code className="h-5 w-5 text-bark" />
            </div>
            <div>
              <p className="text-sm text-archive">API Access</p>
              <p className="text-2xl font-bold">{formatNumber(stats.api_accesses)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Period Info */}
      {data?.period_start && data?.period_end && (
        <div className="flex items-center gap-2 text-sm text-archive">
          <Calendar className="h-4 w-4" />
          <span>
            {formatDateShort(data.period_start)} - {formatDateShort(data.period_end)}
          </span>
        </div>
      )}

      {/* Top Media Table */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">Top Media</h2>
          <p className="text-sm text-archive">
            Most accessed media items in the selected period
          </p>
        </div>

        {topMedia.length === 0 ? (
          <div className="p-12 text-center">
            <BarChart2 className="h-12 w-12 text-archive mx-auto mb-4" />
            <h3 className="font-medium mb-2">No Data Yet</h3>
            <p className="text-sm text-archive max-w-md mx-auto">
              Usage statistics will appear here once your media files start receiving views and downloads.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-stone/30">
                <tr>
                  <th className="p-3 text-left text-sm font-medium text-archive">Media</th>
                  <th className="p-3 text-right text-sm font-medium text-archive">Views</th>
                  <th className="p-3 text-right text-sm font-medium text-archive">Downloads</th>
                  <th className="p-3 text-right text-sm font-medium text-archive">Embeds</th>
                  <th className="p-3 text-right text-sm font-medium text-archive">API</th>
                  <th className="p-3 text-right text-sm font-medium text-archive">Total</th>
                </tr>
              </thead>
              <tbody>
                {topMedia.map((item, index) => {
                  const Icon = MEDIA_TYPE_ICONS.image; // Default, could be determined from media_type if available
                  return (
                    <tr key={item.media_id} className="border-t hover:bg-stone/50/30">
                      <td className="p-3">
                        <Link
                          to={`/organizations/${orgId}/media/${item.media_id}`}
                          className="flex items-center gap-3 hover:text-copper-dark"
                        >
                          <div className="relative">
                            <span className="absolute -top-1 -left-1 w-5 h-5 bg-stone/50 rounded-full text-xs flex items-center justify-center font-medium">
                              {index + 1}
                            </span>
                            {item.thumbnail_url ? (
                              <img
                                src={item.thumbnail_url}
                                alt=""
                                className="w-10 h-10 object-cover rounded"
                              />
                            ) : (
                              <div className="w-10 h-10 bg-stone/50 rounded flex items-center justify-center">
                                <Icon className="h-5 w-5 text-archive" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium truncate">
                              {item.title || item.filename}
                            </p>
                            {item.title && (
                              <p className="text-xs text-archive truncate">
                                {item.filename}
                              </p>
                            )}
                          </div>
                        </Link>
                      </td>
                      <td className="p-3 text-right tabular-nums">{formatNumber(item.views ?? 0)}</td>
                      <td className="p-3 text-right tabular-nums">{formatNumber(item.downloads ?? 0)}</td>
                      <td className="p-3 text-right tabular-nums">{formatNumber(item.embeds ?? 0)}</td>
                      <td className="p-3 text-right tabular-nums">{formatNumber(item.api_accesses ?? 0)}</td>
                      <td className="p-3 text-right tabular-nums font-medium">
                        {formatNumber(item.total_events ?? item.event_count ?? 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info Card */}
      <div className="card p-6">
        <h3 className="font-semibold mb-3">Understanding Analytics</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <div className="flex items-center gap-2 text-semantic-success mb-1">
              <Eye className="h-4 w-4" />
              <span className="font-medium">Views</span>
            </div>
            <p className="text-archive">
              Times media was viewed in the application, detail pages, or collections.
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 text-forest mb-1">
              <Download className="h-4 w-4" />
              <span className="font-medium">Downloads</span>
            </div>
            <p className="text-archive">
              Direct downloads of original files or derivatives.
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 text-semantic-warning mb-1">
              <ExternalLink className="h-4 w-4" />
              <span className="font-medium">Embeds</span>
            </div>
            <p className="text-archive">
              Media embedded on external websites or applications.
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 text-bark mb-1">
              <Code className="h-4 w-4" />
              <span className="font-medium">API Access</span>
            </div>
            <p className="text-archive">
              Programmatic access through IIIF or public API endpoints.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
