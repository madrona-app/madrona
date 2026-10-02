/**
 * PageEditorPage -- Create / Edit page or blog post.
 *
 * Detects page vs post from the URL path segment. If a :pageId param
 * exists this is edit mode; otherwise it's create mode.
 *
 * Layout: 2/3 block editor | 1/3 settings sidebar
 * Top bar: title, status badge, Save Draft, Publish / Unpublish
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Save,
  Globe,
  GlobeLock,
  Loader2,
  Trash2,
  Clock,
  Eye,
  ChevronDown,
  X,
  ImageIcon,
} from 'lucide-react';
import {
  getPage,
  createPage,
  updatePage,
  saveBlocks,
  publishPage,
  unpublishPage,
  deletePage,
  listPages,
  listCategories,
  getPreviewToken,
} from '../../lib/api/content';
import type {
  ContentBlock,
  PageTemplate,
  PageType,
  PageStatus,
  ContentCategory,
} from '../../types/content';
import { useAuth } from '../../hooks/useAuth';
import BlockEditor from './components/BlockEditor';
import { MediaPickerModal } from '../../components/content/MediaPickerModal';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateTime } from '@/lib/formatters';

// =============================================================================
// Helpers
// =============================================================================

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

const STATUS_BADGE: Record<PageStatus, string> = {
  draft: 'bg-semantic-warning/10 text-semantic-warning',
  published: 'bg-semantic-success/10 text-semantic-success',
  archived: 'bg-stone text-archive',
};

const TEMPLATE_OPTIONS: Array<{ value: PageTemplate; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'full_width', label: 'Full Width' },
  { value: 'sidebar', label: 'Sidebar' },
  { value: 'landing', label: 'Landing' },
];

// =============================================================================
// Component
// =============================================================================

export default function PageEditorPage() {
  const { orgId, pageId } = useParams<{ orgId: string; pageId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const isEditMode = !!pageId;
  const isPost = location.pathname.includes('/content/posts');
  const pageType: PageType = isPost ? 'post' : 'page';
  const entityLabel = isPost ? 'Post' : 'Page';

  // =========================================================================
  // Form state
  // =========================================================================
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [template, setTemplate] = useState<PageTemplate>('default');
  const [excerpt, setExcerpt] = useState('');
  const [featuredImageMediaId, setFeaturedImageMediaId] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [parentPageId, setParentPageId] = useState('');
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [ogImageMediaId, setOgImageMediaId] = useState('');
  const [publishAt, setPublishAt] = useState('');
  const [savedPageId, setSavedPageId] = useState<string | null>(pageId ?? null);
  const [successMessage, setSuccessMessage] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPublishMenu, setShowPublishMenu] = useState(false);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [showFeaturedImagePicker, setShowFeaturedImagePicker] = useState(false);
  const [showOgImagePicker, setShowOgImagePicker] = useState(false);

  // =========================================================================
  // Fetch existing page (edit mode)
  // =========================================================================
  const { data: pageData, isLoading: isLoadingPage } = useQuery({
    queryKey: ['content-page', orgId, pageId],
    queryFn: () => getPage(orgId!, pageId!),
    enabled: !!orgId && !!pageId,
  });

  // Populate form when page data loads
  useEffect(() => {
    if (pageData?.data) {
      const p = pageData.data;
      setTitle(p.title);
      setSlug(p.slug);
      setSlugTouched(true); // Don't auto-generate in edit mode
      setTemplate((p.template as PageTemplate) ?? 'default');
      setExcerpt(p.excerpt ?? '');
      setFeaturedImageMediaId(p.featured_image_media_id ?? '');
      setOgImageMediaId(p.og_image_media_id ?? '');
      setPublishAt(p.publish_at ?? '');
      setMetaTitle(p.meta_title ?? '');
      setMetaDescription(p.meta_description ?? '');
      setParentPageId(p.parent_page_id ?? '');
      setSelectedCategoryIds(
        p.categories?.map((c) => c.category_id) ?? [],
      );
      setBlocks(p.blocks ?? []);
      setSavedPageId(p.page_id);
    }
  }, [pageData]);

  // Auto-generate slug from title (create mode only, until user touches slug)
  useEffect(() => {
    if (!slugTouched && !isEditMode) {
      setSlug(slugify(title));
    }
  }, [title, slugTouched, isEditMode]);

  const currentStatus: PageStatus = pageData?.data?.status ?? 'draft';

  // =========================================================================
  // Fetch categories (for posts)
  // =========================================================================
  const { data: categoriesData } = useQuery({
    queryKey: ['content-categories', orgId],
    queryFn: () => listCategories(orgId!),
    enabled: !!orgId && isPost,
  });
  const categories: ContentCategory[] = categoriesData?.data ?? [];

  // =========================================================================
  // Get org slug (for preview URL)
  // =========================================================================
  const { memberships } = useAuth();
  const orgSlug = memberships.find((m) => m.organization_id === orgId)?.slug;

  // =========================================================================
  // Fetch parent pages (for pages, not posts)
  // =========================================================================
  const { data: parentPagesData } = useQuery({
    queryKey: ['content-parent-pages', orgId],
    queryFn: () => listPages(orgId!, { page_type: 'page', limit: 100 }),
    enabled: !!orgId && !isPost,
  });
  const parentPages = (parentPagesData?.items ?? []).filter(
    (p) => p.page_id !== pageId,
  );

  // =========================================================================
  // Category toggle
  // =========================================================================
  const toggleCategory = useCallback((categoryId: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(categoryId)
        ? prev.filter((id) => id !== categoryId)
        : [...prev, categoryId],
    );
  }, []);

  // =========================================================================
  // Success toast
  // =========================================================================
  const showSuccess = useCallback((msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(''), 3000);
  }, []);

  // =========================================================================
  // Mutations
  // =========================================================================

  // Create page
  const createMutation = useMutation({
    mutationFn: () =>
      createPage(orgId!, {
        title,
        slug: slug || undefined,
        page_type: pageType,
        template,
        excerpt: excerpt || undefined,
        meta_title: metaTitle || undefined,
        meta_description: metaDescription || undefined,
        featured_image_media_id: featuredImageMediaId || null,
        parent_page_id: parentPageId || null,
        blocks: blocks.map((b) => ({
          block_type: b.block_type,
          content: b.content,
        })),
      }),
    onSuccess: (result) => {
      const newId = result.data.page_id;
      setSavedPageId(newId);
      setSlugTouched(true);
      queryClient.invalidateQueries({
        queryKey: ['content-pages', orgId],
      });
      queryClient.invalidateQueries({
        queryKey: ['content-posts', orgId],
      });
      showSuccess('Saved');
      // Redirect to edit URL so further saves use update
      const basePath = isPost ? 'posts' : 'pages';
      navigate(
        `/organizations/${orgId}/content/${basePath}/${newId}`,
        { replace: true },
      );
    },
  });

  // Update page metadata
  const updateMutation = useMutation({
    mutationFn: () =>
      updatePage(orgId!, savedPageId!, {
        title,
        slug: slug || undefined,
        excerpt: excerpt || undefined,
        meta_title: metaTitle || undefined,
        meta_description: metaDescription || undefined,
        template,
        featured_image_media_id: featuredImageMediaId || null,
        og_image_media_id: ogImageMediaId || null,
        publish_at: publishAt || null,
        parent_page_id: parentPageId || null,
        category_ids: isPost ? selectedCategoryIds : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['content-page', orgId, savedPageId],
      });
      queryClient.invalidateQueries({
        queryKey: ['content-pages', orgId],
      });
      queryClient.invalidateQueries({
        queryKey: ['content-posts', orgId],
      });
    },
  });

  // Save blocks
  const blocksMutation = useMutation({
    mutationFn: () =>
      saveBlocks(orgId!, savedPageId!, {
        blocks: blocks.map((b) => ({
          block_id: b.block_id.startsWith('new-block-')
            ? undefined
            : b.block_id,
          block_type: b.block_type,
          content: b.content,
        })),
      }),
    onSuccess: (result) => {
      // Update local blocks with server-assigned IDs
      setBlocks(result.data);
      queryClient.invalidateQueries({
        queryKey: ['content-page', orgId, savedPageId],
      });
    },
  });

  // Publish
  const publishMutation = useMutation({
    mutationFn: () => publishPage(orgId!, savedPageId!),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['content-page', orgId, savedPageId],
      });
      queryClient.invalidateQueries({
        queryKey: ['content-pages', orgId],
      });
      queryClient.invalidateQueries({
        queryKey: ['content-posts', orgId],
      });
      showSuccess('Published');
    },
  });

  // Unpublish
  const unpublishMutation = useMutation({
    mutationFn: () => unpublishPage(orgId!, savedPageId!),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['content-page', orgId, savedPageId],
      });
      queryClient.invalidateQueries({
        queryKey: ['content-pages', orgId],
      });
      queryClient.invalidateQueries({
        queryKey: ['content-posts', orgId],
      });
      showSuccess('Unpublished');
    },
  });

  // Delete
  const deletePageMutation = useMutation({
    mutationFn: () => deletePage(orgId!, savedPageId!),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['content-pages', orgId],
      });
      queryClient.invalidateQueries({
        queryKey: ['content-posts', orgId],
      });
      const basePath = isPost ? 'posts' : 'pages';
      navigate(`/organizations/${orgId}/content/${basePath}`);
    },
  });

  // =========================================================================
  // Save handler (create or update + blocks)
  // =========================================================================
  const isSaving =
    createMutation.isPending ||
    updateMutation.isPending ||
    blocksMutation.isPending;

  const handleSave = useCallback(async () => {
    if (!title.trim()) return;

    if (!savedPageId || !isEditMode) {
      // Create mode
      createMutation.mutate();
    } else {
      // Edit mode: update metadata + blocks in parallel
      await Promise.all([
        updateMutation.mutateAsync(),
        blocksMutation.mutateAsync(),
      ]);
      showSuccess('Saved');
    }
  }, [
    title,
    savedPageId,
    isEditMode,
    createMutation,
    updateMutation,
    blocksMutation,
  ]);

  const handlePublish = useCallback(async () => {
    if (!savedPageId) return;
    // Save then publish
    if (isEditMode && savedPageId) {
      await Promise.all([
        updateMutation.mutateAsync(),
        blocksMutation.mutateAsync(),
      ]);
    }
    publishMutation.mutate();
  }, [savedPageId, isEditMode, updateMutation, blocksMutation, publishMutation]);

  const handleSchedulePublish = useCallback(async (scheduleDate: string) => {
    if (!savedPageId) return;
    // Save then schedule
    if (isEditMode && savedPageId) {
      await Promise.all([
        updateMutation.mutateAsync(),
        blocksMutation.mutateAsync(),
      ]);
    }
    // Publish with a future date — backend keeps it as draft
    publishPage(orgId!, savedPageId, scheduleDate).then(() => {
      setPublishAt(scheduleDate);
      queryClient.invalidateQueries({ queryKey: ['content-page', orgId, savedPageId] });
      showSuccess('Scheduled');
    });
    setShowSchedulePicker(false);
    setShowPublishMenu(false);
  }, [savedPageId, isEditMode, orgId, updateMutation, blocksMutation, queryClient, showSuccess]);

  const handleCancelSchedule = useCallback(async () => {
    if (!savedPageId) return;
    setPublishAt('');
    await updatePage(orgId!, savedPageId, { publish_at: null });
    queryClient.invalidateQueries({ queryKey: ['content-page', orgId, savedPageId] });
    showSuccess('Schedule cancelled');
  }, [savedPageId, orgId, queryClient, showSuccess]);

  // =========================================================================
  // Preview handler
  // =========================================================================
  const handlePreview = useCallback(async () => {
    if (!savedPageId || !orgSlug) return;
    try {
      const result = await getPreviewToken(orgId!, savedPageId);
      const { preview_token, preview_expires, page_id } = result.data;
      const params = new URLSearchParams({
        preview_token,
        preview_expires,
        preview_page_id: page_id,
      });
      const previewPath = isPost
        ? `/c/${orgSlug}/blog/preview`
        : `/c/${orgSlug}/pages/preview`;
      window.open(`${previewPath}?${params}`, '_blank');
    } catch {
      // Silently fail — user will see nothing happen
    }
  }, [savedPageId, orgSlug, orgId, isPost]);

  // =========================================================================
  // Any pending state
  // =========================================================================
  const isAnyPending =
    isSaving || publishMutation.isPending || unpublishMutation.isPending;

  // =========================================================================
  // Back URL
  // =========================================================================
  const backUrl = useMemo(() => {
    const basePath = isPost ? 'posts' : 'pages';
    return `/organizations/${orgId}/content/${basePath}`;
  }, [orgId, isPost]);

  // =========================================================================
  // Loading state
  // =========================================================================
  if (isEditMode && isLoadingPage) {
    return (
      <div className="flex items-center justify-center py-20">
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* ================================================================= */}
      {/* Top bar                                                            */}
      {/* ================================================================= */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(backUrl)}
            className="p-1.5 text-archive hover:text-ink rounded transition-colors"
            title={`Back to ${isPost ? 'Posts' : 'Pages'}`}
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-2xl font-semibold text-ink truncate">
            {isEditMode ? title || `Untitled ${entityLabel}` : `New ${entityLabel}`}
          </h1>
          {isEditMode && (
            <span
              className={`shrink-0 inline-flex px-2 py-0.5 text-xs font-medium rounded ${
                STATUS_BADGE[currentStatus]
              }`}
            >
              {currentStatus}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Success message */}
          {successMessage && (
            <span className="text-sm text-semantic-success mr-2">
              {successMessage}
            </span>
          )}

          {/* Error message */}
          {(createMutation.isError ||
            updateMutation.isError ||
            blocksMutation.isError) && (
            <span className="text-sm text-semantic-error mr-2">
              Save failed
            </span>
          )}

          {/* Preview */}
          {isEditMode && savedPageId && orgSlug && (
            <button
              onClick={handlePreview}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-lichen rounded-lg text-ink hover:bg-stone/30 transition-colors"
              title="Preview in new tab"
            >
              <Eye size={14} />
              Preview
            </button>
          )}

          {/* Save Draft */}
          <button
            onClick={handleSave}
            disabled={!title.trim() || isAnyPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-lichen rounded-lg text-ink hover:bg-stone/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            Save Draft
          </button>

          {/* Scheduled badge */}
          {publishAt && currentStatus === 'draft' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded bg-semantic-info/10 text-semantic-info">
              <Clock size={12} />
              Scheduled for {formatDateTime(publishAt)}
              <button
                onClick={handleCancelSchedule}
                className="ml-1 hover:text-ink transition-colors"
                title="Cancel schedule"
              >
                <X size={12} />
              </button>
            </span>
          )}

          {/* Publish / Unpublish */}
          {currentStatus === 'published' ? (
            <button
              onClick={() => unpublishMutation.mutate()}
              disabled={!savedPageId || isAnyPending}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-lichen rounded-lg text-ink hover:bg-stone/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {unpublishMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <GlobeLock size={14} />
              )}
              Unpublish
            </button>
          ) : (
            <div className="relative">
              <div className="flex">
                <button
                  onClick={handlePublish}
                  disabled={!title.trim() || isAnyPending}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-bark text-parchment rounded-l-lg hover:bg-copper-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {publishMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Globe size={14} />
                  )}
                  Publish
                </button>
                <button
                  onClick={() => setShowPublishMenu((prev) => !prev)}
                  disabled={!title.trim() || isAnyPending}
                  className="inline-flex items-center px-2 py-2 text-sm bg-bark text-parchment rounded-r-lg border-l border-parchment/20 hover:bg-copper-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              {showPublishMenu && (
                <div className="absolute right-0 mt-1 w-56 bg-parchment border border-lichen rounded-lg shadow-lg z-50">
                  <button
                    onClick={() => {
                      setShowPublishMenu(false);
                      handlePublish();
                    }}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-ink hover:bg-stone/50 transition-colors rounded-t-lg"
                  >
                    <Globe size={14} />
                    Publish Now
                  </button>
                  <button
                    onClick={() => {
                      setShowPublishMenu(false);
                      setShowSchedulePicker(true);
                    }}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-ink hover:bg-stone/50 transition-colors rounded-b-lg"
                  >
                    <Clock size={14} />
                    Schedule...
                  </button>
                </div>
              )}
              {showSchedulePicker && (
                <div className="absolute right-0 mt-1 w-72 bg-parchment border border-lichen rounded-lg shadow-lg z-50 p-4">
                  <h4 className="text-sm font-medium text-ink mb-3">Schedule Publication</h4>
                  <input
                    type="datetime-local"
                    defaultValue={publishAt ? new Date(publishAt).toISOString().slice(0, 16) : ''}
                    min={new Date().toISOString().slice(0, 16)}
                    className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark mb-3"
                    id="schedule-datetime"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const input = document.getElementById('schedule-datetime') as HTMLInputElement;
                        if (input?.value) {
                          handleSchedulePublish(new Date(input.value).toISOString());
                        }
                      }}
                      className="flex-1 px-3 py-1.5 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark transition-colors"
                    >
                      Schedule
                    </button>
                    <button
                      onClick={() => setShowSchedulePicker(false)}
                      className="px-3 py-1.5 text-sm border border-lichen text-ink rounded-lg hover:bg-stone/30 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ================================================================= */}
      {/* Main layout: editor + sidebar                                      */}
      {/* ================================================================= */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Block Editor (2/3) */}
        <div className="flex-1 lg:w-2/3 min-w-0">
          <BlockEditor
            blocks={blocks}
            onChange={setBlocks}
            organizationId={orgId!}
          />
        </div>

        {/* Settings Sidebar (1/3) */}
        <div className="lg:w-1/3 shrink-0 space-y-6">
          {/* Title */}
          <div className="bg-parchment border border-lichen rounded-lg p-4 space-y-4">
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
              {entityLabel} Settings
            </h3>

            <div>
              <label
                htmlFor="page-title"
                className="block text-xs font-medium text-ink mb-1"
              >
                Title
              </label>
              <input
                id="page-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`${entityLabel} title`}
                className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
            </div>

            {/* Slug */}
            <div>
              <label
                htmlFor="page-slug"
                className="block text-xs font-medium text-ink mb-1"
              >
                Slug
              </label>
              <input
                id="page-slug"
                type="text"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugTouched(true);
                }}
                placeholder="auto-generated-from-title"
                className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
            </div>

            {/* Template */}
            <div>
              <label
                htmlFor="page-template"
                className="block text-xs font-medium text-ink mb-1"
              >
                Template
              </label>
              <select
                id="page-template"
                value={template}
                onChange={(e) => setTemplate(e.target.value as PageTemplate)}
                className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              >
                {TEMPLATE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Excerpt */}
            <div>
              <label
                htmlFor="page-excerpt"
                className="block text-xs font-medium text-ink mb-1"
              >
                Excerpt
              </label>
              <textarea
                id="page-excerpt"
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                placeholder="Brief summary..."
                rows={3}
                className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-y"
              />
            </div>

            {/* Featured Image */}
            <div>
              <label className="block text-xs font-medium text-ink mb-1">
                Featured Image
              </label>
              {featuredImageMediaId ? (
                <div className="flex items-start gap-3">
                  <div className="w-20 h-20 rounded-lg overflow-hidden bg-stone/30 shrink-0">
                    <img
                      src={`/api/media/${featuredImageMediaId}/thumbnail?size=200`}
                      alt="Featured"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowFeaturedImagePicker(true)}
                      className="text-xs text-bark hover:text-copper-dark transition-colors text-left"
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      onClick={() => setFeaturedImageMediaId('')}
                      className="text-xs text-archive hover:text-semantic-error transition-colors text-left"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowFeaturedImagePicker(true)}
                  className="flex items-center gap-2 w-full px-3 py-2.5 border border-dashed border-lichen text-archive rounded-lg hover:border-bark hover:text-bark transition-colors text-sm"
                >
                  <ImageIcon size={14} />
                  Browse media library
                </button>
              )}
            </div>
          </div>

          {/* SEO section */}
          <div className="bg-parchment border border-lichen rounded-lg p-4 space-y-4">
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
              SEO
            </h3>

            <div>
              <label
                htmlFor="meta-title"
                className="block text-xs font-medium text-ink mb-1"
              >
                Meta Title
              </label>
              <input
                id="meta-title"
                type="text"
                value={metaTitle}
                onChange={(e) => setMetaTitle(e.target.value)}
                placeholder="Page title for search engines"
                className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
              <p className="text-xs text-archive mt-1">
                {metaTitle.length}/60 characters
              </p>
            </div>

            <div>
              <label
                htmlFor="meta-description"
                className="block text-xs font-medium text-ink mb-1"
              >
                Meta Description
              </label>
              <textarea
                id="meta-description"
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
                placeholder="Description for search engine results"
                rows={3}
                className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-y"
              />
              <p className="text-xs text-archive mt-1">
                {metaDescription.length}/160 characters
              </p>
            </div>

            {/* OG Image Override */}
            <div>
              <label className="block text-xs font-medium text-ink mb-1">
                OG Image
              </label>
              <p className="text-xs text-archive mb-2">
                Social sharing image. Falls back to featured image if not set.
              </p>
              {ogImageMediaId ? (
                <div className="flex items-center gap-3">
                  <div className="w-16 h-10 rounded overflow-hidden bg-stone/30 shrink-0">
                    <img
                      src={`/api/media/${ogImageMediaId}/thumbnail?size=200`}
                      alt="OG image"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowOgImagePicker(true)}
                      className="text-xs text-bark hover:text-copper-dark transition-colors"
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      onClick={() => setOgImageMediaId('')}
                      className="text-xs text-archive hover:text-semantic-error transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowOgImagePicker(true)}
                  className="flex items-center gap-2 w-full px-3 py-2 border border-dashed border-lichen text-archive rounded-lg hover:border-bark hover:text-bark transition-colors text-xs"
                >
                  <ImageIcon size={12} />
                  Set OG image
                </button>
              )}
            </div>
          </div>

          {/* Parent Page (pages only) */}
          {!isPost && (
            <div className="bg-parchment border border-lichen rounded-lg p-4 space-y-4">
              <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
                Page Hierarchy
              </h3>
              <div>
                <label
                  htmlFor="parent-page"
                  className="block text-xs font-medium text-ink mb-1"
                >
                  Parent Page
                </label>
                <select
                  id="parent-page"
                  value={parentPageId}
                  onChange={(e) => setParentPageId(e.target.value)}
                  className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                >
                  <option value="">None (top level)</option>
                  {parentPages.map((p) => (
                    <option key={p.page_id} value={p.page_id}>
                      {p.title || p.slug}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Categories (posts only) */}
          {isPost && categories.length > 0 && (
            <div className="bg-parchment border border-lichen rounded-lg p-4 space-y-4">
              <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
                Categories
              </h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {categories.map((cat) => (
                  <label
                    key={cat.category_id}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedCategoryIds.includes(cat.category_id)}
                      onChange={() => toggleCategory(cat.category_id)}
                    />
                    <span className="text-sm text-ink">{cat.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Danger zone (edit mode only) */}
          {isEditMode && savedPageId && (
            <div className="bg-parchment border border-semantic-error/20 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-semibold text-semantic-error uppercase tracking-wide">
                Danger Zone
              </h3>
              {showDeleteConfirm ? (
                <div className="space-y-3">
                  <p className="text-sm text-ink">
                    Are you sure you want to delete this {entityLabel.toLowerCase()}?
                    This action cannot be undone.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => deletePageMutation.mutate()}
                      disabled={deletePageMutation.isPending}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-semantic-error text-parchment rounded-lg hover:bg-semantic-error/80 disabled:opacity-50 transition-colors"
                    >
                      {deletePageMutation.isPending ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                      Confirm Delete
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      className="px-3 py-1.5 text-sm border border-lichen rounded-lg text-ink hover:bg-stone/30 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-semantic-error/30 text-semantic-error rounded-lg hover:bg-semantic-error/5 transition-colors"
                >
                  <Trash2 size={14} />
                  Delete {entityLabel}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Media pickers */}
      <MediaPickerModal
        isOpen={showFeaturedImagePicker}
        onClose={() => setShowFeaturedImagePicker(false)}
        onSelect={(id) => setFeaturedImageMediaId(id)}
        organizationId={orgId!}
      />
      <MediaPickerModal
        isOpen={showOgImagePicker}
        onClose={() => setShowOgImagePicker(false)}
        onSelect={(id) => setOgImageMediaId(id)}
        organizationId={orgId!}
      />
    </div>
  );
}
