import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Tag,
  Plus,
  Settings,
  FileText,
  CheckCircle,
  Printer,
  Loader2,
  Sparkles,
} from 'lucide-react';
import {
  getLabelTemplates,
  getExhibitionLabels,
  generateExhibitionLabels,
  approveExhibitionLabel,
  type LabelTemplate,
  type ExhibitionLabel,
} from '../../lib/api';
import { LabelTemplateEditor } from './LabelTemplateEditor';
import { LabelPreview } from './LabelPreview';
import { ModalPortal } from '../ModalPortal';

interface ExhibitionLabelsTabProps {
  organizationId: string;
  exhibitionId: string;
  isEditing?: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-archive',
  review: 'bg-semantic-warning/10 text-semantic-warning',
  approved: 'bg-semantic-success/10 text-semantic-success',
  printed: 'bg-bark/10 text-bark',
};

const LABEL_TYPE_ICONS: Record<string, typeof Tag> = {
  tombstone: Tag,
  extended: FileText,
  wall: FileText,
  didactic: FileText,
};

export function ExhibitionLabelsTab({
  organizationId,
  exhibitionId,
  isEditing = false,
}: ExhibitionLabelsTabProps) {
  const queryClient = useQueryClient();
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<LabelTemplate | null>(null);
  const [previewLabel, setPreviewLabel] = useState<ExhibitionLabel | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);

  // Fetch templates
  const { data: templatesData, isLoading: templatesLoading } = useQuery({
    queryKey: ['label-templates', organizationId],
    queryFn: () => getLabelTemplates(organizationId),
    enabled: !!organizationId,
  });

  // Fetch labels
  const { data: labelsData, isLoading: labelsLoading } = useQuery({
    queryKey: ['exhibition-labels', organizationId, exhibitionId],
    queryFn: () => getExhibitionLabels(organizationId, exhibitionId),
    enabled: !!organizationId && !!exhibitionId,
  });

  // Generate labels mutation
  const generateMutation = useMutation({
    mutationFn: () => generateExhibitionLabels(organizationId, exhibitionId, selectedTemplate),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['exhibition-labels', organizationId, exhibitionId],
      });
      setShowGenerateConfirm(false);
    },
  });

  // Approve label mutation
  const approveMutation = useMutation({
    mutationFn: (labelId: string) =>
      approveExhibitionLabel(organizationId, exhibitionId, labelId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['exhibition-labels', organizationId, exhibitionId],
      });
    },
  });

  const templates = templatesData?.label_templates || [];
  const labels = labelsData?.labels || [];

  // Group labels by status
  const labelsByStatus = {
    draft: labels.filter((l) => l.status === 'draft'),
    review: labels.filter((l) => l.status === 'review'),
    approved: labels.filter((l) => l.status === 'approved'),
    printed: labels.filter((l) => l.status === 'printed'),
  };

  const isLoading = templatesLoading || labelsLoading;

  return (
    <div className="space-y-6">
      {/* Templates Section */}
      <div className="border-b border-lichen pb-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-medium text-ink flex items-center gap-2">
            <Settings size={16} />
            Label Templates
          </h4>
          {isEditing && (
            <button
              onClick={() => {
                setEditingTemplate(null);
                setShowTemplateEditor(true);
              }}
              className="flex items-center gap-1 text-sm text-bark hover:text-copper-dark"
            >
              <Plus size={14} />
              New Template
            </button>
          )}
        </div>

        {templatesLoading ? (
          <div className="text-sm text-archive">Loading templates...</div>
        ) : templates.length === 0 ? (
          <div className="text-sm text-archive italic py-4 text-center border border-dashed border-lichen rounded-lg">
            No label templates yet.
            {isEditing && (
              <button
                onClick={() => setShowTemplateEditor(true)}
                className="block mx-auto mt-2 text-bark hover:text-copper-dark"
              >
                Create a template
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {templates.map((template) => {
              const Icon = LABEL_TYPE_ICONS[template.label_type] || Tag;
              return (
                <div
                  key={template.template_id}
                  className="p-3 border border-lichen rounded-lg bg-parchment hover:border-bark/30 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Icon size={16} className="text-archive" />
                      <div>
                        <p className="text-sm font-medium text-ink">{template.name}</p>
                        <p className="text-xs text-archive capitalize">
                          {template.label_type} · {template.font_family} {template.font_size_pt}pt
                        </p>
                      </div>
                    </div>
                    {template.is_default && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-bark/10 text-bark rounded-full">
                        Default
                      </span>
                    )}
                  </div>
                  {isEditing && (
                    <button
                      onClick={() => {
                        setEditingTemplate(template);
                        setShowTemplateEditor(true);
                      }}
                      className="mt-2 text-xs text-bark hover:text-copper-dark"
                    >
                      Edit template
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Generate Labels Section */}
      {isEditing && templates.length > 0 && (
        <div className="p-4 bg-bark/5 border border-bark/20 rounded-lg">
          <div className="flex items-center gap-4">
            <Sparkles size={20} className="text-bark" />
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">Generate Labels</p>
              <p className="text-xs text-archive">
                Generate labels for all exhibition objects using a template
              </p>
            </div>
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="px-3 py-1.5 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              <option value="">Select template...</option>
              {templates.map((t) => (
                <option key={t.template_id} value={t.template_id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setShowGenerateConfirm(true)}
              disabled={!selectedTemplate || generateMutation.isPending}
              className="px-4 py-1.5 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50 flex items-center gap-2"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Generating...
                </>
              ) : (
                'Generate'
              )}
            </button>
          </div>
        </div>
      )}

      {/* Labels List */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-medium text-ink flex items-center gap-2">
            <Tag size={16} />
            Generated Labels ({labels.length})
          </h4>
        </div>

        {isLoading ? (
          <div className="text-sm text-archive">Loading labels...</div>
        ) : labels.length === 0 ? (
          <div className="text-sm text-archive italic py-8 text-center border border-dashed border-lichen rounded-lg">
            No labels generated yet. Add objects to the exhibition and generate labels using a template.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Status groups */}
            {(['draft', 'review', 'approved', 'printed'] as const).map((status) => {
              const statusLabels = labelsByStatus[status];
              if (statusLabels.length === 0) return null;

              return (
                <div key={status}>
                  <h5 className="text-xs font-medium text-archive uppercase tracking-wide mb-2">
                    {status} ({statusLabels.length})
                  </h5>
                  <div className="space-y-2">
                    {statusLabels.map((label) => (
                      <div
                        key={label.label_id}
                        className="flex items-center justify-between p-3 border border-lichen rounded-lg bg-parchment"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Tag size={16} className="text-archive shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm text-ink truncate max-w-md">
                              {label.display_text.split('\n')[0]}
                            </div>
                            <div className="text-xs text-archive">
                              {label.label_type}
                              {label.print_count > 0 && ` · Printed ${label.print_count}x`}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                              STATUS_STYLES[label.status] || STATUS_STYLES.draft
                            }`}
                          >
                            {label.status}
                          </span>
                          <button
                            onClick={() => setPreviewLabel(label)}
                            className="p-1 text-bark hover:text-copper-dark"
                            title="Preview label"
                          >
                            <FileText size={14} />
                          </button>
                          {isEditing && label.status === 'draft' && (
                            <button
                              onClick={() => approveMutation.mutate(label.label_id)}
                              disabled={approveMutation.isPending}
                              className="p-1 text-semantic-success hover:text-semantic-success/80 disabled:opacity-50"
                              title="Approve label"
                            >
                              <CheckCircle size={14} />
                            </button>
                          )}
                          {label.status === 'approved' && (
                            <button
                              className="p-1 text-bark hover:text-copper-dark"
                              title="Print label"
                            >
                              <Printer size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Template Editor */}
      <LabelTemplateEditor
        isOpen={showTemplateEditor}
        organizationId={organizationId}
        template={editingTemplate}
        onClose={() => {
          setShowTemplateEditor(false);
          setEditingTemplate(null);
        }}
        onSuccess={() => {
          setShowTemplateEditor(false);
          setEditingTemplate(null);
        }}
      />

      {/* Label Preview */}
      {previewLabel && (
        <LabelPreview
          isOpen={!!previewLabel}
          label={previewLabel}
          onClose={() => setPreviewLabel(null)}
        />
      )}

      {/* Generate Confirm Dialog */}
      {showGenerateConfirm && (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50">
          <div className="bg-parchment rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-medium text-ink mb-2">Generate Labels?</h3>
            <p className="text-sm text-archive mb-4">
              This will generate labels for all objects in this exhibition using the
              selected template. Existing labels will not be affected.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowGenerateConfirm(false)}
                className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50"
              >
                Cancel
              </button>
              <button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50"
              >
                {generateMutation.isPending ? 'Generating...' : 'Generate Labels'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  );
}

export default ExhibitionLabelsTab;
