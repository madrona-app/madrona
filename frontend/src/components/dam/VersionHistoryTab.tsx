import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Upload, RotateCcw, Clock, ArrowLeftRight } from 'lucide-react';
import { getMediaVersions } from '../../lib/api';
import type { MediaVersion } from '../../lib/schemas';
import { UploadVersionModal } from './UploadVersionModal';
import { RestoreVersionDialog } from './RestoreVersionDialog';
import { VersionComparisonView } from './VersionComparisonView';
import { MadronaLoader } from '../ui/MadronaLoader';
import { formatDateTime } from '@/lib/formatters';

interface VersionHistoryTabProps {
  organizationId: string;
  mediaId: string;
  currentVersion: number;
  mediaType?: string;
}

export function VersionHistoryTab({
  organizationId,
  mediaId,
  currentVersion,
  mediaType = 'image',
}: VersionHistoryTabProps) {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [versionToRestore, setVersionToRestore] = useState<MediaVersion | null>(null);
  const [compareVersions, setCompareVersions] = useState<[MediaVersion, MediaVersion] | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['media-versions', organizationId, mediaId],
    queryFn: () => getMediaVersions(organizationId, mediaId),
    enabled: !!organizationId && !!mediaId,
  });

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'Unknown date';
    return formatDateTime(dateString);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-semantic-error/10 border border-semantic-error/30 rounded text-semantic-error text-sm">
        Error loading version history: {(error as Error).message}
      </div>
    );
  }

  const versions = data?.versions || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium font-serif text-ink flex items-center gap-2">
          <History size={16} className="text-bark" />
          Version History
        </h4>
        <button
          onClick={() => setShowUploadModal(true)}
          className="px-3 py-1.5 border border-stone rounded-sm bg-parchment text-sm font-serif text-ink cursor-pointer hover:bg-stone/20 transition-colors flex items-center gap-1.5"
        >
          <Upload size={14} />
          Upload New Version
        </button>
      </div>

      {/* Current version info */}
      <div className="p-3 bg-parchment border border-lichen rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-bark text-parchment text-xs font-medium font-serif rounded">
              Current
            </span>
            <span className="font-medium font-serif text-ink">Version {currentVersion}</span>
          </div>
        </div>
      </div>

      {/* Version list */}
      {versions.length === 0 ? (
        <div className="text-center py-8">
          <Clock className="h-8 w-8 text-archive mx-auto mb-2" />
          <p className="text-sm text-archive font-serif">
            No previous versions available
          </p>
          <p className="text-xs text-archive font-serif mt-1">
            Upload a new version to start tracking version history
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {versions.map((version) => (
            <div
              key={version.version_id}
              className="flex items-center justify-between p-3 border border-stone rounded-lg hover:bg-stone/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium font-serif text-ink">Version {version.version_number}</span>
                  {version.version_number === currentVersion && (
                    <span className="px-2 py-0.5 bg-bark text-parchment text-xs font-medium font-serif rounded">
                      Current
                    </span>
                  )}
                </div>
                <div className="text-sm text-archive font-serif mt-1">
                  <span>{formatFileSize(version.file_size)}</span>
                  <span className="mx-2">•</span>
                  <span>{formatDate(version.created_at)}</span>
                </div>
                {version.change_note && (
                  <p className="text-sm text-archive font-serif mt-1 truncate">
                    {version.change_note}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 ml-2">
                {version.version_number !== currentVersion && (
                  <>
                    <button
                      onClick={() => {
                        // Compare this version against current
                        const currentVer = versions.find((v) => v.version_number === currentVersion);
                        if (currentVer) {
                          setCompareVersions([version, currentVer]);
                        }
                      }}
                      className="px-3 py-1.5 border border-stone rounded-sm bg-parchment text-sm font-serif text-ink cursor-pointer hover:bg-stone/20 transition-colors flex items-center gap-1.5"
                      title="Compare with current version"
                    >
                      <ArrowLeftRight size={14} />
                      Compare
                    </button>
                    <button
                      onClick={() => setVersionToRestore(version)}
                      className="px-3 py-1.5 border border-stone rounded-sm bg-parchment text-sm font-serif text-ink cursor-pointer hover:bg-stone/20 transition-colors flex items-center gap-1.5"
                      title="Restore this version"
                    >
                      <RotateCcw size={14} />
                      Restore
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Version Comparison */}
      {compareVersions && (
        <VersionComparisonView
          organizationId={organizationId}
          mediaId={mediaId}
          versionA={compareVersions[0]}
          versionB={compareVersions[1]}
          mediaType={mediaType}
          onClose={() => setCompareVersions(null)}
        />
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <UploadVersionModal
          organizationId={organizationId}
          mediaId={mediaId}
          onClose={() => setShowUploadModal(false)}
        />
      )}

      {/* Restore Dialog */}
      {versionToRestore && (
        <RestoreVersionDialog
          organizationId={organizationId}
          mediaId={mediaId}
          version={versionToRestore}
          onClose={() => setVersionToRestore(null)}
        />
      )}
    </div>
  );
}
