import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Plus, Save, RotateCcw, Loader2, Trash2 } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import ConfirmDialog from '../../components/ConfirmDialog';
import { formatDateShort } from '@/lib/formatters';

interface SystemPrompt {
  prompt_id: string;
  organization_id: string | null;
  persona: string;
  content: string;
  version: number;
  created_at: string;
  updated_at: string;
}

const PERSONA_LABELS: Record<string, string> = {
  staff: 'Staff (Platform)',
  visitor: 'Visitor (Public)',
  guide: 'Guide (Standalone)',
};

const PERSONA_DESCRIPTIONS: Record<string, string> = {
  staff: 'Platform users in the collection management system — collection tools, search, data entry.',
  visitor: 'Anonymous public visitors on the museum website — gallery guide, exhibitions, events.',
  guide: 'Standalone Guide product users — collections, AAT, CCI, and professional standards.',
};

const API_BASE = '/admin/system-prompts';

export default function SystemPromptsPage() {
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  const [creatingPersona, setCreatingPersona] = useState<string | null>(null);
  const [createContent, setCreateContent] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const fetchPrompts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ prompts: SystemPrompt[] }>(API_BASE);
      setPrompts(data.prompts);
    } catch (err: any) {
      const status = err?.status || err?.response?.status;
      if (status === 403) {
        setError('You do not have permission to manage system prompts');
      } else {
        setError(err?.message || 'Failed to load system prompts');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPrompts(); }, [fetchPrompts]);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(t);
  }, [success]);

  const getPrompt = (persona: string): SystemPrompt | null =>
    prompts.find(p => p.persona === persona) || null;

  const handleStartEdit = (prompt: SystemPrompt) => {
    setEditingId(prompt.prompt_id);
    setEditContent(prompt.content);
    setCreatingPersona(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditContent('');
  };

  const handleSave = async (promptId: string) => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`${API_BASE}/${promptId}`, {
        method: 'PUT',
        body: JSON.stringify({ content: editContent }),
      });
      setEditingId(null);
      setEditContent('');
      setSuccess('Prompt updated successfully');
      fetchPrompts();
    } catch (err: any) {
      setError(err?.message || 'Failed to update prompt');
    } finally {
      setSaving(false);
    }
  };

  const handleStartCreate = (persona: string) => {
    setCreatingPersona(persona);
    setCreateContent('');
    setEditingId(null);
  };

  const handleCreate = async () => {
    if (!creatingPersona) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(API_BASE, {
        method: 'POST',
        body: JSON.stringify({ persona: creatingPersona, content: createContent }),
      });
      setCreatingPersona(null);
      setCreateContent('');
      setSuccess('Prompt saved to database');
      fetchPrompts();
    } catch (err: any) {
      const detail = err?.body?.detail;
      setError(typeof detail === 'string' ? detail : err?.message || 'Failed to create prompt');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (promptId: string) => {
    setError(null);
    try {
      await apiFetch(`${API_BASE}/${promptId}`, { method: 'DELETE' });
      setSuccess('Prompt deleted — reverted to hardcoded default');
      fetchPrompts();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete prompt');
    }
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-forest/10 p-2">
            <MessageSquare className="h-5 w-5 text-forest" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-ink">System Prompts</h1>
            <p className="text-sm text-archive">
              Manage Guide's base personality and behavior for each persona
            </p>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-4 rounded-lg border border-semantic-error/30 bg-semantic-error/10 px-4 py-3 text-sm text-semantic-error">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-lg border border-semantic-success/30 bg-semantic-success/10 px-4 py-3 text-sm text-semantic-success">
          {success}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-archive" />
        </div>
      ) : (
        <div className="space-y-4">
          {(['staff', 'visitor', 'guide'] as const).map(persona => {
            const prompt = getPrompt(persona);
            const isEditing = editingId && prompt?.prompt_id === editingId;
            const isCreating = creatingPersona === persona;

            return (
              <div key={persona} className="rounded-lg border border-lichen bg-parchment">
                {/* Card header */}
                <div className="flex items-start justify-between border-b border-lichen px-5 py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-ink">
                        {PERSONA_LABELS[persona]}
                      </h2>
                      {prompt ? (
                        <span className="rounded-full bg-semantic-success/10 px-2 py-0.5 text-xs text-semantic-success">
                          DB
                        </span>
                      ) : (
                        <span className="rounded-full bg-stone/50 px-2 py-0.5 text-xs text-archive">
                          Hardcoded
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-archive">
                      {PERSONA_DESCRIPTIONS[persona]}
                    </p>
                    {prompt && (
                      <p className="mt-0.5 text-xs text-archive">
                        v{prompt.version} · {formatDateShort(prompt.updated_at)}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {prompt && !isEditing && (
                      <>
                        <button
                          onClick={() => handleStartEdit(prompt)}
                          className="rounded-md border border-lichen px-3 py-1.5 text-xs font-medium text-ink hover:bg-stone/30"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(prompt.prompt_id)}
                          className="rounded-md p-1.5 text-archive hover:bg-semantic-error/10 hover:text-semantic-error"
                          title="Delete (revert to hardcoded)"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                    {!prompt && !isCreating && (
                      <button
                        onClick={() => handleStartCreate(persona)}
                        className="flex items-center gap-1 rounded-md border border-lichen px-3 py-1.5 text-xs font-medium text-ink hover:bg-stone/30"
                      >
                        <Plus size={12} />
                        Save to DB
                      </button>
                    )}
                  </div>
                </div>

                {/* Card body */}
                <div className="px-5 py-4">
                  {isEditing && prompt ? (
                    <div className="space-y-3">
                      <textarea
                        value={editContent}
                        onChange={e => setEditContent(e.target.value)}
                        rows={18}
                        className="w-full rounded-md border border-lichen px-3 py-2 text-sm font-mono leading-relaxed text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 resize-y"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={handleCancelEdit}
                          className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-archive hover:text-ink"
                        >
                          <RotateCcw size={12} />
                          Cancel
                        </button>
                        <button
                          onClick={() => handleSave(prompt.prompt_id)}
                          disabled={saving || !editContent.trim()}
                          className="btn-primary flex items-center gap-1 rounded-md px-3 py-1.5 text-xs disabled:opacity-50"
                        >
                          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                          Save
                        </button>
                      </div>
                    </div>
                  ) : isCreating ? (
                    <div className="space-y-3">
                      <p className="text-xs text-archive">
                        Paste or write the prompt below. Once saved, Guide will use this instead of the hardcoded default.
                      </p>
                      <textarea
                        value={createContent}
                        onChange={e => setCreateContent(e.target.value)}
                        rows={18}
                        placeholder="Enter system prompt..."
                        className="w-full rounded-md border border-lichen px-3 py-2 text-sm font-mono leading-relaxed text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 resize-y"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setCreatingPersona(null)}
                          className="rounded-md px-3 py-1.5 text-xs text-archive hover:text-ink"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleCreate}
                          disabled={saving || !createContent.trim()}
                          className="btn-primary flex items-center gap-1 rounded-md px-3 py-1.5 text-xs disabled:opacity-50"
                        >
                          {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                          Save Prompt
                        </button>
                      </div>
                    </div>
                  ) : prompt ? (
                    <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap text-sm font-mono leading-relaxed text-ink">
                      {prompt.content}
                    </pre>
                  ) : (
                    <p className="text-sm italic text-archive">
                      Using hardcoded default — no database entry
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info footer */}
      <div className="mt-6 rounded-lg border border-lichen bg-parchment px-5 py-4">
        <p className="text-xs font-medium text-ink">How prompt resolution works</p>
        <p className="mt-1 text-xs text-archive">
          Guide checks the database first, then falls back to the hardcoded default in code.
          Changes take effect within 60 seconds (cache TTL). Runtime context (user name, role,
          current record) is injected automatically.
        </p>
      </div>

      <ConfirmDialog
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => {
          if (deleteConfirmId) handleDelete(deleteConfirmId);
          setDeleteConfirmId(null);
        }}
        title="Delete System Prompt?"
        message="This will revert to the hardcoded default prompt."
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
