import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Tag,
  Plus,
  ChevronLeft,
  Search,
  MoreVertical,
  Copy,
  Trash2,
  CheckCircle,
  FileText,
} from 'lucide-react';
import { getLabelTemplates, deleteLabelTemplate, type LabelTemplate } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import ConfirmDialog from '../../components/ConfirmDialog';
import { LabelTemplateEditor } from '../../components/exhibit/LabelTemplateEditor';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const LABEL_TYPE_LABELS: Record<string, string> = {
  tombstone: 'Tombstone',
  extended: 'Extended',
  wall: 'Wall Text',
  didactic: 'Didactic',
};

const LABEL_TYPE_STYLES: Record<string, string> = {
  tombstone: 'bg-bark/10 text-bark',
  extended: 'bg-copper/10 text-copper',
  wall: 'bg-semantic-info/10 text-semantic-info',
  didactic: 'bg-semantic-success/10 text-semantic-success',
};

export default function LabelTemplatesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();

  const [searchQuery, setSearchQuery] = useState('');
  const [labelTypeFilter, setLabelTypeFilter] = useState<string>('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<LabelTemplate | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<LabelTemplate | null>(null);

  const canEdit = hasPermission('exhibit.edit');

  // Fetch templates
  const { data, isLoading, error } = useQuery({
    queryKey: ['label-templates', orgId],
    queryFn: () => getLabelTemplates(orgId!),
    enabled: !!orgId,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (templateId: string) => deleteLabelTemplate(orgId!, templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['label-templates', orgId] });
      setShowDeleteConfirm(null);
    },
  });

  const templates = data?.label_templates || [];

  // Filter templates
  const filteredTemplates = templates.filter((template: LabelTemplate) => {
    const matchesSearch =
      !searchQuery ||
      template.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = !labelTypeFilter || template.label_type === labelTypeFilter;
    return matchesSearch && matchesType;
  });

  const handleEdit = (template: LabelTemplate) => {
    setEditingTemplate(template);
    setShowEditor(true);
    setMenuOpen(null);
  };

  const handleDelete = (template: LabelTemplate) => {
    setShowDeleteConfirm(template);
    setMenuOpen(null);
  };

  const handleDuplicate = async (template: LabelTemplate) => {
    // For now, open editor with template data but no ID (create new)
    setEditingTemplate({ ...template, template_id: '', name: `${template.name} (Copy)` } as LabelTemplate);
    setShowEditor(true);
    setMenuOpen(null);
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-center py-12">
          <MadronaLoader variant="dots" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 text-semantic-error">
          {error instanceof Error ? error.message : 'Failed to load templates'}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Back Navigation */}
      <Link
        to={`/organizations/${orgId}/collections/exhibitions`}
        className="inline-flex items-center gap-1 text-sm text-archive hover:text-bark no-underline"
      >
        <ChevronLeft size={16} />
        Back to exhibitions
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Label Templates</h1>
          <p className="text-archive mt-1">
            Create and manage templates for exhibition labels
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => {
              setEditingTemplate(null);
              setShowEditor(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment transition-colors"
          >
            <Plus size={16} />
            New Template
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-archive" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            className="w-full pl-10 pr-4 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          />
        </div>

        <select
          value={labelTypeFilter}
          onChange={(e) => setLabelTypeFilter(e.target.value)}
          className="px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
        >
          <option value="">All Types</option>
          {Object.entries(LABEL_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Templates Grid */}
      {filteredTemplates.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-lichen rounded-lg">
          <Tag className="w-12 h-12 text-archive mx-auto mb-4" />
          <h3 className="text-lg font-medium text-ink mb-2">No templates found</h3>
          <p className="text-archive mb-4">
            {searchQuery || labelTypeFilter
              ? 'Try adjusting your filters'
              : 'Create your first label template to get started'}
          </p>
          {canEdit && !searchQuery && !labelTypeFilter && (
            <button
              onClick={() => {
                setEditingTemplate(null);
                setShowEditor(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment transition-colors"
            >
              <Plus size={16} />
              Create Template
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((template: LabelTemplate) => (
            <div
              key={template.template_id}
              className="bg-parchment border border-lichen rounded-lg p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-bark/10 rounded-lg">
                    <FileText className="w-5 h-5 text-bark" />
                  </div>
                  <div>
                    <h3 className="font-medium text-ink">{template.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          LABEL_TYPE_STYLES[template.label_type] || 'bg-stone text-archive'
                        }`}
                      >
                        {LABEL_TYPE_LABELS[template.label_type] || template.label_type}
                      </span>
                      {template.is_default && (
                        <span className="flex items-center gap-1 text-xs text-semantic-success">
                          <CheckCircle size={12} />
                          Default
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {canEdit && (
                  <div className="relative">
                    <button
                      onClick={() => setMenuOpen(menuOpen === template.template_id ? null : template.template_id)}
                      className="p-1 text-archive hover:text-ink rounded"
                    >
                      <MoreVertical size={16} />
                    </button>

                    {menuOpen === template.template_id && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setMenuOpen(null)}
                        />
                        <div className="absolute right-0 top-8 w-40 bg-parchment border border-lichen rounded-lg shadow-lg z-20">
                          <button
                            onClick={() => handleEdit(template)}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-stone/50 flex items-center gap-2"
                          >
                            <FileText size={14} />
                            Edit
                          </button>
                          <button
                            onClick={() => handleDuplicate(template)}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-stone/50 flex items-center gap-2"
                          >
                            <Copy size={14} />
                            Duplicate
                          </button>
                          {!(template as LabelTemplate & { is_system?: boolean }).is_system && (
                            <button
                              onClick={() => handleDelete(template)}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-stone/50 flex items-center gap-2 text-semantic-error"
                            >
                              <Trash2 size={14} />
                              Delete
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Template preview */}
              <div className="mt-4 pt-3 border-t border-lichen">
                <p className="text-xs text-archive mb-2">Fields:</p>
                <div className="flex flex-wrap gap-1">
                  {template.template_fields?.fields?.slice(0, 4).map((field: { name: string; source: string }, index: number) => (
                    <span
                      key={index}
                      className="px-2 py-0.5 text-xs bg-stone rounded"
                    >
                      {field.name || field.source.split('.').pop()}
                    </span>
                  ))}
                  {(template.template_fields?.fields?.length || 0) > 4 && (
                    <span className="px-2 py-0.5 text-xs text-archive">
                      +{template.template_fields.fields.length - 4} more
                    </span>
                  )}
                </div>
              </div>

              {/* Typography info */}
              <div className="mt-2 text-xs text-archive">
                {template.font_family}, {template.font_size_pt}pt
                {template.width_cm && template.height_cm && (
                  <span className="ml-2">
                    ({template.width_cm} x {template.height_cm} cm)
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor SlideOver */}
      <LabelTemplateEditor
        isOpen={showEditor}
        organizationId={orgId!}
        template={editingTemplate}
        onClose={() => {
          setShowEditor(false);
          setEditingTemplate(null);
        }}
        onSuccess={() => {
          setShowEditor(false);
          setEditingTemplate(null);
        }}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={() => {
          if (showDeleteConfirm) {
            deleteMutation.mutate(showDeleteConfirm.template_id);
          }
        }}
        title="Delete Template"
        message={`Are you sure you want to delete "${showDeleteConfirm?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
