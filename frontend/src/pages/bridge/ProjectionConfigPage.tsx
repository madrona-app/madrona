import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Layers,
  Save,
  RotateCcw,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  Info,
  GripVertical,
  Eye,
  FileText,
  Search,
  List,
} from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { usePermissions } from '../../hooks/usePermissions';
import {
  getProjectionProfiles,
  updateProjectionProfiles,
  deleteProjectionProfiles,
  queryEntities,
  PROJECTION_PATH_SUGGESTIONS,
} from '../../lib/api';
import type {
  ProjectionProfileScope,
  ScopeProfile,
  ProjectionConfig,
} from '../../lib/api';
import ConfirmDialog from '../../components/ConfirmDialog';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

// ============================================================================
// PATH SUGGESTIONS DROPDOWN
// ============================================================================

interface PathSuggestionsProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (path: string) => void;
  existingPaths: string[];
  placeholder?: string;
  disabled?: boolean;
}

function PathSuggestions({
  value,
  onChange,
  onSelect,
  existingPaths,
  placeholder,
  disabled,
}: PathSuggestionsProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filteredSuggestions = useMemo(() => {
    return PROJECTION_PATH_SUGGESTIONS.filter(
      (s) =>
        !existingPaths.includes(s.path) &&
        (s.path.toLowerCase().includes(value.toLowerCase()) ||
          s.description.toLowerCase().includes(value.toLowerCase()))
    );
  }, [value, existingPaths]);

  return (
    <div className="relative flex-1">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            e.preventDefault();
            onSelect(value.trim());
          }
        }}
        placeholder={placeholder || 'e.g., properties.title or media[0].url'}
        disabled={disabled}
        className="w-full px-2 py-1.5 text-sm border border-lichen rounded focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark font-mono"
        aria-label="Projection path"
      />
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-parchment border border-lichen rounded-md shadow-lg max-h-48 overflow-y-auto">
          {filteredSuggestions.map((suggestion) => (
            <button
              key={suggestion.path}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(suggestion.path);
                setShowSuggestions(false);
              }}
              className="w-full px-3 py-2 text-left hover:bg-stone-50 flex items-center justify-between"
            >
              <code className="text-sm font-mono text-ink">{suggestion.path}</code>
              <span className="text-xs text-archive ml-2">{suggestion.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PATH EDITOR
// ============================================================================

interface PathEditorProps {
  label: string;
  description: string;
  paths: string[];
  onChange: (paths: string[]) => void;
  disabled?: boolean;
  required?: boolean;
}

function PathEditor({ label, description, paths, onChange, disabled, required }: PathEditorProps) {
  const [newPath, setNewPath] = useState('');

  const addPath = (path: string) => {
    const trimmed = path.trim();
    if (trimmed && !paths.includes(trimmed)) {
      onChange([...paths, trimmed]);
      setNewPath('');
    }
  };

  const removePath = (index: number) => {
    onChange(paths.filter((_, i) => i !== index));
  };

  const movePath = (index: number, direction: 'up' | 'down') => {
    const newPaths = [...paths];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex >= 0 && swapIndex < paths.length) {
      [newPaths[index], newPaths[swapIndex]] = [newPaths[swapIndex], newPaths[index]];
      onChange(newPaths);
    }
  };

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-sm font-medium text-ink">
          {label}
          {required && <span className="text-semantic-error ml-1">*</span>}
        </label>
        <p className="text-xs text-archive mt-0.5">{description}</p>
      </div>

      <div className="space-y-1">
        {paths.map((path, index) => (
          <div
            key={index}
            className="flex items-center gap-2 bg-stone-50 rounded px-2 py-1.5 group"
          >
            <GripVertical className="w-3 h-3 text-archive" />
            <span className="text-xs text-archive w-4">{index + 1}.</span>
            <code className="flex-1 text-sm font-mono text-ink">{path}</code>
            {!disabled && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => movePath(index, 'up')}
                  disabled={index === 0}
                  className="p-1 text-archive hover:text-archive disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ChevronRight className="w-3 h-3 rotate-[-90deg]" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => movePath(index, 'down')}
                  disabled={index === paths.length - 1}
                  className="p-1 text-archive hover:text-archive disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ChevronRight className="w-3 h-3 rotate-90" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => removePath(index)}
                  className="p-1 text-archive hover:text-semantic-error"
                  aria-label="Remove path"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        ))}
        {paths.length === 0 && (
          <div className="text-xs text-archive italic py-2">No paths configured</div>
        )}
      </div>

      {!disabled && (
        <div className="flex gap-2">
          <PathSuggestions
            value={newPath}
            onChange={setNewPath}
            onSelect={addPath}
            existingPaths={paths}
            placeholder="Type or select a path..."
          />
          <button
            type="button"
            onClick={() => addPath(newPath)}
            disabled={!newPath.trim()}
            className="px-3 py-1.5 text-sm bg-stone-100 text-ink rounded hover:bg-stone-200 disabled:opacity-50 flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PREVIEW CARD
// ============================================================================

interface PreviewCardProps {
  scope: ProjectionProfileScope;
  record: Record<string, unknown> | null;
  profile: ScopeProfile;
  isLoading: boolean;
}

function resolvePathValue(record: Record<string, unknown>, path: string): string | null {
  if (!record || !path) return null;

  const segments = path.split('.');
  let current: unknown = record;

  for (const segment of segments) {
    if (current === null || current === undefined) return null;

    // Check for array index: media[0]
    const indexMatch = segment.match(/^(\w+)\[(\d+)\]$/);
    if (indexMatch) {
      const [, field, indexStr] = indexMatch;
      const arr = (current as Record<string, unknown>)[field];
      if (!Array.isArray(arr)) return null;
      current = arr[parseInt(indexStr, 10)];
      continue;
    }

    // Check for predicate: media[role=thumbnail]
    const predicateMatch = segment.match(/^(\w+)\[(\w+)=([^\]]+)\]$/);
    if (predicateMatch) {
      const [, field, key, value] = predicateMatch;
      const arr = (current as Record<string, unknown>)[field];
      if (!Array.isArray(arr)) return null;
      current = arr.find((item: unknown) => (item as Record<string, unknown>)[key] === value);
      continue;
    }

    // Simple property access
    current = (current as Record<string, unknown>)[segment];
  }

  if (typeof current === 'string') return current;
  if (typeof current === 'number') return String(current);
  if (Array.isArray(current)) {
    return current
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && item !== null) {
          return (item as Record<string, unknown>).label ||
                 (item as Record<string, unknown>).value ||
                 (item as Record<string, unknown>).name;
        }
        return null;
      })
      .filter(Boolean)
      .join(', ');
  }
  return null;
}

function resolveValue(record: Record<string, unknown>, paths: string[]): string | null {
  for (const path of paths) {
    const value = resolvePathValue(record, path);
    if (value) return value;
  }
  return null;
}

function PreviewCard({ scope, record, profile, isLoading }: PreviewCardProps) {
  const scopeLabels: Record<ProjectionProfileScope, { title: string; icon: React.ReactNode }> = {
    entity_detail: { title: 'Detail Header', icon: <FileText className="w-4 h-4" /> },
    entities_list: { title: 'List Row', icon: <List className="w-4 h-4" /> },
    search: { title: 'Search Result', icon: <Search className="w-4 h-4" /> },
  };

  const { title: scopeTitle, icon } = scopeLabels[scope];

  if (isLoading) {
    return (
      <div className="bg-parchment border border-lichen rounded-lg p-4">
        <div className="flex items-center gap-2 text-xs text-archive mb-3">
          {icon}
          <span>{scopeTitle}</span>
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-lichen rounded w-3/4"></div>
          <div className="h-3 bg-stone rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="bg-parchment border border-lichen rounded-lg p-4">
        <div className="flex items-center gap-2 text-xs text-archive mb-3">
          {icon}
          <span>{scopeTitle}</span>
        </div>
        <div className="text-sm text-archive italic">No sample data available</div>
      </div>
    );
  }

  const title = resolveValue(record, profile.title) || (record.id as string) || 'Untitled';
  const subtitle = profile.subtitle ? resolveValue(record, profile.subtitle) : null;
  const thumbnail = profile.thumbnail ? resolveValue(record, profile.thumbnail) : null;
  const snippet = scope === 'search' && profile.snippet ? resolveValue(record, profile.snippet) : null;

  return (
    <div className="bg-parchment border border-lichen rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2 text-xs text-archive mb-3">
        {icon}
        <span>{scopeTitle}</span>
      </div>
      <div className="flex gap-3">
        {thumbnail && (
          <div className="flex-shrink-0 w-16 h-16 bg-stone rounded overflow-hidden">
            <img
              src={thumbnail}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-ink truncate">{title}</div>
          {subtitle && <div className="text-sm text-archive truncate">{subtitle}</div>}
          {snippet && (
            <div className="text-sm text-archive mt-1 line-clamp-2">{snippet}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SCOPE CONFIG SECTION
// ============================================================================

interface ScopeConfigProps {
  scope: ProjectionProfileScope;
  profile: ScopeProfile;
  defaultProfile: ScopeProfile;
  onChange: (profile: ScopeProfile) => void;
  disabled: boolean;
  isDefault: boolean;
}

const SCOPE_INFO: Record<ProjectionProfileScope, { title: string; description: string; icon: React.ReactNode }> = {
  entity_detail: {
    title: 'Entity Detail View',
    description: 'Semantic roles for the canonical entity detail page header',
    icon: <FileText className="w-4 h-4" />,
  },
  entities_list: {
    title: 'Entity List View',
    description: 'Semantic roles for canonical entities in browsing tables and grids',
    icon: <List className="w-4 h-4" />,
  },
  search: {
    title: 'Search Results',
    description: 'Semantic roles for canonical entities in search results (includes snippet)',
    icon: <Search className="w-4 h-4" />,
  },
};

function ScopeConfig({ scope, profile, defaultProfile, onChange, disabled, isDefault }: ScopeConfigProps) {
  const [isExpanded, setIsExpanded] = useState(scope === 'entity_detail');

  const updateField = (field: keyof ScopeProfile, value: string[]) => {
    onChange({ ...profile, [field]: value });
  };

  const info = SCOPE_INFO[scope];
  const showSnippet = scope === 'search';

  return (
    <div className="border border-lichen rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-parchment hover:bg-stone-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-archive" />
          ) : (
            <ChevronRight className="w-4 h-4 text-archive" />
          )}
          <div className="text-archive">{info.icon}</div>
          <div className="text-left">
            <h3 className="font-medium text-ink">{info.title}</h3>
            <p className="text-xs text-archive">{info.description}</p>
          </div>
        </div>
        {isDefault && (
          <span className="text-xs px-2 py-0.5 bg-stone text-archive rounded">
            Using defaults
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="px-4 py-4 border-t border-lichen bg-stone-50/50 space-y-4">
          <PathEditor
            label="Title"
            description="Primary identifier for the canonical entity. Paths are tried in order; first non-empty value wins."
            paths={profile.title || []}
            onChange={(paths) => updateField('title', paths)}
            disabled={disabled}
            required
          />

          <PathEditor
            label="Subtitle"
            description="Secondary context for the canonical entity (e.g., type, category, date)."
            paths={profile.subtitle || []}
            onChange={(paths) => updateField('subtitle', paths)}
            disabled={disabled}
          />

          <PathEditor
            label="Thumbnail"
            description="Visual representation of the canonical entity. Must resolve to an image URL."
            paths={profile.thumbnail || []}
            onChange={(paths) => updateField('thumbnail', paths)}
            disabled={disabled}
          />

          {showSnippet && (
            <PathEditor
              label="Snippet"
              description="Text excerpt shown in search results to help users identify the canonical entity."
              paths={profile.snippet || []}
              onChange={(paths) => updateField('snippet', paths)}
              disabled={disabled}
            />
          )}

          {/* Show default paths as reference */}
          <div className="mt-4 pt-4 border-t border-lichen">
            <details className="text-xs text-archive">
              <summary className="cursor-pointer hover:text-ink">View default paths</summary>
              <div className="mt-2 space-y-1 pl-4">
                <div><strong>Title:</strong> <code>{defaultProfile.title?.join(' → ') || 'none'}</code></div>
                <div><strong>Subtitle:</strong> <code>{defaultProfile.subtitle?.join(' → ') || 'none'}</code></div>
                <div><strong>Thumbnail:</strong> <code>{defaultProfile.thumbnail?.join(' → ') || 'none'}</code></div>
                {showSnippet && (
                  <div><strong>Snippet:</strong> <code>{defaultProfile.snippet?.join(' → ') || 'none'}</code></div>
                )}
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================

export default function ProjectionConfigPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();

  const canEdit = hasPermission('org.manage_settings');

  const [localConfig, setLocalConfig] = useState<ProjectionConfig | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Fetch projection profiles
  const { data, isLoading, error } = useQuery({
    queryKey: ['projection-profiles', organizationId],
    queryFn: () => getProjectionProfiles(organizationId!),
    enabled: !!organizationId,
  });

  // Fetch sample entity for preview
  const { data: sampleData, isLoading: sampleLoading } = useQuery({
    queryKey: ['sample-entity', organizationId],
    queryFn: async () => {
      const result = await queryEntities({
        organization_id: organizationId!,
        limit: 1,
      });
      return result.items[0]?.payload || null;
    },
    enabled: !!organizationId,
  });

  // Initialize local config when data loads
  useEffect(() => {
    if (data?.config) {
      setLocalConfig(data.config);
      setHasChanges(false);
    }
  }, [data]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () => updateProjectionProfiles(organizationId!, localConfig!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projection-profiles', organizationId] });
      setHasChanges(false);
      setSaveError(null);
    },
    onError: (err: Error) => {
      setSaveError(err.message || 'Failed to save configuration');
    },
  });

  // Reset mutation
  const resetMutation = useMutation({
    mutationFn: () => deleteProjectionProfiles(organizationId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projection-profiles', organizationId] });
      setHasChanges(false);
      setSaveError(null);
    },
    onError: (err: Error) => {
      setSaveError(err.message || 'Failed to reset configuration');
    },
  });

  const updateScopeProfile = (scope: ProjectionProfileScope, profile: ScopeProfile) => {
    if (!localConfig) return;
    setLocalConfig({
      ...localConfig,
      profiles: {
        ...localConfig.profiles,
        [scope]: profile,
      },
    });
    setHasChanges(true);
  };

  const handleSave = () => {
    if (!localConfig) return;
    saveMutation.mutate();
  };

  const handleReset = () => {
    setShowResetConfirm(true);
  };

  const confirmReset = () => {
    resetMutation.mutate();
  };

  const handleCancel = () => {
    if (data?.config) {
      setLocalConfig(data.config);
      setHasChanges(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-8">
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  if (error || !data || !localConfig) {
    return (
      <div className="max-w-5xl mx-auto p-8">
        <div className="text-semantic-error">Failed to load projection configuration</div>
      </div>
    );
  }

  const scopes: ProjectionProfileScope[] = ['entity_detail', 'entities_list', 'search'];

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Layers className="w-6 h-6 text-forest" style={{ opacity: 0.6 }} />
              <h1 className="text-2xl font-semibold text-ink">Canonical Display Fields</h1>
              <span className="px-2 py-0.5 text-xs font-medium bg-stone-100 text-stone-600 rounded">
                Organization defaults
              </span>
            </div>
            <p className="text-sm text-archive">
              Define how canonical entities are displayed across the application. Configure semantic roles
              (title, subtitle, thumbnail, snippet) that determine which fields appear in each context.
            </p>
          </div>

          {canEdit && (
            <div className="flex items-center gap-2">
              {hasChanges && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-3 py-1.5 text-sm text-archive hover:text-ink"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={handleReset}
                disabled={data.is_default || resetMutation.isPending}
                className="px-3 py-1.5 text-sm text-archive hover:text-ink disabled:opacity-50 flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!hasChanges || saveMutation.isPending}
                className="px-4 py-1.5 text-sm bg-bark text-parchment rounded hover:bg-copper-dark disabled:opacity-50 flex items-center gap-1"
              >
                {saveMutation.isPending ? (
                  <>Saving...</>
                ) : (
                  <>
                    <Save className="w-3 h-3" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Info box */}
        <div className="flex gap-3 p-4 bg-semantic-info/10 border border-semantic-info/30 rounded-lg">
          <Info className="w-5 h-5 text-semantic-info flex-shrink-0 mt-0.5" />
          <div className="text-sm text-semantic-info">
            <p className="font-medium mb-1">Fallback resolution order</p>
            <p className="text-semantic-info">
              For each semantic role, paths are evaluated in order until a non-empty value is found in the
              canonical entity's payload. If all configured paths are empty, the system uses a fallback
              (e.g., entity ID for title, empty string for others). This ensures every canonical entity
              has a meaningful display representation.
            </p>
          </div>
        </div>

        {/* Status messages */}
        {saveError && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded text-sm text-semantic-error">
            {saveError}
          </div>
        )}

        {hasChanges && (
          <div className="p-3 bg-semantic-warning/10 border border-semantic-warning/30 rounded text-sm text-semantic-warning flex items-center gap-2">
            <span className="font-medium">Unsaved changes</span>
            <span className="text-semantic-warning">- Save your changes or cancel to revert.</span>
          </div>
        )}

        {!canEdit && (
          <div className="p-3 bg-semantic-warning/10 border border-semantic-warning/30 rounded text-sm text-semantic-warning">
            You don't have permission to edit canonical display field configuration.
          </div>
        )}

        {/* Main content - two columns on large screens */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Scope configurations */}
          <div className="lg:col-span-2 space-y-3">
            {scopes.map((scope) => (
              <ScopeConfig
                key={scope}
                scope={scope}
                profile={localConfig.profiles[scope]}
                defaultProfile={data.defaults.profiles[scope]}
                onChange={(profile) => updateScopeProfile(scope, profile)}
                disabled={!canEdit}
                isDefault={data.is_default}
              />
            ))}
          </div>

          {/* Preview panel */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-ink">
                  <Eye className="w-4 h-4" />
                  Live Preview
                </div>
                <p className="text-xs text-archive mt-0.5">Sample canonical entity</p>
              </div>
              <button
                type="button"
                onClick={() => setShowPreview(!showPreview)}
                className="text-xs text-archive hover:text-ink"
              >
                {showPreview ? 'Hide' : 'Show'}
              </button>
            </div>

            {showPreview && (
              <div className="space-y-3">
                {scopes.map((scope) => (
                  <PreviewCard
                    key={scope}
                    scope={scope}
                    record={sampleData ?? null}
                    profile={localConfig.profiles[scope]}
                    isLoading={sampleLoading}
                  />
                ))}
                {!sampleLoading && !sampleData && (
                  <div className="text-xs text-archive text-center py-4">
                    Run a pipeline to add canonical entities for preview
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Default paths reference */}
        <div className="mt-8 pt-6 border-t border-lichen">
          <h2 className="text-sm font-medium text-ink mb-1">System Default Paths</h2>
          <p className="text-xs text-archive mb-3">
            These paths are used when no custom configuration is set. Each semantic role resolves independently.
          </p>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="font-medium text-archive">Title:</span>
              <code className="ml-2 text-archive">
                {data.defaults.profiles.entity_detail.title?.join(' → ')}
              </code>
            </div>
            <div>
              <span className="font-medium text-archive">Subtitle:</span>
              <code className="ml-2 text-archive">
                {data.defaults.profiles.entity_detail.subtitle?.join(' → ')}
              </code>
            </div>
            <div>
              <span className="font-medium text-archive">Thumbnail:</span>
              <code className="ml-2 text-archive">
                {data.defaults.profiles.entity_detail.thumbnail?.join(' → ')}
              </code>
            </div>
            <div>
              <span className="font-medium text-archive">Snippet:</span>
              <code className="ml-2 text-archive">
                {data.defaults.profiles.search.snippet?.join(' → ')}
              </code>
            </div>
          </div>
        </div>
      </div>

      {/* Reset Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={confirmReset}
        title="Reset Settings"
        message="Reset all projection settings to system defaults? This will remove any custom configuration you have set up."
        confirmText="Reset"
        confirmStyle="danger"
      />
    </div>
  );
}
