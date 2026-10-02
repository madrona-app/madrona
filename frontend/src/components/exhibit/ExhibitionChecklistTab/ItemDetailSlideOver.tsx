import { useState, useEffect } from 'react';
import { Link2, Loader2 } from 'lucide-react';
import { apiFetch } from '../../../lib/apiClient';
import { formatDateShort, formatDateTime } from '../../../lib/formatters';
import { SlideOver } from '../../ui/SlideOver';
import type { ChecklistItem, ChecklistItemLink } from './types';
import { PHASE_CONFIG, ROLE_LABELS } from './constants';
import { StatusDropdown } from './StatusDropdown';
import { logger } from '../../../lib/logger';

interface ItemDetailSlideOverProps {
  item: ChecklistItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (itemId: string, updates: Partial<ChecklistItem>) => Promise<void>;
  canEdit: boolean;
  organizationId: string;
}

export function ItemDetailSlideOver({
  item,
  isOpen,
  onClose,
  onSave,
  canEdit,
  organizationId,
}: ItemDetailSlideOverProps) {
  const [editedNotes, setEditedNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [links, setLinks] = useState<ChecklistItemLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);

  useEffect(() => {
    if (item) {
      setEditedNotes(item.notes || '');
      loadLinks();
    }
  }, [item?.item_id]);

  const loadLinks = async () => {
    if (!item) return;
    setLoadingLinks(true);
    try {
      const data = await apiFetch<{ links: ChecklistItemLink[] }>(
        `/organizations/${organizationId}/exhibit/checklists/items/${item.item_id}/links`
      );
      setLinks(data.links || []);
    } catch (err) {
      logger.error('Failed to load links:', err);
    } finally {
      setLoadingLinks(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!item) return;
    setSaving(true);
    try {
      await onSave(item.item_id, { notes: editedNotes });
    } finally {
      setSaving(false);
    }
  };

  if (!item) return null;

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title={item.title}
      subtitle={PHASE_CONFIG[item.phase]?.label}
      width="lg"
      footer={
        canEdit && editedNotes !== (item.notes || '') ? (
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditedNotes(item.notes || '')}
              className="px-4 py-2 text-sm text-archive hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveNotes}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment text-sm rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Notes
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {/* Status and Details */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-archive">Status</label>
            <div className="mt-1">
              <StatusDropdown
                currentStatus={item.status}
                onStatusChange={async (status) => {
                  await onSave(item.item_id, { status });
                }}
                disabled={!canEdit}
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-archive">Responsible Role</label>
            <div className="mt-1 text-ink">{ROLE_LABELS[item.responsible_role]}</div>
          </div>
          <div>
            <label className="text-sm font-medium text-archive">Due Date</label>
            <div className="mt-1 text-ink">
              {item.due_date
                ? formatDateShort(item.due_date)
                : '-'}
            </div>
          </div>
          {item.completed_at && (
            <div>
              <label className="text-sm font-medium text-archive">Completed</label>
              <div className="mt-1 text-ink text-sm">
                {formatDateTime(item.completed_at)}
              </div>
            </div>
          )}
        </div>

        {/* Description */}
        {item.description && (
          <div>
            <label className="text-sm font-medium text-archive">Description</label>
            <p className="mt-1 text-ink/70">{item.description}</p>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="text-sm font-medium text-archive">Notes</label>
          {canEdit ? (
            <textarea
              value={editedNotes}
              onChange={(e) => setEditedNotes(e.target.value)}
              rows={4}
              className="mt-1 w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              placeholder="Add notes about this item..."
            />
          ) : (
            <p className="mt-1 text-ink/70">{item.notes || 'No notes.'}</p>
          )}
        </div>

        {/* Linked Items */}
        <div>
          <label className="text-sm font-medium text-archive flex items-center gap-2">
            <Link2 className="w-4 h-4" />
            Linked Items
          </label>
          {loadingLinks ? (
            <div className="mt-2 flex items-center gap-2 text-archive">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading...
            </div>
          ) : links.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {links.map((link) => (
                <li
                  key={link.link_id}
                  className="flex items-center gap-2 px-3 py-2 bg-stone/50 rounded-lg text-sm"
                >
                  <span className="text-archive capitalize">{link.linked_entity_type.replace('_', ' ')}</span>
                  <span className="text-ink">{link.entity_label || link.linked_entity_id.slice(0, 8)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-archive">No linked items.</p>
          )}
        </div>
      </div>
    </SlideOver>
  );
}
