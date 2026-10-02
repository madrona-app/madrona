import { Building2, CheckCircle, Search, User, X } from 'lucide-react';
import {
  WorkspaceSection,
  EditableField,
  RestrictedFieldPlaceholder,
} from '../../../components/workspace';
import { SectionCompletionBadge } from '../../../components/collections/SectionCompletionBadge';
import type { SectionCompletion } from '../../../lib/procedureValidation';
import type { FormData } from './types';

interface LenderSectionProps {
  formData: FormData;
  isEditing: boolean;
  isCreateMode: boolean;
  lenderContact: { name: string; organization_name?: string | null } | undefined;
  lenderContactPerson: { name: string; organization_name?: string | null } | undefined;
  authorizerContact: { name: string; title?: string | null } | undefined;
  expandedSections: Record<string, boolean>;
  sectionCompletions: Record<string, SectionCompletion>;
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  toggleSection: (sectionId: string) => void;
  getSectionOrder: (sectionId: string) => number | undefined;
  setShowLenderSelector: (show: boolean) => void;
  setShowLenderContactSelector: (show: boolean) => void;
  setShowAuthorizerSelector: (show: boolean) => void;
  isRestricted: (field: string) => boolean;
}

export function LenderSection({
  formData,
  isEditing,
  isCreateMode,
  lenderContact,
  lenderContactPerson,
  authorizerContact,
  expandedSections,
  sectionCompletions,
  updateField,
  toggleSection,
  getSectionOrder,
  setShowLenderSelector,
  setShowLenderContactSelector,
  setShowAuthorizerSelector,
  isRestricted,
}: LenderSectionProps) {
  return (
    <>
      {/* Lender Information */}
      <WorkspaceSection
        id="lender"
        title="Lender Information"
        icon={<Building2 size={20} />}
        isExpanded={expandedSections.lender}
        onToggle={() => toggleSection('lender')}
        isEditing={isEditing}
        order={getSectionOrder('lender')}
        badge={!isCreateMode && sectionCompletions.lender && (
          <SectionCompletionBadge completion={sectionCompletions.lender} />
        )}
      >
        {isRestricted('lender_contact') ? (
          <RestrictedFieldPlaceholder label="Lender" />
        ) : (
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Lender <span className="text-semantic-error">*</span>
            </label>
            {isEditing ? (
              <div className="flex items-center gap-2">
                {formData.lender_id && lenderContact ? (
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                    <User size={16} className="text-archive flex-shrink-0" />
                    <span className="text-sm text-ink">{lenderContact.name}</span>
                    {lenderContact.organization_name && (
                      <span className="text-xs text-archive">({lenderContact.organization_name})</span>
                    )}
                    <button
                      type="button"
                      onClick={() => updateField('lender_id', '')}
                      className="ml-auto p-1 text-archive hover:text-semantic-error"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowLenderSelector(true)}
                    className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
                  >
                    <Search size={16} />
                    Search or create lender...
                  </button>
                )}
                {formData.lender_id && (
                  <button
                    type="button"
                    onClick={() => setShowLenderSelector(true)}
                    className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <div className="text-sm text-ink">
                {lenderContact ? (
                  <span>
                    {lenderContact.name}
                    {lenderContact.organization_name && (
                      <span className="text-archive ml-1">({lenderContact.organization_name})</span>
                    )}
                  </span>
                ) : (
                  <span className="text-archive">Not specified</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Lender's Contact Person */}
        {isRestricted('lender_contact') ? (
          <RestrictedFieldPlaceholder label="Lender's Contact Person" />
        ) : (
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Lender's Contact Person
            </label>
            {isEditing ? (
              <div className="flex items-center gap-2">
                {formData.lender_contact_id && lenderContactPerson ? (
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                    <User size={16} className="text-archive flex-shrink-0" />
                    <span className="text-sm text-ink">{lenderContactPerson.name}</span>
                    {lenderContactPerson.organization_name && (
                      <span className="text-xs text-archive">({lenderContactPerson.organization_name})</span>
                    )}
                    <button
                      type="button"
                      onClick={() => updateField('lender_contact_id', '')}
                      className="ml-auto p-1 text-archive hover:text-semantic-error"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowLenderContactSelector(true)}
                    className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
                  >
                    <Search size={16} />
                    Search or create contact person...
                  </button>
                )}
                {formData.lender_contact_id && (
                  <button
                    type="button"
                    onClick={() => setShowLenderContactSelector(true)}
                    className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <div className="text-sm text-ink">
                {lenderContactPerson ? (
                  <span>
                    {lenderContactPerson.name}
                    {lenderContactPerson.organization_name && (
                      <span className="text-archive ml-1">({lenderContactPerson.organization_name})</span>
                    )}
                  </span>
                ) : (
                  <span className="text-archive">Not specified</span>
                )}
              </div>
            )}
          </div>
        )}
      </WorkspaceSection>


      {/* Lender Authorization - Procedure Compliance */}
      <WorkspaceSection
        id="lender-authorization"
        title="Lender's Authorization"
        icon={<CheckCircle size={20} />}
        isExpanded={expandedSections['lender-authorization']}
        onToggle={() => toggleSection('lender-authorization')}
        isEditing={isEditing}
        order={getSectionOrder('lender-authorization')}
      >
        <div className="mb-4 p-3 bg-stone/50 rounded-lg border border-bark/10">
          <p className="text-sm text-archive">
            <strong>Required:</strong> Record the name of the person authorizing
            the loan on behalf of the lender and the date of authorization.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Authorizer
            </label>
            {isEditing ? (
              <div className="flex items-center gap-2">
                {formData.lender_authorizer_id && authorizerContact ? (
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                    <User size={16} className="text-archive flex-shrink-0" />
                    <span className="text-sm text-ink">{authorizerContact.name}</span>
                    {authorizerContact.title && (
                      <span className="text-xs text-archive">({authorizerContact.title})</span>
                    )}
                    <button
                      type="button"
                      onClick={() => updateField('lender_authorizer_id', '')}
                      className="ml-auto p-1 text-archive hover:text-semantic-error"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAuthorizerSelector(true)}
                    className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
                  >
                    <Search size={16} />
                    Search or create authorizer...
                  </button>
                )}
                {formData.lender_authorizer_id && (
                  <button
                    type="button"
                    onClick={() => setShowAuthorizerSelector(true)}
                    className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <div className="text-sm text-ink">
                {authorizerContact ? (
                  <span>
                    {authorizerContact.name}
                    {authorizerContact.title && (
                      <span className="text-archive ml-1">({authorizerContact.title})</span>
                    )}
                  </span>
                ) : (
                  <span className="text-archive">Not specified</span>
                )}
              </div>
            )}
          </div>
          <EditableField
            value={formData.lender_authorization_date}
            label="Authorization Date"
            isEditing={isEditing}
            onChange={(v) => updateField('lender_authorization_date', v)}
            type="date"
          />
        </div>
      </WorkspaceSection>
    </>
  );
}
