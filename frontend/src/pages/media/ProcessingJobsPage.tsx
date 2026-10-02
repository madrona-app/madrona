import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Activity, CheckCircle2, Clock, AlertCircle, RefreshCw, Image, Video, FileText, RotateCcw, FileAudio, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { getProcessingJobs, retryProcessingJob } from '../../lib/api';
import { bulkTranscribe, bulkGenerateClip } from '../../lib/api/media-dam';
import type { ProcessingJobsResponse, MediaProcessingJob } from '../../lib/schemas';
import { useToast } from '../../contexts/ToastContext';
import { logger } from '../../lib/logger';
import { formatDateTime } from '@/lib/formatters';

/**
 * Processing Jobs page for Media / DAM.
 * Shows the status of media processing jobs including derivative generation,
 * metadata extraction, and video transcoding.
 */
export default function ProcessingJobsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { showToast } = useToast();
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProcessingJobsResponse | null>(null);

  const bulkTranscribeMutation = useMutation({
    mutationFn: () => bulkTranscribe(orgId!),
    onSuccess: () => {
      showToast({ title: 'Bulk transcription started for all audio/video files', type: 'success' });
      fetchJobs(true);
    },
    onError: (err: Error) => showToast({ title: `Bulk transcription failed: ${err.message}`, type: 'error' }),
  });

  const bulkClipMutation = useMutation({
    mutationFn: () => bulkGenerateClip(orgId!),
    onSuccess: () => {
      showToast({ title: 'CLIP embedding generation started for all images', type: 'success' });
      fetchJobs(true);
    },
    onError: (err: Error) => showToast({ title: `CLIP generation failed: ${err.message}`, type: 'error' }),
  });

  const fetchJobs = useCallback(async (showRefreshing = false) => {
    if (!orgId) return;

    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const statusFilter = filter !== 'all' ? filter as 'pending' | 'processing' | 'completed' | 'failed' : undefined;
      const response = await getProcessingJobs(orgId, {
        status: statusFilter,
        page_size: 50,
      });
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load processing jobs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId, filter]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Auto-refresh every 10 seconds if there are pending/processing jobs
  useEffect(() => {
    const hasActiveJobs = data?.stats && (data.stats.pending > 0 || data.stats.processing > 0);
    if (!hasActiveJobs) return;

    const interval = setInterval(() => {
      fetchJobs(true);
    }, 10000);

    return () => clearInterval(interval);
  }, [data?.stats, fetchJobs]);

  const handleRetry = async (jobId: string) => {
    if (!orgId) return;
    try {
      await retryProcessingJob(orgId, jobId);
      fetchJobs(true);
    } catch (err) {
      logger.error('Failed to retry job:', err);
    }
  };

  const stats = data?.stats ?? { pending: 0, processing: 0, completed: 0, failed: 0 };
  const jobs = data?.jobs ?? [];

  const getJobTypeIcon = (type: string) => {
    switch (type) {
      case 'derivatives':
        return <Image className="h-4 w-4" />;
      case 'transcode':
        return <Video className="h-4 w-4" />;
      case 'metadata_extract':
        return <FileText className="h-4 w-4" />;
      default:
        return <Activity className="h-4 w-4" />;
    }
  };

  const getJobTypeLabel = (type: string) => {
    switch (type) {
      case 'derivatives':
        return 'Derivative Generation';
      case 'transcode':
        return 'Video Transcoding';
      case 'metadata_extract':
        return 'Metadata Extraction';
      default:
        return type;
    }
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '-';
    return formatDateTime(dateStr);
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Processing Jobs</h1>
          <p className="text-archive">
            Monitor media processing and derivative generation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => bulkTranscribeMutation.mutate()}
            disabled={bulkTranscribeMutation.isPending}
            className="btn btn-secondary flex items-center gap-2"
            title="Transcribe all audio/video files without transcripts"
          >
            {bulkTranscribeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileAudio className="h-4 w-4" />}
            Bulk Transcribe
          </button>
          <button
            onClick={() => bulkClipMutation.mutate()}
            disabled={bulkClipMutation.isPending}
            className="btn btn-secondary flex items-center gap-2"
            title="Generate CLIP embeddings for all images"
          >
            {bulkClipMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Image className="h-4 w-4" />}
            Bulk CLIP
          </button>
          <button
            onClick={() => fetchJobs(true)}
            disabled={refreshing}
            className="btn btn-secondary flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-semantic-warning/10 dark:bg-semantic-warning/20 rounded">
              <Clock className="h-5 w-5 text-semantic-warning" />
            </div>
            <div>
              <p className="text-sm text-archive">Pending</p>
              <p className="text-2xl font-bold">{stats.pending}</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-semantic-info/10 dark:bg-semantic-info/20 rounded">
              <Activity className="h-5 w-5 text-semantic-info" />
            </div>
            <div>
              <p className="text-sm text-archive">Processing</p>
              <p className="text-2xl font-bold">{stats.processing}</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-semantic-success/10 dark:bg-semantic-success/20 rounded">
              <CheckCircle2 className="h-5 w-5 text-semantic-success" />
            </div>
            <div>
              <p className="text-sm text-archive">Completed</p>
              <p className="text-2xl font-bold">{stats.completed}</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-semantic-error/10 dark:bg-semantic-error/20 rounded">
              <AlertCircle className="h-5 w-5 text-semantic-error" />
            </div>
            <div>
              <p className="text-sm text-archive">Failed</p>
              <p className="text-2xl font-bold">{stats.failed}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {['all', 'pending', 'processing', 'completed', 'failed'].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === status
                ? 'bg-bark text-parchment'
                : 'bg-stone/50 hover:bg-stone/60'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="card p-4 bg-semantic-error/10 dark:bg-semantic-error/20 text-semantic-error mb-4">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="card p-12 text-center">
          <RefreshCw className="h-12 w-12 text-archive mx-auto mb-4 animate-spin" />
          <p className="text-archive">Loading jobs...</p>
        </div>
      ) : jobs.length === 0 ? (
        <div className="card p-12 text-center">
          <Activity className="h-12 w-12 text-archive mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No {filter !== 'all' ? filter : ''} Jobs</h3>
          <p className="text-archive max-w-md mx-auto">
            Processing jobs are created automatically when you upload media files.
            Jobs include derivative generation, metadata extraction, and video transcoding.
          </p>
        </div>
      ) : (
        <div className="card divide-y">
          {jobs.map((job: MediaProcessingJob) => (
            <div key={job.job_id} className="p-4 flex items-center gap-4">
              <div className="p-2 bg-stone/50 rounded">
                {getJobTypeIcon(job.job_type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium truncate">
                    {job.filename || job.media_id}
                  </h3>
                  <Link
                    to={`/organizations/${orgId}/media/${job.media_id}`}
                    className="text-xs text-bark hover:underline"
                  >
                    View
                  </Link>
                </div>
                <p className="text-sm text-archive">
                  {getJobTypeLabel(job.job_type)}
                </p>
                {job.error_message && (
                  <p className="text-sm text-semantic-error mt-1">{job.error_message}</p>
                )}
              </div>
              <div className="text-sm text-archive whitespace-nowrap">
                {formatDate(job.created_at)}
              </div>
              <div className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${
                job.status === 'completed' ? 'bg-semantic-success/10 text-semantic-success dark:bg-semantic-success/30 dark:text-semantic-success' :
                job.status === 'processing' ? 'bg-semantic-info/10 text-semantic-info dark:bg-semantic-info/30 dark:text-semantic-info' :
                job.status === 'failed' ? 'bg-semantic-error/10 text-semantic-error dark:bg-semantic-error/30 dark:text-semantic-error' :
                'bg-semantic-warning/10 text-semantic-warning dark:bg-semantic-warning/30 dark:text-semantic-warning'
              }`}>
                {job.status}
              </div>
              {job.status === 'failed' && (
                <button
                  onClick={() => handleRetry(job.job_id)}
                  className="p-2 hover:bg-stone rounded"
                  title="Retry job"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Info section */}
      <div className="mt-8 card p-6">
        <h2 className="text-lg font-semibold mb-4">About Processing Jobs</h2>
        <div className="grid gap-6 md:grid-cols-3">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Image className="h-5 w-5 text-archive" />
              <h3 className="font-medium">Derivative Generation</h3>
            </div>
            <p className="text-sm text-archive">
              Automatic creation of thumbnails, previews, and web-optimized
              versions of your images.
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-5 w-5 text-archive" />
              <h3 className="font-medium">Metadata Extraction</h3>
            </div>
            <p className="text-sm text-archive">
              Extraction of EXIF, IPTC, and XMP metadata from your files
              for enhanced searchability.
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Video className="h-5 w-5 text-archive" />
              <h3 className="font-medium">Video Transcoding</h3>
            </div>
            <p className="text-sm text-archive">
              Conversion of video files to web-compatible formats with
              multiple quality options.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
