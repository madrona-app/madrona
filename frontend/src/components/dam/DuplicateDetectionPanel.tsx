/**
 * DuplicateDetectionPanel — org-wide duplicate finder using CLIP embeddings.
 * Standalone page/panel component.
 */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Copy, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { findDuplicates, bulkGenerateClip } from '../../lib/api/media-dam';
import { useToast } from '../../contexts/ToastContext';

interface DuplicateDetectionPanelProps {
  organizationId: string;
}

export function DuplicateDetectionPanel({
  organizationId,
}: DuplicateDetectionPanelProps) {
  const { showToast } = useToast();
  const [threshold, setThreshold] = useState(0.95);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['duplicates', organizationId, threshold],
    queryFn: () => findDuplicates(organizationId, threshold),
    enabled: false, // Only fetch on demand
  });

  const bulkGenerateMutation = useMutation({
    mutationFn: () => bulkGenerateClip(organizationId),
    onSuccess: () => {
      showToast({
        title: 'CLIP embedding generation started',
        type: 'success',
      });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-ink">Duplicate Detection</h2>
        <p className="text-sm text-archive mt-1">
          Find visually similar images that may be duplicates using AI-powered image analysis.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 p-4 bg-stone border border-lichen rounded-lg">
        <div className="flex items-center gap-2">
          <label className="text-sm text-ink font-medium">Threshold:</label>
          <input
            type="range"
            min={0.8}
            max={1}
            step={0.01}
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            className="w-32"
          />
          <span className="text-sm text-archive w-12">
            {Math.round(threshold * 100)}%
          </span>
        </div>

        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-bark text-parchment rounded-lg hover:bg-bark/90 disabled:opacity-50 transition-colors"
        >
          {isLoading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Scan for Duplicates
        </button>

        <button
          onClick={() => bulkGenerateMutation.mutate()}
          disabled={bulkGenerateMutation.isPending}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-lichen text-ink rounded-lg hover:bg-stone/20 disabled:opacity-50 transition-colors"
        >
          Generate Embeddings
        </button>
      </div>

      {/* Results */}
      {data?.duplicates && data.duplicates.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-semantic-warning" />
            <span className="text-sm font-medium text-ink">
              {data.total} potential duplicate pair{data.total !== 1 ? 's' : ''} found
            </span>
          </div>

          <div className="divide-y divide-lichen border border-lichen rounded-lg overflow-hidden">
            {data.duplicates.map((dup, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 hover:bg-stone transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-archive">
                      {dup.media_id_a.slice(0, 8)}...
                    </span>
                    <Copy size={12} className="text-archive" />
                    <span className="text-sm font-mono text-archive">
                      {dup.media_id_b.slice(0, 8)}...
                    </span>
                  </div>
                </div>
                <span className="text-sm font-medium text-bark">
                  {Math.round(dup.similarity * 100)}% similar
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : data?.duplicates?.length === 0 ? (
        <div className="py-8 text-center text-sm text-archive">
          No duplicates found at {Math.round(threshold * 100)}% threshold.
        </div>
      ) : null}
    </div>
  );
}
