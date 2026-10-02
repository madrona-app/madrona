import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatDateTime } from '@/lib/formatters';
import {
  Scale,
  User,
  Calendar,
  FileSignature,
  DollarSign,
  AlertTriangle,
  FileText,
  X,
  Link as LinkIcon,
  History,
} from 'lucide-react';
import {
  getRight,
  getContact,
} from '../../../lib/api';
import { ContactSelectorSlideOver } from '../../../components/collections/ConstituentSelectorSlideOver';
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
import ConfirmDialog from '../../../components/ConfirmDialog';
import { ObjectSelector } from '../../../components/collections/ObjectSelector';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  RIGHT_SECTION_GROUPS,
  ALL_SECTION_IDS,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

/**
 * Outer wrapper that provides section order context.
 */
export default function RightWorkspacePage() {
  return (
    <SectionOrderProvider>
      <RightWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function RightWorkspacePageContent() {
  const { orgId, rightId, objectId: urlObjectId } = useParams<{
    orgId: string;
    rightId?: string;
    objectId?: string;
  }>();

  const [showContactSelector, setShowContactSelector] = useState(false);

  // Fetch right data (disabled in create mode)
  const isCreateMode = !rightId;
  const { data: existingRight, isLoading, error } = useQuery({
    queryKey: ['right', orgId, rightId],
    queryFn: () => getRight(orgId!, rightId!),
    enabled: !isCreateMode && !!orgId && !!rightId,
  });

  const rightRecord = existingRight as Record<string, unknown> | undefined;

  const wp = useWorkspacePage({
    entityType: 'right',
    entityId: rightId,
    entityLabel: rightRecord ? ((rightRecord.right_type as string) || `Right ${rightId!.slice(0, 8)}`) : undefined,
    orgId,
    editPermission: 'rights.edit',
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  const form = useFormState({
    orgId,
    rightId,
    isCreateMode,
    right: rightRecord,
  });

  const {
    formData,
    updateField,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    errorMessage,
    queryClient,
    triggerSave,
    handleCreate,
    deleteMutation,
    getLookup,
    getLabel,
  } = form;

  // Set initial object_id from URL parameter
  useEffect(() => {
    if (urlObjectId && isCreateMode && !formData.object_id) {
      updateField('object_id', urlObjectId);
    }
  }, [urlObjectId, isCreateMode, formData.object_id, updateField]);

  // Fetch rights holder contact details
  const { data: rightsHolderContact } = useQuery({
    queryKey: ['contact', orgId, formData.rights_holder_contact_id],
    queryFn: () => getContact(orgId!, formData.rights_holder_contact_id),
    enabled: !!orgId && !!formData.rights_holder_contact_id,
  });

  const sectionState = useSectionState({
    orgId,
    rightId,
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

  const sectionSummaries = useSectionSummaries(formData);
  const hasContent = useHasContent(formData);

  // Compute sectionData for nav completeness indicators
  const sectionData: Record<string, unknown> = {
    object: {
      object_id: formData.object_id,
    },
    details: {
      right_type: formData.right_type,
      status: formData.status,
    },
    holder: {
      rights_holder_contact_id: formData.rights_holder_contact_id,
    },
    duration: {
      start_date: formData.start_date,
      end_date: formData.end_date,
      territory: formData.territory,
    },
    license: {
      license_type: formData.license_type,
      license_reference: formData.license_reference,
    },
    fees: {
      fee_required: formData.fee_required,
      fee_amount: formData.fee_amount,
    },
    orphan: {
      is_orphan_work: formData.is_orphan_work,
    },
    notes: {
      right_note: formData.right_note,
      agreement_reference: formData.agreement_reference,
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
  if (!isCreateMode && !isLoading && (error || !existingRight)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <Scale size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Right not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The rights record could not be loaded.'}
        </p>
      </div>
    );
  }

  const displayNumber = isCreateMode ? '' : ((rightRecord?.right_id as string)?.slice(0, 8) || '');
  const displayTitle = isCreateMode
    ? 'New Rights Record'
    : getLabel('right_type', (rightRecord?.right_type as string) || '');

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/rights`}
          backText="Back to Rights"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Right"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Edit mode indicator */}

      {/* Status bar & delete - only in view/edit mode, not create mode */}
      {!isCreateMode && rightRecord && (
        <div className="flex items-center gap-4 mb-6">
          <span className={cn(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium',
            rightRecord.status === 'owned' || rightRecord.status === 'licensed' ? 'bg-semantic-success/10 text-semantic-success' :
            rightRecord.status === 'public_domain' ? 'bg-forest/10 text-forest' :
            rightRecord.status === 'denied' || rightRecord.status === 'disputed' ? 'bg-semantic-error/10 text-semantic-error' :
            rightRecord.status === 'requested' ? 'bg-semantic-warning/10 text-semantic-warning' :
            'bg-stone text-archive'
          )}>
            <Scale size={16} />
            {getLabel('right_status', rightRecord.status as string)}
          </span>
          {Boolean(rightRecord.object_title) && (
            <span className="text-sm text-archive">
              {rightRecord.object_title as string}
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
        {useNewLayout && <SectionGroupDivider label="Overview" icon={Scale} />}

        {/* Object Selection */}
        <WorkspaceSection
          id="object"
          title="Linked Object"
          icon={<LinkIcon size={18} />}
          isExpanded={expandedSections.object}
          onToggle={() => toggleSection('object')}
          isEditing={isEditing}
          order={getSectionOrder('object')}
          isEmpty={!hasContent.object}
          summary={sectionSummaries.object}
        >
          <ObjectSelector
            organizationId={orgId!}
            objectId={formData.object_id || null}
            onChange={(id) => updateField('object_id', id || '')}
            isEditing={isEditing && isCreateMode}
            label="Object"
          />
          {isEditing && isCreateMode && (
            <p className="text-xs text-archive mt-2">
              <span className="text-semantic-error">*</span> Required
            </p>
          )}
        </WorkspaceSection>

        {/* Right Details */}
        <WorkspaceSection
          id="details"
          title="Right Details"
          icon={<Scale size={18} />}
          isExpanded={expandedSections.details}
          onToggle={() => toggleSection('details')}
          isEditing={isEditing}
          order={getSectionOrder('details')}
          isEmpty={!hasContent.details}
          summary={sectionSummaries.details}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableSelect
              label="Right Type"
              value={formData.right_type}
              isEditing={isEditing}
              onChange={(v) => updateField('right_type', v)}
              options={getLookup('right_type')}
              required
            />
            <EditableField
              label="Subtype"
              value={formData.right_subtype}
              isEditing={isEditing}
              onChange={(v) => updateField('right_subtype', v)}
              placeholder="e.g., Digital reproduction"
            />
            <EditableSelect
              label="Status"
              value={formData.status}
              isEditing={isEditing}
              onChange={(v) => updateField('status', v)}
              options={getLookup('right_status')}
              required
              className="md:col-span-2"
            />
          </div>
        </WorkspaceSection>

        {/* === PARTIES & DURATION GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Parties & Duration" icon={User} />}

        {/* Rights Holder */}
        <WorkspaceSection
          id="holder"
          title="Rights Holder"
          icon={<User size={18} />}
          isExpanded={expandedSections.holder}
          onToggle={() => toggleSection('holder')}
          isEditing={isEditing}
          order={getSectionOrder('holder')}
          isEmpty={!hasContent.holder}
          summary={sectionSummaries.holder}
        >
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Rights Holder Contact
            </label>
            {formData.rights_holder_contact_id && rightsHolderContact ? (
              <div className="flex items-center justify-between p-3 bg-stone/30 rounded-lg">
                <div>
                  <p className="font-medium text-ink">{rightsHolderContact.name}</p>
                  {rightsHolderContact.organization_name && (
                    <p className="text-sm text-archive">{rightsHolderContact.organization_name}</p>
                  )}
                  {rightsHolderContact.email && (
                    <p className="text-sm text-archive">{rightsHolderContact.email}</p>
                  )}
                </div>
                {isEditing && (
                  <button
                    type="button"
                    onClick={() => updateField('rights_holder_contact_id', '')}
                    className="text-archive hover:text-ink"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            ) : isEditing ? (
              <button
                type="button"
                onClick={() => setShowContactSelector(true)}
                className="w-full p-3 border border-dashed border-lichen rounded-lg text-archive hover:border-bark hover:text-ink transition-colors"
              >
                + Select Rights Holder
              </button>
            ) : (
              <p className="text-archive">No rights holder assigned</p>
            )}
          </div>
        </WorkspaceSection>

        {/* Duration & Territory */}
        <WorkspaceSection
          id="duration"
          title="Duration & Territory"
          icon={<Calendar size={18} />}
          isExpanded={expandedSections.duration}
          onToggle={() => toggleSection('duration')}
          isEditing={isEditing}
          order={getSectionOrder('duration')}
          isEmpty={!hasContent.duration}
          summary={sectionSummaries.duration}
        >
          <div className="space-y-4">
            <EditableCheckbox
              label="Perpetual (no expiration)"
              value={formData.is_perpetual}
              isEditing={isEditing}
              onChange={(v) => updateField('is_perpetual', v)}
            />

            {!formData.is_perpetual && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <EditableField
                  label="Start Date"
                  value={formData.start_date}
                  isEditing={isEditing}
                  onChange={(v) => updateField('start_date', v)}
                  type="date"
                />
                <EditableField
                  label="End Date"
                  value={formData.end_date}
                  isEditing={isEditing}
                  onChange={(v) => updateField('end_date', v)}
                  type="date"
                />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <EditableField
                label="Territory"
                value={formData.territory}
                isEditing={isEditing}
                onChange={(v) => updateField('territory', v)}
                placeholder="e.g., Worldwide, UK, EU"
              />
              <EditableField
                label="Next Review Date"
                value={formData.next_review_date}
                isEditing={isEditing}
                onChange={(v) => updateField('next_review_date', v)}
                type="date"
              />
            </div>
          </div>
        </WorkspaceSection>

        {/* === LICENSING & FEES GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Licensing & Fees" icon={FileSignature} />}

        {/* License Details */}
        <WorkspaceSection
          id="license"
          title="License Details"
          icon={<FileSignature size={18} />}
          isExpanded={expandedSections.license}
          onToggle={() => toggleSection('license')}
          isEditing={isEditing}
          order={getSectionOrder('license')}
          isEmpty={!hasContent.license}
          summary={sectionSummaries.license}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableSelect
              label="License Type"
              value={formData.license_type}
              isEditing={isEditing}
              onChange={(v) => updateField('license_type', v)}
              options={getLookup('license_type')}
            />
            <EditableField
              label="License Reference"
              value={formData.license_reference}
              isEditing={isEditing}
              onChange={(v) => updateField('license_reference', v)}
              placeholder="License ID or agreement number"
            />
            <EditableField
              label="License URL"
              value={formData.license_url}
              isEditing={isEditing}
              onChange={(v) => updateField('license_url', v)}
              placeholder="https://..."
              className="md:col-span-2"
            />
            <EditableField
              label="Usage Conditions"
              value={formData.usage_conditions}
              isEditing={isEditing}
              onChange={(v) => updateField('usage_conditions', v)}
              multiline
              rows={3}
              placeholder="Terms and conditions for use..."
              className="md:col-span-2"
            />
            <EditableField
              label="Restrictions"
              value={formData.restrictions}
              isEditing={isEditing}
              onChange={(v) => updateField('restrictions', v)}
              multiline
              rows={2}
              placeholder="Any restrictions on use..."
              className="md:col-span-2"
            />
          </div>
        </WorkspaceSection>

        {/* Fees */}
        <WorkspaceSection
          id="fees"
          title="Fees"
          icon={<DollarSign size={18} />}
          isExpanded={expandedSections.fees}
          onToggle={() => toggleSection('fees')}
          isEditing={isEditing}
          order={getSectionOrder('fees')}
          isEmpty={!hasContent.fees}
          summary={sectionSummaries.fees}
        >
          <div className="space-y-4">
            <EditableCheckbox
              label="Fee required for use"
              value={formData.fee_required}
              isEditing={isEditing}
              onChange={(v) => updateField('fee_required', v)}
            />

            {formData.fee_required && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <EditableField
                  label="Fee Amount"
                  value={formData.fee_amount}
                  isEditing={isEditing}
                  onChange={(v) => updateField('fee_amount', v)}
                  type="number"
                  placeholder="0.00"
                />
                <EditableSelect
                  label="Currency"
                  value={formData.fee_currency}
                  isEditing={isEditing}
                  onChange={(v) => updateField('fee_currency', v)}
                  options={getLookup('currency')}
                />
                <EditableField
                  label="Fee Note"
                  value={formData.fee_note}
                  isEditing={isEditing}
                  onChange={(v) => updateField('fee_note', v)}
                  placeholder="Additional fee details..."
                  className="md:col-span-2"
                />
              </div>
            )}
          </div>
        </WorkspaceSection>

        {/* === COMPLIANCE & NOTES GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Compliance & Notes" icon={AlertTriangle} />}

        {/* Orphan Works */}
        <WorkspaceSection
          id="orphan"
          title="Orphan Works (UK Compliance)"
          icon={<AlertTriangle size={18} />}
          isExpanded={expandedSections.orphan}
          onToggle={() => toggleSection('orphan')}
          isEditing={isEditing}
          order={getSectionOrder('orphan')}
          isEmpty={!hasContent.orphan}
          summary={sectionSummaries.orphan}
        >
          <div className="space-y-4">
            <EditableCheckbox
              label="This is an orphan work (rights holder unknown/unlocatable)"
              value={formData.is_orphan_work}
              isEditing={isEditing}
              onChange={(v) => updateField('is_orphan_work', v)}
            />

            {formData.is_orphan_work && (
              <>
                <div className="p-3 bg-semantic-warning/10 rounded-lg text-sm text-semantic-warning">
                  <p className="font-medium mb-1">Due Diligence Required</p>
                  <p>UK law requires diligent search before using orphan works.</p>
                </div>

                <EditableCheckbox
                  label="Due diligence search conducted"
                  value={formData.due_diligence_conducted}
                  isEditing={isEditing}
                  onChange={(v) => updateField('due_diligence_conducted', v)}
                />

                {formData.due_diligence_conducted && (
                  <EditableField
                    label="Due Diligence Date"
                    value={formData.due_diligence_date}
                    isEditing={isEditing}
                    onChange={(v) => updateField('due_diligence_date', v)}
                    type="date"
                  />
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <EditableField
                    label="License Number"
                    value={formData.orphan_works_license_number}
                    isEditing={isEditing}
                    onChange={(v) => updateField('orphan_works_license_number', v)}
                    placeholder="IPO reference"
                  />
                  <EditableField
                    label="License Date"
                    value={formData.orphan_works_license_date}
                    isEditing={isEditing}
                    onChange={(v) => updateField('orphan_works_license_date', v)}
                    type="date"
                  />
                  <EditableField
                    label="License Expiry"
                    value={formData.orphan_works_license_expiry}
                    isEditing={isEditing}
                    onChange={(v) => updateField('orphan_works_license_expiry', v)}
                    type="date"
                  />
                </div>
              </>
            )}
          </div>
        </WorkspaceSection>

        {/* Documentation & Notes */}
        <WorkspaceSection
          id="notes"
          title="Documentation & Notes"
          icon={<FileText size={18} />}
          isExpanded={expandedSections.notes}
          onToggle={() => toggleSection('notes')}
          isEditing={isEditing}
          order={getSectionOrder('notes')}
          isEmpty={!hasContent.notes}
          summary={sectionSummaries.notes}
        >
          <div className="grid grid-cols-1 gap-4">
            <EditableField
              label="Agreement Reference"
              value={formData.agreement_reference}
              isEditing={isEditing}
              onChange={(v) => updateField('agreement_reference', v)}
              placeholder="Contract or agreement reference number"
            />
            <EditableField
              label="Notes"
              value={formData.right_note}
              isEditing={isEditing}
              onChange={(v) => updateField('right_note', v)}
              multiline
              rows={3}
              placeholder="General notes about this right..."
            />
            <EditableField
              label="Internal Notes"
              value={formData.internal_note}
              isEditing={isEditing}
              onChange={(v) => updateField('internal_note', v)}
              multiline
              rows={2}
              placeholder="Internal staff notes (not for public display)..."
            />
          </div>
        </WorkspaceSection>

        {/* Change History */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && rightId && (
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
              entityType="object_right"
              entityId={rightId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata - only in view/edit mode, not create mode */}
      {!isCreateMode && rightRecord && (rightRecord.created_at as string) && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(rightRecord.created_at as string)}</p>
          {Boolean(rightRecord.updated_at) && (
            <p>Last updated: {formatDateTime(rightRecord.updated_at as string)}</p>
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
        title="Delete Rights Record"
        message={<>Are you sure you want to delete <strong>{formData.right_type || 'this rights record'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* Rights Holder Contact Selector */}
      <ContactSelectorSlideOver
        isOpen={showContactSelector}
        organizationId={orgId!}
        onClose={() => setShowContactSelector(false)}
        onSelect={(contactId) => {
          updateField('rights_holder_contact_id', contactId);
          setShowContactSelector(false);
        }}
        title="Select Rights Holder"
        subtitle="Search for an existing contact or create a new one"
        constituentTypes={['person', 'organization', 'estate']}
      />

      {/* CreateTaskSlideOver */}
      {orgId && rightId && rightRecord && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"object_right" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={rightId}
          initialEntityLabel={getLabel('right_type', (rightRecord.right_type as string) || '') || `Right ${rightId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && rightRecord) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/rights`}
        backLabel="Back to Rights"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={RIGHT_SECTION_GROUPS}
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
          pageType="right"
          enabled={true}
          showHeader={true}
          title="Right"
          objectNumber={displayNumber}
          subtitle={displayTitle}
          backUrl={`/organizations/${orgId}/collections/rights`}
          backLabel="Back to Rights"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/rights` : undefined}
      backLabel="Back to Rights"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
