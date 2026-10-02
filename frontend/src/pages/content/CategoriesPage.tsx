/**
 * CategoriesPage -- CRUD for blog post categories.
 *
 * Shows a list of categories with inline add/edit modal and delete
 * confirmation.  Categories have: name, slug, description, sort_order.
 */

import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Tag,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  X,
  GripVertical,
} from 'lucide-react';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../../lib/api/content';
import type { ContentCategory } from '../../types/content';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

// =============================================================================
// Helpers
// =============================================================================

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// =============================================================================
// Types
// =============================================================================

interface CategoryForm {
  name: string;
  slug: string;
  description: string;
  sort_order: number;
}

const EMPTY_FORM: CategoryForm = {
  name: '',
  slug: '',
  description: '',
  sort_order: 0,
};

// =============================================================================
// Component
// =============================================================================

export default function CategoriesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CategoryForm>(EMPTY_FORM);
  const [slugTouched, setSlugTouched] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContentCategory | null>(
    null,
  );

  // =========================================================================
  // Queries
  // =========================================================================

  const { data, isLoading } = useQuery({
    queryKey: ['content-categories', orgId],
    queryFn: () => listCategories(orgId!),
    enabled: !!orgId,
  });

  const categories: ContentCategory[] = data?.data ?? [];
  const sortedCategories = [...categories].sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  // =========================================================================
  // Mutations
  // =========================================================================

  const createMutation = useMutation({
    mutationFn: () =>
      createCategory(orgId!, {
        name: form.name,
        slug: form.slug || undefined,
        description: form.description || undefined,
        sort_order: form.sort_order,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['content-categories', orgId],
      });
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateCategory(orgId!, editingId!, {
        name: form.name,
        slug: form.slug || undefined,
        description: form.description || undefined,
        sort_order: form.sort_order,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['content-categories', orgId],
      });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (categoryId: string) => deleteCategory(orgId!, categoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['content-categories', orgId],
      });
      setDeleteTarget(null);
    },
  });

  // =========================================================================
  // Modal helpers
  // =========================================================================

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      sort_order: categories.length,
    });
    setSlugTouched(false);
    setIsModalOpen(true);
  }, [categories.length]);

  const openEdit = useCallback((cat: ContentCategory) => {
    setEditingId(cat.category_id);
    setForm({
      name: cat.name,
      slug: cat.slug,
      description: cat.description ?? '',
      sort_order: cat.sort_order,
    });
    setSlugTouched(true);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSlugTouched(false);
  }, []);

  const handleNameChange = useCallback(
    (value: string) => {
      setForm((prev) => ({
        ...prev,
        name: value,
        slug: slugTouched ? prev.slug : slugify(value),
      }));
    },
    [slugTouched],
  );

  const handleSubmit = useCallback(() => {
    if (!form.name.trim()) return;
    if (editingId) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  }, [form.name, editingId, updateMutation, createMutation]);

  const isMutating = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Tag className="w-7 h-7 text-forest" />
          <h1 className="text-2xl font-semibold text-ink">Categories</h1>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark transition-colors focus-visible:ring-2 ring-bark/30 ring-offset-2"
        >
          <Plus size={16} />
          Add Category
        </button>
      </div>

      <p className="text-sm text-archive mb-6">
        Organize blog posts into categories. Categories are displayed on the
        public blog index for visitors to filter content.
      </p>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <MadronaLoader variant="dots" />
        </div>
      ) : sortedCategories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border border-dashed border-lichen rounded-lg">
          <Tag size={40} className="text-archive/40 mb-3" />
          <p className="text-sm font-medium text-ink mb-1">
            No categories yet
          </p>
          <p className="text-xs text-archive mb-4">
            Add your first category to organize blog posts.
          </p>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-dashed border-lichen text-archive rounded-lg hover:border-bark hover:text-bark transition-colors"
          >
            <Plus size={16} />
            Add Category
          </button>
        </div>
      ) : (
        <div className="bg-parchment border border-lichen rounded-lg divide-y divide-lichen">
          {sortedCategories.map((cat) => (
            <div
              key={cat.category_id}
              className="flex items-center gap-4 px-5 py-4 hover:bg-stone/20 transition-colors"
            >
              <GripVertical
                size={16}
                className="shrink-0 text-archive/40"
              />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-ink truncate">
                    {cat.name}
                  </p>
                  <span className="shrink-0 text-xs font-mono text-archive">
                    /{cat.slug}
                  </span>
                </div>
                {cat.description && (
                  <p className="text-xs text-archive mt-0.5 truncate">
                    {cat.description}
                  </p>
                )}
              </div>

              <span className="shrink-0 text-xs text-archive">
                #{cat.sort_order}
              </span>

              <div className="shrink-0 flex items-center gap-1">
                <button
                  onClick={() => openEdit(cat)}
                  className="p-1.5 text-archive hover:text-ink rounded transition-colors"
                  title="Edit"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setDeleteTarget(cat)}
                  className="p-1.5 text-archive hover:text-semantic-error rounded transition-colors"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ================================================================= */}
      {/* Create / Edit Modal                                                */}
      {/* ================================================================= */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40">
          <div className="bg-parchment rounded-lg shadow-xl w-full max-w-md mx-4">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-lichen">
              <h2 className="text-lg font-semibold text-ink">
                {editingId ? 'Edit Category' : 'Add Category'}
              </h2>
              <button
                onClick={closeModal}
                className="p-1 text-archive hover:text-ink rounded transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="px-5 py-4 space-y-4">
              {/* Name */}
              <div>
                <label
                  htmlFor="cat-name"
                  className="block text-xs font-medium text-ink mb-1"
                >
                  Name
                </label>
                <input
                  id="cat-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. Exhibitions"
                  className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                  autoFocus
                />
              </div>

              {/* Slug */}
              <div>
                <label
                  htmlFor="cat-slug"
                  className="block text-xs font-medium text-ink mb-1"
                >
                  Slug
                </label>
                <input
                  id="cat-slug"
                  type="text"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setForm((prev) => ({ ...prev, slug: e.target.value }));
                  }}
                  placeholder="auto-generated"
                  className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>

              {/* Description */}
              <div>
                <label
                  htmlFor="cat-desc"
                  className="block text-xs font-medium text-ink mb-1"
                >
                  Description
                </label>
                <textarea
                  id="cat-desc"
                  value={form.description}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder="Optional description"
                  rows={2}
                  className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-y"
                />
              </div>

              {/* Sort Order */}
              <div>
                <label
                  htmlFor="cat-sort"
                  className="block text-xs font-medium text-ink mb-1"
                >
                  Sort Order
                </label>
                <input
                  id="cat-sort"
                  type="number"
                  value={form.sort_order}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      sort_order: parseInt(e.target.value, 10) || 0,
                    }))
                  }
                  className="w-24 border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>

              {/* Mutation errors */}
              {(createMutation.isError || updateMutation.isError) && (
                <p className="text-sm text-semantic-error">
                  Failed to save category. Please try again.
                </p>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-lichen">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm border border-lichen rounded-lg text-ink hover:bg-stone/30 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!form.name.trim() || isMutating}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isMutating && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                {editingId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Delete Confirmation                                                */}
      {/* ================================================================= */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40">
          <div className="bg-parchment rounded-lg shadow-xl w-full max-w-sm mx-4">
            <div className="px-5 py-4">
              <h2 className="text-lg font-semibold text-ink mb-2">
                Delete Category
              </h2>
              <p className="text-sm text-ink">
                Are you sure you want to delete{' '}
                <span className="font-medium">{deleteTarget.name}</span>? Posts
                assigned to this category will be unlinked.
              </p>

              {deleteMutation.isError && (
                <p className="mt-2 text-sm text-semantic-error">
                  Failed to delete. Please try again.
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-lichen">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm border border-lichen rounded-lg text-ink hover:bg-stone/30 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget.category_id)}
                disabled={deleteMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-semantic-error text-parchment rounded-lg hover:bg-semantic-error/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deleteMutation.isPending && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
