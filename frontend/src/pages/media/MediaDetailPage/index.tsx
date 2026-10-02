import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Link, Outlet } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Download,
  Trash2,
  Edit2,
  Save,
  X,
  Image,
  Video,
  FileAudio,
  FileText,
  Box,
  Info,
  Clock,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Copy,
  Layers,
  Database,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  MoreHorizontal,
  FolderPlus,
  Link as LinkIcon,
  Code,
  Upload,
  Move,
  Film,
  Lock,
  Unlock,
  Maximize2,
  Image as ImageIcon,
  Tag,
  ListChecks,
} from 'lucide-react';
import { getMedia, updateMedia, deleteMedia, getMediaDerivatives, logMediaUsage, getMediaUsageStats, listMediaRights, reviewMetadata, clearMetadataReview, searchMedia, reprocessMedia, generateMediaDescriptions } from '../../../lib/api';
import type { MediaDerivative } from '../../../lib/schemas';
import { MediaTagsManager, InheritedFieldsPanel } from '../../../components/dam';

import DublinCoreEditor from '../../../components/dam/DublinCoreEditor';
import IPTCEditor from '../../../components/dam/IPTCEditor';
import { getAlternatives, lockMedia, unlockMedia } from '../../../lib/api/media-dam';
import { AlternativeFilesTab } from '../../../components/dam/AlternativeFilesTab';
import { SimilarMediaPanel } from '../../../components/dam/SimilarMediaPanel';
import { EmbedCodeGenerator } from '../../../components/dam/EmbedCodeGenerator';
import AudioWaveformPlayer from '../../../components/media/AudioWaveformPlayer';
import VideoPlayer from '../../../components/media/VideoPlayer';
import PDFViewer from '../../../components/media/PDFViewer';
import IIIFViewer from '../../../components/IIIFViewer';
import { createPortal } from 'react-dom';
import { AddToMediaWorkspaceDialog } from '../../../components/media-workspaces';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { RequestDownloadModal } from '../../../components/dam/RequestDownloadModal';
import { RecordDiscussionTab } from '../../../components/RecordDiscussionTab';
import { cn } from '../../../lib/utils';
import { apiFetch } from '../../../lib/api';
import { downloadWithFilename } from '../../../lib/download';
import { useToast } from '../../../contexts/ToastContext';
import { usePermissions } from '@/hooks/usePermissions';
import { logger } from '../../../lib/logger';
import { formatDateShort } from '@/lib/formatters';
import { MediaDetailTabs, ALL_TABS } from './MediaDetailTabs';
import { StartProcedure } from '../../../components/studio/StartProcedure';
import { useMediaTabNavigation } from './useMediaTabNavigation';
import { computeRightsStatus, DERIVATIVE_PURPOSE } from './types';
import { resolveMediaBackLink } from './backLink';
import type { MediaDetailOutletContext } from './types';

const MEDIA_TYPE_ICONS = {
  image: Image,
  video: Video,
  audio: FileAudio,
  document: FileText,
  model_3d: Box,
};

export default function MediaDetailPage() {
  const { orgId, mediaId } = useParams<{ orgId: string; mediaId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // When arriving from another surface (e.g. a Collections object record), honor
  // a relative returnTo so the back-link sends the user where they came from.
  const { href: backHref, label: backLabel } = resolveMediaBackLink(searchParams.get('returnTo'), orgId);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<{ title: string; description: string; alt_text: string; caption: string; credit: string; copyright_notice: string }>>({});
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showAddToWorkspace, setShowAddToWorkspace] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showDownloadRequest, setShowDownloadRequest] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);

  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('media.edit');
  const canDelete = hasPermission('media.delete');
  const canAdmin = hasPermission('media.admin');
  const canDownloadDerivatives = hasPermission('media.download_derivatives');
  // Downloading an original needs media.download_original — the viewer role
  // deliberately lacks it. The server enforces this; without the same check
  // here the button renders and 403s. Those who lack it are routed to the
  // download-request workflow, which exists for exactly this case.
  const canDownloadOriginal = hasPermission('media.download_original');

  const togglePreviewCollapsed = useCallback((value: boolean) => {
    setPreviewCollapsed(value);
  }, []);

  const { activeTab, goToTab, isOnSubRoute } = useMediaTabNavigation(orgId!, mediaId!);

  // --- Data fetching ---
  const { data: media, isLoading, error } = useQuery({
    queryKey: ['media', orgId, mediaId],
    queryFn: () => getMedia(orgId!, mediaId!),
    enabled: !!orgId && !!mediaId,
  });

  const { data: derivativesData } = useQuery({
    queryKey: ['media-derivatives', orgId, mediaId],
    queryFn: () => getMediaDerivatives(orgId!, mediaId!),
    enabled: !!orgId && !!mediaId,
  });

  const { data: alternativesData } = useQuery({
    queryKey: ['media-alternatives', orgId, mediaId],
    queryFn: () => getAlternatives(orgId!, mediaId!),
    enabled: !!orgId && !!mediaId,
  });

  const subtitleTracks = useMemo(() => {
    const alts = alternativesData?.alternatives || [];
    return alts
      .filter((a) => a.alternative_type === 'subtitle_vtt' || a.alternative_type === 'subtitle_srt')
      .map((a) => ({
        src: `/api/organizations/${orgId}/media/${mediaId}/alternatives/${a.alternative_id}/download`,
        label: a.label || (a.alternative_type === 'subtitle_vtt' ? 'Subtitles (VTT)' : 'Subtitles (SRT)'),
        srclang: 'en',
        kind: 'subtitles' as const,
        default: a.alternative_type === 'subtitle_vtt',
      }));
  }, [alternativesData, orgId, mediaId]);

  const { data: rightsData } = useQuery({
    queryKey: ['media-rights', orgId, mediaId],
    queryFn: () => listMediaRights(orgId!, mediaId!),
    enabled: !!orgId && !!mediaId,
  });

  const { data: relatedMediaData } = useQuery({
    queryKey: ['related-media', orgId, media?.folder],
    queryFn: () => searchMedia(orgId!, { folder: media?.folder ?? undefined, limit: 5 }),
    enabled: !!orgId && !!media?.folder,
  });

  const rightsStatus = useMemo(() => {
    const rights = rightsData?.rights || [];
    return computeRightsStatus(rights);
  }, [rightsData?.rights]);

  const relatedMedia = useMemo(() => {
    const items = relatedMediaData?.hits || [];
    return items.filter((m: { media_id: string }) => m.media_id !== mediaId).slice(0, 4);
  }, [relatedMediaData, mediaId]);

  // --- Mutations ---
  const updateMutation = useMutation({
    mutationFn: (updates: Partial<{ title?: string; description?: string; alt_text?: string; caption?: string; credit?: string; copyright_notice?: string; metadata?: Record<string, any>; iptc_metadata?: Record<string, string | null>; dublin_core?: Record<string, string | null> }>) => updateMedia(orgId!, mediaId!, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', orgId, mediaId] });
      setIsEditing(false);
      showToast({ title: 'Changes saved', type: 'success' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMedia(orgId!, mediaId!),
    onSuccess: () => { navigate(`/organizations/${orgId}/media`); },
  });

  const generateDescriptionsMutation = useMutation({
    mutationFn: () => generateMediaDescriptions(orgId!, mediaId!),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['media', orgId, mediaId] });
      showToast({
        title: result.sensitivity_flag
          ? 'Descriptions generated — sensitivity flag set, please review'
          : 'AI descriptions generated',
        type: result.sensitivity_flag ? 'info' : 'success',
      });
    },
    onError: (e: Error) => {
      showToast({ title: e.message || 'Generation failed', type: 'error' });
    },
  });

  const reviewMetadataMutation = useMutation({
    mutationFn: (notes?: string) => reviewMetadata(orgId!, mediaId!, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', orgId, mediaId] });
      showToast({ title: 'Marked as reviewed', type: 'success' });
    },
  });

  const clearReviewMutation = useMutation({
    mutationFn: () => clearMetadataReview(orgId!, mediaId!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['media', orgId, mediaId] }); },
  });

  const reprocessMutation = useMutation({
    mutationFn: () => reprocessMedia(orgId!, mediaId!),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['media', orgId, mediaId] });
      queryClient.invalidateQueries({ queryKey: ['media-derivatives', orgId, mediaId] });
      queryClient.invalidateQueries({ queryKey: ['media-ai-tags', orgId, mediaId] });
      const features = data.features as Record<string, boolean> | undefined;
      let message = data.message || 'Reprocessing started';
      if (features) {
        const disabled = Object.entries(features)
          .filter(([, enabled]) => !enabled)
          .map(([name]) => name === 'ai_tagging' ? 'AI tagging' : name.toUpperCase());
        if (disabled.length > 0) message += ` (${disabled.join(', ')} disabled)`;
      }
      showToast({ title: message, type: 'success' });
      goToTab('history');
    },
    onError: (error) => {
      showToast({ title: `Failed to start reprocessing: ${(error as Error).message}`, type: 'error' });
    },
  });

  const lockMutation = useMutation({
    mutationFn: () => lockMedia(orgId!, mediaId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', orgId, mediaId] });
      showToast({ title: 'Media locked for editing', type: 'success' });
    },
    onError: (error) => { showToast({ title: `Failed to lock: ${(error as Error).message}`, type: 'error' }); },
  });

  const unlockMutation = useMutation({
    mutationFn: () => unlockMedia(orgId!, mediaId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', orgId, mediaId] });
      showToast({ title: 'Media unlocked', type: 'success' });
    },
    onError: (error) => { showToast({ title: `Failed to unlock: ${(error as Error).message}`, type: 'error' }); },
  });

  const isLocked = !!media?.locked_by;
  const isLockedByMe = media?.locked_by === media?.current_user_id;
  const lockedBy = media?.locked_by_name || media?.locked_by;

  const { data: usageStats } = useQuery({
    queryKey: ['media-usage', orgId, mediaId],
    queryFn: () => getMediaUsageStats(orgId!, mediaId!, 30),
    enabled: !!orgId && !!mediaId,
  });

  useEffect(() => {
    if (orgId && mediaId && media) {
      logMediaUsage(orgId, mediaId, 'view', { access_context: 'internal' })
        .catch((e) => logger.warn('Media usage log failed:', e));
    }
  }, [orgId, mediaId, media?.media_id]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) { setIsFullscreen(false); return; }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const filteredTabs = ALL_TABS.filter(t => {
          if (t.mediaTypes) return t.mediaTypes.includes(media?.media_type || '');
          return true;
        });
        const currentIndex = filteredTabs.findIndex(t => t.key === activeTab);
        if (e.key === 'ArrowLeft' && currentIndex > 0) goToTab(filteredTabs[currentIndex - 1].key);
        else if (e.key === 'ArrowRight' && currentIndex < filteredTabs.length - 1) goToTab(filteredTabs[currentIndex + 1].key);
      }

      if (e.key === 'f' && media?.media_type === 'image') {
        setIsFullscreen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, isFullscreen, media?.media_type, goToTab]);

  // Drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false);
    if (Array.from(e.dataTransfer.files).length > 0) {
      goToTab('history');
      showToast({ title: 'Drop file in Versions tab to upload new version', type: 'info' });
    }
  }, [showToast, goToTab]);

  const handleEdit = () => {
    setEditForm({ title: media?.title || '', description: media?.description || '', alt_text: media?.alt_text || '', caption: media?.caption || '', credit: media?.credit || '', copyright_notice: media?.copyright_notice || '' });
    setIsEditing(true);
  };
  const handleSave = () => { updateMutation.mutate(editForm); };
  const handleCancel = () => { setIsEditing(false); setEditForm({}); };

  const copyToClipboard = (text: string, label: string = 'URL') => {
    navigator.clipboard.writeText(text);
    showToast({ title: `${label} copied to clipboard`, type: 'success' });
  };

  const [showEmbedPanel, setShowEmbedPanel] = useState(false);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-stone/50 rounded w-48" />
          <div className="h-80 bg-stone/50 rounded-lg" />
          <div className="h-10 bg-stone/50 rounded" />
          <div className="h-48 bg-stone/50 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !media) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 text-semantic-error">
          {error ? `Error loading media: ${(error as Error).message}` : 'Media not found'}
        </div>
      </div>
    );
  }

  const Icon = MEDIA_TYPE_ICONS[media.media_type as keyof typeof MEDIA_TYPE_ICONS] || FileText;
  const derivatives = derivativesData?.derivatives || [];
  const basePath = `/organizations/${orgId}/media/${mediaId}`;

  const outletContext: MediaDetailOutletContext = {
    organizationId: orgId!,
    mediaId: mediaId!,
    media,
    rightsStatus,
    setPreviewCollapsed: togglePreviewCollapsed,
    queryClient,
    usageStats,
    reviewMetadataMutation,
    clearReviewMutation,
  };

  return (
    <>
      <div
        ref={dropZoneRef}
        className={cn("max-w-5xl mx-auto px-4 py-6 space-y-6 transition-colors", isDraggingOver && "bg-bark/5")}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDraggingOver && (
          <div className="fixed inset-0 bg-bark/10 z-40 flex items-center justify-center pointer-events-none">
            <div className="bg-parchment rounded-lg shadow-lg p-8 text-center">
              <Upload size={48} className="mx-auto text-bark mb-4" />
              <p className="text-lg font-medium text-ink">Drop to upload new version</p>
            </div>
          </div>
        )}

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm">
          <Link to={backHref} className="text-archive hover:text-bark transition-colors">{backLabel}</Link>
          <ChevronRight size={14} className="text-archive" />
          <span className="text-ink font-medium truncate max-w-[300px]">{media.title || media.filename}</span>
        </nav>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <Link to={backHref} aria-label={backLabel} className="p-2 hover:bg-stone/50 rounded-lg flex-shrink-0 mt-1">
              <ArrowLeft size={20} className="text-archive" />
            </Link>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-ink truncate">{media.title || media.filename}</h1>
              <div className="flex items-center gap-3 mt-1 text-sm text-archive">
                <span className="flex items-center gap-1.5"><Icon size={14} />{media.mime_type}</span>
                <span>•</span>
                <span>{formatFileSize(media.file_size)}</span>
                {media.width && media.height && (<><span>•</span><span>{media.width}×{media.height}</span></>)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Guided (Studio) procedure — deterministic rights-and-publish plan,
                media_id supplied from context so it runs in hand. */}
            {mediaId && (
              <StartProcedure
                requiresContext="media_id"
                contextEntityType="media"
                contextEntityId={mediaId}
                label="Start guided"
              />
            )}
            {isLocked && !isLockedByMe ? (
              <span className="flex items-center gap-1.5 px-3 py-2 text-sm text-semantic-warning bg-semantic-warning/10 rounded-lg" title={`Locked by ${lockedBy}`}>
                <Lock size={14} />Locked by {lockedBy}
              </span>
            ) : isLocked && isLockedByMe ? (
              <button onClick={() => { if (canAdmin) unlockMutation.mutate(); }} disabled={!canAdmin || unlockMutation.isPending} title={!canAdmin ? "You don't have permission" : "Click to unlock"} className={`flex items-center gap-1.5 px-3 py-2 text-sm border border-semantic-warning/30 text-semantic-warning rounded-lg hover:bg-semantic-warning/10 transition-colors ${!canAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <Lock size={14} />Locked by you
              </button>
            ) : (
              <button onClick={() => { if (canAdmin) lockMutation.mutate(); }} disabled={!canAdmin || lockMutation.isPending} title={!canAdmin ? "You don't have permission" : "Lock for editing"} className={`flex items-center gap-1.5 px-3 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/30 transition-colors ${!canAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <Unlock size={14} className="text-archive" />
              </button>
            )}

            {/* Quick Actions */}
            <div className="relative">
              <button onClick={() => setShowQuickActions(!showQuickActions)} className="flex items-center gap-2 px-3 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/30 transition-colors">
                <MoreHorizontal size={16} />Actions
              </button>
              {showQuickActions && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowQuickActions(false)} />
                  <div className="absolute right-0 top-full mt-1 w-56 bg-parchment border border-lichen rounded-lg shadow-lg py-1 z-20">
                    <button onClick={() => { setShowQuickActions(false); setShowAddToWorkspace(true); }} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-stone/30">
                      <FolderPlus size={16} className="text-archive" />Add to Work Set
                    </button>
                    <button onClick={() => { setShowQuickActions(false); setShowCreateTask(true); }} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-stone/30">
                      <ListChecks size={16} className="text-archive" />Create Task
                    </button>
                    {/* Copy Direct Link hands out media.url — a presigned URL
                        to the ORIGINAL file. That is a download by another
                        name, and a shareable one, so it takes the same two
                        conditions as the Download button: the role permission
                        and the rights decision. Without them a viewer could
                        copy a link to an asset they may not download, or to
                        one whose rights are expired. */}
                    {media.url && canDownloadOriginal && media.download_access === 'direct' && (
                      <>
                        <button onClick={() => { copyToClipboard(media.url!, 'Direct link'); setShowQuickActions(false); }} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-stone/30">
                          <LinkIcon size={16} className="text-archive" />Copy Direct Link
                        </button>
                        <button onClick={() => { setShowEmbedPanel(true); setShowQuickActions(false); }} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-stone/30">
                          <Code size={16} className="text-archive" />Embed Code
                        </button>
                      </>
                    )}
                    <div className="border-t border-lichen my-1" />
                    <button
                      onClick={() => { if (canEdit) { goToTab('history'); setShowQuickActions(false); } }}
                      disabled={!canEdit}
                      title={!canEdit ? "You don't have permission" : undefined}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-stone/30 ${!canEdit ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
                    >
                      <Upload size={16} className="text-archive" />Upload New Version
                    </button>
                    <div className="border-t border-lichen my-1" />
                    <button
                      onClick={() => { if (canEdit) { reprocessMutation.mutate(); setShowQuickActions(false); } }}
                      disabled={!canEdit || reprocessMutation.isPending || media?.processing_status === 'processing'}
                      title={!canEdit ? "You don't have permission" : undefined}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-stone/30 disabled:opacity-50 ${!canEdit ? 'cursor-not-allowed pointer-events-none' : ''}`}
                    >
                      <RefreshCw size={16} className={cn("text-archive", reprocessMutation.isPending && "animate-spin")} />
                      {reprocessMutation.isPending ? 'Reprocessing...' : 'Reprocess Media'}
                    </button>
                    {canDelete && (
                      <>
                        <div className="border-t border-lichen my-1" />
                        <button onClick={() => { setShowDeleteDialog(true); setShowQuickActions(false); }} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left text-semantic-error hover:bg-semantic-error/10">
                          <Trash2 size={16} />Delete Asset
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {media.url && media.download_access === 'direct' && canDownloadOriginal && (
              <button
                onClick={async () => {
                  try {
                    // Fetch the URL from the permission-gated download
                    // endpoint rather than reusing media.url, which is
                    // minted with url_type=VIEW and therefore needs only
                    // media.view — using it to download bypassed
                    // media.download_original entirely.
                    const { download_url } = await apiFetch<{ download_url: string }>(
                      `/organizations/${orgId}/media/${mediaId}/download`,
                    );
                    await downloadWithFilename(download_url, media.filename || 'download');
                    logMediaUsage(orgId!, mediaId!, 'download', { derivative_type: 'original', access_context: 'internal' }).catch((e) => logger.warn('Media usage log failed:', e));
                  } catch (err: any) {
                    // Handle rights change mid-session
                    if (err?.status === 403) {
                      showToast({ title: 'Download request required — rights may have changed', type: 'info' });
                      setShowDownloadRequest(true);
                    } else {
                      logMediaUsage(orgId!, mediaId!, 'download', { derivative_type: 'original', access_context: 'internal' }).catch((e) => logger.warn('Media usage log failed:', e));
                    }
                  }
                }}
                className="flex items-center gap-2 px-3 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/30 transition-colors"
                title="Download original file"
              >
                <Download size={16} /><span className="hidden sm:inline">Download</span>
              </button>
            )}
            {media.url && (media.download_access === 'request'
              || (media.download_access === 'direct' && !canDownloadOriginal)) && (
              <button
                onClick={() => setShowDownloadRequest(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/30 transition-colors"
                title="Submit a download request for approval"
              >
                <Download size={16} /><span className="hidden sm:inline">Request Download</span>
              </button>
            )}
            {media.url && media.download_access === 'blocked' && (
              <button
                disabled
                title="Rights expired or restricted — download unavailable"
                className="flex items-center gap-2 px-3 py-2 text-sm border border-lichen rounded-lg opacity-50 cursor-not-allowed"
              >
                <Download size={16} /><span className="hidden sm:inline">Download</span>
              </button>
            )}
          </div>
        </div>

        {/* Status Strip */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => goToTab('rights')} className={cn('px-2.5 py-1 text-xs rounded-full cursor-pointer transition-colors', media.is_published ? 'bg-semantic-success/10 text-semantic-success' : 'bg-stone text-archive')}>
            {media.is_published ? 'Published' : 'Draft'}
          </button>
          {rightsStatus.status === 'incomplete' && (
            <button onClick={() => goToTab('rights')} className="px-2.5 py-1 text-xs rounded-full cursor-pointer bg-semantic-warning/10 text-semantic-warning transition-colors">Rights: add details</button>
          )}
          {!media.metadata_reviewed && (
            <button onClick={() => goToTab('rights')} className="px-2.5 py-1 text-xs rounded-full cursor-pointer bg-semantic-warning/10 text-semantic-warning transition-colors">Content review: pending</button>
          )}
          {(media.current_version ?? 0) > 1 && (
            <button onClick={() => goToTab('history')} className="px-2.5 py-1 text-xs rounded-full cursor-pointer bg-stone text-archive transition-colors">v{media.current_version}</button>
          )}
        </div>

        {/* Preview */}
        <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
          {media.media_type === 'image' && (
            <div className="flex items-center justify-between px-4 py-2 border-b border-lichen bg-stone/20">
              <span className="text-xs text-archive hidden sm:block">
                {media.media_type === 'image'
                  ? 'Scroll to zoom \u00b7 Drag to pan'
                  : <>Press <kbd className="px-1.5 py-0.5 bg-parchment rounded border border-lichen text-[10px]">F</kbd> for fullscreen</>}
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <button onClick={() => setIsFullscreen(true)} className="p-1.5 hover:bg-parchment rounded transition-colors" title="Fullscreen (F)">
                  <Maximize2 size={16} className="text-archive" />
                </button>
                <button onClick={() => togglePreviewCollapsed(!previewCollapsed)} className="p-1.5 hover:bg-parchment rounded transition-colors" title={previewCollapsed ? 'Expand preview' : 'Collapse preview'}>
                  {previewCollapsed ? <ChevronDown size={16} className="text-archive" /> : <ChevronUp size={16} className="text-archive" />}
                </button>
              </div>
            </div>
          )}

          <div
            className={cn("bg-stone/30 overflow-hidden relative group", (media.media_type === 'video' || media.media_type === 'document') ? "flex flex-col" : "flex items-center justify-center")}
            style={previewCollapsed ? { maxHeight: '80px' } : media.media_type === 'video' ? { height: '480px' } : { height: '560px' }}
          >
            {media.media_type === 'image' && (media.url || media.preview_url) ? (
              <>
                {/* url is the largest rendition (large → medium → small); preview_url
                    is the 600px small, fine for a grid card but soft in a
                    zoom viewer. Prefer the bigger one now that the master is
                    no longer available for display at all. */}
              <img src={(media.url ?? media.preview_url) || undefined} alt={media.alt_text || media.title || media.filename} className="max-w-full max-h-full object-contain" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }} />
                <div className="hidden flex items-center justify-center w-full h-64 bg-stone rounded-institutional">
                  <ImageIcon className="w-12 h-12 text-archive" /><p className="text-archive mt-2">Image failed to load</p>
                </div>
              </>
            ) : media.media_type === 'video' && media.url ? (
              <VideoPlayer url={media.url} mimeType={media.mime_type} posterUrl={media.thumbnail_url || undefined} subtitles={subtitleTracks.length > 0 ? subtitleTracks : undefined} metadata={{ width: media.width ?? undefined, height: media.height ?? undefined, duration_seconds: media.duration_seconds ?? undefined, ...(media.technical_metadata as Record<string, any> || {}) }} />
            ) : media.media_type === 'audio' && media.url ? (
              <AudioWaveformPlayer url={media.url} duration={media.duration_seconds} peaks={(media.technical_metadata as any)?.waveform_peaks} metadata={media.technical_metadata as any} />
            ) : media.media_type === 'document' && media.url ? (
              <PDFViewer url={media.url} />
            ) : (
              <div className="text-center p-12">
                <Icon size={48} className="mx-auto text-archive mb-4" /><p className="text-archive">Preview not available</p>
                {media.url && (
                  <a href={media.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 mt-4 px-3 py-2 text-sm border border-lichen rounded-lg hover:bg-parchment transition-colors">
                    <ExternalLink size={16} />Open File
                  </a>
                )}
              </div>
            )}
          </div>

          {media.processing_status && media.processing_status !== 'completed' && (
            <div className={cn('px-4 py-3 flex items-center gap-2 border-t', media.processing_status === 'failed' && 'bg-semantic-error/10 text-semantic-error', media.processing_status === 'processing' && 'bg-semantic-info/10 text-semantic-info', media.processing_status === 'pending' && 'bg-semantic-warning/10 text-semantic-warning')}>
              {media.processing_status === 'processing' ? <RefreshCw size={16} className="animate-spin" /> : media.processing_status === 'failed' ? <AlertCircle size={16} /> : <Clock size={16} />}
              <span className="text-sm font-medium">
                {media.processing_status === 'processing' ? 'Processing...' : media.processing_status === 'failed' ? 'Processing failed' : 'Waiting to process'}
              </span>
              {(media.processing_status === 'failed' || media.processing_status === 'pending') && (
                <button onClick={() => { if (canEdit) reprocessMutation.mutate(); }} disabled={!canEdit || reprocessMutation.isPending} title={!canEdit ? "You don't have permission" : undefined} className={cn('ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors', media.processing_status === 'failed' ? 'bg-semantic-error/20 hover:bg-semantic-error/30 text-semantic-error' : 'bg-semantic-warning/20 hover:bg-semantic-warning/30 text-semantic-warning', !canEdit && 'opacity-50 cursor-not-allowed')}>
                  <RefreshCw size={14} className={reprocessMutation.isPending ? 'animate-spin' : ''} />
                  {reprocessMutation.isPending ? 'Starting...' : 'Retry'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Tab bar */}
        <MediaDetailTabs mediaType={media.media_type} activeTab={activeTab} onTabChange={goToTab} rightsStatus={rightsStatus} basePath={basePath} />

        {/* Content: inline tabs OR sub-route Outlet */}
        <div className="bg-parchment border border-lichen rounded-lg">
          {isOnSubRoute ? (
            <Outlet context={outletContext} />
          ) : (
            <>
              {activeTab === 'details' && (
                <div className="p-4 sm:p-6">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-6">
                      <div>
                        <h3 className="text-sm font-medium text-ink mb-3">File Information</h3>
                        <dl className="bg-stone/20 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                          <div><dt className="text-archive">Filename</dt><dd className="font-medium text-ink mt-0.5">{media.filename}</dd></div>
                          <div><dt className="text-archive">Created</dt><dd className="font-medium text-ink mt-0.5">{media.created_at && formatDateShort(media.created_at)}</dd></div>
                          {media.folder && <div><dt className="text-archive">Folder</dt><dd className="text-ink mt-0.5">{media.folder}</dd></div>}
                        </dl>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-medium text-ink">Details</h3>
                          {!isEditing ? (
                            <button onClick={() => { if (canEdit) handleEdit(); }} disabled={!canEdit} title={!canEdit ? "You don't have permission" : undefined} className={`flex items-center gap-1.5 text-xs text-bark hover:text-copper-dark transition-colors ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}><Edit2 size={12} />Edit</button>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button onClick={handleCancel} disabled={updateMutation.isPending} className="flex items-center gap-1 text-xs text-archive hover:text-ink transition-colors"><X size={12} />Cancel</button>
                              <button onClick={handleSave} disabled={updateMutation.isPending} className="flex items-center gap-1 text-xs text-bark hover:text-copper-dark transition-colors"><Save size={12} />{updateMutation.isPending ? 'Saving...' : 'Save'}</button>
                            </div>
                          )}
                        </div>

                        {isEditing ? (
                          <div className="bg-stone/20 rounded-lg p-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                              <div className="sm:col-span-2"><label className="block text-xs font-medium text-archive mb-1">Title</label><input type="text" value={editForm.title || ''} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className="w-full px-3 py-1.5 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark bg-parchment" /></div>
                              <div className="sm:col-span-2"><label className="block text-xs font-medium text-archive mb-1">Description</label><textarea value={editForm.description || ''} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={2} className="w-full px-3 py-1.5 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark bg-parchment" /></div>
                              <div className="sm:col-span-2"><label className="block text-xs font-medium text-archive mb-1">Alt Text</label><input type="text" value={editForm.alt_text || ''} onChange={(e) => setEditForm({ ...editForm, alt_text: e.target.value })} className="w-full px-3 py-1.5 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark bg-parchment" placeholder="Describe image for accessibility" /></div>
                              <div><label className="block text-xs font-medium text-archive mb-1">Caption</label><input type="text" value={editForm.caption || ''} onChange={(e) => setEditForm({ ...editForm, caption: e.target.value })} className="w-full px-3 py-1.5 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark bg-parchment" /></div>
                              <div><label className="block text-xs font-medium text-archive mb-1">Credit</label><input type="text" value={editForm.credit || ''} onChange={(e) => setEditForm({ ...editForm, credit: e.target.value })} className="w-full px-3 py-1.5 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark bg-parchment" placeholder="Photographer or source" /></div>
                              <div className="sm:col-span-2"><label className="block text-xs font-medium text-archive mb-1">Copyright Notice</label><input type="text" value={editForm.copyright_notice || ''} onChange={(e) => setEditForm({ ...editForm, copyright_notice: e.target.value })} className="w-full px-3 py-1.5 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark bg-parchment" placeholder="© 2024 Organization Name" /></div>
                            </div>
                          </div>
                        ) : (
                          <dl className="bg-stone/20 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                            {media.title && <div className="sm:col-span-2"><dt className="text-archive">Title</dt><dd className="font-medium text-ink mt-0.5">{media.title}</dd></div>}
                            {media.description && <div className="sm:col-span-2"><dt className="text-archive">Description</dt><dd className="text-ink mt-0.5">{media.description}</dd></div>}
                            {media.alt_text && <div className="sm:col-span-2"><dt className="text-archive">Alt Text</dt><dd className="text-ink mt-0.5">{media.alt_text}</dd></div>}
                            {media.caption && <div><dt className="text-archive">Caption</dt><dd className="text-ink mt-0.5">{media.caption}</dd></div>}
                            {media.credit && <div><dt className="text-archive">Credit</dt><dd className="text-ink mt-0.5">{media.credit}</dd></div>}
                            {media.copyright_notice && <div className="sm:col-span-2"><dt className="text-archive">Copyright</dt><dd className="text-ink mt-0.5">{media.copyright_notice}</dd></div>}
                            {!media.title && !media.description && !media.alt_text && !media.caption && !media.credit && !media.copyright_notice && (
                              <div className="sm:col-span-2 text-archive text-xs py-2">No details added yet. Click Edit to add title, description, and more.</div>
                            )}
                          </dl>
                        )}
                      </div>

                      {/* AI descriptions (Cooper Hewitt three-tier pattern) — images only */}
                      {media.media_type === 'image' && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-medium text-ink">AI-generated descriptions</h3>
                            <button
                              type="button"
                              onClick={() => generateDescriptionsMutation.mutate()}
                              disabled={generateDescriptionsMutation.isPending}
                              className="btn btn-secondary text-xs px-3 py-1 flex items-center gap-1"
                              title="Generate short alt text, long description, and emoji summary via Claude vision"
                            >
                              {generateDescriptionsMutation.isPending
                                ? 'Generating…'
                                : media.ai_descriptions_generated_at
                                  ? 'Regenerate'
                                  : 'Generate'}
                            </button>
                          </div>
                          {(media.ai_alt_text || media.ai_description_long || media.ai_description_emoji) ? (
                            <dl className="bg-stone/20 rounded-lg p-4 space-y-3 text-sm">
                              {media.ai_description_emoji && (
                                <div>
                                  <dt className="text-archive text-xs">Emoji summary</dt>
                                  <dd className="text-2xl mt-0.5">{media.ai_description_emoji}</dd>
                                </div>
                              )}
                              {media.ai_alt_text && (
                                <div>
                                  <div className="flex items-center justify-between">
                                    <dt className="text-archive text-xs">Alt text (~15 words)</dt>
                                    <button
                                      type="button"
                                      onClick={() => updateMutation.mutate({ alt_text: media.ai_alt_text || '' })}
                                      disabled={updateMutation.isPending || media.alt_text === media.ai_alt_text}
                                      className="text-xs text-bark hover:text-copper-dark disabled:opacity-50"
                                      title={media.alt_text === media.ai_alt_text ? 'Already promoted to canonical alt text' : 'Promote to canonical alt text (replaces the current value)'}
                                    >
                                      {media.alt_text === media.ai_alt_text ? '✓ Using' : 'Use as alt'}
                                    </button>
                                  </div>
                                  <dd className="text-ink mt-0.5">{media.ai_alt_text}</dd>
                                </div>
                              )}
                              {media.ai_description_long && (
                                <div>
                                  <div className="flex items-center justify-between">
                                    <dt className="text-archive text-xs">Long description (~100–300 words)</dt>
                                    <button
                                      type="button"
                                      onClick={() => updateMutation.mutate({ description: media.ai_description_long || '' })}
                                      disabled={updateMutation.isPending || media.description === media.ai_description_long}
                                      className="text-xs text-bark hover:text-copper-dark disabled:opacity-50"
                                      title={media.description === media.ai_description_long ? 'Already promoted to description' : 'Promote to canonical description (replaces the current value)'}
                                    >
                                      {media.description === media.ai_description_long ? '✓ Using' : 'Use as description'}
                                    </button>
                                  </div>
                                  <dd className="text-ink mt-0.5 whitespace-pre-wrap">{media.ai_description_long}</dd>
                                </div>
                              )}
                              {media.ai_descriptions_generated_at && (
                                <div className="text-xs text-archive pt-2 border-t border-lichen">
                                  Generated {new Date(media.ai_descriptions_generated_at).toLocaleString()}
                                  {media.ai_descriptions_model && <> · {media.ai_descriptions_model}</>}
                                </div>
                              )}
                            </dl>
                          ) : (
                            <p className="text-xs text-archive italic">
                              Generate three tiers of description (alt text, long description, and emoji) via Claude vision.
                              Nothing is promoted to the canonical alt text or description automatically — review and click <em>Use as…</em> to adopt.
                            </p>
                          )}
                        </div>
                      )}

                      {media.url && (
                        <div>
                          <h3 className="text-sm font-medium text-ink mb-2">URL</h3>
                          <div className="flex items-center gap-2 p-2 bg-stone/30 rounded-lg">
                            <code className="text-xs text-archive flex-1 truncate">{media.url}</code>
                            <button onClick={() => copyToClipboard(media.url!, 'URL')} className="p-1.5 hover:bg-parchment rounded transition-colors" title="Copy URL"><Copy size={14} className="text-archive" /></button>
                          </div>
                        </div>
                      )}

                      <div className="pt-4 border-t border-lichen">
                        <InheritedFieldsPanel organizationId={orgId!} mediaId={mediaId!} context="detail" />
                      </div>
                    </div>

                    <div className="lg:border-l lg:border-lichen lg:pl-6">
                      <div className="flex items-center gap-2 mb-3"><Tag size={16} className="text-archive" /><h3 className="text-sm font-medium text-ink">Tags</h3></div>
                      <MediaTagsManager organizationId={orgId!} mediaId={mediaId!} readonly={isEditing} />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'derivatives' && (
                <div className="p-4 sm:p-6">
                  <p className="text-sm text-archive mb-4">Derivatives are optimized versions of this file for different uses.</p>
                  {derivatives.length === 0 ? (
                    <div className="text-center py-12 bg-stone/20 rounded-lg">
                      <Layers size={32} className="mx-auto text-archive mb-3" />
                      <p className="text-sm text-archive">{media.processing_status === 'completed' ? 'No derivatives generated' : 'Derivatives will be generated after processing'}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {derivatives.filter((d: MediaDerivative) => d.derivative_type !== 'poster').map((d: MediaDerivative) => {
                        const purpose = DERIVATIVE_PURPOSE[d.derivative_type] || { label: d.derivative_type, description: 'Processed version' };
                        return (
                          <div key={d.derivative_id} className="flex items-center gap-3 p-3 bg-stone/20 rounded-lg border border-transparent hover:border-lichen transition-colors">
                            <div className="w-14 h-14 bg-parchment rounded-lg overflow-hidden flex-shrink-0 border border-lichen">
                              {d.format && ['mp4', 'webm', 'mov'].includes(d.format.toLowerCase()) ? (
                                media.thumbnail_url ? <img src={media.thumbnail_url} alt={d.derivative_type} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-ink/5"><Film size={20} className="text-archive" /></div>
                              ) : d.s3_key && d.url ? (
                                <img src={d.url} alt={d.derivative_type} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center"><Image size={20} className="text-archive" /></div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-ink">{purpose.label}</p>
                              <p className="text-xs text-archive">{purpose.description}</p>
                              <p className="text-xs text-archive mt-1">{d.width}×{d.height} • {d.format?.toUpperCase()}</p>
                            </div>
                            {d.url && canDownloadDerivatives && <a href={d.url} target="_blank" rel="noopener noreferrer" className="p-2 hover:bg-parchment rounded-lg text-archive hover:text-ink transition-colors" title="Open in new tab"><ExternalLink size={16} /></a>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'metadata' && (
                <div className="p-4 sm:p-6 space-y-6">
                  {media.technical_metadata && Object.keys(media.technical_metadata).length > 0 ? (
                    <div>
                      <h3 className="text-sm font-medium text-ink mb-3 flex items-center gap-2"><Info size={14} />Technical (EXIF)</h3>
                      <div className="bg-stone/20 rounded-lg p-4">
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                          {Object.entries(media.technical_metadata).slice(0, 12).map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-2"><dt className="text-archive truncate">{k}</dt><dd className="text-ink font-medium truncate">{String(v)}</dd></div>
                          ))}
                        </dl>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 bg-stone/20 rounded-lg"><Database size={32} className="mx-auto text-archive mb-3" /><p className="text-sm text-archive">No technical metadata extracted</p></div>
                  )}
                  <IPTCEditor iptcMetadata={media.iptc_metadata} onUpdate={(updates) => updateMutation.mutateAsync({ iptc_metadata: updates })} isUpdating={updateMutation.isPending} />
                  <DublinCoreEditor dublinCore={media.dublin_core} onUpdate={(updates) => updateMutation.mutateAsync({ dublin_core: updates })} isUpdating={updateMutation.isPending} />
                </div>
              )}

              {activeTab === 'alternatives' && (
                <div className="p-4 sm:p-6"><AlternativeFilesTab organizationId={orgId!} mediaId={mediaId!} /></div>
              )}

              {activeTab === 'discussion' && (
                <div className="p-4 sm:p-6"><RecordDiscussionTab entityType="media" entityId={mediaId!} organizationId={orgId!} /></div>
              )}
            </>
          )}
        </div>

        {media.media_type === 'image' && <SimilarMediaPanel organizationId={orgId!} mediaId={mediaId!} />}

        {relatedMedia.length > 0 && (
          <div className="bg-parchment border border-lichen rounded-lg p-4 sm:p-6">
            <h3 className="text-sm font-medium text-ink mb-4 flex items-center gap-2"><Move size={16} className="text-archive" />More from this folder</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {relatedMedia.map((item: { media_id: string; thumbnail_url?: string | null; filename: string; title?: string | null }) => (
                <Link key={item.media_id} to={`/organizations/${orgId}/media/${item.media_id}`} className="group">
                  <div className="aspect-square bg-stone/30 rounded-lg overflow-hidden mb-2">
                    {item.thumbnail_url ? <img src={item.thumbnail_url} alt={item.title || item.filename} className="w-full h-full object-cover group-hover:scale-105 transition-transform" /> : <div className="w-full h-full flex items-center justify-center"><Image size={24} className="text-archive" /></div>}
                  </div>
                  <p className="text-xs text-archive group-hover:text-bark truncate">{item.title || item.filename}</p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {isFullscreen && media.url && media.media_type === 'image' && (
        <IIIFViewer
          modal
          imageUrl={(media.url || media.preview_url) || undefined}
          onClose={() => setIsFullscreen(false)}
          onRequestDownload={() => setShowDownloadRequest(true)}
        />
      )}

      {showAddToWorkspace && media && (
        <AddToMediaWorkspaceDialog
          isOpen={showAddToWorkspace}
          onClose={() => setShowAddToWorkspace(false)}
          mediaIds={[media.media_id]}
          assetLabel={media.title || media.filename}
        />
      )}

      {showCreateTask && media && orgId && (
        <CreateTaskSlideOver
          isOpen={showCreateTask}
          onClose={() => setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType="media"
          initialEntityId={media.media_id}
          initialEntityLabel={media.title || media.filename}
        />
      )}

      {showDownloadRequest && media && createPortal(
        <div style={{ zIndex: 9999, position: 'fixed', inset: 0 }}>
          <RequestDownloadModal
            organizationId={orgId!}
            mediaItems={[{ media_id: media.media_id, filename: media.filename, title: media.title }]}
            onClose={() => setShowDownloadRequest(false)}
          />
        </div>,
        document.body,
      )}

      {showEmbedPanel && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50" onClick={() => setShowEmbedPanel(false)}>
          <div className="bg-parchment rounded-lg shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-ink flex items-center gap-2"><Code size={18} className="text-bark" />Embed Code</h2>
              <button onClick={() => setShowEmbedPanel(false)} className="text-archive hover:text-ink"><X size={20} /></button>
            </div>
            <EmbedCodeGenerator organizationId={orgId!} mediaId={mediaId!} />
            <div className="mt-4 flex justify-end"><button onClick={() => setShowEmbedPanel(false)} className="btn btn-secondary">Close</button></div>
          </div>
        </div>
      )}

      <ConfirmDialog isOpen={showDeleteDialog} onClose={() => setShowDeleteDialog(false)} onConfirm={() => deleteMutation.mutate()} title="Delete Media" message="Are you sure you want to delete this media? This action cannot be undone." confirmText="Delete" confirmStyle="danger" />
    </>
  );
}
