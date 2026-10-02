/**
 * Authorization Section — Object Entry
 *
 * Object Entry: records who in the institution authorized accepting
 * the deposit (separate from the depositor themselves).
 */

import { useQuery } from '@tanstack/react-query';
import { AuthorizationSection as SharedAuthorizationSection } from '../../../components/collections/AuthorizationSection';
import { ContactSelectorSlideOver } from '../../../components/collections/ConstituentSelectorSlideOver';
import { useContactSelector } from '../../../hooks/useContactSelector';
import { getContact } from '../../../lib/api';
import type { SectionBaseProps } from './types';
import type { EntryFormData } from './types';

interface Props extends SectionBaseProps {
  formData: EntryFormData;
  updateField: (field: string, value: unknown) => void;
  isExpanded: boolean;
  onToggle: () => void;
  getSectionOrder: (sectionId: string) => number | undefined;
  orgId: string;
}

export function AuthorizationSection({
  formData,
  updateField,
  isExpanded,
  onToggle,
  isEditing,
  getSectionOrder,
  orgId,
}: Props) {
  const selector = useContactSelector();

  const { data: authorizerContact } = useQuery({
    queryKey: ['contact', orgId, formData.authorizer_id],
    queryFn: () => getContact(orgId!, formData.authorizer_id),
    enabled: !!orgId && !!formData.authorizer_id,
  });

  return (
    <>
      <SharedAuthorizationSection
        authorizerId={formData.authorizer_id}
        authorizerContact={authorizerContact}
        authorizationDate={formData.authorization_date}
        authorizationNote={formData.authorization_note}
        isEditing={isEditing}
        isExpanded={isExpanded}
        order={getSectionOrder('authorization')}
        onToggle={onToggle}
        onUpdateField={(field, value) => updateField(field, value)}
        onOpenAuthorizerSelector={() => selector.open()}
      />

      <ContactSelectorSlideOver
        isOpen={selector.isOpen}
        onClose={selector.close}
        onSelect={selector.createSelectHandler((id) => updateField('authorizer_id', id))}
        organizationId={orgId}
        title="Select Authorizer"
        subtitle="Who in your institution is authorizing acceptance of this deposit?"
      />
    </>
  );
}
