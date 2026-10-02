import { useState, useEffect, useCallback } from 'react';
import Checkbox from '../Checkbox';
import {
  Plus,
  FileText,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Clock,
  Calendar,
  Link2,
  Loader2,
  ChevronDown,
  MoreVertical,
  Trash2,
  Edit3,
  Upload,
  FileCheck,
  AlertCircle,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { formatDateShort } from '../../lib/formatters';
import { SlideOver } from '../ui/SlideOver';
import ConfirmDialog from '../ConfirmDialog';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../ui/MadronaLoader';
import { ModalPortal } from '../ModalPortal';

// === Types ===
type InfoRequestType =
  | 'loan_agreement'
  | 'facility_report'
  | 'packing_instructions'
  | 'installation_manual'
  | 'crate_list'
  | 'insurance_certificate'
  | 'condition_report'
  | 'shipping_schedule'
  | 'press_kit'
  | 'label_copy'
  | 'image_assets'
  | 'rights_docs'
  | 'other';

type InfoRequestStatus = 'requested' | 'received' | 'incomplete' | 'approved';

interface InfoRequestDocument {
  link_id: string;
  media_id: string;
  label: string | null;
  created_at: string;
}

interface InfoRequest {
  request_id: string;
  request_type: InfoRequestType;
  request_type_label: string;
  title: string;
  description: string | null;
  status: InfoRequestStatus;
  status_label: string;
  source_party: string | null;
  due_date: string | null;
  notes: string | null;
  is_required: boolean;
  documents: InfoRequestDocument[];
  document_count: number;
  received_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

interface InfoRequestSummary {
  total: number;
  received: number;
  approved: number;
  missing: number;
  overdue: number;
  incomplete: number;
}

interface InfoRequestTemplate {
  template_id: string;
  name: string;
  description: string | null;
  item_count: number;
}

// === Constants ===
const REQUEST_TYPE_CONFIG: Record<InfoRequestType, { label: string; icon: typeof FileText }> = {
  loan_agreement: { label: 'Loan Agreement', icon: FileText },
  facility_report: { label: 'Facility Report', icon: FileText },
  packing_instructions: { label: 'Packing Instructions', icon: FileText },
  installation_manual: { label: 'Installation Manual', icon: FileText },
  crate_list: { label: 'Crate List', icon: FileText },
  insurance_certificate: { label: 'Insurance Certificate', icon: FileCheck },
  condition_report: { label: 'Condition Report', icon: FileText },
  shipping_schedule: { label: 'Shipping Schedule', icon: Calendar },
  press_kit: { label: 'Press Kit', icon: FileText },
  label_copy: { label: 'Label Copy', icon: FileText },
  image_assets: { label: 'Image Assets', icon: FileText },
  rights_docs: { label: 'Rights Documentation', icon: FileText },
  other: { label: 'Other', icon: FileText },
};

const STATUS_CONFIG: Record<InfoRequestStatus, { label: string; icon: typeof Circle; color: string; bgColor: string }> = {
  requested: { label: 'Requested', icon: Circle, color: 'text-semantic-warning', bgColor: 'bg-semantic-warning/10' },
  received: { label: 'Received', icon: Clock, color: 'text-semantic-info', bgColor: 'bg-semantic-info/10' },
  incomplete: { label: 'Incomplete', icon: AlertTriangle, color: 'text-semantic-warning', bgColor: 'bg-semantic-warning/10' },
  approved: { label: 'Approved', icon: CheckCircle2, color: 'text-semantic-success', bgColor: 'bg-semantic-success/10' },
};

const REQUEST_TYPES: InfoRequestType[] = [
  'loan_agreement', 'facility_report', 'packing_instructions', 'installation_manual',
  'crate_list', 'insurance_certificate', 'condition_report', 'shipping_schedule',
  'press_kit', 'label_copy', 'image_assets', 'rights_docs', 'other'
];

const SOURCE_PARTIES = [
  { value: 'lender', label: 'Lender' },
  { value: 'borrower', label: 'Borrower' },
  { value: 'venue', label: 'Venue' },
  { value: 'organizer', label: 'Organizer' },
  { value: 'courier', label: 'Courier' },
  { value: 'shipper', label: 'Shipper' },
  { value: 'insurance_provider', label: 'Insurance Provider' },
];

// === Sub-components ===

interface StatusDropdownProps {
  currentStatus: InfoRequestStatus;
  onStatusChange: (status: InfoRequestStatus) => void;
  disabled?: boolean;
}

function StatusDropdown({ currentStatus, onStatusChange, disabled }: StatusDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);

  const config = STATUS_CONFIG[currentStatus];
  const StatusIcon = config.icon;

  return (
    <div className="relative">
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-full ${config.bgColor} ${config.color} ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80 cursor-pointer'
        }`}
      >
        <StatusIcon className="w-3.5 h-3.5" />
        {config.label}
        {!disabled && <ChevronDown className="w-3 h-3 ml-0.5" />}
      </button>
      {isOpen && (
        <>
          <div role="presentation" className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute z-20 mt-1 w-40 bg-parchment border border-lichen rounded-lg shadow-lg py-1">
            {Object.entries(STATUS_CONFIG).map(([status, cfg]) => {
              const Icon = cfg.icon;
              return (
                <button
                  key={status}
                  onClick={() => {
                    onStatusChange(status as InfoRequestStatus);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-stone ${
                    status === currentStatus ? 'bg-stone/50' : ''
                  }`}
                >
                  <Icon className={`w-4 h-4 ${cfg.color}`} />
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

interface InfoRequestRowProps {
  request: InfoRequest;
  onStatusChange: (requestId: string, status: InfoRequestStatus) => void;
  onEdit: (request: InfoRequest) => void;
  onDelete: (request: InfoRequest) => void;
  canEdit: boolean;
}

function InfoRequestRow({ request, onStatusChange, onEdit, onDelete, canEdit }: InfoRequestRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isOverdue = request.due_date && new Date(request.due_date) < new Date() && request.status === 'requested';
  const TypeIcon = REQUEST_TYPE_CONFIG[request.request_type]?.icon || FileText;

  return (
    <tr className="border-b border-lichen/50 hover:bg-stone/30">
      <td className="px-4 py-3">
        <StatusDropdown
          currentStatus={request.status}
          onStatusChange={(status) => onStatusChange(request.request_id, status)}
          disabled={!canEdit}
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-start gap-3">
          <TypeIcon className="w-5 h-5 text-archive mt-0.5" />
          <div>
            <div className="font-medium text-ink">{request.title}</div>
            <div className="text-xs text-archive mt-0.5">
              {REQUEST_TYPE_CONFIG[request.request_type]?.label || request.request_type}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-ink/70">
        {request.source_party || '-'}
      </td>
      <td className={`px-4 py-3 text-sm ${isOverdue ? 'text-semantic-error font-medium' : 'text-ink/70'}`}>
        {request.due_date ? (
          <div className="flex items-center gap-1.5">
            {isOverdue && <AlertCircle className="w-4 h-4" />}
            {formatDateShort(request.due_date)}
          </div>
        ) : '-'}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {request.document_count > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs text-archive" title={`${request.document_count} documents`}>
              <Link2 className="w-3.5 h-3.5" />
              {request.document_count}
            </span>
          )}
          {request.notes && (
            <span title="Has notes">
              <FileText className="w-3.5 h-3.5 text-archive" />
            </span>
          )}
          {!request.is_required && (
            <span className="text-xs text-archive">(Optional)</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        {canEdit && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1 text-archive hover:text-ink rounded"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            {menuOpen && (
              <>
                <div role="presentation" className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-36 bg-parchment border border-lichen rounded-lg shadow-lg py-1 z-20">
                  <button
                    onClick={() => {
                      onEdit(request);
                      setMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-stone"
                  >
                    <Edit3 className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      onDelete(request);
                      setMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-semantic-error hover:bg-semantic-error/10"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

interface SummaryCardsProps {
  summary: InfoRequestSummary;
}

function SummaryCards({ summary }: SummaryCardsProps) {
  const progress = summary.total > 0 ? Math.round((summary.received / summary.total) * 100) : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-parchment border border-lichen rounded-lg p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-archive">Progress</span>
          <span className="text-lg font-semibold text-ink">{progress}%</span>
        </div>
        <div className="mt-2 h-2 bg-lichen rounded-full overflow-hidden">
          <div
            className="h-full bg-semantic-success/100 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-1 text-xs text-archive">
          {summary.received} of {summary.total} received
        </div>
      </div>

      {summary.missing > 0 && (
        <div className="bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <Circle className="w-5 h-5 text-semantic-warning" />
            <span className="text-2xl font-semibold text-semantic-warning">{summary.missing}</span>
          </div>
          <div className="text-sm text-semantic-warning mt-1">Still needed</div>
        </div>
      )}

      {summary.overdue > 0 && (
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-semantic-error" />
            <span className="text-2xl font-semibold text-semantic-error">{summary.overdue}</span>
          </div>
          <div className="text-sm text-semantic-error mt-1">Overdue</div>
        </div>
      )}

      {summary.incomplete > 0 && (
        <div className="bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-semantic-warning" />
            <span className="text-2xl font-semibold text-semantic-warning">{summary.incomplete}</span>
          </div>
          <div className="text-sm text-semantic-warning mt-1">Incomplete</div>
        </div>
      )}

      <div className="bg-semantic-success/10 border border-semantic-success/30 rounded-lg p-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-semantic-success" />
          <span className="text-2xl font-semibold text-semantic-success">{summary.approved}</span>
        </div>
        <div className="text-sm text-semantic-success mt-1">Approved</div>
      </div>
    </div>
  );
}

interface RequestEditorSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  request: InfoRequest | null;
  onSave: (data: Partial<InfoRequest>) => Promise<void>;
  isNew: boolean;
}

function RequestEditorSlideOver({ isOpen, onClose, request, onSave, isNew }: RequestEditorSlideOverProps) {
  const [formData, setFormData] = useState<Partial<InfoRequest>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (request) {
      setFormData(request);
    } else {
      setFormData({
        request_type: 'other',
        title: '',
        status: 'requested',
        is_required: true,
      });
    }
  }, [request, isOpen]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(formData);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title={isNew ? 'Add Info Request' : 'Edit Info Request'}
      width="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-archive hover:text-ink">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!formData.title?.trim() || saving}
            className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment text-sm rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isNew ? 'Add' : 'Save'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Type <span className="text-semantic-error">*</span>
          </label>
          <select
            value={formData.request_type || 'other'}
            onChange={(e) => setFormData({ ...formData, request_type: e.target.value as InfoRequestType })}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          >
            {REQUEST_TYPES.map((type) => (
              <option key={type} value={type}>
                {REQUEST_TYPE_CONFIG[type]?.label || type}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Title <span className="text-semantic-error">*</span>
          </label>
          <input
            type="text"
            value={formData.title || ''}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="e.g., Signed loan agreement from MOMA"
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Description</label>
          <textarea
            value={formData.description || ''}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={2}
            placeholder="Additional details..."
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Source Party</label>
            <select
              value={formData.source_party || ''}
              onChange={(e) => setFormData({ ...formData, source_party: e.target.value })}
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <option value="">Select...</option>
              {SOURCE_PARTIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">Due Date</label>
            <input
              type="date"
              value={formData.due_date || ''}
              onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Notes</label>
          <textarea
            value={formData.notes || ''}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            rows={3}
            placeholder="Internal notes..."
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={formData.is_required !== false}
            onChange={(e) => setFormData({ ...formData, is_required: e.target.checked })}
          />
          <span className="text-sm text-ink">Required item</span>
        </label>
      </div>
    </SlideOver>
  );
}

interface GenerateFromTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (templateId: string) => Promise<void>;
  organizationId: string;
}

function GenerateFromTemplateModal({ isOpen, onClose, onGenerate, organizationId }: GenerateFromTemplateModalProps) {
  const [templates, setTemplates] = useState<InfoRequestTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadTemplates();
    }
  }, [isOpen]);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ templates: InfoRequestTemplate[] }>(
        `/organizations/${organizationId}/exhibit/info-request-templates`
      );
      setTemplates(data.templates || []);
    } catch (err) {
      logger.error('Failed to load templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async (templateId: string) => {
    setGenerating(true);
    try {
      await onGenerate(templateId);
      onClose();
    } finally {
      setGenerating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div role="presentation" className="fixed inset-0 bg-ink/30" onClick={onClose} />
        <div className="relative bg-parchment rounded-lg shadow-xl w-full max-w-md">
          <div className="px-6 py-4 border-b border-lichen">
            <h2 className="text-lg font-semibold text-ink">Generate from Template</h2>
          </div>
          <div className="p-6">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <MadronaLoader variant="dots" />
              </div>
            ) : templates.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {templates.map((template) => (
                  <button
                    key={template.template_id}
                    onClick={() => handleGenerate(template.template_id)}
                    disabled={generating}
                    className="w-full text-left p-4 border border-lichen rounded-lg hover:bg-stone/30 transition-colors disabled:opacity-50"
                  >
                    <div className="font-medium text-ink">{template.name}</div>
                    {template.description && (
                      <div className="text-sm text-archive mt-1">{template.description}</div>
                    )}
                    <div className="text-xs text-archive mt-2">
                      {template.item_count} items
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-archive">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No templates available.</p>
              </div>
            )}
          </div>
          <div className="px-6 py-4 border-t border-lichen flex justify-end">
            <button onClick={onClose} className="px-4 py-2 text-sm text-archive hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

// === Main Component ===

interface ExhibitionInfoTabProps {
  organizationId: string;
  exhibitionId: string;
  isEditing: boolean;
}

export function ExhibitionInfoTab({ organizationId, exhibitionId, isEditing }: ExhibitionInfoTabProps) {
  const [requests, setRequests] = useState<InfoRequest[]>([]);
  const [summary, setSummary] = useState<InfoRequestSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingRequest, setEditingRequest] = useState<InfoRequest | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<InfoRequest | null>(null);

  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');

  const loadRequests = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<{ info_requests: InfoRequest[]; summary: InfoRequestSummary }>(
        `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/info-requests`
      );
      setRequests(data.info_requests || []);
      setSummary(data.summary);
    } catch (err) {
      logger.error('Failed to load info requests:', err);
      setError(err instanceof Error ? err.message : 'Failed to load info requests');
    } finally {
      setLoading(false);
    }
  }, [organizationId, exhibitionId]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const handleStatusChange = async (requestId: string, status: InfoRequestStatus) => {
    try {
      await apiFetch(
        `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/info-requests/${requestId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        }
      );
      await loadRequests();
    } catch (err) {
      logger.error('Failed to update status:', err);
    }
  };

  const handleSaveRequest = async (data: Partial<InfoRequest>) => {
    const isNew = !editingRequest;
    const url = isNew
      ? `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/info-requests`
      : `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/info-requests/${editingRequest!.request_id}`;

    await apiFetch(url, {
      method: isNew ? 'POST' : 'PATCH',
      body: JSON.stringify(data),
    });
    await loadRequests();
    setEditingRequest(null);
    setShowAddModal(false);
  };

  const handleDeleteRequest = async () => {
    if (!deleteRequest) return;

    await apiFetch(
      `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/info-requests/${deleteRequest.request_id}`,
      { method: 'DELETE' }
    );
    await loadRequests();
    setDeleteRequest(null);
  };

  const handleGenerateFromTemplate = async (templateId: string) => {
    await apiFetch(
      `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/info-requests`,
      {
        method: 'POST',
        body: JSON.stringify({ template_id: templateId }),
      }
    );
    await loadRequests();
  };

  // Filter requests
  const filteredRequests = requests.filter((r) => {
    if (filterStatus && r.status !== filterStatus) return false;
    if (filterType && r.request_type !== filterType) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MadronaLoader />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="w-12 h-12 mx-auto text-semantic-error mb-4" />
        <p className="text-semantic-error">{error}</p>
        <button onClick={loadRequests} className="mt-4 px-4 py-2 text-sm text-bark hover:text-copper-dark">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && summary.total > 0 && <SummaryCards summary={summary} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Inbound Information</h2>
        {isEditing && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTemplateModal(true)}
              className="flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg text-ink hover:bg-stone"
            >
              <Upload className="w-4 h-4" />
              From Template
            </button>
            <button
              onClick={() => {
                setEditingRequest(null);
                setShowAddModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment"
            >
              <Plus className="w-4 h-4" />
              Add Request
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      {requests.length > 0 && (
        <div className="flex flex-wrap items-center gap-4">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          >
            <option value="">All Statuses</option>
            {Object.entries(STATUS_CONFIG).map(([value, cfg]) => (
              <option key={value} value={value}>{cfg.label}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          >
            <option value="">All Types</option>
            {REQUEST_TYPES.map((type) => (
              <option key={type} value={type}>{REQUEST_TYPE_CONFIG[type]?.label || type}</option>
            ))}
          </select>
        </div>
      )}

      {/* Empty State */}
      {requests.length === 0 && (
        <div className="text-center py-12 bg-stone/30 rounded-lg">
          <FileText className="w-16 h-16 mx-auto text-archive/50 mb-4" />
          <h3 className="text-lg font-medium text-ink mb-2">No Info Requests Yet</h3>
          <p className="text-archive mb-6">
            Track required documentation and materials for this exhibition.
          </p>
          {isEditing && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setShowTemplateModal(true)}
                className="flex items-center gap-2 px-4 py-2 border border-lichen rounded-lg text-ink hover:bg-parchment"
              >
                <Upload className="w-4 h-4" />
                Generate from Template
              </button>
              <button
                onClick={() => {
                  setEditingRequest(null);
                  setShowAddModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment"
              >
                <Plus className="w-4 h-4" />
                Add Request
              </button>
            </div>
          )}
        </div>
      )}

      {/* Requests Table */}
      {filteredRequests.length > 0 && (
        <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-stone/50 text-xs text-archive uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left w-36">Status</th>
                <th className="px-4 py-3 text-left">Item</th>
                <th className="px-4 py-3 text-left w-32">Source</th>
                <th className="px-4 py-3 text-left w-28">Due</th>
                <th className="px-4 py-3 text-left w-24">Info</th>
                <th className="px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {filteredRequests.map((request) => (
                <InfoRequestRow
                  key={request.request_id}
                  request={request}
                  onStatusChange={handleStatusChange}
                  onEdit={(r) => {
                    setEditingRequest(r);
                    setShowAddModal(true);
                  }}
                  onDelete={setDeleteRequest}
                  canEdit={isEditing}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      <RequestEditorSlideOver
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setEditingRequest(null);
        }}
        request={editingRequest}
        onSave={handleSaveRequest}
        isNew={!editingRequest}
      />

      {/* Template Modal */}
      <GenerateFromTemplateModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        onGenerate={handleGenerateFromTemplate}
        organizationId={organizationId}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={!!deleteRequest}
        onClose={() => setDeleteRequest(null)}
        onConfirm={handleDeleteRequest}
        title="Delete Info Request"
        message={`Are you sure you want to delete "${deleteRequest?.title}"?`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}

export default ExhibitionInfoTab;
