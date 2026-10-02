/**
 * Depositor Information Section
 *
 * Displays and edits depositor and current owner contacts.
 */

import { User, Search, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { WorkspaceSection } from '../../../components/workspace';
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
  // Contact selectors
  const depositorSelector = useContactSelector();
  const currentOwnerSelector = useContactSelector();

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
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Depositor <span className="text-semantic-error">*</span>
            </label>
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
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
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
          </div>

          {/* Current Owner */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Current Owner
            </label>
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
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
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
        onSelect={depositorSelector.createSelectHandler((id) => updateField('depositor_id', id))}
        organizationId={orgId!}
        title="Select Depositor"
        subtitle="Search for an existing contact or create a new one to use as the depositor."
      />

      {/* Current Owner Contact Selector */}
      <ContactSelectorSlideOver
        isOpen={currentOwnerSelector.isOpen}
        onClose={currentOwnerSelector.close}
        onSelect={currentOwnerSelector.createSelectHandler((id) => updateField('current_owner_id', id))}
        organizationId={orgId!}
        title="Select Current Owner"
        subtitle="Search for an existing contact or create a new one to use as the current owner."
      />
    </>
  );
}
