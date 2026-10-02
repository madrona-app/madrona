import { FileSignature } from 'lucide-react';
import { WorkspaceSection, EditableField } from '../../../components/workspace';
import { SignedDocumentSlot } from '../../../components/collections/SignedDocumentSlot';
import type { FormData } from './types';

interface AgreementSectionProps {
  formData: FormData;
  isExpanded: boolean;
  isEditing: boolean;
  order: number | undefined;
  onToggle: () => void;
  onUpdateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  onFieldBlur: () => void;
  organizationId: string;
  loanId?: string;
}

export function AgreementSection({
  formData,
  isExpanded,
  isEditing,
  order,
  onToggle,
  onUpdateField,
  onFieldBlur,
  organizationId,
  loanId,
}: AgreementSectionProps) {
  return (
    <WorkspaceSection
      id="agreement"
      title="Loan Agreement"
      icon={<FileSignature size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <EditableField
            label="Agreement Reference"
            value={formData.loan_agreement_reference}
            isEditing={isEditing}
            onChange={(v) => onUpdateField('loan_agreement_reference', v)}
            onSave={onFieldBlur}
          />
          <EditableField
            label="Signed Date"
            value={formData.loan_agreement_signed_date}
            isEditing={isEditing}
            onChange={(v) => onUpdateField('loan_agreement_signed_date', v)}
            onSave={onFieldBlur}
            type="date"
          />
          <EditableField
            label="Document location"
            value={formData.document_location}
            isEditing={isEditing}
            onChange={(v) => onUpdateField('document_location', v)}
            onSave={onFieldBlur}
            helpText="Where the physical loan file and related documents are stored"
            className="md:col-span-2"
          />
        </div>

        {loanId && (
          <div className="pt-4 border-t border-lichen">
            <SignedDocumentSlot
              organizationId={organizationId}
              procedureType="loan_out"
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
  );
}
