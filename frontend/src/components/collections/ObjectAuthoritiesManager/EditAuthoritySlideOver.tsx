import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { updateObjectAuthorityLink } from '../../../lib/api';
import type { EditAuthoritySlideOverProps } from './types';
import { LinkDetailsForm } from './LinkDetailsForm';
import SlideOver from '../../ui/SlideOver';

export function EditAuthoritySlideOver({
  isOpen,
  organizationId,
  objectId,
  link,
  onClose,
  onSuccess,
}: EditAuthoritySlideOverProps) {
  const [role, setRole] = useState(link?.role || 'creator');
  const [roleQualifier, setRoleQualifier] = useState(link?.role_qualifier || '');
  const [certainty, setCertainty] = useState(link?.attribution_certainty || '');
  const [displayNameOverride, setDisplayNameOverride] = useState(link?.display_name_override || '');
  const [notes, setNotes] = useState(link?.notes || '');
  const [error, setError] = useState<string | null>(null);

  // Reset form when link changes
  React.useEffect(() => {
    if (link) {
      setRole(link.role);
      setRoleQualifier(link.role_qualifier || '');
      setCertainty(link.attribution_certainty || '');
      setDisplayNameOverride(link.display_name_override || '');
      setNotes(link.notes || '');
      setError(null);
    }
  }, [link]);

  const updateMutation = useMutation({
    mutationFn: () => updateObjectAuthorityLink(organizationId, objectId, link!.link_id, {
      role,
      role_qualifier: roleQualifier || undefined,
      attribution_certainty: certainty || undefined,
      display_name_override: displayNameOverride || undefined,
      notes: notes || undefined,
    }),
    onSuccess,
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmitClick = () => {
    setError(null);
    updateMutation.mutate();
  };

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Biography Link"
      subtitle={link?.authority?.preferred_name || 'Unknown biography'}
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSubmitClick} disabled={updateMutation.isPending} className="btn btn-primary">
            {updateMutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin mr-2" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-institutional text-sm text-semantic-error">
            {error}
          </div>
        )}

        <LinkDetailsForm
          role={role}
          onRoleChange={setRole}
          roleQualifier={roleQualifier}
          onRoleQualifierChange={setRoleQualifier}
          certainty={certainty}
          onCertaintyChange={setCertainty}
          displayNameOverride={displayNameOverride}
          onDisplayNameOverrideChange={setDisplayNameOverride}
          notes={notes}
          onNotesChange={setNotes}
          idPrefix="edit-"
        />
      </div>
    </SlideOver>
  );
}
