import { useState } from 'react';
import { Plus, AlertTriangle, ClipboardList } from 'lucide-react';
import ConfirmDialog from '../../ConfirmDialog';
import { apiFetch } from '../../../lib/apiClient';

// Types and constants
import type { ChecklistItem } from './types';
import { PHASE_ORDER } from './constants';

// Hooks
import { useChecklist, useChecklistActions, usePhaseExpansion, useItemSelection } from './hooks';

// Components
import { ChecklistProgressHeader, groupItemsByPhase } from './ChecklistProgress';
import { PhaseGroup } from './ChecklistSection';
import { BulkActionBar } from './BulkActionBar';
import { ItemDetailSlideOver } from './ItemDetailSlideOver';
import { CreateChecklistModal } from './CreateChecklistModal';
import { BulkDueDateModal } from './BulkDueDateModal';
import { MadronaLoader } from '../../ui/MadronaLoader';

// === Main Component ===

interface ExhibitionChecklistTabProps {
  organizationId: string;
  exhibitionId: string;
  isEditing: boolean;
}

export function ExhibitionChecklistTab({
  organizationId,
  exhibitionId,
  isEditing,
}: ExhibitionChecklistTabProps) {
  // Data loading
  const { checklist, setChecklist, loading, error, loadChecklist } = useChecklist(organizationId, exhibitionId);

  // UI state
  const { expandedPhases, togglePhase, expandAll, collapseAll, allExpanded } = usePhaseExpansion();
  const { selectedItems, toggleSelectItem, clearSelection } = useItemSelection();
  const [selectedItem, setSelectedItem] = useState<ChecklistItem | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDueDateModal, setShowDueDateModal] = useState(false);
  const [bulkDueDate, setBulkDueDate] = useState('');
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);

  // Actions
  const {
    handleStatusChange,
    handleItemSave,
    handleCreateFromTemplate,
    handleCreateBlank,
  } = useChecklistActions(
    organizationId,
    exhibitionId,
    checklist,
    setChecklist,
    loadChecklist,
    selectedItem,
    setSelectedItem
  );

  // Bulk actions
  const handleBulkMarkDone = () => {
    setShowBulkConfirm(true);
  };

  const confirmBulkMarkDone = async () => {
    const itemIds = Array.from(selectedItems);
    await Promise.all(
      itemIds.map((itemId) =>
        apiFetch(`/organizations/${organizationId}/exhibit/checklists/items/${itemId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'done' }),
        })
      )
    );
    clearSelection();
    setShowBulkConfirm(false);
    await loadChecklist();
  };

  const handleBulkSetDueDate = () => {
    setShowDueDateModal(true);
  };

  const confirmBulkDueDate = async () => {
    const itemIds = Array.from(selectedItems);
    await Promise.all(
      itemIds.map((itemId) =>
        apiFetch(`/organizations/${organizationId}/exhibit/checklists/items/${itemId}`, {
          method: 'PATCH',
          body: JSON.stringify({ due_date: bulkDueDate }),
        })
      )
    );
    clearSelection();
    setShowDueDateModal(false);
    setBulkDueDate('');
    await loadChecklist();
  };

  // Group items by phase
  const itemsByPhase = checklist ? groupItemsByPhase(checklist.items) : {};

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MadronaLoader />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="w-12 h-12 mx-auto text-semantic-error mb-4" />
        <p className="text-semantic-error">{error}</p>
        <button
          onClick={loadChecklist}
          className="mt-4 px-4 py-2 text-sm text-bark hover:text-copper-dark"
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty state - no checklist yet
  if (!checklist) {
    return (
      <div className="text-center py-12">
        <ClipboardList className="w-16 h-16 mx-auto text-archive/50 mb-4" />
        <h3 className="text-lg font-medium text-ink mb-2">No Checklist Yet</h3>
        <p className="text-archive mb-6">
          Create a checklist to track tasks for this exhibition.
        </p>
        {isEditing && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment"
          >
            <Plus className="w-5 h-5" />
            Create Checklist
          </button>
        )}
        <CreateChecklistModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreateFromTemplate={handleCreateFromTemplate}
          onCreateBlank={handleCreateBlank}
          organizationId={organizationId}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with progress */}
      <ChecklistProgressHeader
        checklistName={checklist.name}
        items={checklist.items}
        allExpanded={allExpanded}
        onToggleAll={() => (allExpanded ? collapseAll() : expandAll())}
      />

      {/* Phase groups */}
      <div className="space-y-4">
        {PHASE_ORDER.map((phase) => (
          <PhaseGroup
            key={phase}
            phase={phase}
            items={itemsByPhase[phase] || []}
            isExpanded={expandedPhases.has(phase)}
            onToggle={() => togglePhase(phase)}
            onStatusChange={handleStatusChange}
            onItemClick={setSelectedItem}
            selectedItems={selectedItems}
            onToggleSelect={toggleSelectItem}
            canEdit={isEditing}
          />
        ))}
      </div>

      {/* Bulk action bar */}
      <BulkActionBar
        selectedCount={selectedItems.size}
        onMarkDone={handleBulkMarkDone}
        onSetDueDate={handleBulkSetDueDate}
        onClearSelection={clearSelection}
      />

      {/* Item detail slide-over */}
      <ItemDetailSlideOver
        item={selectedItem}
        isOpen={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        onSave={handleItemSave}
        canEdit={isEditing}
        organizationId={organizationId}
      />

      {/* Bulk mark done confirmation */}
      <ConfirmDialog
        isOpen={showBulkConfirm}
        onClose={() => setShowBulkConfirm(false)}
        onConfirm={confirmBulkMarkDone}
        title="Mark Items as Done"
        message={`Are you sure you want to mark ${selectedItems.size} item(s) as done?`}
        confirmText="Mark Done"
        confirmStyle="primary"
      />

      {/* Bulk due date modal */}
      <BulkDueDateModal
        isOpen={showDueDateModal}
        selectedCount={selectedItems.size}
        dueDate={bulkDueDate}
        onDueDateChange={setBulkDueDate}
        onConfirm={confirmBulkDueDate}
        onClose={() => setShowDueDateModal(false)}
      />
    </div>
  );
}

export default ExhibitionChecklistTab;

// Re-export types for consumers
export type { ChecklistItem, ChecklistPhase, ChecklistItemStatus, ExhibitionChecklist } from './types';
