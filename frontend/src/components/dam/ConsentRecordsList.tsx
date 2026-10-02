import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield,
  Plus,
  Edit2,
  Trash2,
  Ban,
  FileText,
  AlertCircle,
  Check,
  X,
} from 'lucide-react';
import {
  listMediaConsents,
  deleteMediaConsent,
  getConsentDocumentUrl,
} from '../../lib/api';
import type { MediaConsent } from '../../lib/schemas';
import { AddConsentModal } from './AddConsentModal';
import { RevokeConsentModal } from './RevokeConsentModal';
import ConfirmDialog from '../ConfirmDialog';
import { logger } from '../../lib/logger';
import { formatDateShort } from '@/lib/formatters';

interface ConsentRecordsListProps {
  organizationId: string;
  mediaId: string;
}

const CONSENT_TYPE_LABELS: Record<string, string> = {
  photo_release: 'Photo Release',
  model_release: 'Model Release',
  interview: 'Interview Consent',
  performance: 'Performance Release',
  general: 'General Consent',
  other: 'Other',
};

const CONSENT_SCOPE_LABELS: Record<string, string> = {
  internal: 'Internal Use Only',
  public: 'Public Use',
  commercial: 'Commercial Use',
  educational: 'Educational Use',
  all: 'All Uses',
};

export function ConsentRecordsList({ organizationId, mediaId }: ConsentRecordsListProps) {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingConsent, setEditingConsent] = useState<MediaConsent | null>(null);
  const [revokingConsent, setRevokingConsent] = useState<MediaConsent | null>(null);
  const [downloadingDoc, setDownloadingDoc] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{action: () => void; title: string; message: string} | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['media-consents', organizationId, mediaId],
    queryFn: () => listMediaConsents(organizationId, mediaId),
  });

  const deleteMutation = useMutation({
    mutationFn: (consentId: string) => deleteMediaConsent(organizationId, mediaId, consentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-consents', organizationId, mediaId] });
    },
  });

  const handleDownloadDocument = async (consent: MediaConsent) => {
    if (!consent.consent_document_key) return;
    setDownloadingDoc(consent.consent_id);
    try {
      const { document_url } = await getConsentDocumentUrl(organizationId, mediaId, consent.consent_id);
      window.open(document_url, '_blank');
    } catch (err) {
      logger.error('Failed to get document URL:', err);
    } finally {
      setDownloadingDoc(null);
    }
  };

  const handleDelete = (consent: MediaConsent) => {
    setConfirmState({
      action: () => deleteMutation.mutate(consent.consent_id),
      title: 'Delete Consent Record',
      message: `Delete consent record for "${consent.subject_name}"? This cannot be undone.`,
    });
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-20 bg-stone-200 rounded" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-md text-semantic-error flex items-center gap-2">
        <AlertCircle size={16} />
        <span>Failed to load consent records</span>
      </div>
    );
  }

  const consents = data?.consent_records || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={18} className="text-stone-500" />
          <h3 className="font-medium text-stone-900">Consent Records</h3>
          {data?.has_valid_consent ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-semantic-success/10 text-semantic-success rounded">
              <Check size={12} />
              Valid
            </span>
          ) : consents.length > 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-semantic-warning/10 text-semantic-warning rounded">
              <AlertCircle size={12} />
              Review Needed
            </span>
          ) : null}
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-3 py-1.5 border border-stone-300 rounded-md text-sm text-stone-700 hover:bg-stone-50 flex items-center gap-1 transition-colors"
        >
          <Plus size={14} />
          Add Consent
        </button>
      </div>

      {/* Consent List */}
      {consents.length === 0 ? (
        <div className="p-6 bg-stone-50 rounded-md text-center">
          <Shield size={32} className="mx-auto text-stone-400 mb-2" />
          <p className="text-stone-600 mb-3">No consent records</p>
          <p className="text-sm text-stone-500">
            Add consent records for individuals featured in this media.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {consents.map((consent) => (
            <div
              key={consent.consent_id}
              className={`p-3 border rounded-md ${
                consent.is_valid ? 'bg-parchment border-lichen' : 'bg-semantic-warning/10 border-semantic-warning/30'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-stone-900">{consent.subject_name}</span>
                    {consent.subject_role && (
                      <span className="text-xs text-stone-500">
                        ({consent.subject_role})
                      </span>
                    )}
                    {!consent.is_valid && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-semantic-error/10 text-semantic-error rounded">
                        <X size={10} />
                        Revoked
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex items-center gap-3 text-sm text-stone-500 flex-wrap">
                    <span>{CONSENT_TYPE_LABELS[consent.consent_type] || consent.consent_type}</span>
                    <span className="text-stone-300">|</span>
                    <span>{CONSENT_SCOPE_LABELS[consent.consent_scope] || consent.consent_scope}</span>
                    {consent.consent_date && (
                      <>
                        <span className="text-stone-300">|</span>
                        <span>Signed: {formatDateShort(consent.consent_date)}</span>
                      </>
                    )}
                    {consent.expiry_date && (
                      <>
                        <span className="text-stone-300">|</span>
                        <span
                          className={
                            new Date(consent.expiry_date) < new Date()
                              ? 'text-semantic-error'
                              : ''
                          }
                        >
                          Expires: {formatDateShort(consent.expiry_date)}
                        </span>
                      </>
                    )}
                  </div>

                  {consent.revocation_date && (
                    <div className="mt-1 text-sm text-semantic-error">
                      Revoked: {formatDateShort(consent.revocation_date)}
                      {consent.revocation_reason && ` - ${consent.revocation_reason}`}
                    </div>
                  )}

                  {consent.notes && (
                    <p className="mt-1 text-sm text-stone-500">{consent.notes}</p>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {consent.consent_document_key && (
                    <button
                      onClick={() => handleDownloadDocument(consent)}
                      disabled={downloadingDoc === consent.consent_id}
                      className="p-1.5 hover:bg-stone-100 rounded text-stone-600"
                      title="Download document"
                    >
                      {downloadingDoc === consent.consent_id ? (
                        <div className="w-4 h-4 border-2 border-forest border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <FileText size={16} />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => setEditingConsent(consent)}
                    className="p-1.5 hover:bg-stone-100 rounded text-stone-600"
                    title="Edit"
                  >
                    <Edit2 size={16} />
                  </button>
                  {consent.is_valid && (
                    <button
                      onClick={() => setRevokingConsent(consent)}
                      className="p-1.5 hover:bg-stone-100 rounded text-semantic-warning"
                      title="Revoke"
                    >
                      <Ban size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(consent)}
                    disabled={deleteMutation.isPending}
                    className="p-1.5 hover:bg-stone-100 rounded text-semantic-error"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmText="Confirm"
        confirmStyle="danger"
      />

      {/* Modals */}
      <AddConsentModal
        isOpen={showAddModal}
        organizationId={organizationId}
        mediaId={mediaId}
        onClose={() => setShowAddModal(false)}
      />

      <AddConsentModal
        isOpen={!!editingConsent}
        organizationId={organizationId}
        mediaId={mediaId}
        existingConsent={editingConsent || undefined}
        onClose={() => setEditingConsent(null)}
      />

      {revokingConsent && (
        <RevokeConsentModal
          isOpen={!!revokingConsent}
          organizationId={organizationId}
          mediaId={mediaId}
          consent={revokingConsent}
          onClose={() => setRevokingConsent(null)}
        />
      )}
    </div>
  );
}
