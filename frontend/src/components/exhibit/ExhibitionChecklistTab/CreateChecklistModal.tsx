import { useState, useEffect } from 'react';
import { Loader2, ClipboardList } from 'lucide-react';
import { apiFetch } from '../../../lib/apiClient';
import type { ChecklistTemplate } from './types';
import { logger } from '../../../lib/logger';
import { MadronaLoader } from '../../ui/MadronaLoader';
import { ModalPortal } from '../../ModalPortal';

interface CreateChecklistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateFromTemplate: (templateId: string) => Promise<void>;
  onCreateBlank: (name: string) => Promise<void>;
  organizationId: string;
}

export function CreateChecklistModal({
  isOpen,
  onClose,
  onCreateFromTemplate,
  onCreateBlank,
  organizationId,
}: CreateChecklistModalProps) {
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [blankName, setBlankName] = useState('');
  const [mode, setMode] = useState<'template' | 'blank'>('template');

  useEffect(() => {
    if (isOpen) {
      loadTemplates();
    }
  }, [isOpen]);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ templates: ChecklistTemplate[] }>(
        `/organizations/${organizationId}/exhibit/checklist-templates?published_only=true`
      );
      setTemplates(data.templates || []);
    } catch (err) {
      logger.error('Failed to load templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (templateId?: string) => {
    setCreating(true);
    try {
      if (templateId) {
        await onCreateFromTemplate(templateId);
      } else {
        await onCreateBlank(blankName || 'Exhibition Checklist');
      }
      onClose();
    } catch (err) {
      logger.error('Failed to create checklist:', err);
    } finally {
      setCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-ink/30" onClick={onClose} />
        <div className="relative bg-parchment rounded-lg shadow-xl w-full max-w-lg">
          <div className="px-6 py-4 border-b border-lichen">
            <h2 className="text-lg font-semibold text-ink">Create Checklist</h2>
          </div>

          <div className="p-6">
            {/* Mode toggle */}
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setMode('template')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg border ${
                  mode === 'template'
                    ? 'bg-bark text-parchment border-bark'
                    : 'bg-parchment text-ink border-lichen hover:bg-stone'
                }`}
              >
                From Template
              </button>
              <button
                onClick={() => setMode('blank')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg border ${
                  mode === 'blank'
                    ? 'bg-bark text-parchment border-bark'
                    : 'bg-parchment text-ink border-lichen hover:bg-stone'
                }`}
              >
                Blank Checklist
              </button>
            </div>

            {mode === 'template' && (
              <div>
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <MadronaLoader variant="dots" />
                  </div>
                ) : templates.length > 0 ? (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {templates.map((template) => (
                      <button
                        key={template.template_id}
                        onClick={() => handleCreate(template.template_id)}
                        disabled={creating}
                        className="w-full text-left p-4 border border-lichen rounded-lg hover:bg-stone/30 transition-colors disabled:opacity-50"
                      >
                        <div className="font-medium text-ink">{template.name}</div>
                        {template.description && (
                          <div className="text-sm text-archive mt-1">{template.description}</div>
                        )}
                        <div className="text-xs text-archive mt-2">
                          Version {template.published_version_number}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-archive">
                    <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No published templates available.</p>
                    <p className="text-sm mt-1">Create a blank checklist or add templates first.</p>
                  </div>
                )}
              </div>
            )}

            {mode === 'blank' && (
              <div>
                <label className="block text-sm font-medium text-ink mb-2">
                  Checklist Name
                </label>
                <input
                  type="text"
                  value={blankName}
                  onChange={(e) => setBlankName(e.target.value)}
                  placeholder="Exhibition Checklist"
                  className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                />
                <button
                  onClick={() => handleCreate()}
                  disabled={creating}
                  className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50"
                >
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create Checklist
                </button>
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-lichen flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-archive hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
