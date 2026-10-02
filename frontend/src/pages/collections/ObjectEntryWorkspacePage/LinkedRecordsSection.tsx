/**
 * Linked Records Sections
 *
 * Displays linked acquisition, loan in, or exit based on entry reason.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, LogOut, PenTool, Loader2 } from 'lucide-react';
import { WorkspaceSection } from '../../../components/workspace';
import { EntryAcquisitionLinker } from '../../../components/collections/EntryAcquisitionLinker';
import { EntryLoanLinker } from '../../../components/collections/EntryLoanLinker';
import { EntryExitLinker } from '../../../components/collections/EntryExitLinker';
import SlideOver from '../../../components/ui/SlideOver';
import { markObjectEntryReturned } from '../../../lib/api';
import type { LinkedRecordsSectionProps } from './types';

export function LinkedAcquisitionSection({
  orgId,
  entryId,
  linkedAcquisition,
  isExpanded,
  onToggle,
  isEditing,
  getSectionOrder,
  onLinkChange,
}: {
  orgId?: string;
  entryId?: string;
  linkedAcquisition?: { acquisition_id: string; [key: string]: unknown };
  isExpanded: boolean;
  onToggle: () => void;
  isEditing: boolean;
  getSectionOrder: (sectionId: string) => number | undefined;
  onLinkChange: () => void;
}) {
  return (
    <WorkspaceSection
      id="acquisition"
      title="Linked Acquisition"
      icon={<Archive size={20} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={getSectionOrder('acquisition')}
    >
      <EntryAcquisitionLinker
        organizationId={orgId!}
        entryId={entryId || ''}
        linkedAcquisition={linkedAcquisition as React.ComponentProps<typeof EntryAcquisitionLinker>['linkedAcquisition']}
        isEditing={isEditing}
        onLinkChange={onLinkChange}
      />
    </WorkspaceSection>
  );
}

export function LinkedLoanSection({
  orgId,
  entryId,
  linkedLoan,
  loanInEntryId,
  isExpanded,
  onToggle,
  isEditing,
  getSectionOrder,
  onLinkChange,
}: {
  orgId?: string;
  entryId?: string;
  linkedLoan?: { loan_in_id: string; [key: string]: unknown };
  loanInEntryId?: string;
  isExpanded: boolean;
  onToggle: () => void;
  isEditing: boolean;
  getSectionOrder: (sectionId: string) => number | undefined;
  onLinkChange: () => void;
}) {
  return (
    <WorkspaceSection
      id="loan-in"
      title="Linked Loan In"
      icon={<Download size={20} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={getSectionOrder('loan-in')}
    >
      <EntryLoanLinker
        organizationId={orgId!}
        entryId={entryId || ''}
        linkedLoan={linkedLoan as React.ComponentProps<typeof EntryLoanLinker>['linkedLoan']}
        loanInEntryId={loanInEntryId}
        isEditing={isEditing}
        onLinkChange={onLinkChange}
      />
    </WorkspaceSection>
  );
}

export function LinkedExitSection({
  orgId,
  entryId,
  linkedExit,
  depositorName,
  isExpanded,
  onToggle,
  isEditing,
  getSectionOrder,
  onLinkChange,
}: {
  orgId?: string;
  entryId?: string;
  linkedExit?: { exit_id: string; [key: string]: unknown };
  depositorName?: string;
  isExpanded: boolean;
  onToggle: () => void;
  isEditing: boolean;
  getSectionOrder: (sectionId: string) => number | undefined;
  onLinkChange: () => void;
}) {
  const [showSignOffSlideOver, setShowSignOffSlideOver] = useState(false);

  return (
    <>
      <WorkspaceSection
        id="exit"
        title="Linked Object Exit"
        icon={<LogOut size={20} />}
        isExpanded={isExpanded}
        onToggle={onToggle}
        isEditing={isEditing}
        order={getSectionOrder('exit')}
      >
        <EntryExitLinker
          organizationId={orgId!}
          entryId={entryId || ''}
          linkedExit={linkedExit as React.ComponentProps<typeof EntryExitLinker>['linkedExit']}
          depositorName={depositorName}
          isEditing={isEditing}
          onLinkChange={onLinkChange}
        />

        {/* Object Exit Note 1: for a simple return of unaccessioned
            deposits, you can skip creating a full Object Exit record and just
            get a second signature on the entry form. Only offer this path
            when no exit is linked yet. */}
        {isEditing && !linkedExit && orgId && entryId && (
          <div className="mt-4 pt-4 border-t border-lichen">
            <div className="flex items-start gap-3 rounded-lg bg-parchment border border-dashed border-lichen p-3">
              <PenTool size={16} className="text-archive flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink font-medium">Simple return</p>
                <p className="text-xs text-archive mt-0.5">
                  If the objects are being returned with just a signature on the entry form,
                  you don't need a separate Object Exit record.
                </p>
                <button
                  type="button"
                  onClick={() => setShowSignOffSlideOver(true)}
                  className="mt-2 text-sm text-bark hover:text-copper-dark font-medium"
                >
                  Mark as returned via signature →
                </button>
              </div>
            </div>
          </div>
        )}
      </WorkspaceSection>

      {orgId && entryId && (
        <SignOffReturnSlideOver
          isOpen={showSignOffSlideOver}
          onClose={() => setShowSignOffSlideOver(false)}
          orgId={orgId}
          entryId={entryId}
          depositorName={depositorName}
          onSuccess={() => {
            setShowSignOffSlideOver(false);
            onLinkChange();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// SignOffReturnSlideOver — Object Exit Note 1 alternative
// ---------------------------------------------------------------------------

function SignOffReturnSlideOver({
  isOpen,
  onClose,
  orgId,
  entryId,
  depositorName,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  entryId: string;
  depositorName?: string;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [returnDate, setReturnDate] = useState(today);
  const [returnedTo, setReturnedTo] = useState(depositorName || '');
  const [signatureReference, setSignatureReference] = useState('');
  const [outcomeNote, setOutcomeNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setReturnDate(today);
    setReturnedTo(depositorName || '');
    setSignatureReference('');
    setOutcomeNote('');
    setError(null);
  };

  const mutation = useMutation({
    mutationFn: () =>
      markObjectEntryReturned(orgId, entryId, {
        return_date: returnDate || undefined,
        returned_to: returnedTo.trim() || undefined,
        signature_reference: signatureReference.trim() || undefined,
        outcome_note: outcomeNote.trim() || undefined,
      }),
    onSuccess: () => {
      reset();
      queryClient.invalidateQueries({ queryKey: ['object-entry', orgId, entryId] });
      onSuccess();
    },
    onError: (err: Error) => setError(err.message || 'Failed to mark as returned'),
  });

  const handleClose = () => {
    reset();
    onClose();
  };

  const inputClass =
    'w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark';

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={handleClose}
      title="Mark as returned via signature"
      subtitle="Second signature on the entry form"
      width="md"
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-sm text-archive hover:text-ink"
            disabled={mutation.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
            disabled={mutation.isPending}
            className="btn btn-primary text-sm flex items-center gap-2"
          >
            {mutation.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Marking...
              </>
            ) : (
              'Confirm return'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        <p className="text-sm text-archive">
          This will set the entry status to <strong className="text-ink">returned</strong>{' '}
          without creating a separate Object Exit record. Use this for simple returns of
          unaccessioned deposits where a signature on the entry form is sufficient.
        </p>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            Return date <span className="text-semantic-error">*</span>
          </label>
          <input
            type="date"
            value={returnDate}
            onChange={(e) => setReturnDate(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">Returned to</label>
          <input
            type="text"
            value={returnedTo}
            onChange={(e) => setReturnedTo(e.target.value)}
            placeholder={depositorName || 'Name of person receiving the objects'}
            className={inputClass}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            Signature reference
          </label>
          <input
            type="text"
            value={signatureReference}
            onChange={(e) => setSignatureReference(e.target.value)}
            placeholder="Reference to signed entry form (e.g. scan file name, form ID)"
            className={inputClass}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">Notes</label>
          <textarea
            value={outcomeNote}
            onChange={(e) => setOutcomeNote(e.target.value)}
            rows={3}
            placeholder="Any additional notes about the return..."
            className={`${inputClass} resize-none`}
          />
        </div>
      </div>
    </SlideOver>
  );
}

/**
 * Renders linked-record sections (Acquisition, Loan In, Object Exit).
 *
 * the collections standard (Object Entry p. 5) routes any entry to one of three
 * procedures depending on outcome: Acquisition, Loans in, or Object exit.
 * Exit is the universal return path — even an entry brought in for
 * acquisition consideration can be declined and end in a return — so the
 * Exit section is always rendered. Acquisition and Loan In are gated on
 * reason, but we also keep them visible when a link already exists so the
 * user never loses access to an existing record.
 */
export function LinkedRecordsSection({
  orgId,
  entryId,
  effectiveReason,
  linkedAcquisition,
  linkedLoan,
  linkedExit,
  expandedSections,
  onToggle,
  isEditing,
  getSectionOrder,
  depositorName,
  onLinkChange,
}: LinkedRecordsSectionProps) {
  const reason = effectiveReason || '';
  const showAcquisition =
    reason === 'gift_offer' || reason === 'purchase_consideration' || !!linkedAcquisition;
  const showLoan = reason === 'loan_consideration' || !!linkedLoan;
  // Exit is always available per procedures.

  return (
    <>
      {showAcquisition && (
        <LinkedAcquisitionSection
          orgId={orgId}
          entryId={entryId}
          linkedAcquisition={linkedAcquisition}
          isExpanded={expandedSections.acquisition !== false}
          onToggle={() => onToggle('acquisition')}
          isEditing={isEditing}
          getSectionOrder={getSectionOrder}
          onLinkChange={onLinkChange}
        />
      )}

      {showLoan && (
        <LinkedLoanSection
          orgId={orgId}
          entryId={entryId}
          linkedLoan={linkedLoan}
          loanInEntryId={linkedLoan?.loan_in_entry_id}
          isExpanded={expandedSections['loan-in'] !== false}
          onToggle={() => onToggle('loan-in')}
          isEditing={isEditing}
          getSectionOrder={getSectionOrder}
          onLinkChange={onLinkChange}
        />
      )}

      <LinkedExitSection
        orgId={orgId}
        entryId={entryId}
        linkedExit={linkedExit}
        depositorName={depositorName}
        isExpanded={expandedSections.exit !== false}
        onToggle={() => onToggle('exit')}
        isEditing={isEditing}
        getSectionOrder={getSectionOrder}
        onLinkChange={onLinkChange}
      />
    </>
  );
}
