import { useQuery } from '@tanstack/react-query';
import { Truck } from 'lucide-react';
import { formatDateShort } from '../../lib/formatters';
import { apiFetch } from '../../lib/apiClient';
import { RecordLinker } from '../records';

interface ShipmentLinkerProps {
  organizationId: string;
  procedureType: 'loan_in' | 'loan_out' | 'object_entry' | 'object_exit' | 'deaccession' | 'movement' | 'conservation';
  procedureId: string;
  isEditing?: boolean;
  onCountChange?: (count: number) => void;
}

interface ShipmentReference {
  reference_id: string;
  procedure_type: string;
  procedure_id: string;
}

interface LinkedShipment {
  shipment_id: string;
  shipment_number: string;
  shipment_type: string;
  shipment_type_label: string;
  direction: string | null;
  direction_label: string | null;
  status: string;
  status_label: string;
  estimated_dispatch_date: string | null;
  actual_dispatch_date: string | null;
  item_count: number;
  references: ShipmentReference[];
}

interface ShipmentListResponse {
  items: LinkedShipment[];
  total: number;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-ink',
  confirmed: 'bg-semantic-info/10 text-semantic-info',
  dispatched: 'bg-bark/10 text-bark',
  in_transit: 'bg-semantic-info/10 text-semantic-info',
  delayed: 'bg-semantic-warning/10 text-semantic-warning',
  delivered: 'bg-semantic-success/10 text-semantic-success',
  completed: 'bg-semantic-success/10 text-semantic-success',
  cancelled: 'bg-semantic-error/10 text-semantic-error',
};

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '';
  return formatDateShort(dateStr);
};

/**
 * Links shipments to a procedure (loan, entry, exit, deaccession).
 * Uses RecordLinker pattern with search slide-over.
 */
export function ShipmentLinker({
  organizationId,
  procedureType,
  procedureId,
  isEditing = false,
  onCountChange,
}: ShipmentLinkerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['procedure-shipments', organizationId, procedureType, procedureId],
    queryFn: async () => {
      return apiFetch<ShipmentListResponse>(
        `/organizations/${organizationId}/collections/shipments?reference=${procedureType}:${procedureId}&limit=50`
      );
    },
  });

  const linkedShipments = data?.items || [];

  return (
    <RecordLinker
      organizationId={organizationId}
      onCountChange={onCountChange}
      title="Shipments"
      addLabel="Link Shipment"
      emptyMessage="No shipments linked to this procedure."
      linkedItems={linkedShipments}
      isLoading={isLoading}
      getItemId={(s: LinkedShipment) => s.shipment_id}
      renderItem={(s: LinkedShipment) => (
        <>
          <Truck size={16} className="text-archive flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-ink">
              {s.shipment_number}
            </div>
            <div className="text-xs text-archive">
              {s.shipment_type_label}
              {s.direction_label ? ` · ${s.direction_label}` : ''}
              {(s.actual_dispatch_date || s.estimated_dispatch_date)
                ? ` · ${formatDate(s.actual_dispatch_date || s.estimated_dispatch_date)}`
                : ''}
              {s.item_count > 0 ? ` · ${s.item_count} item${s.item_count !== 1 ? 's' : ''}` : ''}
            </div>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
              STATUS_STYLES[s.status] || STATUS_STYLES.draft
            }`}
          >
            {s.status_label}
          </span>
        </>
      )}
      getItemHref={(s: LinkedShipment) =>
        `/organizations/${organizationId}/collections/shipments/${s.shipment_id}`
      }
      isEditing={isEditing}
      onLink={async (searchItem) => {
        const shipment = searchItem as LinkedShipment;
        await apiFetch(
          `/organizations/${organizationId}/collections/shipments/${shipment.shipment_id}/references`,
          {
            method: 'POST',
            body: JSON.stringify({
              procedure_type: procedureType,
              procedure_id: procedureId,
            }),
          }
        );
      }}
      onUnlink={async (s: LinkedShipment) => {
        // Find the reference linking this shipment to this procedure. Throw if
        // it is missing rather than skip: the list endpoint once omitted
        // references entirely, and skipping made Unlink a silent no-op.
        const ref = s.references?.find(
          (r) => r.procedure_type === procedureType && r.procedure_id === procedureId
        );
        if (!ref) {
          throw new Error(`No reference links shipment ${s.shipment_number} to this record`);
        }
        await apiFetch(
          `/organizations/${organizationId}/collections/shipments/${s.shipment_id}/references/${ref.reference_id}`,
          { method: 'DELETE' }
        );
      }}
      search={{
        title: 'Link Shipment',
        subtitle: 'Search for an existing shipment to link',
        placeholder: 'Search by shipment number...',
        searchLabel: 'Search Shipments',
        queryKey: ['shipments-search', organizationId],
        searchFn: async (term) => {
          const result = await apiFetch<ShipmentListResponse>(
            `/organizations/${organizationId}/collections/shipments?q=${encodeURIComponent(term)}&limit=20`
          );
          return result.items || [];
        },
        getSearchItemId: (s) => (s as LinkedShipment).shipment_id,
        getSearchItemLabel: (s) => (s as LinkedShipment).shipment_number,
        renderSearchItem: (s) => {
          const shipment = s as LinkedShipment;
          return (
            <>
              <Truck size={16} className="text-archive flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink font-medium truncate">
                  {shipment.shipment_number}
                </p>
                <p className="text-xs text-archive truncate">
                  {shipment.shipment_type_label}
                  {shipment.direction_label ? ` · ${shipment.direction_label}` : ''}
                  {shipment.status_label ? ` · ${shipment.status_label}` : ''}
                </p>
              </div>
            </>
          );
        },
      }}
      invalidateKeys={[
        ['procedure-shipments', organizationId, procedureType, procedureId],
      ]}
      submitLabel="Link Shipment"
    />
  );
}
