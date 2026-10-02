import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Checkbox from '../../components/Checkbox';
import ConfirmDialog from '../../components/ConfirmDialog';
import {
  Globe, Save, Loader2, Image, X, Clock, Filter, Calendar, Trash2, Eye, EyeOff,
  BarChart3, AlertTriangle, Palette, Navigation, Star, Plus, GripVertical,
  ChevronDown, ChevronRight, ExternalLink,
} from 'lucide-react';
import {
  getDiscoverConfig,
  updateDiscoverConfig,
  getDiscoverStats,
  publishByCriteria,
  createPublishSchedule,
  listPublishSchedules,
  cancelPublishSchedule,
  searchDiscoverObjects,
} from '../../lib/api';
import type { DiscoverConfig, DiscoverHit } from '../../types/discover';
import { StatCard } from '../../components/reports/StatCard';
import { useAuth } from '../../hooks/useAuth';
import { formatDateTime } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'title_asc', label: 'Title A\u2013Z' },
  { value: 'title_desc', label: 'Title Z\u2013A' },
  { value: 'date_asc', label: 'Date (oldest)' },
  { value: 'date_desc', label: 'Date (newest)' },
  { value: 'newest', label: 'Recently added' },
];

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-semantic-warning/10 text-semantic-warning' },
  executed: { label: 'Executed', className: 'bg-semantic-success/10 text-semantic-success' },
  cancelled: { label: 'Cancelled', className: 'bg-stone text-archive' },
  failed: { label: 'Failed', className: 'bg-semantic-error/10 text-semantic-error' },
};

function CollapsibleSection({
  title,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="bg-parchment border border-lichen rounded-lg">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 p-4 text-left"
      >
        <Icon size={18} className="text-bark" />
        <h3 className="text-sm font-semibold text-ink uppercase tracking-wide flex-1">{title}</h3>
        {isOpen ? <ChevronDown size={16} className="text-archive" /> : <ChevronRight size={16} className="text-archive" />}
      </button>
      {isOpen && <div className="px-4 pb-4 border-t border-lichen pt-4">{children}</div>}
    </div>
  );
}

export default function DiscoverSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();

  // === Config query ===
  const { data: config, isLoading } = useQuery({
    queryKey: ['discover-config', orgId],
    queryFn: () => getDiscoverConfig(orgId!),
    enabled: !!orgId,
  });

  // === Stats query ===
  const { data: stats } = useQuery({
    queryKey: ['discover-stats', orgId],
    queryFn: () => getDiscoverStats(orgId!),
    enabled: !!orgId,
  });

  // === Schedules query ===
  const { data: schedules } = useQuery({
    queryKey: ['publish-schedules', orgId],
    queryFn: () => listPublishSchedules(orgId!),
    enabled: !!orgId,
  });

  // === Config form state ===
  // Branding/theming (colors, fonts) and footer content (text, social links)
  // are deliberately NOT hydrated here — they are owned by Content > Site
  // Settings, which edits the same DiscoverConfig record. Only dirty fields
  // are sent on save so this page can never clobber fields it doesn't own.
  const [formData, setFormData] = useState<Partial<DiscoverConfig>>({});
  const [dirtyFields, setDirtyFields] = useState<Set<keyof DiscoverConfig>>(new Set());
  const isDirty = dirtyFields.size > 0;
  const [confirmState, setConfirmState] = useState<{action: () => void; title: string; message: string; confirmStyle: 'danger' | 'primary'} | null>(null);

  useEffect(() => {
    if (config) {
      setFormData({
        hero_media_id: config.hero_media_id,
        page_title: config.page_title,
        page_subtitle: config.page_subtitle,
        show_object_count: config.show_object_count,
        default_view_mode: config.default_view_mode,
        default_sort: config.default_sort,
        header_logo_media_id: config.header_logo_media_id,
        nav_items: config.nav_items,
        featured_object_ids: config.featured_object_ids,
      });
      setDirtyFields(new Set());
    }
  }, [config]);

  const configMutation = useMutation({
    mutationFn: (data: Partial<DiscoverConfig>) => updateDiscoverConfig(orgId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discover-config', orgId] });
      setDirtyFields(new Set());
    },
  });

  const handleChange = useCallback((field: keyof DiscoverConfig, value: unknown) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setDirtyFields((prev) => new Set(prev).add(field));
  }, []);

  const handleSave = () => {
    const payload: Partial<DiscoverConfig> = {};
    for (const field of dirtyFields) {
      (payload as Record<string, unknown>)[field] = formData[field];
    }
    configMutation.mutate(payload);
  };

  // === Criteria-based publishing state ===
  const [criteria, setCriteria] = useState<Record<string, unknown>>({});
  const [criteriaAction, setCriteriaAction] = useState<boolean>(true); // true = publish
  const [criteriaPreview, setCriteriaPreview] = useState<{
    matched_count?: number;
    sample_objects?: Array<{ object_id: string; object_number: string; title: string | null; object_type: string | null; is_discoverable: boolean }>;
  } | null>(null);

  const criteriaMutation = useMutation({
    mutationFn: (params: { dryRun: boolean }) =>
      publishByCriteria(orgId!, criteria, criteriaAction, params.dryRun),
    onSuccess: (data, variables) => {
      if (variables.dryRun) {
        setCriteriaPreview(data);
      } else {
        setCriteriaPreview(null);
        queryClient.invalidateQueries({ queryKey: ['discover-stats', orgId] });
      }
    },
  });

  const handleCriteriaChange = (key: string, value: string) => {
    setCriteria((prev) => {
      if (!value) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      if (key === 'object_type') {
        return { ...prev, [key]: value.split(',').map((v) => v.trim()).filter(Boolean) };
      }
      if (key === 'has_image') {
        return { ...prev, [key]: value === 'true' };
      }
      return { ...prev, [key]: value };
    });
    setCriteriaPreview(null);
  };

  // === Scheduled publishing state ===
  const [scheduleAction, setScheduleAction] = useState<'publish' | 'unpublish'>('publish');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleMode, setScheduleMode] = useState<'criteria' | 'objects'>('criteria');
  const [scheduleObjectIds, setScheduleObjectIds] = useState('');

  const scheduleMutation = useMutation({
    mutationFn: () => {
      const data: {
        action: 'publish' | 'unpublish';
        scheduled_for: string;
        criteria?: Record<string, unknown>;
        object_ids?: string[];
      } = {
        action: scheduleAction,
        scheduled_for: new Date(scheduleDate).toISOString(),
      };
      if (scheduleMode === 'criteria' && Object.keys(criteria).length > 0) {
        data.criteria = criteria;
      } else if (scheduleMode === 'objects' && scheduleObjectIds.trim()) {
        data.object_ids = scheduleObjectIds.split(',').map((s) => s.trim()).filter(Boolean);
      }
      return createPublishSchedule(orgId!, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['publish-schedules', orgId] });
      queryClient.invalidateQueries({ queryKey: ['discover-stats', orgId] });
      setScheduleDate('');
      setScheduleObjectIds('');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (scheduleId: string) => cancelPublishSchedule(orgId!, scheduleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['publish-schedules', orgId] });
      queryClient.invalidateQueries({ queryKey: ['discover-stats', orgId] });
    },
  });

  // === Featured objects search ===
  const [featuredSearch, setFeaturedSearch] = useState('');
  const [featuredSearchResults, setFeaturedSearchResults] = useState<DiscoverHit[]>([]);
  const [isSearchingFeatured, setIsSearchingFeatured] = useState(false);

  // We need the org slug to search published objects.
  const { memberships } = useAuth();
  const orgSlug = memberships.find((m) => m.organization_id === orgId)?.slug;

  const handleFeaturedSearch = useCallback(async () => {
    if (!featuredSearch.trim() || !orgSlug) return;
    setIsSearchingFeatured(true);
    try {
      const result = await searchDiscoverObjects(orgSlug, { q: featuredSearch, limit: 10 });
      setFeaturedSearchResults(result.hits);
    } catch {
      setFeaturedSearchResults([]);
    }
    setIsSearchingFeatured(false);
  }, [featuredSearch, orgSlug]);

  const addFeaturedObject = useCallback((objectId: string) => {
    const current = (formData.featured_object_ids || []) as string[];
    if (current.includes(objectId) || current.length >= 20) return;
    handleChange('featured_object_ids', [...current, objectId]);
  }, [formData.featured_object_ids, handleChange]);

  const removeFeaturedObject = useCallback((objectId: string) => {
    const current = (formData.featured_object_ids || []) as string[];
    handleChange('featured_object_ids', current.filter((id) => id !== objectId));
  }, [formData.featured_object_ids, handleChange]);

  const moveFeaturedObject = useCallback((index: number, direction: 'up' | 'down') => {
    const current = [...(formData.featured_object_ids || []) as string[]];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= current.length) return;
    [current[index], current[newIndex]] = [current[newIndex], current[index]];
    handleChange('featured_object_ids', current);
  }, [formData.featured_object_ids, handleChange]);

  // === Nav items management ===
  const addNavItem = useCallback(() => {
    const current = (formData.nav_items || []) as Array<{ label: string; url: string }>;
    if (current.length >= 8) return;
    handleChange('nav_items', [...current, { label: '', url: '' }]);
  }, [formData.nav_items, handleChange]);

  const updateNavItem = useCallback((index: number, field: 'label' | 'url', value: string) => {
    const current = [...(formData.nav_items || []) as Array<{ label: string; url: string }>];
    current[index] = { ...current[index], [field]: value };
    handleChange('nav_items', current);
  }, [formData.nav_items, handleChange]);

  const removeNavItem = useCallback((index: number) => {
    const current = [...(formData.nav_items || []) as Array<{ label: string; url: string }>];
    current.splice(index, 1);
    handleChange('nav_items', current.length > 0 ? current : null);
  }, [formData.nav_items, handleChange]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  const navItems = (formData.nav_items || []) as Array<{ label: string; url: string }>;
  const featuredIds = (formData.featured_object_ids || []) as string[];

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Globe className="w-5 h-5 text-bark" />
        <h2 className="text-lg font-medium text-ink">Discover Settings</h2>
      </div>
      <p className="text-sm text-archive mb-8">
        Configure the public collection browser at{' '}
        <span className="font-mono text-xs text-bark">/c/your-org-slug</span>
      </p>

      {/* ================================================================ */}
      {/* Publication Status Dashboard                                      */}
      {/* ================================================================ */}
      {stats && (
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={18} className="text-bark" />
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
              Publication Overview
            </h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard label="Total Objects" value={stats.total_objects} />
            <StatCard label="Published" value={stats.discoverable_count} icon={Eye} />
            <StatCard label="Private" value={stats.private_count} icon={EyeOff} />
            <StatCard label="Scheduled" value={stats.pending_schedules} icon={Clock} />
            <StatCard
              label="Published (30d)"
              value={stats.published_last_30_days}
              subtitle={`${stats.unpublished_last_30_days} unpublished`}
            />
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* Criteria-Based Publishing                                         */}
      {/* ================================================================ */}
      <div className="mb-10 bg-parchment border border-lichen rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={18} className="text-bark" />
          <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
            Publish by Criteria
          </h3>
        </div>
        <p className="text-sm text-archive mb-4">
          Publish or unpublish all objects matching a set of filters in one operation.
        </p>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Object Type</label>
            <input
              type="text"
              placeholder="e.g. Painting, Sculpture"
              onChange={(e) => handleCriteriaChange('object_type', e.target.value)}
              className="w-full border border-lichen rounded-lg px-3 py-1.5 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Object Status</label>
            <input
              type="text"
              placeholder="e.g. approved"
              onChange={(e) => handleCriteriaChange('object_status', e.target.value)}
              className="w-full border border-lichen rounded-lg px-3 py-1.5 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Has Image</label>
            <select
              onChange={(e) => handleCriteriaChange('has_image', e.target.value)}
              className="w-full border border-lichen rounded-lg px-3 py-1.5 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <option value="">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Creator</label>
            <input
              type="text"
              placeholder="Search by creator name"
              onChange={(e) => handleCriteriaChange('creator', e.target.value)}
              className="w-full border border-lichen rounded-lg px-3 py-1.5 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Classification</label>
            <input
              type="text"
              placeholder="Search by classification"
              onChange={(e) => handleCriteriaChange('classification', e.target.value)}
              className="w-full border border-lichen rounded-lg px-3 py-1.5 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Material</label>
            <input
              type="text"
              placeholder="Search by material"
              onChange={(e) => handleCriteriaChange('material', e.target.value)}
              className="w-full border border-lichen rounded-lg px-3 py-1.5 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm text-ink">Action:</label>
          <button
            onClick={() => setCriteriaAction(true)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              criteriaAction
                ? 'border-azurite bg-azurite/10 text-azurite'
                : 'border-lichen text-archive hover:text-ink'
            }`}
          >
            Publish
          </button>
          <button
            onClick={() => setCriteriaAction(false)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              !criteriaAction
                ? 'border-azurite bg-azurite/10 text-azurite'
                : 'border-lichen text-archive hover:text-ink'
            }`}
          >
            Unpublish
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => criteriaMutation.mutate({ dryRun: true })}
            disabled={Object.keys(criteria).length === 0 || criteriaMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-bark text-bark rounded-lg hover:bg-bark/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {criteriaMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
            Preview
          </button>
          <button
            onClick={() => {
              setConfirmState({
                action: () => criteriaMutation.mutate({ dryRun: false }),
                title: criteriaAction ? 'Publish Objects' : 'Unpublish Objects',
                message: `Are you sure you want to ${criteriaAction ? 'publish' : 'unpublish'} all matching objects?`,
                confirmStyle: criteriaAction ? 'primary' : 'danger',
              });
            }}
            disabled={Object.keys(criteria).length === 0 || criteriaMutation.isPending}
            className="btn btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {criteriaAction ? 'Publish Matching' : 'Unpublish Matching'}
          </button>
        </div>

        {/* Criteria preview results */}
        {criteriaPreview && (
          <div className="mt-4 p-4 bg-parchment border border-lichen rounded-lg">
            <p className="text-sm font-medium text-ink mb-2">
              {criteriaPreview.matched_count} object{criteriaPreview.matched_count !== 1 ? 's' : ''} match
            </p>
            {criteriaPreview.sample_objects && criteriaPreview.sample_objects.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-archive">Sample (first 10):</p>
                {criteriaPreview.sample_objects.map((obj) => (
                  <div key={obj.object_id} className="flex items-center gap-2 text-xs text-ink">
                    <span className="font-mono text-archive">{obj.object_number}</span>
                    <span>{obj.title || 'Untitled'}</span>
                    {obj.is_discoverable && (
                      <span className="px-1.5 py-0.5 bg-semantic-success/10 text-semantic-success rounded text-[10px]">published</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {criteriaMutation.isSuccess && !criteriaPreview && (
          <p className="mt-3 text-sm text-semantic-success">
            Updated successfully
          </p>
        )}
        {criteriaMutation.isError && (
          <p className="mt-3 text-sm text-semantic-error">
            Failed to execute criteria-based publish
          </p>
        )}
      </div>

      {/* ================================================================ */}
      {/* Scheduled Publishing                                              */}
      {/* ================================================================ */}
      <div className="mb-10 bg-parchment border border-lichen rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={18} className="text-bark" />
          <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
            Scheduled Publishing
          </h3>
        </div>
        <p className="text-sm text-archive mb-4">
          Queue a publish or unpublish action for a future date and time.
        </p>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Action</label>
            <select
              value={scheduleAction}
              onChange={(e) => setScheduleAction(e.target.value as 'publish' | 'unpublish')}
              className="w-full border border-lichen rounded-lg px-3 py-1.5 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <option value="publish">Publish</option>
              <option value="unpublish">Unpublish</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Scheduled For</label>
            <input
              type="datetime-local"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              className="w-full border border-lichen rounded-lg px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-medium text-ink mb-1">Target</label>
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setScheduleMode('criteria')}
              className={`px-3 py-1 text-xs rounded border transition-colors ${
                scheduleMode === 'criteria'
                  ? 'border-azurite bg-azurite/10 text-azurite'
                  : 'border-lichen text-archive hover:text-ink'
              }`}
            >
              Use criteria filters above
            </button>
            <button
              onClick={() => setScheduleMode('objects')}
              className={`px-3 py-1 text-xs rounded border transition-colors ${
                scheduleMode === 'objects'
                  ? 'border-azurite bg-azurite/10 text-azurite'
                  : 'border-lichen text-archive hover:text-ink'
              }`}
            >
              Specific object IDs
            </button>
          </div>
          {scheduleMode === 'objects' && (
            <textarea
              value={scheduleObjectIds}
              onChange={(e) => setScheduleObjectIds(e.target.value)}
              placeholder="Paste comma-separated object UUIDs"
              rows={2}
              className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          )}
        </div>

        <button
          onClick={() => scheduleMutation.mutate()}
          disabled={
            !scheduleDate ||
            scheduleMutation.isPending ||
            (scheduleMode === 'criteria' && Object.keys(criteria).length === 0) ||
            (scheduleMode === 'objects' && !scheduleObjectIds.trim())
          }
          className="btn btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {scheduleMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Clock size={14} />
          )}
          Create Schedule
        </button>
        {scheduleMutation.isSuccess && (
          <span className="ml-3 text-sm text-semantic-success">Schedule created</span>
        )}
        {scheduleMutation.isError && (
          <span className="ml-3 text-sm text-semantic-error">Failed to create schedule</span>
        )}

        {/* Schedules list */}
        {schedules && schedules.length > 0 && (
          <div className="mt-6 border-t border-lichen pt-4">
            <h4 className="text-xs font-semibold text-ink uppercase tracking-wide mb-3">
              Schedules
            </h4>
            <div className="space-y-2">
              {schedules.map((s) => {
                const badge = STATUS_BADGES[s.status] || STATUS_BADGES.pending;
                return (
                  <div
                    key={s.schedule_id}
                    className="flex items-center gap-3 p-3 bg-parchment border border-lichen rounded-lg text-sm"
                  >
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                    <span className="text-ink capitalize">{s.action}</span>
                    <span className="text-archive">
                      {formatDateTime(s.scheduled_for)}
                    </span>
                    {s.criteria && (
                      <span className="text-xs text-archive">
                        (criteria-based)
                      </span>
                    )}
                    {s.object_ids && (
                      <span className="text-xs text-archive">
                        ({s.object_ids.length} object{s.object_ids.length !== 1 ? 's' : ''})
                      </span>
                    )}
                    {s.result_count !== null && (
                      <span className="text-xs text-archive">
                        {s.result_count} updated
                      </span>
                    )}
                    {s.error_message && (
                      <span className="text-xs text-semantic-error flex items-center gap-1">
                        <AlertTriangle size={12} />
                        {s.error_message}
                      </span>
                    )}
                    <div className="flex-1" />
                    {s.status === 'pending' && (
                      <button
                        onClick={() => {
                          setConfirmState({
                            action: () => cancelMutation.mutate(s.schedule_id),
                            title: 'Cancel Schedule',
                            message: 'Cancel this schedule?',
                            confirmStyle: 'danger',
                          });
                        }}
                        className="text-archive hover:text-semantic-error transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/* Display Configuration (existing form)                             */}
      {/* ================================================================ */}
      <div className="space-y-4 mb-10">
        <CollapsibleSection title="Display Configuration" icon={Image} defaultOpen>
          <div className="space-y-6 max-w-2xl">
            {/* Page Title */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Page Title
              </label>
              <input
                type="text"
                value={formData.page_title || ''}
                onChange={(e) => handleChange('page_title', e.target.value || null)}
                placeholder="Defaults to organization name"
                className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
              <p className="text-xs text-archive mt-1">
                Displayed as the large heading on the discover page hero section.
              </p>
            </div>

            {/* Page Subtitle */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Page Subtitle
              </label>
              <input
                type="text"
                value={formData.page_subtitle || ''}
                onChange={(e) => handleChange('page_subtitle', e.target.value || null)}
                placeholder="Optional subtitle"
                className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
            </div>

            {/* Hero Media ID */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Hero Image Media ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.hero_media_id || ''}
                  onChange={(e) => handleChange('hero_media_id', e.target.value || null)}
                  placeholder="Paste a published media UUID"
                  className="flex-1 border border-lichen rounded-lg px-3 py-2 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
                {formData.hero_media_id && (
                  <button
                    onClick={() => handleChange('hero_media_id', null)}
                    className="px-3 py-2 border border-lichen rounded-lg text-archive hover:text-ink hover:border-bark/30 transition-colors"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <p className="text-xs text-archive mt-1">
                UUID of a published media item to use as the hero background image.
              </p>
            </div>

            {/* Show Object Count */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={formData.show_object_count ?? true}
                  onChange={(e) => handleChange('show_object_count', e.target.checked)}
                />
                <span className="text-sm text-ink">Show object count on hero section</span>
              </label>
            </div>

            {/* Default View Mode */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Default View Mode
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => handleChange('default_view_mode', 'grid')}
                  className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg border transition-colors ${
                    formData.default_view_mode === 'grid'
                      ? 'border-azurite bg-azurite/10 text-azurite'
                      : 'border-lichen text-archive hover:text-ink'
                  }`}
                >
                  <Image size={16} />
                  Grid
                </button>
                <button
                  onClick={() => handleChange('default_view_mode', 'list')}
                  className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg border transition-colors ${
                    formData.default_view_mode === 'list'
                      ? 'border-azurite bg-azurite/10 text-azurite'
                      : 'border-lichen text-archive hover:text-ink'
                  }`}
                >
                  List
                </button>
              </div>
            </div>

            {/* Default Sort */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Default Sort
              </label>
              <select
                value={formData.default_sort || 'relevance'}
                onChange={(e) => handleChange('default_sort', e.target.value)}
                className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CollapsibleSection>

        {/* ================================================================ */}
        {/* Branding                                                          */}
        {/* ================================================================ */}
        <CollapsibleSection title="Branding" icon={Palette}>
          <div className="space-y-6 max-w-2xl">
            {/* Header Logo Media ID */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Header Logo Media ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.header_logo_media_id || ''}
                  onChange={(e) => handleChange('header_logo_media_id', e.target.value || null)}
                  placeholder="Paste a published media UUID for your logo"
                  className="flex-1 border border-lichen rounded-lg px-3 py-2 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
                {formData.header_logo_media_id && (
                  <button
                    onClick={() => handleChange('header_logo_media_id', null)}
                    className="px-3 py-2 border border-lichen rounded-lg text-archive hover:text-ink hover:border-bark/30 transition-colors"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <p className="text-xs text-archive mt-1">
                Shown in the site header. Use a transparent PNG or SVG for best results.
              </p>
            </div>

            <p className="text-xs text-archive">
              Colors, fonts, and the full site theme are managed in{' '}
              <Link
                to={`/organizations/${orgId}/content/site-settings`}
                className="text-bark hover:text-copper-dark"
              >
                Content &rsaquo; Site Settings
              </Link>.
            </p>
          </div>
        </CollapsibleSection>

        {/* ================================================================ */}
        {/* Navigation                                                        */}
        {/* ================================================================ */}
        <CollapsibleSection title="Navigation" icon={Navigation}>
          <div className="space-y-6 max-w-2xl">
            {/* Nav Items */}
            <div>
              <label className="block text-sm font-medium text-ink mb-2">
                Navigation Links
              </label>
              <p className="text-xs text-archive mb-3">
                Links shown in the site header. Up to 8 items.
              </p>
              <div className="space-y-2">
                {navItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={item.label}
                      onChange={(e) => updateNavItem(i, 'label', e.target.value)}
                      placeholder="Label"
                      className="w-40 border border-lichen rounded-lg px-3 py-1.5 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    />
                    <input
                      type="text"
                      value={item.url}
                      onChange={(e) => updateNavItem(i, 'url', e.target.value)}
                      placeholder="https://..."
                      className="flex-1 border border-lichen rounded-lg px-3 py-1.5 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    />
                    <button
                      onClick={() => removeNavItem(i)}
                      className="p-1.5 text-archive hover:text-semantic-error transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              {navItems.length < 8 && (
                <button
                  onClick={addNavItem}
                  className="mt-2 inline-flex items-center gap-1 text-xs text-bark hover:text-copper-dark transition-colors"
                >
                  <Plus size={14} />
                  Add link
                </button>
              )}
            </div>

            <p className="text-xs text-archive">
              Footer text, columns, and social links are managed in{' '}
              <Link
                to={`/organizations/${orgId}/content/site-settings`}
                className="text-bark hover:text-copper-dark"
              >
                Content &rsaquo; Site Settings
              </Link>.
            </p>
          </div>
        </CollapsibleSection>

        {/* ================================================================ */}
        {/* Featured Objects                                                   */}
        {/* ================================================================ */}
        <CollapsibleSection title="Featured Objects" icon={Star}>
          <div className="space-y-4 max-w-2xl">
            <p className="text-xs text-archive">
              Select up to 20 objects to feature on the landing page. Drag to reorder.
            </p>

            {/* Search to add */}
            <div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={featuredSearch}
                  onChange={(e) => setFeaturedSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleFeaturedSearch()}
                  placeholder="Search published objects to add..."
                  className="flex-1 border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
                <button
                  onClick={handleFeaturedSearch}
                  disabled={!featuredSearch.trim() || isSearchingFeatured}
                  className="btn btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSearchingFeatured ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
                </button>
              </div>

              {/* Search results */}
              {featuredSearchResults.length > 0 && (
                <div className="mt-2 border border-lichen rounded-lg divide-y divide-lichen max-h-60 overflow-y-auto">
                  {featuredSearchResults.map((hit) => {
                    const alreadyAdded = featuredIds.includes(hit.object_id);
                    return (
                      <div
                        key={hit.object_id}
                        className="flex items-center gap-3 px-3 py-2 text-sm"
                      >
                        {hit.thumbnail_url ? (
                          <img src={hit.thumbnail_url} alt="" className="w-10 h-10 object-cover rounded" />
                        ) : (
                          <div className="w-10 h-10 bg-stone/30 rounded flex items-center justify-center">
                            <Image size={14} className="text-archive/40" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-ink truncate">{hit.title || 'Untitled'}</p>
                          <p className="text-xs text-archive">{hit.object_number}</p>
                        </div>
                        <button
                          onClick={() => addFeaturedObject(hit.object_id)}
                          disabled={alreadyAdded || featuredIds.length >= 20}
                          className="text-xs px-2 py-1 rounded border border-bark text-bark hover:bg-bark/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          {alreadyAdded ? 'Added' : 'Add'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Current featured list */}
            {featuredIds.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-ink uppercase tracking-wide mb-2">
                  Featured ({featuredIds.length}/20)
                </h4>
                <div className="space-y-1">
                  {featuredIds.map((id, i) => (
                    <div
                      key={id}
                      className="flex items-center gap-2 px-3 py-2 bg-parchment border border-lichen rounded-lg text-sm"
                    >
                      <GripVertical size={14} className="text-archive/40" />
                      <span className="text-xs font-mono text-archive flex-1 truncate">{id}</span>
                      <button
                        onClick={() => moveFeaturedObject(i, 'up')}
                        disabled={i === 0}
                        className="text-xs text-archive hover:text-ink disabled:opacity-30 transition-colors"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveFeaturedObject(i, 'down')}
                        disabled={i === featuredIds.length - 1}
                        className="text-xs text-archive hover:text-ink disabled:opacity-30 transition-colors"
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => removeFeaturedObject(id)}
                        className="text-archive hover:text-semantic-error transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Preview link */}
            {orgSlug && (
              <a
                href={`/c/${orgSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-bark hover:text-copper-dark transition-colors"
              >
                <ExternalLink size={12} />
                Preview public page
              </a>
            )}
          </div>
        </CollapsibleSection>
      </div>

      {/* ================================================================ */}
      {/* Save Button (sticky)                                               */}
      {/* ================================================================ */}
      <div className="sticky bottom-0 bg-parchment border-t border-lichen py-4 -mx-4 px-4 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!isDirty || configMutation.isPending}
          className="btn btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {configMutation.isPending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          Save Changes
        </button>
        {configMutation.isSuccess && (
          <span className="text-sm text-semantic-success">Saved successfully</span>
        )}
        {configMutation.isError && (
          <span className="text-sm text-semantic-error">Failed to save</span>
        )}
        {isDirty && !configMutation.isPending && (
          <span className="text-xs text-archive">Unsaved changes</span>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmText="Confirm"
        confirmStyle={confirmState?.confirmStyle ?? 'danger'}
      />
    </div>
  );
}
