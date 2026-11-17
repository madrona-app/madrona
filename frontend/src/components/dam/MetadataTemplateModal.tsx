import { useId, useState } from 'react';
import Checkbox from '../Checkbox';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, X, Plus, Trash2 } from 'lucide-react';
import { createMetadataTemplate, updateMetadataTemplate } from '../../lib/api';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import type { MetadataTemplate, MetadataTemplateFields } from '../../lib/schemas';
import { ModalPortal } from '../ModalPortal';

interface MetadataTemplateModalProps {
  organizationId: string;
  templateToEdit?: MetadataTemplate;
  onClose: () => void;
}

const COPYRIGHT_STATUSES = [
  { value: '', label: 'Not specified' },
  { value: 'public_domain', label: 'Public Domain' },
  { value: 'in_copyright', label: 'In Copyright' },
  { value: 'copyright_unknown', label: 'Copyright Unknown' },
  { value: 'orphan_work', label: 'Orphan Work' },
  { value: 'no_known_copyright', label: 'No Known Copyright' },
];

const LICENSES = [
  { value: '', label: 'Not specified' },
  { value: 'CC0', label: 'CC0 (Public Domain)' },
  { value: 'CC-BY', label: 'CC BY (Attribution)' },
  { value: 'CC-BY-SA', label: 'CC BY-SA (Attribution-ShareAlike)' },
  { value: 'CC-BY-NC', label: 'CC BY-NC (Attribution-NonCommercial)' },
  { value: 'CC-BY-NC-SA', label: 'CC BY-NC-SA (Attribution-NonCommercial-ShareAlike)' },
  { value: 'CC-BY-ND', label: 'CC BY-ND (Attribution-NoDerivatives)' },
  { value: 'CC-BY-NC-ND', label: 'CC BY-NC-ND (Attribution-NonCommercial-NoDerivatives)' },
  { value: 'all_rights_reserved', label: 'All Rights Reserved' },
  { value: 'custom', label: 'Custom License' },
];

export function MetadataTemplateModal({
  organizationId,
  templateToEdit,
  onClose,
}: MetadataTemplateModalProps) {
  const queryClient = useQueryClient();
  const fid = useId();
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen: true,
    onClose,
    titlePrefix: 'metadata-template-modal',
  });

  const isEditing = !!templateToEdit;

  // Basic info
  const [name, setName] = useState(templateToEdit?.name || '');
  const [description, setDescription] = useState(templateToEdit?.description || '');
  const [isDefault, setIsDefault] = useState(templateToEdit?.is_default || false);

  // Template fields
  const [titlePrefix, setTitlePrefix] = useState(templateToEdit?.template_fields?.title_prefix || '');
  const [titleSuffix, setTitleSuffix] = useState(templateToEdit?.template_fields?.title_suffix || '');
  const [fieldDescription, setFieldDescription] = useState(templateToEdit?.template_fields?.description || '');
  const [altText, setAltText] = useState(templateToEdit?.template_fields?.alt_text || '');
  const [creator, setCreator] = useState(templateToEdit?.template_fields?.creator || '');
  const [credit, setCredit] = useState(templateToEdit?.template_fields?.credit || '');
  const [source, setSource] = useState(templateToEdit?.template_fields?.source || '');
  const [copyrightStatus, setCopyrightStatus] = useState(templateToEdit?.template_fields?.copyright_status || '');
  const [rightsStatement, setRightsStatement] = useState(templateToEdit?.template_fields?.rights_statement || '');
  const [license, setLicense] = useState(templateToEdit?.template_fields?.license || '');
  const [extraMetadata, setExtraMetadata] = useState<Array<{ key: string; value: string }>>(
    templateToEdit?.template_fields?.extra_metadata
      ? Object.entries(templateToEdit.template_fields.extra_metadata).map(([key, value]) => ({
          key,
          value: String(value),
        }))
      : []
  );

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      const templateFields: MetadataTemplateFields = {};

      // Only include non-empty values
      if (titlePrefix) templateFields.title_prefix = titlePrefix;
      if (titleSuffix) templateFields.title_suffix = titleSuffix;
      if (fieldDescription) templateFields.description = fieldDescription;
      if (altText) templateFields.alt_text = altText;
      if (creator) templateFields.creator = creator;
      if (credit) templateFields.credit = credit;
      if (source) templateFields.source = source;
      if (copyrightStatus) templateFields.copyright_status = copyrightStatus;
      if (rightsStatement) templateFields.rights_statement = rightsStatement;
      if (license) templateFields.license = license;
      if (extraMetadata.length > 0) {
        templateFields.extra_metadata = extraMetadata.reduce((acc, { key, value }) => {
          if (key.trim()) acc[key.trim()] = value;
          return acc;
        }, {} as Record<string, string>);
      }

      return createMetadataTemplate(organizationId, {
        name,
        description: description || null,
        template_fields: Object.keys(templateFields).length > 0 ? templateFields : null,
        is_default: isDefault,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metadata-templates', organizationId] });
      onClose();
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      const templateFields: MetadataTemplateFields = {};

      if (titlePrefix) templateFields.title_prefix = titlePrefix;
      if (titleSuffix) templateFields.title_suffix = titleSuffix;
      if (fieldDescription) templateFields.description = fieldDescription;
      if (altText) templateFields.alt_text = altText;
      if (creator) templateFields.creator = creator;
      if (credit) templateFields.credit = credit;
      if (source) templateFields.source = source;
      if (copyrightStatus) templateFields.copyright_status = copyrightStatus;
      if (rightsStatement) templateFields.rights_statement = rightsStatement;
      if (license) templateFields.license = license;
      if (extraMetadata.length > 0) {
        templateFields.extra_metadata = extraMetadata.reduce((acc, { key, value }) => {
          if (key.trim()) acc[key.trim()] = value;
          return acc;
        }, {} as Record<string, string>);
      }

      return updateMetadataTemplate(organizationId, templateToEdit!.template_id, {
        name,
        description: description || null,
        template_fields: Object.keys(templateFields).length > 0 ? templateFields : null,
        is_default: isDefault,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metadata-templates', organizationId] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEditing) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const mutationError = createMutation.error || updateMutation.error;
  const isValid = name.trim().length > 0;

  // Extra metadata handling
  const addMetadataField = () => {
    setExtraMetadata([...extraMetadata, { key: '', value: '' }]);
  };

  const updateMetadataField = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...extraMetadata];
    updated[index][field] = value;
    setExtraMetadata(updated);
  };

  const removeMetadataField = (index: number) => {
    setExtraMetadata(extraMetadata.filter((_, i) => i !== index));
  };

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50">
      <div aria-hidden="true" className="absolute inset-0" onClick={onClose} />
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stopPropagation only: keeps dialog clicks from bubbling to React ancestors through the portal */}
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        className="relative bg-parchment rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-lichen flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold text-ink">
            {isEditing ? 'Edit Metadata Template' : 'Create Metadata Template'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-stone rounded text-archive"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form id="metadata-template-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          <p id={descriptionId} className="sr-only">
            {isEditing ? 'Edit an existing metadata template' : 'Create a new metadata template for your media'}
          </p>

          {/* Basic Info Section */}
          <section>
            <h3 className="text-sm font-semibold text-ink mb-3 uppercase tracking-wide">Basic Info</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor={`${fid}-name`} className="block text-sm font-medium text-ink mb-1">
                  Template Name <span className="text-semantic-error">*</span>
                </label>
                <input
                  id={`${fid}-name`}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  placeholder="e.g., Photo Shoot January 2024"
                  required
                />
              </div>
              <div>
                <label htmlFor={`${fid}-template-description`} className="block text-sm font-medium text-ink mb-1">Description</label>
                <textarea
                  id={`${fid}-template-description`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 resize-none"
                  rows={2}
                  placeholder="Describe when to use this template..."
                />
              </div>
            </div>
          </section>

          {/* Title Modification Section */}
          <section>
            <h3 className="text-sm font-semibold text-ink mb-3 uppercase tracking-wide">Title Modification</h3>
            <p className="text-xs text-archive mb-3">Add a prefix or suffix to existing asset titles</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor={`${fid}-title-prefix`} className="block text-sm font-medium text-ink mb-1">Title Prefix</label>
                <input
                  id={`${fid}-title-prefix`}
                  type="text"
                  value={titlePrefix}
                  onChange={(e) => setTitlePrefix(e.target.value)}
                  className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  placeholder="e.g., [Event Name] "
                />
              </div>
              <div>
                <label htmlFor={`${fid}-title-suffix`} className="block text-sm font-medium text-ink mb-1">Title Suffix</label>
                <input
                  id={`${fid}-title-suffix`}
                  type="text"
                  value={titleSuffix}
                  onChange={(e) => setTitleSuffix(e.target.value)}
                  className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  placeholder="e.g.,  - 2024"
                />
              </div>
            </div>
          </section>

          {/* Descriptive Metadata Section */}
          <section>
            <h3 className="text-sm font-semibold text-ink mb-3 uppercase tracking-wide">Descriptive Metadata</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor={`${fid}-description`} className="block text-sm font-medium text-ink mb-1">Description</label>
                <textarea
                  id={`${fid}-description`}
                  value={fieldDescription}
                  onChange={(e) => setFieldDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 resize-none"
                  rows={2}
                  placeholder="Default description for assets..."
                />
              </div>
              <div>
                <label htmlFor={`${fid}-alt-text`} className="block text-sm font-medium text-ink mb-1">Alt Text</label>
                <input
                  id={`${fid}-alt-text`}
                  type="text"
                  value={altText}
                  onChange={(e) => setAltText(e.target.value)}
                  className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  placeholder="Default alt text for accessibility..."
                />
              </div>
            </div>
          </section>

          {/* Attribution Section */}
          <section>
            <h3 className="text-sm font-semibold text-ink mb-3 uppercase tracking-wide">Attribution</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor={`${fid}-creator`} className="block text-sm font-medium text-ink mb-1">Creator</label>
                <input
                  id={`${fid}-creator`}
                  type="text"
                  value={creator}
                  onChange={(e) => setCreator(e.target.value)}
                  className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  placeholder="e.g., John Smith"
                />
              </div>
              <div>
                <label htmlFor={`${fid}-credit`} className="block text-sm font-medium text-ink mb-1">Credit</label>
                <input
                  id={`${fid}-credit`}
                  type="text"
                  value={credit}
                  onChange={(e) => setCredit(e.target.value)}
                  className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  placeholder="e.g., Photo by John Smith"
                />
              </div>
              <div className="col-span-2">
                <label htmlFor={`${fid}-source`} className="block text-sm font-medium text-ink mb-1">Source</label>
                <input
                  id={`${fid}-source`}
                  type="text"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  placeholder="e.g., Organization Archives"
                />
              </div>
            </div>
          </section>

          {/* Rights & Licensing Section */}
          <section>
            <h3 className="text-sm font-semibold text-ink mb-3 uppercase tracking-wide">Rights & Licensing</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`${fid}-copyright-status`} className="block text-sm font-medium text-ink mb-1">Copyright Status</label>
                  <select
                    id={`${fid}-copyright-status`}
                    value={copyrightStatus}
                    onChange={(e) => setCopyrightStatus(e.target.value)}
                    className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  >
                    {COPYRIGHT_STATUSES.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${fid}-license`} className="block text-sm font-medium text-ink mb-1">License</label>
                  <select
                    id={`${fid}-license`}
                    value={license}
                    onChange={(e) => setLicense(e.target.value)}
                    className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  >
                    {LICENSES.map((lic) => (
                      <option key={lic.value} value={lic.value}>
                        {lic.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor={`${fid}-rights-statement`} className="block text-sm font-medium text-ink mb-1">Rights Statement</label>
                <textarea
                  id={`${fid}-rights-statement`}
                  value={rightsStatement}
                  onChange={(e) => setRightsStatement(e.target.value)}
                  className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 resize-none"
                  rows={2}
                  placeholder="e.g., All rights reserved. Contact organization for usage permissions."
                />
              </div>
            </div>
          </section>

          {/* Custom Metadata Section */}
          <section>
            <h3 className="text-sm font-semibold text-ink mb-3 uppercase tracking-wide">Custom Metadata</h3>
            <p className="text-xs text-archive mb-3">Add custom key-value pairs (will merge with existing metadata)</p>
            <div className="space-y-2">
              {extraMetadata.map((field, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={field.key}
                    onChange={(e) => updateMetadataField(index, 'key', e.target.value)}
                    className="w-1/3 px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    placeholder="Key"
                    aria-label={`Custom field ${index + 1} key`}
                  />
                  <input
                    type="text"
                    value={field.value}
                    onChange={(e) => updateMetadataField(index, 'value', e.target.value)}
                    className="flex-1 px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    placeholder="Value"
                    aria-label={`Custom field ${index + 1} value`}
                  />
                  <button
                    type="button"
                    onClick={() => removeMetadataField(index)}
                    aria-label={`Remove custom field ${index + 1}`}
                    className="p-2 text-archive hover:text-semantic-error"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addMetadataField}
                className="flex items-center gap-1 text-sm text-bark hover:text-copper-dark"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add custom field
              </button>
            </div>
          </section>

          {/* Default checkbox */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="is-default"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            <label htmlFor="is-default" className="text-sm text-ink">
              Set as default metadata template
            </label>
          </div>

          {/* Error */}
          {mutationError && (
            <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-sm text-semantic-error">
              {(mutationError as Error)?.message || 'Failed to save template'}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3 bg-parchment">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-stone rounded-sm bg-parchment text-ink hover:bg-stone/20 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="metadata-template-form"
            disabled={!isValid || isPending}
            className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isPending && <Loader2 size={16} className="animate-spin" />}
            {isEditing ? 'Save Changes' : 'Create Template'}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
