/**
 * MediaBulkActionDialog - Execute bulk actions on media workspace assets
 *
 * Multi-step wizard for:
 * 1. Select action and configure parameters
 * 2. Preview affected assets with warnings
 * 3. Validate (check permissions/business rules)
 * 4. Execute and show results
 */

import { useState, useEffect, useMemo } from 'react';
import Checkbox from '../Checkbox';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  X,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  Check,
  XCircle,
  Loader2,
  Image,
  Download,
  Tag,
  FolderInput,
  FileText,
  Shield,
  Layers,
  Zap,
} from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { MadronaLoader } from '../ui/MadronaLoader';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { cn, formatFileSize } from '../../lib/utils';
import {
  listMediaBulkActions,
  previewMediaBulkAction,
  validateMediaBulkAction,
  executeMediaBulkAction,
  listMediaFolders,
  getMediaWorkspaces,
  getMetadataTemplates,
  listTagDefinitions,
  listTagValuesForDefinition,
} from '../../lib/api';
import type { MediaTagDefinition, MediaTagValue } from '../../lib/schemas';
import type {
  MediaBulkActionConfig,
  MediaBulkActionPreviewResult,
  MediaBulkActionValidateResult,
  MediaBulkActionExecuteResult,
} from '../../lib/schemas';
import { ModalPortal } from '../ModalPortal';

interface MediaBulkActionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  workspaceName: string;
  assetCount: number;
  selectedMediaIds?: string[];
}

type Step = 'select' | 'configure' | 'preview' | 'validate' | 'execute' | 'results';

const actionIcons: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  download_assets: Download,
  bulk_tag: Tag,
  move_to_folder: FolderInput,
  add_to_lightbox: Layers,
  apply_metadata_template: FileText,
  set_rights_policy: Shield,
  create_renditions: Layers,
};

export default function MediaBulkActionDialog({
  isOpen,
  onClose,
  workspaceId,
  workspaceName,
  assetCount,
  selectedMediaIds,
}: MediaBulkActionDialogProps) {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;

  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'media-bulk-action-dialog',
  });

  const [step, setStep] = useState<Step>('select');
  const [selectedAction, setSelectedAction] = useState<MediaBulkActionConfig | null>(null);
  const [actionParams, setActionParams] = useState<Record<string, unknown>>({});
  const [previewData, setPreviewData] = useState<MediaBulkActionPreviewResult | null>(null);
  const [validateData, setValidateData] = useState<MediaBulkActionValidateResult | null>(null);
  const [executeData, setExecuteData] = useState<MediaBulkActionExecuteResult | null>(null);
  const [skipBlocked, setSkipBlocked] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch available actions
  const { data: actionsData, isLoading: isLoadingActions } = useQuery({
    queryKey: ['media-bulk-actions', orgId, workspaceId],
    queryFn: () => listMediaBulkActions(orgId!, workspaceId),
    enabled: !!orgId && !!workspaceId && isOpen,
  });

  // Fetch folders for move action
  const { data: foldersData } = useQuery({
    queryKey: ['media-folders', orgId],
    queryFn: () => listMediaFolders(orgId!),
    enabled: !!orgId && isOpen && selectedAction?.key === 'move_to_folder',
  });

  // Fetch lightboxes (media workspaces) for the add_to_lightbox picker.
  // Pulls a generous page so most orgs see their full list inline.
  const { data: lightboxesData } = useQuery({
    queryKey: ['media-workspaces-picker', orgId],
    queryFn: () => getMediaWorkspaces(orgId!, { limit: 200, filter: 'all' }),
    enabled: !!orgId && isOpen && selectedAction?.key === 'add_to_lightbox',
  });

  // Fetch metadata templates for apply_metadata_template action
  const { data: templatesData } = useQuery({
    queryKey: ['metadata-templates', orgId],
    queryFn: () => getMetadataTemplates(orgId!),
    enabled: !!orgId && isOpen && selectedAction?.key === 'apply_metadata_template',
  });

  // Fetch tag definitions for the bulk_tag category picker
  const { data: tagDefinitionsData } = useQuery({
    queryKey: ['tag-definitions', orgId, false],
    queryFn: () => listTagDefinitions(orgId!, { includeInactive: false }),
    enabled: !!orgId && isOpen && selectedAction?.key === 'bulk_tag',
    staleTime: 60_000,
  });
  const definitionId = (actionParams.definition_id as string | undefined) || '';
  const selectedDefinition = useMemo(() => {
    return (tagDefinitionsData?.definitions ?? []).find((d) => d.definition_id === definitionId);
  }, [tagDefinitionsData, definitionId]);

  // Fetch allowed values for the chosen definition (controlled types only).
  const { data: tagValuesData } = useQuery({
    queryKey: ['tag-values', orgId, definitionId],
    queryFn: () => listTagValuesForDefinition(orgId!, definitionId),
    enabled:
      !!orgId &&
      isOpen &&
      selectedAction?.key === 'bulk_tag' &&
      !!selectedDefinition &&
      selectedDefinition.field_type !== 'text' &&
      selectedDefinition.field_type !== 'date',
    staleTime: 60_000,
  });

  // Preview mutation
  const previewMutation = useMutation({
    mutationFn: () => previewMediaBulkAction(orgId!, workspaceId, selectedAction!.key, actionParams, selectedMediaIds),
    onSuccess: (data) => {
      setPreviewData(data);
      setError(null);
      setStep('preview');
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to preview action');
    },
  });

  // Validate mutation
  const validateMutation = useMutation({
    mutationFn: () => validateMediaBulkAction(orgId!, workspaceId, selectedAction!.key, actionParams, selectedMediaIds),
    onSuccess: (data) => {
      setValidateData(data);
      setError(null);
      setStep('validate');
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to validate action');
    },
  });

  // Execute mutation
  const executeMutation = useMutation({
    mutationFn: () =>
      executeMediaBulkAction(orgId!, workspaceId, selectedAction!.key, actionParams, selectedMediaIds, skipBlocked),
    onSuccess: (data) => {
      setExecuteData(data);
      setError(null);
      setStep('results');
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to execute action');
    },
  });

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setStep('select');
      setSelectedAction(null);
      setActionParams({});
      setPreviewData(null);
      setValidateData(null);
      setExecuteData(null);
      setError(null);
    }
  }, [isOpen]);

  const handleSelectAction = (action: MediaBulkActionConfig) => {
    setSelectedAction(action);
    setActionParams({});
    setStep('configure');
  };

  const handleBack = () => {
    if (step === 'configure') setStep('select');
    else if (step === 'preview') setStep('configure');
    else if (step === 'validate') setStep('preview');
  };

  const handleNext = () => {
    if (step === 'configure') {
      // Validate required params
      const missing = selectedAction!.required_params.filter((p: string) => !actionParams[p]);
      if (missing.length > 0) {
        setError(`Missing required fields: ${missing.join(', ')}`);
        return;
      }
      setError(null);
      previewMutation.mutate();
    } else if (step === 'preview') {
      validateMutation.mutate();
    } else if (step === 'validate') {
      setStep('execute');
    }
  };

  const handleExecute = () => {
    executeMutation.mutate();
  };

  if (!isOpen) return null;

  const isLoading = previewMutation.isPending || validateMutation.isPending || executeMutation.isPending;
  const effectiveAssetCount = selectedMediaIds?.length || assetCount;

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        onClick={(e) => e.stopPropagation()}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center justify-between">
            <div>
              <h2 id={titleId} className="text-lg font-semibold text-ink flex items-center gap-2">
                <Zap size={20} className="text-bark" />
                Quick Actions
              </h2>
              <p id={descriptionId} className="text-sm text-archive">
                {workspaceName} ({effectiveAssetCount} asset{effectiveAssetCount !== 1 ? 's' : ''})
              </p>
            </div>
            <button onClick={onClose} className="p-1 text-archive hover:text-ink rounded">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center gap-1 px-6 py-2 bg-stone/30 border-b border-lichen">
          {(['select', 'configure', 'preview', 'validate', 'execute', 'results'] as Step[]).map(
            (s, idx) => (
              <div key={s} className="flex items-center">
                <div
                  className={cn(
                    'w-2 h-2 rounded-full',
                    step === s
                      ? 'bg-bark'
                      : ['select', 'configure', 'preview', 'validate', 'execute', 'results'].indexOf(
                          step
                        ) > idx
                      ? 'bg-bark/50'
                      : 'bg-lichen'
                  )}
                />
                {idx < 5 && <div className="w-6 h-px bg-lichen mx-1" />}
              </div>
            )
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-sm text-semantic-error flex items-start gap-2">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Step: Select Action */}
          {step === 'select' && (
            <div>
              <h3 className="text-sm font-medium text-ink mb-3">Select an action</h3>
              {isLoadingActions ? (
                <div className="text-center py-8 text-archive">Loading actions...</div>
              ) : !actionsData?.actions.length ? (
                <div className="text-center py-8 text-archive">
                  No actions available. You may need additional permissions.
                </div>
              ) : (
                <div className="space-y-2">
                  {actionsData.actions.map((action) => {
                    const Icon = actionIcons[action.key] || Zap;
                    return (
                      <button
                        key={action.key}
                        onClick={() => handleSelectAction(action)}
                        className="w-full flex items-center gap-3 p-4 border border-lichen rounded-sm text-left hover:border-bark/50 hover:bg-bark/5 transition-colors"
                      >
                        <div className="p-2 bg-bark/10 rounded-sm">
                          <Icon size={20} className="text-bark" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-ink">{action.label}</div>
                          <div className="text-sm text-archive">{action.description}</div>
                        </div>
                        <ChevronRight size={16} className="text-archive" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Step: Configure */}
          {step === 'configure' && selectedAction && (
            <div>
              <h3 className="text-sm font-medium text-ink mb-3">Configure: {selectedAction.label}</h3>

              {selectedAction.key === 'download_assets' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      Download Format
                    </label>
                    <select
                      value={(actionParams.derivative_type as string) || 'original'}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, derivative_type: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      {(selectedAction as MediaBulkActionConfig & { download_options?: { value: string; label: string }[] }).download_options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      )) || (
                        <option value="original">Original Files</option>
                      )}
                    </select>
                  </div>
                  <p className="text-sm text-archive">
                    Assets will be packaged into a ZIP file for download.
                  </p>
                </div>
              )}

              {selectedAction.key === 'bulk_tag' && (
                <BulkTagPicker
                  definitions={tagDefinitionsData?.definitions ?? []}
                  selectedDefinition={selectedDefinition}
                  values={tagValuesData?.values ?? []}
                  mode={(actionParams.mode as 'append' | 'remove' | 'replace') || 'append'}
                  selectedValueIds={(actionParams.value_ids as string[] | undefined) ?? []}
                  freeformValues={(actionParams.values as string[] | undefined) ?? []}
                  onChange={(update) => setActionParams({ ...actionParams, ...update })}
                />
              )}

              {selectedAction.key === 'move_to_folder' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      Destination Folder <span className="text-semantic-error">*</span>
                    </label>
                    <select
                      value={(actionParams.folder_id as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, folder_id: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">Select folder...</option>
                      <option value="unfiled">Unfiled (Root)</option>
                      {(foldersData?.folders as { folder_id: string; name: string; depth?: number }[] | undefined)?.map((folder) => (
                        <option key={folder.folder_id} value={folder.folder_id}>
                          {'—'.repeat(folder.depth || 0)} {folder.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {selectedAction.key === 'set_rights_policy' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      Copyright Status <span className="text-semantic-error">*</span>
                    </label>
                    <select
                      value={(actionParams.copyright_status as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, copyright_status: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">Select status...</option>
                      <option value="public_domain">Public Domain</option>
                      <option value="cc0">CC0 (No Rights Reserved)</option>
                      <option value="cc_by">CC BY (Attribution)</option>
                      <option value="cc_by_sa">CC BY-SA (Attribution-ShareAlike)</option>
                      <option value="cc_by_nc">CC BY-NC (Attribution-NonCommercial)</option>
                      <option value="in_copyright">In Copyright</option>
                      <option value="rights_reserved">All Rights Reserved</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">Rights Statement (optional)</label>
                    <textarea
                      value={(actionParams.rights_statement as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, rights_statement: e.target.value })
                      }
                      rows={2}
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      placeholder="Additional rights information..."
                    />
                  </div>
                </div>
              )}

              {selectedAction.key === 'create_renditions' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      Rendition Types <span className="text-semantic-error">*</span>
                    </label>
                    <div className="space-y-2">
                      {[
                        { value: 'thumbnail', label: 'Thumbnail (200px)' },
                        { value: 'small', label: 'Small (600px)' },
                        { value: 'medium', label: 'Medium (1200px)' },
                        { value: 'large', label: 'Large (2000px)' },
                        { value: 'webp', label: 'WebP Format' },
                      ].map((type) => (
                        <label key={type.value} className="flex items-center gap-2">
                          <Checkbox
                            checked={(actionParams.rendition_types as string[] || []).includes(type.value)}
                            onChange={(e) => {
                              const current = (actionParams.rendition_types as string[]) || [];
                              const updated = e.target.checked
                                ? [...current, type.value]
                                : current.filter((t) => t !== type.value);
                              setActionParams({ ...actionParams, rendition_types: updated });
                            }}
                            className="rounded border-lichen"
                          />
                          <span className="text-sm">{type.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {selectedAction.key === 'add_to_lightbox' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      Target Lightbox <span className="text-semantic-error">*</span>
                    </label>
                    {(() => {
                      const allLightboxes = (lightboxesData?.items ?? []) as {
                        workspace_id: string;
                        name: string;
                        asset_count?: number;
                      }[];
                      // Exclude the source workspace — adding it to itself is a no-op.
                      const targets = allLightboxes.filter(
                        (lb) => lb.workspace_id !== workspaceId,
                      );
                      const noOptions = targets.length === 0;
                      return (
                        <>
                          <select
                            value={(actionParams.target_workspace_id as string) || ''}
                            onChange={(e) =>
                              setActionParams({
                                ...actionParams,
                                target_workspace_id: e.target.value,
                              })
                            }
                            disabled={noOptions}
                            className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark disabled:bg-stone/40 disabled:text-archive"
                          >
                            <option value="">Select a lightbox…</option>
                            {targets.map((lb) => (
                              <option key={lb.workspace_id} value={lb.workspace_id}>
                                {lb.name}
                                {typeof lb.asset_count === 'number'
                                  ? ` (${lb.asset_count})`
                                  : ''}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-archive mt-1">
                            {noOptions
                              ? 'No other lightboxes available — create one first.'
                              : 'Pick a lightbox to copy these assets into. The source work set is excluded.'}
                          </p>
                        </>
                      );
                    })()}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">Note (optional)</label>
                    <textarea
                      value={(actionParams.note as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, note: e.target.value })
                      }
                      rows={2}
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      placeholder="Add a note for these assets..."
                    />
                  </div>
                </div>
              )}

              {selectedAction.key === 'apply_metadata_template' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      Metadata Template <span className="text-semantic-error">*</span>
                    </label>
                    <select
                      value={(actionParams.template_id as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, template_id: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">Select template...</option>
                      {templatesData?.templates?.map((template) => (
                        <option key={template.template_id} value={template.template_id}>
                          {template.name}
                          {template.is_default ? ' (Default)' : ''}
                        </option>
                      ))}
                    </select>
                    {templatesData?.templates?.length === 0 && (
                      <p className="text-xs text-archive mt-1">
                        No templates available. Create one in Media Settings.
                      </p>
                    )}
                  </div>
                  {!!actionParams.template_id && templatesData?.templates && (
                    <div className="p-3 bg-stone/30 rounded-sm text-sm">
                      {(() => {
                        const selected = templatesData.templates.find(
                          (t) => t.template_id === actionParams.template_id
                        );
                        if (!selected) return null;
                        const fields = selected.template_fields || {};
                        const fieldCount = Object.entries(fields).filter(
                          ([_, v]) => v && (Array.isArray(v) ? v.length > 0 : true)
                        ).length;
                        return (
                          <div>
                            {selected.description && (
                              <p className="text-archive mb-2">{selected.description}</p>
                            )}
                            <p className="text-archive">
                              {fieldCount} field{fieldCount !== 1 ? 's' : ''} will be applied
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  <div>
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={(actionParams.overwrite_existing as boolean) || false}
                        onChange={(e) =>
                          setActionParams({ ...actionParams, overwrite_existing: e.target.checked })
                        }
                      />
                      <span className="text-sm text-ink">Overwrite existing values</span>
                    </label>
                    <p className="text-xs text-archive mt-1 ml-6">
                      When unchecked, template values are only applied to empty fields.
                      Tags are always merged regardless of this setting.
                    </p>
                  </div>
                </div>
              )}

              {/* Generic fallback for unknown actions */}
              {!['download_assets', 'bulk_tag', 'move_to_folder', 'set_rights_policy', 'create_renditions', 'add_to_lightbox', 'apply_metadata_template'].includes(selectedAction.key) && (
                <div className="text-sm text-archive">
                  Configure {selectedAction.label} parameters as needed.
                </div>
              )}
            </div>
          )}

          {/* Step: Preview */}
          {step === 'preview' && previewData && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-ink">
                  Preview: {previewData.total_count} asset{previewData.total_count !== 1 ? 's' : ''}
                </h3>
                {previewData.has_warnings && (
                  <span className="text-xs text-semantic-warning flex items-center gap-1">
                    <AlertTriangle size={12} />
                    {previewData.assets.filter(a => a.warnings.length > 0).length} asset(s) have warnings
                  </span>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto border border-lichen rounded-sm">
                {previewData.assets.map((asset) => (
                  <div
                    key={asset.media_id}
                    className="flex items-center gap-3 p-3 border-b border-lichen last:border-b-0"
                  >
                    {asset.thumbnail_url ? (
                      <img
                        src={asset.thumbnail_url}
                        alt=""
                        className="w-10 h-10 object-cover rounded"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-stone/50 rounded flex items-center justify-center">
                        <Image size={16} className="text-archive" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink truncate">
                        {asset.title || asset.filename || 'Untitled'}
                      </div>
                      {asset.file_size && (
                        <div className="text-xs text-archive">{formatFileSize(asset.file_size)}</div>
                      )}
                    </div>
                    {asset.warnings.length > 0 && (
                      <div className="flex items-center gap-1 text-xs text-semantic-warning">
                        <AlertTriangle size={14} className="flex-shrink-0" />
                        <span>{asset.warnings.join('; ')}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step: Validate */}
          {step === 'validate' && validateData && (
            <div>
              <h3 className="text-sm font-medium text-ink mb-3">Validation Results</h3>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="p-3 bg-semantic-success/10 border border-semantic-success/30 rounded-sm">
                  <div className="text-2xl font-bold text-semantic-success">
                    {validateData.allowed_count}
                  </div>
                  <div className="text-sm text-semantic-success">Ready to process</div>
                </div>
                {validateData.blocked_count > 0 && (
                  <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm">
                    <div className="text-2xl font-bold text-semantic-error">
                      {validateData.blocked_count}
                    </div>
                    <div className="text-sm text-semantic-error">Blocked</div>
                  </div>
                )}
              </div>

              {validateData.blocked.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-xs font-medium text-archive uppercase mb-2">
                    Blocked Assets
                  </h4>
                  <div className="max-h-32 overflow-y-auto border border-lichen rounded-sm">
                    {validateData.blocked.map((asset) => (
                      <div
                        key={asset.media_id}
                        className="flex items-center justify-between p-2 border-b border-lichen last:border-b-0"
                      >
                        <div className="text-sm">
                          <span className="text-ink">{asset.title || asset.filename || 'Untitled'}</span>
                        </div>
                        <span className="text-xs text-semantic-error">{asset.reason}</span>
                      </div>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 mt-2 text-sm">
                    <Checkbox
                      checked={skipBlocked}
                      onChange={(e) => setSkipBlocked(e.target.checked)}
                    />
                    Skip blocked assets and continue with allowed
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Step: Execute confirmation */}
          {step === 'execute' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-bark/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Zap size={32} className="text-bark" />
              </div>
              <h3 className="text-lg font-medium text-ink mb-2">Ready to Execute</h3>
              <p className="text-sm text-archive mb-4">
                {selectedAction?.label} will be applied to{' '}
                {validateData ? validateData.allowed_count : effectiveAssetCount} asset{(validateData?.allowed_count || effectiveAssetCount) !== 1 ? 's' : ''}.
              </p>
              {selectedAction?.key !== 'download_assets' && (
                <p className="text-xs text-archive">This action may not be undoable.</p>
              )}
            </div>
          )}

          {/* Step: Results */}
          {step === 'results' && executeData && (
            <div>
              <div
                className={cn(
                  'text-center py-6 mb-4 rounded-sm',
                  executeData.status === 'completed'
                    ? 'bg-semantic-success/10'
                    : 'bg-semantic-error/10'
                )}
              >
                {executeData.status === 'completed' ? (
                  <>
                    <Check size={32} className="text-semantic-success mx-auto mb-2" />
                    <h3 className="text-lg font-medium text-ink">Action Completed</h3>
                    <p className="text-sm text-archive">
                      Successfully processed {executeData.success_count} of {executeData.total_count}{' '}
                      asset{(executeData.total_count || 0) !== 1 ? 's' : ''}
                    </p>
                  </>
                ) : (
                  <>
                    <XCircle size={32} className="text-semantic-error mx-auto mb-2" />
                    <h3 className="text-lg font-medium text-ink">Action Failed</h3>
                    <p className="text-sm text-semantic-error">{executeData.message}</p>
                  </>
                )}
              </div>

              {executeData.results && executeData.results.length > 0 && (
                <>
                  <h4 className="text-xs font-medium text-archive uppercase mb-2">Results</h4>
                  <div className="max-h-48 overflow-y-auto border border-lichen rounded-sm">
                    {executeData.results.map((result) => (
                      <div
                        key={result.media_id}
                        className="flex items-center justify-between p-2 border-b border-lichen last:border-b-0"
                      >
                        <div className="text-sm">
                          <span className="text-ink">{result.filename || 'Asset'}</span>
                          {result.artifact_url && (
                            <a
                              href={result.artifact_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-2 text-xs text-bark hover:underline"
                            >
                              Download
                            </a>
                          )}
                        </div>
                        <span
                          className={cn(
                            'text-xs px-2 py-0.5 rounded',
                            result.status === 'success' && 'bg-semantic-success/10 text-semantic-success',
                            result.status === 'error' && 'bg-semantic-error/10 text-semantic-error',
                            result.status === 'skipped' && 'bg-stone text-archive'
                          )}
                        >
                          {result.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-between">
          <div>
            {step !== 'select' && step !== 'results' && (
              <button
                onClick={handleBack}
                disabled={isLoading}
                className="px-4 py-2 text-archive hover:text-ink transition-colors flex items-center gap-1 disabled:opacity-50"
              >
                <ChevronLeft size={16} />
                Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-archive hover:text-ink transition-colors"
            >
              {step === 'results' ? 'Close' : 'Cancel'}
            </button>
            {step !== 'select' && step !== 'results' && (
              <>
                {step === 'execute' ? (
                  <button
                    onClick={handleExecute}
                    disabled={isLoading}
                    className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {executeMutation.isPending ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Executing...
                      </>
                    ) : (
                      <>
                        <Zap size={16} />
                        Execute
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleNext}
                    disabled={isLoading}
                    className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    {isLoading ? (
                      <MadronaLoader variant="dots" />
                    ) : (
                      <>
                        Next
                        <ChevronRight size={16} />
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}


// ───────────────────────────────────────────────────────────────────────────
// BulkTagPicker — structured tag picker (category → values → mode)
// ───────────────────────────────────────────────────────────────────────────

interface BulkTagPickerUpdate {
  definition_id?: string;
  mode?: 'append' | 'remove' | 'replace';
  value_ids?: string[];
  values?: string[];
}

interface BulkTagPickerProps {
  definitions: MediaTagDefinition[];
  selectedDefinition: MediaTagDefinition | undefined;
  values: MediaTagValue[];
  mode: 'append' | 'remove' | 'replace';
  selectedValueIds: string[];
  freeformValues: string[];
  onChange: (update: BulkTagPickerUpdate) => void;
}

function BulkTagPicker({
  definitions,
  selectedDefinition,
  values,
  mode,
  selectedValueIds,
  freeformValues,
  onChange,
}: BulkTagPickerProps) {
  const [keywordInput, setKeywordInput] = useState('');

  const fieldType = selectedDefinition?.field_type;
  const isControlled =
    !!fieldType &&
    (fieldType === 'dropdown' ||
      fieldType === 'multi_select' ||
      fieldType === 'category_tree' ||
      fieldType === 'dynamic_keywords');

  const toggleValueId = (valueId: string) => {
    const next = selectedValueIds.includes(valueId)
      ? selectedValueIds.filter((v) => v !== valueId)
      : [...selectedValueIds, valueId];
    onChange({ value_ids: next });
  };

  const addKeyword = () => {
    const v = keywordInput.trim();
    if (!v) return;
    // Prefer an existing value_id if the typed text matches an allowed value.
    const existing = values.find((x) => x.value.toLowerCase() === v.toLowerCase());
    if (existing) {
      if (!selectedValueIds.includes(existing.value_id)) {
        onChange({ value_ids: [...selectedValueIds, existing.value_id] });
      }
    } else {
      if (!freeformValues.some((x) => x.toLowerCase() === v.toLowerCase())) {
        onChange({ values: [...freeformValues, v] });
      }
    }
    setKeywordInput('');
  };

  const removeKeyword = (raw: string) => {
    onChange({ values: freeformValues.filter((v) => v !== raw) });
  };

  const renderValuePicker = () => {
    if (!selectedDefinition || !isControlled) return null;

    // dropdown — single value
    if (fieldType === 'dropdown') {
      const current = selectedValueIds[0] ?? '';
      return (
        <select
          value={current}
          onChange={(e) => onChange({ value_ids: e.target.value ? [e.target.value] : [] })}
          className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
        >
          <option value="">Select a value…</option>
          {values.filter((v) => v.is_active).map((v) => (
            <option key={v.value_id} value={v.value_id}>
              {v.value}
            </option>
          ))}
        </select>
      );
    }

    // multi_select / category_tree — checkbox list
    if (fieldType === 'multi_select' || fieldType === 'category_tree') {
      const selectedSet = new Set(selectedValueIds);
      const visible = values.filter((v) => v.is_active);
      return (
        <div className="max-h-64 overflow-auto border border-lichen rounded-sm bg-parchment divide-y divide-lichen">
          {visible.length === 0 ? (
            <p className="text-sm text-archive italic p-3">No allowed values yet.</p>
          ) : (
            visible.map((v) => {
              const depth = fieldType === 'category_tree' ? (v.depth ?? 0) : 0;
              return (
                <label
                  key={v.value_id}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-stone/50 cursor-pointer"
                  style={{ paddingLeft: 12 + depth * 14 }}
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(v.value_id)}
                    onChange={() => toggleValueId(v.value_id)}
                  />
                  <span className="text-ink">{v.value}</span>
                </label>
              );
            })
          )}
        </div>
      );
    }

    // dynamic_keywords — chip picker with autocomplete + create
    if (fieldType === 'dynamic_keywords') {
      const selectedSet = new Set(selectedValueIds);
      const selectedValues = values.filter((v) => selectedSet.has(v.value_id));
      const normalized = keywordInput.trim().toLowerCase();
      const suggestions = values
        .filter((v) => v.is_active && !selectedSet.has(v.value_id))
        .filter((v) => !normalized || v.value.toLowerCase().includes(normalized))
        .slice(0, 15);
      const exact = values.some((v) => v.value.toLowerCase() === normalized);
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5 min-h-[2.5rem] px-2 py-1.5 border border-lichen rounded-sm bg-parchment">
            {selectedValues.map((v) => (
              <span key={v.value_id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-bark/10 text-xs text-ink">
                {v.value}
                <button
                  type="button"
                  onClick={() => toggleValueId(v.value_id)}
                  className="text-archive hover:text-semantic-error"
                  aria-label={`Remove ${v.value}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {freeformValues.map((v) => (
              <span key={`ff-${v}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-copper/10 text-xs text-ink" title="Will be created on apply">
                {v}
                <button
                  type="button"
                  onClick={() => removeKeyword(v)}
                  className="text-archive hover:text-semantic-error"
                  aria-label={`Remove ${v}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addKeyword();
                }
              }}
              className="flex-1 min-w-[8rem] bg-transparent text-sm py-0.5 focus:outline-none"
              placeholder={
                selectedValues.length === 0 && freeformValues.length === 0
                  ? 'Type or pick values…'
                  : ''
              }
            />
          </div>
          {keywordInput.trim() && (suggestions.length > 0 || !exact) && (
            <div className="border border-lichen rounded-sm max-h-48 overflow-auto bg-parchment">
              {suggestions.map((v) => (
                <button
                  key={v.value_id}
                  type="button"
                  onClick={() => {
                    toggleValueId(v.value_id);
                    setKeywordInput('');
                  }}
                  className="block w-full text-left px-3 py-1.5 text-sm text-ink hover:bg-stone/50"
                >
                  {v.value}
                </button>
              ))}
              {!exact && keywordInput.trim() && (
                <button
                  type="button"
                  onClick={addKeyword}
                  className="block w-full text-left px-3 py-1.5 text-sm text-bark hover:bg-stone/50 border-t border-lichen"
                >
                  Create "{keywordInput.trim()}" on apply
                </button>
              )}
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  const renderFreeformPicker = () => {
    // text / date — single string value
    const single = freeformValues[0] ?? '';
    if (fieldType === 'date') {
      return (
        <input
          type="date"
          value={single}
          onChange={(e) => onChange({ values: e.target.value ? [e.target.value] : [] })}
          className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
        />
      );
    }
    return (
      <input
        type="text"
        value={single}
        onChange={(e) => onChange({ values: e.target.value ? [e.target.value] : [] })}
        placeholder="Enter a value…"
        className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
      />
    );
  };

  return (
    <div className="space-y-4">
      {/* Step 1: pick the tag category */}
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Tag category <span className="text-semantic-error">*</span>
        </label>
        <select
          value={selectedDefinition?.definition_id ?? ''}
          onChange={(e) => onChange({ definition_id: e.target.value, value_ids: [], values: [] })}
          className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
        >
          <option value="">Select a tag to modify…</option>
          {definitions.map((d) => (
            <option key={d.definition_id} value={d.definition_id}>
              {d.display_name}
            </option>
          ))}
        </select>
        {selectedDefinition && (
          <p className="text-xs text-archive mt-1">
            {selectedDefinition.description || 'No description.'}
          </p>
        )}
      </div>

      {/* Step 2: mode */}
      {selectedDefinition && (
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Mode</label>
          <select
            value={mode}
            onChange={(e) => onChange({ mode: e.target.value as 'append' | 'remove' | 'replace' })}
            className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          >
            <option value="append">Add to existing</option>
            <option value="remove">Remove from existing</option>
            <option value="replace">Replace all for this tag</option>
          </select>
          <p className="text-xs text-archive mt-1">
            {mode === 'append' && 'Adds the selected values; existing values are kept.'}
            {mode === 'remove' && 'Removes the selected values from affected assets.'}
            {mode === 'replace' && 'Clears all current values for this tag, then adds the selected ones.'}
          </p>
        </div>
      )}

      {/* Step 3: values */}
      {selectedDefinition && (
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Values <span className="text-semantic-error">*</span>
          </label>
          {isControlled ? renderValuePicker() : renderFreeformPicker()}
        </div>
      )}
    </div>
  );
}
