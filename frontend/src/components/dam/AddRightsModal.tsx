import { useState, useEffect } from 'react';
import Checkbox from '../Checkbox';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Scale } from 'lucide-react';
import { createMediaRights, updateMediaRights, type MediaRightsRecord } from '../../lib/api';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { ModalPortal } from '../ModalPortal';

interface AddRightsModalProps {
  isOpen: boolean;
  organizationId: string;
  mediaId: string;
  existingRights?: MediaRightsRecord;
  onClose: () => void;
}

const RIGHTS_TYPES = [
  { value: 'copyright', label: 'Copyright' },
  { value: 'license', label: 'License' },
  { value: 'restriction', label: 'Restriction' },
  { value: 'permission', label: 'Permission' },
];

const LICENSE_TYPES = [
  { value: '', label: 'Select license type...' },
  { value: 'CC-BY', label: 'CC Attribution (CC BY)' },
  { value: 'CC-BY-SA', label: 'CC Attribution-ShareAlike (CC BY-SA)' },
  { value: 'CC-BY-NC', label: 'CC Attribution-NonCommercial (CC BY-NC)' },
  { value: 'CC-BY-ND', label: 'CC Attribution-NoDerivs (CC BY-ND)' },
  { value: 'CC-BY-NC-SA', label: 'CC Attribution-NonCommercial-ShareAlike (CC BY-NC-SA)' },
  { value: 'CC-BY-NC-ND', label: 'CC Attribution-NonCommercial-NoDerivs (CC BY-NC-ND)' },
  { value: 'CC0', label: 'CC0 Public Domain Dedication' },
  { value: 'ARR', label: 'All Rights Reserved' },
  { value: 'PD', label: 'Public Domain' },
  { value: 'custom', label: 'Custom License' },
];

const RIGHTS_STATUSES = [
  { value: '', label: 'Select status...' },
  { value: 'in_copyright', label: 'In Copyright' },
  { value: 'public_domain', label: 'Public Domain' },
  { value: 'copyright_undetermined', label: 'Copyright Undetermined' },
  { value: 'no_known_copyright', label: 'No Known Copyright' },
  { value: 'orphan_work', label: 'Orphan Work' },
];

export function AddRightsModal({
  isOpen,
  organizationId,
  mediaId,
  existingRights,
  onClose,
}: AddRightsModalProps) {
  const queryClient = useQueryClient();
  const isEditing = !!existingRights;
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'add-rights-modal',
  });

  const [formData, setFormData] = useState({
    rights_type: 'copyright' as 'copyright' | 'license' | 'restriction' | 'permission',
    rights_status: '',
    rights_holder: '',
    license_type: '',
    license_url: '',
    rights_statement: '',
    start_date: '',
    end_date: '',
    territory: '',
    usage_restrictions: [] as string[],
    is_active: true,
  });

  const [restrictionInput, setRestrictionInput] = useState('');

  useEffect(() => {
    if (existingRights) {
      setFormData({
        rights_type: existingRights.rights_type,
        rights_status: existingRights.rights_status || '',
        rights_holder: existingRights.rights_holder || '',
        license_type: existingRights.license_type || '',
        license_url: existingRights.license_url || '',
        rights_statement: existingRights.rights_statement || '',
        start_date: existingRights.start_date || '',
        end_date: existingRights.end_date || '',
        territory: existingRights.territory || '',
        usage_restrictions: existingRights.usage_restrictions || [],
        is_active: existingRights.is_active,
      });
    } else {
      setFormData({
        rights_type: 'copyright',
        rights_status: '',
        rights_holder: '',
        license_type: '',
        license_url: '',
        rights_statement: '',
        start_date: '',
        end_date: '',
        territory: '',
        usage_restrictions: [],
        is_active: true,
      });
    }
  }, [existingRights, isOpen]);

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      createMediaRights(organizationId, mediaId, {
        rights_type: data.rights_type,
        rights_status: data.rights_status || undefined,
        rights_holder: data.rights_holder || undefined,
        license_type: data.license_type || undefined,
        license_url: data.license_url || undefined,
        rights_statement: data.rights_statement || undefined,
        start_date: data.start_date || undefined,
        end_date: data.end_date || undefined,
        territory: data.territory || undefined,
        usage_restrictions: data.usage_restrictions.length > 0 ? data.usage_restrictions : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-rights', organizationId, mediaId] });
      onClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      updateMediaRights(organizationId, mediaId, existingRights!.rights_id, {
        rights_type: data.rights_type,
        rights_status: data.rights_status || undefined,
        rights_holder: data.rights_holder || undefined,
        license_type: data.license_type || undefined,
        license_url: data.license_url || undefined,
        rights_statement: data.rights_statement || undefined,
        start_date: data.start_date || undefined,
        end_date: data.end_date || undefined,
        territory: data.territory || undefined,
        usage_restrictions: data.usage_restrictions,
        is_active: data.is_active,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-rights', organizationId, mediaId] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEditing) {
      updateMutation.mutate(formData);
    } else {
      createMutation.mutate(formData);
    }
  };

  const addRestriction = () => {
    if (restrictionInput.trim() && !formData.usage_restrictions.includes(restrictionInput.trim())) {
      setFormData({
        ...formData,
        usage_restrictions: [...formData.usage_restrictions, restrictionInput.trim()],
      });
      setRestrictionInput('');
    }
  };

  const removeRestriction = (index: number) => {
    setFormData({
      ...formData,
      usage_restrictions: formData.usage_restrictions.filter((_, i) => i !== index),
    });
  };

  if (!isOpen) return null;

  const isPending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error || updateMutation.error;

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
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center gap-2">
            <Scale size={20} className="text-bark" />
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              {isEditing ? 'Edit Rights' : 'Add Rights'}
            </h2>
          </div>
        </div>

        {/* Body */}
        <form id="rights-form" onSubmit={handleSubmit} className="p-6 space-y-4">
          <p id={descriptionId} className="sr-only">
            {isEditing ? 'Edit an existing rights record' : 'Add a new rights record for this media'}
          </p>

          {error && (
            <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-semantic-error text-sm">
              {(error as Error).message || 'An error occurred'}
            </div>
          )}

          {/* Rights Type */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Rights Type <span className="text-semantic-error">*</span>
            </label>
            <select
              value={formData.rights_type}
              onChange={(e) => setFormData({ ...formData, rights_type: e.target.value as typeof formData.rights_type })}
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              {RIGHTS_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          {/* Rights Status */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Rights Status
            </label>
            <select
              value={formData.rights_status}
              onChange={(e) => setFormData({ ...formData, rights_status: e.target.value })}
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              {RIGHTS_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>

          {/* Rights Holder */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Rights Holder
            </label>
            <input
              type="text"
              value={formData.rights_holder}
              onChange={(e) => setFormData({ ...formData, rights_holder: e.target.value })}
              placeholder="Name of copyright holder or licensor"
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>

          {/* License Type */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              License Type
            </label>
            <select
              value={formData.license_type}
              onChange={(e) => setFormData({ ...formData, license_type: e.target.value })}
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              {LICENSE_TYPES.map((license) => (
                <option key={license.value} value={license.value}>
                  {license.label}
                </option>
              ))}
            </select>
          </div>

          {/* License URL */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              License URL
            </label>
            <input
              type="url"
              value={formData.license_url}
              onChange={(e) => setFormData({ ...formData, license_url: e.target.value })}
              placeholder="https://..."
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>

          {/* Rights Statement */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Rights Statement
            </label>
            <textarea
              value={formData.rights_statement}
              onChange={(e) => setFormData({ ...formData, rights_statement: e.target.value })}
              placeholder="Additional rights information or conditions..."
              rows={3}
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>

          {/* Territory */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Territory
            </label>
            <input
              type="text"
              value={formData.territory}
              onChange={(e) => setFormData({ ...formData, territory: e.target.value })}
              placeholder="e.g., Worldwide, United States, EU"
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={formData.start_date}
                onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                End Date
              </label>
              <input
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>
          </div>

          {/* Usage Restrictions */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Usage Restrictions
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={restrictionInput}
                onChange={(e) => setRestrictionInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addRestriction())}
                placeholder="Add a restriction..."
                className="flex-1 px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
              <button
                type="button"
                onClick={addRestriction}
                className="px-4 py-2 border border-stone rounded-sm bg-parchment text-ink hover:bg-stone/20 transition-colors"
              >
                Add
              </button>
            </div>
            {formData.usage_restrictions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {formData.usage_restrictions.map((restriction, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-semantic-warning/10 text-semantic-warning rounded text-sm"
                  >
                    {restriction}
                    <button
                      type="button"
                      onClick={() => removeRestriction(i)}
                      className="hover:text-semantic-warning"
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Active Status (only for editing) */}
          {isEditing && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              />
              <label htmlFor="is_active" className="text-sm text-ink">
                Active
              </label>
            </div>
          )}
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
            form="rights-form"
            disabled={isPending}
            className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50"
          >
            {isPending ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Rights'}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
