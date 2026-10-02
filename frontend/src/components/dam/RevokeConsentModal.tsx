import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { revokeMediaConsent } from '../../lib/api';
import type { MediaConsent } from '../../lib/schemas';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { ModalPortal } from '../ModalPortal';

interface RevokeConsentModalProps {
  isOpen: boolean;
  organizationId: string;
  mediaId: string;
  consent: MediaConsent;
  onClose: () => void;
}

export function RevokeConsentModal({
  isOpen,
  organizationId,
  mediaId,
  consent,
  onClose,
}: RevokeConsentModalProps) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'revoke-consent-modal',
  });

  const revokeMutation = useMutation({
    mutationFn: () => revokeMediaConsent(organizationId, mediaId, consent.consent_id, reason || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-consents', organizationId, mediaId] });
      onClose();
    },
  });

  const handleRevoke = () => {
    revokeMutation.mutate();
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-lichen">
          <h2 id={titleId} className="text-lg font-semibold flex items-center gap-2 text-semantic-warning">
            <AlertTriangle size={20} />
            Revoke Consent
          </h2>
        </div>

        <div className="p-6 space-y-4">
          <div id={descriptionId} className="p-3 bg-semantic-warning/10 border border-semantic-warning/20 rounded-sm">
            <p className="text-semantic-warning">
              You are about to revoke the consent record for <strong>{consent.subject_name}</strong>.
            </p>
            <p className="text-sm text-semantic-warning mt-1">
              This action cannot be undone. The consent will be marked as invalid with today's date.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">Revocation Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              rows={3}
              placeholder="Optional: Enter reason for revoking consent..."
            />
          </div>

          {revokeMutation.isError && (
            <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-semantic-error text-sm">
              {(revokeMutation.error as Error)?.message || 'Failed to revoke consent'}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-stone rounded-sm bg-parchment text-ink hover:bg-stone/20 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleRevoke}
            disabled={revokeMutation.isPending}
            className="px-4 py-2 bg-semantic-error text-parchment rounded-sm hover:bg-semantic-error/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
          >
            {revokeMutation.isPending && <Loader2 size={16} className="animate-spin" />}
            Revoke Consent
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
