import { useId } from 'react';
/**
 * Depositor Information Section
 *
 * Displays and edits depositor and current owner contacts.
 */

import { User, Search, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  WorkspaceSection,
} from '../../../components/workspace';
import {
  RequiredGroupMarker,
  RequiredFieldMessage,
} from '../../../components/workspace/RequiredFieldsContext';
import {
  useRequiredField,
} from '../../../components/workspace/requiredFields';
import { SectionCompletionBadge } from '../../../components/collections/SectionCompletionBadge';
import { ContactSelectorSlideOver } from '../../../components/collections/ConstituentSelectorSlideOver';
import { getContact } from '../../../lib/api';
import { useContactSelector } from '../../../hooks/useContactSelector';
import type { DepositorSectionProps } from './types';

export function DepositorSection({
  formData,
  updateField,
  isExpanded,
  onToggle,
  isEditing,
  isCreateMode,
  getSectionOrder,
  sectionCompletion,
  orgId,
}: DepositorSectionProps) {
  const uid = useId();
  // Contact selectors
  const depositorSelector = useContactSelector();
  const currentOwnerSelector = useContactSelector();
  const {
    error: depositorError,
    register: depositorRegister,
    onEdited: depositorEdited,
  } = useRequiredField('depositor_id', true, 'depositor');
  const {
    required: currentOwnerRequired,
    error: currentOwnerError,
    register: currentOwnerRegister,
    onEdited: currentOwnerEdited,
  } = useRequiredField('current_owner_id', false, 'depositor');

  // Fetch depositor contact details
  const { data: depositorContact } = useQuery({
    queryKey: ['contact', orgId, formData.depositor_id],
    queryFn: () => getContact(orgId!, formData.depositor_id),
    enabled: !!orgId && !!formData.depositor_id,
  });

  // Fetch current owner contact details
  const { data: currentOwnerContact } = useQuery({
    queryKey: ['contact', orgId, formData.current_owner_id],
    queryFn: () => getContact(orgId!, formData.current_owner_id),
    enabled: !!orgId && !!formData.current_owner_id,
  });

  return (
    <>
      <WorkspaceSection
        id="depositor"
        title="Depositor Information"
        icon={<User size={20} />}
        isExpanded={isExpanded}
        onToggle={onToggle}
        isEditing={isEditing}
        order={getSectionOrder('depositor')}
        badge={!isCreateMode && sectionCompletion ? <SectionCompletionBadge completion={sectionCompletion} /> : undefined}
      >
        <div className="grid grid-cols-2 gap-6">
          {/* Depositor */}
          <div role="group" aria-labelledby={`${uid}-depositor`}>
            <span id={`${uid}-depositor`} className="block text-sm font-medium text-ink mb-1.5">
              Depositor <span className="text-semantic-error">*</span>
            </span>
            {isEditing ? (
              <div className="flex items-center gap-2">
                {formData.depositor_id && depositorContact ? (
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                    <User size={16} className="text-archive flex-shrink-0" />
                    <span className="text-sm text-ink">{depositorContact.name}</span>
                    {depositorContact.organization_name && (
                      <span className="text-xs text-archive">({depositorContact.organization_name})</span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        updateField('depositor_id', '');
                        updateField('depositor_name', '');
                      }}
                      className="ml-auto p-1 text-archive hover:text-semantic-error"
                      aria-label="Clear depositor"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    ref={depositorRegister}
                    aria-describedby={depositorError?.id}
                    onClick={() => depositorSelector.open()}
                    className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
                  >
                    <Search size={16} />
                    Search or create depositor...
                  </button>
                )}
                {formData.depositor_id && (
                  <button
                    type="button"
                    onClick={() => depositorSelector.open()}
                    className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                    aria-label="Change depositor"
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <div className="text-sm text-ink">
                {depositorContact ? (
                  <span>
                    {depositorContact.name}
                    {depositorContact.organization_name && (
                      <span className="text-archive ml-1">({depositorContact.organization_name})</span>
                    )}
                  </span>
                ) : formData.depositor_name ? (
                  <span>{formData.depositor_name}</span>
                ) : (
                  <span className="text-archive">Not specified</span>
                )}
              </div>
            )}
            {depositorError && <RequiredFieldMessage error={depositorError} />}
          </div>

          {/* Current Owner */}
          <div role="group" aria-labelledby={`${uid}-current-owner`}>
            <span id={`${uid}-current-owner`} className="block text-sm font-medium text-ink mb-1.5">
              Current Owner
              {currentOwnerRequired && <RequiredGroupMarker />}
            </span>
            {isEditing ? (
              <div className="flex items-center gap-2">
                {formData.current_owner_id && currentOwnerContact ? (
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                    <User size={16} className="text-archive flex-shrink-0" />
                    <span className="text-sm text-ink">{currentOwnerContact.name}</span>
                    {currentOwnerContact.organization_name && (
                      <span className="text-xs text-archive">({currentOwnerContact.organization_name})</span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        updateField('current_owner_id', '');
                        updateField('current_owner', '');
                      }}
                      className="ml-auto p-1 text-archive hover:text-semantic-error"
                      aria-label="Clear current owner"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    ref={currentOwnerRegister}
                    aria-describedby={currentOwnerError?.id}
                    onClick={() => currentOwnerSelector.open()}
                    className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
                  >
                    <Search size={16} />
                    Search or create owner...
                  </button>
                )}
                {formData.current_owner_id && (
                  <button
                    type="button"
                    onClick={() => currentOwnerSelector.open()}
                    className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                    aria-label="Change current owner"
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <div className="text-sm text-ink">
                {currentOwnerContact ? (
                  <span>
                    {currentOwnerContact.name}
                    {currentOwnerContact.organization_name && (
                      <span className="text-archive ml-1">({currentOwnerContact.organization_name})</span>
                    )}
                  </span>
                ) : formData.current_owner ? (
                  <span>{formData.current_owner}</span>
                ) : (
                  <span className="text-archive">Same as depositor</span>
                )}
              </div>
            )}
            {currentOwnerError && <RequiredFieldMessage error={currentOwnerError} />}
          </div>
        </div>
        <p className="mt-3 text-xs text-archive">
          If the current owner is different from the depositor, specify them above.
        </p>
      </WorkspaceSection>

      {/* Depositor Contact Selector */}
      <ContactSelectorSlideOver
        isOpen={depositorSelector.isOpen}
        onClose={depositorSelector.close}
        onSelect={depositorSelector.createSelectHandler((id) => {
          depositorEdited();
          updateField('depositor_id', id);
        })}
        organizationId={orgId!}
        title="Select Depositor"
        subtitle="Search for an existing contact or create a new one to use as the depositor."
      />

      {/* Current Owner Contact Selector */}
      <ContactSelectorSlideOver
        isOpen={currentOwnerSelector.isOpen}
        onClose={currentOwnerSelector.close}
        onSelect={currentOwnerSelector.createSelectHandler((id) => {
          currentOwnerEdited();
          updateField('current_owner_id', id);
        })}
        organizationId={orgId!}
        title="Select Current Owner"
        subtitle="Search for an existing contact or create a new one to use as the current owner."
      />
    </>
  );
}
