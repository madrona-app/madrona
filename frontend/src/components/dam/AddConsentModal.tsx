import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Upload, Loader2 } from 'lucide-react';
import {
  createMediaConsent,
  updateMediaConsent,
  uploadConsentDocument,
} from '../../lib/api';
import type { MediaConsent } from '../../lib/schemas';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { logger } from '../../lib/logger';
import { ModalPortal } from '../ModalPortal';

interface AddConsentModalProps {
  isOpen: boolean;
  organizationId: string;
  mediaId: string;
  existingConsent?: MediaConsent;
  onClose: () => void;
}

const CONSENT_TYPES = [
  { value: 'model_release', label: 'Model Release' },
  { value: 'photo_release', label: 'Photo Release' },
  { value: 'interview', label: 'Interview Consent' },
  { value: 'performance', label: 'Performance Release' },
  { value: 'general', label: 'General Consent' },
  { value: 'other', label: 'Other' },
];

const CONSENT_SCOPES = [
  { value: 'internal', label: 'Internal Use Only' },
  { value: 'public', label: 'Public Use' },
  { value: 'commercial', label: 'Commercial Use' },
  { value: 'educational', label: 'Educational Use' },
  { value: 'all', label: 'All Uses' },
];

export function AddConsentModal({
  isOpen,
  organizationId,
  mediaId,
  existingConsent,
  onClose,
}: AddConsentModalProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEditing = !!existingConsent;
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'add-consent-modal',
  });

  const [form, setForm] = useState<{
    subject_name: string;
    subject_role: string;
    consent_type: 'photo_release' | 'model_release' | 'interview' | 'performance' | 'general' | 'other';
    consent_scope: 'internal' | 'public' | 'commercial' | 'educational' | 'all';
    consent_date: string;
    expiry_date: string;
    notes: string;
  }>({
    subject_name: existingConsent?.subject_name || '',
    subject_role: existingConsent?.subject_role || '',
    consent_type: existingConsent?.consent_type || 'model_release',
    consent_scope: existingConsent?.consent_scope || 'internal',
    consent_date: existingConsent?.consent_date?.split('T')[0] || new Date().toISOString().split('T')[0],
    expiry_date: existingConsent?.expiry_date?.split('T')[0] || '',
    notes: existingConsent?.notes || '',
  });

  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = {
        subject_name: data.subject_name,
        subject_role: data.subject_role || undefined,
        consent_type: data.consent_type,
        consent_scope: data.consent_scope,
        consent_date: data.consent_date || undefined,
        expiry_date: data.expiry_date || undefined,
        notes: data.notes || undefined,
      };

      if (isEditing) {
        return updateMediaConsent(organizationId, mediaId, existingConsent.consent_id, payload);
      } else {
        return createMediaConsent(organizationId, mediaId, payload);
      }
    },
    onSuccess: async (result) => {
      // Upload document if provided
      if (documentFile && result.consent_id) {
        setUploadingDoc(true);
        try {
          await uploadConsentDocument(organizationId, mediaId, result.consent_id, documentFile);
        } catch (err) {
          logger.error('Failed to upload document:', err);
        }
        setUploadingDoc(false);
      }

      queryClient.invalidateQueries({ queryKey: ['media-consents', organizationId, mediaId] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.subject_name.trim()) return;
    createMutation.mutate(form);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setDocumentFile(file);
    }
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
        className="bg-parchment rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-lichen">
          <h2 id={titleId} className="text-lg font-semibold text-ink">
            {isEditing ? 'Edit Consent Record' : 'Add Consent Record'}
          </h2>
        </div>

        <form id="consent-form" onSubmit={handleSubmit} className="p-6 space-y-4">
          <p id={descriptionId} className="sr-only">
            {isEditing ? 'Edit an existing consent record' : 'Add a new consent record for this media'}
          </p>

          {/* Subject Name */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Subject Name <span className="text-semantic-error">*</span>
            </label>
            <input
              type="text"
              value={form.subject_name}
              onChange={(e) => setForm({ ...form, subject_name: e.target.value })}
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              placeholder="Name of person granting consent"
              required
            />
          </div>

          {/* Subject Role */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Subject Role</label>
            <input
              type="text"
              value={form.subject_role}
              onChange={(e) => setForm({ ...form, subject_role: e.target.value })}
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              placeholder="e.g., Artist, Visitor, Staff"
            />
          </div>

          {/* Consent Type & Scope */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Consent Type</label>
              <select
                value={form.consent_type}
                onChange={(e) => setForm({ ...form, consent_type: e.target.value as typeof form.consent_type })}
                className="w-full px-3 py-2 border border-lichen rounded-sm text-sm bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              >
                {CONSENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-1">Consent Scope</label>
              <select
                value={form.consent_scope}
                onChange={(e) => setForm({ ...form, consent_scope: e.target.value as typeof form.consent_scope })}
                className="w-full px-3 py-2 border border-lichen rounded-sm text-sm bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              >
                {CONSENT_SCOPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Consent Date</label>
              <input
                type="date"
                value={form.consent_date}
                onChange={(e) => setForm({ ...form, consent_date: e.target.value })}
                className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-1">Expiry Date</label>
              <input
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                placeholder="Leave blank for no expiry"
              />
              <p className="text-xs text-archive mt-1">Leave blank for no expiry</p>
            </div>
          </div>

          {/* Document Upload */}
          {!isEditing && (
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Consent Document</label>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileSelect}
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                className="hidden"
              />
              {documentFile ? (
                <div className="flex items-center gap-2 p-2 bg-stone/30 rounded-sm">
                  <span className="text-sm truncate flex-1 text-ink">{documentFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setDocumentFile(null)}
                    className="p-1 hover:bg-parchment rounded"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full p-4 border-2 border-dashed border-lichen rounded-sm flex flex-col items-center gap-2 hover:border-bark hover:bg-stone/20 transition-colors"
                >
                  <Upload size={20} className="text-archive" />
                  <span className="text-sm text-archive">
                    Click to upload signed consent form
                  </span>
                </button>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              rows={3}
              placeholder="Additional notes about this consent..."
            />
          </div>

        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-stone rounded-sm bg-parchment text-ink hover:bg-stone/20 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="consent-form"
            disabled={createMutation.isPending || uploadingDoc || !form.subject_name.trim()}
            className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {(createMutation.isPending || uploadingDoc) && (
              <Loader2 size={16} className="animate-spin" />
            )}
            {isEditing ? 'Save Changes' : 'Add Consent'}
          </button>
        </div>

          {createMutation.isError && (
            <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-semantic-error text-sm">
              {(createMutation.error as Error)?.message || 'Failed to save consent record'}
            </div>
          )}
      </div>
    </div>
    </ModalPortal>
  );
}
