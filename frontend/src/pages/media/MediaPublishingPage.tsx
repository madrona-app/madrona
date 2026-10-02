import { useState } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Globe,
  Upload,
  Shield,
  Link as LinkIcon,
  Copy,
  Check,
  Image,
  Video,
  FileAudio,
  FileText,
  X,
  Loader2,
  AlertTriangle,
  Filter,
  Key,
  Box,
} from 'lucide-react';
import { searchMedia, publishMedia, unpublishMedia } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import type { MediaSearchHit } from '../../lib/schemas';
import { PublishMediaDialog } from '../../components/dam';

import ConfirmDialog from '../../components/ConfirmDialog';

type StatusFilter = 'all' | 'published' | 'draft' | 'issues';

const MEDIA_TYPE_ICONS = {
  image: Image,
  video: Video,
  audio: FileAudio,
  document: FileText,
  model_3d: Box,
};

/**
 * Media Publishing page for Media / DAM.
 * Manages public access to media files, including IIIF endpoints and public
 * API access.
 */
export default function MediaPublishingPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();

  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [mediaToPublish, setMediaToPublish] = useState<MediaSearchHit | null>(null);
  const [showUnpublishDialog, setShowUnpublishDialog] = useState(false);
  const [mediaToUnpublish, setMediaToUnpublish] = useState<MediaSearchHit | null>(null);
  const { showToast } = useToast();

  // Fetch media for publishing management
  const { data: mediaData, isLoading: loadingMedia } = useQuery({
    queryKey: ['publishing-media', orgId, statusFilter],
    queryFn: () => searchMedia(orgId!, {
      limit: 100,
      is_published: statusFilter === 'published' ? true : statusFilter === 'draft' ? false : undefined,
    }),
    enabled: !!orgId,
  });

  // Calculate stats from media data
  const media = mediaData?.hits || [];
  const stats = {
    published: media.filter((m: MediaSearchHit) => m.is_published).length,
    pendingReview: media.filter((m: MediaSearchHit) => !m.is_published && m.processing_status === 'completed').length,
    rightsIssues: media.filter((m: MediaSearchHit) => !m.copyright_status).length,
    total: media.length,
  };

  // Unpublish mutation
  const unpublishMutation = useMutation({
    mutationFn: (mediaId: string) => unpublishMedia(orgId!, mediaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['publishing-media', orgId] });
      setShowUnpublishDialog(false);
      setMediaToUnpublish(null);
      showToast({ type: 'success', title: 'Media unpublished' });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: 'Failed to unpublish', message: err.message });
    },
  });

  // Bulk publish mutation
  const bulkPublishMutation = useMutation({
    mutationFn: async (mediaIds: string[]) => {
      const results = await Promise.allSettled(
        mediaIds.map((id) => publishMedia(orgId!, id))
      );
      return results;
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['publishing-media', orgId] });
      setSelectedItems(new Set());
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        showToast({ type: 'warning', title: `${results.length - failures.length} published, ${failures.length} failed` });
      } else {
        showToast({ type: 'success', title: `Published ${results.length} item${results.length !== 1 ? 's' : ''}` });
      }
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: 'Bulk publish failed', message: err.message });
    },
  });

  // Bulk unpublish mutation
  const bulkUnpublishMutation = useMutation({
    mutationFn: async (mediaIds: string[]) => {
      const results = await Promise.allSettled(
        mediaIds.map((id) => unpublishMedia(orgId!, id))
      );
      return results;
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['publishing-media', orgId] });
      setSelectedItems(new Set());
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        showToast({ type: 'warning', title: `${results.length - failures.length} unpublished, ${failures.length} failed` });
      } else {
        showToast({ type: 'success', title: `Unpublished ${results.length} item${results.length !== 1 ? 's' : ''}` });
      }
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: 'Bulk unpublish failed', message: err.message });
    },
  });

  const copyToClipboard = (text: string, endpoint: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEndpoint(endpoint);
    setTimeout(() => setCopiedEndpoint(null), 2000);
  };

  const toggleSelect = (mediaId: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(mediaId)) {
      newSelected.delete(mediaId);
    } else {
      newSelected.add(mediaId);
    }
    setSelectedItems(newSelected);
  };

  // IIIF is served by this deployment (the web server proxies /iiif to the
  // API), so the URLs are this page's own origin plus the real routes.
  const iiifBase = `${window.location.origin}/iiif/3`;

  // Filter media based on status
  const filteredMedia = media.filter((m: MediaSearchHit) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'published') return m.is_published;
    if (statusFilter === 'draft') return !m.is_published;
    if (statusFilter === 'issues') return !m.copyright_status;
    return true;
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Media Publishing</h1>
        <p className="text-stone-500">
          Configure and manage public access to your media assets
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <button
          onClick={() => setStatusFilter('published')}
          className={`bg-parchment border rounded-lg p-4 text-left transition-all ${
            statusFilter === 'published'
              ? 'ring-2 ring-forest border-forest'
              : 'border-stone-200 hover:border-stone-300'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-semantic-success/10 rounded-lg">
              <Globe className="h-5 w-5 text-semantic-success" />
            </div>
            <div>
              <p className="text-sm text-stone-500">Published</p>
              <p className="text-2xl font-bold text-stone-900">{stats.published}</p>
            </div>
          </div>
        </button>
        <button
          onClick={() => setStatusFilter('draft')}
          className={`bg-parchment border rounded-lg p-4 text-left transition-all ${
            statusFilter === 'draft'
              ? 'ring-2 ring-forest border-forest'
              : 'border-stone-200 hover:border-stone-300'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-semantic-warning/10 rounded-lg">
              <Upload className="h-5 w-5 text-semantic-warning" />
            </div>
            <div>
              <p className="text-sm text-stone-500">Pending Review</p>
              <p className="text-2xl font-bold text-stone-900">{stats.pendingReview}</p>
            </div>
          </div>
        </button>
        <button
          onClick={() => setStatusFilter('issues')}
          className={`bg-parchment border rounded-lg p-4 text-left transition-all ${
            statusFilter === 'issues'
              ? 'ring-2 ring-forest border-forest'
              : 'border-stone-200 hover:border-stone-300'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-semantic-error/10 rounded-lg">
              <Shield className="h-5 w-5 text-semantic-error" />
            </div>
            <div>
              <p className="text-sm text-stone-500">Rights Issues</p>
              <p className="text-2xl font-bold text-stone-900">{stats.rightsIssues}</p>
            </div>
          </div>
        </button>
        <button
          onClick={() => setStatusFilter('all')}
          className={`bg-parchment border rounded-lg p-4 text-left transition-all ${
            statusFilter === 'all'
              ? 'ring-2 ring-forest border-forest'
              : 'border-stone-200 hover:border-stone-300'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-semantic-info/10 rounded-lg">
              <Filter className="h-5 w-5 text-semantic-info" />
            </div>
            <div>
              <p className="text-sm text-stone-500">All Media</p>
              <p className="text-2xl font-bold text-stone-900">{stats.total}</p>
            </div>
          </div>
        </button>
      </div>

      {/* Bulk Actions */}
      {selectedItems.size > 0 && (
        <div className="bg-parchment border border-stone-200 rounded-lg p-4 flex items-center gap-4">
          <span className="text-sm font-medium text-stone-700">{selectedItems.size} selected</span>
          <button
            onClick={() => bulkPublishMutation.mutate(Array.from(selectedItems))}
            disabled={bulkPublishMutation.isPending}
            className="px-3 py-1.5 bg-forest text-parchment rounded-md text-sm flex items-center gap-1 hover:bg-forest/90 disabled:opacity-50"
          >
            {bulkPublishMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Globe size={14} />
            )}
            Publish
          </button>
          <button
            onClick={() => bulkUnpublishMutation.mutate(Array.from(selectedItems))}
            disabled={bulkUnpublishMutation.isPending}
            className="px-3 py-1.5 border border-stone-300 text-stone-700 rounded-md text-sm flex items-center gap-1 hover:bg-stone-50 disabled:opacity-50"
          >
            {bulkUnpublishMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <X size={14} />
            )}
            Unpublish
          </button>
          <button
            onClick={() => setSelectedItems(new Set())}
            className="px-3 py-1.5 text-stone-500 text-sm hover:text-stone-700"
          >
            Clear
          </button>
        </div>
      )}

      {/* Media List */}
      <div className="bg-parchment border border-stone-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-stone-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900">
            {statusFilter === 'all' ? 'All Media' :
             statusFilter === 'published' ? 'Published Media' :
             statusFilter === 'draft' ? 'Unpublished Media' :
             'Media with Rights Issues'}
          </h2>
        </div>

        {loadingMedia ? (
          <div className="p-8 text-center">
            <MadronaLoader />
          </div>
        ) : filteredMedia.length === 0 ? (
          <div className="p-8 text-center">
            <Globe className="h-12 w-12 text-stone-300 mx-auto mb-3" />
            <p className="text-stone-500">No media found in this category</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-stone-50">
              <tr>
                <th className="w-8 p-3">
                  <Checkbox
                    checked={selectedItems.size === filteredMedia.length && filteredMedia.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedItems(new Set(filteredMedia.map((m: MediaSearchHit) => m.media_id)));
                      } else {
                        setSelectedItems(new Set());
                      }
                    }}
                  />
                </th>
                <th className="p-3 text-left text-sm font-medium text-stone-600">Media</th>
                <th className="p-3 text-left text-sm font-medium text-stone-600">Status</th>
                <th className="p-3 text-left text-sm font-medium text-stone-600">Rights</th>
                <th className="p-3 text-right text-sm font-medium text-stone-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredMedia.map((item: MediaSearchHit) => {
                const Icon = MEDIA_TYPE_ICONS[item.media_type as keyof typeof MEDIA_TYPE_ICONS] || FileText;
                const hasRightsIssue = !item.copyright_status;

                return (
                  <tr key={item.media_id} className="border-t border-stone-100 hover:bg-stone-50">
                    <td className="p-3">
                      <Checkbox
                        checked={selectedItems.has(item.media_id)}
                        onChange={() => toggleSelect(item.media_id)}
                      />
                    </td>
                    <td className="p-3">
                      <Link
                        to={`/organizations/${orgId}/media/${item.media_id}`}
                        className="flex items-center gap-3 hover:text-forest"
                      >
                        <div className="w-10 h-10 bg-stone-100 rounded flex items-center justify-center">
                          <Icon className="h-5 w-5 text-stone-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-stone-900 truncate">{item.title || item.filename}</p>
                          <p className="text-xs text-stone-500">{item.media_type}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="p-3">
                      {item.is_published ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-semantic-success/10 text-semantic-success text-xs rounded-full">
                          <Globe size={12} />
                          Published
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-stone-100 text-stone-600 text-xs rounded-full">
                          Draft
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {hasRightsIssue ? (
                        <span className="inline-flex items-center gap-1 text-semantic-warning text-sm">
                          <AlertTriangle size={14} />
                          No rights info
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-semantic-success text-sm">
                          <Check size={14} />
                          OK
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {item.is_published ? (
                        <button
                          onClick={() => {
                            setMediaToUnpublish(item);
                            setShowUnpublishDialog(true);
                          }}
                          className="px-3 py-1.5 border border-stone-300 text-stone-700 rounded-md text-sm hover:bg-stone-50"
                        >
                          Unpublish
                        </button>
                      ) : (
                        <button
                          onClick={() => setMediaToPublish(item)}
                          className="px-3 py-1.5 bg-forest text-parchment rounded-md text-sm hover:bg-forest/90"
                        >
                          Publish
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* IIIF Endpoints */}
      <div className="bg-parchment border border-stone-200 rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <LinkIcon className="h-5 w-5 text-stone-600" />
          <h2 className="text-lg font-semibold text-stone-900">IIIF Endpoints</h2>
        </div>
        <p className="text-stone-500 mb-4">
          International Image Interoperability Framework (IIIF) endpoints for your collection
        </p>
        <div className="space-y-3">
          <div className="p-4 bg-stone-50 rounded-lg">
            <div className="flex items-center justify-between mb-1">
              <h4 className="font-medium text-sm text-stone-900">Image API 3.0</h4>
              <button
                onClick={() => copyToClipboard(`${iiifBase}/media/{media_id}/info.json`, 'image')}
                className="text-stone-400 hover:text-stone-700"
              >
                {copiedEndpoint === 'image' ? (
                  <Check className="h-4 w-4 text-semantic-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
            <code className="text-sm text-stone-600 break-all">
              {iiifBase}/media/{'{media_id}'}/info.json
            </code>
          </div>
          <div className="p-4 bg-stone-50 rounded-lg">
            <div className="flex items-center justify-between mb-1">
              <h4 className="font-medium text-sm text-stone-900">Presentation API 3.0</h4>
              <button
                onClick={() => copyToClipboard(`${iiifBase}/{object_id}/manifest.json`, 'presentation')}
                className="text-stone-400 hover:text-stone-700"
              >
                {copiedEndpoint === 'presentation' ? (
                  <Check className="h-4 w-4 text-semantic-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
            <code className="text-sm text-stone-600 break-all">
              {iiifBase}/{'{object_id}'}/manifest.json
            </code>
          </div>
        </div>
      </div>

      {/* Configuration */}
      <div className="grid gap-6">
        <div className="bg-parchment border border-stone-200 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-2">
            <Key className="h-5 w-5 text-stone-600" />
            <h3 className="font-semibold text-stone-900">Public API</h3>
          </div>
          <p className="text-sm text-stone-500 mb-4">
            Enable API access for third-party applications and CMS
            integrations.
          </p>
          <a
            href={`/organizations/${orgId}/admin/api-keys`}
            className="inline-block px-4 py-2 border border-lichen text-ink rounded-sm text-sm hover:bg-stone/20 transition-colors"
          >
            Manage API Keys
          </a>
        </div>
      </div>

      {/* Requirements */}
      <div className="bg-parchment border border-stone-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-stone-900 mb-4">Publishing Requirements</h2>
        <p className="text-stone-500 mb-4">
          Before media can be published, the following must be verified:
        </p>
        <ul className="space-y-3">
          <li className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-stone-400 mt-0.5" />
            <div>
              <p className="font-medium text-stone-900">Rights Verification</p>
              <p className="text-sm text-stone-500">
                Rights status must allow public distribution
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-stone-400 mt-0.5" />
            <div>
              <p className="font-medium text-stone-900">Consent Records</p>
              <p className="text-sm text-stone-500">
                All required consent records must be in place
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-stone-400 mt-0.5" />
            <div>
              <p className="font-medium text-stone-900">Watermark Policy</p>
              <p className="text-sm text-stone-500">
                Watermarks applied if required by organization policy
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-stone-400 mt-0.5" />
            <div>
              <p className="font-medium text-stone-900">Metadata Review</p>
              <p className="text-sm text-stone-500">
                Metadata review completed for sensitive content
              </p>
            </div>
          </li>
        </ul>
      </div>

      {/* Publish Dialog */}
      {mediaToPublish && (
        <PublishMediaDialog
          organizationId={orgId!}
          mediaId={mediaToPublish.media_id}
          mediaTitle={mediaToPublish.title || mediaToPublish.filename}
          onClose={() => setMediaToPublish(null)}
        />
      )}

      {/* Unpublish Dialog */}
      <ConfirmDialog
        isOpen={showUnpublishDialog}
        onClose={() => {
          setShowUnpublishDialog(false);
          setMediaToUnpublish(null);
        }}
        onConfirm={() => {
          if (mediaToUnpublish) {
            unpublishMutation.mutate(mediaToUnpublish.media_id);
          }
        }}
        title="Unpublish Media"
        message={`Are you sure you want to unpublish "${mediaToUnpublish?.title || mediaToUnpublish?.filename}"? Public URLs will no longer work.`}
        confirmText={unpublishMutation.isPending ? 'Unpublishing...' : 'Unpublish'}
        confirmStyle="danger"
      />

    </div>
  );
}
