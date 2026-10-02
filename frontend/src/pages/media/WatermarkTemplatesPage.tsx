import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Droplets, Plus, MoreHorizontal, Image, Type, Star, Trash2 } from 'lucide-react';
import { getWatermarkTemplates, deleteWatermarkTemplate } from '../../lib/api';
import { WatermarkTemplateModal } from '../../components/dam';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { WatermarkTemplate } from '../../lib/schemas';

/**
 * Watermark Templates management page for Media / DAM.
 * Allows organizations to create and manage watermark templates
 * for protecting published media assets.
 */
export default function WatermarkTemplatesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<WatermarkTemplate | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Fetch templates
  const { data, isLoading, error } = useQuery({
    queryKey: ['watermark-templates', orgId],
    queryFn: () => getWatermarkTemplates(orgId!),
    enabled: !!orgId,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (templateId: string) => deleteWatermarkTemplate(orgId!, templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watermark-templates', orgId] });
      setShowDeleteDialog(false);
      setTemplateToDelete(null);
    },
  });

  const templates = data?.templates || [];

  const handleDelete = (template: WatermarkTemplate) => {
    setTemplateToDelete(template);
    setShowDeleteDialog(true);
    setOpenMenuId(null);
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-stone rounded w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-32 bg-stone rounded" />
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
          Error loading watermark templates: {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Watermark Templates</h1>
          <p className="text-archive">
            Define text and image watermarks to protect your published media
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn btn-primary flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          New Template
        </button>
      </div>

      {/* Templates grid */}
      {templates.length === 0 ? (
        <div className="card p-12 text-center">
          <Droplets className="h-12 w-12 text-archive mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No Watermark Templates</h3>
          <p className="text-archive max-w-md mx-auto mb-6">
            Create watermark templates to protect your published media.
            Templates can include text overlays or image watermarks.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="btn btn-primary"
          >
            Create First Template
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => (
            <div key={template.template_id} className="card p-4 relative">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  {template.watermark_type === 'text' ? (
                    <div className="p-2 bg-semantic-info/10 dark:bg-semantic-info/20 rounded">
                      <Type className="h-5 w-5 text-semantic-info" />
                    </div>
                  ) : (
                    <div className="p-2 bg-forest/10 rounded">
                      <Image className="h-5 w-5 text-forest" />
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{template.name}</h3>
                      {template.is_default && (
                        <Star className="h-4 w-4 text-semantic-warning fill-semantic-warning" />
                      )}
                    </div>
                    <p className="text-sm text-archive capitalize">
                      {template.watermark_type} watermark
                    </p>
                  </div>
                </div>
                <div className="relative">
                  <button
                    onClick={() => setOpenMenuId(openMenuId === template.template_id ? null : template.template_id)}
                    className="p-1 hover:bg-stone rounded"
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
                      <div className="absolute right-0 top-8 z-20 bg-parchment border rounded-lg shadow-lg py-1 w-40">
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

              {/* Template config preview */}
              <div className="text-sm space-y-1 mt-3 pt-3 border-t">
                {template.watermark_type === 'text' && template.config.text && (
                  <p className="text-archive truncate">
                    Text: "{template.config.text}"
                  </p>
                )}
                {template.config.position && (
                  <p className="text-archive capitalize">
                    Position: {template.config.position.replace('-', ' ')}
                  </p>
                )}
                {template.config.opacity != null && (
                  <p className="text-archive">
                    Opacity: {Math.round(template.config.opacity * 100)}%
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info section */}
      <div className="mt-8 card p-6">
        <h2 className="text-lg font-semibold mb-4">About Watermarks</h2>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Type className="h-5 w-5 text-archive" />
              <h3 className="font-medium">Text Watermarks</h3>
            </div>
            <p className="text-sm text-archive">
              Add text overlays with your organization name, copyright notice,
              or other identifying information. Customize font, size, color,
              position, and opacity.
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Image className="h-5 w-5 text-archive" />
              <h3 className="font-medium">Image Watermarks</h3>
            </div>
            <p className="text-sm text-archive">
              Upload a logo or custom image to use as a watermark. Control
              placement, size, and transparency to balance protection with
              visibility.
            </p>
          </div>
        </div>
      </div>

      {/* Create Modal */}
      {showModal && (
        <WatermarkTemplateModal
          organizationId={orgId!}
          onClose={() => setShowModal(false)}
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
        title="Delete Watermark Template"
        message={`Are you sure you want to delete "${templateToDelete?.name}"? This action cannot be undone.`}
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        confirmStyle="danger"
      />
    </div>
  );
}
