import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Check, Loader2 } from 'lucide-react';
import { WorkspaceSection } from '../../../components/workspace';
import {
  MediaLibraryLinker,
  type LinkedMediaItem,
  type MediaLinkParams,
} from '../../../components/collections/MediaLibraryLinker';
import ConfirmDialog from '../../../components/ConfirmDialog';
import SlideOver from '../../../components/ui/SlideOver';
import {
  addShipmentDocument,
  removeShipmentDocument,
} from '../../../lib/api/shipments';
import { useToast } from '../../../contexts/ToastContext';
import type { Media } from '../../../lib/schemas';
import type { ShipmentDetail, DocumentData } from './types';

interface DocumentsSectionProps {
  orgId: string;
  shipmentId: string;
  shipment: ShipmentDetail;
  isEditing: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  order?: number;
  isEmpty: boolean;
  summary?: string;
}

const DOCUMENT_TYPE_OPTIONS = [
  { value: 'bill_of_lading', label: 'Bill of Lading' },
  { value: 'packing_list', label: 'Packing List' },
  { value: 'condition_report', label: 'Condition Report' },
  { value: 'customs_declaration', label: 'Customs Declaration' },
  { value: 'insurance_certificate', label: 'Insurance Certificate' },
  { value: 'courier_receipt', label: 'Courier Receipt' },
  { value: 'delivery_receipt', label: 'Delivery Receipt' },
  { value: 'crate_specs', label: 'Crate Specs' },
  { value: 'other', label: 'Other' },
];

/**
 * Adapt shipment DocumentData[] to the LinkedMediaItem[] shape that
 * MediaLibraryLinker expects.  We stash the original DocumentData in a
 * side-map so callbacks can recover the document_id for API calls.
 */
function toLinkedMedia(documents: DocumentData[]): LinkedMediaItem[] {
  return documents.map((doc) => ({
    link_id: doc.document_id,
    media_id: doc.media_id,
    // caption_override doubles as the user-visible label
    caption_override: doc.label ?? undefined,
    usage_type: doc.document_type ?? undefined,
    // Partial media object for display — cast to Media since MediaLinkCard
    // only reads a handful of fields (media_type, thumbnail_url, title, etc.)
    media: {
      media_id: doc.media_id,
      organization_id: '',
      s3_key: '',
      filename: doc.label || 'Document',
      title: doc.label || doc.document_type_label || 'Document',
      media_type: 'document',
      mime_type: 'application/octet-stream',
      file_size: 0,
      processing_status: 'completed',
      alt_text: null,
      description: null,
      url: null,
      thumbnail_url: `/api/media/${doc.media_id}/thumbnail?size=200`,
      created_at: '',
      updated_at: '',
    } as Media,
  }));
}

export default function DocumentsSection({
  orgId,
  shipmentId,
  shipment,
  isEditing,
  isExpanded,
  onToggle,
  order,
  isEmpty,
  summary,
}: DocumentsSectionProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [confirmUnlink, setConfirmUnlink] = useState<string | null>(null);
  const [metadataSlideOver, setMetadataSlideOver] = useState<{
    media_id: string;
  } | null>(null);
  const [docType, setDocType] = useState('');
  const [docLabel, setDocLabel] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const invalidate = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: ['shipment', orgId, shipmentId],
      }),
    [queryClient, orgId, shipmentId],
  );

  const documents = shipment.documents ?? [];
  const linkedMedia = toLinkedMedia(documents);

  const removeMutation = useMutation({
    mutationFn: (docId: string) =>
      removeShipmentDocument(orgId, shipmentId, docId),
    onSuccess: () => {
      invalidate();
      setConfirmUnlink(null);
      showToast({ type: 'success', title: 'Document removed' });
    },
    onError: (err: Error) => {
      showToast({
        type: 'error',
        title: err.message || 'Failed to remove document',
      });
    },
  });

  // When the user selects media from the library, open a metadata slide-over
  // so they can set document_type and label before linking.
  const handleLink = useCallback(
    async (params: MediaLinkParams) => {
      // Open the metadata slide-over for the selected media
      setMetadataSlideOver({ media_id: params.media_id });
      setDocType('');
      setDocLabel('');
    },
    [],
  );

  const handleConfirmLink = useCallback(async () => {
    if (!metadataSlideOver) return;
    setIsSaving(true);
    try {
      await addShipmentDocument(orgId, shipmentId, {
        media_id: metadataSlideOver.media_id,
        document_type: docType || undefined,
        label: docLabel || undefined,
      });
      invalidate();
      showToast({ type: 'success', title: 'Document attached' });
      setMetadataSlideOver(null);
    } catch (err) {
      showToast({
        type: 'error',
        title: err instanceof Error ? err.message : 'Failed to attach document',
      });
    } finally {
      setIsSaving(false);
    }
  }, [metadataSlideOver, orgId, shipmentId, docType, docLabel, invalidate, showToast]);

  const handleUnlink = useCallback(
    async (linkId: string) => {
      setConfirmUnlink(linkId);
    },
    [],
  );

  // Find the document being confirmed for removal
  const confirmDoc = confirmUnlink
    ? documents.find((d) => d.document_id === confirmUnlink)
    : null;

  return (
    <WorkspaceSection
      id="documents"
      title="Documents"
      icon={<FileText size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
      isEmpty={isEmpty}
      summary={summary}
    >
      <MediaLibraryLinker
        organizationId={orgId}
        linkedMedia={linkedMedia}
        onLink={handleLink}
        onUnlink={handleUnlink}
        title={`Documents (${documents.length})`}
        usageTypes={DOCUMENT_TYPE_OPTIONS}
        showPrimary={false}
        isEditing={isEditing}
        isLoading={false}
        slideOverTitle="Link Document from Media Library"
        slideOverSubtitle="Search for a document or image to attach to this shipment"
      />

      {/* Metadata slide-over — shown after selecting media, before linking */}
      <SlideOver
        isOpen={!!metadataSlideOver}
        onClose={() => setMetadataSlideOver(null)}
        title="Document Details"
        subtitle="Set the document type and label before attaching"
        width="md"
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setMetadataSlideOver(null)}
              className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmLink}
              disabled={isSaving}
              className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Attaching...
                </>
              ) : (
                <>
                  <Check size={16} />
                  Attach Document
                </>
              )}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Document Type
            </label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark bg-parchment"
            >
              <option value="">-- Select --</option>
              {DOCUMENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Label
            </label>
            <input
              type="text"
              value={docLabel}
              onChange={(e) => setDocLabel(e.target.value)}
              placeholder="Optional label for this document..."
              className="w-full px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark bg-parchment"
            />
          </div>
        </div>
      </SlideOver>

      {/* Confirm remove dialog */}
      <ConfirmDialog
        isOpen={!!confirmUnlink}
        onClose={() => setConfirmUnlink(null)}
        onConfirm={() => {
          if (confirmUnlink) {
            removeMutation.mutate(confirmUnlink);
          }
        }}
        title="Remove Document"
        message={
          <>
            Remove{' '}
            <strong>{confirmDoc?.label || 'this document'}</strong>{' '}
            from this shipment? The media file itself will not be deleted.
          </>
        }
        confirmText="Remove"
        confirmStyle="danger"
      />
    </WorkspaceSection>
  );
}
