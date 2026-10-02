import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  Plus,
  Frame,
  Calendar,
  Building2,
  Loader2,
  Search,
  Eye,
  Trash2,
  Image as ImageIcon,
  Settings,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { usePermissions } from '../../hooks/usePermissions';
import ConfirmDialog from '../../components/ConfirmDialog';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateShort } from '@/lib/formatters';

// "Use of collections" compliant exhibition type
type ExhibitionStatus = 'proposed' | 'authorized' | 'in_preparation' | 'open' | 'closed' | 'archived';
type ExhibitionType = 'permanent' | 'temporary' | 'touring' | 'traveling' | 'online' | 'pop_up';

interface Exhibition {
  exhibition_id: string;
  exhibition_number: string | null;
  title: string;
  description: string | null;
  exhibition_type: ExhibitionType;
  status: ExhibitionStatus;
  venue_id: string | null;
  venue_name: string | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  is_public: boolean;
  public_url_slug: string | null;
  placement_count: number;
  created_at: string;
}

// procedure-aligned status values
const statusColors: Record<string, { bg: string; text: string; label: string }> = {
  proposed: { bg: 'bg-stone', text: 'text-ink', label: 'Proposed' },
  authorized: { bg: 'bg-semantic-info/10', text: 'text-semantic-info', label: 'Authorized' },
  in_preparation: { bg: 'bg-semantic-warning/10', text: 'text-semantic-warning', label: 'In Preparation' },
  open: { bg: 'bg-semantic-success/10', text: 'text-semantic-success', label: 'Open' },
  closed: { bg: 'bg-archive/10', text: 'text-archive', label: 'Closed' },
  archived: { bg: 'bg-stone', text: 'text-archive', label: 'Archived' },
};

export default function ExhibitionsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();

  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [exhibitionToDelete, setExhibitionToDelete] = useState<string | null>(null);

  const canCreate = hasPermission('exhibit.create');
  const canDelete = hasPermission('exhibit.delete');

  useEffect(() => {
    loadExhibitions();
  }, [orgId, statusFilter]);

  const loadExhibitions = async () => {
    try {
      setLoading(true);
      setError(null);

      let url = `/organizations/${orgId}/exhibit/exhibitions`;
      if (statusFilter) {
        url += `?status=${statusFilter}`;
      }

      const response = await apiFetch<{ exhibitions: Exhibition[] }>(url, { expectKeys: ['exhibitions'] });
      setExhibitions(response.exhibitions || []);
    } catch (err) {
      logger.error('Failed to load exhibitions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load exhibitions');
    } finally {
      setLoading(false);
    }
  };

  const createExhibition = async () => {
    if (!newTitle.trim()) return;

    try {
      setCreating(true);
      const response = await apiFetch<{ exhibition_id: string }>(`/organizations/${orgId}/exhibit/exhibitions`, {
        method: 'POST',
        body: JSON.stringify({ title: newTitle.trim() }),
      });

      setShowCreateModal(false);
      setNewTitle('');
      navigate(`/organizations/${orgId}/collections/exhibitions/${response.exhibition_id}`);
    } catch (err) {
      logger.error('Failed to create exhibition:', err);
      setError(err instanceof Error ? err.message : 'Failed to create exhibition');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteClick = (exhibitionId: string) => {
    setExhibitionToDelete(exhibitionId);
    setShowDeleteConfirm(true);
  };

  const deleteExhibition = async () => {
    if (!exhibitionToDelete) return;

    try {
      await apiFetch(`/organizations/${orgId}/exhibit/exhibitions/${exhibitionToDelete}`, {
        method: 'DELETE',
      });
      setExhibitions(prev => prev.filter(e => e.exhibition_id !== exhibitionToDelete));
    } catch (err) {
      logger.error('Failed to delete exhibition:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete exhibition');
    } finally {
      setExhibitionToDelete(null);
    }
  };

  const filteredExhibitions = exhibitions.filter(e =>
    e.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (e.description?.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    return formatDateShort(dateStr);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <MadronaLoader />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg p-6 mb-8">
        {/* Header Row: Title + Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-forest/10 rounded-lg shrink-0">
              <Frame size={28} className="text-forest" />
            </div>
            <h1 className="text-2xl font-semibold text-ink">Exhibition and Display</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/organizations/${orgId}/collections/exhibitions/settings/checklist-templates`}
              className="flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg text-ink/70 hover:text-ink hover:bg-stone transition-colors no-underline"
              title="Checklist Templates"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Settings</span>
            </Link>
            {canCreate && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-forest text-parchment rounded-lg hover:bg-forest/90 transition-colors shrink-0"
              >
                <Plus className="w-4 h-4" />
                New Exhibition
              </button>
            )}
          </div>
        </div>
        {/* Description: Full width, below header row */}
        <p className="text-sm text-archive leading-relaxed">
          Manages the use of objects in exhibitions and displays. Coordinates object selection, preparation, installation, monitoring, and deinstallation.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
          <input
            type="text"
            placeholder="Search exhibitions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
        >
          <option value="">All Statuses</option>
          <option value="proposed">Proposed</option>
          <option value="authorized">Authorized</option>
          <option value="in_preparation">In Preparation</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Exhibition Grid */}
      {filteredExhibitions.length === 0 ? (
        <div className="text-center py-12 bg-parchment/50 rounded-lg border border-lichen">
          <Frame className="w-12 h-12 mx-auto text-ink/30 mb-4" />
          <h3 className="text-lg font-medium text-ink mb-6">
            {searchTerm || statusFilter ? 'No exhibitions match your filters.' : 'No exhibitions yet.'}
          </h3>
          {canCreate && !searchTerm && !statusFilter && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-forest text-parchment rounded-lg hover:bg-forest/90"
            >
              <Plus className="w-4 h-4" />
              New Exhibition
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredExhibitions.map((exhibition) => (
            <div
              key={exhibition.exhibition_id}
              className="bg-parchment rounded-lg border border-lichen overflow-hidden hover:shadow-md transition-shadow"
            >
              {/* Preview area */}
              <div className="aspect-video bg-gradient-to-br from-parchment to-lichen/30 flex items-center justify-center relative">
                <ImageIcon className="w-12 h-12 text-ink/20" />
                <div className="absolute top-3 right-3">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[exhibition.status]?.bg || 'bg-stone'} ${statusColors[exhibition.status]?.text || 'text-ink'}`}>
                    {statusColors[exhibition.status]?.label || exhibition.status}
                  </span>
                </div>
                {exhibition.placement_count > 0 && (
                  <div className="absolute bottom-3 left-3 px-2 py-1 bg-ink/50 text-parchment text-xs rounded">
                    {exhibition.placement_count} artwork{exhibition.placement_count !== 1 ? 's' : ''}
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="p-4">
                <h3 className="font-semibold text-ink mb-1 truncate">{exhibition.title}</h3>
                {exhibition.description && (
                  <p className="text-sm text-ink/60 mb-3 line-clamp-2">{exhibition.description}</p>
                )}

                <div className="space-y-2 text-sm text-ink/60">
                  {exhibition.venue_name && (
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4" />
                      <span className="truncate">{exhibition.venue_name}</span>
                    </div>
                  )}
                  {(exhibition.planned_start_date || exhibition.planned_end_date) && (
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      <span>
                        {formatDate(exhibition.planned_start_date)}
                        {exhibition.planned_end_date && ` - ${formatDate(exhibition.planned_end_date)}`}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-4 pt-4 border-t border-lichen flex items-center justify-between">
                  <Link
                    to={`/organizations/${orgId}/collections/exhibitions/${exhibition.exhibition_id}`}
                    className="flex items-center gap-1 text-sm text-forest hover:text-forest/80"
                  >
                    <Eye className="w-4 h-4" />
                    View
                  </Link>
                  <div className="flex items-center gap-2">
                    {canDelete && (
                      <button
                        onClick={() => handleDeleteClick(exhibition.exhibition_id)}
                        aria-label="Delete exhibition"
                        className="p-1.5 text-ink/50 hover:text-semantic-error hover:bg-semantic-error/10 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50">
          <div className="bg-parchment rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h2 className="text-lg font-semibold text-ink mb-4">Create New Exhibition</h2>
            <div className="mb-4">
              <label className="block text-sm font-medium text-ink mb-1">Title</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Enter exhibition title..."
                className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTitle.trim()) {
                    createExhibition();
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewTitle('');
                }}
                className="px-4 py-2 text-ink/70 hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={createExhibition}
                disabled={!newTitle.trim() || creating}
                className="flex items-center gap-2 px-4 py-2 bg-forest text-parchment rounded-lg hover:bg-forest/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={deleteExhibition}
        title="Delete Exhibition"
        message="Are you sure you want to delete this exhibition?"
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
