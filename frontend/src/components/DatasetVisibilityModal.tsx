import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import type { Dataset } from '../lib/schemas';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';
import { logger } from '../lib/logger';
import { formatNumber } from '../lib/formatters';
import { ModalPortal } from './ModalPortal';

interface DatasetVisibilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  datasets: Dataset[];
  selectedDatasetIds: Set<string>;
  datasetOrder: string[];
  onSave: (selectedIds: Set<string>, order: string[]) => Promise<void>;
}

/**
 * Modal for managing dataset visibility in the flow overview.
 * Supports drag-to-reorder and visibility toggle.
 */
export function DatasetVisibilityModal({
  isOpen,
  onClose,
  datasets,
  selectedDatasetIds: initialSelectedIds,
  datasetOrder: initialOrder,
  onSave,
}: DatasetVisibilityModalProps) {
  const { isMobile } = useBreakpoint();
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'dataset-visibility',
  });

  // Local state for editing (don't mutate parent state until save)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelectedIds));
  const [order, setOrder] = useState<string[]>(initialOrder);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset local state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedIds(new Set(initialSelectedIds));
      setOrder(initialOrder);
    }
  }, [isOpen, initialSelectedIds, initialOrder]);

  const handleToggleVisibility = useCallback((datasetId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(datasetId)) {
        next.delete(datasetId);
      } else {
        next.add(datasetId);
      }
      return next;
    });
  }, []);

  const handleClear = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(selectedIds, order);
      onClose();
    } catch (err) {
      logger.error('Failed to save preferences:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
    { }
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        className={`bg-parchment flex flex-col shadow-xl ${
          isMobile
            ? 'rounded-t-lg w-full h-[90vh] fixed bottom-0 left-0 right-0'
            : 'rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen flex items-start justify-between gap-3">
          <div className="flex-1">
            <h2
              id={titleId}
              className="m-0 text-lg font-semibold text-ink"
            >
              Dataset visibility
            </h2>
            <p
              id={descriptionId}
              className="mt-1 mb-0 text-sm text-archive"
            >
              {isMobile ? 'Tap to toggle visibility.' : 'Drag to reorder. Toggle visibility with the checkbox.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 bg-transparent border-none cursor-pointer text-archive hover:text-ink transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Dataset list */}
        <div
          className="px-6 py-5 overflow-y-auto flex-1"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {datasets.length === 0 ? (
            <div className="text-sm text-archive text-center py-6">
              No datasets available
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {order
                .map((datasetId) => datasets.find((d) => d.dataset_id === datasetId))
                .filter((dataset): dataset is Dataset => dataset !== undefined)
                .map((dataset, index) => {
                  const isSelected = selectedIds.has(dataset.dataset_id);
                  const isDragging = draggedIndex === index;

                  return (
                    <div
                      key={dataset.dataset_id}
                      draggable={!isMobile}
                      onDragStart={(e) => {
                        if (isMobile) return;
                        setDraggedIndex(index);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => {
                        if (isMobile) return;
                        e.preventDefault();
                        if (draggedIndex === null || draggedIndex === index) return;

                        const newOrder = [...order];
                        const draggedItem = newOrder[draggedIndex];
                        newOrder.splice(draggedIndex, 1);
                        newOrder.splice(index, 0, draggedItem);
                        setOrder(newOrder);
                        setDraggedIndex(index);
                      }}
                      onDragEnd={() => {
                        setDraggedIndex(null);
                      }}
                      className={`flex items-center border border-lichen rounded-sm transition-all duration-200 ${
                        isMobile ? 'gap-4 px-3 py-3.5 min-h-[56px]' : 'gap-3 p-3'
                      } ${isSelected ? 'bg-parchment' : 'bg-transparent'} ${
                        isDragging ? 'opacity-50' : 'opacity-100'
                      } ${isMobile ? 'cursor-pointer' : 'cursor-grab'}`}
                      onClick={isMobile ? () => handleToggleVisibility(dataset.dataset_id) : undefined}
                      role={isMobile ? 'button' : undefined}
                      tabIndex={isMobile ? -1 : undefined}
                    >
                      {/* Drag handle - hidden on mobile */}
                      {!isMobile && (
                        <div className="flex flex-col gap-[3px] cursor-grab opacity-40 flex-shrink-0">
                          <div className="w-3 h-0.5 bg-archive rounded-sm" />
                          <div className="w-3 h-0.5 bg-archive rounded-sm" />
                          <div className="w-3 h-0.5 bg-archive rounded-sm" />
                        </div>
                      )}

                      {/* Checkbox for visibility */}
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleVisibility(dataset.dataset_id);
                        }}
                        className={`flex items-center justify-center flex-shrink-0 rounded-sm cursor-pointer border-2 transition-colors ${
                          isMobile ? 'w-6 h-6' : 'w-4 h-4'
                        } ${
                          isSelected
                            ? 'border-bark bg-bark'
                            : 'border-stone bg-transparent'
                        }`}
                        role="checkbox"
                        aria-checked={isSelected}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleToggleVisibility(dataset.dataset_id);
                          }
                        }}
                      >
                        {isSelected && (
                          <svg width={isMobile ? '14' : '10'} height={isMobile ? '14' : '10'} viewBox="0 0 10 10" fill="none">
                            <path
                              d="M2 5L4 7L8 3"
                              stroke="white"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </div>

                      {/* Dataset info */}
                      <div className="flex-1">
                        <div className="text-sm text-ink font-medium">
                          {dataset.name}
                        </div>
                        <div className="text-xs text-archive mt-0.5">
                          {formatNumber(dataset.entity_count || 0)} entities
                        </div>
                      </div>

                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex flex-col gap-3">
          {selectedIds.size > 5 && (
            <div className="text-xs text-archive">
              Large selections may reduce clarity.
            </div>
          )}
          <div className="flex justify-between items-center gap-3">
            <button
              onClick={handleClear}
              disabled={selectedIds.size === 0}
              className={`bg-transparent border-none transition-colors ${
                isMobile ? 'px-4 py-3 min-h-[44px] text-sm' : 'px-3 py-1.5 text-sm'
              } ${
                selectedIds.size === 0
                  ? 'text-stone cursor-not-allowed'
                  : 'text-archive cursor-pointer hover:text-ink'
              }`}
            >
              Clear selection
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`border-none rounded-sm text-parchment transition-colors ${
                isMobile ? 'px-6 py-3 min-h-[44px] text-sm flex-1' : 'px-4 py-2 text-sm'
              } ${
                saving
                  ? 'bg-archive cursor-not-allowed'
                  : 'bg-bark cursor-pointer hover:bg-bark/90'
              }`}
            >
              {saving ? 'Saving...' : 'Apply'}
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
