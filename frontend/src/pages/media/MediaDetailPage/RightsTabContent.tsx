import { Plus, FileSearch, Check, AlertCircle, RotateCcw, Globe, BarChart2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { publishMedia, unpublishMedia } from '../../../lib/api';
import { ConsentRecordsList, MediaRightsManager } from '../../../components/dam';
import { logger } from '../../../lib/logger';
import { formatDateShort } from '@/lib/formatters';
import type { RightsStatusInfo } from './types';
import type { QueryClient } from '@tanstack/react-query';

interface RightsTabContentProps {
  organizationId: string;
  mediaId: string;
  media: any;
  rightsStatus: RightsStatusInfo;
  usageStats: any;
  queryClient: QueryClient;
  reviewMetadataMutation: any;
  clearReviewMutation: any;
}

export function RightsTabContent({
  organizationId,
  mediaId,
  media,
  rightsStatus,
  usageStats,
  queryClient,
  reviewMetadataMutation,
  clearReviewMutation,
}: RightsTabContentProps) {
  return (
    <div className="p-4 sm:p-6">
      {/* Section A: Rights & Documentation */}
      <div className="space-y-6">
        <h3 className="text-sm font-semibold text-ink">Rights & Documentation</h3>

        {/* Rights Status Summary */}
        <div className={cn(
          'p-4 rounded-lg border',
          rightsStatus.bgColor,
          rightsStatus.status === 'ready' && 'border-semantic-success/30',
          rightsStatus.status === 'restricted' && 'border-semantic-warning/30',
          rightsStatus.status === 'blocked' && 'border-semantic-error/30',
          rightsStatus.status === 'incomplete' && 'border-lichen'
        )}>
          <div className="flex items-center gap-2">
            <span className={cn('w-2.5 h-2.5 rounded-full', rightsStatus.dotColor)} />
            <span className={cn('font-medium', rightsStatus.textColor)}>
              {rightsStatus.label}
            </span>
          </div>
          <p className={cn('text-sm mt-1 opacity-80', rightsStatus.textColor)}>
            {rightsStatus.description}
          </p>
          {rightsStatus.status === 'incomplete' && (
            <button
              onClick={() => {
                const addBtn = document.querySelector('[data-add-rights]');
                if (addBtn instanceof HTMLButtonElement) addBtn.click();
              }}
              className="mt-3 text-sm font-medium text-bark hover:text-copper-dark flex items-center gap-1"
            >
              <Plus size={14} />
              Add Rights
            </button>
          )}
        </div>

        <MediaRightsManager organizationId={organizationId} mediaId={mediaId} />

        {media.copyright_notice && (
          <div className="pt-4 border-t border-lichen">
            <h4 className="text-sm font-medium text-ink mb-1">Copyright Notice</h4>
            <p className="text-sm text-archive">{media.copyright_notice}</p>
          </div>
        )}

        {/* Content Review */}
        <div className="pt-4 border-t border-lichen">
          <h4 className="text-sm font-medium text-ink mb-2 flex items-center gap-2">
            <FileSearch size={14} />
            Content Review
          </h4>
          <p className="text-xs text-archive mb-3">
            Confirm metadata has been checked for sensitive content.
          </p>
          {media.metadata_reviewed ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-3 bg-semantic-success/10 rounded-lg">
                <Check size={16} className="text-semantic-success" />
                <span className="text-sm text-semantic-success font-medium">Reviewed</span>
                <span className="text-xs text-semantic-success ml-auto">
                  {media.metadata_reviewed_at && formatDateShort(media.metadata_reviewed_at)}
                </span>
              </div>
              {media.metadata_review_notes && (
                <p className="text-xs text-archive bg-stone/30 p-3 rounded-lg">
                  {media.metadata_review_notes}
                </p>
              )}
              <button
                onClick={() => clearReviewMutation.mutate()}
                disabled={clearReviewMutation.isPending}
                className="text-xs text-archive hover:text-ink flex items-center gap-1"
              >
                <RotateCcw size={12} />
                Clear review
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 bg-semantic-warning/10 rounded-lg">
                <AlertCircle size={16} className="text-semantic-warning" />
                <span className="text-sm text-semantic-warning font-medium">Content review: pending</span>
              </div>
              <button
                onClick={() => reviewMetadataMutation.mutate(undefined)}
                disabled={reviewMetadataMutation.isPending}
                className="flex items-center gap-2 px-3 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/30 transition-colors"
              >
                <Check size={14} />
                {reviewMetadataMutation.isPending ? 'Marking...' : 'Confirm Reviewed'}
              </button>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-lichen">
          <ConsentRecordsList organizationId={organizationId} mediaId={mediaId} />
        </div>
      </div>

      {/* Section B: Publishing & Usage */}
      <div className="mt-6 pt-6 border-t border-lichen space-y-6">
        <h3 className="text-sm font-semibold text-ink">Publishing & Usage</h3>

        <div>
          <h4 className="text-sm font-medium text-ink mb-2 flex items-center gap-2">
            <Globe size={14} />
            Publishing
          </h4>
          <div className="flex items-center justify-between">
            <span className={`text-sm ${media.is_published ? 'text-semantic-success' : 'text-archive'}`}>
              {media.is_published ? 'Published' : 'Not published'}
            </span>
            <button
              onClick={async () => {
                try {
                  if (media.is_published) {
                    await unpublishMedia(organizationId, mediaId);
                  } else {
                    await publishMedia(organizationId, mediaId);
                  }
                  queryClient.invalidateQueries({ queryKey: ['media', organizationId, mediaId] });
                } catch (err) {
                  logger.error('Failed to toggle publish status:', err);
                }
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                media.is_published ? 'bg-semantic-success' : 'bg-stone'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-parchment transition-transform ${
                  media.is_published ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          {media.is_published && rightsStatus.status === 'incomplete' && (
            <p className="text-xs text-archive mt-2">
              This asset is published. Rights details have not been added yet.
            </p>
          )}
        </div>

        {usageStats && (
          <div className="pt-4 border-t border-lichen">
            <h4 className="text-sm font-medium text-ink mb-3 flex items-center gap-2">
              <BarChart2 size={14} />
              Usage (Last 30 Days)
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-stone/30 rounded-lg">
                <div className="text-2xl font-semibold text-ink">{usageStats.by_event_type.views}</div>
                <div className="text-xs text-archive">Views</div>
              </div>
              <div className="p-3 bg-stone/30 rounded-lg">
                <div className="text-2xl font-semibold text-ink">{usageStats.by_event_type.downloads}</div>
                <div className="text-xs text-archive">Downloads</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
