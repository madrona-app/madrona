import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Plus,
  MoreHorizontal,
  Star,
  Trash2,
  Pencil,
  Search,
  Copyright,
  User,
} from 'lucide-react';
import { getMetadataTemplates, deleteMetadataTemplate, setDefaultMetadataTemplate } from '../../lib/api';
import { MetadataTemplateModal } from '../../components/dam';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { MetadataTemplate } from '../../lib/schemas';

/**
 * Metadata Templates management page for Media / DAM.
 * Allows organizations to create and manage reusable metadata templates
 * that can be applied to media assets in bulk.
 */
export default function MetadataTemplatesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [templateToEdit, setTemplateToEdit] = useState<MetadataTemplate | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<MetadataTemplate | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch templates
  const { data, isLoading, error } = useQuery({
    queryKey: ['metadata-templates', orgId],
    queryFn: () => getMetadataTemplates(orgId!),
    enabled: !!orgId,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (templateId: string) => deleteMetadataTemplate(orgId!, templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metadata-templates', orgId] });
      setShowDeleteDialog(false);
      setTemplateToDelete(null);
    },
  });

  // Set default mutation
  const setDefaultMutation = useMutation({
    mutationFn: (templateId: string) => setDefaultMetadataTemplate(orgId!, templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metadata-templates', orgId] });
      setOpenMenuId(null);
    },
  });

  const templates = data?.templates || [];
  const filteredTemplates = searchQuery
    ? templates.filter((t) =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : templates;

  const handleDelete = (template: MetadataTemplate) => {
    setTemplateToDelete(template);
    setShowDeleteDialog(true);
    setOpenMenuId(null);
  };

  const handleEdit = (template: MetadataTemplate) => {
    setTemplateToEdit(template);
    setShowModal(true);
    setOpenMenuId(null);
  };

  const handleSetDefault = (template: MetadataTemplate) => {
    if (!template.is_default) {
      setDefaultMutation.mutate(template.template_id);
    }
    setOpenMenuId(null);
  };

  // Count configured fields in template
  const getFieldCount = (template: MetadataTemplate): number => {
    const fields = template.template_fields || {};
    let count = 0;
    if (fields.title_prefix) count++;
    if (fields.title_suffix) count++;
    if (fields.description) count++;
    if (fields.alt_text) count++;
    if (fields.creator) count++;
    if (fields.credit) count++;
    if (fields.source) count++;
    if (fields.copyright_status) count++;
    if (fields.rights_statement) count++;
    if (fields.license) count++;
    if (fields.extra_metadata && Object.keys(fields.extra_metadata).length > 0) count++;
    return count;
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-stone rounded w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 bg-stone rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded p-4 text-semantic-error">
          Error loading metadata templates: {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Metadata Templates</h1>
          <p className="text-archive mt-1">
            Create reusable metadata configurations to apply to media assets in bulk
          </p>
        </div>
        <button
          onClick={() => {
            setTemplateToEdit(null);
            setShowModal(true);
          }}
          className="btn btn-primary flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          New Template
        </button>
      </div>

      {/* Search */}
      {templates.length > 0 && (
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-archive" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates..."
              className="w-full pl-10 pr-4 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>
        </div>
      )}

      {/* Templates grid */}
      {templates.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText className="h-12 w-12 text-archive mx-auto mb-4" />
          <h3 className="text-lg font-medium text-ink mb-2">No Metadata Templates</h3>
          <p className="text-archive max-w-md mx-auto mb-6">
            Create metadata templates to streamline your media ingestion workflow.
            Templates can include titles, descriptions, credits, rights information, and tags.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="btn btn-primary"
          >
            Create First Template
          </button>
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="card p-8 text-center">
          <Search className="h-10 w-10 text-archive mx-auto mb-3" />
          <p className="text-archive">No templates match "{searchQuery}"</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((template) => (
            <div key={template.template_id} className="card p-4 relative hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-bark/10 rounded">
                    <FileText className="h-5 w-5 text-bark" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-ink truncate">{template.name}</h3>
                      {template.is_default && (
                        <Star className="h-4 w-4 text-semantic-warning flex-shrink-0" aria-label="Default template" />
                      )}
                    </div>
                    <p className="text-sm text-archive">
                      {getFieldCount(template)} field{getFieldCount(template) !== 1 ? 's' : ''} configured
                    </p>
                  </div>
                </div>
                <div className="relative flex-shrink-0">
                  <button
                    onClick={() => setOpenMenuId(openMenuId === template.template_id ? null : template.template_id)}
                    className="p-1 hover:bg-stone rounded"
                    aria-label="Template options"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {openMenuId === template.template_id && (
                    <>
                      {/* Backdrop */}
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setOpenMenuId(null)}
                      />
                      {/* Menu */}
                      <div className="absolute right-0 top-8 z-20 bg-parchment border border-lichen rounded-lg shadow-lg py-1 w-44">
                        <button
                          onClick={() => handleEdit(template)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-stone flex items-center gap-2 text-ink"
                        >
                          <Pencil className="h-4 w-4" />
                          Edit
                        </button>
                        {!template.is_default && (
                          <button
                            onClick={() => handleSetDefault(template)}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-stone flex items-center gap-2 text-ink"
                            disabled={setDefaultMutation.isPending}
                          >
                            <Star className="h-4 w-4" />
                            Set as Default
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(template)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-stone flex items-center gap-2 text-semantic-error"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Description */}
              {template.description && (
                <p className="text-sm text-archive mb-3 line-clamp-2">
                  {template.description}
                </p>
              )}

              {/* Template fields preview */}
              <div className="text-sm space-y-1 mt-3 pt-3 border-t border-lichen">
                {template.template_fields?.creator && (
                  <div className="flex items-center gap-2 text-archive">
                    <User className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">Creator: {template.template_fields.creator}</span>
                  </div>
                )}
                {template.template_fields?.copyright_status && (
                  <div className="flex items-center gap-2 text-archive">
                    <Copyright className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate capitalize">
                      {template.template_fields.copyright_status.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}
                {getFieldCount(template) === 0 && (
                  <p className="text-archive italic">No fields configured</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info section */}
      <div className="mt-8 card p-6">
        <h2 className="text-lg font-semibold text-ink mb-4">About Metadata Templates</h2>
        <div className="grid gap-6 md:grid-cols-3">
          <div>
            <h3 className="font-medium text-ink mb-2">Bulk Application</h3>
            <p className="text-sm text-archive">
              Apply templates to multiple assets at once using workspace bulk actions.
              Templates can add prefixes/suffixes to titles, set descriptions, and more.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-ink mb-2">Rights & Attribution</h3>
            <p className="text-sm text-archive">
              Include copyright status, rights statements, licenses, and creator credits
              in your templates for consistent rights management.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-ink mb-2">Tags & Metadata</h3>
            <p className="text-sm text-archive">
              Add standard tags and custom metadata fields that will be merged with
              existing asset data when the template is applied.
            </p>
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <MetadataTemplateModal
          organizationId={orgId!}
          templateToEdit={templateToEdit || undefined}
          onClose={() => {
            setShowModal(false);
            setTemplateToEdit(null);
          }}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => {
          setShowDeleteDialog(false);
          setTemplateToDelete(null);
        }}
        onConfirm={() => {
          if (templateToDelete) {
            deleteMutation.mutate(templateToDelete.template_id);
          }
        }}
        title="Delete Metadata Template"
        message={`Are you sure you want to delete "${templateToDelete?.name}"? This action cannot be undone.`}
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        confirmStyle="danger"
      />
    </div>
  );
}
