/**
 * MenuBuilder — Drag-and-drop menu tree builder for header/footer nav.
 *
 * Features:
 * - Sortable list of menu items with drag handles
 * - One level of nesting (children)
 * - Link types: page, url, collection, category
 * - Page picker from page tree, URL text input
 * - Save triggers PUT to menu endpoint
 */

import { useState, useCallback, useEffect } from 'react';
import Checkbox from '../../../components/Checkbox';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Loader2,
  Save,
  ExternalLink,
  FileText,
  Globe,
  Tag,
  Frame,
  CalendarDays,
} from 'lucide-react';
import { getMenu, saveMenu, getPageTree } from '../../../lib/api/content';
import type {
  MenuLocation,
  MenuItemLinkType,
  MenuItem,
  PageTreeNode,
} from '../../../types/content';
import { MediaPickerModal } from '../../../components/content/MediaPickerModal';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

// =============================================================================
// Types
// =============================================================================

interface LocalMenuItem {
  id: string; // local tracking ID
  label: string;
  link_type: MenuItemLinkType;
  page_id: string | null;
  url: string | null;
  description: string | null;
  image_media_id: string | null;
  highlight: boolean;
  children: LocalMenuItem[];
  expanded: boolean;
}

function newItem(): LocalMenuItem {
  return {
    id: crypto.randomUUID(),
    label: '',
    link_type: 'url',
    page_id: null,
    url: null,
    description: null,
    image_media_id: null,
    highlight: false,
    children: [],
    expanded: false,
  };
}

function fromServerItem(item: MenuItem): LocalMenuItem {
  return {
    id: item.menu_item_id || crypto.randomUUID(),
    label: item.label,
    link_type: item.link_type,
    page_id: item.page_id ?? null,
    url: item.url ?? null,
    description: item.description ?? null,
    image_media_id: item.image_media_id ?? null,
    highlight: item.highlight ?? false,
    children: (item.children ?? []).map(fromServerItem),
    expanded: false,
  };
}

function toSaveItem(item: LocalMenuItem) {
  return {
    label: item.label,
    link_type: item.link_type,
    page_id: item.page_id || null,
    url: item.url || null,
    description: item.description || null,
    image_media_id: item.image_media_id || null,
    highlight: item.highlight || false,
    children: item.children.map((c) => ({
      label: c.label,
      link_type: c.link_type,
      page_id: c.page_id || null,
      url: c.url || null,
      description: c.description || null,
      image_media_id: c.image_media_id || null,
      highlight: c.highlight || false,
    })),
  };
}

// =============================================================================
// Link type icons & labels
// =============================================================================

const LINK_TYPE_OPTIONS: Array<{ value: MenuItemLinkType; label: string; icon: typeof FileText }> = [
  { value: 'page', label: 'Page', icon: FileText },
  { value: 'url', label: 'URL', icon: ExternalLink },
  { value: 'collection', label: 'Collection', icon: Globe },
  { value: 'category', label: 'Category', icon: Tag },
  { value: 'exhibition', label: 'Exhibition', icon: Frame },
  { value: 'event', label: 'Event', icon: CalendarDays },
];

// =============================================================================
// Flatten page tree for dropdown
// =============================================================================

function flattenTree(nodes: PageTreeNode[], prefix = ''): Array<{ id: string; label: string }> {
  const result: Array<{ id: string; label: string }> = [];
  for (const node of nodes) {
    result.push({ id: node.page_id, label: prefix + node.title });
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children, prefix + '\u00A0\u00A0\u00A0\u00A0'));
    }
  }
  return result;
}

// =============================================================================
// SortableItem
// =============================================================================

interface SortableItemProps {
  item: LocalMenuItem;
  isChild?: boolean;
  pages: Array<{ id: string; label: string }>;
  categories: Array<{ id: string; label: string }>;
  orgSlug: string;
  organizationId: string;
  onUpdate: (id: string, updates: Partial<LocalMenuItem>) => void;
  onRemove: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onRemoveChild: (parentId: string, childId: string) => void;
  onUpdateChild: (parentId: string, childId: string, updates: Partial<LocalMenuItem>) => void;
  onToggleExpand: (id: string) => void;
  onReorderChildren: (parentId: string, oldIndex: number, newIndex: number) => void;
}

function SortableMenuItem({
  item,
  isChild,
  pages,
  categories,
  orgSlug,
  organizationId,
  onUpdate,
  onRemove,
  onAddChild,
  onRemoveChild,
  onUpdateChild,
  onToggleExpand,
  onReorderChildren,
}: SortableItemProps) {
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [childImagePickerId, setChildImagePickerId] = useState<string | null>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={isChild ? 'ml-8' : ''}>
      <div className="flex items-start gap-2 p-3 bg-parchment border border-lichen rounded-lg mb-2">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="mt-1 p-1 text-archive hover:text-ink cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical size={16} />
        </button>

        {/* Main content */}
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            {/* Label input */}
            <input
              type="text"
              value={item.label}
              onChange={(e) => onUpdate(item.id, { label: e.target.value })}
              placeholder="Menu label"
              className="flex-1 border border-lichen rounded px-2 py-1.5 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />

            {/* Link type selector */}
            <select
              value={item.link_type}
              onChange={(e) => {
                const lt = e.target.value as MenuItemLinkType;
                onUpdate(item.id, {
                  link_type: lt,
                  page_id: null,
                  url: lt === 'collection' ? `/c/${orgSlug}` : null,
                });
              }}
              className="border border-lichen rounded px-2 py-1.5 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              {LINK_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {/* Delete */}
            <button
              onClick={() => onRemove(item.id)}
              className="p-1.5 text-archive hover:text-semantic-error transition-colors"
              aria-label="Remove item"
            >
              <Trash2 size={14} />
            </button>
          </div>

          {/* Link target */}
          {item.link_type === 'page' && (
            <select
              value={item.page_id ?? ''}
              onChange={(e) => onUpdate(item.id, { page_id: e.target.value || null })}
              className="w-full border border-lichen rounded px-2 py-1.5 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <option value="">Select a page...</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          )}

          {item.link_type === 'url' && (
            <input
              type="text"
              value={item.url ?? ''}
              onChange={(e) => onUpdate(item.id, { url: e.target.value })}
              placeholder="https://..."
              className="w-full border border-lichen rounded px-2 py-1.5 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          )}

          {item.link_type === 'collection' && (
            <p className="text-xs text-archive">
              Links to your collection browser at /c/{orgSlug}
            </p>
          )}

          {item.link_type === 'category' && (
            <select
              value={item.url ?? ''}
              onChange={(e) => onUpdate(item.id, { url: e.target.value || null })}
              className="w-full border border-lichen rounded px-2 py-1.5 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <option value="">Select a category...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          )}

          {item.link_type === 'exhibition' && (
            <div className="space-y-1">
              <input
                type="text"
                value={item.url ?? ''}
                onChange={(e) => onUpdate(item.id, { url: e.target.value })}
                placeholder="Exhibition slug (leave empty for all exhibitions)"
                className="w-full border border-lichen rounded px-2 py-1.5 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
              <p className="text-xs text-archive">Links to /c/{orgSlug}/exhibitions/{item.url || '...'}</p>
            </div>
          )}

          {item.link_type === 'event' && (
            <div className="space-y-1">
              <input
                type="text"
                value={item.url ?? ''}
                onChange={(e) => onUpdate(item.id, { url: e.target.value })}
                placeholder="Event slug (leave empty for all events)"
                className="w-full border border-lichen rounded px-2 py-1.5 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
              <p className="text-xs text-archive">Links to /c/{orgSlug}/events/{item.url || '...'}</p>
            </div>
          )}

          {/* Mega menu fields (description, highlight, image) */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={item.description ?? ''}
              onChange={(e) => onUpdate(item.id, { description: e.target.value || null })}
              placeholder="Description (mega menu)"
              className="flex-1 border border-lichen rounded px-2 py-1.5 text-xs text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
            <label className="inline-flex items-center gap-1 text-xs text-archive cursor-pointer select-none">
              <Checkbox
                checked={item.highlight}
                onChange={(e) => onUpdate(item.id, { highlight: e.target.checked })}
              />
              Highlight
            </label>
          </div>
          {/* Mega menu image */}
          <div className="flex items-center gap-2 pt-1">
            {item.image_media_id ? (
              <div className="flex items-center gap-2">
                <img
                  src={`/api/media/${item.image_media_id}/thumbnail?size=100`}
                  alt=""
                  className="w-10 h-10 rounded object-cover"
                />
                <button
                  type="button"
                  onClick={() => setShowImagePicker(true)}
                  className="text-xs text-bark hover:text-copper-dark transition-colors"
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={() => onUpdate(item.id, { image_media_id: null })}
                  className="text-xs text-archive hover:text-semantic-error transition-colors"
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowImagePicker(true)}
                className="text-xs text-archive hover:text-bark transition-colors"
              >
                + Add image (mega menu)
              </button>
            )}
          </div>
        </div>

        {/* Expand children toggle (top level only) */}
        {!isChild && (
          <button
            onClick={() => onToggleExpand(item.id)}
            className="mt-1 p-1 text-archive hover:text-ink transition-colors"
            title={item.expanded ? 'Collapse children' : 'Expand children'}
          >
            {item.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        )}
      </div>

      {/* Children (one level only, top level items only) */}
      {!isChild && item.expanded && (
        <div className="ml-8 mb-2">
          {item.children.map((child, childIndex) => (
            <div key={child.id} className="flex items-start gap-2 p-3 bg-stone/20 border border-lichen rounded-lg mb-2">
              {/* Child reorder buttons */}
              <div className="flex flex-col gap-0.5 mt-1">
                <button
                  onClick={() => {
                    if (childIndex > 0) onReorderChildren(item.id, childIndex, childIndex - 1);
                  }}
                  disabled={childIndex === 0}
                  className="p-0.5 text-archive hover:text-ink disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                  aria-label="Move up"
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  onClick={() => {
                    if (childIndex < item.children.length - 1) onReorderChildren(item.id, childIndex, childIndex + 1);
                  }}
                  disabled={childIndex === item.children.length - 1}
                  className="p-0.5 text-archive hover:text-ink disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                  aria-label="Move down"
                >
                  <ChevronDown size={12} />
                </button>
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={child.label}
                    onChange={(e) => onUpdateChild(item.id, child.id, { label: e.target.value })}
                    placeholder="Child label"
                    className="flex-1 border border-lichen rounded px-2 py-1.5 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                  />
                  <select
                    value={child.link_type}
                    onChange={(e) => {
                      const lt = e.target.value as MenuItemLinkType;
                      onUpdateChild(item.id, child.id, {
                        link_type: lt,
                        page_id: null,
                        url: lt === 'collection' ? `/c/${orgSlug}` : null,
                      });
                    }}
                    className="border border-lichen rounded px-2 py-1.5 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  >
                    {LINK_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => onRemoveChild(item.id, child.id)}
                    className="p-1.5 text-archive hover:text-semantic-error transition-colors"
                    aria-label="Remove child"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {child.link_type === 'page' && (
                  <select
                    value={child.page_id ?? ''}
                    onChange={(e) => onUpdateChild(item.id, child.id, { page_id: e.target.value || null })}
                    className="w-full border border-lichen rounded px-2 py-1.5 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  >
                    <option value="">Select a page...</option>
                    {pages.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                )}

                {child.link_type === 'url' && (
                  <input
                    type="text"
                    value={child.url ?? ''}
                    onChange={(e) => onUpdateChild(item.id, child.id, { url: e.target.value })}
                    placeholder="https://..."
                    className="w-full border border-lichen rounded px-2 py-1.5 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                  />
                )}

                {child.link_type === 'collection' && (
                  <p className="text-xs text-archive">
                    Links to collection browser
                  </p>
                )}

                {child.link_type === 'category' && (
                  <select
                    value={child.url ?? ''}
                    onChange={(e) => onUpdateChild(item.id, child.id, { url: e.target.value || null })}
                    className="w-full border border-lichen rounded px-2 py-1.5 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  >
                    <option value="">Select a category...</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                )}

                {child.link_type === 'exhibition' && (
                  <input
                    type="text"
                    value={child.url ?? ''}
                    onChange={(e) => onUpdateChild(item.id, child.id, { url: e.target.value })}
                    placeholder="Exhibition slug (leave empty for all)"
                    className="w-full border border-lichen rounded px-2 py-1.5 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  />
                )}

                {child.link_type === 'event' && (
                  <input
                    type="text"
                    value={child.url ?? ''}
                    onChange={(e) => onUpdateChild(item.id, child.id, { url: e.target.value })}
                    placeholder="Event slug (leave empty for all)"
                    className="w-full border border-lichen rounded px-2 py-1.5 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  />
                )}

                {/* Mega menu fields for children */}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={child.description ?? ''}
                    onChange={(e) => onUpdateChild(item.id, child.id, { description: e.target.value || null })}
                    placeholder="Description (mega menu)"
                    className="flex-1 border border-lichen rounded px-2 py-1.5 text-xs text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  />
                  <label className="inline-flex items-center gap-1 text-xs text-archive cursor-pointer select-none">
                    <Checkbox
                      checked={child.highlight ?? false}
                      onChange={(e) => onUpdateChild(item.id, child.id, { highlight: e.target.checked })}
                    />
                    Highlight
                  </label>
                </div>
                {/* Child image */}
                <div className="flex items-center gap-2 pt-1">
                  {child.image_media_id ? (
                    <div className="flex items-center gap-2">
                      <img
                        src={`/api/media/${child.image_media_id}/thumbnail?size=100`}
                        alt=""
                        className="w-10 h-10 rounded object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setChildImagePickerId(child.id)}
                        className="text-xs text-bark hover:text-copper-dark transition-colors"
                      >
                        Change
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateChild(item.id, child.id, { image_media_id: null })}
                        className="text-xs text-archive hover:text-semantic-error transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setChildImagePickerId(child.id)}
                      className="text-xs text-archive hover:text-bark transition-colors"
                    >
                      + Add image
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          <button
            onClick={() => onAddChild(item.id)}
            className="inline-flex items-center gap-1 text-xs text-archive hover:text-bark transition-colors"
          >
            <Plus size={12} />
            Add child item
          </button>
        </div>
      )}

      {/* Media picker for parent item image */}
      <MediaPickerModal
        isOpen={showImagePicker}
        onClose={() => setShowImagePicker(false)}
        onSelect={(id) => {
          onUpdate(item.id, { image_media_id: id });
          setShowImagePicker(false);
        }}
        organizationId={organizationId}
      />

      {/* Media picker for child item image */}
      {childImagePickerId && (
        <MediaPickerModal
          isOpen={true}
          onClose={() => setChildImagePickerId(null)}
          onSelect={(id) => {
            onUpdateChild(item.id, childImagePickerId, { image_media_id: id });
            setChildImagePickerId(null);
          }}
          organizationId={organizationId}
        />
      )}
    </div>
  );
}

// =============================================================================
// MenuBuilder
// =============================================================================

interface MenuBuilderProps {
  location: MenuLocation;
  orgSlug: string;
}

export function MenuBuilder({ location, orgSlug }: MenuBuilderProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();

  const [items, setItems] = useState<LocalMenuItem[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Fetch existing menu
  const { data: menuData, isLoading } = useQuery({
    queryKey: ['content-menu', orgId, location],
    queryFn: () => getMenu(orgId!, location),
    enabled: !!orgId,
  });

  // Fetch page tree for page picker
  const { data: treeData } = useQuery({
    queryKey: ['content-page-tree', orgId],
    queryFn: () => getPageTree(orgId!),
    enabled: !!orgId,
  });

  // Fetch categories for category picker
  const { data: categoriesData } = useQuery({
    queryKey: ['content-categories', orgId],
    queryFn: async () => {
      const res = await import('../../../lib/api/content');
      return res.listCategories(orgId!);
    },
    enabled: !!orgId,
  });

  const pages = treeData?.data ? flattenTree(treeData.data) : [];
  const categories = (categoriesData?.data ?? []).map((c) => ({
    id: c.slug,
    label: c.name,
  }));

  // Populate from server data
  useEffect(() => {
    if (menuData?.data?.items) {
      setItems(menuData.data.items.map(fromServerItem));
      setIsDirty(false);
    }
  }, [menuData]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () =>
      saveMenu(orgId!, location, {
        items: items.map(toSaveItem),
      }),
    onSuccess: () => {
      setIsDirty(false);
      setSuccessMsg('Saved');
      setTimeout(() => setSuccessMsg(''), 3000);
      queryClient.invalidateQueries({ queryKey: ['content-menu', orgId, location] });
    },
  });

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setItems((prev) => {
      const oldIndex = prev.findIndex((i) => i.id === active.id);
      const newIndex = prev.findIndex((i) => i.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
    setIsDirty(true);
  }, []);

  // Item operations
  const addItem = useCallback(() => {
    setItems((prev) => [...prev, newItem()]);
    setIsDirty(true);
  }, []);

  const updateItem = useCallback((id: string, updates: Partial<LocalMenuItem>) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, ...updates } : i)),
    );
    setIsDirty(true);
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setIsDirty(true);
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, expanded: !i.expanded } : i)),
    );
  }, []);

  const addChild = useCallback((parentId: string) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === parentId
          ? { ...i, children: [...i.children, newItem()], expanded: true }
          : i,
      ),
    );
    setIsDirty(true);
  }, []);

  const removeChild = useCallback((parentId: string, childId: string) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === parentId
          ? { ...i, children: i.children.filter((c) => c.id !== childId) }
          : i,
      ),
    );
    setIsDirty(true);
  }, []);

  const updateChild = useCallback(
    (parentId: string, childId: string, updates: Partial<LocalMenuItem>) => {
      setItems((prev) =>
        prev.map((i) =>
          i.id === parentId
            ? {
                ...i,
                children: i.children.map((c) =>
                  c.id === childId ? { ...c, ...updates } : c,
                ),
              }
            : i,
        ),
      );
      setIsDirty(true);
    },
    [],
  );

  const reorderChildren = useCallback(
    (parentId: string, oldIndex: number, newIndex: number) => {
      setItems((prev) =>
        prev.map((i) =>
          i.id === parentId
            ? { ...i, children: arrayMove(i.children, oldIndex, newIndex) }
            : i,
        ),
      );
      setIsDirty(true);
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  return (
    <div>
      {/* Item list */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={items.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((item) => (
            <SortableMenuItem
              key={item.id}
              item={item}
              pages={pages}
              categories={categories}
              orgSlug={orgSlug}
              organizationId={orgId!}
              onUpdate={updateItem}
              onRemove={removeItem}
              onAddChild={addChild}
              onRemoveChild={removeChild}
              onUpdateChild={updateChild}
              onToggleExpand={toggleExpand}
              onReorderChildren={reorderChildren}
            />
          ))}
        </SortableContext>
      </DndContext>

      {items.length === 0 && (
        <div className="text-center py-6 border border-dashed border-lichen rounded-lg mb-3">
          <p className="text-sm text-archive">
            No {location} menu items yet.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between mt-3">
        <button
          onClick={addItem}
          className="inline-flex items-center gap-1.5 text-sm text-bark hover:text-copper-dark transition-colors"
        >
          <Plus size={16} />
          Add Item
        </button>

        <div className="flex items-center gap-2">
          {successMsg && (
            <span className="text-sm text-semantic-success">{successMsg}</span>
          )}
          {saveMutation.isError && (
            <span className="text-sm text-semantic-error">Save failed</span>
          )}
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!isDirty || saveMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saveMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            Save Menu
          </button>
        </div>
      </div>
    </div>
  );
}
