import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Download, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { createDownloadRequest } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';

interface RequestDownloadModalProps {
  organizationId: string;
  mediaItems: { media_id: string; filename: string; title?: string | null }[];
  collectionId?: string;
  collectionName?: string;
  onClose: () => void;
}

const PURPOSE_OPTIONS = [
  { value: 'research', label: 'Research', description: 'Academic or scholarly research' },
  { value: 'publication', label: 'Publication', description: 'Book, article, or journal publication' },
  { value: 'exhibition', label: 'Exhibition', description: 'Physical or virtual exhibition' },
  { value: 'educational', label: 'Educational', description: 'Teaching or educational materials' },
  { value: 'commercial', label: 'Commercial', description: 'Commercial or promotional use' },
  { value: 'personal', label: 'Personal', description: 'Personal, non-commercial use' },
  { value: 'other', label: 'Other', description: 'Other purposes' },
];

const DERIVATIVE_OPTIONS = [
  { value: 'access_master', label: 'Access Master', description: 'High-quality access copy' },
  { value: 'large', label: 'Large', description: 'Large resolution derivative' },
  { value: 'original', label: 'Original', description: 'Original file (if permitted)' },
  { value: 'watermarked', label: 'Watermarked', description: 'Watermarked version' },
];

export function RequestDownloadModal({
  organizationId,
  mediaItems,
  collectionId,
  collectionName,
  onClose,
}: RequestDownloadModalProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [purpose, setPurpose] = useState('research');
  const [intendedUse, setIntendedUse] = useState('');
  const [institution, setInstitution] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [derivativeType, setDerivativeType] = useState('access_master');

  const createMutation = useMutation({
    mutationFn: () =>
      createDownloadRequest(organizationId, {
        media_ids: mediaItems.map((m) => m.media_id),
        purpose,
        intended_use: intendedUse,
        collection_id: collectionId,
        requester_institution: institution || undefined,
        project_description: projectDescription || undefined,
        derivative_type_requested: derivativeType,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-download-requests', organizationId] });
      showToast({
        type: 'success',
        title: 'Download Request Submitted',
        message: `Your request for ${mediaItems.length} item${mediaItems.length !== 1 ? 's' : ''} has been submitted for review.`,
      });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!intendedUse.trim()) return;
    createMutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-parchment rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden border border-lichen">
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download size={20} className="text-forest" />
            <h2 className="text-lg font-semibold text-ink">Request Download</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-archive hover:text-ink hover:bg-stone/50 rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="p-6 space-y-6">
            {/* Media Items Summary */}
            <div className="bg-stone/20 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <ImageIcon size={16} className="text-archive" />
                <span className="text-sm font-medium text-ink">
                  {mediaItems.length} item{mediaItems.length !== 1 ? 's' : ''} selected
                </span>
                {collectionName && (
                  <span className="text-sm text-archive">from "{collectionName}"</span>
                )}
              </div>
              {mediaItems.length <= 5 && (
                <ul className="text-sm text-accessible-gray space-y-1">
                  {mediaItems.map((item) => (
                    <li key={item.media_id} className="truncate">
                      {item.title || item.filename}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Purpose */}
            <div>
              <label className="block text-sm font-medium text-ink mb-2">
                Purpose of Request <span className="text-semantic-error">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PURPOSE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      purpose === opt.value
                        ? 'border-forest bg-forest/5'
                        : 'border-lichen hover:border-lichen'
                    }`}
                  >
                    <input
                      type="radio"
                      name="purpose"
                      value={opt.value}
                      checked={purpose === opt.value}
                      onChange={(e) => setPurpose(e.target.value)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium text-ink">{opt.label}</div>
                      <div className="text-xs text-archive">{opt.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Intended Use */}
            <div>
              <label className="block text-sm font-medium text-ink mb-2">
                Describe Intended Use <span className="text-semantic-error">*</span>
              </label>
              <textarea
                value={intendedUse}
                onChange={(e) => setIntendedUse(e.target.value)}
                placeholder="How will you use these images? Please be specific..."
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                rows={3}
                required
              />
            </div>

            {/* Institution */}
            <div>
              <label className="block text-sm font-medium text-ink mb-2">
                Institution / Affiliation
              </label>
              <input
                type="text"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="University, museum, company, etc."
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>

            {/* Project Description */}
            <div>
              <label className="block text-sm font-medium text-ink mb-2">
                Project Description
              </label>
              <textarea
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
                placeholder="Additional context about your project (optional)..."
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                rows={2}
              />
            </div>

            {/* Derivative Type */}
            <div>
              <label className="block text-sm font-medium text-ink mb-2">
                File Type Requested
              </label>
              <select
                value={derivativeType}
                onChange={(e) => setDerivativeType(e.target.value)}
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              >
                {DERIVATIVE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} - {opt.description}
                  </option>
                ))}
              </select>
            </div>

            {/* Error Message */}
            {createMutation.isError && (
              <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error flex items-center gap-2 text-sm">
                <AlertCircle size={16} />
                <span>Failed to submit request. Please try again.</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-lichen bg-stone/20 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-lichen rounded-lg text-sm text-ink hover:bg-stone transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!intendedUse.trim() || createMutation.isPending}
              className="px-4 py-2 bg-forest text-parchment rounded-lg text-sm hover:bg-forest/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
            >
              {createMutation.isPending ? (
                <>
                  <span className="animate-spin h-4 w-4 border-2 border-parchment/30 border-t-white rounded-full" />
                  Submitting...
                </>
              ) : (
                <>
                  <Download size={16} />
                  Submit Request
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
