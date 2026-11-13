import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { getDeleteSettings, updateDeleteSettings } from '../lib/api';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';
import { MadronaLoader } from './ui/MadronaLoader';
import { useAuth } from '../hooks/useAuth';
import { ModalPortal } from './ModalPortal';

interface DeleteSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  pipelineId: string;
}

export default function DeleteSettingsModal({
  isOpen,
  onClose,
  pipelineId,
}: DeleteSettingsModalProps) {
  const queryClient = useQueryClient();
  const { activeOrganizationId } = useAuth();
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'delete-settings',
  });

  // Local state for form
  const [enabled, setEnabled] = useState(false);
  const [method, setMethod] = useState<'full_sync' | 'incremental'>('full_sync');
  const [strategy, setStrategy] = useState<'remove' | 'mark' | 'archive'>('remove');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Fetch current settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ['deleteSettings', pipelineId, activeOrganizationId],
    queryFn: () => getDeleteSettings(pipelineId, activeOrganizationId!),
    enabled: isOpen && !!activeOrganizationId,
  });

  // Update local state when settings load
  useEffect(() => {
    if (settings) {
      setEnabled(settings.delete_detection_enabled);
      setMethod(settings.delete_detection_method);
      setStrategy(settings.delete_strategy);
    }
  }, [settings]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      return updateDeleteSettings(pipelineId, activeOrganizationId!, {
        delete_detection_enabled: enabled,
        delete_detection_method: method,
        delete_strategy: strategy,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deleteSettings', pipelineId] });
      queryClient.invalidateQueries({ queryKey: ['pipeline', pipelineId] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    },
  });

  if (!isOpen) return null;

  return (
    <ModalPortal>
    {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- backdrop click-to-dismiss; Escape closes via useAccessibleModal */}
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={modalRef}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        {...getModalAriaProps(titleId, descriptionId)}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen flex items-center justify-between">
          <h2 id={titleId} className="m-0 text-lg font-semibold text-ink">
            Delete Detection Settings
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-archive hover:text-ink transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <p id={descriptionId} className="text-sm text-archive">
            Configure how deleted records are detected and handled during pipeline syncs.
          </p>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <MadronaLoader />
            </div>
          ) : (
            <>
              {/* Enable/Disable Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <label htmlFor="delete-settings-enabled" className="block text-sm font-medium text-ink mb-1">
                    Enable Delete Detection
                  </label>
                  <p id="delete-settings-enabled-description" className="text-xs text-archive">
                    Automatically detect and handle deleted records
                  </p>
                </div>
                <button
                  id="delete-settings-enabled"
                  type="button"
                  role="switch"
                  aria-describedby="delete-settings-enabled-description"
                  aria-checked={enabled}
                  onClick={() => setEnabled(!enabled)}
                  className={`
                    relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                    transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2
                    ${enabled ? 'bg-bark' : 'bg-stone'}
                  `}
                >
                  <span
                    className={`
                      pointer-events-none inline-block h-5 w-5 transform rounded-full bg-parchment shadow ring-0
                      transition duration-200 ease-in-out
                      ${enabled ? 'translate-x-5' : 'translate-x-0'}
                    `}
                  />
                </button>
              </div>

              {enabled && (
                <>
                  {/* Detection Method */}
                  <fieldset>
                    <legend className="block text-sm font-medium text-ink mb-1">
                      Detection Method
                    </legend>
                    <div className="space-y-2">
                      <div className="flex items-start">
                        <input
                          id="delete-settings-method-full-sync"
                          type="radio"
                          name="method"
                          value="full_sync"
                          checked={method === 'full_sync'}
                          onChange={() => setMethod('full_sync')}
                          className="mt-1 h-4 w-4 text-bark border-stone focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                          aria-describedby="delete-settings-method-full-sync-description"
                        />
                        <div className="ml-3">
                          <label htmlFor="delete-settings-method-full-sync" className="text-sm font-medium text-ink">Full Sync Comparison</label>
                          <p id="delete-settings-method-full-sync-description" className="text-xs text-archive">
                            Compare extracted entities against known records. Entities not seen during
                            a full sync are considered deleted.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start">
                        <input
                          id="delete-settings-method-incremental"
                          type="radio"
                          name="method"
                          value="incremental"
                          checked={method === 'incremental'}
                          onChange={() => setMethod('incremental')}
                          className="mt-1 h-4 w-4 text-bark border-stone focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                          aria-describedby="delete-settings-method-incremental-description"
                        />
                        <div className="ml-3">
                          <label htmlFor="delete-settings-method-incremental" className="text-sm font-medium text-ink">Incremental Markers</label>
                          <p id="delete-settings-method-incremental-description" className="text-xs text-archive">
                            Process explicit delete events from the source (CDC, webhooks). Requires
                            source system to emit delete markers.
                          </p>
                        </div>
                      </div>
                    </div>
                  </fieldset>

                  {/* Delete Strategy */}
                  <fieldset>
                    <legend className="block text-sm font-medium text-ink mb-1">
                      Delete Strategy
                    </legend>
                    <div className="space-y-2">
                      <div className="flex items-start">
                        <input
                          id="delete-settings-strategy-remove"
                          type="radio"
                          name="strategy"
                          value="remove"
                          checked={strategy === 'remove'}
                          onChange={() => setStrategy('remove')}
                          className="mt-1 h-4 w-4 text-bark border-stone focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                          aria-describedby="delete-settings-strategy-remove-description"
                        />
                        <div className="ml-3">
                          <label htmlFor="delete-settings-strategy-remove" className="text-sm font-medium text-ink">Remove</label>
                          <p id="delete-settings-strategy-remove-description" className="text-xs text-archive">
                            Soft-delete entities from the canonical store. They won't appear in
                            queries or be published to destinations.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start">
                        <input
                          id="delete-settings-strategy-mark"
                          type="radio"
                          name="strategy"
                          value="mark"
                          checked={strategy === 'mark'}
                          onChange={() => setStrategy('mark')}
                          className="mt-1 h-4 w-4 text-bark border-stone focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                          aria-describedby="delete-settings-strategy-mark-description"
                        />
                        <div className="ml-3">
                          <label htmlFor="delete-settings-strategy-mark" className="text-sm font-medium text-ink">Mark</label>
                          <p id="delete-settings-strategy-mark-description" className="text-xs text-archive">
                            Flag entities as deleted but keep them visible. Useful when you want
                            to review deletions before removing them.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start">
                        <input
                          id="delete-settings-strategy-archive"
                          type="radio"
                          name="strategy"
                          value="archive"
                          checked={strategy === 'archive'}
                          onChange={() => setStrategy('archive')}
                          className="mt-1 h-4 w-4 text-bark border-stone focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                          aria-describedby="delete-settings-strategy-archive-description"
                        />
                        <div className="ml-3">
                          <label htmlFor="delete-settings-strategy-archive" className="text-sm font-medium text-ink">Archive</label>
                          <p id="delete-settings-strategy-archive-description" className="text-xs text-archive">
                            Move deleted entities to an archive with full metadata. Supports
                            restoration if needed later.
                          </p>
                        </div>
                      </div>
                    </div>
                  </fieldset>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex items-center justify-between">
          <div>
            {saveSuccess && (
              <span className="text-sm text-semantic-success flex items-center">
                <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Settings saved
              </span>
            )}
            {saveMutation.isError && (
              <span className="text-sm text-semantic-error">
                Failed to save settings
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-stone rounded-sm bg-parchment text-sm text-ink hover:bg-stone/20 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || isLoading}
              className="px-4 py-2 bg-bark text-parchment rounded-sm text-sm hover:bg-bark/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
