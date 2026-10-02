import { useState, useEffect, useCallback } from 'react';
import Checkbox from '../Checkbox';
import {
  Plus,
  Truck,
  Package,
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  FileText,
  Loader2,
  ChevronRight,
  Edit3,
  Trash2,
  Link2,
  Archive,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { formatDateShort } from '../../lib/formatters';
import { SlideOver } from '../ui/SlideOver';
import ConfirmDialog from '../ConfirmDialog';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../ui/MadronaLoader';

// === Types ===
// Statuses in the new generic model
type ShipmentStatus = 'draft' | 'confirmed' | 'dispatched' | 'in_transit' | 'delayed' | 'delivered' | 'completed' | 'cancelled';

interface ShipmentItem {
  shipment_item_id: string;
  object_id: string;
  object_number: string | null;
  object_title: string | null;
  crate_id: string | null;
  crate_number: string | null;
  status: string;
  status_label: string;
}

interface ShipmentReference {
  reference_id: string;
  procedure_type: string;
  procedure_type_label: string;
  procedure_id: string;
  notes: string | null;
}

interface ShipmentDocument {
  document_id: string;
  media_id: string;
  document_type: string | null;
  document_type_label: string | null;
  label: string | null;
}

interface StatusHistoryEntry {
  history_id: string;
  status: string;
  status_label: string;
  notes: string | null;
  changed_at: string;
}

interface Shipment {
  shipment_id: string;
  organization_id: string;
  shipment_number: string;
  shipment_type: string;
  shipment_type_label: string;
  direction: string | null;
  direction_label: string | null;
  purpose: string | null;
  purpose_label: string | null;
  status: ShipmentStatus;
  status_label: string;
  estimated_dispatch_date: string | null;
  estimated_arrival_date: string | null;
  actual_dispatch_date: string | null;
  actual_arrival_date: string | null;
  remarks: string | null;
  internal_notes: string | null;
  insurance_value_total: string | null;
  insurance_currency: string | null;
  courier_required: boolean;
  items?: ShipmentItem[];
  references?: ShipmentReference[];
  documents?: ShipmentDocument[];
  status_history?: StatusHistoryEntry[];
  item_count?: number;
  document_count?: number;
  created_at: string;
}

interface ShipmentSummary {
  total: number;
  in_transit: number;
  delayed: number;
  completed: number;
}

interface Props {
  organizationId: string;
  exhibitionId: string;
  isEditing: boolean;
}

// === Constants ===
const STATUS_CONFIG: Record<string, { bg: string; text: string; icon: typeof Clock }> = {
  draft: { bg: 'bg-stone', text: 'text-ink', icon: Clock },
  confirmed: { bg: 'bg-semantic-info/10', text: 'text-semantic-info', icon: Clock },
  dispatched: { bg: 'bg-bark/10', text: 'text-bark', icon: Truck },
  in_transit: { bg: 'bg-bark/10', text: 'text-bark', icon: Truck },
  delayed: { bg: 'bg-semantic-warning/10', text: 'text-semantic-warning', icon: AlertTriangle },
  delivered: { bg: 'bg-semantic-success/10', text: 'text-semantic-success', icon: CheckCircle2 },
  completed: { bg: 'bg-semantic-success/10', text: 'text-semantic-success', icon: CheckCircle2 },
  cancelled: { bg: 'bg-stone', text: 'text-archive', icon: Archive },
};

const DIRECTION_CONFIG: Record<string, { icon: typeof ArrowDownLeft; label: string; color: string }> = {
  inbound: { icon: ArrowDownLeft, label: 'Inbound', color: 'text-semantic-success' },
  outbound: { icon: ArrowUpRight, label: 'Outbound', color: 'text-semantic-info' },
};

const STATUS_OPTIONS: Array<{ value: ShipmentStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

// === Component ===
export function ExhibitionLogisticsTab({ organizationId, exhibitionId, isEditing }: Props) {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [_summary, setSummary] = useState<ShipmentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'inbound' | 'outbound'>('all');

  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingShipment, setEditingShipment] = useState<Partial<Shipment> | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Shipment | null>(null);

  // Build filter URL for shipments linked to this exhibition
  const buildListUrl = useCallback((directionFilter?: string) => {
    const params = new URLSearchParams();
    params.set('purpose', 'exhibition');
    params.set('reference', `exhibition_venue:${exhibitionId}`);
    if (directionFilter && directionFilter !== 'all') {
      params.set('direction', directionFilter);
    }
    return `/organizations/${organizationId}/collections/shipments?${params}`;
  }, [organizationId, exhibitionId]);

  // Load shipments
  const loadShipments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await apiFetch<{ items: Shipment[]; summary: ShipmentSummary }>(
        buildListUrl(filter)
      );
      setShipments(data.items || []);
      setSummary(data.summary);
    } catch (err) {
      logger.error('Failed to load shipments:', err);
      setError(err instanceof Error ? err.message : 'Failed to load shipments');
    } finally {
      setLoading(false);
    }
  }, [buildListUrl, filter]);

  useEffect(() => {
    loadShipments();
  }, [loadShipments]);

  // Load single shipment details
  const loadShipmentDetails = async (shipmentId: string) => {
    try {
      const data = await apiFetch<Shipment>(
        `/organizations/${organizationId}/collections/shipments/${shipmentId}`
      );
      setSelectedShipment(data);
    } catch (err) {
      logger.error('Failed to load shipment details:', err);
    }
  };

  // Open shipment drawer
  const openShipmentDrawer = async (shipment: Shipment) => {
    setSelectedShipment(shipment);
    setIsDrawerOpen(true);
    await loadShipmentDetails(shipment.shipment_id);
  };

  // Create/Update shipment
  const saveShipment = async () => {
    if (!editingShipment) return;

    try {
      setSaving(true);
      setError(null);

      const isNew = !editingShipment.shipment_id;

      if (isNew) {
        // Create shipment via generic API, then link to exhibition
        const shipmentData = await apiFetch<Shipment>(
          `/organizations/${organizationId}/collections/shipments`,
          {
            method: 'POST',
            body: JSON.stringify({
              shipment_type: 'outbound',
              direction: editingShipment.direction || 'outbound',
              purpose: 'exhibition',
              status: 'draft',
              remarks: editingShipment.remarks,
              internal_notes: editingShipment.internal_notes,
              estimated_dispatch_date: editingShipment.estimated_dispatch_date,
              estimated_arrival_date: editingShipment.estimated_arrival_date,
              insurance_value_total: editingShipment.insurance_value_total,
              courier_required: editingShipment.courier_required || false,
            }),
          }
        );

        // Link to exhibition via reference
        await apiFetch(
          `/organizations/${organizationId}/collections/shipments/${shipmentData.shipment_id}/references`,
          {
            method: 'POST',
            body: JSON.stringify({
              procedure_type: 'exhibition_venue',
              procedure_id: exhibitionId,
            }),
          }
        );
      } else {
        // Update existing
        await apiFetch(
          `/organizations/${organizationId}/collections/shipments/${editingShipment.shipment_id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              direction: editingShipment.direction,
              remarks: editingShipment.remarks,
              internal_notes: editingShipment.internal_notes,
              estimated_dispatch_date: editingShipment.estimated_dispatch_date,
              estimated_arrival_date: editingShipment.estimated_arrival_date,
              insurance_value_total: editingShipment.insurance_value_total,
              courier_required: editingShipment.courier_required,
            }),
          }
        );
      }

      setIsFormOpen(false);
      setEditingShipment(null);
      await loadShipments();
    } catch (err) {
      logger.error('Failed to save shipment:', err);
      setError(err instanceof Error ? err.message : 'Failed to save shipment');
    } finally {
      setSaving(false);
    }
  };

  // Delete shipment
  const deleteShipment = async (shipment: Shipment) => {
    try {
      await apiFetch(
        `/organizations/${organizationId}/collections/shipments/${shipment.shipment_id}`,
        { method: 'DELETE' }
      );
      setDeleteConfirm(null);
      setIsDrawerOpen(false);
      await loadShipments();
    } catch (err) {
      logger.error('Failed to delete shipment:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete shipment');
    }
  };

  // Update status
  const updateStatus = async (shipment: Shipment, newStatus: ShipmentStatus) => {
    try {
      await apiFetch(
        `/organizations/${organizationId}/collections/shipments/${shipment.shipment_id}/status`,
        {
          method: 'POST',
          body: JSON.stringify({ status: newStatus }),
        }
      );
      await loadShipments();
      if (selectedShipment?.shipment_id === shipment.shipment_id) {
        await loadShipmentDetails(shipment.shipment_id);
      }
    } catch (err) {
      logger.error('Failed to update status:', err);
    }
  };

  // Start new shipment
  const startNewShipment = (direction: string = 'outbound') => {
    setEditingShipment({
      direction,
      status: 'draft' as ShipmentStatus,
    });
    setIsFormOpen(true);
  };

  // Edit existing shipment
  const startEditShipment = (shipment: Shipment) => {
    setEditingShipment({ ...shipment });
    setIsFormOpen(true);
    setIsDrawerOpen(false);
  };

  if (loading && shipments.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  // Compute summary counts from the local shipments list since the API summary is org-wide
  const localInbound = shipments.filter(s => s.direction === 'inbound').length;
  const localOutbound = shipments.filter(s => s.direction === 'outbound').length;
  const localInTransit = shipments.filter(s => s.status === 'dispatched' || s.status === 'in_transit').length;
  const localTotal = shipments.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-ink">Shipments & Logistics</h2>
          <p className="text-sm text-ink/60 mt-1">Track inbound and outbound shipments for this exhibition</p>
        </div>
        {isEditing && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => startNewShipment('inbound')}
              className="flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg text-ink hover:bg-stone/50 transition-colors"
            >
              <ArrowDownLeft className="w-4 h-4 text-semantic-success" />
              Inbound
            </button>
            <button
              onClick={() => startNewShipment('outbound')}
              className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment transition-colors"
            >
              <Plus className="w-4 h-4" />
              Outbound
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error text-sm">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      {localTotal > 0 && (
        <div className="grid grid-cols-4 gap-4">
          <button
            onClick={() => setFilter('all')}
            className={`text-left rounded-lg p-4 transition-colors ${
              filter === 'all' ? 'bg-bark/10 ring-2 ring-bark' : 'bg-parchment/50 hover:bg-parchment'
            }`}
          >
            <div className="text-sm text-ink/60 mb-1">Total</div>
            <div className="text-2xl font-semibold text-ink">{localTotal}</div>
          </button>
          <button
            onClick={() => setFilter('inbound')}
            className={`text-left rounded-lg p-4 transition-colors ${
              filter === 'inbound' ? 'bg-semantic-success/10 ring-2 ring-semantic-success' : 'bg-parchment/50 hover:bg-parchment'
            }`}
          >
            <div className="text-sm text-ink/60 mb-1 flex items-center gap-1">
              <ArrowDownLeft className="w-3.5 h-3.5 text-semantic-success" />
              Inbound
            </div>
            <div className="text-2xl font-semibold text-semantic-success">{localInbound}</div>
          </button>
          <button
            onClick={() => setFilter('outbound')}
            className={`text-left rounded-lg p-4 transition-colors ${
              filter === 'outbound' ? 'bg-semantic-info/10 ring-2 ring-bark/30' : 'bg-parchment/50 hover:bg-parchment'
            }`}
          >
            <div className="text-sm text-ink/60 mb-1 flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5 text-semantic-info" />
              Outbound
            </div>
            <div className="text-2xl font-semibold text-semantic-info">{localOutbound}</div>
          </button>
          <div className="bg-parchment/50 rounded-lg p-4">
            <div className="text-sm text-ink/60 mb-1">In Transit</div>
            <div className="text-2xl font-semibold text-ink">{localInTransit}</div>
          </div>
        </div>
      )}

      {/* Shipment List */}
      {shipments.length === 0 ? (
        <div className="text-center py-12 bg-stone/20 rounded-lg">
          <Truck className="w-12 h-12 mx-auto mb-3 text-ink/30" />
          <p className="text-ink/50 mb-4">No shipments yet</p>
          {isEditing && (
            <button
              onClick={() => startNewShipment()}
              className="text-bark hover:text-copper-dark transition-colors"
            >
              Create your first shipment
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {shipments.map((shipment) => {
            const dirConfig = shipment.direction ? DIRECTION_CONFIG[shipment.direction] : null;
            const DirectionIcon = dirConfig?.icon || Truck;
            const StatusIcon = STATUS_CONFIG[shipment.status]?.icon || Clock;
            const statusConfig = STATUS_CONFIG[shipment.status];

            return (
              <div
                key={shipment.shipment_id}
                className="bg-parchment border border-lichen rounded-lg p-4 hover:border-bark/30 transition-colors cursor-pointer"
                onClick={() => openShipmentDrawer(shipment)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className={`p-2 rounded-lg ${statusConfig?.bg || 'bg-stone'}`}>
                      <DirectionIcon className={`w-5 h-5 ${dirConfig?.color || 'text-ink/50'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">
                          {shipment.shipment_number || `Shipment ${shipment.shipment_id.slice(0, 8)}`}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusConfig?.bg} ${statusConfig?.text}`}>
                          <StatusIcon className="w-3 h-3" />
                          {shipment.status_label}
                        </span>
                      </div>
                      <div className="text-sm text-ink/60 mt-1 flex items-center gap-4">
                        {shipment.shipment_type_label && (
                          <span>{shipment.shipment_type_label}</span>
                        )}
                        {shipment.estimated_dispatch_date && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {formatDateShort(shipment.estimated_dispatch_date)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-ink/50">
                    {(shipment.item_count || 0) > 0 && (
                      <span className="flex items-center gap-1">
                        <Package className="w-3.5 h-3.5" />
                        {shipment.item_count}
                      </span>
                    )}
                    {(shipment.document_count || 0) > 0 && (
                      <span className="flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5" />
                        {shipment.document_count}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Shipment Detail Drawer */}
      <SlideOver
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title={selectedShipment?.shipment_number || 'Shipment Details'}
      >
        {selectedShipment && (
          <div className="space-y-6">
            {/* Status & Direction */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {selectedShipment.direction && (() => {
                  const dirConf = DIRECTION_CONFIG[selectedShipment.direction];
                  if (!dirConf) return null;
                  const DirIcon = dirConf.icon;
                  return (
                    <span className={`flex items-center gap-1 text-sm font-medium ${dirConf.color}`}>
                      <DirIcon className="w-4 h-4" />
                      {dirConf.label}
                    </span>
                  );
                })()}
              </div>
              {isEditing && (
                <select
                  value={selectedShipment.status}
                  onChange={(e) => updateStatus(selectedShipment, e.target.value as ShipmentStatus)}
                  className={`text-sm font-medium px-3 py-1 rounded-full border-0 ${STATUS_CONFIG[selectedShipment.status]?.bg} ${STATUS_CONFIG[selectedShipment.status]?.text}`}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
              {!isEditing && (
                <span className={`inline-flex items-center gap-1 px-3 py-1 text-sm font-medium rounded-full ${STATUS_CONFIG[selectedShipment.status]?.bg} ${STATUS_CONFIG[selectedShipment.status]?.text}`}>
                  {selectedShipment.status_label}
                </span>
              )}
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-medium text-ink/50 uppercase tracking-wide">Type</div>
                <div className="text-sm text-ink mt-1">{selectedShipment.shipment_type_label}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-ink/50 uppercase tracking-wide">Purpose</div>
                <div className="text-sm text-ink mt-1">{selectedShipment.purpose_label || '—'}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-ink/50 uppercase tracking-wide">Est. Dispatch</div>
                <div className="text-sm text-ink mt-1">{formatDateShort(selectedShipment.estimated_dispatch_date)}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-ink/50 uppercase tracking-wide">Est. Arrival</div>
                <div className="text-sm text-ink mt-1">{formatDateShort(selectedShipment.estimated_arrival_date)}</div>
              </div>
              {selectedShipment.actual_arrival_date && (
                <div>
                  <div className="text-xs font-medium text-ink/50 uppercase tracking-wide">Actual Arrival</div>
                  <div className="text-sm text-semantic-success mt-1">{formatDateShort(selectedShipment.actual_arrival_date)}</div>
                </div>
              )}
            </div>

            {/* Remarks */}
            {selectedShipment.remarks && (
              <div>
                <div className="text-xs font-medium text-ink/50 uppercase tracking-wide mb-2">Remarks</div>
                <div className="text-sm text-ink bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg p-3">
                  {selectedShipment.remarks}
                </div>
              </div>
            )}

            {/* Insurance */}
            {selectedShipment.insurance_value_total && (
              <div>
                <div className="text-xs font-medium text-ink/50 uppercase tracking-wide">Insurance Value</div>
                <div className="text-sm text-ink mt-1">{selectedShipment.insurance_value_total} {selectedShipment.insurance_currency}</div>
              </div>
            )}

            {/* Items */}
            {selectedShipment.items && selectedShipment.items.length > 0 && (
              <div>
                <div className="text-xs font-medium text-ink/50 uppercase tracking-wide mb-2 flex items-center gap-1">
                  <Package className="w-3.5 h-3.5" />
                  Items ({selectedShipment.items.length})
                </div>
                <div className="space-y-2">
                  {selectedShipment.items.map((item) => (
                    <div key={item.shipment_item_id} className="flex items-center justify-between p-2 bg-stone/30 rounded">
                      <div>
                        <div className="text-sm font-medium text-ink">{item.object_number || item.object_id.slice(0, 8)}</div>
                        {item.object_title && (
                          <div className="text-xs text-ink/60">{item.object_title}</div>
                        )}
                      </div>
                      {item.crate_number && (
                        <span className="text-xs text-ink/50 bg-parchment px-2 py-1 rounded">
                          {item.crate_number}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Documents */}
            {selectedShipment.documents && selectedShipment.documents.length > 0 && (
              <div>
                <div className="text-xs font-medium text-ink/50 uppercase tracking-wide mb-2 flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5" />
                  Documents ({selectedShipment.documents.length})
                </div>
                <div className="space-y-2">
                  {selectedShipment.documents.map((doc) => (
                    <div key={doc.document_id} className="flex items-center justify-between p-2 bg-stone/30 rounded">
                      <div className="text-sm text-ink">{doc.label || doc.document_type_label || 'Document'}</div>
                      <Link2 className="w-3.5 h-3.5 text-ink/40" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Status History */}
            {selectedShipment.status_history && selectedShipment.status_history.length > 0 && (
              <div>
                <div className="text-xs font-medium text-ink/50 uppercase tracking-wide mb-2">Status History</div>
                <div className="space-y-2">
                  {selectedShipment.status_history.map((entry) => (
                    <div key={entry.history_id} className="flex items-start gap-3 text-sm">
                      <div className={`mt-0.5 w-2 h-2 rounded-full ${STATUS_CONFIG[entry.status]?.bg || 'bg-lichen'}`} />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-ink">{entry.status_label}</span>
                          <span className="text-xs text-ink/50">{formatDateShort(entry.changed_at)}</span>
                        </div>
                        {entry.notes && (
                          <div className="text-ink/60 text-xs mt-0.5">{entry.notes}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            {isEditing && (
              <div className="flex items-center gap-2 pt-4 border-t border-lichen">
                <button
                  onClick={() => startEditShipment(selectedShipment)}
                  className="flex items-center gap-2 px-4 py-2 border border-lichen rounded-lg text-ink hover:bg-stone/50 transition-colors"
                >
                  <Edit3 className="w-4 h-4" />
                  Edit
                </button>
                <button
                  onClick={() => setDeleteConfirm(selectedShipment)}
                  className="flex items-center gap-2 px-4 py-2 border border-semantic-error/30 rounded-lg text-semantic-error hover:bg-semantic-error/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
      </SlideOver>

      {/* Create/Edit Form Drawer */}
      <SlideOver
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingShipment(null);
        }}
        title={editingShipment?.shipment_id ? 'Edit Shipment' : 'New Shipment'}
      >
        {editingShipment && (
          <div className="space-y-4">
            {/* Direction */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Direction</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingShipment({ ...editingShipment, direction: 'inbound' })}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                    editingShipment.direction === 'inbound'
                      ? 'bg-semantic-success/10 border-semantic-success/30 text-semantic-success'
                      : 'border-lichen text-ink/60 hover:border-ink/30'
                  }`}
                >
                  <ArrowDownLeft className="w-4 h-4" />
                  Inbound
                </button>
                <button
                  type="button"
                  onClick={() => setEditingShipment({ ...editingShipment, direction: 'outbound' })}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                    editingShipment.direction === 'outbound'
                      ? 'bg-semantic-info/10 border-semantic-info/30 text-semantic-info'
                      : 'border-lichen text-ink/60 hover:border-ink/30'
                  }`}
                >
                  <ArrowUpRight className="w-4 h-4" />
                  Outbound
                </button>
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Est. Dispatch Date</label>
                <input
                  type="date"
                  value={editingShipment.estimated_dispatch_date || ''}
                  onChange={(e) => setEditingShipment({ ...editingShipment, estimated_dispatch_date: e.target.value })}
                  className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Est. Arrival Date</label>
                <input
                  type="date"
                  value={editingShipment.estimated_arrival_date || ''}
                  onChange={(e) => setEditingShipment({ ...editingShipment, estimated_arrival_date: e.target.value })}
                  className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                />
              </div>
            </div>

            {/* Remarks */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Remarks</label>
              <textarea
                value={editingShipment.remarks || ''}
                onChange={(e) => setEditingShipment({ ...editingShipment, remarks: e.target.value })}
                rows={3}
                placeholder="General remarks about this shipment..."
                className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>

            {/* Insurance */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Insurance Value</label>
              <input
                type="text"
                value={editingShipment.insurance_value_total || ''}
                onChange={(e) => setEditingShipment({ ...editingShipment, insurance_value_total: e.target.value })}
                placeholder="e.g., 1000000"
                className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>

            {/* Courier */}
            <label className="flex items-center gap-2 text-sm text-ink">
              <Checkbox
                checked={editingShipment.courier_required || false}
                onChange={(e) => setEditingShipment({ ...editingShipment, courier_required: e.target.checked })}
              />
              Courier Required
            </label>

            {/* Internal Notes */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Internal Notes</label>
              <textarea
                value={editingShipment.internal_notes || ''}
                onChange={(e) => setEditingShipment({ ...editingShipment, internal_notes: e.target.value })}
                rows={2}
                placeholder="Staff notes (not for external use)..."
                className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-4 border-t border-lichen">
              <button
                onClick={() => {
                  setIsFormOpen(false);
                  setEditingShipment(null);
                }}
                className="px-4 py-2 text-ink/60 hover:text-ink transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveShipment}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingShipment.shipment_id ? 'Save Changes' : 'Create Shipment'}
              </button>
            </div>
          </div>
        )}
      </SlideOver>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && deleteShipment(deleteConfirm)}
        title="Delete Shipment"
        message={`Are you sure you want to delete shipment "${deleteConfirm?.shipment_number || 'this shipment'}"? This action cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
