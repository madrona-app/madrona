import { FileText, User, MessageSquare } from 'lucide-react';
import {
  WorkspaceSection,
  EditableField,
} from '../../../components/workspace';
import { RecordDiscussionTab } from '../../../components/RecordDiscussionTab';
import { SignedDocumentSlot } from '../../../components/collections/SignedDocumentSlot';
import type { FormData } from './types';

interface DocumentationSectionProps {
  orgId: string;
  loanId: string | undefined;
  formData: FormData;
  isEditing: boolean;
  isCreateMode: boolean;
  expandedSections: Record<string, boolean>;
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  toggleSection: (sectionId: string) => void;
  getSectionOrder: (sectionId: string) => number | undefined;
}

export function DocumentationSection({
  orgId,
  loanId,
  formData,
  isEditing,
  isCreateMode,
  expandedSections,
  updateField,
  toggleSection,
  getSectionOrder,
}: DocumentationSectionProps) {
  return (
    <>
      {/* Loan Agreement */}
      <WorkspaceSection
        id="agreement"
        title="Loan Agreement"
        icon={<FileText size={20} />}
        isExpanded={expandedSections.agreement}
        onToggle={() => toggleSection('agreement')}
        isEditing={isEditing}
        order={getSectionOrder('agreement')}
      >
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-6">
            <EditableField
              value={formData.loan_agreement_reference}
              label="Agreement Reference"
              isEditing={isEditing}
              onChange={(v) => updateField('loan_agreement_reference', v)}
              placeholder="Agreement number"
            />
            <EditableField
              value={formData.loan_agreement_date}
              label="Agreement Date"
              isEditing={isEditing}
              onChange={(v) => updateField('loan_agreement_date', v)}
              type="date"
            />
            <EditableField
              value={formData.loan_agreement_signed_date}
              label="Date Signed"
              isEditing={isEditing}
              onChange={(v) => updateField('loan_agreement_signed_date', v)}
              type="date"
            />
          </div>
          {!isCreateMode && loanId && (
            <div className="pt-4 border-t border-lichen">
              <SignedDocumentSlot
                organizationId={orgId}
                procedureType="loan_in"
                procedureId={loanId}
                documentType="loan_agreement"
                title="Signed loan agreement"
                helpText="Attach signed loan agreements and amendments. Both parties' signatures are required."
                isEditing={isEditing}
              />
            </div>
          )}
        </div>
      </WorkspaceSection>

      {/* Document Location - Procedure Compliance */}
      <WorkspaceSection
        id="document-location"
        title="Document Location"
        icon={<FileText size={20} />}
        isExpanded={expandedSections['document-location']}
        onToggle={() => toggleSection('document-location')}
        isEditing={isEditing}
        order={getSectionOrder('document-location')}
      >
        <div className="mb-4 p-3 bg-stone/50 rounded-lg border border-bark/10">
          <p className="text-sm text-archive">
            <strong>Required:</strong> Record the physical location of the loan file
            so that you and others can find it in future.
          </p>
        </div>
        <div className="space-y-6">
          <EditableField
            value={formData.document_location}
            label="File Location"
            isEditing={isEditing}
            onChange={(v) => updateField('document_location', v)}
            placeholder="e.g., Filing Cabinet A, Drawer 3, or Digital: S:/Loans/2026/"
          />
          <EditableField
            value={formData.document_location_note}
            label="Location Notes"
            isEditing={isEditing}
            onChange={(v) => updateField('document_location_note', v)}
            multiline
            rows={2}
            placeholder="Additional notes about file contents or organization..."
          />
        </div>
      </WorkspaceSection>

      {/* Loan Contact - Procedure Compliance */}
      <WorkspaceSection
        id="loan-contact"
        title="Internal Loan Contact"
        icon={<User size={20} />}
        isExpanded={expandedSections['loan-contact']}
        onToggle={() => toggleSection('loan-contact')}
        isEditing={isEditing}
        order={getSectionOrder('loan-contact')}
      >
        <div className="mb-4 p-3 bg-stone/50 rounded-lg border border-bark/10">
          <p className="text-sm text-archive">
            <strong>Required:</strong> Record the person responsible for managing
            this loan on your behalf (the primary contact for correspondence).
          </p>
        </div>
        <div className="grid grid-cols-3 gap-6">
          <EditableField
            value={formData.loan_contact_name}
            label="Contact Name"
            isEditing={isEditing}
            onChange={(v) => updateField('loan_contact_name', v)}
            placeholder="Name of loan manager"
          />
          <EditableField
            value={formData.loan_contact_email}
            label="Contact Email"
            isEditing={isEditing}
            onChange={(v) => updateField('loan_contact_email', v)}
            type="email"
            placeholder="email@example.com"
          />
          <EditableField
            value={formData.loan_contact_phone}
            label="Contact Phone"
            isEditing={isEditing}
            onChange={(v) => updateField('loan_contact_phone', v)}
            placeholder="+1 234 567 8900"
          />
        </div>
      </WorkspaceSection>

      {/* Notes */}
      <WorkspaceSection
        id="notes"
        title="Notes"
        icon={<FileText size={20} />}
        isExpanded={expandedSections.notes}
        onToggle={() => toggleSection('notes')}
        isEditing={isEditing}
        order={getSectionOrder('notes')}
      >
        <div className="space-y-6">
          <EditableField
            value={formData.loan_note}
            label="Loan Notes"
            isEditing={isEditing}
            onChange={(v) => updateField('loan_note', v)}
            multiline
            rows={4}
            placeholder="General notes about this loan..."
          />
          <EditableField
            value={formData.internal_note}
            label="Internal Notes"
            isEditing={isEditing}
            onChange={(v) => updateField('internal_note', v)}
            multiline
            rows={3}
            placeholder="Staff-only notes (not shared with lender)..."
          />
        </div>
      </WorkspaceSection>

      {/* Discussion Section - only in view/edit mode, not create mode */}
      {!isCreateMode && loanId && (
        <WorkspaceSection
          id="discussion"
          title="Discussion"
          icon={<MessageSquare size={20} />}
          isExpanded={expandedSections.discussion}
          onToggle={() => toggleSection('discussion')}
          isEditing={isEditing}
          order={getSectionOrder('discussion')}
        >
          <RecordDiscussionTab
            entityType="loan_in"
            entityId={loanId}
            organizationId={orgId}
          />
        </WorkspaceSection>
      )}
    </>
  );
}
