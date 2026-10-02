import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatDateTime } from '@/lib/formatters';
import {
  ArrowRightLeft,
  Search,
  Package,
  X,
  User,
  Lock,
  History,
  ClipboardList,
  Truck,
  FileCheck,
  Calendar,
  ShieldCheck,
} from 'lucide-react';
import { ContactSelectorSlideOver } from '../../../components/collections/ConstituentSelectorSlideOver';
import { EditableLocationPicker } from '../../../components/collections/LocationPickerModal';
import { ObjectSelector } from '../../../components/collections/ObjectSelector';
import { ShipmentLinker } from '../../../components/collections/ShipmentLinker';
import { ConditionReportLinker } from '../../../components/collections/ConditionReportLinker';
import { AuthorizationSection } from '../../../components/collections/AuthorizationSection';
import { SignedDocumentSlot } from '../../../components/collections/SignedDocumentSlot';
import { ProcedureRequirementsCard } from '../../../components/collections/ProcedureRequirementsCard';
import { useProcedureRequirements } from '../../../hooks/useProcedureRequirements';
import {
  WorkspaceHeader,
  WorkspaceErrorBoundary,
  WorkspaceSection,
  EditableField,
  EditableSelect,
  RecordAuditHistory,
  SectionGroupDivider,
  ReadOnlyBanner,
} from '../../../components/workspace';
import { RecordDetailPageWrapper } from '../../../components/record-detail';
import { WorkspacePageShell } from '../../../components/workspace';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import { cn } from '../../../lib/utils';
import ConfirmDialog from '../../../components/ConfirmDialog';

import { useMovementForm, useSectionState } from './hooks';
import {
  MOVEMENT_REASON_OPTIONS,
  STATUS_OPTIONS,
  MOVEMENT_METHOD_OPTIONS,
  LOCATION_FITNESS_OPTIONS,
} from './constants';
import {
  MOVEMENT_SECTION_GROUPS,
  ALL_SECTION_IDS,
} from './types';

/**
 * Outer wrapper — WorkspacePageShell handles SectionOrderProvider + loading/error.
 */
export default function MovementWorkspacePage() {
  const { orgId, movementId } = useParams<{ orgId: string; movementId?: string }>();
  const [searchParams] = useSearchParams();

  const initialObjectId = searchParams.get('object_id') || '';
  const initialToLocationId = searchParams.get('to_location_id') || '';
  const isCreateMode = !movementId;

  const form = useMovementForm(orgId, movementId, isCreateMode, initialObjectId, initialToLocationId);

  return (
    <WorkspacePageShell
      isLoading={form.isLoading}
      error={form.error}
      isCreateMode={isCreateMode}
      entityName="Movement"
      backUrl={`/organizations/${orgId}/collections/movements`}
      icon={ArrowRightLeft}
      entityData={form.existingMovement}
    >
      <MovementWorkspacePageContent form={form} />
    </WorkspacePageShell>
  );
}

function MovementWorkspacePageContent({ form }: { form: ReturnType<typeof useMovementForm> }) {
  const { orgId, movementId } = useParams<{ orgId: string; movementId?: string }>();
  const isCreateMode = !movementId;
  const { requirementGroups } = useProcedureRequirements('movement', orgId);

  const {
    formData,
    setFormData,
    updateField,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    saveStatus,
    lastSaved,
    errorMessage,
    existingMovement,
    handlerContact,
    authorizerContact,
    selectedObjectLocationId,
    queryClient,
    triggerSave,
    handleCreateSave,
    handleObjectChange,
    deleteMutation,
  } = form;

  const isCompleted = existingMovement?.status === 'completed';

  const wp = useWorkspacePage({
    entityType: 'movement',
    entityId: movementId,
    entityLabel: existingMovement?.movement_reference_number ?? undefined,
    orgId,
    editPermission: 'movements.edit',
  });

  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  const [showHandlerSelector, setShowHandlerSelector] = useState(false);
  const [showAuthorizerSelector, setShowAuthorizerSelector] = useState(false);

  const sectionState = useSectionState({
    orgId,
    movementId,
    isCreateMode,
    isEditing,
    setIsEditing,
    canEdit,
    hasUnsavedChanges,
    performSave: triggerSave,
    queryClient,
  });

  const {
    expandedSections,
    getSectionOrder,
    toggleSection,
    handleToggleMode,
    handleEnterEditMode,
  } = sectionState;

  // Compute sectionData for nav completeness
  const sectionData: Record<string, unknown> = {
    object: formData.object_id ? { object_id: formData.object_id } : {},
    movement: {
      reason: formData.reason,
      to_location_id: formData.to_location_id,
      movement_date: formData.movement_date,
    },
    authorization: {
      authorizer_id: formData.authorizer_id,
      authorization_date: formData.authorization_date,
    },
    handler: {
      handler_id: formData.handler_id,
      movement_note: formData.movement_note,
    },
    shipping: {
      movement_method: formData.movement_method,
      shipper_id: formData.shipper_id,
      shipping_method: formData.shipping_method,
    },
    condition: {
      condition_note: formData.condition_note,
      condition_report_id: formData.condition_report_id,
    },
    planning: {
      location_fitness: formData.location_fitness,
      planned_removal_date: formData.planned_removal_date,
      planned_return_date: formData.planned_return_date,
    },
    history: {},
  };

  const displayTitle = isCreateMode
    ? 'New Movement'
    : MOVEMENT_REASON_OPTIONS.find(t => t.value === existingMovement?.reason)?.label || 'Movement';
  const displayNumber = isCreateMode ? '' : (existingMovement?.movement_reference_number || '');
  const status = existingMovement?.status || 'pending';

  const pageContent = (
    <div className={cn(!useNewLayout && 'max-w-4xl mx-auto px-6 pb-12')}>
      {/* Header - only show old header when not using new layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/movements`}
          backText="Back to Movements"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          onToggleMode={isCreateMode || isCompleted ? undefined : handleToggleMode}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Movement"
          onSave={isCreateMode ? handleCreateSave : undefined}
        />
      )}

      {/* Procedure Compliance Card */}
      {!isCreateMode && existingMovement && (
                  <ProcedureRequirementsCard
            title="Movement Requirements"
            requirementGroups={requirementGroups}
            record={formData as unknown as Record<string, unknown>}
            currentStatus={status}
            statusOrder={['pending', 'in_transit', 'completed', 'cancelled']}
            onSectionNavigate={handleEnterEditMode}
          />
      )}

      {/* Completed movement notice */}
      {!isCreateMode && isCompleted && (
        <div className="mb-6 p-4 bg-stone/50 border border-lichen rounded-lg text-archive text-sm flex items-center gap-2">
          <Lock size={16} />
          This movement is completed and cannot be edited.
        </div>
      )}

      {errorMessage && (
        <div className="mb-6 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error">
          {errorMessage}
        </div>
      )}

      {/* Read-only indicator */}
      <ReadOnlyBanner visible={!isCreateMode && !canEdit} />

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={ClipboardList} />}

        {/* Object Selection */}
        <WorkspaceSection
          id="object"
          title="Object"
          icon={<Package size={18} />}
          isExpanded={expandedSections.object}
          onToggle={() => toggleSection('object')}
          isEditing={isEditing}
          order={getSectionOrder('object')}
        >
          <ObjectSelector
            organizationId={orgId!}
            objectId={formData.object_id || null}
            onChange={handleObjectChange}
            isEditing={isEditing && isCreateMode}
            label="Object"
          />
          {isEditing && isCreateMode && (
            <p className="text-xs text-archive mt-2">
              <span className="text-semantic-error">*</span> Required
            </p>
          )}
        </WorkspaceSection>

        {/* Movement Details */}
        <WorkspaceSection
          id="movement"
          title="Movement Details"
          icon={<ArrowRightLeft size={18} />}
          isExpanded={expandedSections.movement}
          onToggle={() => toggleSection('movement')}
          isEditing={isEditing}
          order={getSectionOrder('movement')}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableSelect
              label="Reason"
              value={formData.reason}
              options={MOVEMENT_REASON_OPTIONS}
              onChange={(v) => updateField('reason', v)}
              isEditing={isEditing}
              required
            />
            <EditableSelect
              label="Status"
              value={formData.status}
              options={STATUS_OPTIONS}
              onChange={(v) => updateField('status', v)}
              isEditing={isEditing}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <EditableLocationPicker
                label="From Location"
                organizationId={orgId!}
                value={formData.from_location_id || null}
                onChange={(v) => updateField('from_location_id', v || '')}
                isEditing={isEditing && !selectedObjectLocationId}
              />
              {isEditing && selectedObjectLocationId && (
                <p className="text-xs text-archive mt-1">
                  Auto-filled from object's current location
                </p>
              )}
            </div>
            <EditableLocationPicker
              label="To Location"
              organizationId={orgId!}
              value={formData.to_location_id || null}
              onChange={(v) => updateField('to_location_id', v || '')}
              isEditing={isEditing}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <EditableField
              label="Movement Date"
              value={formData.movement_date}
              onChange={(v) => updateField('movement_date', v)}
              isEditing={isEditing}
              type="date"
              required
            />
            <EditableSelect
              label="Movement Method"
              value={formData.movement_method}
              options={MOVEMENT_METHOD_OPTIONS}
              onChange={(v) => updateField('movement_method', v)}
              isEditing={isEditing}
            />
          </div>
        </WorkspaceSection>

        {/* === AUTHORIZATION GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Authorization" icon={ShieldCheck} />}

        <AuthorizationSection
          authorizerId={formData.authorizer_id}
          authorizerContact={authorizerContact}
          authorizationDate={formData.authorization_date}
          authorizationNote={formData.authorization_note}
          isExpanded={expandedSections.authorization}
          isEditing={isEditing}
          order={getSectionOrder('authorization')}
          onToggle={() => toggleSection('authorization')}
          onUpdateField={(field, value) => updateField(field === 'authorization_date' ? 'authorization_date' : field === 'authorization_note' ? 'authorization_note' : field, value)}
          onOpenAuthorizerSelector={() => setShowAuthorizerSelector(true)}
          sectionId="authorization"
          title="Authorization"
        />

        {!isCreateMode && movementId && orgId && (
          <WorkspaceSection
            id="signed-custody-transfer"
            title="Signed Custody Transfer"
            icon={<ShieldCheck size={18} />}
            isExpanded={expandedSections['signed-custody-transfer'] !== false}
            onToggle={() => toggleSection('signed-custody-transfer')}
            isEditing={isEditing}
            order={getSectionOrder('signed-custody-transfer')}
          >
            <SignedDocumentSlot
              organizationId={orgId}
              procedureType="movement"
              procedureId={movementId}
              documentType="custody_transfer"
              title="Signed custody transfer"
              helpText="Attach the signed record of the person accepting custody. This signature is required when objects change hands."
              isEditing={isEditing}
            />
          </WorkspaceSection>
        )}

        {/* === TRANSPORT GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Transport" icon={Truck} />}

        {/* Handler & Notes */}
        <WorkspaceSection
          id="handler"
          title="Handler & Notes"
          icon={<User size={18} />}
          isExpanded={expandedSections.handler}
          onToggle={() => toggleSection('handler')}
          isEditing={isEditing}
          order={getSectionOrder('handler')}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Handler
              </label>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  {formData.handler_id && handlerContact ? (
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                      <User size={16} className="text-archive flex-shrink-0" />
                      <span className="text-sm text-ink">{handlerContact.name}</span>
                      {handlerContact.organization_name && (
                        <span className="text-xs text-archive">({handlerContact.organization_name})</span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({ ...prev, handler_id: '', handler_name: '' }));
                          setHasUnsavedChanges(true);
                        }}
                        className="ml-auto p-1 text-archive hover:text-semantic-error"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowHandlerSelector(true)}
                      className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
                    >
                      <Search size={16} />
                      Search or create handler...
                    </button>
                  )}
                  {formData.handler_id && (
                    <button
                      type="button"
                      onClick={() => setShowHandlerSelector(true)}
                      className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                    >
                      Change
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-sm text-ink">
                  {handlerContact ? (
                    <span>
                      {handlerContact.name}
                      {handlerContact.organization_name && (
                        <span className="text-archive ml-1">({handlerContact.organization_name})</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-archive">Not specified</span>
                  )}
                </div>
              )}
            </div>

            <EditableField
              label="Notes"
              value={formData.movement_note}
              onChange={(v) => updateField('movement_note', v)}
              isEditing={isEditing}
              multiline
              placeholder="Additional notes about this movement"
            />
          </div>
        </WorkspaceSection>

        {/* Shipments — link to existing Shipment records */}
        {!isCreateMode && movementId && (
          <WorkspaceSection
            id="shipping"
            title="Shipments"
            icon={<Truck size={18} />}
            isExpanded={expandedSections.shipping}
            onToggle={() => toggleSection('shipping')}
            isEditing={isEditing}
            order={getSectionOrder('shipping')}
          >
            <ShipmentLinker
              organizationId={orgId!}
              procedureType="movement"
              procedureId={movementId}
              isEditing={isEditing}
            />
          </WorkspaceSection>
        )}

        {/* === CONDITION & PLANNING GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Condition & Planning" icon={FileCheck} />}

        {/* Condition */}
        <WorkspaceSection
          id="condition"
          title="Condition"
          icon={<FileCheck size={18} />}
          isExpanded={expandedSections.condition}
          onToggle={() => toggleSection('condition')}
          isEditing={isEditing}
          order={getSectionOrder('condition')}
        >
          <div className="space-y-4">
            {formData.object_id && orgId ? (
              <ConditionReportLinker
                organizationId={orgId}
                objectId={formData.object_id}
                isEditing={isEditing}
              />
            ) : (
              <p className="text-sm text-archive italic text-center py-4">
                Select an object to see condition reports.
              </p>
            )}

            <EditableField
              label="Condition Note"
              value={formData.condition_note}
              onChange={(v) => updateField('condition_note', v)}
              isEditing={isEditing}
              multiline
              placeholder="Quick note on object condition at time of movement"
            />
          </div>
        </WorkspaceSection>

        {/* Planning */}
        <WorkspaceSection
          id="planning"
          title="Planning"
          icon={<Calendar size={18} />}
          isExpanded={expandedSections.planning}
          onToggle={() => toggleSection('planning')}
          isEditing={isEditing}
          order={getSectionOrder('planning')}
        >
          <div className="space-y-4">
            <EditableSelect
              label="Location Fitness"
              value={formData.location_fitness}
              options={LOCATION_FITNESS_OPTIONS}
              onChange={(v) => updateField('location_fitness', v)}
              isEditing={isEditing}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <EditableField
                label="Planned Removal Date"
                value={formData.planned_removal_date}
                onChange={(v) => updateField('planned_removal_date', v)}
                isEditing={isEditing}
                type="date"
              />
              <EditableField
                label="Planned Return Date"
                value={formData.planned_return_date}
                onChange={(v) => updateField('planned_return_date', v)}
                isEditing={isEditing}
                type="date"
              />
            </div>
          </div>
        </WorkspaceSection>

        {/* === HISTORY GROUP === */}
        {useNewLayout && <SectionGroupDivider label="History" icon={History} />}

        {/* Change History */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && movementId && (
          <WorkspaceSection
            id="history"
            title="Change History"
            icon={<History size={20} />}
            isExpanded={expandedSections.history}
            onToggle={() => toggleSection('history')}
            isEditing={isEditing}
            order={getSectionOrder('history')}
          >
            <RecordAuditHistory
              organizationId={orgId}
              entityType="movement"
              entityId={movementId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata */}
      {!isCreateMode && existingMovement && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(existingMovement.created_at)}</p>
        </div>
      )}

      {/* Dialogs */}
      <ConfirmDialog
        isOpen={dialogs.showDeleteConfirm}
        onClose={() => dialogs.setShowDeleteConfirm(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete Movement Record"
        message={<>Are you sure you want to delete <strong>{displayNumber || 'this movement record'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      <ContactSelectorSlideOver
        isOpen={showHandlerSelector}
        organizationId={orgId!}
        onClose={() => setShowHandlerSelector(false)}
        onSelect={(contactId) => {
          setFormData(prev => ({ ...prev, handler_id: contactId }));
          setHasUnsavedChanges(true);
          setShowHandlerSelector(false);
        }}
        title="Select Handler"
        subtitle="Search for an existing contact or create a new one"
        constituentTypes={['person']}
      />

      <ContactSelectorSlideOver
        isOpen={showAuthorizerSelector}
        organizationId={orgId!}
        onClose={() => setShowAuthorizerSelector(false)}
        onSelect={(contactId) => {
          updateField('authorizer_id', contactId);
          setShowAuthorizerSelector(false);
        }}
        title="Select Authorizer"
        subtitle="Search for the person who authorized this movement"
        constituentTypes={['person']}
      />

      {orgId && movementId && existingMovement && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"movement" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={movementId}
          initialEntityLabel={existingMovement.movement_reference_number || `Movement ${movementId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // Return with new layout wrapper for existing movements
  if (useNewLayout && existingMovement) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/movements`}
        backLabel="Back to Movements"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={MOVEMENT_SECTION_GROUPS}
          sectionData={sectionData}
          permissions={{
            canCreateTask: true,
            canViewHistory: true,
            canDelete: !isCompleted,
          }}
          callbacks={{
            onDelete: () => dialogs.setShowDeleteConfirm(true),
            onCreateTask: () => dialogs.setShowCreateTask(true),
          }}
          isEditing={isEditing}
          onSectionNavigate={handleEnterEditMode}
          pageType="movement"
          enabled={true}
          showHeader={true}
          title="Movement"
          objectNumber={displayNumber || undefined}
          subtitle={MOVEMENT_REASON_OPTIONS.find(t => t.value === existingMovement?.reason)?.label}
          backUrl={`/organizations/${orgId}/collections/movements`}
          backLabel="Back to Movements"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/movements` : undefined}
      backLabel="Back to Movements"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
