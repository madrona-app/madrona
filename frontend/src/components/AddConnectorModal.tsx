import { useState } from 'react';
import { X } from 'lucide-react';
import type { ConnectorInstance } from '../lib/schemas';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';
import { ModalPortal } from './ModalPortal';

interface AddConnectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (connectorInstanceId: string) => void;
  title: string;
  connectors: ConnectorInstance[];
  existingConnectorIds: string[];
}

export default function AddConnectorModal({
  isOpen,
  onClose,
  onAdd,
  title,
  connectors,
  existingConnectorIds,
}: AddConnectorModalProps) {
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>('');
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'add-connector-modal',
  });

  // Filter out connectors that are already added
  const availableConnectors = connectors.filter(
    (c) => !existingConnectorIds.includes(c.connector_instance_id)
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedConnectorId) {
      onAdd(selectedConnectorId);
      setSelectedConnectorId('');
      onClose();
    }
  };

  const handleClose = () => {
    setSelectedConnectorId('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
    { }
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={handleClose}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-[500px] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen flex items-center justify-between">
          <h2 id={titleId} className="m-0 text-lg font-semibold text-ink">{title}</h2>
          <button
            onClick={handleClose}
            className="p-2 text-archive hover:text-ink transition-colors"
            aria-label="Close dialog"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4">
            {availableConnectors.length === 0 ? (
              <div className="text-center py-8">
                <p id={descriptionId} className="text-archive mb-2">
                  No available connectors
                </p>
                <p className="text-sm text-archive">
                  All connectors have been added or none exist
                </p>
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="add-connector-select" className="block text-sm font-medium text-ink mb-1">
                    Select Connector
                  </label>
                  <select
                    id="add-connector-select"
                    value={selectedConnectorId}
                    onChange={(e) => setSelectedConnectorId(e.target.value)}
                    className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    required
                  >
                    <option value="">Choose a connector...</option>
                    {availableConnectors.map((connector) => (
                      <option
                        key={connector.connector_instance_id}
                        value={connector.connector_instance_id}
                      >
                        {connector.name}
                      </option>
                    ))}
                  </select>
                </div>
                <p id={descriptionId} className="text-xs text-archive">
                  The connector will be enabled by default
                </p>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border border-stone rounded-sm bg-parchment text-sm text-ink hover:bg-stone/20 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedConnectorId}
              className="px-4 py-2 bg-bark text-parchment rounded-sm text-sm hover:bg-bark/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Add Connector
            </button>
          </div>
        </form>
      </div>
    </div>
    </ModalPortal>
  );
}
