import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatDateShort, formatDateTime } from '@/lib/formatters';
import {
  Truck,
  MapPin,
  FileText,
  Shield,
  Clock,
  StickyNote,
  History,
} from 'lucide-react';
import {
  WorkspaceHeader,
  WorkspaceErrorBoundary,
  WorkspaceSection,
  EditableField,
  EditableSelect,
  EditableCheckbox,
  RecordAuditHistory,
  SectionGroupDivider,
  ReadOnlyBanner,
} from '../../../components/workspace';
import { RecordDetailPageWrapper, SectionOrderProvider } from '../../../components/record-detail';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import { cn } from '../../../lib/utils';
import { apiFetch } from '../../../lib/apiClient';
import ConfirmDialog from '../../../components/ConfirmDialog';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  SHIPMENT_SECTION_GROUPS,
  ALL_SECTION_IDS,
  SHIPMENT_TYPE_OPTIONS,
  DIRECTION_OPTIONS,
  PURPOSE_OPTIONS,
  STATUS_OPTIONS,
  STATUS_STYLES,
} from './types';
import type { ShipmentDetail } from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';
import ItemsSection from './ItemsSection';
import LegsSection from './LegsSection';
import ReferencesSection from './ReferencesSection';
import DocumentsSection from './DocumentsSection';

const formatDate = formatDateShort;

/**
 * Outer wrapper that provides section order context.
 */
export default function ShipmentWorkspacePage() {
  return (
    <SectionOrderProvider>
      <ShipmentWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function ShipmentWorkspacePageContent() {
  const { orgId, shipmentId } = useParams<{ orgId: string; shipmentId?: string }>();
  const isCreateMode = !shipmentId;

  // Fetch shipment data (disabled in create mode)
  const { data: shipment, isLoading, error } = useQuery({
    queryKey: ['shipment', orgId, shipmentId],
    queryFn: () => apiFetch<ShipmentDetail>(
      `/organizations/${orgId}/collections/shipments/${shipmentId}`
    ),
    enabled: !!shipmentId && !!orgId,
  });

  const wp = useWorkspacePage({
    entityType: 'shipment',
    entityId: shipmentId,
    entityLabel: shipment?.shipment_number || (shipmentId ? `Shipment ${shipmentId.slice(0, 8)}` : undefined),
    orgId,
    editPermission: 'collections.edit',
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  const form = useFormState({ orgId, shipmentId, isCreateMode, shipment });

  const {
    formData,
    updateField,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    errorMessage,
    queryClient,
    performSave,
    handleCreate,
    deleteMutation,
  } = form;

  const sectionState = useSectionState({
    orgId,
    shipmentId,
    isCreateMode,
    isEditing,
    setIsEditing,
    canEdit,
    hasUnsavedChanges,
    performSave,
    queryClient,
  });

  const {
    expandedSections,
    getSectionOrder,
    toggleSection,
    handleToggleMode,
    handleEnterEditMode,
  } = sectionState;

  const sectionSummaries = useSectionSummaries(formData, shipment);
  const hasContent = useHasContent(formData, shipment);

  // Compute sectionData for nav completeness indicators
  const sectionData: Record<string, unknown> = {
    details: {
      shipment_type: formData.shipment_type,
      direction: formData.direction,
      purpose: formData.purpose,
      status: formData.status,
    },
    insurance: {
      insurance_value_total: formData.insurance_value_total,
      insurance_note: formData.insurance_note,
    },
    legs: {
      legs: shipment?.legs,
    },
    items: {
      items: shipment?.items,
    },
    references: {
      references: shipment?.references,
    },
    documents: {
      documents: shipment?.documents,
    },
    notes: {
      remarks: formData.remarks,
      internal_notes: formData.internal_notes,
    },
    statusHistory: {
      status_history: shipment?.status_history,
    },
    history: {},
  };

  // Loading state
  if (!isCreateMode && isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  // Error state
  if (!isCreateMode && !isLoading && (error || !shipment)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <Truck size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Shipment not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The shipment record could not be loaded.'}
        </p>
      </div>
    );
  }

  const displayNumber = isCreateMode ? '' : (shipment?.shipment_number || '');
  const displayTitle = isCreateMode ? 'New Shipment' : (shipment?.shipment_number || 'Shipment');

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/shipments`}
          backText="Back to Shipments"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Shipment"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Status bar - only in view/edit mode, not create mode */}
      {!isCreateMode && shipment && (
        <div className="flex items-center gap-4 mb-6">
          <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${STATUS_STYLES[shipment.status] || 'bg-stone text-ink'}`}>
            {shipment.status_label}
          </span>
          {shipment.shipment_type_label && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone rounded-full text-sm text-archive">
              {shipment.shipment_type_label}
            </span>
          )}
          {shipment.direction_label && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone rounded-full text-sm text-archive">
              {shipment.direction_label}
            </span>
          )}
          {shipment.courier_required && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-azurite/10 text-azurite rounded-full text-sm font-medium">
              Courier Required
            </span>
          )}
          {shipment.is_international && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-semantic-info/10 text-semantic-info rounded-full text-sm font-medium">
              International
            </span>
          )}
          {shipment.is_high_value && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-semantic-warning/10 text-semantic-warning rounded-full text-sm font-medium">
              High Value
            </span>
          )}
        </div>
      )}

      {/* Error message */}
      {errorMessage && (
        <div className="mb-4 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg">
          <p className="text-semantic-error">{errorMessage}</p>
        </div>
      )}

      {/* Read-only indicator */}
      <ReadOnlyBanner visible={!isCreateMode && !canEdit} />

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={Truck} />}

        {/* Shipment Details */}
        <WorkspaceSection
          id="details"
          title="Shipment Details"
          icon={<Truck size={18} />}
          isExpanded={expandedSections.details}
          onToggle={() => toggleSection('details')}
          isEditing={isEditing}
          order={getSectionOrder('details')}
          isEmpty={!hasContent.details}
          summary={sectionSummaries.details}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Shipment Number"
              value={formData.shipment_number}
              isEditing={isEditing}
              onChange={(v) => updateField('shipment_number', v)}
              placeholder="Auto-generated if empty"
            />
            <EditableSelect
              label="Type"
              value={formData.shipment_type}
              isEditing={isEditing}
              onChange={(v) => updateField('shipment_type', v)}
              options={SHIPMENT_TYPE_OPTIONS}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <EditableSelect
              label="Direction"
              value={formData.direction}
              isEditing={isEditing}
              onChange={(v) => updateField('direction', v)}
              options={DIRECTION_OPTIONS}
            />
            <EditableSelect
              label="Purpose"
              value={formData.purpose}
              isEditing={isEditing}
              onChange={(v) => updateField('purpose', v)}
              options={PURPOSE_OPTIONS}
            />
            <EditableSelect
              label="Status"
              value={formData.status}
              isEditing={isEditing}
              onChange={(v) => updateField('status', v)}
              options={STATUS_OPTIONS}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <EditableField
              label="Requested Date"
              value={formData.requested_date}
              isEditing={isEditing}
              onChange={(v) => updateField('requested_date', v)}
              type="date"
            />
            <EditableField
              label="Est. Dispatch Date"
              value={formData.estimated_dispatch_date}
              isEditing={isEditing}
              onChange={(v) => updateField('estimated_dispatch_date', v)}
              type="date"
            />
            <EditableField
              label="Est. Arrival Date"
              value={formData.estimated_arrival_date}
              isEditing={isEditing}
              onChange={(v) => updateField('estimated_arrival_date', v)}
              type="date"
            />
            <EditableField
              label="Actual Dispatch Date"
              value={formData.actual_dispatch_date}
              isEditing={isEditing}
              onChange={(v) => updateField('actual_dispatch_date', v)}
              type="date"
            />
            <EditableField
              label="Actual Arrival Date"
              value={formData.actual_arrival_date}
              isEditing={isEditing}
              onChange={(v) => updateField('actual_arrival_date', v)}
              type="date"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <EditableCheckbox
              label="Courier Required"
              value={formData.courier_required}
              isEditing={isEditing}
              onChange={(v) => updateField('courier_required', v)}
            />
            <EditableCheckbox
              label="International"
              value={formData.is_international}
              isEditing={isEditing}
              onChange={(v) => updateField('is_international', v)}
            />
            <EditableCheckbox
              label="High Value"
              value={formData.is_high_value}
              isEditing={isEditing}
              onChange={(v) => updateField('is_high_value', v)}
            />
          </div>
        </WorkspaceSection>

        {/* Insurance */}
        <WorkspaceSection
          id="insurance"
          title="Insurance"
          icon={<Shield size={18} />}
          isExpanded={expandedSections.insurance}
          onToggle={() => toggleSection('insurance')}
          isEditing={isEditing}
          order={getSectionOrder('insurance')}
          isEmpty={!hasContent.insurance}
          summary={sectionSummaries.insurance}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <EditableField
              label="Total Value"
              value={formData.insurance_value_total}
              isEditing={isEditing}
              onChange={(v) => updateField('insurance_value_total', v)}
              placeholder="0.00"
            />
            <EditableField
              label="Currency"
              value={formData.insurance_currency}
              isEditing={isEditing}
              onChange={(v) => updateField('insurance_currency', v)}
            />
            <EditableField
              label="Insurance Notes"
              value={formData.insurance_note}
              isEditing={isEditing}
              onChange={(v) => updateField('insurance_note', v)}
              multiline
              rows={2}
              className="md:col-span-3"
            />
          </div>
        </WorkspaceSection>

        {/* === ROUTE & CARGO GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Route & Cargo" icon={MapPin} />}

        {/* Legs */}
        {orgId && shipmentId && shipment && (
          <LegsSection
            orgId={orgId}
            shipmentId={shipmentId}
            shipment={shipment}
            isEditing={isEditing}
            isExpanded={expandedSections.legs}
            onToggle={() => toggleSection('legs')}
            order={getSectionOrder('legs')}
            isEmpty={!hasContent.legs}
            summary={sectionSummaries.legs}
          />
        )}

        {/* Items */}
        {orgId && shipmentId && shipment && (
          <ItemsSection
            orgId={orgId}
            shipmentId={shipmentId}
            shipment={shipment}
            isEditing={isEditing}
            isExpanded={expandedSections.items}
            onToggle={() => toggleSection('items')}
            order={getSectionOrder('items')}
            isEmpty={!hasContent.items}
            summary={sectionSummaries.items}
          />
        )}

        {/* === LINKED RECORDS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Linked Records" icon={FileText} />}

        {/* Linked Procedures */}
        {orgId && shipmentId && shipment && (
          <ReferencesSection
            orgId={orgId}
            shipmentId={shipmentId}
            shipment={shipment}
            isEditing={isEditing}
            isExpanded={expandedSections.references}
            onToggle={() => toggleSection('references')}
            order={getSectionOrder('references')}
            isEmpty={!hasContent.references}
            summary={sectionSummaries.references}
          />
        )}

        {/* Documents */}
        {orgId && shipmentId && shipment && (
          <DocumentsSection
            orgId={orgId}
            shipmentId={shipmentId}
            shipment={shipment}
            isEditing={isEditing}
            isExpanded={expandedSections.documents}
            onToggle={() => toggleSection('documents')}
            order={getSectionOrder('documents')}
            isEmpty={!hasContent.documents}
            summary={sectionSummaries.documents}
          />
        )}

        {/* === ADMIN GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Admin" icon={History} />}

        {/* Notes */}
        <WorkspaceSection
          id="notes"
          title="Notes"
          icon={<StickyNote size={18} />}
          isExpanded={expandedSections.notes}
          onToggle={() => toggleSection('notes')}
          isEditing={isEditing}
          order={getSectionOrder('notes')}
          isEmpty={!hasContent.notes}
          summary={sectionSummaries.notes}
        >
          <div className="grid grid-cols-1 gap-4">
            <EditableField
              label="Remarks"
              value={formData.remarks}
              isEditing={isEditing}
              onChange={(v) => updateField('remarks', v)}
              multiline
              rows={3}
              placeholder="General remarks about this shipment..."
            />
            <EditableField
              label="Internal Notes"
              value={formData.internal_notes}
              isEditing={isEditing}
              onChange={(v) => updateField('internal_notes', v)}
              multiline
              rows={2}
              placeholder="Staff-only notes..."
            />
          </div>
        </WorkspaceSection>

        {/* Status History */}
        <WorkspaceSection
          id="statusHistory"
          title="Status History"
          icon={<Clock size={18} />}
          isExpanded={expandedSections.statusHistory}
          onToggle={() => toggleSection('statusHistory')}
          isEditing={isEditing}
          order={getSectionOrder('statusHistory')}
          isEmpty={!hasContent.statusHistory}
          summary={sectionSummaries.statusHistory}
        >
          {(!shipment?.status_history || shipment.status_history.length === 0) ? (
            <p className="text-sm text-archive text-center py-4">No status changes recorded</p>
          ) : (
            <div className="space-y-3">
              {shipment.status_history.map((entry) => (
                <div key={entry.history_id} className="flex items-start gap-3 text-sm">
                  <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                    STATUS_STYLES[entry.status]?.split(' ')[0] || 'bg-stone'
                  }`} />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink">{entry.status_label}</span>
                      <span className="text-xs text-archive">{formatDate(entry.changed_at)}</span>
                    </div>
                    {entry.notes && <div className="text-archive text-xs mt-0.5">{entry.notes}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </WorkspaceSection>

        {/* Change History */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && shipmentId && (
          <WorkspaceSection
            id="history"
            title="Change History"
            icon={<History size={20} />}
            isExpanded={expandedSections.history}
            onToggle={() => toggleSection('history')}
            isEditing={isEditing}
            order={getSectionOrder('history')}
            isEmpty={!hasContent.history}
            summary={sectionSummaries.history}
          >
            <RecordAuditHistory
              organizationId={orgId}
              entityType="shipment"
              entityId={shipmentId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata - only in view/edit mode, not create mode */}
      {!isCreateMode && shipment && shipment.created_at && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(shipment.created_at)}</p>
          {shipment.updated_at && (
            <p>Last updated: {formatDateTime(shipment.updated_at)}</p>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={dialogs.showDeleteConfirm}
        onClose={() => dialogs.setShowDeleteConfirm(false)}
        onConfirm={() => {
          deleteMutation.mutate();
          dialogs.setShowDeleteConfirm(false);
        }}
        title="Delete Shipment"
        message={`Are you sure you want to delete shipment "${shipment?.shipment_number || 'this shipment'}"? This action cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* CreateTaskSlideOver */}
      {orgId && shipmentId && shipment && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"shipment" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={shipmentId}
          initialEntityLabel={shipment.shipment_number || `Shipment ${shipmentId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && shipment) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/shipments`}
        backLabel="Back to Shipments"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={SHIPMENT_SECTION_GROUPS}
          sectionData={sectionData}
          permissions={{
            canCreateTask: true,
            canViewHistory: true,
            canDelete: canEdit,
          }}
          callbacks={{
            onDelete: () => dialogs.setShowDeleteConfirm(true),
            onCreateTask: () => dialogs.setShowCreateTask(true),
          }}
          isEditing={isEditing}
          onSectionNavigate={handleEnterEditMode}
          pageType="shipment"
          enabled={true}
          showHeader={true}
          title="Shipment"
          objectNumber={displayNumber || undefined}
          subtitle={displayTitle}
          backUrl={`/organizations/${orgId}/collections/shipments`}
          backLabel="Back to Shipments"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/shipments` : undefined}
      backLabel="Back to Shipments"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
