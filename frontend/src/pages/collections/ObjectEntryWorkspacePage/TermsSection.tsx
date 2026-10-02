/**
 * Terms & Conditions Section
 *
 * Displays and edits terms acceptance for procedure compliance.
 */

import { CheckCircle } from 'lucide-react';
import { WorkspaceSection } from '../../../components/workspace';
import { SectionCompletionBadge } from '../../../components/collections/SectionCompletionBadge';
import { TermsAcceptancePanel } from '../../../components/collections/TermsAcceptancePanel';
import { SignedDocumentSlot } from '../../../components/collections/SignedDocumentSlot';
import type { TermsSectionProps } from './types';

export function TermsSection({
  formData,
  updateField,
  isExpanded,
  onToggle,
  isEditing,
  isCreateMode,
  getSectionOrder,
  sectionCompletion,
  orgId,
  entryId,
  onGenerateReceipt,
  isGeneratingReceipt,
}: TermsSectionProps) {
  return (
    <WorkspaceSection
      id="terms-acceptance"
      title="Terms & Conditions"
      icon={<CheckCircle size={20} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={getSectionOrder('terms-acceptance')}
      badge={!isCreateMode && sectionCompletion ? <SectionCompletionBadge completion={sectionCompletion} /> : undefined}
    >
      <div className="space-y-6">
        <TermsAcceptancePanel
          data={{
            termsAccepted: formData.terms_accepted || false,
            acceptedDate: formData.terms_accepted_date || '',
            acceptedById: formData.terms_accepted_by_id || '',
            signatureReference: '',
            acceptanceMethod: (formData.acceptance_method || 'signature') as 'email' | 'signature' | 'online' | 'verbal',
            acceptanceNote: formData.acceptance_note || '',
          }}
          onChange={(updates) => {
            // Map TermsAcceptancePanel field names to our form field names
            if ('termsAccepted' in updates) updateField('terms_accepted', updates.termsAccepted);
            if ('acceptedDate' in updates) updateField('terms_accepted_date', updates.acceptedDate);
            if ('acceptedById' in updates) updateField('terms_accepted_by_id', updates.acceptedById);
            if ('acceptanceMethod' in updates) updateField('acceptance_method', updates.acceptanceMethod);
            if ('acceptanceNote' in updates) updateField('acceptance_note', updates.acceptanceNote);
          }}
          isEditing={isEditing}
          organizationId={orgId!}
          entryId={entryId}
          onGenerateReceipt={onGenerateReceipt}
          isGeneratingReceipt={isGeneratingReceipt}
        />

        {/* Signed entry form attachment — Object Entry requires
            a signature from the owner/depositor and the entry manager, usually
            captured by signing the entry form itself. */}
        {!isCreateMode && entryId && (
          <div className="pt-4 border-t border-lichen">
            <SignedDocumentSlot
              organizationId={orgId!}
              procedureType="object_entry"
              procedureId={entryId}
              documentType="entry_form"
              title="Signed entry form"
              helpText="Attach the signed (scanned) entry form. Paper-only workflows are supported — use the reference field for a paper file locator if you're not uploading a scan."
              isEditing={isEditing}
              onGenerateUnsigned={onGenerateReceipt}
              isGeneratingUnsigned={isGeneratingReceipt}
              generateUnsignedLabel="Generate entry receipt"
            />
          </div>
        )}
      </div>
    </WorkspaceSection>
  );
}
