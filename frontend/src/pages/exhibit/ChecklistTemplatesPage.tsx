import { useState, useEffect } from 'react';
import Checkbox from '../../components/Checkbox';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  ClipboardList,
  Plus,
  ChevronLeft,
  Search,
  MoreVertical,
  Copy,
  Archive,
  Trash2,
  CheckCircle2,
  FileText,
  Loader2,
  Filter,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { usePermissions } from '../../hooks/usePermissions';
import ConfirmDialog from '../../components/ConfirmDialog';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

interface ChecklistTemplateVersion {
  version_id: string;
  version_number: number;
  is_published: boolean;
  is_locked: boolean;
  item_count?: number;
}

interface ChecklistTemplate {
  template_id: string;
  name: string;
  description: string | null;
  exhibition_type: string;
  is_archived: boolean;
  created_at: string;
  versions: ChecklistTemplateVersion[];
  published_version_id: string | null;
  published_version_number: number | null;
}

const EXHIBITION_TYPE_LABELS: Record<string, string> = {
  general: 'General',
  in_house: 'In-House',
  incoming_traveling: 'Incoming Traveling',
  outgoing_traveling: 'Outgoing Traveling',
};

export default function ChecklistTemplatesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();

  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [exhibitionTypeFilter, setExhibitionTypeFilter] = useState<string>('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<ChecklistTemplate | null>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState<ChecklistTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateDescription, setNewTemplateDescription] = useState('');
  const [newTemplateType, setNewTemplateType] = useState('general');

  const canEdit = hasPermission('exhibit.edit');

  useEffect(() => {
    loadTemplates();
  }, [orgId, showArchived]);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<{ templates: ChecklistTemplate[] }>(
        `/organizations/${orgId}/exhibit/checklist-templates?include_archived=${showArchived}`
      );
      setTemplates(data.templates || []);
    } catch (err) {
      logger.error('Failed to load templates:', err);
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTemplate = async () => {
    if (!newTemplateName.trim()) return;

    setCreating(true);
    try {
      const data = await apiFetch<{ template: ChecklistTemplate }>(
        `/organizations/${orgId}/exhibit/checklist-templates`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: newTemplateName.trim(),
            description: newTemplateDescription.trim() || null,
            exhibition_type: newTemplateType,
          }),
        }
      );
      setShowCreateModal(false);
      setNewTemplateName('');
      setNewTemplateDescription('');
      setNewTemplateType('general');
      // Navigate to the new template editor
      navigate(`/organizations/${orgId}/collections/exhibitions/settings/checklist-templates/${data.template.template_id}`);
    } catch (err) {
      logger.error('Failed to create template:', err);
      setError(err instanceof Error ? err.message : 'Failed to create template');
    } finally {
      setCreating(false);
    }
  };

  const handleCloneTemplate = async (template: ChecklistTemplate) => {
    try {
      // Create a new template with same settings
      const data = await apiFetch<{ template: ChecklistTemplate }>(
        `/organizations/${orgId}/exhibit/checklist-templates`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: `${template.name} (Copy)`,
            description: template.description,
            exhibition_type: template.exhibition_type,
          }),
        }
      );

      // If the source has a published version, copy items from it
      if (template.published_version_id) {
        await apiFetch(
          `/organizations/${orgId}/exhibit/checklist-templates/${data.template.template_id}/versions`,
          {
            method: 'POST',
            body: JSON.stringify({
              copy_from_version_id: template.published_version_id,
              change_notes: `Cloned from "${template.name}"`,
            }),
          }
        );
      }

      await loadTemplates();
      setMenuOpen(null);
      navigate(`/organizations/${orgId}/collections/exhibitions/settings/checklist-templates/${data.template.template_id}`);
    } catch (err) {
      logger.error('Failed to clone template:', err);
      setError(err instanceof Error ? err.message : 'Failed to clone template');
    }
  };

  const handleArchiveTemplate = async () => {
    if (!showArchiveConfirm) return;

    try {
      await apiFetch(
        `/organizations/${orgId}/exhibit/checklist-templates/${showArchiveConfirm.template_id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ is_archived: !showArchiveConfirm.is_archived }),
        }
      );
      await loadTemplates();
      setShowArchiveConfirm(null);
      setMenuOpen(null);
    } catch (err) {
      logger.error('Failed to archive template:', err);
      setError(err instanceof Error ? err.message : 'Failed to archive template');
    }
  };

  const handleDeleteTemplate = async () => {
    if (!showDeleteConfirm) return;

    try {
      await apiFetch(
        `/organizations/${orgId}/exhibit/checklist-templates/${showDeleteConfirm.template_id}`,
        { method: 'DELETE' }
      );
      await loadTemplates();
      setShowDeleteConfirm(null);
      setMenuOpen(null);
    } catch (err) {
      logger.error('Failed to delete template:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete template');
    }
  };

  // Filter templates
  const filteredTemplates = templates.filter((t) => {
    if (searchQuery && !t.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (exhibitionTypeFilter && t.exhibition_type !== exhibitionTypeFilter) {
      return false;
    }
    return true;
  });

  const getLatestDraftVersion = (template: ChecklistTemplate): ChecklistTemplateVersion | null => {
    const drafts = template.versions.filter((v) => !v.is_locked);
    return drafts.length > 0 ? drafts[drafts.length - 1] : null;
  };

  if (loading && templates.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-center py-12">
          <MadronaLoader />
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
        Back to Exhibitions
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-bark/10 rounded-lg">
            <ClipboardList className="w-8 h-8 text-bark" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-ink">Checklist Templates</h1>
            <p className="text-archive mt-1">
              Create reusable checklists for exhibition planning
            </p>
          </div>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment transition-colors"
          >
            <Plus className="w-5 h-5" />
            New Template
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-parchment border border-lichen rounded-lg p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-archive" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates..."
              className="w-full pl-10 pr-4 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>

          {/* Exhibition Type Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-archive" />
            <select
              value={exhibitionTypeFilter}
              onChange={(e) => setExhibitionTypeFilter(e.target.value)}
              className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <option value="">All Types</option>
              {Object.entries(EXHIBITION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Show Archived Toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            <span className="text-sm text-ink">Show archived</span>
          </label>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 text-semantic-error">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Templates List */}
      {filteredTemplates.length === 0 ? (
        <div className="bg-parchment border border-lichen rounded-lg text-center py-12">
          <ClipboardList className="w-16 h-16 mx-auto text-archive/50 mb-4" />
          <h3 className="text-lg font-medium text-ink mb-2">
            {searchQuery || exhibitionTypeFilter ? 'No matching templates' : 'No templates yet'}
          </h3>
          <p className="text-archive mb-6">
            {searchQuery || exhibitionTypeFilter
              ? 'Try adjusting your filters'
              : 'Create your first checklist template to get started'}
          </p>
          {canEdit && !searchQuery && !exhibitionTypeFilter && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment"
            >
              <Plus className="w-5 h-5" />
              Create Template
            </button>
          )}
        </div>
      ) : (
        <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-stone/50 text-xs text-archive uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Template</th>
                <th className="px-4 py-3 text-left w-40">Type</th>
                <th className="px-4 py-3 text-left w-32">Status</th>
                <th className="px-4 py-3 text-left w-24">Versions</th>
                <th className="px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {filteredTemplates.map((template) => {
                const latestDraft = getLatestDraftVersion(template);
                const hasPublished = template.published_version_id !== null;

                return (
                  <tr
                    key={template.template_id}
                    className={`border-t border-lichen/50 hover:bg-stone/30 ${
                      template.is_archived ? 'opacity-60' : ''
                    }`}
                  >
                    <td className="px-4 py-4">
                      <Link
                        to={`/organizations/${orgId}/collections/exhibitions/settings/checklist-templates/${template.template_id}`}
                        className="group"
                      >
                        <div className="font-medium text-ink group-hover:text-bark">
                          {template.name}
                          {template.is_archived && (
                            <span className="ml-2 text-xs text-archive">(Archived)</span>
                          )}
                        </div>
                        {template.description && (
                          <div className="text-sm text-archive mt-1 truncate max-w-md">
                            {template.description}
                          </div>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-4 text-sm text-ink/70">
                      {EXHIBITION_TYPE_LABELS[template.exhibition_type] || template.exhibition_type}
                    </td>
                    <td className="px-4 py-4">
                      {hasPublished ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-semantic-success/10 text-semantic-success">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Published v{template.published_version_number}
                        </span>
                      ) : latestDraft ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-semantic-warning/10 text-semantic-warning">
                          <FileText className="w-3.5 h-3.5" />
                          Draft v{latestDraft.version_number}
                        </span>
                      ) : (
                        <span className="text-sm text-archive">No versions</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm text-ink/70">
                      {template.versions.length}
                    </td>
                    <td className="px-4 py-4">
                      <div className="relative">
                        <button
                          onClick={() => setMenuOpen(menuOpen === template.template_id ? null : template.template_id)}
                          className="p-1 text-archive hover:text-ink rounded"
                        >
                          <MoreVertical className="w-5 h-5" />
                        </button>
                        {menuOpen === template.template_id && (
                          <div className="absolute right-0 top-full mt-1 w-48 bg-parchment border border-lichen rounded-lg shadow-lg py-1 z-20">
                            <button
                              onClick={() => handleCloneTemplate(template)}
                              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-ink hover:bg-stone"
                            >
                              <Copy className="w-4 h-4" />
                              Clone Template
                            </button>
                            <button
                              onClick={() => {
                                setShowArchiveConfirm(template);
                                setMenuOpen(null);
                              }}
                              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-ink hover:bg-stone"
                            >
                              <Archive className="w-4 h-4" />
                              {template.is_archived ? 'Unarchive' : 'Archive'}
                            </button>
                            {!template.versions.some((v) => v.is_locked) && (
                              <button
                                onClick={() => {
                                  setShowDeleteConfirm(template);
                                  setMenuOpen(null);
                                }}
                                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-semantic-error hover:bg-semantic-error/10"
                              >
                                <Trash2 className="w-4 h-4" />
                                Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-ink/30" onClick={() => setShowCreateModal(false)} />
            <div className="relative bg-parchment rounded-lg shadow-xl w-full max-w-md">
              <div className="px-6 py-4 border-b border-lichen">
                <h2 className="text-lg font-semibold text-ink">Create Checklist Template</h2>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Template Name <span className="text-semantic-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    placeholder="e.g., Standard Exhibition Checklist"
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Description
                  </label>
                  <textarea
                    value={newTemplateDescription}
                    onChange={(e) => setNewTemplateDescription(e.target.value)}
                    placeholder="Brief description of when to use this template..."
                    rows={3}
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Exhibition Type
                  </label>
                  <select
                    value={newTemplateType}
                    onChange={(e) => setNewTemplateType(e.target.value)}
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  >
                    {Object.entries(EXHIBITION_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-lichen flex justify-end gap-2">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm text-archive hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateTemplate}
                  disabled={!newTemplateName.trim() || creating}
                  className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment text-sm rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50"
                >
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create Template
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Archive Confirm */}
      <ConfirmDialog
        isOpen={!!showArchiveConfirm}
        onClose={() => setShowArchiveConfirm(null)}
        onConfirm={handleArchiveTemplate}
        title={showArchiveConfirm?.is_archived ? 'Unarchive Template' : 'Archive Template'}
        message={
          showArchiveConfirm?.is_archived
            ? `Are you sure you want to unarchive "${showArchiveConfirm?.name}"?`
            : `Are you sure you want to archive "${showArchiveConfirm?.name}"? It won't be available for new exhibitions but existing uses will continue to work.`
        }
        confirmText={showArchiveConfirm?.is_archived ? 'Unarchive' : 'Archive'}
        confirmStyle="primary"
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={handleDeleteTemplate}
        title="Delete Template"
        message={`Are you sure you want to delete "${showDeleteConfirm?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* Click outside to close menu */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setMenuOpen(null)}
        />
      )}
    </div>
  );
}
