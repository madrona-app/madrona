import { Building2, User, Search, X } from 'lucide-react';
import { WorkspaceSection, EditableField } from '../../../components/workspace';
import type { FormData, Contact } from './types';

interface BorrowerSectionProps {
  formData: FormData;
  borrowerContact: Contact | undefined;
  borrowerContactPerson: Contact | undefined;
  isExpanded: boolean;
  isEditing: boolean;
  order: number | undefined;
  onToggle: () => void;
  onUpdateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  onFieldBlur: () => void;
  onOpenSelector: () => void;
  onOpenContactPersonSelector: () => void;
  isRestricted: (field: string) => boolean;
}

export function BorrowerSection({
  formData,
  borrowerContact,
  borrowerContactPerson,
  isExpanded,
  isEditing,
  order,
  onToggle,
  onUpdateField,
  onFieldBlur,
  onOpenSelector,
  onOpenContactPersonSelector,
  isRestricted,
}: BorrowerSectionProps) {
  return (
    <WorkspaceSection
      id="borrower"
      title="Borrower Information"
      icon={<Building2 size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
    >
      <div className="space-y-4">
        {/* Borrowing Institution */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Borrowing Institution <span className="text-semantic-error">*</span>
            </label>
            {isEditing ? (
              <div className="flex items-center gap-2">
                {formData.borrower_id && borrowerContact ? (
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                    <Building2 size={16} className="text-archive flex-shrink-0" />
                    <span className="text-sm text-ink">{borrowerContact.name}</span>
                    {borrowerContact.organization_name && (
                      <span className="text-xs text-archive">({borrowerContact.organization_name})</span>
                    )}
                    <button
                      type="button"
                      onClick={() => onUpdateField('borrower_id', '')}
                      className="ml-auto p-1 text-archive hover:text-semantic-error"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={onOpenSelector}
                    className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
                  >
                    <Search size={16} />
                    Search or create borrowing institution...
                  </button>
                )}
                {formData.borrower_id && (
                  <button
                    type="button"
                    onClick={onOpenSelector}
                    className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <div className="text-sm text-ink">
                {borrowerContact ? (
                  <span>
                    {borrowerContact.name}
                    {borrowerContact.organization_name && (
                      <span className="text-archive ml-1">({borrowerContact.organization_name})</span>
                    )}
                  </span>
                ) : (
                  <span className="text-archive">Not specified</span>
                )}
              </div>
            )}
          </div>

          {/* Borrower Status */}
          <EditableField
            label="Borrower Status"
            value={formData.borrower_status}
            isEditing={isEditing}
            onChange={(v) => onUpdateField('borrower_status', v)}
            onSave={onFieldBlur}
          />

          {/* Contact Person at Borrowing Institution */}
          {!isRestricted('borrower_contact') && (
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Contact Person
            </label>
            {isEditing ? (
              <div className="flex items-center gap-2">
                {formData.borrower_contact_id && borrowerContactPerson ? (
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                    <User size={16} className="text-archive flex-shrink-0" />
                    <span className="text-sm text-ink">{borrowerContactPerson.name}</span>
                    {borrowerContactPerson.organization_name && (
                      <span className="text-xs text-archive">({borrowerContactPerson.organization_name})</span>
                    )}
                    <button
                      type="button"
                      onClick={() => onUpdateField('borrower_contact_id', '')}
                      className="ml-auto p-1 text-archive hover:text-semantic-error"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={onOpenContactPersonSelector}
                    className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
                  >
                    <Search size={16} />
                    Search or create contact person...
                  </button>
                )}
                {formData.borrower_contact_id && (
                  <button
                    type="button"
                    onClick={onOpenContactPersonSelector}
                    className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <div className="text-sm text-ink">
                {borrowerContactPerson ? (
                  <span>
                    {borrowerContactPerson.name}
                    {borrowerContactPerson.organization_name && (
                      <span className="text-archive ml-1">({borrowerContactPerson.organization_name})</span>
                    )}
                  </span>
                ) : (
                  <span className="text-archive">Not specified</span>
                )}
              </div>
            )}
          </div>
          )}
        </div>
    </WorkspaceSection>
  );
}
