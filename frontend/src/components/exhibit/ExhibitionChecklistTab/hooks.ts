import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../lib/apiClient';
import type { ExhibitionChecklist, ChecklistItem, ChecklistItemStatus } from './types';
import { PHASE_ORDER } from './constants';
import { logger } from '../../../lib/logger';

export function useChecklist(organizationId: string, exhibitionId: string) {
  const [checklist, setChecklist] = useState<ExhibitionChecklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadChecklist = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<{ checklist: ExhibitionChecklist | null }>(
        `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/checklists`
      );
      setChecklist(data.checklist);
    } catch (err) {
      logger.error('Failed to load checklist:', err);
      setError(err instanceof Error ? err.message : 'Failed to load checklist');
    } finally {
      setLoading(false);
    }
  }, [organizationId, exhibitionId]);

  useEffect(() => {
    loadChecklist();
  }, [loadChecklist]);

  return { checklist, setChecklist, loading, error, loadChecklist };
}

export function useChecklistActions(
  organizationId: string,
  exhibitionId: string,
  _checklist: ExhibitionChecklist | null,
  setChecklist: React.Dispatch<React.SetStateAction<ExhibitionChecklist | null>>,
  loadChecklist: () => Promise<void>,
  selectedItem: ChecklistItem | null,
  setSelectedItem: React.Dispatch<React.SetStateAction<ChecklistItem | null>>
) {
  const handleStatusChange = async (itemId: string, status: ChecklistItemStatus) => {
    try {
      await apiFetch(`/organizations/${organizationId}/exhibit/checklists/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      // Optimistically update local state
      setChecklist((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((item) =>
            item.item_id === itemId ? { ...item, status } : item
          ),
        };
      });
      // Also update selected item if it's the one being changed
      if (selectedItem?.item_id === itemId) {
        setSelectedItem((prev) => prev ? { ...prev, status } : prev);
      }
    } catch (err) {
      logger.error('Failed to update status:', err);
      // Reload to get correct state
      loadChecklist();
    }
  };

  const handleItemSave = async (itemId: string, updates: Partial<ChecklistItem>) => {
    await apiFetch(`/organizations/${organizationId}/exhibit/checklists/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    await loadChecklist();
    // Update selected item
    if (selectedItem?.item_id === itemId) {
      setSelectedItem((prev) => prev ? { ...prev, ...updates } : prev);
    }
  };

  const handleCreateFromTemplate = async (templateId: string) => {
    await apiFetch(`/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/checklists`, {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId }),
    });
    await loadChecklist();
  };

  const handleCreateBlank = async (name: string) => {
    await apiFetch(`/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/checklists`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    await loadChecklist();
  };

  return {
    handleStatusChange,
    handleItemSave,
    handleCreateFromTemplate,
    handleCreateBlank,
  };
}

export function usePhaseExpansion() {
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(PHASE_ORDER));

  const togglePhase = (phase: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        next.add(phase);
      }
      return next;
    });
  };

  const expandAll = () => setExpandedPhases(new Set(PHASE_ORDER));
  const collapseAll = () => setExpandedPhases(new Set());
  const allExpanded = expandedPhases.size === PHASE_ORDER.length;

  return { expandedPhases, togglePhase, expandAll, collapseAll, allExpanded };
}

export function useItemSelection() {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const toggleSelectItem = (itemId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedItems(new Set());

  return { selectedItems, toggleSelectItem, clearSelection };
}
