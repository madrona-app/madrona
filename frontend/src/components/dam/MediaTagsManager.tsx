import { useState, useRef, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Loader2, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import {
  listTagDefinitions,
  getMediaTags,
  setMediaTag,
  deleteMediaTag,
  listTagValuesForDefinition,
} from '../../lib/api';
import type { MediaTagDefinition, MediaTag, MediaTagValue } from '../../lib/schemas';
import { useAuth } from '../../hooks/useAuth';
import { cn } from '../../lib/utils';

interface MediaTagsManagerProps {
  organizationId: string;
  mediaId: string;
  readonly?: boolean;
}

// ─── Shared hooks / helpers ────────────────────────────────────────────────

function useAllowedValues(organizationId: string, definition: MediaTagDefinition, enabled: boolean) {
  return useQuery({
    queryKey: ['tag-values', organizationId, definition.definition_id],
    queryFn: () => listTagValuesForDefinition(organizationId, definition.definition_id),
    enabled,
    staleTime: 60_000,
  });
}

function useSetTag(organizationId: string, mediaId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { definition_id: string; value_id?: string; tag_value?: string }) =>
      setMediaTag(organizationId, mediaId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-tags', organizationId, mediaId] });
    },
  });
}

function useDeleteTag(organizationId: string, mediaId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { definition_id: string; value_id?: string }) =>
      deleteMediaTag(organizationId, mediaId, args.definition_id, args.value_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-tags', organizationId, mediaId] });
    },
  });
}

// Shared wrapper: label row + children slot. Keeps visual rhythm across field types.
interface FieldShellProps {
  definition: MediaTagDefinition;
  children: React.ReactNode;
  rightAccessory?: React.ReactNode;
  isBusy?: boolean;
}
function FieldShell({ definition, children, rightAccessory, isBusy }: FieldShellProps) {
  return (
    <div className="flex items-start gap-2 py-1">
      <label className="text-sm text-archive min-w-[110px] pt-1.5">
        {definition.display_name}
        {definition.is_required && <span className="text-semantic-error ml-0.5">*</span>}:
      </label>
      <div className="flex-1 min-w-0">{children}</div>
      <div className="pt-1 flex items-center gap-1">
        {isBusy && <Loader2 size={14} className="animate-spin text-archive" />}
        {rightAccessory}
      </div>
    </div>
  );
}

// ─── Field components ──────────────────────────────────────────────────────

interface FieldProps {
  definition: MediaTagDefinition;
  tags: MediaTag[]; // existing tags for this definition
  organizationId: string;
  mediaId: string;
  readonly?: boolean;
}

// text — free-form single value
function TextField({ definition, tags, organizationId, mediaId, readonly }: FieldProps) {
  const current = tags[0];
  const [value, setValue] = useState(current?.tag_value ?? '');
  const [isEditing, setIsEditing] = useState(false);
  const setTag = useSetTag(organizationId, mediaId);
  const deleteTag = useDeleteTag(organizationId, mediaId);

  useEffect(() => {
    if (!isEditing) setValue(current?.tag_value ?? '');
  }, [current?.tag_value, isEditing]);

  const commit = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      if (current) deleteTag.mutate({ definition_id: definition.definition_id });
    } else if (trimmed !== current?.tag_value) {
      setTag.mutate({ definition_id: definition.definition_id, tag_value: trimmed });
    }
    setIsEditing(false);
  };

  if (readonly) {
    return (
      <FieldShell definition={definition}>
        <div className="py-1.5 text-sm">
          {current?.tag_value || <span className="text-archive italic">Not set</span>}
        </div>
      </FieldShell>
    );
  }

  return (
    <FieldShell
      definition={definition}
      isBusy={setTag.isPending || deleteTag.isPending}
      rightAccessory={
        current && !isEditing ? (
          <button
            type="button"
            onClick={() => deleteTag.mutate({ definition_id: definition.definition_id })}
            className="p-1 text-archive hover:text-semantic-error rounded"
            title="Clear"
            aria-label={`Clear ${definition.display_name}`}
          >
            <X size={14} />
          </button>
        ) : null
      }
    >
      <input
        type="text"
        value={value}
        onFocus={() => setIsEditing(true)}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setValue(current?.tag_value ?? '');
            setIsEditing(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="Type a value..."
        className="w-full px-2 py-1.5 border border-lichen rounded text-sm bg-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:border-bark"
      />
    </FieldShell>
  );
}

// date — single ISO date
function DateField({ definition, tags, organizationId, mediaId, readonly }: FieldProps) {
  const current = tags[0];
  const setTag = useSetTag(organizationId, mediaId);
  const deleteTag = useDeleteTag(organizationId, mediaId);

  if (readonly) {
    return (
      <FieldShell definition={definition}>
        <div className="py-1.5 text-sm">
          {current?.tag_value || <span className="text-archive italic">Not set</span>}
        </div>
      </FieldShell>
    );
  }

  return (
    <FieldShell
      definition={definition}
      isBusy={setTag.isPending || deleteTag.isPending}
      rightAccessory={
        current ? (
          <button
            type="button"
            onClick={() => deleteTag.mutate({ definition_id: definition.definition_id })}
            className="p-1 text-archive hover:text-semantic-error rounded"
            title="Clear"
            aria-label={`Clear ${definition.display_name}`}
          >
            <X size={14} />
          </button>
        ) : null
      }
    >
      <input
        type="date"
        value={current?.tag_value ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) {
            if (current) deleteTag.mutate({ definition_id: definition.definition_id });
          } else {
            setTag.mutate({ definition_id: definition.definition_id, tag_value: v });
          }
        }}
        className="w-full px-2 py-1.5 border border-lichen rounded text-sm bg-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:border-bark"
      />
    </FieldShell>
  );
}

// dropdown — single value from allowed set
function DropdownField({ definition, tags, organizationId, mediaId, readonly }: FieldProps) {
  const current = tags[0];
  const { data: valuesData, isLoading } = useAllowedValues(organizationId, definition, !readonly);
  const setTag = useSetTag(organizationId, mediaId);
  const deleteTag = useDeleteTag(organizationId, mediaId);

  const values = valuesData?.values ?? [];

  if (readonly) {
    return (
      <FieldShell definition={definition}>
        <div className="py-1.5 text-sm">
          {current?.tag_value || <span className="text-archive italic">Not set</span>}
        </div>
      </FieldShell>
    );
  }

  return (
    <FieldShell
      definition={definition}
      isBusy={setTag.isPending || deleteTag.isPending || isLoading}
      rightAccessory={
        current ? (
          <button
            type="button"
            onClick={() => deleteTag.mutate({ definition_id: definition.definition_id })}
            className="p-1 text-archive hover:text-semantic-error rounded"
            title="Clear"
            aria-label={`Clear ${definition.display_name}`}
          >
            <X size={14} />
          </button>
        ) : null
      }
    >
      <select
        value={current?.value_id ?? ''}
        onChange={(e) => {
          const vid = e.target.value;
          if (!vid) {
            if (current) deleteTag.mutate({ definition_id: definition.definition_id });
          } else {
            setTag.mutate({ definition_id: definition.definition_id, value_id: vid });
          }
        }}
        className="w-full px-2 py-1.5 border border-lichen rounded text-sm bg-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:border-bark"
      >
        <option value="">Select...</option>
        {values.map((v) => (
          <option key={v.value_id} value={v.value_id}>
            {v.value}
          </option>
        ))}
        {/* If the current value was deprecated, show it so the user sees what's set. */}
        {current?.value_id && !values.some((v) => v.value_id === current.value_id) && (
          <option value={current.value_id}>{current.tag_value} (deprecated)</option>
        )}
      </select>
    </FieldShell>
  );
}

// multi_select — multiple values from a fixed list, chip input + add-dropdown
function MultiSelectField({ definition, tags, organizationId, mediaId, readonly }: FieldProps) {
  const { data: valuesData, isLoading } = useAllowedValues(organizationId, definition, !readonly);
  const setTag = useSetTag(organizationId, mediaId);
  const deleteTag = useDeleteTag(organizationId, mediaId);
  const [adding, setAdding] = useState(false);

  const values = valuesData?.values ?? [];
  const selectedIds = new Set(tags.map((t) => t.value_id).filter((v): v is string => !!v));
  const remaining = values.filter((v) => !selectedIds.has(v.value_id));

  const handleAdd = (valueId: string) => {
    setTag.mutate({ definition_id: definition.definition_id, value_id: valueId });
    setAdding(false);
  };

  return (
    <FieldShell definition={definition} isBusy={setTag.isPending || deleteTag.isPending || isLoading}>
      <div className="flex flex-wrap items-center gap-1.5 py-1">
        {tags.length === 0 && readonly && (
          <span className="text-sm text-archive italic">Not set</span>
        )}
        {tags.map((tag) => (
          <span
            key={tag.tag_id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-bark/10 text-xs text-ink"
          >
            {tag.tag_value}
            {!readonly && (
              <button
                type="button"
                onClick={() =>
                  deleteTag.mutate({
                    definition_id: definition.definition_id,
                    value_id: tag.value_id ?? undefined,
                  })
                }
                className="text-archive hover:text-semantic-error"
                aria-label={`Remove ${tag.tag_value}`}
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        {!readonly && remaining.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setAdding((a) => !a)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-lichen text-xs text-archive hover:bg-stone/50"
            >
              <Plus size={12} /> Add
            </button>
            {adding && (
              <>
                <div role="presentation" className="fixed inset-0 z-40" onClick={() => setAdding(false)} />
                <div className="absolute z-50 mt-1 left-0 min-w-[12rem] max-h-60 overflow-auto bg-parchment border border-lichen rounded shadow-lg">
                  {remaining.map((v) => (
                    <button
                      key={v.value_id}
                      type="button"
                      onClick={() => handleAdd(v.value_id)}
                      className="block w-full text-left px-3 py-1.5 text-sm text-ink hover:bg-stone/50"
                    >
                      {v.value}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </FieldShell>
  );
}

// dynamic_keywords — combobox: autocomplete from allowed values + create-new
function DynamicKeywordsField({ definition, tags, organizationId, mediaId, readonly }: FieldProps) {
  const { data: valuesData, isLoading } = useAllowedValues(organizationId, definition, !readonly);
  const setTag = useSetTag(organizationId, mediaId);
  const deleteTag = useDeleteTag(organizationId, mediaId);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const values = valuesData?.values ?? [];
  const selectedIds = new Set(tags.map((t) => t.value_id).filter((v): v is string => !!v));
  const normalized = input.trim().toLowerCase();
  const matches = values
    .filter((v) => !selectedIds.has(v.value_id))
    .filter((v) => !normalized || v.value.toLowerCase().includes(normalized))
    .slice(0, 15);
  const exactMatch = values.some((v) => v.value.toLowerCase() === normalized);

  const commit = (value?: string, valueId?: string) => {
    const body: { definition_id: string; value_id?: string; tag_value?: string } = {
      definition_id: definition.definition_id,
    };
    if (valueId) body.value_id = valueId;
    else if (value && value.trim()) body.tag_value = value.trim();
    else return;
    setTag.mutate(body);
    setInput('');
    setOpen(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (!input.trim()) return;
      commit(input);
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      const last = tags[tags.length - 1];
      deleteTag.mutate({
        definition_id: definition.definition_id,
        value_id: last.value_id ?? undefined,
      });
    }
  };

  return (
    <FieldShell definition={definition} isBusy={setTag.isPending || deleteTag.isPending || isLoading}>
      <div ref={rootRef} className="relative">
        <div
          className="flex flex-wrap items-center gap-1.5 min-h-[2.25rem] px-1.5 py-1 border border-lichen rounded bg-parchment focus-within:ring-2 focus-within:ring-bark/30 focus-within:border-bark"
          onClick={() => setOpen(true)}
        >
          {tags.map((tag) => (
            <span
              key={tag.tag_id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-bark/10 text-xs text-ink"
            >
              {tag.tag_value}
              {!readonly && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteTag.mutate({
                      definition_id: definition.definition_id,
                      value_id: tag.value_id ?? undefined,
                    });
                  }}
                  className="text-archive hover:text-semantic-error"
                  aria-label={`Remove ${tag.tag_value}`}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
          {!readonly && (definition.allow_multiple || tags.length === 0) && (
            <input
              type="text"
              value={input}
              placeholder={tags.length === 0 ? 'Type or pick a value…' : ''}
              onChange={(e) => {
                setInput(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKey}
              className="flex-1 min-w-[8rem] bg-transparent text-sm py-0.5 focus:outline-none"
            />
          )}
        </div>
        {open && !readonly && (matches.length > 0 || (input.trim() && !exactMatch)) && (
          <div className="absolute z-50 mt-1 w-full max-h-60 overflow-auto bg-parchment border border-lichen rounded shadow-lg">
            {matches.map((v) => (
              <button
                key={v.value_id}
                type="button"
                onClick={() => commit(undefined, v.value_id)}
                className="block w-full text-left px-3 py-1.5 text-sm text-ink hover:bg-stone/50"
              >
                {v.value}
              </button>
            ))}
            {input.trim() && !exactMatch && (
              <button
                type="button"
                onClick={() => commit(input)}
                className="block w-full text-left px-3 py-1.5 text-sm text-bark hover:bg-stone/50 border-t border-lichen"
              >
                <Plus size={12} className="inline mr-1" />
                Create "{input.trim()}"
              </button>
            )}
          </div>
        )}
      </div>
    </FieldShell>
  );
}

// category_tree — hierarchical picker (flat list with depth indentation)
function CategoryTreeField({ definition, tags, organizationId, mediaId, readonly }: FieldProps) {
  const { data: valuesData, isLoading } = useAllowedValues(organizationId, definition, !readonly);
  const setTag = useSetTag(organizationId, mediaId);
  const deleteTag = useDeleteTag(organizationId, mediaId);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const values = valuesData?.values ?? [];
  const selectedIds = new Set(tags.map((t) => t.value_id).filter((v): v is string => !!v));

  // Build which nodes have children so we can show expand/collapse affordances.
  const hasChildren = useMemo(() => {
    const s = new Set<string>();
    for (const v of values) if (v.parent_id) s.add(v.parent_id);
    return s;
  }, [values]);

  // Walk visible values: hide anything whose ancestor is collapsed.
  const visible = useMemo(() => {
    const hiddenParents = new Set<string>();
    const out: MediaTagValue[] = [];
    for (const v of values) {
      if (v.parent_id && hiddenParents.has(v.parent_id)) {
        hiddenParents.add(v.value_id);
        continue;
      }
      out.push(v);
      if (collapsed.has(v.value_id)) hiddenParents.add(v.value_id);
    }
    return out;
  }, [values, collapsed]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggle = (v: MediaTagValue) => {
    if (selectedIds.has(v.value_id)) {
      deleteTag.mutate({ definition_id: definition.definition_id, value_id: v.value_id });
    } else {
      setTag.mutate({ definition_id: definition.definition_id, value_id: v.value_id });
    }
  };

  return (
    <FieldShell definition={definition} isBusy={setTag.isPending || deleteTag.isPending || isLoading}>
      <div ref={rootRef} className="relative">
        <div
          className="flex flex-wrap items-center gap-1.5 min-h-[2.25rem] px-1.5 py-1 border border-lichen rounded bg-parchment cursor-text"
          onClick={() => !readonly && setOpen(true)}
        >
          {tags.length === 0 && (
            <span className="text-sm text-archive italic">
              {readonly ? 'Not set' : 'Click to choose…'}
            </span>
          )}
          {tags.map((tag) => (
            <span
              key={tag.tag_id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-bark/10 text-xs text-ink"
            >
              {tag.tag_value}
              {!readonly && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteTag.mutate({
                      definition_id: definition.definition_id,
                      value_id: tag.value_id ?? undefined,
                    });
                  }}
                  className="text-archive hover:text-semantic-error"
                  aria-label={`Remove ${tag.tag_value}`}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
        {open && !readonly && values.length > 0 && (
          <div className="absolute z-50 mt-1 w-full max-h-80 overflow-auto bg-parchment border border-lichen rounded shadow-lg py-1">
            {visible.map((v) => {
              const depth = v.depth ?? 0;
              const isSelected = selectedIds.has(v.value_id);
              const isParent = hasChildren.has(v.value_id);
              return (
                <div
                  key={v.value_id}
                  className="flex items-center gap-1 px-2 py-1 text-sm hover:bg-stone/50"
                  style={{ paddingLeft: 8 + depth * 14 }}
                >
                  {isParent ? (
                    <button
                      type="button"
                      onClick={() => toggleCollapse(v.value_id)}
                      className="text-archive hover:text-ink p-0.5"
                      aria-label={collapsed.has(v.value_id) ? 'Expand' : 'Collapse'}
                    >
                      {collapsed.has(v.value_id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                  ) : (
                    <span className="w-[18px]" />
                  )}
                  <button
                    type="button"
                    onClick={() => handleToggle(v)}
                    className={cn(
                      'flex-1 text-left truncate',
                      isSelected ? 'text-bark font-medium' : 'text-ink',
                    )}
                  >
                    {v.value}
                  </button>
                  {isSelected && <span className="text-bark text-xs">✓</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </FieldShell>
  );
}

// ─── Entry point ────────────────────────────────────────────────────────────

function TagField(props: FieldProps) {
  switch (props.definition.field_type) {
    case 'date':
      return <DateField {...props} />;
    case 'dropdown':
      return <DropdownField {...props} />;
    case 'multi_select':
      return <MultiSelectField {...props} />;
    case 'category_tree':
      return <CategoryTreeField {...props} />;
    case 'dynamic_keywords':
      return <DynamicKeywordsField {...props} />;
    case 'text':
    default:
      return <TextField {...props} />;
  }
}

export function MediaTagsManager({ organizationId, mediaId, readonly = false }: MediaTagsManagerProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const { user } = useAuth();
  const isAdmin = user?.permissions?.some((p) => p.startsWith('admin') || p === 'org.manage') || user?.is_platform_admin || false;

  const { data: definitionsData, isLoading: loadingDefinitions } = useQuery({
    queryKey: ['tag-definitions', organizationId, false],
    queryFn: () => listTagDefinitions(organizationId, { includeInactive: false }),
  });

  const { data: tagsData, isLoading: loadingTags } = useQuery({
    queryKey: ['media-tags', organizationId, mediaId],
    queryFn: () => getMediaTags(organizationId, mediaId),
  });

  const definitions = definitionsData?.definitions || [];
  const tags = tagsData?.tags || [];

  // Group tags by definition_id (definition may have multiple tags for multi-valued fields).
  const tagsByDefinition = useMemo(() => {
    const map = new Map<string, MediaTag[]>();
    for (const t of tags) {
      const list = map.get(t.definition_id) ?? [];
      list.push(t);
      map.set(t.definition_id, list);
    }
    return map;
  }, [tags]);

  const isLoading = loadingDefinitions || loadingTags;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-archive">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">Loading tags...</span>
      </div>
    );
  }

  if (definitions.length === 0) {
    if (isAdmin) {
      return (
        <div className="py-3 text-sm text-archive">
          No tag vocabulary configured.{' '}
          <Link
            to={`/organizations/${orgId || organizationId}/media/tag-settings`}
            className="text-bark hover:text-copper-dark"
          >
            Set up tags
          </Link>
        </div>
      );
    }
    return <p className="py-3 text-sm text-archive">Tags: not configured</p>;
  }

  return (
    <div className="space-y-1">
      {definitions.map((def) => (
        <TagField
          key={def.definition_id}
          definition={def}
          tags={tagsByDefinition.get(def.definition_id) ?? []}
          organizationId={organizationId}
          mediaId={mediaId}
          readonly={readonly}
        />
      ))}
    </div>
  );
}

